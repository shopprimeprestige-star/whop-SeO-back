import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/lib/runtime-supabase-admin";
import { decryptString, hmacSha256Base64, safeEqual } from "@/lib/bridge/crypto.server";
import { corsPreflight, jsonResponse, logBridge, notifyCallback, type CallbackType } from "@/lib/bridge/auth.server";
import { syncAuthoritativeRevenueSnapshot, upsertRevenueEvent } from "@/lib/bridge/revenue.server";

interface ShopifyOrderPayload {
  id?: number;
  total_price?: string;
  currency?: string;
  financial_status?: string;
  cancelled_at?: string | null;
  name?: string;
  created_at?: string;
}

interface ShopifyRefundPayload {
  id?: number;
  order_id?: number;
  created_at?: string;
  transactions?: Array<{ amount?: string; currency?: string; kind?: string; status?: string }>;
}

export const Route = createFileRoute("/api/public/bridge/shopify-webhook")({
  server: {
    handlers: {
      OPTIONS: async () => corsPreflight(),
      POST: async ({ request }) => {
        const endpoint = "/api/public/bridge/shopify-webhook";
        const topic = request.headers.get("X-Shopify-Topic") ?? "";
        const shopDomainHeader = request.headers.get("X-Shopify-Shop-Domain") ?? "";
        const eventId = request.headers.get("X-Shopify-Event-Id") ?? "";
        const url = new URL(request.url);
        const storeIdParam = url.searchParams.get("store_id");

        const rawBody = await request.text();

        // LOG IMMEDIATO di OGNI webhook ricevuto, anche prima della validazione
        await logBridge({
          direction: "shopify",
          endpoint: `${endpoint} ${topic || "(no topic)"}`,
          http_status: null,
          success: true,
          payload: {
            stage: "received",
            topic,
            event_id: eventId || null,
            shop_domain: shopDomainHeader,
            store_id_param: storeIdParam,
            body: rawBody,
            headers: Object.fromEntries(request.headers.entries()),
          },
        });

        try {
          // Cerca lo store: prima per shop_domain (header standard Shopify),
          // poi per store_id query param (fallback se manualmente specificato).
          let storeQuery = supabaseAdmin.from("bridge_stores").select("*");
          if (shopDomainHeader) {
            storeQuery = storeQuery.eq("shop_domain", shopDomainHeader);
          } else if (storeIdParam) {
            storeQuery = storeQuery.eq("id", storeIdParam);
          } else {
            await logBridge({ direction: "shopify", endpoint, http_status: 400, success: false, error: "missing X-Shopify-Shop-Domain header and store_id param" });
            return jsonResponse({ ok: false, error: "missing shop identification" }, { status: 400 });
          }
          const { data: store, error } = await storeQuery.maybeSingle();
          if (error) {
            await logBridge({ direction: "shopify", endpoint, http_status: 500, success: false, error: error.message });
            return jsonResponse({ ok: false, error: error.message }, { status: 500 });
          }
          if (!store) {
            await logBridge({
              direction: "shopify",
              endpoint,
              http_status: 404,
              success: false,
              error: `store not found for shop_domain=${shopDomainHeader} store_id=${storeIdParam}`,
            });
            return jsonResponse({ ok: false, error: "store not found" }, { status: 404 });
          }

          if (!store.shopify_webhook_secret_encrypted) {
            await logBridge({ store_id: store.id, direction: "shopify", endpoint, http_status: 400, success: false, error: "webhook secret not configured for this store" });
            return jsonResponse({ ok: false, error: "webhook secret not configured" }, { status: 400 });
          }

          const sigHeader = request.headers.get("X-Shopify-Hmac-Sha256") ?? "";
          const secret = await decryptString(store.shopify_webhook_secret_encrypted);
          const expected = await hmacSha256Base64(secret, rawBody);
          if (!safeEqual(sigHeader, expected)) {
            await logBridge({
              store_id: store.id,
              direction: "shopify",
              endpoint: `${endpoint} ${topic}`,
              http_status: 401,
              success: false,
              error: "invalid HMAC",
              payload: { sig_received_len: sigHeader.length, sig_expected_len: expected.length },
            });
            return jsonResponse({ ok: false, error: "invalid signature" }, { status: 401 });
          }

          const payload = JSON.parse(rawBody) as ShopifyOrderPayload & ShopifyRefundPayload;

          let revenueChanged = false;
          let callbackType: CallbackType | null = null;
          let callbackData: Record<string, unknown> | null = null;
          const eventKey = [topic, eventId || payload.id || payload.order_id || "no-id"].join(":");
          const { data: alreadyProcessed } = await supabaseAdmin
            .from("bridge_logs")
            .select("id")
            .eq("store_id", store.id)
            .eq("direction", "shopify")
            .contains("payload", { stage: "processed", dedupe_key: eventKey })
            .limit(1)
            .maybeSingle();

          if (alreadyProcessed) {
            await logBridge({
              store_id: store.id,
              direction: "shopify",
              endpoint: `${endpoint} ${topic}`,
              http_status: 200,
              success: true,
              payload: { stage: "ignored_duplicate", topic, event_id: eventId || null, dedupe_key: eventKey, id: payload.id ?? payload.order_id },
            });
            return jsonResponse({ ok: true, ignored: true, reason: "duplicate_webhook" });
          }

          if ((topic === "orders/paid" || topic === "orders/create" || topic === "orders/updated") && payload.id) {
            const amount = payload.total_price ? Number(payload.total_price) : 0;
            const occurredAt = payload.created_at ?? new Date().toISOString();

            await supabaseAdmin.from("bridge_orders").upsert(
              {
                store_id: store.id,
                shopify_order_id: String(payload.id),
                order_number: payload.name ?? null,
                total_price: amount || null,
                currency: payload.currency ?? null,
                financial_status: payload.financial_status ?? null,
                cancelled_at: payload.cancelled_at ?? null,
                created_at_shopify: payload.created_at ?? null,
                notified_at: new Date().toISOString(),
              },
              { onConflict: "store_id,shopify_order_id" }
            );

            if (topic === "orders/create") {
              await upsertRevenueEvent({
                storeId: store.id,
                shopifyOrderId: String(payload.id),
                eventType: "order_created",
                amount,
                currency: payload.currency ?? null,
                orderNumber: payload.name ?? null,
                occurredAt,
              });
              callbackType = "order_created";
              callbackData = { shopify_order_id: String(payload.id), amount, currency: payload.currency, order_number: payload.name };
              revenueChanged = true;
            }

            if (payload.financial_status === "paid" || topic === "orders/paid") {
              await upsertRevenueEvent({
                storeId: store.id,
                shopifyOrderId: String(payload.id),
                eventType: "order_paid",
                amount,
                currency: payload.currency ?? null,
                orderNumber: payload.name ?? null,
                occurredAt,
              });
              if (topic === "orders/paid") {
                callbackType = "order_paid";
                callbackData = { shopify_order_id: String(payload.id), amount, currency: payload.currency, order_number: payload.name };
              }
              revenueChanged = true;
            }
          } else if (topic === "orders/cancelled" && payload.id) {
            await supabaseAdmin
              .from("bridge_orders")
              .update({ cancelled_at: payload.cancelled_at ?? new Date().toISOString() })
              .eq("store_id", store.id)
              .eq("shopify_order_id", String(payload.id));
            await upsertRevenueEvent({
              storeId: store.id,
              shopifyOrderId: String(payload.id),
              eventType: "order_cancelled",
              amount: 0,
              currency: payload.currency ?? null,
              orderNumber: payload.name ?? null,
              occurredAt: payload.cancelled_at ?? new Date().toISOString(),
            });
            callbackType = "order_cancelled";
            callbackData = { shopify_order_id: String(payload.id), order_number: payload.name };
            revenueChanged = true;
          } else if (topic === "refunds/create" && payload.order_id) {
            const refundAmount = (payload.transactions ?? [])
              .filter((t) => t.kind === "refund" && t.status === "success")
              .reduce((s, t) => s + Number(t.amount ?? 0), 0);
            const refundCurrency = payload.transactions?.[0]?.currency ?? null;
            await upsertRevenueEvent({
              storeId: store.id,
              shopifyOrderId: String(payload.order_id),
              eventType: "order_refunded",
              amount: refundAmount,
              currency: refundCurrency,
              orderNumber: null,
              occurredAt: payload.created_at ?? new Date().toISOString(),
            });
            callbackType = "order_refunded";
            callbackData = { shopify_order_id: String(payload.order_id), amount: refundAmount, currency: refundCurrency };
            revenueChanged = true;
          }

          if (callbackType && callbackData) {
            await notifyCallback(store, callbackType, callbackData);
          }
          if (revenueChanged) {
            await syncAuthoritativeRevenueSnapshot(store);
          }

          await logBridge({
            store_id: store.id,
            direction: "shopify",
            endpoint: `${endpoint} ${topic}`,
            http_status: 200,
            success: true,
            payload: { stage: "processed", topic, event_id: eventId || null, dedupe_key: eventKey, id: payload.id ?? payload.order_id, revenue_changed: revenueChanged, callback: callbackType },
          });
          return jsonResponse({ ok: true });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await logBridge({ direction: "shopify", endpoint: `${endpoint} ${topic}`, http_status: 500, success: false, error: msg });
          return jsonResponse({ ok: false, error: msg }, { status: 500 });
        }
      },
    },
  },
});
