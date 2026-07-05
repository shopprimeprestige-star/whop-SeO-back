import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/lib/runtime-supabase-admin";
import { decryptString, encryptString, generateBridgeApiKey, sha256Hex } from "@/lib/bridge/crypto.server";
import { getShopifyAuth, notifyCallback, type BridgeStoreRow } from "@/lib/bridge/auth.server";
import { shopifyGetShop, shopifyListOrdersPaginated } from "@/lib/bridge/shopify.server";

async function assertAdmin(userId: string, db = supabaseAdmin) {
  const { data, error } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
}

type RevenueOrderRow = {
  store_id: string;
  shopify_order_id: string;
  order_number: string | null;
  total_price: number | null;
  currency: string | null;
  financial_status: string | null;
  cancelled_at: string | null;
  created_at_shopify: string | null;
};

async function loadRevenueOrders(storeIds?: string[], db = supabaseAdmin) {
  const pageSize = 1000;
  const all: RevenueOrderRow[] = [];

  for (let page = 0; page < 20; page++) {
    let query = db
      .from("bridge_orders")
      .select("store_id,shopify_order_id,order_number,total_price,currency,financial_status,cancelled_at,created_at_shopify")
      .order("created_at_shopify", { ascending: false })
      .range(page * pageSize, page * pageSize + pageSize - 1);

    if (storeIds && storeIds.length > 0) {
      query = query.in("store_id", storeIds);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as RevenueOrderRow[];
    all.push(...rows);
    if (rows.length < pageSize) break;
  }

  return all;
}

// Returns the ISO timestamp of the most recent midnight in Europe/Rome (DST-aware).
// Resets dynamically every 24h based on Rome wall-clock (CET/CEST).
function startOfTodayIso() {
  return startOfRomeDayIso(new Date());
}

function romeDateParts(d: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(d).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour === "24" ? "0" : parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

// Compute the UTC instant corresponding to 00:00 Europe/Rome of the given date's Rome day.
function startOfRomeDayIso(d: Date): string {
  const { year, month, day, hour, minute, second } = romeDateParts(d);
  // Rome offset in minutes at this instant (positive = east of UTC)
  const romeAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMin = Math.round((romeAsUtcMs - d.getTime()) / 60000);
  // Midnight Rome (wall clock) for that day, expressed in UTC
  const midnightUtcMs = Date.UTC(year, month - 1, day, 0, 0, 0) - offsetMin * 60000;
  return new Date(midnightUtcMs).toISOString();
}

// Format a date as YYYY-MM-DD in the Europe/Rome timezone.
function romeDayKey(d: Date): string {
  const { year, month, day } = romeDateParts(d);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function buildRevenueSummary(rows: RevenueOrderRow[]) {
  const startOfDay = startOfTodayIso();
  const activeRows = rows.filter((row) => !row.cancelled_at);
  const sum = (items: RevenueOrderRow[], since?: string) =>
    items
      .filter((row) => !since || ((row.created_at_shopify ?? "") >= since))
      .reduce((total, row) => total + Number(row.total_price || 0), 0);
  const count = (items: RevenueOrderRow[], since?: string) =>
    items.filter((row) => !since || ((row.created_at_shopify ?? "") >= since)).length;

  return {
    currency: activeRows[0]?.currency ?? rows[0]?.currency ?? "EUR",
    lifetime_revenue: sum(activeRows),
    today_revenue: sum(activeRows, startOfDay),
    orders_count: count(activeRows),
    today_orders: count(activeRows, startOfDay),
  };
}

export const ponteListStores = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("bridge_stores")
      .select("id,site_a_store_id,shop_domain,display_name,shopify_api_version,callback_url,is_active,last_handshake_at,last_sync_at,last_callback_at,last_error,created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const summaries = new Map<string, ReturnType<typeof buildRevenueSummary>>();
    const orders = await loadRevenueOrders((data ?? []).map((store) => store.id));
    for (const store of data ?? []) {
      summaries.set(store.id, buildRevenueSummary(orders.filter((row) => row.store_id === store.id)));
    }
    return (data ?? []).map((store) => ({ ...store, ...(summaries.get(store.id) ?? buildRevenueSummary([])) }));
  });

export const ponteGetStore = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: row, error } = await supabaseAdmin
      .from("bridge_stores")
      .select("id,site_a_store_id,shop_domain,display_name,shopify_api_version,callback_url,is_active,last_handshake_at,last_sync_at,last_callback_at,last_error,bridge_api_key_encrypted,shopify_webhook_secret_encrypted,shopify_api_key_encrypted,shopify_api_secret_encrypted,shopify_access_token_encrypted,default_tags,default_order_note,default_note_attributes,user_agent,rate_limit_rps,custom_domains,created_at,checkout_provider,whop_api_key_encrypted,whop_product_id,whop_plan_id,whop_webhook_secret_encrypted,whop_company_id")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return null;
    let bridge_api_key: string | null = null;
    let webhook_secret: string | null = null;
    let shopify_api_key: string | null = null;
    let shopify_api_secret: string | null = null;
    let whop_api_key: string | null = null;
    let whop_webhook_secret: string | null = null;
    let shopify_oauth_connected = false;
    try { bridge_api_key = await decryptString(row.bridge_api_key_encrypted); } catch { /* ignore */ }
    if (row.shopify_webhook_secret_encrypted) {
      try { webhook_secret = await decryptString(row.shopify_webhook_secret_encrypted); } catch { /* ignore */ }
    }
    if (row.shopify_api_key_encrypted) {
      try { shopify_api_key = await decryptString(row.shopify_api_key_encrypted); } catch { /* ignore */ }
    }
    if (row.shopify_api_secret_encrypted) {
      try { shopify_api_secret = await decryptString(row.shopify_api_secret_encrypted); } catch { /* ignore */ }
    }
    if ((row as { whop_api_key_encrypted?: string | null }).whop_api_key_encrypted) {
      try { whop_api_key = await decryptString((row as { whop_api_key_encrypted: string }).whop_api_key_encrypted); } catch { /* ignore */ }
    }
    if ((row as { whop_webhook_secret_encrypted?: string | null }).whop_webhook_secret_encrypted) {
      try { whop_webhook_secret = await decryptString((row as { whop_webhook_secret_encrypted: string }).whop_webhook_secret_encrypted); } catch { /* ignore */ }
    }
    const summary = buildRevenueSummary(await loadRevenueOrders([row.id]));
    try {
      const tok = await decryptString(row.shopify_access_token_encrypted);
      shopify_oauth_connected = !!tok && tok !== "__pending_oauth__";
    } catch { /* ignore */ }
    const companyIdFromPlanField = normalizeWhopCompanyId((row as { whop_plan_id?: string | null }).whop_plan_id);
    return {
      ...row,
      ...summary,
      whop_company_id: normalizeWhopCompanyId((row as { whop_company_id?: string | null }).whop_company_id) ?? companyIdFromPlanField,
      whop_plan_id: companyIdFromPlanField ? null : (row as { whop_plan_id?: string | null }).whop_plan_id,
      bridge_api_key,
      webhook_secret,
      shopify_api_key,
      shopify_api_secret,
      whop_api_key,
      whop_webhook_secret,
      shopify_oauth_connected,
    };
  });

const NoteAttr = z.object({
  name: z.string().min(1).max(80),
  value: z.string().max(500),
});

const StoreInput = z
  .object({
    id: z.string().uuid().optional(),
    site_a_store_id: z.string().uuid(),
    shop_domain: z.string().max(255).optional().nullable(),
    display_name: z.string().max(120).optional().nullable(),
    checkout_provider: z.enum(["shopify", "native", "whop"]).default("shopify"),
    shopify_access_token: z.string().min(10).max(500).optional(),
    shopify_api_version: z.string().min(6).max(10).default("2024-10"),
    shopify_api_key: z.string().max(200).optional().nullable(),
    shopify_api_secret: z.string().max(500).optional().nullable(),
    bridge_api_key: z.string().min(16).max(200).optional(),
    callback_url: z.string().max(500).optional().nullable(),
    shopify_webhook_secret: z.string().max(500).optional().nullable(),
    whop_api_key: z.string().max(500).optional().nullable(),
    whop_company_id: z.string().max(200).optional().nullable(),
    whop_product_id: z.string().max(200).optional().nullable(),
    whop_plan_id: z.string().max(200).optional().nullable(),
    whop_webhook_secret: z.string().max(500).optional().nullable(),

    is_active: z.boolean().optional(),
    default_tags: z.string().max(500).optional().nullable(),
    default_order_note: z.string().max(2000).optional().nullable(),
    default_note_attributes: z.array(NoteAttr).max(20).optional().nullable(),
    user_agent: z.string().max(200).optional().nullable(),
    rate_limit_rps: z.number().int().min(1).max(20).optional().nullable(),
    custom_domains: z
      .array(
        z
          .string()
          .trim()
          .toLowerCase()
          .max(253)
          .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "Hostname non valido")
      )
      .max(5)
      .optional()
      .nullable(),
  })
  .superRefine((d, ctx) => {
    const provider = d.checkout_provider ?? "shopify";
    if (provider === "shopify") {
      const sd = (d.shop_domain ?? "").trim();
      if (sd.length < 3 || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(sd)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["shop_domain"], message: "Hostname non valido" });
      }
    }
    if (d.callback_url && d.callback_url.trim().length > 0) {
      try { new URL(d.callback_url); } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["callback_url"], message: "URL non valida" });
      }
    }
  });

export const ponteUpsertStore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof StoreInput>) => StoreInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);

    const provider = data.checkout_provider ?? "shopify";
    const fallbackDomain = `${provider}-${data.site_a_store_id.slice(0, 8)}.local`;
    const updates: Record<string, unknown> = {
      site_a_store_id: data.site_a_store_id,
      shop_domain: (data.shop_domain && data.shop_domain.trim()) || fallbackDomain,
      display_name: data.display_name ?? null,
      shopify_api_version: data.shopify_api_version,
      callback_url: (data.callback_url && data.callback_url.trim()) || null,
      is_active: data.is_active ?? true,
      checkout_provider: provider,
    };
    if (data.default_tags !== undefined) updates.default_tags = data.default_tags ?? null;
    if (data.default_order_note !== undefined) updates.default_order_note = data.default_order_note ?? null;
    if (data.default_note_attributes !== undefined) updates.default_note_attributes = data.default_note_attributes ?? [];
    if (data.user_agent !== undefined) updates.user_agent = data.user_agent?.trim() || null;
    if (data.rate_limit_rps !== undefined && data.rate_limit_rps !== null) updates.rate_limit_rps = data.rate_limit_rps;
    if (data.custom_domains !== undefined) {
      const cleaned = (data.custom_domains ?? [])
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean);
      updates.custom_domains = Array.from(new Set(cleaned)).slice(0, 5);
    }
    if (data.shopify_access_token) {
      updates.shopify_access_token_encrypted = await encryptString(data.shopify_access_token);
    }
    if (data.shopify_api_key !== undefined) {
      updates.shopify_api_key_encrypted = data.shopify_api_key ? await encryptString(data.shopify_api_key) : null;
    }
    if (data.shopify_api_secret !== undefined) {
      updates.shopify_api_secret_encrypted = data.shopify_api_secret ? await encryptString(data.shopify_api_secret) : null;
    }
    if (data.shopify_webhook_secret !== undefined) {
      updates.shopify_webhook_secret_encrypted = data.shopify_webhook_secret
        ? await encryptString(data.shopify_webhook_secret)
        : null;
    }
    if (data.whop_api_key !== undefined) {
      updates.whop_api_key_encrypted = data.whop_api_key ? await encryptString(data.whop_api_key) : null;
    }
    if (data.whop_webhook_secret !== undefined) {
      updates.whop_webhook_secret_encrypted = data.whop_webhook_secret
        ? await encryptString(data.whop_webhook_secret)
        : null;
    }
    const companyIdFromPlanField = normalizeWhopCompanyId(data.whop_plan_id);
    if (data.whop_product_id !== undefined) updates.whop_product_id = data.whop_product_id || null;
    if (data.whop_plan_id !== undefined) updates.whop_plan_id = companyIdFromPlanField ? null : data.whop_plan_id || null;
    if (data.whop_company_id !== undefined || companyIdFromPlanField) {
      updates.whop_company_id = normalizeWhopCompanyId(data.whop_company_id) ?? companyIdFromPlanField;
    }

    if (data.bridge_api_key) {
      updates.bridge_api_key_encrypted = await encryptString(data.bridge_api_key);
      updates.bridge_api_key_hash = await sha256Hex(data.bridge_api_key);
    }

    if (data.id) {
      const { error } = await supabaseAdmin.from("bridge_stores").update(updates as never).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    // access token will be set via OAuth flow if not provided manually
    if (!data.shopify_access_token) updates.shopify_access_token_encrypted = await encryptString("__pending_oauth__");
    if (!data.bridge_api_key) throw new Error("bridge_api_key is required when creating a store");
    const { data: row, error } = await supabaseAdmin
      .from("bridge_stores")
      .insert(updates as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const ponteUpdateSiteAIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; site_a_store_id?: string; bridge_api_key?: string }) =>
    z.object({
      id: z.string().uuid(),
      site_a_store_id: z.string().uuid().optional(),
      bridge_api_key: z.string().min(16).max(200).optional(),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const updates: Record<string, unknown> = {};
    if (data.site_a_store_id) updates.site_a_store_id = data.site_a_store_id;
    if (data.bridge_api_key) {
      updates.bridge_api_key_encrypted = await encryptString(data.bridge_api_key);
      updates.bridge_api_key_hash = await sha256Hex(data.bridge_api_key);
    }
    if (Object.keys(updates).length === 0) return { ok: true };
    const { error } = await supabaseAdmin.from("bridge_stores").update(updates as never).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const ponteDeleteStore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin.from("bridge_stores").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const ponteTestShopify = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: store, error } = await supabaseAdmin.from("bridge_stores").select("*").eq("id", data.id).single();
    if (error) throw new Error(error.message);
    try {
      const auth = await getShopifyAuth(store as BridgeStoreRow);
      const shop = await shopifyGetShop(auth);
      await supabaseAdmin.from("bridge_stores").update({ last_error: null }).eq("id", data.id);
      return { ok: true, shop_name: shop.name, currency: shop.currency };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabaseAdmin.from("bridge_stores").update({ last_error: msg }).eq("id", data.id);
      throw new Error(msg);
    }
  });

export const ponteTestCallback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: store, error } = await supabaseAdmin.from("bridge_stores").select("*").eq("id", data.id).single();
    if (error) throw new Error(error.message);
    const result = await notifyCallback(store as BridgeStoreRow, "online_status", { online: true, reason: "manual test", at: new Date().toISOString() });
    return result;
  });

export const ponteSendTestPayload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; type?: "stats_update" | "order_paid" | "online_status" }) =>
    z.object({ id: z.string().uuid(), type: z.enum(["stats_update", "order_paid", "online_status"]).optional() }).parse(input)
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: store, error } = await supabaseAdmin.from("bridge_stores").select("*").eq("id", data.id).single();
    if (error) throw new Error(error.message);
    const type = data.type ?? "stats_update";
    const samplePayload =
      type === "order_paid"
        ? { order_number: "TEST-1001", total_price: 19.9, currency: "EUR", financial_status: "paid", at: new Date().toISOString() }
        : type === "online_status"
          ? { online: true, reason: "manual test payload", at: new Date().toISOString() }
          : { products_count: 0, orders_today: 0, revenue_today: 0, at: new Date().toISOString(), test: true };
    const result = await notifyCallback(store as BridgeStoreRow, type, samplePayload);
    return { ...result, sent_type: type, sent_payload: samplePayload };
  });

export const ponteListLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { storeId?: string; dateFrom?: string; dateTo?: string }) =>
    z.object({
      storeId: z.string().uuid().optional(),
      dateFrom: z.string().datetime().optional(),
      dateTo: z.string().datetime().optional(),
    }).parse(input ?? {})
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    let q = supabaseAdmin
      .from("bridge_logs")
      .select("id,store_id,direction,endpoint,http_status,success,payload,error,created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.storeId) q = q.eq("store_id", data.storeId);
    if (data.dateFrom) q = q.gte("created_at", data.dateFrom);
    if (data.dateTo) q = q.lte("created_at", data.dateTo);
    const { data: logs, error } = await q;
    if (error) throw new Error(error.message);
    return logs;
  });

export const ponteClearLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { storeId?: string }) => z.object({ storeId: z.string().uuid().optional() }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    let q = supabaseAdmin.from("bridge_logs").delete();
    if (data.storeId) q = q.eq("store_id", data.storeId);
    else q = q.not("id", "is", null); // delete all
    const { error, count } = await q;
    if (error) throw new Error(error.message);
    return { ok: true, deleted: count ?? 0 };
  });

export const ponteGenerateApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    return { key: generateBridgeApiKey() };
  });

// ===================== WEBHOOKS UI =====================
const WEBHOOK_TOPICS_DEFAULT = ["orders/create", "orders/paid", "orders/cancelled", "orders/fulfilled"];

/** Lista webhook registrati (dal nostro DB) per uno store. */
export const ponteListWebhooks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { storeId: string }) => z.object({ storeId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: rows, error } = await supabaseAdmin
      .from("bridge_webhooks")
      .select("id,shopify_webhook_id,topic,address,format,status,last_error,created_at,updated_at")
      .eq("store_id", data.storeId)
      .order("topic", { ascending: true });
    if (error) throw new Error(error.message);
    const { data: store } = await supabaseAdmin
      .from("bridge_stores")
      .select("shop_domain")
      .eq("id", data.storeId)
      .maybeSingle();
    return { shop_domain: store?.shop_domain ?? null, webhooks: rows ?? [] };
  });

/**
 * Risincronizza la lista webhook con Shopify: chiama GET /admin/webhooks.json,
 * marca come 'missing' i nostri record che non esistono più, aggiunge i nuovi.
 */
export const ponteResyncWebhooks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { storeId: string }) => z.object({ storeId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: storeRow } = await supabaseAdmin
      .from("bridge_stores")
      .select("id,site_a_store_id,shop_domain,shopify_access_token_encrypted,shopify_api_version,user_agent,rate_limit_rps,callback_url,allowed_origin,bridge_api_key_hash,bridge_api_key_encrypted,is_active")
      .eq("id", data.storeId)
      .maybeSingle();
    if (!storeRow) throw new Error("Store non trovato");
    if (!storeRow.shopify_access_token_encrypted) throw new Error("Access token Shopify mancante. Esegui prima OAuth.");
    const auth = await getShopifyAuth(storeRow as unknown as BridgeStoreRow);

    const { shopifyListWebhooks, shopifyCreateWebhook } = await import("@/lib/bridge/shopify.server");
    const remote = await shopifyListWebhooks(auth);

    // address atteso = stesso host del callback OAuth, su /api/public/bridge/shopify-webhook.
    // Lo deduciamo dalla callback_url se presente, altrimenti da una env var nota; in mancanza,
    // usiamo il SUPABASE_URL non ha senso → fallback all'origin del primo webhook esistente.
    let webhookAddress: string | null = null;
    if (storeRow.callback_url) {
      try { webhookAddress = `${new URL(storeRow.callback_url).origin}/api/public/bridge/shopify-webhook`; } catch { /* ignore */ }
    }
    if (!webhookAddress && remote.length > 0) {
      try { webhookAddress = `${new URL(remote[0].address).origin}/api/public/bridge/shopify-webhook`; } catch { /* ignore */ }
    }

    const created: string[] = [];
    const failed: string[] = [];
    if (webhookAddress) {
      for (const topic of WEBHOOK_TOPICS_DEFAULT) {
        if (remote.some((w) => w.topic === topic && w.address === webhookAddress)) continue;
        try {
          const wh = await shopifyCreateWebhook(auth, topic, webhookAddress);
          remote.push(wh);
          created.push(topic);
        } catch (e) {
          failed.push(`${topic}: ${e instanceof Error ? e.message.slice(0, 100) : "err"}`);
        }
      }
    }

    // Sync DB: upsert tutti i remoti, marca missing i locali non più presenti
    const remoteIds = new Set(remote.map((w) => w.id));
    for (const w of remote) {
      await supabaseAdmin.from("bridge_webhooks").upsert({
        store_id: data.storeId,
        shopify_webhook_id: w.id,
        topic: w.topic,
        address: w.address,
        format: w.format,
        status: "active",
        last_error: null,
      } as never, { onConflict: "store_id,shopify_webhook_id" });
    }
    const { data: locals } = await supabaseAdmin
      .from("bridge_webhooks")
      .select("shopify_webhook_id")
      .eq("store_id", data.storeId);
    for (const l of locals ?? []) {
      if (!remoteIds.has(Number(l.shopify_webhook_id))) {
        await supabaseAdmin
          .from("bridge_webhooks")
          .update({ status: "missing" })
          .eq("store_id", data.storeId)
          .eq("shopify_webhook_id", l.shopify_webhook_id);
      }
    }

    return { ok: true, total: remote.length, created, failed, address: webhookAddress };
  });

/**
 * Salva al volo Webhook signing secret (HMAC) e/o Access token Custom App
 * direttamente dal pannello stato store, senza dover aprire la scheda completa.
 */
export const ponteSaveSecrets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; webhook_secret?: string | null; access_token?: string | null }) =>
    z.object({
      id: z.string().uuid(),
      webhook_secret: z.string().max(500).nullable().optional(),
      access_token: z.string().max(500).nullable().optional(),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const updates: Record<string, unknown> = {};
    if (data.webhook_secret !== undefined) {
      updates.shopify_webhook_secret_encrypted = data.webhook_secret
        ? await encryptString(data.webhook_secret)
        : null;
    }
    if (data.access_token !== undefined) {
      updates.shopify_access_token_encrypted = data.access_token
        ? await encryptString(data.access_token)
        : await encryptString("__pending_oauth__");
    }
    if (Object.keys(updates).length === 0) return { ok: true, updated: 0 };
    const { error } = await supabaseAdmin
      .from("bridge_stores")
      .update(updates as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, updated: Object.keys(updates).length };
  });

// ===================== REVENUE TRACKING =====================

export const ponteGetRevenueOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase;
    await assertAdmin(context.userId, db);

    const [{ data: events, error }, storesResult] = await Promise.all([
      db
        .from("bridge_revenue_events")
        .select("store_id,event_type,amount,currency,occurred_at,order_number,shopify_order_id")
        .order("occurred_at", { ascending: false }),
      db
        .from("bridge_stores")
        .select("id,shop_domain,display_name"),
    ]);
    if (error) throw new Error(error.message);
    if (storesResult.error) throw new Error(storesResult.error.message);

    const stores = storesResult.data ?? [];
    const orders = await loadRevenueOrders(stores.map((store) => store.id), db);

    const storeMap = new Map((stores ?? []).map((s) => [s.id, s]));
    const today = new Date();
    const startOfDay = startOfRomeDayIso(today);
    const startOf7d = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const startOf30d = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

    const validOrders = orders.filter((o) => !o.cancelled_at);
    const sumOrders = (rows: typeof validOrders, since?: string) =>
      rows
        .filter((r) => !since || ((r.created_at_shopify ?? "") >= since))
        .reduce((s, r) => s + Number(r.total_price || 0), 0);

    const countOrders = (rows: typeof validOrders, since?: string) => rows.filter((r) => !since || ((r.created_at_shopify ?? "") >= since)).length;
    const sumRefunds = (rows: typeof events, since?: string) =>
      (rows ?? [])
        .filter((r) => r.event_type === "order_refunded" && (!since || r.occurred_at >= since))
        .reduce((s, r) => s + Number(r.amount || 0), 0);

    const global = {
      currency: orders[0]?.currency ?? events?.[0]?.currency ?? "EUR",
      lifetime_paid: sumOrders(validOrders),
      lifetime_refunded: sumRefunds(events),
      lifetime_orders: countOrders(validOrders),
      today_paid: sumOrders(validOrders, startOfDay),
      today_orders: countOrders(validOrders, startOfDay),
      week_paid: sumOrders(validOrders, startOf7d),
      month_paid: sumOrders(validOrders, startOf30d),
    };

    // Per-store
    const byStore = Array.from(storeMap.values()).map((s) => {
      const rows = validOrders.filter((e) => e.store_id === s.id);
      const refundRows = (events ?? []).filter((e) => e.store_id === s.id);
      return {
        store_id: s.id,
        shop_domain: s.shop_domain,
        display_name: s.display_name,
        currency: rows[0]?.currency ?? refundRows[0]?.currency ?? "EUR",
        lifetime_paid: sumOrders(rows),
        lifetime_refunded: sumRefunds(refundRows),
        today_paid: sumOrders(rows, startOfDay),
        today_orders: countOrders(rows, startOfDay),
        orders_count: countOrders(rows),
      };
    }).sort((a, b) => b.lifetime_paid - a.lifetime_paid);

    // Daily series last 30 days
    const dayMap = new Map<string, { paid: number; refunded: number; orders: number }>();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 3600 * 1000);
      const key = romeDayKey(d);
      dayMap.set(key, { paid: 0, refunded: 0, orders: 0 });
    }
    for (const e of validOrders) {
      const occurredAt = e.created_at_shopify ?? "";
      if (!occurredAt || occurredAt < startOf30d) continue;
      const key = romeDayKey(new Date(occurredAt));
      const cur = dayMap.get(key);
      if (!cur) continue;
      cur.paid += Number(e.total_price || 0);
      cur.orders += 1;
    }
    for (const e of events ?? []) {
      if (e.event_type !== "order_refunded" || e.occurred_at < startOf30d) continue;
      const key = romeDayKey(new Date(e.occurred_at));
      const cur = dayMap.get(key);
      if (!cur) continue;
      cur.refunded += Number(e.amount || 0);
    }
    const daily = Array.from(dayMap.entries()).map(([day, v]) => ({ day, ...v, net: v.paid - v.refunded }));

    // Recent events (last 25)
    const recent = validOrders.slice(0, 25).map((e) => ({
      shopify_order_id: e.shopify_order_id,
      event_type: (e.financial_status === "paid" || e.financial_status === "partially_paid") ? "order_paid" : "order_created",
      amount: e.total_price,
      currency: e.currency,
      occurred_at: e.created_at_shopify ?? new Date().toISOString(),
      order_number: e.order_number,
      shop_domain: storeMap.get(e.store_id)?.shop_domain ?? null,
    }));

    return { global, byStore, daily, recent };
  });

// ===================== FULL SHOPIFY REVENUE BACKFILL =====================
// Scarica tutti gli ordini paid (lifetime) da Shopify per ogni store attivo
// e popola bridge_revenue_events come fonte autoritativa. Idempotente grazie
// al unique (store_id, shopify_order_id, event_type).
export const ponteSyncRevenueAllStores = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase;
    await assertAdmin(context.userId, db);

    const { data: stores, error } = await db
      .from("bridge_stores")
      .select("*")
      .eq("is_active", true);
    if (error) throw new Error(error.message);

    const results: Array<{ store_id: string; shop_domain: string; imported: number; error?: string }> = [];

    for (const store of stores ?? []) {
      try {
        const auth = await getShopifyAuth(store as BridgeStoreRow);
        // Cursor-based pagination lifetime su tutti gli ordini utili del negozio.
        let imported = 0;
        const orders = await shopifyListOrdersPaginated(
          { ...auth, store_id: undefined },
          { status: "any", limit: 250 },
          5000
        );
        const seen = new Set<string>();
        for (const o of orders) {
          const key = String(o.id);
          if (seen.has(key)) continue;
          seen.add(key);
          const amount = Number(o.total_price ?? 0);
          const occurredAt = o.created_at ?? new Date().toISOString();
          await db.from("bridge_orders").upsert({
            store_id: store.id,
            shopify_order_id: key,
            order_number: o.name ?? null,
            total_price: amount || null,
            currency: o.currency ?? null,
            financial_status: o.financial_status ?? null,
            cancelled_at: o.cancelled_at ?? null,
            created_at_shopify: occurredAt,
            notified_at: new Date().toISOString(),
          }, { onConflict: "store_id,shopify_order_id" });
          await db.from("bridge_revenue_events").upsert({
            store_id: store.id,
            shopify_order_id: key,
            event_type: o.financial_status === "paid" || o.financial_status === "partially_paid" ? "order_paid" : "order_created",
            amount,
            currency: o.currency ?? null,
            order_number: o.name ?? null,
            occurred_at: occurredAt,
          } as never, { onConflict: "store_id,shopify_order_id,event_type" });
          imported++;
        }
        results.push({ store_id: store.id, shop_domain: store.shop_domain, imported });
        await db
          .from("bridge_stores")
          .update({ last_sync_at: new Date().toISOString(), last_error: null })
          .eq("id", store.id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ store_id: store.id, shop_domain: store.shop_domain, imported: 0, error: msg });
      }
    }
    return { ok: true, results };
  });

// ===================== WHOP SYNC =====================

async function whopFetch(apiKey: string, path: string, init?: RequestInit) {
  const token = apiKey.trim().replace(/^Bearer\s+/i, "");
  if (/^whsec_/i.test(token)) {
    throw new Error("Nel campo Whop API key hai incollato il webhook secret (whsec_...). Serve una Company API key Whop; il webhook secret va nel campo dedicato.");
  }
  let res: Response;
  try {
    res = await fetch(`https://api.whop.com${path}`, {
      ...init,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Rete non raggiungibile su ${path}: ${msg}`);
  }
  const txt = await res.text();
  let json: Record<string, unknown> | null = null;
  try { json = txt ? (JSON.parse(txt) as Record<string, unknown>) : null; } catch { /* keep raw */ }
  if (!res.ok) {
    // Whop può restituire { message }, { error }, { errors: [...] }, o testo HTML
    let detail = "";
    if (json) {
      // Whop spesso annida: { error: { type, message } }
      const errObj = json.error as Record<string, unknown> | string | undefined;
      if (typeof json.message === "string") detail = json.message;
      else if (typeof errObj === "string") detail = errObj;
      else if (errObj && typeof errObj === "object" && typeof errObj.message === "string") detail = errObj.message as string;
      else if (Array.isArray(json.errors)) detail = json.errors.map((e) => typeof e === "string" ? e : JSON.stringify(e)).join("; ");
      else detail = JSON.stringify(json).slice(0, 300);
    } else {
      detail = txt.slice(0, 200) || res.statusText;
    }
    // Permessi mancanti (può tornare come 400/401/403 con messaggio "missing ... permissions: x:y:z")
    const permMatch = detail.match(/missing[^:]*permissions?:\s*([a-z0-9_:,\s]+)/i);
    if (permMatch) {
      const scopes = permMatch[1].trim().replace(/\s+/g, " ");
      throw new Error(`Whop ${res.status} su ${path}: alla tua API key mancano i permessi richiesti: ${scopes}. Vai su whop.com/dashboard → Developer → API Keys → modifica la chiave e abilita questi scope, poi riprova.`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Whop ${res.status} su ${path}: API key non valida o senza permessi (${detail})`);
    }
    if (res.status === 404) {
      throw new Error(`Whop 404 su ${path}: endpoint non trovato. La sync usa l'API REST attuale (/api/v1): controlla che la chiave sia una Company/API key valida, non il webhook secret.`);
    }
    if (res.status === 422 || res.status === 400) {
      throw new Error(`Whop ${res.status} su ${path}: payload rifiutato — ${detail}`);
    }
    throw new Error(`Whop ${res.status} su ${path}: ${detail}`);
  }

  return (json ?? {}) as Record<string, unknown>;
}

function whopTitle(title: string) {
  return title.length > 80 ? `${title.slice(0, 77)}...` : title;
}

function normalizeWhopCompanyId(value?: string | null) {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const match = raw.match(/\b(?:biz|company)_[a-z0-9_-]+\b/i);
  return (match?.[0] ?? raw.replace(/\/+$/, "")).trim() || null;
}

/** Lista degli store con checkout_provider = 'whop' o 'native' (entrambi usano l'iframe Whop). */
export const ponteListWhopStores = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase;
    await assertAdmin(context.userId, db);
    const { data, error } = await db
      .from("bridge_stores")
      .select("id,display_name,shop_domain,custom_domains,checkout_provider,whop_api_key_encrypted,whop_company_id,whop_plan_id,sync_key")
      .in("checkout_provider", ["whop", "native"])
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? [])
      .filter((s) => !!s.whop_api_key_encrypted)
      .map((s) => ({
        id: s.id,
        display_name: s.display_name,
        shop_domain: s.shop_domain,
        custom_domains: (s as { custom_domains?: string[] | null }).custom_domains ?? null,
        checkout_provider: s.checkout_provider,
        sync_key: (s as { sync_key?: string | null }).sync_key ?? null,
        has_whop_company_id: !!(
          normalizeWhopCompanyId((s as { whop_company_id?: string | null }).whop_company_id) ??
          normalizeWhopCompanyId((s as { whop_plan_id?: string | null }).whop_plan_id)
        ),
      }));
  });

// Assegna/aggiorna la "sync key" di uno store (usata da Site A per indirizzare il prodotto)
export const ponteSetStoreSyncKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { storeId: string; sync_key: string | null }) =>
    z.object({
      storeId: z.string().uuid(),
      sync_key: z.string().min(2).max(64).regex(/^[a-z0-9][a-z0-9-_]*$/i).nullable(),
    }).parse(i)
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    await assertAdmin(context.userId, db);
    const normalized = data.sync_key ? data.sync_key.trim().toLowerCase() : null;
    const { error } = await db
      .from("bridge_stores")
      .update({ sync_key: normalized } as never)
      .eq("id", data.storeId);
    if (error) throw new Error(error.message);
    return { ok: true, sync_key: normalized };
  });

/**
 * Sincronizza i prodotti selezionati su Whop:
 * - Per ogni prodotto crea (o riusa) un Product su Whop e un Plan one-time
 * - Salva whop_product_id e whop_plan_id in shop_products
 * - Il checkout iframe userà https://whop.com/checkout/{plan_id}?embed=true
 */
export const ponteSyncProductsToWhop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { storeId: string; productIds: string[] }) =>
    z.object({
      storeId: z.string().uuid(),
      productIds: z.array(z.string().uuid()).min(1).max(200),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);

    const { data: store, error: storeErr } = await supabaseAdmin
      .from("bridge_stores")
      .select("id,whop_api_key_encrypted,checkout_provider,whop_company_id,whop_plan_id")
      .eq("id", data.storeId)
      .maybeSingle();
    if (storeErr) throw new Error(storeErr.message);
    if (!store) throw new Error("Store non trovato");
    if (!store.whop_api_key_encrypted) throw new Error("API key Whop non configurata per questo store");

    const apiKey = await decryptString(store.whop_api_key_encrypted);
    if (!apiKey) throw new Error("API key Whop non decifrabile");
    const companyId =
      normalizeWhopCompanyId((store as { whop_company_id?: string | null }).whop_company_id) ??
      normalizeWhopCompanyId((store as { whop_plan_id?: string | null }).whop_plan_id);
    if (!companyId) {
      throw new Error("Whop Company ID non salvato nello store. La sync ora salta sempre /api/v1/companies: apri lo store, incolla il valore biz_XXXXX preso dall'URL del dashboard Whop e salva prima di riprovare.");
    }


    const { data: products, error: prodErr } = await supabaseAdmin
      .from("shop_products")
      .select("id,title,description,price,currency,image_url,whop_product_id,whop_plan_id")
      .in("id", data.productIds);
    if (prodErr) throw new Error(prodErr.message);

    const results: { id: string; title: string; ok: boolean; plan_id?: string; product_id?: string; error?: string }[] = [];

    for (const p of products ?? []) {
      try {
        let productId = (p as { whop_product_id?: string | null }).whop_product_id ?? null;
        let planId = (p as { whop_plan_id?: string | null }).whop_plan_id ?? null;

        // 1) Crea Product su Whop se mancante
        if (!productId) {
          const created = await whopFetch(apiKey, "/api/v1/products", {
            method: "POST",
            body: JSON.stringify({
              company_id: companyId,
              title: whopTitle(p.title),
              description: p.description ?? p.title,
              visibility: "visible",
              collect_shipping_address: true,
              metadata: { bridge_product_id: p.id },
            }),
          });
          productId = String(created.id ?? "");
          if (!productId) throw new Error("Whop non ha restituito un product id");
        }

        // 2) Crea Plan one-time legato al product
        if (!planId) {
          const plan = await whopFetch(apiKey, "/api/v1/plans", {
            method: "POST",
            body: JSON.stringify({
              company_id: companyId,
              product_id: productId,
              plan_type: "one_time",
              release_method: "buy_now",
              title: whopTitle(p.title),
              description: p.description ?? p.title,
              initial_price: Number(p.price),
              currency: (p.currency ?? "EUR").toLowerCase(),
              visibility: "visible",
              unlimited_stock: true,
              metadata: { bridge_product_id: p.id },
            }),
          });
          planId = String(plan.id ?? "");
          if (!planId) throw new Error("Whop non ha restituito un plan id");
        }

        await supabaseAdmin
          .from("shop_products")
          .update({
            whop_product_id: productId,
            whop_plan_id: planId,
            whop_synced_at: new Date().toISOString(),
            whop_sync_error: null,
            bridge_store_id: data.storeId,
          } as never)
          .eq("id", p.id);

        results.push({ id: p.id, title: p.title, ok: true, product_id: productId, plan_id: planId });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await supabaseAdmin
          .from("shop_products")
          .update({ whop_sync_error: msg } as never)
          .eq("id", p.id);
        results.push({ id: p.id, title: p.title, ok: false, error: msg });
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    return { ok: true, synced: okCount, total: results.length, results };
  });

// ---------- Spedizioni (metodi di spedizione del checkout nativo) ----------
const ShippingInput = z.object({
  id: z.string().uuid().optional(),
  label: z.string().min(1).max(120),
  description: z.string().max(300).nullable().optional(),
  price: z.number().min(0).max(100000),
  delivery_estimate: z.string().max(120).nullable().optional(),
  free_over: z.number().min(0).max(1000000).nullable().optional(),
  sort_order: z.number().int().min(0).max(999).optional(),
  is_active: z.boolean().optional(),
});

export const ponteListShipping = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("shipping_methods")
      .select("id,label,description,price,delivery_estimate,free_over,sort_order,is_active,created_at")
      .order("sort_order", { ascending: true })
      .order("price", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const ponteUpsertShipping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof ShippingInput>) => ShippingInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const row = {
      label: data.label,
      description: data.description ?? null,
      price: data.price,
      delivery_estimate: data.delivery_estimate ?? null,
      free_over: data.free_over ?? null,
      sort_order: data.sort_order ?? 0,
      is_active: data.is_active ?? true,
    };
    if (data.id) {
      const { error } = await supabaseAdmin.from("shipping_methods").update(row as never).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: created, error } = await supabaseAdmin.from("shipping_methods").insert(row as never).select("id").single();
    if (error) throw new Error(error.message);
    return { id: (created as { id: string }).id };
  });

export const ponteDeleteShipping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin.from("shipping_methods").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---- Apple Pay per-store ----
export const ponteListApplePayStores = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("bridge_stores")
      .select("id, display_name, shop_domain, custom_domains, apple_pay_verification")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<{
      id: string; display_name: string | null; shop_domain: string;
      custom_domains: string[] | null; apple_pay_verification: string | null;
    }>;
  });

export const ponteSetApplePay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; content: string | null; public_domain?: string | null }) =>
    z.object({
      id: z.string().uuid(),
      content: z.string().max(20000).nullable(),
      public_domain: z.string().max(255).nullable().optional(),
    }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const update: Record<string, unknown> = {
      apple_pay_verification: data.content?.trim() || null,
    };
    if (data.public_domain !== undefined) {
      const dom = (data.public_domain || "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
      update.custom_domains = dom ? [dom] : null;
    }
    const { error } = await supabaseAdmin.from("bridge_stores").update(update as never).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
