// POST /api/generate-checkout — genera redirect_url di checkout.
// Auth: Authorization: Bearer <key>  (fallback X-Bridge-Api-Key), timing-safe.
// Integrazioni: "shopify" → Draft Order Shopify, "native_bridge" → sessione interna.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/runtime-supabase-admin";
import { safeEqual, sha256Hex } from "@/lib/bridge/crypto.server";
import { getShopifyAuth } from "@/lib/bridge/auth.server";
import {
  shopifyCreateCustomDraftOrder,
  type CustomLineItemInput,
} from "@/lib/bridge/shopify.server";
import { pickPrdCode } from "@/lib/bridge/prd-pool";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Bridge-Api-Key",
  "Access-Control-Max-Age": "86400",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

const Body = z.object({
  store_id: z.string().min(1),
  shop_domain: z.string().max(255).nullable().optional(),
  integration_type: z.enum(["shopify", "native_bridge"]),
  items: z
    .array(
      z.object({
        product_id: z.string().max(200).optional(),
        product_slug: z.string().min(1).max(200),
        source_product_id: z.string().max(200).optional(),
        source_product_ref: z.string().max(200).optional(),
        external_ref: z.string().max(200).optional(),
        variant_label: z.string().max(200).optional(),
        quantity: z.number().int().min(1).max(50),
        unit_price: z.number().positive().max(1_000_000).optional(),
      })
    )
    .max(20)
    .default([]),
  currency: z.string().length(3).optional(),
  locale: z.string().max(20).optional(),
  language: z.string().max(10).optional(),
  country: z.string().max(3).optional(),
  accept_language: z.string().max(200).optional(),
  session_id: z.string().max(120).optional(),
  warmup: z.boolean().optional(),
}).strip();

function extractApiKey(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth) {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }
  const x = request.headers.get("x-bridge-api-key");
  return x ? x.trim() : null;
}

const PRODUCT_SELECT = "id, slug, prd_code, title, price, currency, source_store_id, source_product_ref, bridge_store_id, whop_product_id, whop_plan_id, shopify_product_id";

type CheckoutItem = z.infer<typeof Body>["items"][number];
type ResolvedProduct = {
  id: string;
  slug: string;
  prd_code: string;
  title: string;
  price: number | null;
  currency: string | null;
  source_store_id?: string | null;
  source_product_ref?: string | null;
  bridge_store_id?: string | null;
  whop_product_id?: string | null;
  whop_plan_id?: string | null;
  shopify_product_id?: string | null;
};

function uniq(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((v) => v?.trim()).filter(Boolean) as string[]));
}

async function findProductForNativeCheckout(siteAStoreId: string, item: CheckoutItem): Promise<ResolvedProduct | null> {
  const candidates = uniq([
    item.product_id,
    item.product_slug,
    item.source_product_id,
    item.source_product_ref,
    item.external_ref,
  ]);

  for (const candidate of candidates) {
    const fields = ["source_product_ref", "slug", "prd_code"] as const;
    for (const field of fields) {
      const value = field === "prd_code" ? candidate.toUpperCase() : candidate;
      const scoped = await supabaseAdmin
        .from("shop_products")
        .select(PRODUCT_SELECT)
        .eq("source_store_id", siteAStoreId)
        .eq(field, value)
        .maybeSingle();
      if (scoped.data) return scoped.data as ResolvedProduct;

      const global = await supabaseAdmin
        .from("shop_products")
        .select(PRODUCT_SELECT)
        .eq(field, value)
        .maybeSingle();
      if (global.data) return global.data as ResolvedProduct;
    }
  }

  if (typeof item.unit_price === "number") {
    const byPrice = await supabaseAdmin
      .from("shop_products")
      .select(PRODUCT_SELECT)
      .eq("source_store_id", siteAStoreId)
      .eq("price", item.unit_price)
      .limit(2);
    if ((byPrice.data ?? []).length === 1) return byPrice.data![0] as ResolvedProduct;
  }

  const onlyProduct = await supabaseAdmin
    .from("shop_products")
    .select(PRODUCT_SELECT)
    .eq("source_store_id", siteAStoreId)
    .limit(2);
  if ((onlyProduct.data ?? []).length === 1) return onlyProduct.data![0] as ResolvedProduct;

  return null;
}

async function enrichNativeCheckoutItems(siteAStoreId: string, items: CheckoutItem[]) {
  return Promise.all(items.map(async (item) => {
    const product = await findProductForNativeCheckout(siteAStoreId, item);
    if (!product) return item;

    const { data: variants } = await supabaseAdmin
      .from("shop_variants")
      .select("id, sku, label, price_override, shopify_variant_label, sort_order")
      .eq("product_id", product.id)
      .order("sort_order", { ascending: true })
      .limit(20);
    const variant =
      (item.variant_label && (variants ?? []).find((v) => v.label === item.variant_label || v.shopify_variant_label === item.variant_label)) ||
      (item.external_ref && (variants ?? []).find((v) => v.sku?.includes(item.external_ref ?? ""))) ||
      (variants ?? [])[0] ||
      null;

    return {
      ...item,
      original_product_slug: item.product_slug,
      product_id: product.id,
      product_slug: product.slug,
      prd_code: product.prd_code,
      source_product_ref: product.source_product_ref ?? null,
      variant_id: variant?.id ?? null,
      variant_label: variant?.label ?? item.variant_label ?? null,
      unit_price: item.unit_price ?? Number(variant?.price_override ?? product.price ?? 0),
      checkout_target: product.whop_plan_id ? "whop" : product.shopify_product_id ? "shopify" : "demo",
    };
  }));
}

async function logShadow(entry: {
  site_a_store_id: string | null;
  integration_type: string | null;
  outcome: string;
  items: unknown;
  redirect_url?: string | null;
  error?: string | null;
  duration_ms: number;
  warmup: boolean;
  ip?: string | null;
}) {
  try {
    await supabaseAdmin.from("shadow_checkout_log").insert({
      site_a_store_id: entry.site_a_store_id,
      integration_type: entry.integration_type,
      outcome: entry.outcome,
      items: (entry.items ?? []) as never,
      redirect_url: entry.redirect_url ?? null,
      error: entry.error ?? null,
      duration_ms: entry.duration_ms,
      warmup: entry.warmup,
      ip: entry.ip ?? null,
    });
  } catch (e) {
    console.error("[generate-checkout] log failed", e);
  }
}

export const Route = createFileRoute("/api/generate-checkout")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const t0 = Date.now();
        const ip =
          request.headers.get("cf-connecting-ip") ||
          request.headers.get("x-forwarded-for") ||
          null;
        const apiKey = extractApiKey(request);

        // Parse body
        let body: z.infer<typeof Body>;
        try {
          body = Body.parse(await request.json());
        } catch (e) {
          const msg = e instanceof Error ? e.message : "invalid_body";
          await logShadow({
            site_a_store_id: null,
            integration_type: null,
            outcome: "invalid_body",
            items: [],
            error: msg,
            duration_ms: Date.now() - t0,
            warmup: false,
            ip,
          });
          return json(400, { ok: false, error: "invalid_body" });
        }

        // Lookup store
        const { data: store, error: storeErr } = await supabaseAdmin
          .from("bridge_stores")
          .select("*")
          .eq("site_a_store_id", body.store_id)
          .maybeSingle();

        if (storeErr) {
          await logShadow({
            site_a_store_id: body.store_id,
            integration_type: body.integration_type,
            outcome: "error",
            items: body.items,
            error: storeErr.message,
            duration_ms: Date.now() - t0,
            warmup: !!body.warmup,
            ip,
          });
          return json(500, { ok: false, error: "internal_error" });
        }

        if (!store || !apiKey) {
          await logShadow({
            site_a_store_id: body.store_id,
            integration_type: body.integration_type,
            outcome: "invalid_api_key",
            items: body.items,
            error: !store ? "store_not_found" : "missing_api_key",
            duration_ms: Date.now() - t0,
            warmup: !!body.warmup,
            ip,
          });
          return json(401, { ok: false, error: "invalid_api_key" });
        }

        // Timing-safe API key check
        const receivedHash = await sha256Hex(apiKey);
        const expectedHash = store.bridge_api_key_hash ?? "";
        if (!expectedHash || !safeEqual(expectedHash, receivedHash)) {
          await logShadow({
            site_a_store_id: body.store_id,
            integration_type: body.integration_type,
            outcome: "invalid_api_key",
            items: body.items,
            error: "hash_mismatch",
            duration_ms: Date.now() - t0,
            warmup: !!body.warmup,
            ip,
          });
          return json(401, { ok: false, error: "invalid_api_key" });
        }

        if (!store.is_active) {
          await logShadow({
            site_a_store_id: body.store_id,
            integration_type: body.integration_type,
            outcome: "store_disabled",
            items: body.items,
            duration_ms: Date.now() - t0,
            warmup: !!body.warmup,
            ip,
          });
          return json(403, { ok: false, error: "store_disabled" });
        }

        const currency = (body.currency ?? "EUR").toUpperCase();
        const locale =
          body.locale ??
          (body.language && body.country
            ? `${body.language}-${body.country.toUpperCase()}`
            : body.language) ??
          "en";

        // Warmup: pre-risolvi prodotti senza creare checkout
        if (body.warmup) {
          try {
            const slugs = body.items.map((i) => i.product_slug);
            await supabaseAdmin
              .from("shop_products")
              .select("id, slug, title, price")
              .in("slug", slugs);
            await logShadow({
              site_a_store_id: body.store_id,
              integration_type: body.integration_type,
              outcome: "warmed",
              items: body.items,
              duration_ms: Date.now() - t0,
              warmup: true,
              ip,
            });
            return json(200, { ok: true, warmed: true });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            await logShadow({
              site_a_store_id: body.store_id,
              integration_type: body.integration_type,
              outcome: "warmup_error",
              items: body.items,
              error: msg,
              duration_ms: Date.now() - t0,
              warmup: true,
              ip,
            });
            return json(500, { ok: false, error: "warmup_failed" });
          }
        }

        // Checkout reale: gli items sono obbligatori (per il warmup invece possono mancare)
        if (body.items.length === 0) {
          return json(400, { ok: false, error: "no_items" });
        }

        // === SHOPIFY ===
        if (body.integration_type === "shopify") {
          try {
            const auth = await getShopifyAuth(store);
            const customItems: CustomLineItemInput[] = body.items.map((it, idx) => {
              const prdCode = it.product_slug.match(/^prd-[a-z0-9]+$/i)
                ? it.product_slug.toUpperCase()
                : pickPrdCode(`${body.session_id ?? ""}-${idx}-${it.product_slug}`);
              return {
                title: prdCode,
                sku: prdCode,
                price: typeof it.unit_price === "number" ? it.unit_price : 0,
                quantity: it.quantity,
                variant_property_label: it.variant_label ?? null,
              };
            });

            const draft = await shopifyCreateCustomDraftOrder(auth, {
              items: customItems,
              currency,
              locale,
              metadata: {
                tags: null,
                note: `bridge:${body.session_id ?? ""}`,
                note_attributes: [
                  { name: "site_a_store_id", value: store.site_a_store_id },
                  { name: "locale", value: locale },
                  { name: "currency", value: currency },
                ],
              },
            });

            let redirect = draft.invoice_url;
            try {
              const u = new URL(redirect);
              u.searchParams.set("locale", locale);
              redirect = u.toString();
            } catch { /* keep */ }

            await logShadow({
              site_a_store_id: body.store_id,
              integration_type: "shopify",
              outcome: "ok",
              items: body.items,
              redirect_url: redirect,
              duration_ms: Date.now() - t0,
              warmup: false,
              ip,
            });
            return json(200, { ok: true, redirect_url: redirect });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            const m = msg.match(/\b(401|403|404|422|429|5\d\d)\b/);
            const upstream = m ? Number(m[1]) : 502;
            await logShadow({
              site_a_store_id: body.store_id,
              integration_type: "shopify",
              outcome: "shopify_error",
              items: body.items,
              error: msg,
              duration_ms: Date.now() - t0,
              warmup: false,
              ip,
            });
            return json(upstream >= 500 ? 502 : upstream, {
              ok: false,
              error: "shopify_error",
            });
          }
        }

        // === NATIVE BRIDGE ===
        try {
          const enrichedItems = await enrichNativeCheckoutItems(body.store_id, body.items);
          const amount_total = enrichedItems.reduce(
            (acc, it) => acc + (it.unit_price ?? 0) * it.quantity,
            0
          );

          const { data: session, error: insErr } = await supabaseAdmin
            .from("native_checkout_sessions")
            .insert({
              site_a_store_id: body.store_id,
              bridge_store_id: store.id,
              items: enrichedItems as never,
              currency,
              amount_total,
              locale,
              country: body.country ?? null,
              status: "pending",
              metadata: {
                session_id: body.session_id ?? null,
                accept_language: body.accept_language ?? null,
              } as never,
            })
            .select("id")
            .single();

          if (insErr || !session) {
            throw new Error(insErr?.message ?? "session_insert_failed");
          }

          const origin = new URL(request.url).origin;
          const redirect = `${origin}/shop/checkout/demo?session=${session.id}`;

          await supabaseAdmin
            .from("native_checkout_sessions")
            .update({ redirect_url: redirect, updated_at: new Date().toISOString() })
            .eq("id", session.id);

          await logShadow({
            site_a_store_id: body.store_id,
            integration_type: "native_bridge",
            outcome: "ok",
            items: enrichedItems,
            redirect_url: redirect,
            duration_ms: Date.now() - t0,
            warmup: false,
            ip,
          });

          return json(200, { ok: true, redirect_url: redirect, session_id: session.id });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await logShadow({
            site_a_store_id: body.store_id,
            integration_type: "native_bridge",
            outcome: "native_error",
            items: body.items,
            error: msg,
            duration_ms: Date.now() - t0,
            warmup: false,
            ip,
          });
          return json(500, { ok: false, error: "native_checkout_failed" });
        }
      },
    },
  },
});
