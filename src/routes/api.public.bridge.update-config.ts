// POST /api/public/bridge/update-config
// Aggiorna la configurazione Shopify dello store: solo i campi presenti.
// - access_token: validato live via /shop.json (401 → 400 token invalido)
// - webhook_topics: array di stringhe topic; address SEMPRE auto-generato da Sito B
// - webhook_secret: salvato cifrato, usato come HMAC per inbound webhook
// - shop_domain nel body: IGNORATO per design (Sito A non deve conoscerlo)
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
  type BridgeStoreRow,
} from "@/lib/bridge/auth.server";
import { decryptString, encryptString } from "@/lib/bridge/crypto.server";
import {
  shopifyCreateWebhook,
  shopifyDeleteWebhook,
  shopifyGetShop,
  shopifyListWebhooks,
} from "@/lib/bridge/shopify.server";

const Body = z.object({
  store_id: z.string().uuid(),
  shop_domain: z.string().optional(), // ignorato
  access_token: z.string().min(10).max(500).optional(),
  client_id: z.string().max(200).optional().nullable(),
  client_secret: z.string().max(500).optional().nullable(),
  oauth_scopes: z.string().max(500).optional(), // accettato ma non persistito (lo gestisce Shopify Partner App)
  webhook_secret: z.string().max(500).optional().nullable(),
  webhook_topics: z.array(z.string().min(1).max(100)).max(50).optional(),
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

/** Address webhook auto-generato dal Sito B (mai accettato dal Sito A). */
function buildWebhookAddress(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}/api/public/bridge/shopify-webhook`;
}

export const Route = createFileRoute("/api/public/bridge/update-config")({
  server: {
    handlers: {
      OPTIONS: async () => corsPreflight(),
      POST: async ({ request }) => {
        const endpoint = "/api/public/bridge/update-config";
        try {
          const apiKey = request.headers.get("X-Bridge-Api-Key");
          const raw = (await request.json().catch(() => ({}))) as unknown;
          const body = Body.parse(raw);
          const store = (await authInboundRequest(apiKey, body.store_id)) as BridgeStoreRow & {
            shopify_api_key_encrypted: string | null;
            shopify_api_secret_encrypted: string | null;
          };

          const updates: Record<string, unknown> = {};
          const applied: Record<string, unknown> = {};
          const warnings: string[] = [];

          // 1) access_token: valida prima di salvare
          if (body.access_token !== undefined) {
            try {
              const probeAuth = {
                shop_domain: store.shop_domain,
                access_token: body.access_token,
                api_version: store.shopify_api_version,
                user_agent: store.user_agent ?? undefined,
                store_id: store.id,
                rate_limit_rps: store.rate_limit_rps ?? 2,
              };
              const shop = await shopifyGetShop(probeAuth);
              updates.shopify_access_token_encrypted = await encryptString(body.access_token);
              applied.access_token = "rotated";
              applied.shop_name = shop.name;
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              const is401 = /\b401\b/.test(msg);
              await logBridge({
                store_id: store.id,
                direction: "inbound",
                endpoint,
                http_status: 400,
                success: false,
                error: is401 ? "token invalido" : msg,
              });
              return jsonResponse({ ok: false, error: is401 ? "token invalido" : "validazione token fallita", detail: msg }, { status: 400 });
            }
          }

          // 2) client_id / client_secret (Shopify Partner App credentials)
          if (body.client_id !== undefined) {
            updates.shopify_api_key_encrypted = body.client_id ? await encryptString(body.client_id) : null;
            applied.client_id = body.client_id ? "updated" : "cleared";
          }
          if (body.client_secret !== undefined) {
            updates.shopify_api_secret_encrypted = body.client_secret ? await encryptString(body.client_secret) : null;
            applied.client_secret = body.client_secret ? "updated" : "cleared";
          }

          // 3) webhook_secret
          if (body.webhook_secret !== undefined) {
            updates.shopify_webhook_secret_encrypted = body.webhook_secret ? await encryptString(body.webhook_secret) : null;
            applied.webhook_secret = body.webhook_secret ? "updated" : "cleared";
          }

          // 4) oauth_scopes: lo accettiamo ma non lo persistiamo (gestito a livello Partner App)
          if (body.oauth_scopes !== undefined) {
            warnings.push("oauth_scopes non persistito: gli scope OAuth si configurano nella Shopify Partner App, non runtime.");
          }

          // Persisti aggiornamenti config (prima dei webhook, così se crash dopo i secret sono salvi)
          if (Object.keys(updates).length > 0) {
            const { error } = await supabaseAdmin.from("bridge_stores").update(updates as never).eq("id", store.id);
            if (error) throw new Error(error.message);
          }

          // 5) webhook_topics: sincronizza su Shopify (address auto-generato)
          let topics_synced: { added: string[]; removed: string[]; kept: string[] } | null = null;
          if (body.webhook_topics !== undefined) {
            const desiredAddress = buildWebhookAddress(request);
            try {
              // Re-fetch store per avere eventuale token appena ruotato
              const { data: fresh } = await supabaseAdmin.from("bridge_stores").select("*").eq("id", store.id).single();
              const auth = await getShopifyAuth(fresh as BridgeStoreRow);
              const existing = await shopifyListWebhooks(auth);
              const desired = new Set(body.webhook_topics);
              const existingForUs = existing.filter((w) => w.address === desiredAddress);
              const existingTopics = new Set(existingForUs.map((w) => w.topic));

              const toAdd = [...desired].filter((t) => !existingTopics.has(t));
              const toRemove = existingForUs.filter((w) => !desired.has(w.topic));
              const kept = existingForUs.filter((w) => desired.has(w.topic)).map((w) => w.topic);

              for (const topic of toAdd) {
                try {
                  await shopifyCreateWebhook(auth, topic, desiredAddress, "json");
                } catch (e) {
                  warnings.push(`webhook create '${topic}' fallito: ${e instanceof Error ? e.message : String(e)}`);
                }
              }
              for (const w of toRemove) {
                try {
                  await shopifyDeleteWebhook(auth, w.id);
                } catch (e) {
                  warnings.push(`webhook delete '${w.topic}' fallito: ${e instanceof Error ? e.message : String(e)}`);
                }
              }
              topics_synced = { added: toAdd, removed: toRemove.map((w) => w.topic), kept };
              applied.webhook_topics = topics_synced;
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              warnings.push(`sync webhook_topics fallito: ${msg}`);
            }
          }

          // Costruisci risposta nello stesso shape di get-config
          const { data: finalStore, error: refetchErr } = await supabaseAdmin.from("bridge_stores").select("*").eq("id", store.id).single();
          if (refetchErr) throw new Error(refetchErr.message);
          const finalRow = finalStore as BridgeStoreRow & {
            shopify_api_key_encrypted: string | null;
            shopify_api_secret_encrypted: string | null;
          };

          const access_token = await safeDecrypt(finalRow.shopify_access_token_encrypted);
          const client_id = await safeDecrypt(finalRow.shopify_api_key_encrypted);
          const client_secret = await safeDecrypt(finalRow.shopify_api_secret_encrypted);
          const webhook_secret = await safeDecrypt(finalRow.shopify_webhook_secret_encrypted);

          let webhook_topics_live: Array<{ topic: string; address: string; format: string }> = [];
          let token_status: "valid" | "invalid" | "unknown" = "unknown";
          if (access_token) {
            try {
              const auth = await getShopifyAuth(finalRow);
              const hooks = await shopifyListWebhooks(auth);
              webhook_topics_live = hooks.map((h) => ({ topic: h.topic, address: h.address, format: h.format }));
              token_status = "valid";
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              token_status = /\b401\b/.test(msg) ? "invalid" : "unknown";
            }
          }

          const config = {
            shop_domain: finalRow.shop_domain,
            access_token_masked: maskSecret(access_token),
            has_access_token: !!access_token,
            client_id: client_id ?? null,
            client_secret_masked: maskSecret(client_secret),
            has_client_secret: !!client_secret,
            oauth_scopes: "read_products,write_products,read_orders,write_orders,read_draft_orders,write_draft_orders,read_inventory",
            webhook_secret_masked: maskSecret(webhook_secret),
            has_webhook_secret: !!webhook_secret,
            webhook_topics: webhook_topics_live,
            token_status,
            last_validated_at: new Date().toISOString(),
          };

          await logBridge({
            store_id: store.id,
            direction: "inbound",
            endpoint,
            http_status: 200,
            success: true,
            payload: { applied, warnings_count: warnings.length },
          });

          return jsonResponse({ ok: true, applied, config, warnings });
        } catch (e) {
          return handleError(e, endpoint);
        }
      },
    },
  },
});
