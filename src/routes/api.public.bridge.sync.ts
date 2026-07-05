import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/runtime-supabase-admin";
import {
  authInboundRequest,
  corsPreflight,
  getShopifyAuth,
  handleError,
  jsonResponse,
  logBridge,
} from "@/lib/bridge/auth.server";
import { shopifyGetShop, shopifyListOrders, shopifyListProducts } from "@/lib/bridge/shopify.server";

// Sito A invia SOLO store_id. Sito B risolve shop_domain internamente.
const Body = z.object({
  store_id: z.string().uuid(),
  since: z.string().datetime().optional(),
}).strip();

function startOfTodayIso() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export const Route = createFileRoute("/api/public/bridge/sync")({
  server: {
    handlers: {
      OPTIONS: async () => corsPreflight(),
      POST: async ({ request }) => {
        const endpoint = "/api/public/bridge/sync";
        try {
          const apiKey = request.headers.get("X-Bridge-Api-Key");
          const body = Body.parse(await request.json());
          const store = await authInboundRequest(apiKey, body.store_id);

          let store_online = false;
          let shopifyError: string | null = null;
          let daily_orders = 0;
          let daily_revenue = 0;
          let total_orders = 0;
          let total_revenue = 0;
          let variants: Array<{ handle: string; id: number; title: string; label: string; price: string }> = [];

          try {
            const auth = await getShopifyAuth(store);
            await shopifyGetShop(auth);
            store_online = true;

            const today = await shopifyListOrders(auth, { status: "any", created_at_min: startOfTodayIso(), limit: 100 });
            const last30 = new Date();
            last30.setDate(last30.getDate() - 30);
            const recent = await shopifyListOrders(auth, { status: "any", created_at_min: last30.toISOString(), limit: 250 });

            const sumPaid = (list: typeof today) =>
              list
                .filter((o) => !o.cancelled_at && (o.financial_status === "paid" || o.financial_status === "partially_paid"))
                .reduce((acc, o) => acc + Number(o.total_price || 0), 0);

            daily_orders = today.filter((o) => !o.cancelled_at).length;
            daily_revenue = sumPaid(today);
            total_orders = recent.filter((o) => !o.cancelled_at).length;
            total_revenue = sumPaid(recent);

            const products = await shopifyListProducts(auth, 50);
            variants = products.flatMap((p) =>
              p.variants.map((v) => ({
                handle: p.handle,
                id: v.id,
                title: `${p.title} — ${v.title}`,
                label: v.title,
                price: v.price,
              }))
            );
          } catch (error) {
            shopifyError = error instanceof Error ? error.message : String(error);
          }

          const isShopifyAuthFailed =
            !!shopifyError && (shopifyError.includes("401") || shopifyError.includes("__pending_oauth__") || shopifyError.toLowerCase().includes("non ancora collegato"));

          await supabaseAdmin.from("bridge_stores").update({ last_sync_at: new Date().toISOString(), last_error: shopifyError }).eq("id", store.id);
          await logBridge({ store_id: store.id, direction: "inbound", endpoint, http_status: 200, success: true, payload: { store_online, daily_orders, total_orders, variants_count: variants.length, shopify_error: shopifyError } });

          if (isShopifyAuthFailed) {
            return jsonResponse({
              ok: false,
              store_online: false,
              error: "shopify_auth_failed",
              message: "Token Shopify invalido, scaduto o non ancora generato. Apri il Sito Ponte → Connetti con Shopify per (ri)autorizzare lo store.",
              shopify_status: 401,
              shopify_error: shopifyError,
            });
          }

          return jsonResponse({ ok: true, store_online, daily_orders, daily_revenue, total_orders, total_revenue, variants, shopify_error: shopifyError });
        } catch (e) {
          return handleError(e, endpoint);
        }
      },
    },
  },
});
