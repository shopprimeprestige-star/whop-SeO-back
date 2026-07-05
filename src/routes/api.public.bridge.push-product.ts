// POST /api/public/bridge/push-product
// Sincronizza UN prodotto dal Sito A nel catalogo nativo del Sito B (shop_products + shop_variants).
// Auth: stessa bridge key di handshake/checkout (X-Bridge-Api-Key oppure Authorization: Bearer).
// Idempotente: upsert per (source_store_id, source_product_ref). Le varianti vengono rimpiazzate.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/runtime-supabase-admin";
import { authInboundRequest, corsPreflight, handleError, jsonResponse, logBridge } from "@/lib/bridge/auth.server";

const VariantIn = z.object({
  label: z.string().min(1).max(200),
  price: z.number().nonnegative().nullable().optional(),
  sku: z.string().max(120).nullable().optional(),
  color: z.string().max(80).nullable().optional(),
  size: z.string().max(80).nullable().optional(),
  stock: z.number().int().nullable().optional(),
}).strip();

const Body = z.object({
  store_id: z.string().uuid(),
  product: z.object({
    external_ref: z.string().min(1).max(255),
    title: z.string().min(1).max(300),
    slug: z.string().min(1).max(300),
    prd_code: z.string().max(60).optional(),
    description: z.string().max(2000).nullable().optional(),
    long_description: z.string().max(20000).nullable().optional(),
    price: z.number().nonnegative(),
    compare_price: z.number().nonnegative().nullable().optional(),
    currency: z.string().min(3).max(3).optional(),
    image_url: z.string().url().max(2000).nullable().optional(),
    gallery: z.array(z.string().url().max(2000)).max(20).optional(),
    tags: z.array(z.string().max(60)).max(40).optional(),
    brand: z.string().max(120).nullable().optional(),
    material: z.string().max(120).nullable().optional(),
    published: z.boolean().optional(),
    variants: z.array(VariantIn).max(100).optional(),
  }),
}).strip();

function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "prodotto";
}

function missingColumn(msg?: string): string | null {
  // colonna assente nello schema (PostgREST)
  const m = /Could not find the '([^']+)' column/.exec(msg || "");
  if (m) return m[1];
  // valore non ammesso da un check constraint tipo "<tabella>_<colonna>_check": scarta quella colonna
  const c = /violates check constraint "[a-z0-9]+_([a-z0-9_]+)_check"/i.exec(msg || "");
  if (c) return c[1];
  return null;
}

// Inserisce una riga ignorando colonne assenti nello schema reale (schema drift), riprovando.
async function insertResilient(table: string, row: Record<string, unknown>, step: string) {
  let payload = { ...row };
  for (let i = 0; i < 12; i++) {
    const { data, error } = await (supabaseAdmin as any).from(table).insert(payload as never).select("id").single();
    if (!error) return data;
    const col = missingColumn(error.message);
    if (!col || !(col in payload)) throw new Error(`${step}: ${error.message}`);
    delete payload[col];
  }
  throw new Error(`${step}: troppe colonne mancanti`);
}

async function updateResilient(table: string, row: Record<string, unknown>, id: string, step: string) {
  let payload = { ...row };
  for (let i = 0; i < 12; i++) {
    const { error } = await (supabaseAdmin as any).from(table).update(payload as never).eq("id", id);
    if (!error) return;
    const col = missingColumn(error.message);
    if (!col || !(col in payload)) throw new Error(`${step}: ${error.message}`);
    delete payload[col];
  }
  throw new Error(`${step}: troppe colonne mancanti`);
}

async function insertRowsResilient(table: string, rows: Record<string, unknown>[], step: string) {
  let payload = rows.map((r) => ({ ...r }));
  for (let i = 0; i < 12; i++) {
    const { error } = await (supabaseAdmin as any).from(table).insert(payload as never);
    if (!error) return;
    const col = missingColumn(error.message);
    if (!col || !payload.some((r) => col in r)) throw new Error(`${step}: ${error.message}`);
    payload = payload.map((r) => { const c = { ...r }; delete c[col]; return c; });
  }
  throw new Error(`${step}: troppe colonne mancanti`);
}

export const Route = createFileRoute("/api/public/bridge/push-product")({
  server: {
    handlers: {
      OPTIONS: async () => corsPreflight(),
      POST: async ({ request }) => {
        const endpoint = "/api/public/bridge/push-product";
        try {
          const apiKey = request.headers.get("X-Bridge-Api-Key") || request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || null;
          const body = Body.parse(await request.json());
          const store = await authInboundRequest(apiKey, body.store_id);

          const p = body.product;
          const now = new Date().toISOString();

          // 1) trova esistente per (source_store_id, source_product_ref)
          const { data: existing, error: findErr } = await supabaseAdmin
            .from("shop_products")
            .select("id, slug")
            .eq("source_store_id", body.store_id)
            .eq("source_product_ref", p.external_ref)
            .maybeSingle();
          if (findErr) throw new Error(`find_product: ${findErr.message}`);

          const baseSlug = slugify(p.slug || p.title);

          const fields = {
            title: p.title,
            slug: baseSlug,
            prd_code: p.prd_code || p.title,
            description: p.description ?? null,
            long_description: p.long_description ?? null,
            price: p.price,
            compare_at_price: p.compare_price ?? null,
            currency: (p.currency || "EUR").toUpperCase(),
            image_url: p.image_url ?? null,
            gallery: p.gallery ?? null,
            tags: p.tags ?? [],
            brand: p.brand ?? null,
            material: p.material ?? null,
            published: p.published ?? true,
            hidden_from_listing: true,
            source_store_id: body.store_id,
            source_product_ref: p.external_ref,
            source_synced_at: now,
            updated_at: now,
          };

          let productId: string;

          if (existing) {
            productId = existing.id;
            await updateResilient("shop_products", { ...fields }, productId, "update_product");
          } else {
            // slug deve essere unico: se collide con altro prodotto, suffissa con ref breve
            let slug = baseSlug;
            const { data: clash } = await supabaseAdmin.from("shop_products").select("id").eq("slug", slug).maybeSingle();
            if (clash) slug = `${baseSlug}-${p.external_ref.replace(/[^a-z0-9]/gi, "").slice(-6).toLowerCase()}`;
            const ins = await insertResilient("shop_products", { ...fields, slug, created_at: now }, "insert_product");
            productId = (ins as { id: string }).id;
          }

          // 2) rimpiazza varianti
          await supabaseAdmin.from("shop_variants").delete().eq("product_id", productId);
          const variants = (p.variants && p.variants.length > 0)
            ? p.variants
            : [{ label: "Standard" }];
          const rows = variants.map((v, i) => ({
            product_id: productId,
            label: v.label,
            price_override: v.price ?? null,
            sku: v.sku ?? null,
            color: v.color ?? null,
            size: v.size ?? null,
            stock: v.stock ?? null,
            sort_order: i,
            updated_at: now,
          }));
          await insertRowsResilient("shop_variants", rows, "insert_variants");

          await supabaseAdmin.from("bridge_stores").update({ last_sync_at: now }).eq("id", store.id);

          // Fan-out automatico su TUTTI i Whop collegati (idempotente: salta quelli già inviati).
          let whop: { synced: number; skipped: number; failed: number; lastError?: string } | null = null;
          try {
            const { syncShopProductToAllWhop } = await import("@/lib/bridge/whop-sync.server");
            const r = await syncShopProductToAllWhop(productId);
            whop = { synced: r.synced, skipped: r.skipped, failed: r.failed, lastError: r.lastError };
          } catch (e) {
            whop = { synced: 0, skipped: 0, failed: -1, lastError: e instanceof Error ? e.message : String(e) };
            console.error("[push-product] whop fanout failed", e);
          }

          await logBridge({ store_id: store.id, direction: "inbound", endpoint, http_status: 200, success: true, payload: { product_ref: p.external_ref, product_id: productId, variants: rows.length, whop } });

          return jsonResponse({ ok: true, product_id: productId, slug: fields.slug, variants: rows.length, whop });
        } catch (e) {
          return handleError(e, endpoint);
        }
      },
    },
  },
});
