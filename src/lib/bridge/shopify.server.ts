// Shopify Admin REST API client for the Sito Ponte.
// All calls go through fetch with timeout + retry + rate limit + custom UA. SERVER-ONLY.

import { supabaseAdmin } from "@/lib/runtime-supabase-admin";

export interface ShopifyAuth {
  shop_domain: string;
  access_token: string;
  api_version?: string;
  /** User-Agent custom per questo store. Se non impostato, il runtime usa il proprio UA naturale. */
  user_agent?: string;
  /** UUID dello store sul Sito B, usato per rate-limit per-store. */
  store_id?: string;
  /** Max richieste/sec verso Shopify (default 2 = limite REST Shopify standard). */
  rate_limit_rps?: number;
}

const DEFAULT_VERSION = "2024-10";

/**
 * Rate-limit "soft" per-store: legge bridge_rate_limits.last_call_at e attende
 * il delta minimo prima di inviare la nuova richiesta. Best-effort, non distribuito.
 */
async function awaitRateSlot(storeId: string | undefined, rps: number) {
  if (!storeId || !rps || rps <= 0) return;
  const minIntervalMs = Math.ceil(1000 / rps);
  const { data } = await supabaseAdmin
    .from("bridge_rate_limits")
    .select("last_call_at")
    .eq("store_id", storeId)
    .maybeSingle();
  const last = data?.last_call_at ? new Date(data.last_call_at).getTime() : 0;
  const wait = last + minIntervalMs - Date.now();
  if (wait > 0 && wait < 5000) {
    await new Promise((r) => setTimeout(r, wait));
  }
  await supabaseAdmin
    .from("bridge_rate_limits")
    .upsert({ store_id: storeId, last_call_at: new Date().toISOString(), updated_at: new Date().toISOString() } as never);
}

async function shopifyFetch(
  auth: ShopifyAuth,
  path: string,
  init: RequestInit = {},
  attempt = 0
): Promise<Response> {
  const version = auth.api_version ?? DEFAULT_VERSION;
  const url = `https://${auth.shop_domain}/admin/api/${version}${path}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    if (attempt === 0) {
      await awaitRateSlot(auth.store_id, auth.rate_limit_rps ?? 2);
    }
    // Header generici "browser-like" per mascherare l'origine (Lovable/Cloudflare).
    // Non rivelano mai Lovable/Supabase: UA neutro, lingua IT, accept JSON.
    const baseHeaders: Record<string, string> = {
      "X-Shopify-Access-Token": auth.access_token,
      Accept: "application/json",
      "Accept-Language": "it-IT, it;q=0.9",
      "Content-Type": "application/json",
      "User-Agent":
        auth.user_agent && auth.user_agent.trim()
          ? auth.user_agent.trim()
          : "Mozilla/5.0 (compatible; DealBridgeBot/1.0)",
    };
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { ...baseHeaders, ...(init.headers || {}) },
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      return shopifyFetch(auth, path, init, attempt + 1);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function shopifyGetShop(auth: ShopifyAuth) {
  const res = await shopifyFetch(auth, "/shop.json");
  if (!res.ok) throw new Error(`Shopify /shop.json ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { shop: { name: string; currency: string; plan_name?: string; country_name?: string; email?: string } };
  return json.shop;
}

export interface ShopifyOrder {
  id: number;
  name: string;
  total_price: string;
  current_total_price?: string;
  currency: string;
  financial_status: string | null;
  cancelled_at: string | null;
  created_at: string;
  processed_at?: string | null;
}

/** Estrae il page_info dal cursore Link header di Shopify (rel="next"). */
function parseNextPageInfo(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  // es: <https://x.myshopify.com/admin/api/2024-10/orders.json?limit=250&page_info=abc>; rel="next"
  const parts = linkHeader.split(",");
  for (const part of parts) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/);
    if (m) {
      try {
        const u = new URL(m[1]);
        return u.searchParams.get("page_info");
      } catch { /* ignore */ }
    }
  }
  return null;
}

export async function shopifyListOrders(
  auth: ShopifyAuth,
  params: Record<string, string | number>
): Promise<ShopifyOrder[]> {
  // ATTENZIONE: il parametro `page` non è più supportato da Shopify (rimosso nel 2020).
  // Per backfill multi-pagina usare shopifyListOrdersPaginated.
  const clean = { ...params };
  delete (clean as Record<string, unknown>).page;
  const qs = new URLSearchParams(Object.entries(clean).map(([k, v]) => [k, String(v)])).toString();
  const res = await shopifyFetch(auth, `/orders.json?${qs}`);
  if (!res.ok) throw new Error(`Shopify /orders.json ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { orders: ShopifyOrder[] };
  return json.orders ?? [];
}

/**
 * Backfill paginato cursor-based (page_info). Restituisce TUTTI gli ordini paid lifetime
 * fino al limite massimo richiesto (di sicurezza). Idempotente per chiamante.
 */
export async function shopifyListOrdersPaginated(
  auth: ShopifyAuth,
  baseParams: Record<string, string | number>,
  maxOrders = 5000
): Promise<ShopifyOrder[]> {
  const all: ShopifyOrder[] = [];
  // Prima richiesta: parametri completi.
  // Pagine successive: SOLO `limit` + `page_info` (Shopify rifiuta altri filtri con cursor).
  const initialParams = { ...baseParams };
  delete (initialParams as Record<string, unknown>).page;
  let qs = new URLSearchParams(Object.entries(initialParams).map(([k, v]) => [k, String(v)])).toString();
  const limit = String(initialParams.limit ?? 250);

  for (let i = 0; i < 50; i++) {
    const res = await shopifyFetch(auth, `/orders.json?${qs}`);
    if (!res.ok) throw new Error(`Shopify /orders.json ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { orders: ShopifyOrder[] };
    const orders = json.orders ?? [];
    all.push(...orders);
    if (all.length >= maxOrders) break;
    const nextPageInfo = parseNextPageInfo(res.headers.get("link") ?? res.headers.get("Link"));
    if (!nextPageInfo) break;
    // Cursor pagination: solo limit + page_info
    qs = new URLSearchParams({ limit, page_info: nextPageInfo }).toString();
  }
  return all.slice(0, maxOrders);
}

export async function shopifyComputeRevenueSnapshot(auth: ShopifyAuth) {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const [todayOrders, lifetimeOrders] = await Promise.all([
    shopifyListOrders(auth, {
      status: "any",
      created_at_min: startOfDay.toISOString(),
      limit: 250,
    }),
    shopifyListOrdersPaginated(auth, { status: "any", limit: 250 }, 5000),
  ]);

  const sumPaid = (orders: ShopifyOrder[]) => orders.reduce((total, order) => total + Number(order.current_total_price ?? order.total_price ?? 0), 0);
  const validOrders = (orders: ShopifyOrder[]) => orders.filter((order) => !order.cancelled_at);
  const currency = todayOrders[0]?.currency ?? lifetimeOrders[0]?.currency ?? null;
  const todayValid = validOrders(todayOrders);
  const lifetimeValid = validOrders(lifetimeOrders);

  return {
    currency,
    lifetime: {
      paid: sumPaid(lifetimeValid),
      refunded: 0,
      net: sumPaid(lifetimeValid),
      orders_paid: lifetimeValid.length,
    },
    today: {
      paid: sumPaid(todayValid),
      refunded: 0,
      net: sumPaid(todayValid),
      orders_paid: todayValid.length,
    },
  };
}

interface ShopifyVariant {
  id: number;
  title: string;
  price: string;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
}
interface ShopifyProduct {
  id: number;
  handle: string;
  title: string;
  variants: ShopifyVariant[];
}

export async function shopifyListProducts(auth: ShopifyAuth, limit = 50): Promise<ShopifyProduct[]> {
  const res = await shopifyFetch(auth, `/products.json?limit=${limit}`);
  if (!res.ok) throw new Error(`Shopify /products.json ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { products: ShopifyProduct[] };
  return json.products ?? [];
}

export async function shopifyGetProductByHandle(auth: ShopifyAuth, handle: string): Promise<ShopifyProduct | null> {
  const res = await shopifyFetch(auth, `/products.json?handle=${encodeURIComponent(handle)}&limit=1`);
  if (!res.ok) throw new Error(`Shopify products?handle ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { products: ShopifyProduct[] };
  return json.products?.[0] ?? null;
}

export function pickVariant(product: ShopifyProduct, label?: string | null): ShopifyVariant {
  if (!label) return product.variants[0];
  const norm = label.trim().toLowerCase();
  const match = product.variants.find((v) => {
    if (v.title?.toLowerCase() === norm) return true;
    const opts = [v.option1, v.option2, v.option3].filter(Boolean).join(" / ").toLowerCase();
    return opts === norm;
  });
  return match ?? product.variants[0];
}

/** Metadata opzionale che viene attaccato al draft order per tracciabilità lato merchant. */
export interface DraftOrderMetadata {
  tags?: string | null;
  note?: string | null;
  note_attributes?: Array<{ name: string; value: string }> | null;
  /** Se valorizzato, sovrascrive title/sku della line item per oscurare il prodotto reale. */
  line_item_label?: string | null;
}

export async function shopifyCreateDraftOrder(
  auth: ShopifyAuth,
  variantId: number,
  quantity: number,
  metadata?: DraftOrderMetadata
): Promise<{ id: number; invoice_url: string }> {
  const lineItem: Record<string, unknown> = { variant_id: variantId, quantity };
  if (metadata?.line_item_label && metadata.line_item_label.trim()) {
    const label = metadata.line_item_label.trim();
    // Override del titolo visualizzato nel checkout + SKU custom (Shopify accetta override su variant esistente)
    lineItem.title = label;
    lineItem.sku = label;
  }
  const draft_order: Record<string, unknown> = {
    line_items: [lineItem],
    use_customer_default_address: true,
  };
  if (metadata?.tags) draft_order.tags = metadata.tags;
  if (metadata?.note) draft_order.note = metadata.note;
  if (metadata?.note_attributes && metadata.note_attributes.length > 0) {
    draft_order.note_attributes = metadata.note_attributes;
  }
  const res = await shopifyFetch(auth, "/draft_orders.json", {
    method: "POST",
    body: JSON.stringify({ draft_order }),
  });
  if (!res.ok) throw new Error(`Shopify /draft_orders ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { draft_order: { id: number; invoice_url: string } };
  return json.draft_order;
}

/**
 * Crea un Draft Order Shopify con un *custom line item* (no variant_id).
 * Usato dal flusso "mascherato": Sito A invia codice PRD + prezzo + variante,
 * Shopify accetta qualsiasi titolo/SKU/prezzo senza richiedere un prodotto reale nel catalogo.
 */
export interface CustomLineItemInput {
  title: string;
  sku: string;
  price: number;
  quantity: number;
  variant_property_label?: string | null;
}

export async function shopifyCreateCustomDraftOrder(
  auth: ShopifyAuth,
  input: {
    items?: CustomLineItemInput[];
    // Backward-compat: singolo line item
    title?: string;
    sku?: string;
    price?: number;
    quantity?: number;
    variant_property_label?: string | null;
    currency?: string;
    /** BCP-47 (es. "de-CH"). Forwarded to Shopify as customer_locale. */
    locale?: string;
    metadata?: DraftOrderMetadata;
  }
): Promise<{ id: number; invoice_url: string }> {
  const items: CustomLineItemInput[] =
    input.items && input.items.length > 0
      ? input.items
      : [
          {
            title: input.title!,
            sku: input.sku!,
            price: input.price!,
            quantity: input.quantity!,
            variant_property_label: input.variant_property_label ?? null,
          },
        ];
  const presentmentCurrency = input.currency?.toUpperCase();

  // ------------------------------------------------------------------
  // GraphQL draftOrderCreate: rispetta presentmentCurrencyCode SENZA
  // applicare conversione FX. Il `price` inviato in `lineItems[].priceOverride`
  // viene interpretato nella presentment currency richiesta.
  // L'API REST /draft_orders.json invece tratta `price` come shop-currency
  // e poi converte → mostra l'importo sbagliato sul checkout.
  // ------------------------------------------------------------------
  if (presentmentCurrency) {
    const lineItemsGql = items.map((it) => {
      const customAttributes: Array<{ key: string; value: string }> = [];
      if (it.variant_property_label && it.variant_property_label.trim()) {
        customAttributes.push({ key: "Variante", value: it.variant_property_label.trim() });
      }
      return {
        title: it.title,
        sku: it.sku,
        quantity: it.quantity,
        requiresShipping: true,
        taxable: true,
        // Per custom line items Shopify usa originalUnitPriceWithCurrency come
        // prezzo sorgente “bloccato” nella presentment currency del draft.
        // priceOverride è pensato soprattutto per variant/catalog items e può
        // comunque innescare riallineamenti/FX inattesi nel checkout.
        originalUnitPriceWithCurrency: {
          amount: Number(it.price).toFixed(2),
          currencyCode: presentmentCurrency,
        },
        ...(customAttributes.length > 0 ? { customAttributes } : {}),
      };
    });

    const draftInput: Record<string, unknown> = {
      lineItems: lineItemsGql,
      presentmentCurrencyCode: presentmentCurrency,
      useCustomerDefaultAddress: true,
    };
    // NOTE: GraphQL DraftOrderInput non supporta customerLocale né noteAttributes
    // (sono campi REST). Locale viene ignorato; le note_attributes vengono
    // mappate su customAttributes a livello di draft order.
    if (input.metadata?.tags) {
      draftInput.tags = input.metadata.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    }
    if (input.metadata?.note) draftInput.note = input.metadata.note;
    if (input.metadata?.note_attributes && input.metadata.note_attributes.length > 0) {
      draftInput.customAttributes = input.metadata.note_attributes.map((a) => ({
        key: a.name,
        value: a.value,
      }));
    }
    if (input.locale) {
      const localeAttr = { key: "_locale", value: input.locale };
      const existing = (draftInput.customAttributes as Array<{ key: string; value: string }> | undefined) ?? [];
      draftInput.customAttributes = [...existing, localeAttr];
    }

    const mutation = `
      mutation draftOrderCreate($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder {
            id
            legacyResourceId
            invoiceUrl
          }
          userErrors { field message }
        }
      }
    `;
    const version = auth.api_version ?? DEFAULT_VERSION;
    const res = await shopifyFetch(auth, `/graphql.json`, {
      method: "POST",
      body: JSON.stringify({ query: mutation, variables: { input: draftInput } }),
    });
    if (!res.ok) {
      throw new Error(`Shopify /draft_orders ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as {
      data?: {
        draftOrderCreate?: {
          draftOrder?: { id: string; legacyResourceId: string; invoiceUrl: string } | null;
          userErrors?: Array<{ field: string[]; message: string }>;
        };
      };
      errors?: Array<{ message: string }>;
    };
    void version;
    if (json.errors?.length) {
      throw new Error(`Shopify /draft_orders 422: ${JSON.stringify({ errors: { base: json.errors.map((e) => e.message) } })}`);
    }
    const userErrors = json.data?.draftOrderCreate?.userErrors ?? [];
    if (userErrors.length > 0) {
      throw new Error(`Shopify /draft_orders 422: ${JSON.stringify({ errors: { base: userErrors.map((e) => e.message) } })}`);
    }
    const draft = json.data?.draftOrderCreate?.draftOrder;
    if (!draft || !draft.invoiceUrl) {
      throw new Error(`Shopify /draft_orders 502: empty draftOrder response`);
    }
    return { id: Number(draft.legacyResourceId), invoice_url: draft.invoiceUrl };
  }

  // ------------------------------------------------------------------
  // Fallback REST: usato SOLO quando non è specificata una presentment
  // currency (es. shop single-currency). Mantiene comportamento legacy.
  // ------------------------------------------------------------------
  const line_items = items.map((it) => {
    const li: Record<string, unknown> = {
      title: it.title,
      sku: it.sku,
      price: Number(it.price).toFixed(2),
      quantity: it.quantity,
      requires_shipping: true,
      taxable: true,
    };
    if (it.variant_property_label && it.variant_property_label.trim()) {
      li.properties = [{ name: "Variante", value: it.variant_property_label.trim() }];
    }
    return li;
  });
  const draft_order: Record<string, unknown> = {
    line_items,
    use_customer_default_address: true,
  };
  if (input.locale) draft_order.customer_locale = input.locale;
  if (input.metadata?.tags) draft_order.tags = input.metadata.tags;
  if (input.metadata?.note) draft_order.note = input.metadata.note;
  if (input.metadata?.note_attributes && input.metadata.note_attributes.length > 0) {
    draft_order.note_attributes = input.metadata.note_attributes;
  }
  const res = await shopifyFetch(auth, "/draft_orders.json", {
    method: "POST",
    body: JSON.stringify({ draft_order }),
  });
  if (!res.ok) throw new Error(`Shopify /draft_orders ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { draft_order: { id: number; invoice_url: string } };
  return json.draft_order;
}
export async function shopifyListOldOpenDrafts(auth: ShopifyAuth, olderThanDays = 7, limit = 250) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);
  const qs = new URLSearchParams({
    status: "open",
    updated_at_max: cutoff.toISOString(),
    limit: String(limit),
  }).toString();
  const res = await shopifyFetch(auth, `/draft_orders.json?${qs}`);
  if (!res.ok) throw new Error(`Shopify list drafts ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { draft_orders: Array<{ id: number; updated_at: string; status: string; order_id: number | null }> };
  return json.draft_orders ?? [];
}

export async function shopifyDeleteDraft(auth: ShopifyAuth, draftId: number): Promise<boolean> {
  const res = await shopifyFetch(auth, `/draft_orders/${draftId}.json`, { method: "DELETE" });
  return res.ok;
}

// ===================== WEBHOOKS =====================

export interface ShopifyWebhook {
  id: number;
  topic: string;
  address: string;
  format: string;
  created_at: string;
  updated_at: string;
}

export async function shopifyListWebhooks(auth: ShopifyAuth): Promise<ShopifyWebhook[]> {
  const res = await shopifyFetch(auth, "/webhooks.json");
  if (!res.ok) throw new Error(`Shopify /webhooks.json ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { webhooks: ShopifyWebhook[] };
  return json.webhooks ?? [];
}

export async function shopifyCreateWebhook(
  auth: ShopifyAuth,
  topic: string,
  address: string,
  format: "json" | "xml" = "json"
): Promise<ShopifyWebhook> {
  const res = await shopifyFetch(auth, "/webhooks.json", {
    method: "POST",
    body: JSON.stringify({ webhook: { topic, address, format } }),
  });
  if (!res.ok) throw new Error(`Shopify create webhook ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { webhook: ShopifyWebhook };
  return json.webhook;
}

export async function shopifyDeleteWebhook(auth: ShopifyAuth, id: number): Promise<boolean> {
  const res = await shopifyFetch(auth, `/webhooks/${id}.json`, { method: "DELETE" });
  return res.ok;
}
