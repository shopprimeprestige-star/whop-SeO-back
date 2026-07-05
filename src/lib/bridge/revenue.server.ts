import { supabaseAdmin } from "@/lib/runtime-supabase-admin";
import { getShopifyAuth, notifyCallback, type BridgeStoreRow } from "./auth.server";
import { shopifyComputeRevenueSnapshot } from "./shopify.server";

export type RevenueEventType = "order_created" | "order_paid" | "order_cancelled" | "order_refunded";

export async function upsertRevenueEvent(params: {
  storeId: string;
  shopifyOrderId: string;
  eventType: RevenueEventType;
  amount: number;
  currency: string | null;
  orderNumber: string | null;
  occurredAt: string;
}) {
  await supabaseAdmin.from("bridge_revenue_events").upsert(
    {
      store_id: params.storeId,
      shopify_order_id: params.shopifyOrderId,
      event_type: params.eventType,
      amount: params.amount,
      currency: params.currency,
      order_number: params.orderNumber,
      occurred_at: params.occurredAt,
    } as never,
    { onConflict: "store_id,shopify_order_id,event_type" }
  );
}

export async function syncAuthoritativeRevenueSnapshot(store: BridgeStoreRow) {
  const auth = await getShopifyAuth(store);
  const snapshot = await shopifyComputeRevenueSnapshot(auth);
  const callback = await notifyCallback(store, "revenue_update", snapshot);
  return { snapshot, callback };
}