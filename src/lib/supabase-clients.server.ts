// Factory di client Supabase per separare:
//  - EXTERNAL DB → bridge ops (handshake / get-config / update-config / checkout)
//  - LOVABLE CLOUD → solo /sync-product
//
// Le credenziali EXTERNAL si configurano da admin (Ponte → DB Esterno) e
// vengono salvate nella tabella `external_db_config` su Lovable Cloud.
// Fallback automatico alle env vars EXTERNAL_SUPABASE_* se la riga DB è vuota.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function readEnv(name: string): string | undefined {
  const fromProcess = typeof process === "undefined" ? undefined : process.env?.[name];
  if (fromProcess) return fromProcess;
  const workerEnv = (globalThis as { __PONTE_WORKER_ENV__?: Record<string, unknown> }).__PONTE_WORKER_ENV__;
  const fromWorker = workerEnv?.[name];
  if (typeof fromWorker === "string" && fromWorker) return fromWorker;
  const fromBuild = import.meta.env?.[name];
  return typeof fromBuild === "string" && fromBuild ? fromBuild : undefined;
}

// ---------- Lovable Cloud (servizio interno: /sync-product, admin, settings) ----------
let _lovableCloud: SupabaseClient<Database> | null = null;
export function getLovableCloud(): SupabaseClient<Database> {
  if (_lovableCloud) return _lovableCloud;
  const url = readEnv("SUPABASE_URL");
  const key = readEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url) throw new Error("Missing environment variable: SUPABASE_URL (Lovable Cloud)");
  if (!key) throw new Error("Missing environment variable: SUPABASE_SERVICE_ROLE_KEY (Lovable Cloud)");
  _lovableCloud = createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  return _lovableCloud;
}

// ---------- Cache config DB esterno ----------
type ExternalCfg = { url: string; serviceRoleKey: string; publishableKey: string | null; source: "db" | "env" };
let _cfg: ExternalCfg | null = null;
let _cfgAt = 0;
const CACHE_TTL_MS = 30_000;

export function invalidateExternalConfigCache() {
  _cfg = null;
  _cfgAt = 0;
  _externalAdmin = null;
  _externalAdminKey = "";
  _externalPublic = null;
  _externalPublicKey = "";
}

async function loadExternalConfig(): Promise<ExternalCfg> {
  if (_cfg && Date.now() - _cfgAt < CACHE_TTL_MS) return _cfg;

  let url: string | null = null;
  let serviceRoleKey: string | null = null;
  let publishableKey: string | null = null;
  let source: "db" | "env" = "env";

  // 1) Leggi dalla tabella external_db_config su Lovable Cloud
  try {
    const lc = getLovableCloud();
    const { data } = await lc
      .from("external_db_config")
      .select("external_url, external_service_role_key, external_publishable_key")
      .eq("id", "default")
      .maybeSingle();
    if (data) {
      const row = data as { external_url: string | null; external_service_role_key: string | null; external_publishable_key: string | null };
      url = row.external_url || null;
      serviceRoleKey = row.external_service_role_key || null;
      publishableKey = row.external_publishable_key || null;
      if (url && serviceRoleKey) source = "db";
    }
  } catch (e) {
    console.warn("[supabase-clients] cannot read external_db_config, falling back to env vars", e instanceof Error ? e.message : String(e));
  }

  // 2) Fallback env vars
  if (!url) url = readEnv("EXTERNAL_SUPABASE_URL") || readEnv("SUPABASE_URL") || null;
  if (!serviceRoleKey) serviceRoleKey = readEnv("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") || readEnv("SUPABASE_SERVICE_ROLE_KEY") || null;
  if (!publishableKey) publishableKey = readEnv("EXTERNAL_SUPABASE_PUBLISHABLE_KEY") || readEnv("SUPABASE_PUBLISHABLE_KEY") || null;

  if (!url) {
    throw new Error("Missing external DB config: external_url — configura da admin (Ponte → DB Esterno) oppure imposta EXTERNAL_SUPABASE_URL");
  }
  if (!serviceRoleKey) {
    throw new Error("Missing external DB config: external_service_role_key — configura da admin (Ponte → DB Esterno) oppure imposta EXTERNAL_SUPABASE_SERVICE_ROLE_KEY");
  }

  _cfg = { url, serviceRoleKey, publishableKey, source };
  _cfgAt = Date.now();
  return _cfg;
}

// ---------- External admin (service role, bypass RLS) ----------
let _externalAdmin: SupabaseClient<Database> | null = null;
let _externalAdminKey = "";
export async function getExternalSupabase(): Promise<SupabaseClient<Database>> {
  const cfg = await loadExternalConfig();
  const key = `${cfg.url}|${cfg.serviceRoleKey}`;
  if (_externalAdmin && _externalAdminKey === key) return _externalAdmin;
  _externalAdmin = createClient<Database>(cfg.url, cfg.serviceRoleKey, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  _externalAdminKey = key;
  return _externalAdmin;
}

// ---------- External pubblico (publishable, RLS attiva) ----------
let _externalPublic: SupabaseClient<Database> | null = null;
let _externalPublicKey = "";
export async function getExternalSupabasePublic(): Promise<SupabaseClient<Database>> {
  const cfg = await loadExternalConfig();
  if (!cfg.publishableKey) {
    throw new Error("Missing external DB config: external_publishable_key — configura da admin (Ponte → DB Esterno) oppure imposta EXTERNAL_SUPABASE_PUBLISHABLE_KEY");
  }
  const key = `${cfg.url}|${cfg.publishableKey}`;
  if (_externalPublic && _externalPublicKey === key) return _externalPublic;
  _externalPublic = createClient<Database>(cfg.url, cfg.publishableKey, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  _externalPublicKey = key;
  return _externalPublic;
}

export async function getExternalConfigStatus(): Promise<{
  configured: boolean;
  source: "db" | "env" | "missing";
  url: string | null;
  has_service_role: boolean;
  has_publishable: boolean;
}> {
  try {
    const cfg = await loadExternalConfig();
    return {
      configured: true,
      source: cfg.source,
      url: cfg.url,
      has_service_role: !!cfg.serviceRoleKey,
      has_publishable: !!cfg.publishableKey,
    };
  } catch {
    return { configured: false, source: "missing", url: null, has_service_role: false, has_publishable: false };
  }
}
