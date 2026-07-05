import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { SHARED_SUPABASE_URL, SHARED_SUPABASE_PUBLISHABLE_KEY } from "@/lib/supabase-shared";

type RuntimeEnv = {
  url: string;
  publishableKey: string;
};

type RuntimeWindow = Window & {
  __PONTE_SUPABASE_ENV__?: Partial<RuntimeEnv>;
  process?: { env?: Record<string, string | undefined> };
};

const SAVED_CONFIG_KEY = "ponte-admin:supabase-migration-config";
const DRAFT_CONFIG_KEY = "ponte-admin:supabase-migration-draft";

let cachedEnv: RuntimeEnv | null = null;
let envPromise: Promise<RuntimeEnv> | null = null;
let cachedClient: SupabaseClient<Database> | null = null;
let cachedClientKey = "";

function hasRuntimeWindow(): RuntimeWindow | null {
  return typeof window === "undefined" ? null : (window as RuntimeWindow);
}

function fromSavedConfig(): Partial<RuntimeEnv> | null {
  const win = hasRuntimeWindow();
  if (!win) return null;
  try {
    const raw = win.localStorage.getItem(SAVED_CONFIG_KEY) ?? win.localStorage.getItem(DRAFT_CONFIG_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { url?: string; anon?: string; desiredMode?: string };
    if (saved.desiredMode !== "external") return null;
    return { url: saved.url, publishableKey: saved.anon };
  } catch {
    return null;
  }
}

function readRuntimeEnvSync(): Partial<RuntimeEnv> {
  const win = hasRuntimeWindow();
  const injected = win?.__PONTE_SUPABASE_ENV__ ?? {};
  const processEnv = win?.process?.env ?? {};
  const saved = fromSavedConfig() ?? {};

  return {
    url:
      injected.url ||
      processEnv.VITE_SUPABASE_URL ||
      processEnv.SUPABASE_URL ||
      (import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
      saved.url ||
      SHARED_SUPABASE_URL,
    publishableKey:
      injected.publishableKey ||
      processEnv.VITE_SUPABASE_PUBLISHABLE_KEY ||
      processEnv.SUPABASE_PUBLISHABLE_KEY ||
      (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
      saved.publishableKey ||
      SHARED_SUPABASE_PUBLISHABLE_KEY,
  };
}

function normalizeEnv(env: Partial<RuntimeEnv>): RuntimeEnv | null {
  const url = env.url?.trim();
  const publishableKey = env.publishableKey?.trim();
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

async function fetchRuntimeEnv(): Promise<RuntimeEnv> {
  const response = await fetch("/api/public/runtime-supabase-env", { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as Partial<RuntimeEnv> & { error?: string } | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.error || "Runtime Supabase env non disponibile");
  }
  const env = normalizeEnv(payload);
  if (!env) throw new Error("Runtime Supabase env incompleta");
  const win = hasRuntimeWindow();
  if (win) win.__PONTE_SUPABASE_ENV__ = env;
  return env;
}

export async function getRuntimeSupabaseEnv(): Promise<RuntimeEnv> {
  const syncEnv = normalizeEnv(readRuntimeEnvSync());
  if (syncEnv) {
    cachedEnv = syncEnv;
    return syncEnv;
  }
  if (cachedEnv) return cachedEnv;
  envPromise ??= fetchRuntimeEnv().then((env) => {
    cachedEnv = env;
    return env;
  });
  return envPromise;
}

export async function getRuntimeSupabaseClient(): Promise<SupabaseClient<Database>> {
  const env = await getRuntimeSupabaseEnv();
  const key = `${env.url}|${env.publishableKey}`;
  if (!cachedClient || cachedClientKey !== key) {
    cachedClient = createClient<Database>(env.url, env.publishableKey, {
      auth: {
        storage: typeof window !== "undefined" ? localStorage : undefined,
        persistSession: true,
        autoRefreshToken: true,
      },
    });
    cachedClientKey = key;
  }
  return cachedClient;
}

export function clearRuntimeSupabaseCache() {
  cachedEnv = null;
  envPromise = null;
  cachedClient = null;
  cachedClientKey = "";
}