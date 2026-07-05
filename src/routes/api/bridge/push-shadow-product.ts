// POST /api/bridge/push-shadow-product
// Crea/aggiorna un "shadow product" su Shopify (handle PRD-XXXXX, DRAFT, no immagini)
// a partire da un prodotto del Sito A. Restituisce variant_map (external_ref → gid variante).
//
// Auth: Authorization: Bearer <key> (fallback X-Bridge-Api-Key) — timing-safe vs bridge_stores.bridge_api_key_hash.
// Non espone mai access token Shopify nella response.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/runtime-supabase-admin";
import { safeEqual, sha256Hex } from "@/lib/bridge/crypto.server";
import { getShopifyAuth } from "@/lib/bridge/auth.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Bridge-Api-Key",
  "Access-Control-Max-Age": "86400",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

type RuntimeGlobal = typeof globalThis & {
  __PONTE_WORKER_ENV__?: Record<string, unknown>;
};

class PushEndpointError extends Error {
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

function readRuntimeEnv(name: string): string | undefined {
  const fromProcess = typeof process === "undefined" ? undefined : process.env?.[name];
  if (typeof fromProcess === "string" && fromProcess.trim()) return fromProcess.trim();

  const workerEnv = (globalThis as RuntimeGlobal).__PONTE_WORKER_ENV__;
  const fromWorker = workerEnv?.[name];
  return typeof fromWorker === "string" && fromWorker.trim() ? fromWorker.trim() : undefined;
}

function validateRuntimeEnvironment() {
  const supabaseUrl = readRuntimeEnv("SUPABASE_URL") || readRuntimeEnv("VITE_SUPABASE_URL");
  const serviceRoleKey = readRuntimeEnv("SUPABASE_SERVICE_ROLE_KEY");
  const missing = [
    ...(!supabaseUrl ? ["SUPABASE_URL"] : []),
    ...(!serviceRoleKey ? ["SUPABASE_SERVICE_ROLE_KEY"] : []),
  ];

  if (missing.length > 0) {
    throw new PushEndpointError(
      500,
      `Missing runtime environment variable(s): ${missing.join(", ")}`,
      "environment_validation",
      { missing },
    );
  }
}

const VariantSchema = z.object({
  label: z.string().min(1).max(200),
  price: z.number().nonnegative().max(1_000_000),
  compare_price: z.number().nonnegative().max(1_000_000).optional().nullable(),
  available: z.boolean().optional(),
  external_ref: z.string().min(1).max(200),
});

const Body = z.object({
  source_store_id: z.string().min(1).max(200),
  source_product_id: z.string().min(1).max(200),
  shadow_handle: z.string().regex(/^PRD-\d{5}$/),
  shadow_title: z.string().min(1).max(255),
  visibility: z.literal("hidden"),
  published: z.literal(false),
  hide_from_search: z.boolean(),
  hide_from_collections: z.boolean(),
  no_images: z.boolean(),
  variants: z.array(VariantSchema).min(1).max(50),
}).strip();

function extractApiKey(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (auth) {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }
  const x = request.headers.get("x-bridge-api-key") ?? request.headers.get("X-Bridge-Api-Key");
  return x ? x.trim() : null;
}

async function logPush(entry: {
  site_a_store_id: string | null;
  source_product_id: string | null;
  shadow_handle: string | null;
  shopify_product_id?: string | null;
  http_status: number;
  outcome: string;
  error?: string | null;
  ip?: string | null;
}) {
  try {
    await supabaseAdmin.from("bridge_push_log").insert({
      site_a_store_id: entry.site_a_store_id,
      source_product_id: entry.source_product_id,
      shadow_handle: entry.shadow_handle,
      shopify_product_id: entry.shopify_product_id ?? null,
      http_status: entry.http_status,
      outcome: entry.outcome,
      error: entry.error ?? null,
      ip: entry.ip ?? null,
    });
  } catch (e) {
    console.error("[push-shadow-product] log failed", e);
  }
}

interface ShopifyAuthCtx {
  shop_domain: string;
  access_token: string;
  api_version: string;
  user_agent?: string;
}

async function shopifyGraphQL<T>(
  auth: ShopifyAuthCtx,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const res = await fetch(
    `https://${auth.shop_domain}/admin/api/${auth.api_version}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": auth.access_token,
        Accept: "application/json",
        "User-Agent": auth.user_agent || "Mozilla/5.0 (compatible; DealBridgeBot/1.0)",
      },
      body: JSON.stringify({ query, variables }),
    }
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`shopify_http_${res.status}: ${text.slice(0, 300)}`);
  }
  let parsed: { data?: T; errors?: Array<{ message: string }> };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`shopify_bad_json: ${text.slice(0, 200)}`);
  }
  if (parsed.errors?.length) {
    throw new Error(`shopify_gql_error: ${parsed.errors.map((e) => e.message).join("; ")}`);
  }
  if (!parsed.data) throw new Error("shopify_empty_response");
  return parsed.data;
}

const PRODUCT_CREATE_MUTATION = /* GraphQL */ `
  mutation pushShadow($input: ProductInput!) {
    productCreate(input: $input) {
      product {
        id
        handle
        status
        variants(first: 100) {
          edges {
            node {
              id
              title
              sku
            }
          }
        }
      }
      userErrors { field message }
    }
  }
`;

const PRODUCT_UPDATE_MUTATION = /* GraphQL */ `
  mutation updateShadow($input: ProductInput!) {
    productUpdate(input: $input) {
      product {
        id
        handle
        status
        variants(first: 100) {
          edges {
            node {
              id
              title
              sku
            }
          }
        }
      }
      userErrors { field message }
    }
  }
`;

type VariantEdge = { node: { id: string; title: string; sku: string | null } };

interface ProductCreateResult {
  productCreate?: {
    product?: {
      id: string;
      handle: string;
      status: string;
      variants: { edges: VariantEdge[] };
    } | null;
    userErrors?: Array<{ field: string[]; message: string }>;
  };
}

interface ProductUpdateResult {
  productUpdate?: {
    product?: {
      id: string;
      handle: string;
      status: string;
      variants: { edges: VariantEdge[] };
    } | null;
    userErrors?: Array<{ field: string[]; message: string }>;
  };
}

export const Route = createFileRoute("/api/bridge/push-shadow-product")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const request_id = crypto.randomUUID();
        let step = "initialization";
        let details: Record<string, unknown> = {};

        try {
          step = "environment_validation";
          validateRuntimeEnvironment();

          const ip =
            request.headers.get("cf-connecting-ip") ||
            request.headers.get("x-forwarded-for") ||
            null;
          const apiKey = extractApiKey(request);

          // ---- Validation ----
          step = "body_validation";
          let body: z.infer<typeof Body>;
          try {
            body = Body.parse(await request.json());
          } catch (e) {
            const msg = e instanceof Error ? e.message : "invalid_body";
            await logPush({
              site_a_store_id: null,
              source_product_id: null,
              shadow_handle: null,
              http_status: 400,
              outcome: "invalid_body",
              error: msg,
              ip,
            });
            return json(400, { ok: false, error: "invalid_body", step, request_id, details: { message: msg } });
          }

          // ---- Auth ----
          step = "store_lookup";
          const { data: store, error: storeErr } = await supabaseAdmin
            .from("bridge_stores")
            .select("*")
            .eq("site_a_store_id", body.source_store_id)
            .maybeSingle();

          if (storeErr) {
            details = { message: storeErr.message, code: storeErr.code, hint: storeErr.hint, table: "bridge_stores" };
            await logPush({
              site_a_store_id: body.source_store_id,
              source_product_id: body.source_product_id,
              shadow_handle: body.shadow_handle,
              http_status: 500,
              outcome: "store_lookup_error",
              error: storeErr.message,
              ip,
            });
            throw new PushEndpointError(500, "Database lookup failed", step, details);
          }

        if (!store || !apiKey) {
          await logPush({
            site_a_store_id: body.source_store_id,
            source_product_id: body.source_product_id,
            shadow_handle: body.shadow_handle,
            http_status: 401,
            outcome: "invalid_api_key",
            error: !store ? "store_not_found" : "missing_api_key",
            ip,
          });
          return json(401, { ok: false, error: "invalid_api_key" });
        }

        const receivedHash = await sha256Hex(apiKey);
        const expectedHash = store.bridge_api_key_hash ?? "";
        if (!expectedHash || !safeEqual(expectedHash, receivedHash)) {
          await logPush({
            site_a_store_id: body.source_store_id,
            source_product_id: body.source_product_id,
            shadow_handle: body.shadow_handle,
            http_status: 401,
            outcome: "invalid_api_key",
            error: "hash_mismatch",
            ip,
          });
          return json(401, { ok: false, error: "invalid_api_key" });
        }

        if (!store.is_active) {
          await logPush({
            site_a_store_id: body.source_store_id,
            source_product_id: body.source_product_id,
            shadow_handle: body.shadow_handle,
            http_status: 403,
            outcome: "store_disabled",
            ip,
          });
          return json(403, { ok: false, error: "store_disabled" });
        }

        const checkoutProvider = String(store.checkout_provider || "shopify").toLowerCase();

        // ---- Native bridge: do not call Shopify, save locally and return a public product URL ----
        if (checkoutProvider !== "shopify") {
          const publicUrl = `${new URL(request.url).origin}/p/${body.shadow_handle}`;
          const nativeVariantMap = body.variants.map((v) => ({
            external_ref: v.external_ref,
            shopify_variant_id: `native:${body.shadow_handle}::${v.external_ref}`,
            native_variant_id: `native:${body.shadow_handle}::${v.external_ref}`,
            label: v.label,
            price: v.price,
            compare_price: v.compare_price ?? null,
          }));
          const nativeProductId = `native:${body.shadow_handle}`;

          const { error: upsertErr } = await supabaseAdmin
            .from("shadow_products")
            .upsert(
              {
                source_store_id: body.source_store_id,
                source_product_id: body.source_product_id,
                shadow_handle: body.shadow_handle,
                shadow_title: body.shadow_title,
                shopify_product_id: nativeProductId,
                shopify_handle: body.shadow_handle,
                product_url: publicUrl,
                variant_map: nativeVariantMap as never,
                tags: ["shadow", "hidden", "bridge"],
                status: "ok",
                last_error: null,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "source_store_id,source_product_id" }
            );

          if (upsertErr) {
            console.error("[push-shadow-product] native upsert failed", upsertErr);
            throw new PushEndpointError(500, "Shadow product save failed", "native_shadow_save", {
              message: upsertErr.message,
              code: upsertErr.code,
              hint: upsertErr.hint,
            });
          }

          await logPush({
            site_a_store_id: body.source_store_id,
            source_product_id: body.source_product_id,
            shadow_handle: body.shadow_handle,
            shopify_product_id: nativeProductId,
            http_status: 200,
            outcome: "native_bridge_ok",
            ip,
          });

          return json(200, {
            ok: true,
            mode: "native_bridge",
            shadow_handle: body.shadow_handle,
            shopify_product_id: nativeProductId,
            product_url: publicUrl,
            public_url: publicUrl,
            native_url: `native://${body.source_store_id}/${body.shadow_handle}`,
            variant_map: nativeVariantMap,
            request_id,
          });
        }

        // ---- Already exists? (idempotency on source_store_id + source_product_id) ----
        const { data: existing } = await supabaseAdmin
          .from("shadow_products")
          .select("*")
          .eq("source_store_id", body.source_store_id)
          .eq("source_product_id", body.source_product_id)
          .maybeSingle();

        // ---- Shopify auth ctx ----
        let shopifyAuth: ShopifyAuthCtx;
        try {
          const a = await getShopifyAuth(store);
          shopifyAuth = {
            shop_domain: a.shop_domain,
            access_token: a.access_token,
            api_version: a.api_version,
            user_agent: a.user_agent,
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await logPush({
            site_a_store_id: body.source_store_id,
            source_product_id: body.source_product_id,
            shadow_handle: body.shadow_handle,
            http_status: 502,
            outcome: "shopify_auth_error",
            error: msg,
            ip,
          });
          return json(502, { ok: false, error: "shopify_unavailable", detail: msg });
        }

        // ---- Build ProductInput ----
        // status: DRAFT → invisibile su sitemap/search/collezioni pubbliche per default.
        // Niente immagini. Tag fissi: shadow, hidden, bridge.
        // Metafields per tracciabilità + flag hidden lato theme.
        const productInput: Record<string, unknown> = {
          title: body.shadow_title,
          handle: body.shadow_handle,
          status: "DRAFT",
          tags: ["shadow", "hidden", "bridge"],
          published: false,
          options: ["Variante"],
          variants: body.variants.map((v) => ({
            option1: v.label,
            price: v.price.toFixed(2),
            ...(typeof v.compare_price === "number"
              ? { compareAtPrice: v.compare_price.toFixed(2) }
              : {}),
            sku: `${body.shadow_handle}::${v.external_ref}`,
            inventoryPolicy: "CONTINUE",
            requiresShipping: true,
            taxable: true,
          })),
          metafields: [
            {
              namespace: "bridge",
              key: "source_product_id",
              value: body.source_product_id,
              type: "single_line_text_field",
            },
            {
              namespace: "bridge",
              key: "source_store_id",
              value: body.source_store_id,
              type: "single_line_text_field",
            },
            {
              namespace: "bridge",
              key: "hidden",
              value: "true",
              type: "single_line_text_field",
            },
          ],
        };

        // ---- Shopify create or update ----
        let shopifyProductId: string;
        let shopifyHandle: string;
        let variantEdges: VariantEdge[] = [];
        try {
          if (existing?.shopify_product_id) {
            const data = await shopifyGraphQL<ProductUpdateResult>(
              shopifyAuth,
              PRODUCT_UPDATE_MUTATION,
              { input: { id: existing.shopify_product_id, ...productInput } }
            );
            const userErrors = data.productUpdate?.userErrors ?? [];
            if (userErrors.length > 0) {
              throw new Error(
                `productUpdate userErrors: ${userErrors.map((e) => `${e.field?.join(".")}: ${e.message}`).join("; ")}`
              );
            }
            const p = data.productUpdate?.product;
            if (!p) throw new Error("productUpdate returned no product");
            shopifyProductId = p.id;
            shopifyHandle = p.handle;
            variantEdges = p.variants.edges;
          } else {
            const data = await shopifyGraphQL<ProductCreateResult>(
              shopifyAuth,
              PRODUCT_CREATE_MUTATION,
              { input: productInput }
            );
            const userErrors = data.productCreate?.userErrors ?? [];
            if (userErrors.length > 0) {
              throw new Error(
                `productCreate userErrors: ${userErrors.map((e) => `${e.field?.join(".")}: ${e.message}`).join("; ")}`
              );
            }
            const p = data.productCreate?.product;
            if (!p) throw new Error("productCreate returned no product");
            shopifyProductId = p.id;
            shopifyHandle = p.handle;
            variantEdges = p.variants.edges;
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await supabaseAdmin
            .from("shadow_products")
            .upsert(
              {
                source_store_id: body.source_store_id,
                source_product_id: body.source_product_id,
                shadow_handle: body.shadow_handle,
                shadow_title: body.shadow_title,
                tags: ["shadow", "hidden", "bridge"],
                status: "error",
                last_error: msg.slice(0, 1000),
                updated_at: new Date().toISOString(),
              },
              { onConflict: "source_store_id,source_product_id" }
            );
          await logPush({
            site_a_store_id: body.source_store_id,
            source_product_id: body.source_product_id,
            shadow_handle: body.shadow_handle,
            http_status: 502,
            outcome: "shopify_error",
            error: msg,
            ip,
          });
          return json(502, { ok: false, error: "shopify_error", detail: msg });
        }

        // ---- Build variant_map by matching SKU "<handle>::<external_ref>" ----
        const variantMap = body.variants.map((v) => {
          const expectedSku = `${body.shadow_handle}::${v.external_ref}`;
          const match = variantEdges.find((e) => e.node.sku === expectedSku);
          return {
            external_ref: v.external_ref,
            shopify_variant_id: match?.node.id ?? null,
          };
        });

        const productUrl = `https://${shopifyAuth.shop_domain}/products/${shopifyHandle}`;

        // ---- Upsert shadow_products ----
        const { error: upsertErr } = await supabaseAdmin
          .from("shadow_products")
          .upsert(
            {
              source_store_id: body.source_store_id,
              source_product_id: body.source_product_id,
              shadow_handle: body.shadow_handle,
              shadow_title: body.shadow_title,
              shopify_product_id: shopifyProductId,
              shopify_handle: shopifyHandle,
              product_url: productUrl,
              variant_map: variantMap as never,
              tags: ["shadow", "hidden", "bridge"],
              status: "ok",
              last_error: null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "source_store_id,source_product_id" }
          );

        if (upsertErr) {
          console.error("[push-shadow-product] upsert failed", upsertErr);
        }

        await logPush({
          site_a_store_id: body.source_store_id,
          source_product_id: body.source_product_id,
          shadow_handle: body.shadow_handle,
          shopify_product_id: shopifyProductId,
          http_status: 200,
          outcome: "ok",
          ip,
        });

        return json(200, {
          ok: true,
          shadow_handle: body.shadow_handle,
          shopify_product_id: shopifyProductId,
          product_url: productUrl,
          variant_map: variantMap,
        });
        } catch (error) {
          const status = error instanceof PushEndpointError ? error.status : 500;
          const errorStep = error instanceof PushEndpointError ? error.step : step;
          const errorDetails = error instanceof PushEndpointError ? error.details : details;
          const message = error instanceof Error ? error.message : String(error || "Internal bridge error");

          console.error("[bridge push-shadow-product]", {
            step: errorStep,
            error: message,
            stack: error instanceof Error ? error.stack : undefined,
            request_id,
          });

          return json(status, {
            ok: false,
            error: message || "Internal bridge error",
            step: errorStep,
            request_id,
            details: errorDetails,
          });
        }
      },
    },
  },
});
