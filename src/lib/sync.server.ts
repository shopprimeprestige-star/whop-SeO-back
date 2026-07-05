// Helpers server-only per la sync di prodotti da Site A.
// - Genera PRD-XXXXX univoco (5 cifre, retry su collisione)
// - Legge/decifra il segreto HMAC dalla tabella sync_settings (singleton)
// - Verifica firma HMAC dal webhook
// - Crea/aggiorna product+plan one-time su Whop riutilizzando l'API key dello store

import { supabaseAdmin } from "@/lib/runtime-supabase-admin";
import { decryptString, encryptString, hmacSha256Hex, safeEqual } from "@/lib/bridge/crypto.server";

// ---------- PUBLISH TO ALL WHOPS ----------

export type PublishAllResult = {
  store_id: string;
  ok: boolean;
  skipped?: boolean;
  whop_product_id?: string | null;
  whop_plan_id?: string | null;
  whop_checkout_url?: string | null;
  error?: string;
};

type ProductForPublish = {
  id: string;
  title: string;
  description: string | null;
  price: number;
  currency: string;
};

// Pubblica/crea il prodotto su TUTTI gli store Whop attivi.
// Se un prodotto è già stato sincronizzato su uno store (esiste una publication
// con whop_product_id + whop_plan_id), quello store viene SALTATO.
// Gli store senza sync precedente vengono pubblicati e tracciati in
// shop_product_whop_publications (idempotente su product_id,bridge_store_id).
export async function publishProductToAllWhops(product: ProductForPublish): Promise<PublishAllResult[]> {
  const { data: stores } = await supabaseAdmin
    .from("bridge_stores")
    .select("id,whop_api_key_encrypted,whop_company_id,whop_plan_id,checkout_provider,is_active")
    .eq("is_active", true)
    .in("checkout_provider", ["whop", "native"])
    .order("created_at", { ascending: true });
  const targets = (stores ?? []).filter(
    (s) => !!(s as { whop_api_key_encrypted?: string | null }).whop_api_key_encrypted,
  );
  if (targets.length === 0) return [];

  const { data: pubs } = await supabaseAdmin
    .from("shop_product_whop_publications" as never)
    .select("bridge_store_id,whop_product_id,whop_plan_id")
    .eq("product_id", product.id);
  const existing = new Map<string, { whop_product_id: string | null; whop_plan_id: string | null }>();
  for (const r of (pubs ?? []) as unknown as Array<{ bridge_store_id: string; whop_product_id: string | null; whop_plan_id: string | null }>) {
    existing.set(r.bridge_store_id, { whop_product_id: r.whop_product_id, whop_plan_id: r.whop_plan_id });
  }

  const results: PublishAllResult[] = [];
  for (const store of targets) {
    const storeId = (store as { id: string }).id;
    const prev = existing.get(storeId);
    // SKIP: già sincronizzato su questo Whop
    if (prev?.whop_product_id && prev?.whop_plan_id) {
      results.push({
        store_id: storeId,
        ok: true,
        skipped: true,
        whop_product_id: prev.whop_product_id,
        whop_plan_id: prev.whop_plan_id,
      });
      continue;
    }
    try {
      const enc = (store as { whop_api_key_encrypted: string | null }).whop_api_key_encrypted;
      if (!enc) throw new Error("Store senza API key Whop");
      const apiKey = await decryptString(enc);
      const companyId =
        normalizeWhopCompanyId((store as { whop_company_id?: string | null }).whop_company_id) ??
        normalizeWhopCompanyId((store as { whop_plan_id?: string | null }).whop_plan_id);
      if (!companyId) throw new Error("Whop Company ID non configurato per questo store");
      const res = await whopUpsertProductPlan({
        apiKey,
        companyId,
        productDbId: product.id,
        title: product.title,
        description: product.description,
        price: product.price,
        currency: product.currency,
        existingWhopProductId: prev?.whop_product_id ?? null,
        existingWhopPlanId: prev?.whop_plan_id ?? null,
      });
      const checkoutUrl = res.whop_checkout_url ?? (res.whop_plan_id ? `https://whop.com/checkout/${res.whop_plan_id}` : null);
      await supabaseAdmin.from("shop_product_whop_publications" as never).upsert({
        product_id: product.id,
        bridge_store_id: storeId,
        whop_product_id: res.whop_product_id,
        whop_plan_id: res.whop_plan_id,
        whop_checkout_url: checkoutUrl,
        last_synced_at: new Date().toISOString(),
        last_error: null,
      } as never, { onConflict: "product_id,bridge_store_id" });
      results.push({
        store_id: storeId,
        ok: true,
        whop_product_id: res.whop_product_id,
        whop_plan_id: res.whop_plan_id,
        whop_checkout_url: checkoutUrl,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabaseAdmin.from("shop_product_whop_publications" as never).upsert({
        product_id: product.id,
        bridge_store_id: storeId,
        last_error: msg,
      } as never, { onConflict: "product_id,bridge_store_id" });
      results.push({ store_id: storeId, ok: false, error: msg });
    }
  }
  return results;
}

// ---------- SYNC SETTINGS ----------

export type SyncSettings = {
  id: string;
  hmac_secret: string | null;
  allowed_source_origins: string[];
  default_synced_image_url: string | null;
  auto_publish_to_whop: boolean;
  default_whop_store_id: string | null;
};

export async function getSyncSettings(): Promise<SyncSettings> {
  const { data, error } = await supabaseAdmin
    .from("sync_settings" as never)
    .select("*")
    .eq("singleton", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("sync_settings" as never)
      .insert({ singleton: true } as never)
      .select("*")
      .single();
    if (insErr) throw new Error(insErr.message);
    return mapSettings(inserted as Record<string, unknown>, null);
  }
  const row = data as Record<string, unknown>;
  let secret: string | null = null;
  const enc = (row.hmac_secret_encrypted as string | null) ?? null;
  if (enc) { try { secret = await decryptString(enc); } catch { secret = null; } }
  return mapSettings(row, secret);
}

function mapSettings(row: Record<string, unknown>, secret: string | null): SyncSettings {
  return {
    id: row.id as string,
    hmac_secret: secret,
    allowed_source_origins: (row.allowed_source_origins as string[]) ?? [],
    default_synced_image_url: (row.default_synced_image_url as string | null) ?? null,
    auto_publish_to_whop: (row.auto_publish_to_whop as boolean) ?? true,
    default_whop_store_id: (row.default_whop_store_id as string | null) ?? null,
  };
}

export async function setSyncSecret(plainSecret: string): Promise<void> {
  const encrypted = await encryptString(plainSecret);
  const { error } = await supabaseAdmin
    .from("sync_settings" as never)
    .update({ hmac_secret_encrypted: encrypted, updated_at: new Date().toISOString() } as never)
    .eq("singleton", true);
  if (error) throw new Error(error.message);
}

// ---------- PRD CODE ----------

export function generatePrdCode(): string {
  const n = 10000 + Math.floor(Math.random() * 90000); // 5 cifre, 10000-99999
  return `PRD-${n}`;
}

export async function generateUniquePrdCode(maxAttempts = 12): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const code = generatePrdCode();
    const { data } = await supabaseAdmin
      .from("shop_products")
      .select("id")
      .eq("prd_code", code)
      .maybeSingle();
    if (!data) return code;
  }
  // Fallback: estende con 1 cifra extra
  return `PRD-${100000 + Math.floor(Math.random() * 900000)}`;
}

// ---------- HMAC VERIFY ----------

export async function verifyHmacSignature(secret: string, rawBody: string, signatureHeader: string | null): Promise<boolean> {
  if (!signatureHeader || !secret) return false;
  const expected = await hmacSha256Hex(secret, rawBody);
  const provided = signatureHeader.trim().replace(/^sha256=/i, "").toLowerCase();
  return safeEqual(expected, provided);
}

// ---------- WHOP UPSERT ----------

type WhopUpsertArgs = {
  apiKey: string;
  companyId: string;
  productDbId: string;
  title: string;
  description: string | null;
  price: number;
  currency: string;
  existingWhopProductId: string | null;
  existingWhopPlanId: string | null;
};

type WhopUpsertResult = { whop_product_id: string; whop_plan_id: string; whop_checkout_url: string | null };

export class WhopApiError extends Error {
  status: number;
  body: string;
  requestId: string | null;
  parsed: Record<string, unknown> | null;
  path: string;
  constructor(opts: { status: number; body: string; requestId: string | null; parsed: Record<string, unknown> | null; path: string; message: string }) {
    super(opts.message);
    this.name = "WhopApiError";
    this.status = opts.status;
    this.body = opts.body;
    this.requestId = opts.requestId;
    this.parsed = opts.parsed;
    this.path = opts.path;
  }
}

async function whopFetch(apiKey: string, path: string, init?: RequestInit) {
  const token = apiKey.trim().replace(/^Bearer\s+/i, "");
  const res = await fetch(`https://api.whop.com${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const txt = await res.text();
  let json: Record<string, unknown> | null = null;
  try { json = txt ? (JSON.parse(txt) as Record<string, unknown>) : null; } catch { /* keep */ }
  if (!res.ok) {
    let detail = "";
    if (json) {
      const errObj = json.error as Record<string, unknown> | string | undefined;
      if (typeof json.message === "string") detail = json.message;
      else if (typeof errObj === "string") detail = errObj;
      else if (errObj && typeof errObj === "object" && typeof errObj.message === "string") detail = errObj.message as string;
      else detail = JSON.stringify(json).slice(0, 300);
    } else detail = txt.slice(0, 200) || res.statusText;
    throw new WhopApiError({
      status: res.status,
      body: txt.slice(0, 2000),
      requestId: res.headers.get("x-request-id") ?? res.headers.get("x-whop-request-id"),
      parsed: json,
      path,
      message: `Whop ${res.status} ${path}: ${detail}`,
    });
  }
  return (json ?? {}) as Record<string, unknown>;
}

function whopTitle(t: string) { return t.length > 80 ? `${t.slice(0, 77)}...` : t; }

export async function whopUpsertProductPlan(args: WhopUpsertArgs): Promise<WhopUpsertResult> {
  let productId = args.existingWhopProductId;
  let planId = args.existingWhopPlanId;
  let checkoutUrl: string | null = null;
  if (!productId) {
    const created = await whopFetch(args.apiKey, "/api/v1/products", {
      method: "POST",
      body: JSON.stringify({
        company_id: args.companyId,
        title: whopTitle(args.title),
        description: args.description ?? args.title,
        visibility: "visible",
        collect_shipping_address: false,
        metadata: { bridge_product_id: args.productDbId },
      }),
    });
    productId = String(created.id ?? "");
    if (!productId) throw new Error("Whop non ha restituito un product id");
  }
  if (!planId) {
    const plan = await whopFetch(args.apiKey, "/api/v1/plans", {
      method: "POST",
      body: JSON.stringify({
        company_id: args.companyId,
        product_id: productId,
        plan_type: "one_time",
        release_method: "buy_now",
        title: whopTitle(args.title),
        description: args.description ?? args.title,
        initial_price: Number(args.price),
        currency: (args.currency ?? "EUR").toLowerCase(),
        visibility: "visible",
        unlimited_stock: true,
        metadata: { bridge_product_id: args.productDbId },
      }),
    });
    planId = String(plan.id ?? "");
    if (!planId) throw new Error("Whop non ha restituito un plan id");
    const directUrl = (plan.direct_link as string | undefined) ?? (plan.checkout_url as string | undefined) ?? (plan.purchase_url as string | undefined);
    if (directUrl) checkoutUrl = String(directUrl);
  }
  if (!checkoutUrl && planId) {
    checkoutUrl = `https://whop.com/checkout/${planId}`;
  }
  return { whop_product_id: productId, whop_plan_id: planId, whop_checkout_url: checkoutUrl };
}

// Restituisce lo store Whop indicato da sync_key (priorità più alta),
// altrimenti quello indicato in sync_settings.default_whop_store_id,
// altrimenti il primo store con Whop configurato.
export async function pickDefaultWhopStore(preferredStoreId: string | null, syncKey?: string | null) {
  const baseSelect = "id,whop_api_key_encrypted,whop_company_id,whop_plan_id,checkout_provider,is_active,sync_key";

  if (syncKey) {
    const { data } = await supabaseAdmin
      .from("bridge_stores")
      .select(baseSelect)
      .eq("sync_key", syncKey.trim().toLowerCase())
      .eq("is_active", true)
      .maybeSingle();
    if (data && (data as { whop_api_key_encrypted?: string | null }).whop_api_key_encrypted) return data;
    // sync_key fornita ma non trovata: NON facciamo fallback silenzioso
    return null;
  }

  if (preferredStoreId) {
    const { data } = await supabaseAdmin
      .from("bridge_stores")
      .select(baseSelect)
      .eq("id", preferredStoreId)
      .eq("is_active", true)
      .maybeSingle();
    if (data && (data as { whop_api_key_encrypted?: string | null }).whop_api_key_encrypted) return data;
  }
  const { data } = await supabaseAdmin
    .from("bridge_stores")
    .select(baseSelect)
    .eq("is_active", true)
    .in("checkout_provider", ["whop", "native"])
    .order("created_at", { ascending: true });
  return (data ?? []).find((s) => !!(s as { whop_api_key_encrypted?: string | null }).whop_api_key_encrypted) ?? null;
}

export function normalizeWhopCompanyId(value?: string | null) {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const match = raw.match(/\b(?:biz|company)_[a-z0-9_-]+\b/i);
  return (match?.[0] ?? raw.replace(/\/+$/, "")).trim() || null;
}
