import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/runtime-supabase-admin";
import { decryptString, hmacSha256Hex, safeEqual } from "@/lib/bridge/crypto.server";

async function loadConfig() {
  const { data } = await supabaseAdmin
    .from("lovable_sync_config" as never)
    .select("api_key_encrypted,hmac_secret_encrypted,enabled")
    .eq("singleton", true)
    .maybeSingle();
  if (!data) return null;
  const row = data as { api_key_encrypted: string | null; hmac_secret_encrypted: string | null; enabled: boolean };
  let api_key: string | null = null;
  let hmac_secret: string | null = null;
  if (row.api_key_encrypted) { try { api_key = await decryptString(row.api_key_encrypted); } catch { /* ignore */ } }
  if (row.hmac_secret_encrypted) { try { hmac_secret = await decryptString(row.hmac_secret_encrypted); } catch { /* ignore */ } }
  return { api_key, hmac_secret, enabled: row.enabled };
}

const ProductSchema = z.object({
  store_ref: z.string().min(1).max(255),
  external_id: z.string().min(1).max(255),
  title: z.string().min(1).max(500),
  slug: z.string().max(255).optional().nullable(),
  description_short: z.string().max(2000).optional().nullable(),
  description_long: z.string().max(20000).optional().nullable(),
  price: z.number().nonnegative().optional().nullable(),
  compare_price: z.number().nonnegative().optional().nullable(),
  currency: z.string().max(8).optional(),
  locale: z.string().max(10).optional(),
  images: z.array(z.any()).max(50).optional(),
  variants: z.array(z.any()).max(200).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  status: z.string().max(32).optional(),
});

export const Route = createFileRoute("/api/public/lovable-sync/push-product")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const cfg = await loadConfig();
        if (!cfg || !cfg.enabled || !cfg.api_key) {
          return new Response(JSON.stringify({ ok: false, error: "not_configured" }), { status: 503, headers: { "Content-Type": "application/json" } });
        }
        const apiKey = request.headers.get("x-lovable-sync-key") ?? "";
        if (!safeEqual(apiKey, cfg.api_key)) {
          return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
        }
        const raw = await request.text();
        if (cfg.hmac_secret) {
          const sig = (request.headers.get("x-lovable-sync-signature") ?? "").trim().replace(/^sha256=/i, "").toLowerCase();
          const expected = await hmacSha256Hex(cfg.hmac_secret, raw);
          if (!safeEqual(sig, expected)) {
            return new Response(JSON.stringify({ ok: false, error: "bad_signature" }), { status: 401, headers: { "Content-Type": "application/json" } });
          }
        }
        let payload: unknown;
        try { payload = JSON.parse(raw); } catch {
          return new Response(JSON.stringify({ ok: false, error: "invalid_json" }), { status: 400, headers: { "Content-Type": "application/json" } });
        }
        const parsed = ProductSchema.safeParse(payload);
        if (!parsed.success) {
          return new Response(JSON.stringify({ ok: false, error: "validation", issues: parsed.error.issues }), { status: 422, headers: { "Content-Type": "application/json" } });
        }
        const p = parsed.data;
        const { data, error } = await supabaseAdmin
          .from("lovable_synced_products" as never)
          .upsert({
            store_ref: p.store_ref,
            external_id: p.external_id,
            source: "lovable-sync",
            title: p.title,
            slug: p.slug ?? null,
            description_short: p.description_short ?? null,
            description_long: p.description_long ?? null,
            price: p.price ?? null,
            compare_price: p.compare_price ?? null,
            currency: p.currency ?? "EUR",
            locale: p.locale ?? "it",
            images: p.images ?? [],
            variants: p.variants ?? [],
            metadata: p.metadata ?? {},
            status: p.status ?? "active",
            updated_at: new Date().toISOString(),
          } as never, { onConflict: "store_ref,external_id" })
          .select("id")
          .single();
        if (error) {
          return new Response(JSON.stringify({ ok: false, error: "db_error", detail: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
        }
        return Response.json({ ok: true, id: (data as { id: string }).id, external_id: p.external_id });
      },
    },
  },
});
