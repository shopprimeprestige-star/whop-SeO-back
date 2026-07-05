// Server-fn admin per gestire i prodotti sincronizzati e la configurazione sync.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { decryptString, encryptString } from "@/lib/bridge/crypto.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type SyncSettings = {
  id: string;
  hmac_secret: string | null;
  allowed_source_origins: string[];
  default_synced_image_url: string | null;
  auto_publish_to_whop: boolean;
  default_whop_store_id: string | null;
};

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

function normalizeWhopCompanyId(value?: string | null) {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const match = raw.match(/\b(?:biz|company)_[a-z0-9_-]+\b/i);
  return (match?.[0] ?? raw.replace(/\/+$/, "")).trim() || null;
}

function whopTitle(t: string) { return t.length > 80 ? `${t.slice(0, 77)}...` : t; }

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
  if (!res.ok) throw new Error(`Whop ${res.status} ${path}: ${json ? JSON.stringify(json).slice(0, 300) : txt.slice(0, 200)}`);
  return (json ?? {}) as Record<string, unknown>;
}

async function whopUpsertProductPlan(args: WhopUpsertArgs) {
  let productId = args.existingWhopProductId;
  let planId = args.existingWhopPlanId;
  if (!productId) {
    const created = await whopFetch(args.apiKey, "/api/v1/products", {
      method: "POST",
      body: JSON.stringify({
        company_id: args.companyId,
        title: whopTitle(args.title),
        description: args.description ?? args.title,
        visibility: "visible",
        collect_shipping_address: true,
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
  }
  return { whop_product_id: productId, whop_plan_id: planId };
}

async function assertAdmin(userId: string, db: SupabaseClient<Database>) {
  const { data, error } = await db
    .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Non autorizzato");
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

async function getSyncSettingsForUser(db: SupabaseClient<Database>): Promise<SyncSettings> {
  const { data, error } = await db
    .from("sync_settings" as never)
    .select("*")
    .eq("singleton", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    const { data: inserted, error: insErr } = await db
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

async function setSyncSecretForUser(db: SupabaseClient<Database>, plainSecret: string): Promise<void> {
  const encrypted = await encryptString(plainSecret);
  const { error } = await db
    .from("sync_settings" as never)
    .update({ hmac_secret_encrypted: encrypted, updated_at: new Date().toISOString() } as never)
    .eq("singleton", true);
  if (error) throw new Error(error.message);
}

async function pickDefaultWhopStoreForUser(db: SupabaseClient<Database>, preferredStoreId: string | null) {
  const baseSelect = "id,whop_api_key_encrypted,whop_company_id,whop_plan_id,checkout_provider,is_active,sync_key";
  if (preferredStoreId) {
    const { data } = await db
      .from("bridge_stores")
      .select(baseSelect)
      .eq("id", preferredStoreId)
      .eq("is_active", true)
      .maybeSingle();
    if (data && (data as { whop_api_key_encrypted?: string | null }).whop_api_key_encrypted) return data;
  }
  const { data, error } = await db
    .from("bridge_stores")
    .select(baseSelect)
    .eq("is_active", true)
    .in("checkout_provider", ["whop", "native"])
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).find((s) => !!(s as { whop_api_key_encrypted?: string | null }).whop_api_key_encrypted) ?? null;
}

// ===== Lista prodotti sincronizzati =====
export const syncListProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase;
    await assertAdmin(context.userId, db);
    const { data, error } = await db
      .from("shop_products")
      .select("id,prd_code,slug,title,price,currency,image_url,source_store_id,source_product_ref,source_synced_at,whop_product_id,whop_plan_id,whop_synced_at,whop_sync_error,bridge_store_id")
      .eq("source", "synced")
      .order("source_synced_at", { ascending: false, nullsFirst: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ===== Get settings =====
export const syncGetSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase;
    await assertAdmin(context.userId, db);
    const s = await getSyncSettingsForUser(db);
    return {
      hmac_secret_preview: s.hmac_secret ? `${s.hmac_secret.slice(0, 8)}…(${s.hmac_secret.length})` : null,
      hmac_secret_full: s.hmac_secret, // admin-only context
      allowed_source_origins: s.allowed_source_origins,
      default_synced_image_url: s.default_synced_image_url,
      auto_publish_to_whop: s.auto_publish_to_whop,
      default_whop_store_id: s.default_whop_store_id,
    };
  });

// ===== Save settings =====
export const syncSaveSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: {
    hmac_secret?: string | null;
    allowed_source_origins?: string[];
    default_synced_image_url?: string | null;
    auto_publish_to_whop?: boolean;
    default_whop_store_id?: string | null;
  }) => z.object({
    hmac_secret: z.string().min(16).max(256).optional().nullable(),
    allowed_source_origins: z.array(z.string().url().max(500)).max(20).optional(),
    default_synced_image_url: z.string().url().max(2000).nullable().optional(),
    auto_publish_to_whop: z.boolean().optional(),
    default_whop_store_id: z.string().uuid().nullable().optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    await assertAdmin(context.userId, db);
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.allowed_source_origins !== undefined) updates.allowed_source_origins = data.allowed_source_origins;
    if (data.default_synced_image_url !== undefined) updates.default_synced_image_url = data.default_synced_image_url;
    if (data.auto_publish_to_whop !== undefined) updates.auto_publish_to_whop = data.auto_publish_to_whop;
    if (data.default_whop_store_id !== undefined) updates.default_whop_store_id = data.default_whop_store_id;
    if (Object.keys(updates).length > 1) {
      const { error } = await db
        .from("sync_settings" as never).update(updates as never).eq("singleton", true);
      if (error) throw new Error(error.message);
    }
    if (data.hmac_secret) await setSyncSecretForUser(db, data.hmac_secret);
    return { ok: true };
  });

// ===== Genera nuovo HMAC secret =====
export const syncGenerateSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase;
    await assertAdmin(context.userId, db);
    const secret = (crypto.randomUUID() + crypto.randomUUID()).replaceAll("-", "");
    await setSyncSecretForUser(db, secret);
    return { secret };
  });

// ===== Imposta immagine prodotto sync (e re-push su Whop) =====
export const syncSetProductImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { productId: string; image_url: string | null }) =>
    z.object({
      productId: z.string().uuid(),
      image_url: z.string().url().max(2000).nullable(),
    }).parse(i)
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    await assertAdmin(context.userId, db);
    const { error } = await db
      .from("shop_products")
      .update({ image_url: data.image_url } as never)
      .eq("id", data.productId)
      .eq("source", "synced");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ===== Lista pubblicazioni Whop per un prodotto =====
export const syncListPublications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { productId: string }) =>
    z.object({ productId: z.string().uuid() }).parse(i)
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    await assertAdmin(context.userId, db);
    const { data: rows, error } = await db
      .from("shop_product_whop_publications" as never)
      .select("id,bridge_store_id,whop_product_id,whop_plan_id,whop_checkout_url,last_synced_at,last_error")
      .eq("product_id", data.productId);
    if (error) throw new Error(error.message);
    return (rows ?? []) as unknown as Array<{
      id: string; bridge_store_id: string;
      whop_product_id: string | null; whop_plan_id: string | null;
      whop_checkout_url: string | null; last_synced_at: string | null; last_error: string | null;
    }>;
  });

// ===== Pubblica/risincronizza un prodotto su uno o più store Whop =====
export const syncPublishToStores = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { productId: string; storeIds: string[]; allStores?: boolean }) =>
    z.object({
      productId: z.string().uuid(),
      storeIds: z.array(z.string().uuid()).max(50),
      allStores: z.boolean().optional(),
    }).parse(i)
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    await assertAdmin(context.userId, db);

    const { data: p } = await db
      .from("shop_products")
      .select("id,prd_code,description,price,currency")
      .eq("id", data.productId)
      .maybeSingle();
    if (!p) throw new Error("Prodotto non trovato");

    let storeIds = data.storeIds;
    if (data.allStores) {
      const { data: stores } = await db
        .from("bridge_stores")
        .select("id,whop_api_key_encrypted")
        .eq("is_active", true)
        .in("checkout_provider", ["whop", "native"]);
      storeIds = (stores ?? [])
        .filter((s) => !!(s as { whop_api_key_encrypted?: string | null }).whop_api_key_encrypted)
        .map((s) => (s as { id: string }).id);
    }
    if (storeIds.length === 0) throw new Error("Nessuno store selezionato");

    const { data: existingPubs } = await db
      .from("shop_product_whop_publications" as never)
      .select("bridge_store_id,whop_product_id,whop_plan_id")
      .eq("product_id", data.productId);
    const existingMap = new Map<string, { whop_product_id: string | null; whop_plan_id: string | null }>();
    for (const row of (existingPubs ?? []) as unknown as Array<{ bridge_store_id: string; whop_product_id: string | null; whop_plan_id: string | null }>) {
      existingMap.set(row.bridge_store_id, { whop_product_id: row.whop_product_id, whop_plan_id: row.whop_plan_id });
    }

    const results: Array<{ store_id: string; ok: boolean; whop_product_id?: string; whop_plan_id?: string; whop_checkout_url?: string | null; error?: string }> = [];

    for (const storeId of storeIds) {
      try {
        const { data: store } = await db
          .from("bridge_stores")
          .select("id,whop_api_key_encrypted,whop_company_id,whop_plan_id,display_name,shop_domain")
          .eq("id", storeId)
          .eq("is_active", true)
          .maybeSingle();
        if (!store) throw new Error("Store non trovato o disattivo");
        const enc = (store as { whop_api_key_encrypted: string | null }).whop_api_key_encrypted;
        if (!enc) throw new Error("Store senza API key Whop");
        const apiKey = await decryptString(enc);
        const companyId =
          normalizeWhopCompanyId((store as { whop_company_id?: string | null }).whop_company_id) ??
          normalizeWhopCompanyId((store as { whop_plan_id?: string | null }).whop_plan_id);
        if (!companyId) throw new Error("Whop Company ID non configurato per questo store");

        const existing = existingMap.get(storeId) ?? { whop_product_id: null, whop_plan_id: null };
        const res = await whopUpsertProductPlan({
          apiKey, companyId,
          productDbId: (p as { id: string }).id,
          title: (p as { prd_code: string }).prd_code,
          description: (p as { description: string | null }).description,
          price: Number((p as { price: number }).price),
          currency: (p as { currency: string }).currency,
          existingWhopProductId: existing.whop_product_id,
          existingWhopPlanId: existing.whop_plan_id,
        });
        const checkoutUrl = res.whop_plan_id ? `https://whop.com/checkout/${res.whop_plan_id}` : null;

        await db.from("shop_product_whop_publications" as never).upsert({
          product_id: data.productId,
          bridge_store_id: storeId,
          whop_product_id: res.whop_product_id,
          whop_plan_id: res.whop_plan_id,
          whop_checkout_url: checkoutUrl,
          last_synced_at: new Date().toISOString(),
          last_error: null,
        } as never, { onConflict: "product_id,bridge_store_id" });

        results.push({ store_id: storeId, ok: true, ...res, whop_checkout_url: checkoutUrl });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await db.from("shop_product_whop_publications" as never).upsert({
          product_id: data.productId,
          bridge_store_id: storeId,
          last_error: msg,
        } as never, { onConflict: "product_id,bridge_store_id" });
        results.push({ store_id: storeId, ok: false, error: msg });
      }
    }

    const firstOk = results.find((r) => r.ok);
    if (firstOk) {
      await db
        .from("shop_products")
        .update({
          whop_product_id: firstOk.whop_product_id,
          whop_plan_id: firstOk.whop_plan_id,
          whop_synced_at: new Date().toISOString(),
          whop_sync_error: null,
          bridge_store_id: firstOk.store_id,
        } as never)
        .eq("id", data.productId);
    }

    return { results };
  });

// Retro-compat: re-sync su Whop usando lo store di default
export const syncResyncWhop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { productId: string }) =>
    z.object({ productId: z.string().uuid() }).parse(i)
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    await assertAdmin(context.userId, db);
    const settings = await getSyncSettingsForUser(db);
    const store = await pickDefaultWhopStoreForUser(db, settings.default_whop_store_id);
    if (!store) throw new Error("Nessuno store Whop configurato");
    const storeId = (store as { id: string }).id;
    // Riusa la logica multi-store con un solo store
    return syncPublishToStores({ data: { productId: data.productId, storeIds: [storeId] } });
  });
