import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/lib/runtime-supabase-admin";
import { decryptString } from "@/lib/bridge/crypto.server";

// Default scopes the bridge needs to read products/orders and create draft orders
const DEFAULT_SCOPES = "read_products,read_orders,write_draft_orders";

export const Route = createFileRoute("/api/public/bridge/shopify-oauth/start")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const storeId = url.searchParams.get("store_id");
        if (!storeId) return new Response("Missing store_id", { status: 400 });

        const { data: store, error } = await supabaseAdmin
          .from("bridge_stores")
          .select("id,shop_domain,shopify_api_key_encrypted")
          .eq("id", storeId)
          .maybeSingle();
        if (error || !store) return new Response("Store not found", { status: 404 });
        if (!store.shopify_api_key_encrypted) {
          return new Response("Salva prima il Client ID (Shopify API key) sullo store, poi clicca Connetti.", { status: 400 });
        }

        let clientId: string;
        try {
          clientId = await decryptString(store.shopify_api_key_encrypted);
        } catch {
          return new Response("Impossibile leggere il Client ID salvato.", { status: 500 });
        }
        if (!clientId) return new Response("Client ID vuoto", { status: 400 });

        // nonce + state for CSRF
        const nonce = crypto.randomUUID().replace(/-/g, "");
        const state = `${store.id}.${nonce}`;
        const redirectUri = `${url.origin}/api/public/bridge/shopify-oauth/callback`;

        const authUrl = new URL(`https://${store.shop_domain}/admin/oauth/authorize`);
        authUrl.searchParams.set("client_id", clientId);
        authUrl.searchParams.set("scope", DEFAULT_SCOPES);
        authUrl.searchParams.set("redirect_uri", redirectUri);
        authUrl.searchParams.set("state", state);
        authUrl.searchParams.set("grant_options[]", "");

        return new Response(null, {
          status: 302,
          headers: {
            Location: authUrl.toString(),
            "Set-Cookie": `bridge_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
          },
        });
      },
    },
  },
});
