import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/runtime-supabase-admin";
import { shopifyGetProduct, shopifyPing, shopifyProductUrl } from "@/lib/shopify.server";

/* ---------------- PUBLIC ---------------- */

export const listFeaturedProducts = createServerFn({ method: "GET" }).handler(async () => {
  const { data, error } = await supabaseAdmin
    .from("compared_products")
    .select("id,title,slug,image_url,price,compare_at_price,currency,category,shopify_store_id,featured")
    .eq("published", true)
    .order("featured", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(8);
  if (error) throw new Error(error.message);

  const storeIds = Array.from(new Set(data.map((p) => p.shopify_store_id).filter(Boolean) as string[]));
  const stores = storeIds.length
    ? await supabaseAdmin.from("shopify_stores").select("id,name").in("id", storeIds)
    : { data: [] as Array<{ id: string; name: string }> };
  const storeMap = new Map((stores.data ?? []).map((s) => [s.id, s.name]));

  return data.map((p) => ({ ...p, store_name: p.shopify_store_id ? storeMap.get(p.shopify_store_id) ?? null : null }));
});

export const listProductsByCategory = createServerFn({ method: "GET" })
  .inputValidator((input: { slug: string }) => z.object({ slug: z.string().min(1).max(64) }).parse(input))
  .handler(async ({ data }) => {
    const { data: products, error } = await supabaseAdmin
      .from("compared_products")
      .select("id,title,slug,image_url,price,compare_at_price,currency,category,shopify_store_id")
      .eq("published", true)
      .eq("category", data.slug)
      .order("featured", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const storeIds = Array.from(new Set(products.map((p) => p.shopify_store_id).filter(Boolean) as string[]));
    const stores = storeIds.length
      ? await supabaseAdmin.from("shopify_stores").select("id,name").in("id", storeIds)
      : { data: [] as Array<{ id: string; name: string }> };
    const map = new Map((stores.data ?? []).map((s) => [s.id, s.name]));
    return products.map((p) => ({ ...p, store_name: p.shopify_store_id ? map.get(p.shopify_store_id) ?? null : null }));
  });

export const getProductBySlug = createServerFn({ method: "GET" })
  .inputValidator((input: { slug: string }) => z.object({ slug: z.string().min(1).max(120) }).parse(input))
  .handler(async ({ data }) => {
    const { data: product, error } = await supabaseAdmin
      .from("compared_products")
      .select("*")
      .eq("slug", data.slug)
      .eq("published", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!product) return null;

    let store: { id: string; name: string; shop_domain: string; logo_url: string | null } | null = null;
    let outboundUrl: string | null = null;
    if (product.shopify_store_id) {
      const { data: s } = await supabaseAdmin
        .from("shopify_stores")
        .select("id,name,shop_domain,logo_url")
        .eq("id", product.shopify_store_id)
        .maybeSingle();
      store = s ?? null;
      if (store && product.shopify_product_handle) {
        outboundUrl = shopifyProductUrl(store.shop_domain, product.shopify_product_handle);
      }
    }
    return { product, store, outboundUrl };
  });

export const listArticles = createServerFn({ method: "GET" }).handler(async () => {
  const { data, error } = await supabaseAdmin
    .from("articles")
    .select("id,title,slug,excerpt,cover_image,category,published_at,featured")
    .not("published_at", "is", null)
    .lte("published_at", new Date().toISOString())
    .order("featured", { ascending: false })
    .order("published_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
});

export const getArticleBySlug = createServerFn({ method: "GET" })
  .inputValidator((input: { slug: string }) => z.object({ slug: z.string().min(1).max(160) }).parse(input))
  .handler(async ({ data }) => {
    const { data: a, error } = await supabaseAdmin
      .from("articles")
      .select("*")
      .eq("slug", data.slug)
      .not("published_at", "is", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return a;
  });

/* ---------------- ADMIN (auth required) ---------------- */

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const adminListStores = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("shopify_stores")
      .select("id,name,shop_domain,currency,status,logo_url,description,created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  });

export const adminCreateStore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { name: string; shop_domain: string; storefront_access_token: string; currency?: string; logo_url?: string; description?: string }) =>
    z.object({
      name: z.string().min(1).max(120),
      shop_domain: z.string().min(3).max(255).regex(/^[a-z0-9.-]+\.myshopify\.com$/i, "Must be a *.myshopify.com domain"),
      storefront_access_token: z.string().min(10).max(255),
      currency: z.string().min(3).max(3).optional(),
      logo_url: z.string().url().optional(),
      description: z.string().max(500).optional(),
    }).parse(input)
  )
  .handler(async ({ data }) => {
    const shop = await shopifyPing(data.shop_domain, data.storefront_access_token).catch((e) => {
      throw new Error(`Shopify connection failed: ${e instanceof Error ? e.message : String(e)}`);
    });
    const { data: row, error } = await supabaseAdmin
      .from("shopify_stores")
      .insert({
        name: data.name,
        shop_domain: data.shop_domain,
        storefront_access_token: data.storefront_access_token,
        currency: data.currency ?? "EUR",
        logo_url: data.logo_url ?? null,
        description: data.description ?? `Connesso a ${shop.name}`,
      })
      .select("id,name,shop_domain")
      .single();
    if (error) throw new Error(error.message);
    return { ...row, shop_name: shop.name };
  });

export const adminTestStore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { data: s, error } = await supabaseAdmin
      .from("shopify_stores")
      .select("shop_domain,storefront_access_token")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    const shop = await shopifyPing(s.shop_domain, s.storefront_access_token ?? "");
    return { ok: true, name: shop.name };
  });

export const adminDeleteStore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin.from("shopify_stores").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminListProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("compared_products")
      .select("id,title,slug,category,price,compare_at_price,currency,featured,published,shopify_store_id,shopify_product_handle,image_url,created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  });

const productInputSchema = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(120).regex(/^[a-z0-9-]+$/, "lowercase letters, numbers and dashes only"),
  description: z.string().max(2000).optional(),
  category: z.string().min(1).max(64),
  shopify_store_id: z.string().uuid().nullable().optional(),
  shopify_product_handle: z.string().min(1).max(200).nullable().optional(),
  image_url: z.string().url().nullable().optional(),
  price: z.number().min(0).max(1_000_000).nullable().optional(),
  compare_at_price: z.number().min(0).max(1_000_000).nullable().optional(),
  currency: z.string().length(3).optional(),
  featured: z.boolean().optional(),
  published: z.boolean().optional(),
  sync_from_shopify: z.boolean().optional(),
});

export const adminUpsertProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id?: string } & z.input<typeof productInputSchema>) =>
    z.object({ id: z.string().uuid().optional() }).extend(productInputSchema.shape).parse(input)
  )
  .handler(async ({ data }) => {
    const payload = {
      title: data.title,
      slug: data.slug,
      description: data.description ?? null,
      category: data.category,
      shopify_store_id: data.shopify_store_id ?? null,
      shopify_product_handle: data.shopify_product_handle ?? null,
      image_url: data.image_url ?? null,
      price: data.price ?? null,
      compare_at_price: data.compare_at_price ?? null,
      currency: data.currency ?? "EUR",
      featured: data.featured ?? false,
      published: data.published ?? true,
    };

    if (data.sync_from_shopify && data.shopify_store_id && data.shopify_product_handle) {
      const { data: store, error: storeErr } = await supabaseAdmin
        .from("shopify_stores")
        .select("shop_domain,storefront_access_token,currency")
        .eq("id", data.shopify_store_id)
        .single();
      if (storeErr) throw new Error(storeErr.message);
      const sp = await shopifyGetProduct(store.shop_domain, store.storefront_access_token ?? "", data.shopify_product_handle);
      if (!sp) throw new Error("Product not found on Shopify");
      payload.title = payload.title || sp.title;
      payload.description = payload.description || sp.description;
      payload.image_url = payload.image_url || sp.featuredImage?.url || null;
      payload.price = Number(sp.priceRange.minVariantPrice.amount);
      payload.currency = sp.priceRange.minVariantPrice.currencyCode || store.currency || "EUR";
      const cmp = sp.compareAtPriceRange.minVariantPrice?.amount;
      payload.compare_at_price = cmp ? Number(cmp) : null;
    }

    if (data.id) {
      const { error } = await supabaseAdmin.from("compared_products").update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    } else {
      const { data: row, error } = await supabaseAdmin.from("compared_products").insert(payload).select("id").single();
      if (error) throw new Error(error.message);
      return { id: row.id };
    }
  });

export const adminDeleteProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin.from("compared_products").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


