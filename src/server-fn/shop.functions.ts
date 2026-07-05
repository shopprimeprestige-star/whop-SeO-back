import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/runtime-supabase-admin";
import { getShopifyAuth, logBridge, type BridgeStoreRow } from "@/lib/bridge/auth.server";
import { shopifyCreateCustomDraftOrder, type CustomLineItemInput } from "@/lib/bridge/shopify.server";
import { applyQuantityDiscount } from "@/lib/quantity-breaks";
import { buildWashUrl } from "@/lib/bridge/referrer";
import { getRequest } from "@tanstack/react-start/server";

// ============= LIST CATEGORIES =============
export const shopListCategories = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { data, error } = await supabaseAdmin
      .from("shop_categories")
      .select("id,slug,name,description,image_url,sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  } catch (error) {
    console.error("shopListCategories fallback", error);
    return [];
  }
});

// ============= LIST PRODUCTS =============
export const shopListProducts = createServerFn({ method: "POST" })
  .inputValidator((input: { categorySlug?: string; featured?: boolean; limit?: number }) =>
    z.object({
      categorySlug: z.string().optional(),
      featured: z.boolean().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }).parse(input)
  )
  .handler(async ({ data }) => {
    try {
      let q = supabaseAdmin
        .from("shop_products")
        .select("id,slug,title,price,compare_at_price,currency,image_url,brand,featured,category_id,shop_categories(slug,name)")
        .eq("published", true)
        .eq("source", "native")
        .eq("hidden_from_listing", false)
        .order("sort_order", { ascending: true })
        .limit(data.limit ?? 60);
      if (data.featured) q = q.eq("featured", true);
      if (data.categorySlug) {
        const { data: cat } = await supabaseAdmin
          .from("shop_categories")
          .select("id")
          .eq("slug", data.categorySlug)
          .maybeSingle();
        if (cat) q = q.eq("category_id", cat.id);
        else return [];
      }
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      return rows ?? [];
    } catch (error) {
      console.error("shopListProducts fallback", error);
      return [];
    }
  });

// ============= GET PRODUCT BY SLUG =============
export const shopGetProduct = createServerFn({ method: "POST" })
  .inputValidator((input: { slug: string }) => z.object({ slug: z.string().min(1).max(200) }).parse(input))
  .handler(async ({ data }) => {
    const { data: product, error } = await supabaseAdmin
      .from("shop_products")
      .select("*,shop_categories(slug,name)")
      .eq("slug", data.slug)
      .eq("published", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!product) return getSyncedProductBySlug(data.slug);
    const { data: variants } = await supabaseAdmin
      .from("shop_variants")
      .select("id,label,size,color,sku,price_override,stock,shopify_variant_label,sort_order")
      .eq("product_id", product.id)
      .order("sort_order", { ascending: true });
    return { product, variants: variants ?? [] };
  });

type JsonRecord = Record<string, unknown>;

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mapSyncedVariants(productId: string, raw: unknown, fallbackPrice: number) {
  const rows = Array.isArray(raw) ? raw : [];
  const mapped = rows.map((item, idx) => {
    const row = item && typeof item === "object" ? item as JsonRecord : {};
    const externalRef = getString(row.external_ref) ?? getString(row.id) ?? getString(row.sku) ?? String(idx + 1);
    const label = getString(row.label) ?? getString(row.title) ?? getString(row.name) ?? "Default";
    const price = getNumber(row.price_override) ?? getNumber(row.price) ?? fallbackPrice;
    const available = typeof row.available === "boolean" ? row.available : true;
    return {
      id: `synced:${productId}:${externalRef}`,
      label,
      size: getString(row.size),
      color: getString(row.color),
      sku: getString(row.sku) ?? externalRef,
      price_override: price,
      stock: available ? 999 : 0,
      shopify_variant_label: label,
      sort_order: idx,
    };
  });
  return mapped.length > 0 ? mapped : [{
    id: `synced:${productId}:default`,
    label: "Default",
    size: null,
    color: null,
    sku: null,
    price_override: fallbackPrice,
    stock: 999,
    shopify_variant_label: "Default",
    sort_order: 0,
  }];
}

async function getSyncedProductBySlug(slug: string) {
  const { data: rows, error } = await supabaseAdmin.rpc("get_public_synced_product_by_slug" as never, { _slug: slug } as never);
  if (error) throw new Error(error.message);
  const row = Array.isArray(rows) ? rows[0] as {
    source: string; id: string; slug: string; title: string; description: string | null; price: number | null;
    compare_at_price: number | null; currency: string | null; image_url: string | null; gallery: unknown; variants: unknown; prd_code: string;
  } | undefined : undefined;
  if (!row) return null;
  const price = Number(row.price ?? 0);
  return {
    product: {
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: row.description,
      long_description: row.description,
      price,
      compare_at_price: row.compare_at_price,
      currency: row.currency ?? "EUR",
      image_url: row.image_url,
      gallery: Array.isArray(row.gallery) ? row.gallery : [],
      brand: "Atelier Nord",
      category_id: null,
      featured: false,
      published: true,
      sort_order: 0,
      prd_code: row.prd_code,
      shop_categories: null,
      source: row.source,
      hidden_from_listing: true,
      material: null,
    },
    variants: mapSyncedVariants(row.id, row.variants, price),
  };
}

// ============= CHECKOUT — multi-line draft order =============
// Accetta un carrello con N items (anche prodotti diversi e/o varianti diverse)
// e li raggruppa per bridge_store, generando UN draft order per store con tutte
// le righe come custom line items mascherate (title=PRD code, sku=PRD code).
const CartItemInput = z.object({
  productSlug: z.string().min(1).max(200),
  variantId: z.string().uuid(),
  quantity: z.number().int().min(1).max(10),
});

export const shopCreateCheckout = createServerFn({ method: "POST" })
  .inputValidator((input: { items?: Array<z.input<typeof CartItemInput>>; productSlug?: string; variantId?: string; quantity?: number; sessionId?: string }) =>
    z.object({
      items: z.array(CartItemInput).min(1).max(20).optional(),
      // Legacy single-item
      productSlug: z.string().min(1).max(200).optional(),
      variantId: z.string().uuid().optional(),
      quantity: z.number().int().min(1).max(10).optional(),
      sessionId: z.string().max(120).optional(),
    }).parse(input)
  )
  .handler(async ({ data }) => {
    const inputItems = data.items && data.items.length > 0
      ? data.items
      : data.productSlug && data.variantId
        ? [{ productSlug: data.productSlug, variantId: data.variantId, quantity: data.quantity ?? 1 }]
        : [];
    if (inputItems.length === 0) return { ok: false as const, error: "no_items" as const };

    // Carica prodotti + varianti dal DB
    const slugs = Array.from(new Set(inputItems.map((i) => i.productSlug)));
    const variantIds = Array.from(new Set(inputItems.map((i) => i.variantId)));
    const { data: products } = await supabaseAdmin
      .from("shop_products")
      .select("id,slug,title,price,bridge_store_id,prd_code,whop_plan_id,whop_product_id")
      .in("slug", slugs);
    const { data: variants } = await supabaseAdmin
      .from("shop_variants")
      .select("id,product_id,label,shopify_variant_label,price_override")
      .in("id", variantIds);
    if (!products || products.length === 0) return { ok: false as const, error: "product_not_found" as const };

    const productBySlug = new Map(products.map((p) => [p.slug, p]));
    const variantById = new Map((variants ?? []).map((v) => [v.id, v]));

    // Determina il bridge_store: usa il primo prodotto, fallback al primo store attivo
    let effectiveBridgeStoreId: string | null = null;
    for (const it of inputItems) {
      const p = productBySlug.get(it.productSlug);
      if (p?.bridge_store_id) { effectiveBridgeStoreId = p.bridge_store_id; break; }
    }
    if (!effectiveBridgeStoreId) {
      const { data: firstActive } = await supabaseAdmin
        .from("bridge_stores")
        .select("id")
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (firstActive) effectiveBridgeStoreId = firstActive.id;
    }

    // Costruisce le custom line items
    const customItems: CustomLineItemInput[] = [];
    for (const it of inputItems) {
      const p = productBySlug.get(it.productSlug);
      const v = variantById.get(it.variantId);
      if (!p || !v) continue;
      const unitBase = Number(v.price_override ?? p.price);
      const unitDiscounted = applyQuantityDiscount(unitBase, it.quantity);
      customItems.push({
        title: p.prd_code,
        sku: p.prd_code,
        price: unitDiscounted,
        quantity: it.quantity,
        variant_property_label: v.shopify_variant_label ?? v.label,
      });
    }
    if (customItems.length === 0) return { ok: false as const, error: "variant_not_found" as const };

    // Demo mode se non c'è bridge store
    if (!effectiveBridgeStoreId) {
      const first = inputItems[0];
      return {
        ok: true as const,
        demo: true as const,
        redirect_url: `/shop/checkout/demo?p=${first.productSlug}&v=${first.variantId}&q=${first.quantity}`,
      };
    }

    const { data: store } = await supabaseAdmin
      .from("bridge_stores")
      .select("*")
      .eq("id", effectiveBridgeStoreId)
      .maybeSingle();
    if (!store) return { ok: false as const, error: "bridge_store_missing" as const };

    // Whop / Native checkout: usa iframe Whop con il plan_id del primo prodotto
    const provider = (store as { checkout_provider?: string | null }).checkout_provider ?? "shopify";
    if (provider === "whop" || provider === "native") {
      const firstItem = inputItems[0];
      const firstProduct = productBySlug.get(firstItem.productSlug);
      const planId = (firstProduct as { whop_plan_id?: string | null } | undefined)?.whop_plan_id;
      if (!planId) {
        return {
          ok: false as const,
          error: "whop_not_synced" as const,
          message: "Prodotto non ancora sincronizzato con Whop. L'admin deve sincronizzare i prodotti.",
        };
      }
      return {
        ok: true as const,
        demo: false as const,
        whop: true as const,
        plan_id: planId,
        redirect_url: `/shop/checkout/whop?plan=${encodeURIComponent(planId)}`,
      };
    }

    try {
      const auth = await getShopifyAuth(store as BridgeStoreRow);
      const draft = await shopifyCreateCustomDraftOrder(auth, {
        items: customItems,
        currency: "EUR",
        metadata: {
          tags: store.default_tags ?? null,
          note: store.default_order_note ?? null,
          note_attributes: [
            { name: "items", value: customItems.map((c) => `${c.sku} x${c.quantity}`).join(", ") },
            ...(data.sessionId ? [{ name: "session_id", value: data.sessionId }] : []),
          ],
        },
      });
      await logBridge({
        store_id: store.id,
        direction: "shopify",
        endpoint: "/admin/api/draft_orders.json",
        http_status: 200,
        success: true,
        payload: {
          items: customItems.map((c) => ({ sku: c.sku, qty: c.quantity, price: c.price })),
          draft_id: draft.id,
        },
      });
      const reqUrl = (() => { try { return getRequest().url; } catch { return undefined; } })();
      const firstSlug = inputItems[0]?.productSlug;
      const refPath = firstSlug ? `/shop/prodotto/${firstSlug}` : "/shop";
      const washed = await buildWashUrl(draft.invoice_url, reqUrl, refPath);
      return { ok: true as const, demo: false as const, redirect_url: washed };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await logBridge({
        store_id: store.id,
        direction: "shopify",
        endpoint: "/admin/api/draft_orders.json",
        http_status: 500,
        success: false,
        payload: { items: customItems.map((c) => ({ sku: c.sku, qty: c.quantity })) },
        error: message,
      });
      return { ok: false as const, error: "checkout_failed" as const, message };
    }
  });
