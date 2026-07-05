// Inbound API key auth + log helpers + outbound HMAC callback.
import { supabaseAdmin } from "@/lib/runtime-supabase-admin";
import { decryptString, hmacSha256Hex, safeEqual, sha256Hex } from "./crypto.server";

export interface BridgeStoreRow {
  id: string;
  site_a_store_id: string;
  shop_domain: string;
  display_name: string | null;
  shopify_access_token_encrypted: string;
  shopify_api_version: string;
  bridge_api_key_hash: string;
  bridge_api_key_encrypted: string;
  shopify_webhook_secret_encrypted: string | null;
  callback_url: string | null;
  is_active: boolean;
  last_handshake_at: string | null;
  last_sync_at: string | null;
  last_callback_at: string | null;
  last_error: string | null;
  // Tracciabilità + tuning chiamate Shopify (opzionali)
  default_tags?: string | null;
  default_order_note?: string | null;
  default_note_attributes?: unknown; // jsonb: array di { name, value }
  user_agent?: string | null;
  rate_limit_rps?: number | null;
}

export async function authInboundRequest(
  apiKeyHeader: string | null,
  siteAStoreId: string
): Promise<BridgeStoreRow> {
  if (!apiKeyHeader) throw httpError(401, "Missing bridge API key", "api_key_validation", { header: "X-Bridge-Api-Key or Authorization: Bearer" });
  const hash = await sha256Hex(apiKeyHeader);
  console.info("[bridge-auth] inbound", {
    store_id: siteAStoreId,
    header_len: apiKeyHeader.length,
    received_hash_prefix: hash.slice(0, 12),
  });
  const { data, error } = await supabaseAdmin
    .from("bridge_stores")
    .select("*")
    .eq("site_a_store_id", siteAStoreId)
    .maybeSingle();
  if (error) throw httpError(500, "Database lookup failed", "database_lookup", { table: "bridge_stores", query: "select by site_a_store_id", message: error.message, code: error.code, details: error.details, hint: error.hint });
  if (!data) {
    console.error("[bridge-auth] no store row for store_id", siteAStoreId);
    throw httpError(401, "Unknown store_id", "store_lookup", { store_id: siteAStoreId });
  }
  console.info("[bridge-auth] expected", {
    expected_hash_prefix: (data.bridge_api_key_hash ?? "").slice(0, 12),
    expected_hash_len: (data.bridge_api_key_hash ?? "").length,
    match: safeEqual(data.bridge_api_key_hash, hash),
    is_active: data.is_active,
  });
  const encryptedKeyHeaderMatch =
    typeof data.bridge_api_key_encrypted === "string" &&
    data.bridge_api_key_encrypted.startsWith("v1:") &&
    safeEqual(data.bridge_api_key_encrypted, apiKeyHeader);
  if (!safeEqual(data.bridge_api_key_hash, hash) && !encryptedKeyHeaderMatch) {
    throw httpError(401, "Invalid API key", "api_key_validation", { reason: "hash_mismatch" });
  }
  if (encryptedKeyHeaderMatch) {
    console.warn("[bridge-auth] accepted legacy encrypted bridge_api_key header; rotate/copy a fresh plaintext key when possible");
  }
  if (!data.is_active) throw httpError(403, "Store disabled", "store_status", { is_active: false });
  return data as BridgeStoreRow;
}

// assertShopDomainMatches RIMOSSO. Sito A non invia più shop_domain.

export async function getShopifyAuth(store: BridgeStoreRow) {
  const access_token = (await decryptString(store.shopify_access_token_encrypted)).trim();
  if (!access_token || access_token === "__pending_oauth__") {
    throw new Error("Shopify non ancora collegato via OAuth. Salva lo store e clicca 'Connetti con Shopify'.");
  }
  return {
    shop_domain: store.shop_domain,
    access_token,
    api_version: store.shopify_api_version,
    user_agent: store.user_agent || undefined,
    store_id: store.id,
    rate_limit_rps: store.rate_limit_rps ?? 2,
  };
}

export async function logBridge(entry: {
  store_id?: string | null;
  direction: "inbound" | "outbound" | "shopify";
  endpoint: string;
  http_status?: number | null;
  success: boolean;
  payload?: unknown;
  error?: string | null;
}) {
  const { error } = await supabaseAdmin.from("bridge_logs").insert({
    store_id: entry.store_id ?? null,
    direction: entry.direction,
    endpoint: entry.endpoint,
    http_status: entry.http_status ?? null,
    success: entry.success,
    payload: (entry.payload ?? null) as never,
    error: entry.error ?? null,
  });
  if (error) console.error("[bridge-log] insert failed", { message: error.message, code: error.code, details: error.details, hint: error.hint });
}

export type CallbackType = "stats_update" | "order_paid" | "order_created" | "order_cancelled" | "order_refunded" | "revenue_update" | "online_status";

export async function notifyCallback(store: BridgeStoreRow, type: CallbackType, data: unknown) {
  if (!store.callback_url) {
    await logBridge({ store_id: store.id, direction: "outbound", endpoint: "(no callback_url)", success: false, error: "callback_url not set" });
    return { ok: false, error: "callback_url not set" };
  }
  const apiKey = await decryptString(store.bridge_api_key_encrypted);
  const body = JSON.stringify({ type, data });
  const signature = await hmacSha256Hex(apiKey, body);
  let status = 0;
  let respText = "";
  let ok = false;
  try {
    const res = await fetch(store.callback_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Store-Id": store.site_a_store_id,
        "X-Bridge-Signature": signature,
      },
      body,
    });
    status = res.status;
    respText = (await res.text()).slice(0, 500);
    ok = res.ok;
  } catch (e) {
    respText = e instanceof Error ? e.message : String(e);
  }
  await supabaseAdmin
    .from("bridge_stores")
    .update({ last_callback_at: new Date().toISOString() })
    .eq("id", store.id);
  await logBridge({
    store_id: store.id,
    direction: "outbound",
    endpoint: store.callback_url,
    http_status: status || null,
    success: ok,
    payload: { type, response_preview: respText },
    error: ok ? null : respText,
  });
  return { ok, status, response: respText };
}

export class HttpError extends Error {
  status: number;
  step: string;
  details: Record<string, unknown>;
  constructor(status: number, message: string, step = "unhandled_exception", details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.step = step;
    this.details = details;
  }
}
export function httpError(status: number, message: string, step?: string, details?: Record<string, unknown>) {
  return new HttpError(status, message, step, details);
}

export function jsonResponse(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Bridge-Api-Key",
      ...(init.headers || {}),
    },
  });
}

export function corsPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Bridge-Api-Key, X-Shopify-Hmac-Sha256",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function handleError(e: unknown, endpoint: string, storeId?: string | null) {
  const status = e instanceof HttpError ? e.status : 500;
  const msg = e instanceof Error ? e.message : String(e);
  const step = e instanceof HttpError ? e.step : "unhandled_exception";
  const details = e instanceof HttpError ? e.details : {};
  console.error(`[bridge] ${endpoint} failed at ${step}`, e);
  try {
    await logBridge({ store_id: storeId ?? null, direction: "inbound", endpoint, http_status: status, success: false, error: `${step}: ${msg}` });
  } catch (logError) {
    console.error(`[bridge] ${endpoint} failed to write error log`, logError);
  }
  return jsonResponse({ ok: false, error: msg, step, details }, { status });
}
