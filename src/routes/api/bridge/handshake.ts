// POST /api/bridge/handshake — handshake pubblico Sito A → Sito B.
// Auth: Authorization: Bearer <key>  (fallback X-Bridge-Api-Key).
// Confronto in tempo costante contro bridge_stores.bridge_api_key_hash.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/runtime-supabase-admin";
import { safeEqual, sha256Hex } from "@/lib/bridge/crypto.server";

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
  store_id: z.string().uuid(),
  shop_domain: z.string().max(255).nullable().optional(),
  integration_type: z.enum(["shopify", "native_bridge"]),
}).strip();

function fail(status: number, error: string, step: string, details: Record<string, unknown> = {}) {
  return json(status, { ok: false, error, step, details });
}

function readRuntimeEnv(name: string): string | undefined {
  const fromProcess = typeof process === "undefined" ? undefined : process.env?.[name];
  if (fromProcess) return fromProcess;
  const workerEnv = (globalThis as { __PONTE_WORKER_ENV__?: Record<string, unknown> }).__PONTE_WORKER_ENV__;
  const fromWorker = workerEnv?.[name];
  return typeof fromWorker === "string" && fromWorker ? fromWorker : undefined;
}

function assertHandshakeRuntimeEnv() {
  const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((name) => !readRuntimeEnv(name));
  if (missing.length) {
    throw new Error(`Missing runtime environment variable(s): ${missing.join(", ")}`);
  }
}

function extractApiKey(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (auth) {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }
  const x = request.headers.get("x-bridge-api-key") ?? request.headers.get("X-Bridge-Api-Key");
  return x ? x.trim() : null;
}

async function log(entry: {
  site_a_store_id: string | null;
  shop_domain: string | null;
  integration_type: string | null;
  outcome: "ok" | "invalid_api_key" | "store_not_registered" | "invalid_body" | "error";
  reason?: string | null;
  ip?: string | null;
  user_agent?: string | null;
}) {
  try {
    await supabaseAdmin.from("bridge_handshake_log").insert({
      site_a_store_id: entry.site_a_store_id,
      shop_domain: entry.shop_domain,
      integration_type: entry.integration_type,
      outcome: entry.outcome,
      reason: entry.reason ?? null,
      ip: entry.ip ?? null,
      user_agent: entry.user_agent ?? null,
    });
  } catch (e) {
    console.error("[handshake] log failed", e);
  }
}

export const Route = createFileRoute("/api/bridge/handshake")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        try {
          console.info("[bridge-handshake] /api/bridge/handshake received", { content_type: request.headers.get("content-type") });
          try {
            assertHandshakeRuntimeEnv();
          } catch (e) {
            console.error("[bridge-handshake] environment validation failed", e);
            return fail(500, e instanceof Error ? e.message : String(e), "environment_validation", {
              missing: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((name) => !readRuntimeEnv(name)),
            });
          }

          const ip =
            request.headers.get("cf-connecting-ip") ||
            request.headers.get("x-forwarded-for") ||
            null;
          const ua = request.headers.get("user-agent");
          const apiKey = extractApiKey(request);

          let raw: unknown;
          try {
            raw = await request.json();
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            console.error("[bridge-handshake] body parsing failed", e);
            await log({ site_a_store_id: null, shop_domain: null, integration_type: null, outcome: "invalid_body", reason: message, ip, user_agent: ua });
            return fail(400, "Invalid JSON body", "body_parsing", { message });
          }

          const parsed = Body.safeParse(raw);
          if (!parsed.success) {
            console.error("[bridge-handshake] body validation failed", parsed.error.issues);
            await log({ site_a_store_id: null, shop_domain: null, integration_type: null, outcome: "invalid_body", reason: parsed.error.message, ip, user_agent: ua });
            return fail(400, "Invalid handshake body", "body_validation", { issues: parsed.error.issues });
          }
          const body = parsed.data;

          const { data: store, error } = await supabaseAdmin
            .from("bridge_stores")
            .select("id, site_a_store_id, bridge_api_key_hash, is_active")
            .eq("site_a_store_id", body.store_id)
            .maybeSingle();

          if (error) {
            console.error("[bridge-handshake] database lookup failed", error);
            await log({ site_a_store_id: body.store_id, shop_domain: body.shop_domain ?? null, integration_type: body.integration_type, outcome: "error", reason: error.message, ip, user_agent: ua });
            return fail(500, "Database lookup failed", "database_lookup", { table: "bridge_stores", query: "select id, site_a_store_id, bridge_api_key_hash, is_active by site_a_store_id", message: error.message, code: error.code, details: error.details, hint: error.hint });
          }

          if (!store) {
            console.error("[bridge-handshake] store not registered", { store_id: body.store_id });
            await log({ site_a_store_id: body.store_id, shop_domain: body.shop_domain ?? null, integration_type: body.integration_type, outcome: "store_not_registered", ip, user_agent: ua });
            return fail(404, "store_not_registered", "store_lookup", { store_id: body.store_id });
          }

          if (!apiKey) {
            console.error("[bridge-handshake] API key missing", { store_id: body.store_id });
            await log({ site_a_store_id: body.store_id, shop_domain: body.shop_domain ?? null, integration_type: body.integration_type, outcome: "invalid_api_key", reason: "missing", ip, user_agent: ua });
            return fail(401, "invalid_api_key", "api_key_validation", { reason: "missing", accepted_headers: ["Authorization: Bearer", "X-Bridge-Api-Key"] });
          }

          const receivedHash = await sha256Hex(apiKey);
          const expectedHash = store.bridge_api_key_hash ?? "";
          if (!expectedHash || !safeEqual(expectedHash, receivedHash)) {
            console.error("[bridge-handshake] API key mismatch", { store_id: body.store_id, received_hash_prefix: receivedHash.slice(0, 12), expected_hash_prefix: expectedHash.slice(0, 12) });
            await log({ site_a_store_id: body.store_id, shop_domain: body.shop_domain ?? null, integration_type: body.integration_type, outcome: "invalid_api_key", reason: "hash_mismatch", ip, user_agent: ua });
            return fail(401, "invalid_api_key", "api_key_validation", { reason: "hash_mismatch" });
          }

          if (!store.is_active) {
            console.error("[bridge-handshake] store disabled", { store_id: body.store_id });
            await log({ site_a_store_id: body.store_id, shop_domain: body.shop_domain ?? null, integration_type: body.integration_type, outcome: "error", reason: "store_disabled", ip, user_agent: ua });
            return fail(403, "store_disabled", "store_status", { is_active: false });
          }

          await log({ site_a_store_id: body.store_id, shop_domain: body.shop_domain ?? null, integration_type: body.integration_type, outcome: "ok", ip, user_agent: ua });

          return json(200, {
            ok: true,
            status: "connected",
            message: "Bridge handshake OK",
          });
        } catch (e) {
          console.error("[bridge-handshake] unhandled exception", e);
          return fail(500, e instanceof Error ? e.message : String(e), "unhandled_exception", {});
        }
      },
    },
  },
});
