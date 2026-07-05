import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  authInboundRequest,
  corsPreflight,
  getShopifyAuth,
  handleError,
  jsonResponse,
  logBridge,
} from "@/lib/bridge/auth.server";
import { decryptString, sha256Hex } from "@/lib/bridge/crypto.server";
import { shopifyCreateCustomDraftOrder, type CustomLineItemInput, type DraftOrderMetadata } from "@/lib/bridge/shopify.server";
import { pickPrdCode } from "@/lib/bridge/prd-pool";
import { buildWashUrl } from "@/lib/bridge/referrer";
import { supabaseAdmin } from "@/lib/runtime-supabase-admin";
import { normalizeWhopCompanyId, whopUpsertProductPlan, WhopApiError } from "@/lib/sync.server";

function invalidPayloadResponse(details: unknown) {
  return jsonResponse({ error: "invalid_payload", details }, { status: 400 });
}

function shopifyUpstreamError(message: string) {
  return jsonResponse({ error: "shopify_error", message }, { status: 502 });
}

/** Espande variabili tipo {product_slug} dentro stringhe configurate dall'admin. */
function expandVars(template: string, vars: Record<string, string | number | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined || v === null ? "" : String(v);
  });
}

function buildDraftMetadata(
  store: { default_tags?: string | null; default_order_note?: string | null; default_note_attributes?: unknown },
  vars: Record<string, string | number | undefined>
): DraftOrderMetadata {
  const tags = store.default_tags ? expandVars(store.default_tags, vars) : null;
  const note = store.default_order_note ? expandVars(store.default_order_note, vars) : null;
  let note_attributes: Array<{ name: string; value: string }> = [];
  if (Array.isArray(store.default_note_attributes)) {
    note_attributes = (store.default_note_attributes as Array<{ name?: string; value?: string }>)
      .filter((a) => a && a.name)
      .map((a) => ({ name: String(a.name), value: expandVars(String(a.value ?? ""), vars) }));
  }
  return { tags, note, note_attributes };
}

// ============= INPUT SCHEMA =============
// Flusso mascherato: Sito A invia SOLO dati fittizi (prd_code, titolo PRD, prezzo,
// variante). Sito B NON cerca alcun prodotto su Shopify: crea un Draft Order
// con line items custom (title/price/sku impostati a mano).
//
// VALUTA + LINGUA: Sito A è la sola fonte di verità. Sito B inoltra a Shopify
// ESATTAMENTE i valori ricevuti, senza convertire né tradurre nulla.
const Item = z.object({
  product_slug: z.string().min(1).max(200).optional(),
  product_handle: z.string().min(1).max(200).optional(),
  product_title: z.string().max(200).optional(),
  sku: z.string().max(80).optional(),
  variant_label: z.string().max(200).nullable().optional(),
  quantity: z.number().int().min(1).max(99).default(1),
  price: z.number().nonnegative().max(1_000_000).optional(),
  compare_at_price: z.number().nonnegative().max(1_000_000).nullable().optional(),
  currency: z.string().length(3).optional(),
  image_url: z.string().url().max(2000).optional(),
  prd_code: z.string().min(3).max(40).regex(/^[A-Z0-9-]+$/).optional(),
  // Stable Site A identifiers (Site A is source of truth for product identity)
  source_product_id: z.string().min(1).max(200).optional(),
  source_product_code: z.string().min(1).max(80).optional(),
  source_product_slug: z.string().min(1).max(200).optional(),
}).transform((it) => ({
  ...it,
  product_slug: it.product_slug ?? it.product_handle ?? "",
}));

// shop_domain è completamente RIMOSSO. Sito A invia esclusivamente store_id.
const Body = z.object({
  store_id: z.string().uuid(),
  session_id: z.string().max(120).optional(),
  // Multi-line cart (preferito) — `line_items` è alias di `items`.
  items: z.array(Item).min(1).max(20).optional(),
  line_items: z.array(Item).min(1).max(20).optional(),
  // Legacy single-item fields
  product_slug: z.string().min(1).max(200).optional(),
  product_handle: z.string().min(1).max(200).optional(),
  product_title: z.string().max(200).optional(),
  sku: z.string().max(80).optional(),
  variant_label: z.string().max(200).nullable().optional(),
  quantity: z.number().int().min(1).max(99).optional(),
  price: z.number().nonnegative().max(1_000_000).optional(),
  prd_code: z.string().min(3).max(40).regex(/^[A-Z0-9-]+$/).optional(),
  // Valuta/lingua top-level — Sito B le inoltra "as-is" a Shopify.
  currency: z.string().length(3).optional(),
  presentment_currency: z.string().length(3).optional(),
  locale: z.string().min(2).max(20).optional(),
  language: z.string().min(2).max(10).optional(),
  country: z.string().min(2).max(3).optional(),
  customer_locale: z.string().min(2).max(20).optional(),
  buyer_locale: z.string().min(2).max(20).optional(),
  accept_language: z.string().max(200).optional(),
}).strip();

type CheckoutBody = z.infer<typeof Body>;
type CheckoutItem = z.infer<typeof Item>;

function itemLabel(item: Record<string, unknown>, index: number) {
  return String(item.product_title || item.title || item.prd_code || item.sku || item.product_slug || `Item ${index + 1}`).slice(0, 80);
}

type WhopCheckoutOutcome =
  | { ok: true; path: string; plan_id: string; whop_checkout_url: string | null; reused: boolean }
  | { ok: false; reason: string; detail?: Record<string, unknown> };

async function createWhopCheckoutPathForSession(sessionId: string, currency: string): Promise<WhopCheckoutOutcome> {
  // Use SECURITY DEFINER RPC: bypasses RLS, works even when worker uses anon key.
  const { data: lookupRaw, error: lookupErr } = await supabaseAdmin.rpc("bridge_lookup_session_for_whop" as never, { _session_id: sessionId } as never);
  if (lookupErr) return { ok: false, reason: "lookup_rpc_failed", detail: { message: lookupErr.message, code: lookupErr.code, hint: lookupErr.hint } };
  const lookup = (lookupRaw && typeof lookupRaw === "object" ? lookupRaw : {}) as Record<string, unknown>;
  if (lookup.ok !== true) return { ok: false, reason: String(lookup.reason ?? "lookup_failed") };

  const session = lookup.session as Record<string, unknown>;
  const store = lookup.store as Record<string, unknown>;
  const shadow = (lookup.shadow ?? null) as Record<string, unknown> | null;
  const bridgeStoreId = String(store.id);
  const metadata = (session.metadata && typeof session.metadata === "object" && !Array.isArray(session.metadata) ? session.metadata : {}) as Record<string, unknown>;

  if ((String(store.checkout_provider ?? "")).toLowerCase() !== "native") return { ok: false, reason: "checkout_provider_not_native" };
  if (!store.whop_api_key_encrypted) return { ok: false, reason: "missing_whop_api_key" };
  if (!store.whop_company_id) return { ok: false, reason: "missing_whop_company_id" };

  // Fast path: already linked.
  if (typeof metadata.whop_plan_id === "string" && metadata.whop_plan_id) {
    const whopUrl = typeof metadata.whop_checkout_url === "string" ? metadata.whop_checkout_url : null;
    return { ok: true, path: `/shop/checkout/whop?plan=${encodeURIComponent(metadata.whop_plan_id)}`, plan_id: metadata.whop_plan_id, whop_checkout_url: whopUrl, reused: true };
  }

  let apiKey: string;
  try { apiKey = (await decryptString(String(store.whop_api_key_encrypted))).trim(); }
  catch (e) { return { ok: false, reason: "whop_api_key_decrypt_failed", detail: { message: String(e) } }; }
  if (!apiKey) return { ok: false, reason: "whop_api_key_empty" };
  if (apiKey.startsWith("v1:")) return { ok: false, reason: "whop_api_key_still_encrypted_legacy" };

  const companyId = normalizeWhopCompanyId(String(store.whop_company_id));
  if (!companyId) return { ok: false, reason: "invalid_whop_company_id" };

  const items = Array.isArray(session.items) ? session.items as Array<Record<string, unknown>> : [];
  const amount = Number(session.amount_total ?? items.reduce((sum, item) => sum + Number(item.unit_price ?? item.price ?? 0) * Math.max(1, Number(item.quantity ?? 1)), 0));
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: "invalid_amount", detail: { amount } };

  const sourceProductId = String(lookup.source_product_id ?? sessionId);
  const sourceProductCode = (lookup.source_product_code ?? null) as string | null;
  const sourceProductSlug = (lookup.source_product_slug ?? null) as string | null;
  const firstItem = (items[0] ?? {}) as Record<string, unknown>;

  let whopProductId: string | null = (shadow?.whop_product_id as string | null) ?? null;
  let whopPlanId: string | null = (shadow?.whop_plan_id as string | null) ?? null;
  let whopCheckoutUrl: string | null = (shadow?.whop_checkout_url as string | null) ?? null;

  if (!whopPlanId) {
    const title = items.length > 1 ? items.map(itemLabel).slice(0, 3).join(" + ") : itemLabel(items[0] ?? {}, 0);
    try {
      const result = await whopUpsertProductPlan({
        apiKey,
        companyId,
        productDbId: sourceProductId,
        title,
        description: `Checkout ${sessionId}`,
        price: amount,
        currency: String(session.currency ?? currency),
        existingWhopProductId: whopProductId,
        existingWhopPlanId: null,
      });
      whopProductId = result.whop_product_id;
      whopPlanId = result.whop_plan_id;
      whopCheckoutUrl = result.whop_checkout_url;
    } catch (e) {
      if (e instanceof WhopApiError) {
        await supabaseAdmin.rpc("bridge_save_shadow_whop_mapping" as never, {
          _bridge_store_id: bridgeStoreId,
          _session_id: sessionId,
          _source_product_id: sourceProductId,
          _source_product_code: sourceProductCode,
          _source_product_slug: sourceProductSlug,
          _title: String(firstItem.title ?? firstItem.product_title ?? ""),
          _price: amount,
          _currency: String(session.currency ?? currency),
          _whop_product_id: whopProductId,
          _whop_plan_id: null,
          _whop_checkout_url: null,
          _last_error: `whop_${e.status}: ${e.message}`.slice(0, 1000),
        } as never);
        return { ok: false, reason: "whop_api_error", detail: { whop_status: e.status, whop_body: e.body, whop_request_id: e.requestId, whop_path: e.path, message: e.message } };
      }
      return { ok: false, reason: "whop_exception", detail: { message: e instanceof Error ? e.message : String(e) } };
    }
  }

  if (!whopPlanId) return { ok: false, reason: "whop_plan_id_null" };

  await supabaseAdmin.rpc("bridge_save_shadow_whop_mapping" as never, {
    _bridge_store_id: bridgeStoreId,
    _session_id: sessionId,
    _source_product_id: sourceProductId,
    _source_product_code: sourceProductCode,
    _source_product_slug: sourceProductSlug,
    _title: String(firstItem.title ?? firstItem.product_title ?? ""),
    _price: amount,
    _currency: String(session.currency ?? currency),
    _whop_product_id: whopProductId,
    _whop_plan_id: whopPlanId,
    _whop_checkout_url: whopCheckoutUrl,
    _last_error: null,
  } as never);

  return { ok: true, path: `/shop/checkout/whop?plan=${encodeURIComponent(whopPlanId)}`, plan_id: whopPlanId, whop_checkout_url: whopCheckoutUrl, reused: !!shadow };
}

async function createNativeCheckoutResponse(args: {
  request: Request;
  endpoint: string;
  apiKey: string | null;
  body: CheckoutBody;
  rawItems: CheckoutItem[];
  presentmentCurrency: string;
  locale: string;
  acceptLanguageHeader: string | null;
}) {
  const { request, endpoint, apiKey, body, rawItems, presentmentCurrency, locale, acceptLanguageHeader } = args;
  if (!apiKey) return null;

  const nativeItems = rawItems.map((it, idx) => {
    const slug = it.product_slug || `item-${idx + 1}`;
    const prdCode = it.prd_code
      ?? it.source_product_code
      ?? (slug.match(/^prd-[a-z0-9]+$/i)
        ? slug.toUpperCase()
        : pickPrdCode(`${body.session_id ?? ""}-${idx}-${slug}`));
    const price = typeof it.price === "number" ? it.price : 0;
    // Site A's stable product id (UUID) is the authoritative identity.
    // Fallbacks: source_product_code (stable disguise) → source_product_slug → slug.
    const stableSourceId = it.source_product_id
      ?? it.source_product_code
      ?? it.source_product_slug
      ?? slug;
    return {
      product_slug: slug,
      product_handle: it.product_handle ?? slug,
      product_id: stableSourceId,
      source_product_id: stableSourceId,
      source_product_code: it.source_product_code ?? prdCode,
      source_product_slug: it.source_product_slug ?? slug,
      source_product_ref: stableSourceId,
      external_ref: it.sku ?? prdCode,
      title: it.product_title || prdCode,
      product_title: it.product_title || prdCode,
      sku: it.sku || prdCode,
      prd_code: prdCode,
      variant_label: it.variant_label ?? null,
      quantity: it.quantity ?? 1,
      unit_price: price,
      price,
      currency: presentmentCurrency,
      image_url: it.image_url,
    };
  });

  const firstStableId = nativeItems[0]?.source_product_id ?? null;

  const { data: nativeResult, error: nativeError } = await supabaseAdmin.rpc("bridge_create_native_checkout_session", {
    _store_id: body.store_id,
    _api_key_hash: await sha256Hex(apiKey),
    _items: nativeItems as never,
    _currency: presentmentCurrency,
    _locale: locale,
    _country: body.country ?? undefined,
    _metadata: {
      session_id: body.session_id ?? null,
      endpoint,
      accept_language: acceptLanguageHeader,
      source_product_id: firstStableId,
      source_product_code: nativeItems[0]?.source_product_code ?? null,
      source_product_slug: nativeItems[0]?.source_product_slug ?? null,
    } as never,
    _ip: request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || undefined,
  });

  if (nativeError) {
    return jsonResponse({ ok: false, error: "native_checkout_failed", details: { message: nativeError.message, code: nativeError.code, hint: nativeError.hint } }, { status: 500 });
  }

  const nativePayload = nativeResult && typeof nativeResult === "object" ? nativeResult as Record<string, unknown> : {};
  const nativeStatus = typeof nativePayload.status === "number" ? nativePayload.status : nativePayload.ok === true ? 200 : 500;
  if (nativePayload.ok !== true) {
    if (nativePayload.error === "checkout_provider_not_native") return null;
    const responseBody = { ...nativePayload };
    delete responseBody.status;
    return jsonResponse(responseBody, { status: nativeStatus });
  }

  const origin = new URL(request.url).origin;
  const sessionId = String(nativePayload.session_id);

  // Checkout INTERNO (iframe), nessuna integrazione con Whop.
  // Anche le sessioni create da Sito A finiscono qui.
  const redirectUrl = `${origin}/shop/checkout/demo?session=${encodeURIComponent(sessionId)}`;

  return jsonResponse({
    ok: true,
    redirect_url: redirectUrl,
    session_id: sessionId,
    currency: presentmentCurrency,
    provider: "internal",
  });

}

async function handleCheckout(request: Request, endpoint: string) {
  try {
    const explicitKey = request.headers.get("x-bridge-api-key")?.trim() || request.headers.get("X-Bridge-Api-Key")?.trim();
    const auth = request.headers.get("authorization") ?? request.headers.get("Authorization");
    const bearer = auth?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    const apiKey = explicitKey || bearer || null;
    const acceptLanguageHeader = request.headers.get("accept-language");
    const rawBody = await request.json().catch(() => null);
    const parsedBody = Body.safeParse(rawBody);
    if (!parsedBody.success) {
      return invalidPayloadResponse(parsedBody.error.issues);
    }
    const body = parsedBody.data;

    // Normalizza in array di items (accetta `items` o `line_items`)
    const rawItems = (body.items && body.items.length > 0)
      ? body.items
      : (body.line_items && body.line_items.length > 0)
        ? body.line_items
        : (body.product_slug || body.product_handle)
          ? [{
              product_slug: (body.product_slug ?? body.product_handle ?? ""),
              product_title: body.product_title,
              sku: body.sku,
              variant_label: body.variant_label,
              quantity: body.quantity ?? 1,
              price: body.price,
              prd_code: body.prd_code,
              currency: undefined as string | undefined,
              compare_at_price: undefined as number | null | undefined,
              image_url: undefined as string | undefined,
            }]
          : [];

    if (rawItems.length === 0) {
      return invalidPayloadResponse([{ path: ["items"], message: "At least one item is required" }]);
    }

    // Valuta + locale: Sito B inoltra "as-is", senza conversioni o traduzioni.
    const presentmentCurrency = (
      body.presentment_currency
      ?? body.currency
      ?? rawItems[0]?.currency
      ?? "EUR"
    ).toUpperCase();

    // Locale BCP-47. Se manca, prova a ricostruirlo da language+country, altrimenti fallback.
    const locale =
      body.customer_locale
      ?? body.buyer_locale
      ?? body.locale
      ?? (body.language && body.country ? `${body.language}-${body.country.toUpperCase()}` : undefined)
      ?? body.language
      ?? "en";

    const nativeFirstResponse = await createNativeCheckoutResponse({
      request,
      endpoint,
      apiKey,
      body,
      rawItems,
      presentmentCurrency,
      locale,
      acceptLanguageHeader,
    });
    if (nativeFirstResponse) return nativeFirstResponse;

    const store = await authInboundRequest(apiKey, body.store_id);
    const checkoutProvider = ((store as typeof store & { checkout_provider?: string | null }).checkout_provider ?? "shopify").toLowerCase();

    if (checkoutProvider === "native") {
      return jsonResponse({ ok: false, error: "native_checkout_failed", details: { reason: "native_checkout_not_available" } }, { status: 500 });
    }

    // Costruisce custom line items mascherati
    const customItems: CustomLineItemInput[] = rawItems.map((it, idx) => {
      const slug = it.product_slug || "";
      const prdCode = it.prd_code
        ?? (slug.match(/^prd-[a-z0-9]+$/i)
          ? slug.toUpperCase()
          : pickPrdCode(`${body.session_id ?? ""}-${idx}-${slug}`));
      const title = it.product_title || prdCode;
      const sku = it.sku || prdCode;
      const price = typeof it.price === "number" ? it.price : 0;
      return {
        title,
        sku,
        price,
        quantity: it.quantity ?? 1,
        variant_property_label: it.variant_label ?? null,
      };
    });

    const summary = customItems.map((c) => `${c.sku} x${c.quantity}`).join(", ");
    const metadata = buildDraftMetadata(store, {
      product_slug: rawItems.map((i) => i.product_slug || "").join(","),
      session_id: body.session_id ?? "",
      site_a_store_id: store.site_a_store_id,
      shop_domain: store.shop_domain,
      timestamp: new Date().toISOString(),
      prd_code: customItems.map((c) => c.sku).join(","),
      items_summary: summary,
      currency: presentmentCurrency,
      locale,
    });

    let redirectUrl: string | null = null;
    let shopifyError: string | null = null;
    let shopify_status: number | null = null;
    let draftId: number | null = null;
    let currencyNotSupported = false;

    try {
      const auth = await getShopifyAuth(store);
      const draft = await shopifyCreateCustomDraftOrder(auth, {
        items: customItems,
        currency: presentmentCurrency,
        locale,
        metadata,
      });
      redirectUrl = draft.invoice_url;
      draftId = draft.id;
    } catch (err) {
      shopifyError = err instanceof Error ? err.message : String(err);
      const m = shopifyError.match(/\b(401|403|404|422|429|5\d\d)\b/);
      shopify_status = m ? Number(m[1]) : null;
      // Shopify rifiuta la presentment currency con 422 + messaggio tipo
      // "Presentment currency is not enabled" o "currency ... not supported".
      // In quel caso ritorniamo l'errore strutturato richiesto dalla spec.
      if (
        shopify_status === 422 &&
        /currenc|presentment/i.test(shopifyError)
      ) {
        currencyNotSupported = true;
      }
    }

    await logBridge({
      store_id: store.id,
      direction: "inbound",
      endpoint,
      http_status: 200,
      success: !!redirectUrl,
      payload: {
        items: customItems.map((c) => ({ sku: c.sku, qty: c.quantity, price: c.price })),
        draft_id: draftId,
        redirect_url: redirectUrl,
        currency: presentmentCurrency,
        locale,
        accept_language: acceptLanguageHeader,
        shopify_error: shopifyError,
      },
      error: shopifyError,
    });

    if (!redirectUrl) {
      if (currencyNotSupported) {
        return jsonResponse(
          {
            error: "currency_not_enabled",
            currency: presentmentCurrency,
            message: shopifyError ?? `Currency ${presentmentCurrency} not enabled on Shopify Markets`,
          },
          { status: 422 }
        );
      }
      return shopifyUpstreamError(shopifyError ?? "Impossibile generare checkout");
    }

    // Forza la lingua del checkout via querystring (?locale=<bcp47>) — nessun
    // redirect aggiuntivo, Shopify lo applica direttamente alla pagina di checkout.
    let invoiceWithLocale = redirectUrl;
    try {
      const url = new URL(redirectUrl);
      url.searchParams.set("locale", locale);
      invoiceWithLocale = url.toString();
    } catch { /* keep original */ }

    const firstSlug = rawItems[0]?.product_slug;
    const refPath = firstSlug ? `/shop/prodotto/${firstSlug}` : "/shop";
    const washed = await buildWashUrl(invoiceWithLocale, request.url, refPath);
    return jsonResponse({
      redirect_url: washed,
      draft_order_id: draftId,
      currency: presentmentCurrency,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return invalidPayloadResponse(e.issues);
    }
    if (e instanceof Error && /Invalid API key|Missing X-Bridge-Api-Key|Unknown store_id/.test(e.message)) {
      return jsonResponse({ error: "invalid_api_key" }, { status: 401 });
    }
    return handleError(e, endpoint);
  }
}

export const Route = createFileRoute("/api/public/bridge/generate-checkout")({
  server: {
    handlers: {
      OPTIONS: async () => corsPreflight(),
      POST: async ({ request }) => handleCheckout(request, "/api/public/bridge/generate-checkout"),
    },
  },
});

export { handleCheckout };
