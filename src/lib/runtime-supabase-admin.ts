import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { SHARED_SUPABASE_URL, SHARED_SUPABASE_PUBLISHABLE_KEY } from "@/lib/supabase-shared";

type RuntimeWindow = Window & {
  __PONTE_SUPABASE_ENV__?: { url?: string; publishableKey?: string };
  process?: { env?: Record<string, string | undefined> };
};

function readPublicEnv() {
  const win = typeof window === "undefined" ? null : (window as RuntimeWindow);
  const browserEnv = win?.process?.env ?? {};
  const serverEnv = typeof process === "undefined" ? {} : process.env;
  const workerEnv = (globalThis as { __PONTE_WORKER_ENV__?: Record<string, unknown> }).__PONTE_WORKER_ENV__ ?? {};
  const buildEnv = import.meta.env ?? {};
  const serviceRoleKey =
    typeof window === "undefined"
      ? serverEnv.SUPABASE_SERVICE_ROLE_KEY ||
        (workerEnv.SUPABASE_SERVICE_ROLE_KEY as string | undefined) ||
        (buildEnv.SUPABASE_SERVICE_ROLE_KEY as string | undefined)
      : undefined;
  return {
    url:
      serverEnv.SUPABASE_URL ||
      serverEnv.VITE_SUPABASE_URL ||
      (workerEnv.SUPABASE_URL as string | undefined) ||
      (workerEnv.VITE_SUPABASE_URL as string | undefined) ||
      (buildEnv.SUPABASE_URL as string | undefined) ||
      (buildEnv.VITE_SUPABASE_URL as string | undefined) ||
      browserEnv.SUPABASE_URL ||
      browserEnv.VITE_SUPABASE_URL ||
      win?.__PONTE_SUPABASE_ENV__?.url ||
      SHARED_SUPABASE_URL,
    publishableKey:
      serviceRoleKey ||
      serverEnv.SUPABASE_PUBLISHABLE_KEY ||
      serverEnv.VITE_SUPABASE_PUBLISHABLE_KEY ||
      (workerEnv.SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
      (workerEnv.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
      (buildEnv.SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
      (buildEnv.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
      browserEnv.SUPABASE_PUBLISHABLE_KEY ||
      browserEnv.VITE_SUPABASE_PUBLISHABLE_KEY ||
      win?.__PONTE_SUPABASE_ENV__?.publishableKey ||
      SHARED_SUPABASE_PUBLISHABLE_KEY,
  };
}

function currentAuthorizationHeader(): string | null {
  return typeof process === "undefined" ? null : process.env.PONTE_RUNTIME_AUTHORIZATION || null;
}

let cachedClient: SupabaseClient<Database> | null = null;
let cachedKey = "";

function getRuntimeClient(): SupabaseClient<Database> {
  const { url, publishableKey } = readPublicEnv();
  const key = publishableKey;

  if (!url || !key) {
    const missing = [
      ...(!url ? ["SUPABASE_URL"] : []),
      ...(!key ? ["SUPABASE_PUBLISHABLE_KEY"] : []),
    ];
    throw new Error(
      `Missing Supabase environment variable(s): ${missing.join(", ")}. Connect Supabase in Lovable Cloud.`,
    );
  }

  const authHeader = currentAuthorizationHeader();
  const cacheKey = `${url}|${key}|${authHeader ?? ""}`;
  if (cachedClient && cachedKey === cacheKey) return cachedClient;

  cachedClient = createClient<Database>(url, key, {
    global: authHeader ? { headers: { Authorization: authHeader } } : undefined,
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  cachedKey = cacheKey;
  return cachedClient;
}

export function debugRuntimeSupabaseConfig() {
  const { url, publishableKey } = readPublicEnv();
  const keyStr = typeof publishableKey === "string" ? publishableKey : "";
  return {
    url: url ?? "(missing)",
    keyPrefix: keyStr ? keyStr.slice(0, 12) : "(missing)",
    keyLen: keyStr.length,
    keyKind: keyStr.startsWith("sb_secret_") ? "sb_secret" : keyStr.startsWith("sb_publishable_") ? "sb_publishable" : keyStr.startsWith("eyJ") ? "jwt" : "unknown",
  };
}

export const supabaseAdmin = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop) {
    const client = getRuntimeClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
