import "@/lib/error-capture";

import { createClient } from "@supabase/supabase-js";
import process from "node:process";
import { consumeLastCapturedError } from "@/lib/error-capture";
import { renderErrorPage } from "@/lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

type WorkerEnv = Record<string, unknown>;
type RuntimeGlobal = typeof globalThis & {
  process?: typeof process;
  __PONTE_WORKER_ENV__?: WorkerEnv;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry),
    );
  }
  return serverEntryPromise;
}

function brandedErrorResponse(): Response {
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function fallbackHomeResponse(_env: unknown): Response | null {
  return null;
}

function syncWorkerEnvToProcessEnv(env: unknown) {
  const runtimeGlobal = globalThis as RuntimeGlobal;
  runtimeGlobal.process = process;
  if (!env || typeof env !== "object") return;

  const workerEnv = env as WorkerEnv;
  runtimeGlobal.__PONTE_WORKER_ENV__ = workerEnv;
  for (const [key, value] of Object.entries(workerEnv)) {
    if (typeof value === "string") {
      process.env[key] = value;
    }
  }
}

function escapeJsonForHtml(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

const BRIDGE_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Bridge-Api-Key",
  "Access-Control-Max-Age": "86400",
};

function bridgeJson(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...BRIDGE_CORS_HEADERS },
  });
}

function isPushShadowProductEndpoint(pathname: string): boolean {
  return pathname === "/api/bridge/push-shadow-product" || pathname === "/api/public/bridge/push-shadow-product";
}

function isBridgeCheckoutEndpoint(pathname: string): boolean {
  return pathname === "/api/public/bridge/checkout" || pathname === "/api/public/bridge/generate-checkout";
}

const BRIDGE_WORKER_VERSION = "2026-06-18.health-v2";

const SUPABASE_URL_ENV_NAMES = ["SUPABASE_URL", "EXTERNAL_SUPABASE_URL", "VITE_SUPABASE_URL"];
const SUPABASE_SERVICE_ROLE_ENV_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "EXTERNAL_SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
  "EXTERNAL_SUPABASE_SECRET_KEY",
  "SERVICE_ROLE_KEY",
  "SUPABASE_ADMIN_KEY",
];
const SUPABASE_PUBLISHABLE_ENV_NAMES = [
  "SUPABASE_PUBLISHABLE_KEY",
  "EXTERNAL_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_ANON_KEY",
  "EXTERNAL_SUPABASE_ANON_KEY",
  "VITE_SUPABASE_ANON_KEY",
];

function extractProjectRef(url: string | undefined | null): string | null {
  if (!url) return null;
  const m = url.match(/https?:\/\/([a-z0-9-]+)\.supabase\.co/i);
  return m ? m[1] : null;
}

function readFirstStringBinding(env: unknown, names: string[]): { value: string | undefined; name: string | null; present: string[] } {
  const present: string[] = [];
  let first: { value: string; name: string } | null = null;
  for (const name of names) {
    const value = readStringBinding(env, name);
    if (value) {
      present.push(name);
      if (!first) first = { value, name };
    }
  }
  return { value: first?.value, name: first?.name ?? null, present };
}

function readSupabaseUrl(env: unknown, includeExternal = false) {
  const names = includeExternal ? SUPABASE_URL_ENV_NAMES : ["SUPABASE_URL", "VITE_SUPABASE_URL"];
  return readFirstStringBinding(env, names);
}

function readServiceRoleKey(env: unknown) {
  return readFirstStringBinding(env, SUPABASE_SERVICE_ROLE_ENV_NAMES);
}

function readPublishableKey(env: unknown) {
  return readFirstStringBinding(env, SUPABASE_PUBLISHABLE_ENV_NAMES);
}

function handleBridgeHealth(env: unknown, pathname: string): Response | null {
  if (pathname !== "/api/public/bridge/health") return null;
  const supabaseUrlInfo = readSupabaseUrl(env);
  const publishableKeyInfo = readPublishableKey(env);
  const serviceRoleKeyInfo = readServiceRoleKey(env);
  const supabaseUrl = supabaseUrlInfo.value;
  const externalUrl = readStringBinding(env, "EXTERNAL_SUPABASE_URL");
  const bridgeApiKey = readStringBinding(env, "BRIDGE_API_KEY");
  const encryptionKey = readStringBinding(env, "ENCRYPTION_KEY");
  const project_ref = extractProjectRef(supabaseUrl) || extractProjectRef(externalUrl);
  const missing_env = [
    ...(!supabaseUrl ? ["SUPABASE_URL"] : []),
    ...(!serviceRoleKeyInfo.value ? ["SUPABASE_SERVICE_ROLE_KEY"] : []),
    ...(!publishableKeyInfo.value ? ["SUPABASE_PUBLISHABLE_KEY"] : []),
    ...(!bridgeApiKey ? ["BRIDGE_API_KEY"] : []),
  ];
  // ENCRYPTION_KEY è OPZIONALE: non blocca il checkout, non entra in missing_env,
  // non incide su `ok`. Serve solo se vuoi cifrare i token Shopify a riposo.
  const ok = missing_env.length === 0;
  // Mappa per ogni secret mancante il nome consigliato + gli alias accettati +
  // (quando disponibile) il valore da incollare. Il service_role NON viene mai
  // restituito qui: va copiato dal dashboard Supabase del progetto Sito B.
  const env_help: Record<string, { accepted: string[]; value?: string; hint: string }> = {
    SUPABASE_URL: {
      accepted: SUPABASE_URL_ENV_NAMES,
      value: supabaseUrl || externalUrl || undefined,
      hint: "URL del progetto Supabase di Sito B (formato https://<ref>.supabase.co).",
    },
    SUPABASE_SERVICE_ROLE_KEY: {
      accepted: SUPABASE_SERVICE_ROLE_ENV_NAMES,
      hint: "Va bene QUALSIASI di queste due chiavi del progetto Sito B (project_ref mostrato sopra): (1) la NUOVA Secret key in formato 'sb_secret_…' da Supabase Dashboard → Project Settings → API Keys → tab 'Publishable and secret API keys' → sezione 'Secret keys' (cliccare l'occhio per rivelarla); OPPURE (2) la LEGACY service_role JWT (eyJhbGciOi…) dal tab 'Legacy anon, service_role API keys' → riga service_role. NON usare la anon/publishable. Incolla il valore come Secret in Cloudflare Workers con uno qualsiasi di questi nomi: " + SUPABASE_SERVICE_ROLE_ENV_NAMES.join(", ") + ".",
    },
    SUPABASE_PUBLISHABLE_KEY: {
      accepted: SUPABASE_PUBLISHABLE_ENV_NAMES,
      value: publishableKeyInfo.value || undefined,
      hint: "Publishable/anon key del progetto Sito B (Supabase Dashboard → Project Settings → API → anon public).",
    },
    BRIDGE_API_KEY: {
      accepted: ["BRIDGE_API_KEY"],
      hint: "Chiave condivisa con Sito A per autenticare le chiamate /api/public/bridge/*. Generala in admin → Stores.",
    },
  };
  return bridgeJson(ok ? 200 : 503, {
    ok,
    source: "site_b_worker",
    version: BRIDGE_WORKER_VERSION,
    project_ref,
    has_service_role: !!serviceRoleKeyInfo.value,
    service_role_source: serviceRoleKeyInfo.name,
    service_role_present_env: serviceRoleKeyInfo.present,
    accepted_service_role_env: SUPABASE_SERVICE_ROLE_ENV_NAMES,
    has_publishable: !!publishableKeyInfo.value,
    publishable_source: publishableKeyInfo.name,
    publishable_present_env: publishableKeyInfo.present,
    has_external_url: !!externalUrl,
    supabase_url_source: supabaseUrlInfo.name,
    has_bridge_api_key: !!bridgeApiKey,
    has_encryption_key: !!encryptionKey,
    encryption_key_optional: true,
    missing_env,
    env_help,
    correlation_id: crypto.randomUUID(),
  });
}

function bridgeRouteCrashJson(pathname: string, error: unknown, step = "server_runtime"): Response {
  const request_id = crypto.randomUUID();
  const message = error instanceof Error ? error.message : String(error || "Internal bridge error");
  console.error("[bridge push-shadow-product]", {
    step,
    error: message,
    stack: error instanceof Error ? error.stack : undefined,
    request_id,
    pathname,
  });

  return bridgeJson(500, {
    ok: false,
    error: message || "Internal bridge error",
    step,
    request_id,
    details: { pathname },
  });
}

function readStringBinding(env: unknown, name: string): string | undefined {
  const fromWorker = env && typeof env === "object" ? (env as WorkerEnv)[name] : undefined;
  if (typeof fromWorker === "string" && fromWorker.trim()) return fromWorker.trim();
  const fromProcess = process.env?.[name];
  if (typeof fromProcess === "string" && fromProcess.trim()) return fromProcess.trim();
  const fromBuild = import.meta.env?.[name];
  return typeof fromBuild === "string" && fromBuild.trim() ? fromBuild.trim() : undefined;
}

function extractBridgeApiKey(request: Request): string | null {
  const explicitKey =
    request.headers.get("x-bridge-api-key")?.trim() ||
    request.headers.get("X-Bridge-Api-Key")?.trim();
  if (explicitKey) return explicitKey;

  const auth = request.headers.get("authorization") ?? request.headers.get("Authorization");
  const bearer = auth?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return bearer || null;
}

async function sha256Hex(input: string): Promise<string> {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function nativeItemLabel(item: Record<string, unknown>, index: number): string {
  return String(item.product_title || item.title || item.prd_code || item.sku || item.product_slug || `Item ${index + 1}`).slice(0, 80);
}

async function whopFetch(apiKey: string, path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.whop.com${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey.trim().replace(/^Bearer\s+/i, "")}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try { parsed = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { parsed = { message: text }; }
  if (!response.ok) throw new Error(`Whop ${response.status} ${path}: ${JSON.stringify(parsed).slice(0, 300)}`);
  return parsed;
}

async function createNativeWhopCheckoutUrl(args: { env: unknown; supabaseUrl: string; sessionId: string; currency: string }): Promise<{ ok: true; path: string; absolute?: boolean } | { ok: false; reason: string; detail?: unknown }> {
  // Accetta sia il nome canonico sia gli alias usati spesso nei Worker Cloudflare.
  const serviceRoleKeyInfo = readServiceRoleKey(args.env);
  const serviceRoleKey = serviceRoleKeyInfo.value;
  if (!serviceRoleKey) {
    return {
      ok: false,
      reason: "missing_service_role_key",
      detail: {
        message: "Nessun secret service-role trovato nel Worker Cloudflare di questo Sito B.",
        accepted_env: SUPABASE_SERVICE_ROLE_ENV_NAMES,
        remediation: "In Cloudflare Workers → Settings → Variables and Secrets aggiungi SUPABASE_SERVICE_ROLE_KEY come Secret, poi fai Deploy. Se hai già SUPABASE_SECRET_KEY ora viene accettato come alias.",
      },
    };
  }
  // Usa l'URL esterno se configurato (clone con DB separato), altrimenti quello standard.
  const externalUrl = readStringBinding(args.env, "EXTERNAL_SUPABASE_URL");
  const targetUrl = externalUrl || args.supabaseUrl;
  const admin = createClient(targetUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: session, error: sessionErr } = await admin.from("native_checkout_sessions").select("id, site_a_store_id, bridge_store_id, items, amount_total, currency, metadata").eq("id", args.sessionId).maybeSingle();
  if (sessionErr) return { ok: false, reason: "session_select_error", detail: sessionErr.message };
  const sessionRow = session as { site_a_store_id?: string | null; bridge_store_id?: string | null; items?: Array<Record<string, unknown>>; amount_total?: number | null; currency?: string | null; metadata?: Record<string, unknown> | null } | null;
  if (!sessionRow) return { ok: false, reason: "session_not_found" };
  // Checkout NATIVO (Whop iframe): restituiamo SEMPRE la pagina interna di Sito B
  // che incorpora l'iframe Whop, mai il redirect assoluto a whop.com.
  const existingPlanId = sessionRow.metadata?.whop_plan_id;
  if (typeof existingPlanId === "string" && existingPlanId) return { ok: true, path: `/shop/checkout/whop?plan=${encodeURIComponent(existingPlanId)}` };
  let bridgeStoreId = sessionRow.bridge_store_id ?? null;
  if (!bridgeStoreId && sessionRow.site_a_store_id) {
    const { data: bs } = await admin.from("bridge_stores").select("id").eq("site_a_store_id", sessionRow.site_a_store_id).eq("is_active", true).maybeSingle();
    if (bs && (bs as { id?: string }).id) {
      bridgeStoreId = (bs as { id: string }).id;
      await admin.from("native_checkout_sessions").update({ bridge_store_id: bridgeStoreId }).eq("id", args.sessionId);
    }
  }
  if (!bridgeStoreId) return { ok: false, reason: "missing_bridge_store_id" };
  const { data: store } = await admin.from("bridge_stores").select("checkout_provider, whop_api_key_encrypted, whop_company_id").eq("id", bridgeStoreId).maybeSingle();
  const storeRow = store as { checkout_provider?: string | null; whop_api_key_encrypted?: string | null; whop_company_id?: string | null } | null;
  if (!storeRow) return { ok: false, reason: "bridge_store_not_found" };
  if ((storeRow.checkout_provider ?? "").toLowerCase() !== "native") return { ok: false, reason: "checkout_provider_not_native", detail: storeRow.checkout_provider };
  if (!storeRow.whop_api_key_encrypted) return { ok: false, reason: "missing_whop_api_key" };
  if (!storeRow.whop_company_id) return { ok: false, reason: "missing_whop_company_id" };

  const apiKey = (await decryptBridgeSecret(storeRow.whop_api_key_encrypted, args.env)).trim();
  if (!apiKey) return { ok: false, reason: "api_key_empty_after_decrypt" };
  if (apiKey.startsWith("v1:")) return { ok: false, reason: "api_key_still_encrypted_legacy" };
  const companyId = (storeRow.whop_company_id.match(/\b(?:biz|company)_[a-z0-9_-]+\b/i)?.[0] ?? storeRow.whop_company_id).trim();
  const items = Array.isArray(sessionRow.items) ? sessionRow.items : [];
  const amount = Number(sessionRow.amount_total ?? items.reduce((sum, item) => sum + Number(item.unit_price ?? item.price ?? 0) * Math.max(1, Number(item.quantity ?? 1)), 0));
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: "invalid_amount", detail: amount };
  const rawTitle = items.length > 1 ? items.map(nativeItemLabel).slice(0, 3).join(" + ") : nativeItemLabel(items[0] ?? {}, 0);
  const title = String(rawTitle).slice(0, 30) || "Checkout";
  try {
    const product = await whopFetch(apiKey, "/api/v1/products", {
      company_id: companyId,
      title,
      description: `Checkout ${args.sessionId}`,
      visibility: "visible",
      collect_shipping_address: false,
      metadata: { native_checkout_session_id: args.sessionId },
    });
    const productId = String(product.id ?? "");
    if (!productId) return { ok: false, reason: "whop_product_no_id", detail: product };
    const plan = await whopFetch(apiKey, "/api/v1/plans", {
      company_id: companyId,
      product_id: productId,
      plan_type: "one_time",
      release_method: "buy_now",
      title,
      description: `Checkout ${args.sessionId}`,
      initial_price: amount,
      currency: (sessionRow.currency ?? args.currency ?? "EUR").toLowerCase(),
      visibility: "visible",
      unlimited_stock: true,
      metadata: { native_checkout_session_id: args.sessionId },
    });
    const planId = String(plan.id ?? "");
    if (!planId) return { ok: false, reason: "whop_plan_no_id", detail: plan };
    const purchaseUrl = typeof (plan as Record<string, unknown>).purchase_url === "string" ? (plan as Record<string, string>).purchase_url : null;
    await admin.from("native_checkout_sessions").update({ metadata: { ...(sessionRow.metadata ?? {}), whop_product_id: productId, whop_plan_id: planId, whop_purchase_url: purchaseUrl, whop_synced_at: new Date().toISOString() }, updated_at: new Date().toISOString() }).eq("id", args.sessionId);
    // Sempre la pagina nativa di Sito B con iframe Whop embeddato (no redirect whop.com).
    return { ok: true, path: `/shop/checkout/whop?plan=${encodeURIComponent(planId)}` };
  } catch (e) {
    return { ok: false, reason: "whop_api_error", detail: e instanceof Error ? e.message : String(e) };
  }
}

async function handleBridgeHandshakeAtWorker(
  request: Request,
  env: unknown,
  pathname: string,
): Promise<Response | null> {
  if (pathname !== "/api/public/bridge/handshake" && pathname !== "/api/bridge/handshake") {
    return null;
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: BRIDGE_CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return bridgeJson(405, { ok: false, error: "Method not allowed", step: "method" });
  }

  try {
    const supabaseUrl = readSupabaseUrl(env).value;
    const publishableKey = readPublishableKey(env).value;
    const missing = [
      ...(!supabaseUrl ? ["SUPABASE_URL"] : []),
      ...(!publishableKey ? ["SUPABASE_PUBLISHABLE_KEY"] : []),
    ];
    if (missing.length) {
      return bridgeJson(500, {
        ok: false,
        error: `Missing runtime environment variable(s): ${missing.join(", ")}`,
        step: "environment_validation",
        details: { missing },
      });
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch (error) {
      return bridgeJson(400, {
        ok: false,
        error: "Invalid JSON body",
        step: "body_parsing",
        details: { message: error instanceof Error ? error.message : String(error) },
      });
    }

    const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    const storeId = typeof body?.store_id === "string" ? body.store_id : "";
    const callbackUrl = typeof body?.callback_url === "string" ? body.callback_url : undefined;
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storeId)
    ) {
      return bridgeJson(400, {
        ok: false,
        error: "Invalid handshake body",
        step: "body_validation",
        details: { issues: [{ path: ["store_id"], message: "Invalid uuid" }] },
      });
    }

    const apiKey = extractBridgeApiKey(request);
    if (!apiKey) {
      return bridgeJson(401, {
        ok: false,
        error: "Missing bridge API key",
        step: "api_key_validation",
        details: { header: "X-Bridge-Api-Key or Authorization: Bearer" },
      });
    }

    const supabase = createClient(supabaseUrl!, publishableKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const receivedHash = await sha256Hex(apiKey);
    const { data: handshakeResult, error: handshakeError } = await (supabase as any).rpc("bridge_handshake", {
      _store_id: storeId,
      _api_key_hash: receivedHash,
      _shop_domain: typeof body?.shop_domain === "string" ? body.shop_domain : null,
      _integration_type: typeof body?.integration_type === "string" ? body.integration_type : "native_bridge",
      _callback_url: callbackUrl ?? null,
      _ip: request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || null,
      _user_agent: request.headers.get("user-agent"),
    });

    if (handshakeError) {
      return bridgeJson(500, {
        ok: false,
        error: "Database handshake failed",
        step: "database_handshake",
        details: {
          message: handshakeError.message,
          code: handshakeError.code,
          details: handshakeError.details,
          hint: handshakeError.hint,
        },
      });
    }
    const payload = handshakeResult && typeof handshakeResult === "object" ? (handshakeResult as Record<string, unknown>) : {};
    const status = typeof payload.status === "number" ? payload.status : payload.ok === true ? 200 : 500;
    const responseBody = { ...payload };
    delete (responseBody as Record<string, unknown>).status;
    return bridgeJson(status, responseBody);
  } catch (error) {
    console.error("[bridge-handshake-worker] unhandled exception", error);
    return bridgeJson(500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      step: "unhandled_exception",
      details: {},
    });
  }
}

function normalizeCheckoutItems(input: unknown): Array<Record<string, unknown>> {
  const body = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const rawItems = Array.isArray(body.items)
    ? body.items
    : Array.isArray(body.line_items)
      ? body.line_items
      : body.product_slug || body.product_handle
        ? [body]
        : [];

  return rawItems.slice(0, 20).map((item, index) => {
    const row = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
    const productSlug = String(row.product_slug || row.product_handle || row.product_id || `item-${index + 1}`).slice(0, 200);
    const quantityRaw = typeof row.quantity === "number" ? row.quantity : Number(row.quantity ?? 1);
    const priceRaw = typeof row.unit_price === "number" ? row.unit_price : typeof row.price === "number" ? row.price : Number(row.unit_price ?? row.price ?? 0);
    return {
      product_slug: productSlug,
      product_handle: row.product_handle ?? productSlug,
      product_id: row.product_id ?? row.source_product_id ?? row.external_ref ?? productSlug,
      source_product_id: row.source_product_id ?? row.product_id ?? productSlug,
      source_product_ref: row.source_product_ref ?? row.product_id ?? productSlug,
      external_ref: row.external_ref ?? row.sku ?? row.variant_id ?? productSlug,
      variant_label: row.variant_label ?? null,
      quantity: Number.isFinite(quantityRaw) ? Math.max(1, Math.min(50, Math.trunc(quantityRaw))) : 1,
      unit_price: Number.isFinite(priceRaw) && priceRaw >= 0 ? priceRaw : 0,
      price: Number.isFinite(priceRaw) && priceRaw >= 0 ? priceRaw : 0,
      prd_code: row.prd_code ?? row.sku ?? undefined,
    };
  });
}

async function handleBridgeCheckoutAtWorker(request: Request, env: unknown, pathname: string): Promise<Response | null> {
  if (!isBridgeCheckoutEndpoint(pathname)) return null;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: BRIDGE_CORS_HEADERS });
  if (request.method !== "POST") return bridgeJson(405, { ok: false, error: "method_not_allowed" });

  const request_id = crypto.randomUUID();
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || null;

  try {
    const supabaseUrl = readSupabaseUrl(env).value;
    const publishableKey = readPublishableKey(env).value;
    const missing = [...(!supabaseUrl ? ["SUPABASE_URL"] : []), ...(!publishableKey ? ["SUPABASE_PUBLISHABLE_KEY"] : [])];
    if (missing.length) return bridgeJson(500, { ok: false, error: `Missing runtime environment variable(s): ${missing.join(", ")}`, step: "environment_validation", request_id });

    const rawBody = await request.json().catch(() => null);
    const body = rawBody && typeof rawBody === "object" && !Array.isArray(rawBody) ? (rawBody as Record<string, unknown>) : null;
    const storeId = typeof body?.store_id === "string" ? body.store_id : "";
    if (!isUuid(storeId)) return bridgeJson(400, { ok: false, error: "invalid_payload", step: "body_validation", request_id });

    const apiKey = extractBridgeApiKey(request);
    if (!apiKey) return bridgeJson(401, { ok: false, error: "invalid_api_key", step: "api_key_validation", request_id, details: { reason: "missing_api_key" } });

    const items = normalizeCheckoutItems(body);
    if (items.length < 1) return bridgeJson(400, { ok: false, error: "invalid_payload", step: "body_validation", request_id, details: { reason: "items_required" } });

    const currency = String(body?.presentment_currency || body?.currency || items[0]?.currency || "EUR").toUpperCase().slice(0, 3);
    const locale = String(body?.customer_locale || body?.buyer_locale || body?.locale || (body?.language && body?.country ? `${body.language}-${String(body.country).toUpperCase()}` : body?.language) || "en").slice(0, 20);
    const country = typeof body?.country === "string" ? body.country.slice(0, 3) : null;
    const receivedHash = await sha256Hex(apiKey);
    const supabase = createClient(supabaseUrl!, publishableKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: result, error } = await supabase.rpc("bridge_create_native_checkout_session", {
      _store_id: storeId,
      _api_key_hash: receivedHash,
      _items: items,
      _currency: currency,
      _locale: locale,
      _country: country,
      _metadata: { session_id: typeof body?.session_id === "string" ? body.session_id : null, accept_language: request.headers.get("accept-language"), endpoint: pathname },
      _ip: ip,
    });
    if (error) return bridgeJson(500, { ok: false, error: "native_checkout_failed", step: "database_checkout", request_id, details: { message: error.message, code: error.code, hint: error.hint } });
    const payload = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
    const status = typeof payload.status === "number" ? payload.status : payload.ok === true ? 200 : 500;
    if (payload.error === "checkout_provider_not_native") return null;
    if (payload.ok !== true) return bridgeJson(status, { ...payload, status: undefined, request_id });

    const origin = new URL(request.url).origin;
    const sessionId = String(payload.session_id);
    const whopResult = await createNativeWhopCheckoutUrl({ env, supabaseUrl: supabaseUrl!, sessionId, currency });
    if (!whopResult.ok) {
      console.error("[bridge-checkout-worker] whop checkout failed", { sessionId, reason: whopResult.reason, detail: whopResult.detail });
      const detailStr = whopResult.detail === undefined ? "" : (typeof whopResult.detail === "string" ? whopResult.detail : JSON.stringify(whopResult.detail)).slice(0, 400);
      const isConfigMissing = whopResult.reason === "missing_service_role_key";
      const project_ref = extractProjectRef(supabaseUrl) || extractProjectRef(readStringBinding(env, "EXTERNAL_SUPABASE_URL"));
      return bridgeJson(isConfigMissing ? 503 : 502, {
        ok: false,
        source: "site_b_worker",
        error: `whop_checkout_unavailable: ${whopResult.reason}${detailStr ? ` :: ${detailStr}` : ""}`,
        step: "create_whop_checkout",
        request_id,
        correlation_id: request_id,
        session_id: sessionId,
        reason: whopResult.reason,
        project_ref,
        ...(isConfigMissing ? { missing_env: ["SUPABASE_SERVICE_ROLE_KEY"], accepted_env: SUPABASE_SERVICE_ROLE_ENV_NAMES, remediation: "In Cloudflare Workers → Settings → Variables and Secrets aggiungi SUPABASE_SERVICE_ROLE_KEY come Secret, poi fai Deploy. Se hai già SUPABASE_SECRET_KEY ora viene accettato come alias." } : {}),
        detail: whopResult.detail,
      });
    }
    let redirectUrl = whopResult.absolute ? whopResult.path : `${origin}${whopResult.path}`;
    // Aggiungi il session_id così la pagina checkout nativa può mostrare il riepilogo ordine e le spedizioni.
    if (!whopResult.absolute) redirectUrl += `${redirectUrl.includes("?") ? "&" : "?"}session=${encodeURIComponent(sessionId)}`;
    return bridgeJson(200, { ok: true, redirect_url: redirectUrl, session_id: sessionId, currency, request_id });
  } catch (error) {
    console.error("[bridge-checkout-worker] unhandled exception", error);
    return bridgeJson(500, { ok: false, error: error instanceof Error ? error.message : "native_checkout_failed", step: "unhandled_exception", request_id });
  }
}

class PushShadowProductError extends Error {
  status: number;
  step: string;
  details: Record<string, unknown>;

  constructor(status: number, message: string, step: string, details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.step = step;
    this.details = details;
  }
}

type PushVariant = {
  label: string;
  price: number;
  compare_price?: number | null;
  external_ref: string;
};

type PushBody = {
  source_store_id: string;
  source_product_id: string;
  shadow_handle: string;
  shadow_title: string;
  variants: PushVariant[];
};

type PushStore = {
  id: string;
  site_a_store_id: string;
  shop_domain: string;
  shopify_access_token_encrypted: string;
  shopify_api_version: string;
  bridge_api_key_hash: string;
  is_active: boolean;
  user_agent?: string | null;
  checkout_provider?: string | null;
};


const PUSH_PRODUCT_CREATE_MUTATION = /* GraphQL */ `
  mutation pushShadow($input: ProductInput!) {
    productCreate(input: $input) {
      product { id handle status variants(first: 100) { edges { node { id title sku } } } }
      userErrors { field message }
    }
  }
`;

const PUSH_PRODUCT_UPDATE_MUTATION = /* GraphQL */ `
  mutation updateShadow($input: ProductInput!) {
    productUpdate(input: $input) {
      product { id handle status variants(first: 100) { edges { node { id title sku } } } }
      userErrors { field message }
    }
  }
`;

function pushError(status: number, message: string, step: string, details: Record<string, unknown> = {}) {
  return new PushShadowProductError(status, message, step, details);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getStringField(input: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function parsePushBody(raw: unknown): PushBody {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!input) throw pushError(400, "Invalid JSON body", "body_validation", { reason: "body_must_be_object" });

  const sourceStoreId = getStringField(input, ["source_store_id", "store_id"]);
  const sourceProductId = getStringField(input, ["source_product_id", "product_id"]);
  const shadowHandle = getStringField(input, ["shadow_handle"]);
  const shadowTitle = getStringField(input, ["shadow_title", "product_title", "title"]) || `Prodotto ${shadowHandle}`;
  const variantsInput = Array.isArray(input.variants) ? input.variants : [];

  const issues: Array<{ path: string[]; message: string }> = [];
  if (!isUuid(sourceStoreId)) issues.push({ path: ["source_store_id"], message: "Invalid uuid" });
  if (!sourceProductId) issues.push({ path: ["source_product_id"], message: "Required" });
  if (!/^PRD-\d{5}$/.test(shadowHandle)) issues.push({ path: ["shadow_handle"], message: "Expected PRD-00000 format" });
  if (!variantsInput.length || variantsInput.length > 50) issues.push({ path: ["variants"], message: "Expected 1-50 variants" });

  const variants = variantsInput.map((variant, index) => {
    const row = variant && typeof variant === "object" ? (variant as Record<string, unknown>) : {};
    const label = typeof row.label === "string" && row.label.trim() ? row.label.trim() : `Variante ${index + 1}`;
    const external_ref = getStringField(row, ["external_ref", "id", "variant_id", "sku"]) || `variant-${index + 1}`;
    const priceValue = typeof row.price === "number" ? row.price : Number(row.price);
    const compareValue = row.compare_price == null ? null : typeof row.compare_price === "number" ? row.compare_price : Number(row.compare_price);
    if (!Number.isFinite(priceValue) || priceValue < 0) issues.push({ path: ["variants", String(index), "price"], message: "Invalid price" });
    if (compareValue != null && (!Number.isFinite(compareValue) || compareValue < 0)) issues.push({ path: ["variants", String(index), "compare_price"], message: "Invalid compare_price" });
    return { label, price: priceValue, compare_price: compareValue, external_ref };
  });

  if (issues.length > 0) throw pushError(400, "Invalid push-shadow-product body", "body_validation", { issues });
  return { source_store_id: sourceStoreId, source_product_id: sourceProductId, shadow_handle: shadowHandle, shadow_title: shadowTitle, variants };
}

function decodeBase64Bytes(value: string): Uint8Array {
  const normalized = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function decryptBridgeSecret(payload: string, env: unknown): Promise<string> {
  if (!payload) return payload;
  const parts = payload.split(":");
  // Non cifrato: ritorna così com'è.
  if (parts.length !== 3 || parts[0] !== "v1") return payload;

  const rawKey = readStringBinding(env, "ENCRYPTION_KEY");
  if (!rawKey) {
    // ENCRYPTION_KEY non più richiesta: se il valore in DB risulta ancora cifrato
    // (legacy), non possiamo decifrarlo. Restituiamo il payload as-is così l'endpoint
    // non crasha; l'admin dovrà ri-salvare il token Shopify in chiaro.
    console.warn("[bridge] ENCRYPTION_KEY assente: token legacy v1: restituito as-is, ri-salvare il token");
    return payload;
  }

  try {
    const keyBytes = (() => {
      try {
        const decoded = decodeBase64Bytes(rawKey);
        if (decoded.length === 32) return decoded;
      } catch {
        // Try raw UTF-8 below.
      }
      const utf8 = new TextEncoder().encode(rawKey.trim());
      if (utf8.length === 32) return utf8;
      throw new Error("invalid_key_format");
    })();

    const key = await crypto.subtle.importKey("raw", bytesToArrayBuffer(keyBytes), { name: "AES-GCM" }, false, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytesToArrayBuffer(decodeBase64Bytes(parts[1])) },
      key,
      bytesToArrayBuffer(decodeBase64Bytes(parts[2])),
    );
    return new TextDecoder().decode(plaintext);
  } catch (e) {
    console.warn("[bridge] decrypt failed, returning payload as-is", e instanceof Error ? e.message : String(e));
    return payload;
  }
}


function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function pushLog(supabase: any, entry: Record<string, unknown>) {
  try {
    await supabase.from("bridge_push_log").insert(entry);
  } catch (error) {
    console.error("[bridge push-shadow-product] log failed", error);
  }
}

type VariantEdge = { node: { id: string; title: string; sku: string | null } };

async function pushShopifyGraphQL<T>(auth: { shop_domain: string; access_token: string; api_version: string; user_agent?: string | null }, query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://${auth.shop_domain}/admin/api/${auth.api_version}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": auth.access_token,
      Accept: "application/json",
      "User-Agent": auth.user_agent || "Mozilla/5.0 (compatible; DealBridgeBot/1.0)",
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await response.text();
  if (!response.ok) throw pushError(502, `shopify_http_${response.status}: ${text.slice(0, 300)}`, "shopify_graphql", { status: response.status });
  const parsed = JSON.parse(text) as { data?: T; errors?: Array<{ message: string }> };
  if (parsed.errors?.length) throw pushError(502, `shopify_gql_error: ${parsed.errors.map((error) => error.message).join("; ")}`, "shopify_graphql");
  if (!parsed.data) throw pushError(502, "shopify_empty_response", "shopify_graphql");
  return parsed.data;
}

async function handlePushShadowProductAtWorker(request: Request, env: unknown, pathname: string): Promise<Response | null> {
  if (!isPushShadowProductEndpoint(pathname)) return null;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: BRIDGE_CORS_HEADERS });
  if (request.method !== "POST") return bridgeJson(405, { ok: false, error: "Method not allowed", step: "method" });

  const request_id = crypto.randomUUID();
  let step = "initialization";
  let details: Record<string, unknown> = {};

  try {
    step = "environment_validation";
    const supabaseUrl = readSupabaseUrl(env).value;
    const publishableKey = readPublishableKey(env).value;
    const missing = [...(!supabaseUrl ? ["SUPABASE_URL"] : []), ...(!publishableKey ? ["SUPABASE_PUBLISHABLE_KEY"] : [])];
    if (missing.length) throw pushError(500, `Missing runtime environment variable(s): ${missing.join(", ")}`, step, { missing });

    const supabase = createClient(supabaseUrl!, publishableKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || null;

    step = "body_parsing";
    let rawBody: unknown;
    try {
      rawBody = JSON.parse(await request.text());
    } catch (error) {
      throw pushError(400, "Invalid JSON body", step, { message: error instanceof Error ? error.message : String(error) });
    }

    step = "body_validation";
    const body = parsePushBody(rawBody);
    const apiKey = extractBridgeApiKey(request);

    step = "api_key_validation";
    if (!apiKey) {
      return bridgeJson(401, { ok: false, error: "invalid_api_key", step, request_id, details: { reason: "missing_api_key" } });
    }

    step = "database_prepare";
    const receivedHash = await sha256Hex(apiKey);
    const { data: prepareResult, error: prepareError } = await supabase.rpc("bridge_push_shadow_prepare", {
      _store_id: body.source_store_id,
      _api_key_hash: receivedHash,
      _source_product_id: body.source_product_id,
      _shadow_handle: body.shadow_handle,
      _shadow_title: body.shadow_title,
      _ip: ip,
    });
    if (prepareError) throw pushError(500, "Database prepare failed", step, { message: prepareError.message, code: prepareError.code, hint: prepareError.hint });
    const prepared = prepareResult && typeof prepareResult === "object" ? (prepareResult as Record<string, unknown>) : {};
    if (prepared.ok !== true) {
      const status = typeof prepared.status === "number" ? prepared.status : 500;
      return bridgeJson(status, { ...prepared, status: undefined, request_id });
    }
    const pushStore = (prepared.store || {}) as PushStore;
    const existing = (prepared.existing || {}) as { shopify_product_id?: string | null };
    const checkoutProvider = (pushStore.checkout_provider || "shopify").toLowerCase();

    // Native bridge mode: no Shopify call, just save the shadow product locally.
    if (checkoutProvider !== "shopify") {
      step = "native_shadow_save";
      const nativeVariantMap = body.variants.map((variant) => ({
        external_ref: variant.external_ref,
        shopify_variant_id: `native:${body.shadow_handle}::${variant.external_ref}`,
        native_variant_id: `native:${body.shadow_handle}::${variant.external_ref}`,
        label: variant.label,
        price: variant.price,
        compare_price: variant.compare_price ?? null,
      }));
      const nativeProductUrl = `native://${body.source_store_id}/${body.shadow_handle}`;
      const requestOrigin = (() => {
        try { return new URL(request.url).origin; } catch { return ""; }
      })();
      const publicUrl = requestOrigin ? `${requestOrigin}/p/${body.shadow_handle}` : `/p/${body.shadow_handle}`;
      const { error: nativeSaveError } = await supabase.rpc("bridge_push_shadow_save_success", {
        _store_id: body.source_store_id,
        _api_key_hash: receivedHash,
        _source_product_id: body.source_product_id,
        _shadow_handle: body.shadow_handle,
        _shadow_title: body.shadow_title,
        _shopify_product_id: `native:${body.shadow_handle}`,
        _shopify_handle: body.shadow_handle,
        _product_url: publicUrl,
        _variant_map: nativeVariantMap,
        _ip: ip,
      });
      if (nativeSaveError) throw pushError(500, "Shadow product save failed", step, { message: nativeSaveError.message, code: nativeSaveError.code, hint: nativeSaveError.hint });
      return bridgeJson(200, {
        ok: true,
        mode: "native_bridge",
        shadow_handle: body.shadow_handle,
        shopify_product_id: `native:${body.shadow_handle}`,
        product_url: publicUrl,
        public_url: publicUrl,
        native_url: nativeProductUrl,
        variant_map: nativeVariantMap,
        request_id,
      });

    }


    step = "shopify_auth";
    const accessToken = (await decryptBridgeSecret(pushStore.shopify_access_token_encrypted || "", env)).trim();
    if (!accessToken || accessToken === "__pending_oauth__") throw pushError(502, "Shopify non ancora collegato via OAuth", step);


    const productInput: Record<string, unknown> = {
      title: body.shadow_title,
      handle: body.shadow_handle,
      status: "DRAFT",
      tags: ["shadow", "hidden", "bridge"],
      published: false,
      options: ["Variante"],
      variants: body.variants.map((variant) => ({
        option1: variant.label,
        price: variant.price.toFixed(2),
        ...(typeof variant.compare_price === "number" ? { compareAtPrice: variant.compare_price.toFixed(2) } : {}),
        sku: `${body.shadow_handle}::${variant.external_ref}`,
        inventoryPolicy: "CONTINUE",
        requiresShipping: true,
        taxable: true,
      })),
      metafields: [
        { namespace: "bridge", key: "source_product_id", value: body.source_product_id, type: "single_line_text_field" },
        { namespace: "bridge", key: "source_store_id", value: body.source_store_id, type: "single_line_text_field" },
        { namespace: "bridge", key: "hidden", value: "true", type: "single_line_text_field" },
      ],
    };

    let shopifyProductId = "";
    let shopifyHandle = "";
    let variantEdges: VariantEdge[] = [];
    try {
      step = "shopify_graphql";
      if (existing?.shopify_product_id) {
        const data = await pushShopifyGraphQL<{ productUpdate?: { product?: { id: string; handle: string; variants: { edges: VariantEdge[] } } | null; userErrors?: Array<{ field: string[]; message: string }> } }>(
          { shop_domain: pushStore.shop_domain, access_token: accessToken, api_version: pushStore.shopify_api_version, user_agent: pushStore.user_agent },
          PUSH_PRODUCT_UPDATE_MUTATION,
          { input: { id: existing.shopify_product_id, ...productInput } },
        );
        const userErrors = data.productUpdate?.userErrors ?? [];
        if (userErrors.length) throw pushError(502, `productUpdate userErrors: ${userErrors.map((error) => `${error.field?.join(".")}: ${error.message}`).join("; ")}`, step);
        if (!data.productUpdate?.product) throw pushError(502, "productUpdate returned no product", step);
        shopifyProductId = data.productUpdate.product.id;
        shopifyHandle = data.productUpdate.product.handle;
        variantEdges = data.productUpdate.product.variants.edges;
      } else {
        const data = await pushShopifyGraphQL<{ productCreate?: { product?: { id: string; handle: string; variants: { edges: VariantEdge[] } } | null; userErrors?: Array<{ field: string[]; message: string }> } }>(
          { shop_domain: pushStore.shop_domain, access_token: accessToken, api_version: pushStore.shopify_api_version, user_agent: pushStore.user_agent },
          PUSH_PRODUCT_CREATE_MUTATION,
          { input: productInput },
        );
        const userErrors = data.productCreate?.userErrors ?? [];
        if (userErrors.length) throw pushError(502, `productCreate userErrors: ${userErrors.map((error) => `${error.field?.join(".")}: ${error.message}`).join("; ")}`, step);
        if (!data.productCreate?.product) throw pushError(502, "productCreate returned no product", step);
        shopifyProductId = data.productCreate.product.id;
        shopifyHandle = data.productCreate.product.handle;
        variantEdges = data.productCreate.product.variants.edges;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await supabase.rpc("bridge_push_shadow_record_error", {
        _store_id: body.source_store_id,
        _api_key_hash: receivedHash,
        _source_product_id: body.source_product_id,
        _shadow_handle: body.shadow_handle,
        _shadow_title: body.shadow_title,
        _error: message,
        _ip: ip,
      });
      return bridgeJson(502, { ok: false, error: "shopify_error", step, request_id, details: { message } });
    }

    step = "shadow_product_upsert";
    const variantMap = body.variants.map((variant) => {
      const expectedSku = `${body.shadow_handle}::${variant.external_ref}`;
      return { external_ref: variant.external_ref, shopify_variant_id: variantEdges.find((edge) => edge.node.sku === expectedSku)?.node.id ?? null };
    });
    const productUrl = `https://${pushStore.shop_domain}/products/${shopifyHandle}`;
    const { error: saveError } = await supabase.rpc("bridge_push_shadow_save_success", {
      _store_id: body.source_store_id,
      _api_key_hash: receivedHash,
      _source_product_id: body.source_product_id,
      _shadow_handle: body.shadow_handle,
      _shadow_title: body.shadow_title,
      _shopify_product_id: shopifyProductId,
      _shopify_handle: shopifyHandle,
      _product_url: productUrl,
      _variant_map: variantMap,
      _ip: ip,
    });
    if (saveError) throw pushError(500, "Shadow product save failed", step, { message: saveError.message, code: saveError.code, hint: saveError.hint });

    return bridgeJson(200, { ok: true, shadow_handle: body.shadow_handle, shopify_product_id: shopifyProductId, product_url: productUrl, variant_map: variantMap });
  } catch (error) {
    const status = error instanceof PushShadowProductError ? error.status : 500;
    const errorStep = error instanceof PushShadowProductError ? error.step : step;
    details = error instanceof PushShadowProductError ? error.details : details;
    const message = error instanceof Error ? error.message : String(error || "Internal bridge error");
    console.error("[bridge push-shadow-product]", { step: errorStep, error: message, stack: error instanceof Error ? error.stack : undefined, request_id });
    return bridgeJson(status, { ok: false, error: message || "Internal bridge error", step: errorStep, request_id, details });
  }
}

function browserPublicEnv(env: unknown) {
  const workerEnv = (env && typeof env === "object" ? env : {}) as WorkerEnv;
  const supabaseUrl =
    typeof workerEnv.VITE_SUPABASE_URL === "string"
      ? workerEnv.VITE_SUPABASE_URL
      : typeof workerEnv.SUPABASE_URL === "string"
        ? workerEnv.SUPABASE_URL
        : undefined;
  const publishableKey =
    typeof workerEnv.VITE_SUPABASE_PUBLISHABLE_KEY === "string"
      ? workerEnv.VITE_SUPABASE_PUBLISHABLE_KEY
      : typeof workerEnv.SUPABASE_PUBLISHABLE_KEY === "string"
        ? workerEnv.SUPABASE_PUBLISHABLE_KEY
        : undefined;

  return {
    ...(supabaseUrl ? { SUPABASE_URL: supabaseUrl } : {}),
    ...(publishableKey ? { SUPABASE_PUBLISHABLE_KEY: publishableKey } : {}),
  };
}

async function injectBrowserPublicEnv(response: Response, env: unknown): Promise<Response> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return response;

  const publicEnv = browserPublicEnv(env);
  if (!Object.keys(publicEnv).length) return response;

  const runtimeEnv = {
    url: publicEnv.SUPABASE_URL,
    publishableKey: publicEnv.SUPABASE_PUBLISHABLE_KEY,
  };
  const script = `<script>window.__PONTE_SUPABASE_ENV__=${escapeJsonForHtml(runtimeEnv)};window.process=window.process||{};window.process.env=Object.assign({},window.process.env||{},${escapeJsonForHtml(publicEnv)});</script>`;
  const html = (await response.text()).replace(/<head([^>]*)>/i, `<head$1>${script}`);
  const headers = new Headers(response.headers);
  headers.delete("content-length");

  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isCatastrophicSsrErrorBody(body: string, responseStatus: number): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return false;
  }

  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) {
    return false;
  }

  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response, pathname?: string): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (pathname && isPushShadowProductEndpoint(pathname) && !contentType.includes("application/json")) {
    return bridgeRouteCrashJson(pathname, new Error(`Server returned non-JSON ${response.status}`), "non_json_500_response");
  }
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isCatastrophicSsrErrorBody(body, response.status)) {
    return response;
  }

  const capturedError = consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`);
  console.error(capturedError);
  if (pathname && isPushShadowProductEndpoint(pathname)) {
    return bridgeRouteCrashJson(pathname, capturedError, "server_route_exception");
  }
  return brandedErrorResponse();
}

let __bootDiagLogged = false;
function logBootDiagnostics(env: unknown) {
  if (__bootDiagLogged) return;
  __bootDiagLogged = true;
  const url = readSupabaseUrl(env, true);
  const sr = readServiceRoleKey(env);
  const pk = readPublishableKey(env);
  const bridgeApiKey = readStringBinding(env, "BRIDGE_API_KEY");
  const encryptionKey = readStringBinding(env, "ENCRYPTION_KEY");
  const externalUrl = readStringBinding(env, "EXTERNAL_SUPABASE_URL");
  const missing: string[] = [];
  if (!url.value) missing.push("SUPABASE_URL (accepted: " + SUPABASE_URL_ENV_NAMES.join(", ") + ")");
  if (!sr.value) missing.push("SUPABASE_SERVICE_ROLE_KEY (accepted: " + SUPABASE_SERVICE_ROLE_ENV_NAMES.join(", ") + ")");
  if (!pk.value) missing.push("SUPABASE_PUBLISHABLE_KEY (accepted: " + SUPABASE_PUBLISHABLE_ENV_NAMES.join(", ") + ")");
  if (!bridgeApiKey) missing.push("BRIDGE_API_KEY");
  // ENCRYPTION_KEY è opzionale: non segnalata come mancante.
  console.log("[bridge boot]", JSON.stringify({
    version: BRIDGE_WORKER_VERSION,
    project_ref: extractProjectRef(url.value) || extractProjectRef(externalUrl),
    supabase_url_source: url.name,
    service_role_source: sr.name,
    service_role_present_env: sr.present,
    publishable_source: pk.name,
    publishable_present_env: pk.present,
    has_bridge_api_key: !!bridgeApiKey,
    has_encryption_key: !!encryptionKey,
    has_external_url: !!externalUrl,
    missing,
    ok: missing.length === 0,
  }));
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      syncWorkerEnvToProcessEnv(env);
      logBootDiagnostics(env);
      const url = new URL(request.url);
      if (request.method === "GET" || request.method === "OPTIONS") {
        const healthResponse = handleBridgeHealth(env, url.pathname);
        if (healthResponse) return healthResponse;
      }

      const pushShadowProductResponse = await handlePushShadowProductAtWorker(request, env, url.pathname);
      if (pushShadowProductResponse) return pushShadowProductResponse;
      const bridgeCheckoutResponse = await handleBridgeCheckoutAtWorker(request.clone(), env, url.pathname);
      if (bridgeCheckoutResponse) return bridgeCheckoutResponse;
      const bridgeResponse = await handleBridgeHandshakeAtWorker(request, env, url.pathname);
      if (bridgeResponse) return bridgeResponse;
      if (url.pathname === "/" || url.pathname === "") {
        const fallback = fallbackHomeResponse(env);
        if (fallback) return fallback;
      }
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      const normalized = await normalizeCatastrophicSsrResponse(response, url.pathname);
      return await injectBrowserPublicEnv(normalized, env);
    } catch (error) {
      console.error(error);
      const url = new URL(request.url);
      if (isPushShadowProductEndpoint(url.pathname)) return bridgeRouteCrashJson(url.pathname, error, "worker_fetch_exception");
      return brandedErrorResponse();
    }
  },
};
