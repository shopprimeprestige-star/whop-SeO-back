// Webhook pubblico: Site A → Store B
// Crea/aggiorna un prodotto sincronizzato (PRD-XXXXX, nascosto dai listing).
// Se uno store Whop è configurato, pubblica automaticamente product+plan su Whop.
//
// Headers richiesti:
//   Content-Type: application/json
//   x-sync-signature: <hex HMAC-SHA256 del body grezzo, opzionalmente "sha256=...">
//   Origin: https://<site-a-domain>   (deve essere in sync_settings.allowed_source_origins)
//
// Risposta success: { ok:true, prd_code, public_url, whop: { product_id|null, plan_id|null } }

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/runtime-supabase-admin";
import {
  getSyncSettings,
  generateUniquePrdCode,
  verifyHmacSignature,
  publishProductToAllWhops,
} from "@/lib/sync.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-sync-signature, Origin",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

const VariantInput = z.object({
  label: z.string().min(1).max(120),
  price_override: z.number().nonnegative().optional().nullable(),
  stock: z.number().int().nonnegative().optional().nullable(),
  sku: z.string().max(120).optional().nullable(),
});

const Body = z.object({
  source_store_id: z.string().min(1).max(120),
  source_product_ref: z.string().min(1).max(200),
  title: z.string().min(1).max(255),
  description: z.string().max(8000).optional().nullable(),
  price: z.number().nonnegative(),
  compare_at_price: z.number().nonnegative().optional().nullable(),
  currency: z.string().min(2).max(8).default("EUR"),
  image_url: z.string().url().max(2000).optional().nullable(),
  // Indirizza il prodotto al Whop dello Store B che ha questa sync_key.
  // Opzionale: se assente usa il default in sync_settings.
  whop_store_key: z.string().min(2).max(64).regex(/^[a-z0-9][a-z0-9-_]*$/i).optional().nullable(),
  variants: z.array(VariantInput).max(50).optional(),
}).strip();

export const Route = createFileRoute("/api/public/sync-product")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),
      POST: async ({ request }) => {
        try {
          const rawBody = await request.text();
          const settings = await getSyncSettings();

          // 1) HMAC
          if (!settings.hmac_secret) {
            return json({ ok: false, error: "sync_not_configured", message: "Configura HMAC secret in admin." }, 503);
          }
          const sig = request.headers.get("x-sync-signature");
          if (!(await verifyHmacSignature(settings.hmac_secret, rawBody, sig))) {
            return json({ ok: false, error: "invalid_signature" }, 401);
          }

          // 2) Origin allowlist (se popolata)
          const origin = request.headers.get("origin") || request.headers.get("referer") || "";
          if (settings.allowed_source_origins.length > 0) {
            const ok = settings.allowed_source_origins.some(
              (a) => origin.startsWith(a.trim().replace(/\/$/, "")),
            );
            if (!ok) return json({ ok: false, error: "origin_not_allowed", origin }, 403);
          }

          // 3) Parse
          let parsed;
          try { parsed = Body.parse(JSON.parse(rawBody)); }
          catch (e) { return json({ ok: false, error: "invalid_payload", detail: String(e) }, 400); }

          // 4) Upsert prodotto
          const { data: existing } = await supabaseAdmin
            .from("shop_products")
            .select("id,prd_code,whop_product_id,whop_plan_id,image_url,bridge_store_id")
            .eq("source_store_id", parsed.source_store_id)
            .eq("source_product_ref", parsed.source_product_ref)
            .eq("source", "synced")
            .maybeSingle();

          let productId: string;
          let prdCode: string;

          if (existing) {
            productId = (existing as { id: string }).id;
            prdCode = (existing as { prd_code: string }).prd_code;
            await supabaseAdmin
              .from("shop_products")
              .update({
                price: parsed.price,
                compare_at_price: parsed.compare_at_price ?? null,
                currency: parsed.currency,
                description: parsed.description ?? null,
                image_url:
                  parsed.image_url
                  ?? (existing as { image_url: string | null }).image_url
                  ?? settings.default_synced_image_url,
                source_synced_at: new Date().toISOString(),
                hidden_from_listing: true,
                source: "synced",
              } as never)
              .eq("id", productId);
          } else {
            prdCode = await generateUniquePrdCode();
            const slug = prdCode.toLowerCase();
            const { data: inserted, error: insErr } = await supabaseAdmin
              .from("shop_products")
              .insert({
                slug,
                prd_code: prdCode,
                title: prdCode, // mascherato sul front-end
                brand: "Atelier Nord",
                description: parsed.description ?? null,
                price: parsed.price,
                compare_at_price: parsed.compare_at_price ?? null,
                currency: parsed.currency,
                image_url: parsed.image_url ?? settings.default_synced_image_url,
                published: true,
                featured: false,
                sort_order: 0,
                source: "synced",
                source_store_id: parsed.source_store_id,
                source_product_ref: parsed.source_product_ref,
                source_synced_at: new Date().toISOString(),
                hidden_from_listing: true,
              } as never)
              .select("id,prd_code")
              .single();
            if (insErr || !inserted) throw new Error(insErr?.message ?? "insert_failed");
            productId = (inserted as { id: string }).id;
            prdCode = (inserted as { prd_code: string }).prd_code;
          }

          // 5) Varianti (rimpiazzo)
          if (parsed.variants && parsed.variants.length > 0) {
            await supabaseAdmin.from("shop_variants").delete().eq("product_id", productId);
            const rows = parsed.variants.map((v, i) => ({
              product_id: productId,
              label: v.label,
              sku: v.sku ?? null,
              price_override: v.price_override ?? null,
              stock: v.stock ?? null,
              sort_order: i,
            }));
            await supabaseAdmin.from("shop_variants").insert(rows as never);
          } else {
            // assicura almeno una variante "Unica"
            const { data: hasVar } = await supabaseAdmin
              .from("shop_variants").select("id").eq("product_id", productId).limit(1);
            if (!hasVar || hasVar.length === 0) {
              await supabaseAdmin.from("shop_variants").insert({
                product_id: productId, label: "Unica", sort_order: 0,
              } as never);
            }
          }

          // 6) Pubblicazione automatica su TUTTI gli store Whop attivi.
          //    Gli store già sincronizzati per questo prodotto vengono saltati.
          let whopResult: { product_id: string | null; plan_id: string | null; error?: string } = {
            product_id: (existing as { whop_product_id?: string | null } | null)?.whop_product_id ?? null,
            plan_id: (existing as { whop_plan_id?: string | null } | null)?.whop_plan_id ?? null,
          };
          let publications: Awaited<ReturnType<typeof publishProductToAllWhops>> = [];

          if (settings.auto_publish_to_whop) {
            try {
              publications = await publishProductToAllWhops({
                id: productId,
                title: prdCode,
                description: parsed.description ?? prdCode,
                price: parsed.price,
                currency: parsed.currency,
              });

              // Aggiorna la riga prodotto con la prima pubblicazione riuscita
              // (anche se "skipped": serve a tenere whop_product_id/plan_id sul prodotto).
              const firstOk = publications.find((r) => r.ok && r.whop_product_id && r.whop_plan_id);
              if (firstOk) {
                await supabaseAdmin
                  .from("shop_products")
                  .update({
                    whop_product_id: firstOk.whop_product_id,
                    whop_plan_id: firstOk.whop_plan_id,
                    whop_synced_at: new Date().toISOString(),
                    whop_sync_error: null,
                    bridge_store_id: firstOk.store_id,
                  } as never)
                  .eq("id", productId);
                whopResult = { product_id: firstOk.whop_product_id ?? null, plan_id: firstOk.whop_plan_id ?? null };
              }

              const firstErr = publications.find((r) => !r.ok);
              if (firstErr?.error) {
                whopResult.error = firstErr.error;
                if (!firstOk) {
                  await supabaseAdmin
                    .from("shop_products")
                    .update({ whop_sync_error: firstErr.error } as never)
                    .eq("id", productId);
                }
              }
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              whopResult.error = msg;
              await supabaseAdmin
                .from("shop_products")
                .update({ whop_sync_error: msg } as never)
                .eq("id", productId);
            }
          }

          const origin2 = new URL(request.url).origin;
          return json({
            ok: true,
            prd_code: prdCode,
            public_url: `${origin2}/shop/prodotto/${prdCode.toLowerCase()}`,
            whop: whopResult,
            publications: publications.map((p) => ({
              store_id: p.store_id,
              ok: p.ok,
              skipped: p.skipped ?? false,
              error: p.error ?? null,
            })),
            published_count: publications.filter((p) => p.ok && !p.skipped).length,
            skipped_count: publications.filter((p) => p.skipped).length,
          });
        } catch (e) {
          return json({ ok: false, error: "server_error", message: e instanceof Error ? e.message : String(e) }, 500);
        }
      },
    },
  },
});
