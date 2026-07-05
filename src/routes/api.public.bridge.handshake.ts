import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { corsPreflight, httpError, jsonResponse } from "@/lib/bridge/auth.server";
import { sha256Hex } from "@/lib/bridge/crypto.server";

// Sito A invia SOLO store_id. La mappatura store_id → shop_domain è interna al Sito B.
const Body = z.object({
  store_id: z.string().uuid(),
  callback_url: z.string().url().max(500).optional(),
}).strip();

function readRuntimeEnv(name: string): string | undefined {
  const fromProcess = typeof process === "undefined" ? undefined : process.env?.[name];
  if (fromProcess) return fromProcess;
  const workerEnv = (globalThis as { __PONTE_WORKER_ENV__?: Record<string, unknown> }).__PONTE_WORKER_ENV__;
  const fromWorker = workerEnv?.[name];
  if (typeof fromWorker === "string" && fromWorker) return fromWorker;
  const fromBuild = import.meta.env?.[name];
  return typeof fromBuild === "string" && fromBuild ? fromBuild : undefined;
}

function getHandshakeRuntimeEnv() {
  const url = readRuntimeEnv("SUPABASE_URL") || readRuntimeEnv("VITE_SUPABASE_URL");
  const publishableKey = readRuntimeEnv("SUPABASE_PUBLISHABLE_KEY") || readRuntimeEnv("VITE_SUPABASE_PUBLISHABLE_KEY");
  const missing = [
    ...(!url ? ["SUPABASE_URL"] : []),
    ...(!publishableKey ? ["SUPABASE_PUBLISHABLE_KEY"] : []),
  ];
  if (missing.length) {
    throw httpError(500, `Missing runtime environment variable(s): ${missing.join(", ")}`, "environment_validation", { missing });
  }
  return { url: url!, publishableKey: publishableKey! };
}

function extractApiKey(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? request.headers.get("Authorization");
  const bearer = auth?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return bearer || request.headers.get("x-bridge-api-key")?.trim() || request.headers.get("X-Bridge-Api-Key")?.trim() || null;
}

export const Route = createFileRoute("/api/public/bridge/handshake")({
  server: {
    handlers: {
      OPTIONS: async () => corsPreflight(),
      POST: async ({ request }) => {
        const endpoint = "/api/public/bridge/handshake";
        try {
          console.info(`[bridge-handshake] ${endpoint} received`, { content_type: request.headers.get("content-type") });
          const { url, publishableKey } = getHandshakeRuntimeEnv();

          const apiKey = extractApiKey(request);
          if (!apiKey) {
            throw httpError(401, "Missing bridge API key", "api_key_validation", { header: "X-Bridge-Api-Key or Authorization: Bearer" });
          }
          let raw: unknown;
          try {
            raw = await request.json();
          } catch (parseError) {
            throw httpError(400, "Invalid JSON body", "body_parsing", { message: parseError instanceof Error ? parseError.message : String(parseError) });
          }

          const parsed = Body.safeParse(raw);
          if (!parsed.success) {
            throw httpError(400, "Invalid handshake body", "body_validation", { issues: parsed.error.issues });
          }
          const body = parsed.data;
          const supabase = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
          const { data, error } = await (supabase as any).rpc("bridge_handshake", {
            _store_id: body.store_id,
            _api_key_hash: await sha256Hex(apiKey),
            _shop_domain: null,
            _integration_type: "native_bridge",
            _callback_url: body.callback_url ?? null,
            _ip: request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || null,
            _user_agent: request.headers.get("user-agent"),
          });
          if (error) throw httpError(500, "Database handshake failed", "database_handshake", { message: error.message, code: error.code, details: error.details, hint: error.hint });

          const payload = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
          const status = typeof payload.status === "number" ? payload.status : payload.ok === true ? 200 : 500;
          const responseBody = { ...payload };
          delete responseBody.status;
          return jsonResponse(responseBody, { status });
        } catch (e) {
          const status = e instanceof Error && "status" in e && typeof e.status === "number" ? e.status : 500;
          const step = e instanceof Error && "step" in e && typeof e.step === "string" ? e.step : "unhandled_exception";
          const details = e instanceof Error && "details" in e && e.details && typeof e.details === "object" ? e.details : {};
          return jsonResponse({ ok: false, error: e instanceof Error ? e.message : String(e), step, details }, { status });
        }
      },
    },
  },
});
