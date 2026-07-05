// POST /api/public/bridge/get-config
// Restituisce la configurazione Shopify dello store, con secret SEMPRE mascherati.
// Auth: header X-Bridge-Api-Key + body.store_id (shop_domain ignorato per design).
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  authInboundRequest,
  corsPreflight,
  getShopifyAuth,
  handleError,
  jsonResponse,
  logBridge,
  type BridgeStoreRow,
} from "@/lib/bridge/auth.server";
import { decryptString } from "@/lib/bridge/crypto.server";
import { shopifyListWebhooks } from "@/lib/bridge/shopify.server";

const Body = z.object({
  store_id: z.string().uuid(),
  shop_domain: z.string().optional(), // ignorato per design (Sito A non deve conoscere shop_domain)
});

function maskSecret(s: string | null, visible = 4): string | null {
  if (!s) return null;
  if (s.length <= visible) return "•".repeat(s.length);
  const tail = s.slice(-visible);
  return `${s.slice(0, Math.min(6, s.length - visible))}••••${tail}`;
}

async function safeDecrypt(enc: string | null | undefined): Promise<string | null> {
  if (!enc) return null;
  try {
    const v = await decryptString(enc);
    return v && v !== "__pending_oauth__" ? v : null;
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/public/bridge/get-config")({
  server: {
    handlers: {
      OPTIONS: async () => corsPreflight(),
      POST: async ({ request }) => {
        const endpoint = "/api/public/bridge/get-config";
        try {
          const apiKey = request.headers.get("X-Bridge-Api-Key");
          const raw = (await request.json().catch(() => ({}))) as unknown;
          const body = Body.parse(raw);
          const store = (await authInboundRequest(apiKey, body.store_id)) as BridgeStoreRow & {
            shopify_api_key_encrypted: string | null;
            shopify_api_secret_encrypted: string | null;
          };

          const access_token = await safeDecrypt(store.shopify_access_token_encrypted);
          const client_id = await safeDecrypt(store.shopify_api_key_encrypted);
          const client_secret = await safeDecrypt(store.shopify_api_secret_encrypted);
          const webhook_secret = await safeDecrypt(store.shopify_webhook_secret_encrypted);

          // Topics live da Shopify
          let webhook_topics: Array<{ topic: string; address: string; format: string }> = [];
          let token_status: "valid" | "invalid" | "unknown" = "unknown";
          if (access_token) {
            try {
              const auth = await getShopifyAuth(store);
              const hooks = await shopifyListWebhooks(auth);
              webhook_topics = hooks.map((h) => ({ topic: h.topic, address: h.address, format: h.format }));
              token_status = "valid";
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              token_status = /\b401\b/.test(msg) ? "invalid" : "unknown";
            }
          }

          const payload = {
            shop_domain: store.shop_domain,
            access_token_masked: maskSecret(access_token),
            has_access_token: !!access_token,
            client_id: client_id ?? null,
            client_secret_masked: maskSecret(client_secret),
            has_client_secret: !!client_secret,
            oauth_scopes: "read_products,write_products,read_orders,write_orders,read_draft_orders,write_draft_orders,read_inventory",
            webhook_secret_masked: maskSecret(webhook_secret),
            has_webhook_secret: !!webhook_secret,
            webhook_topics,
            token_status,
            last_validated_at: new Date().toISOString(),
          };

          await logBridge({
            store_id: store.id,
            direction: "inbound",
            endpoint,
            http_status: 200,
            success: true,
            payload: { token_status, topics_count: webhook_topics.length },
          });

          return jsonResponse(payload);
        } catch (e) {
          return handleError(e, endpoint);
        }
      },
    },
  },
});
