import { createFileRoute } from "@tanstack/react-router";
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

export const Route = createFileRoute("/api/public/lovable-sync/ping")({
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
        const body = await request.text();
        if (cfg.hmac_secret) {
          const sig = (request.headers.get("x-lovable-sync-signature") ?? "").trim().replace(/^sha256=/i, "").toLowerCase();
          const expected = await hmacSha256Hex(cfg.hmac_secret, body);
          if (!safeEqual(sig, expected)) {
            return new Response(JSON.stringify({ ok: false, error: "bad_signature" }), { status: 401, headers: { "Content-Type": "application/json" } });
          }
        }
        return Response.json({ ok: true, pong: true, ts: Date.now() });
      },
    },
  },
});
