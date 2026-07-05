import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/lib/runtime-supabase-admin";
import { getShopifyAuth, logBridge, notifyCallback, type BridgeStoreRow } from "@/lib/bridge/auth.server";
import { shopifyListOrders } from "@/lib/bridge/shopify.server";
import { syncAuthoritativeRevenueSnapshot, upsertRevenueEvent } from "@/lib/bridge/revenue.server";
import { jsonResponse } from "@/lib/bridge/auth.server";

export const Route = createFileRoute("/api/public/bridge/cron-poll")({
  server: {
    handlers: {
      POST: async () => {
        const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        const { data: stores, error } = await supabaseAdmin
          .from("bridge_stores")
          .select("*")
          .eq("is_active", true);
        if (error) return jsonResponse({ ok: false, error: error.message }, { status: 500 });
        let scanned = 0, notified = 0;
        for (const raw of stores ?? []) {
          const store = raw as BridgeStoreRow;
          try {
            const auth = await getShopifyAuth(store);
            const orders = await shopifyListOrders(auth, { status: "any", updated_at_min: since, limit: 50 });
            scanned += orders.length;
            for (const o of orders) {
              if (o.cancelled_at) continue;
              if (o.financial_status !== "paid") continue;
              const { data: existing } = await supabaseAdmin
                .from("bridge_orders")
                .select("id,notified_at")
                .eq("store_id", store.id)
                .eq("shopify_order_id", String(o.id))
                .maybeSingle();
              if (existing?.notified_at) continue;
              await supabaseAdmin.from("bridge_orders").upsert({
                store_id: store.id,
                shopify_order_id: String(o.id),
                order_number: o.name,
                total_price: Number(o.total_price),
                currency: o.currency,
                financial_status: o.financial_status,
                cancelled_at: o.cancelled_at,
                created_at_shopify: o.created_at,
                notified_at: new Date().toISOString(),
              }, { onConflict: "store_id,shopify_order_id" });
              await upsertRevenueEvent({
                storeId: store.id,
                shopifyOrderId: String(o.id),
                eventType: "order_paid",
                amount: Number(o.total_price),
                currency: o.currency,
                orderNumber: o.name,
                occurredAt: o.created_at,
              });
              await notifyCallback(store, "order_paid", { shopify_order_id: String(o.id), amount: Number(o.total_price), currency: o.currency });
              await syncAuthoritativeRevenueSnapshot(store);
              notified++;
            }
          } catch (e) {
            await logBridge({ store_id: store.id, direction: "shopify", endpoint: "cron-poll", success: false, error: e instanceof Error ? e.message : String(e) });
          }
        }
        return jsonResponse({ ok: true, scanned, notified });
      },
    },
  },
});
