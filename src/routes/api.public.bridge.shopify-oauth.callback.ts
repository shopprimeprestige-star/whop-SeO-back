import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/lib/runtime-supabase-admin";
import { decryptString, encryptString } from "@/lib/bridge/crypto.server";
import { shopifyCreateWebhook, shopifyListWebhooks } from "@/lib/bridge/shopify.server";

const WEBHOOK_TOPICS = ["orders/create", "orders/paid", "orders/cancelled", "orders/fulfilled"] as const;

function htmlResponse(body: string, status = 200, extra?: { access_token?: string; webhook_secret?: string }) {
  const payload = JSON.stringify({ type: "shopify-oauth-done", ...(extra ?? {}) });
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>Shopify OAuth</title><style>body{font-family:system-ui;background:#0a0a0a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}.box{max-width:520px;background:#111;border:1px solid #27272a;border-radius:14px;padding:28px;text-align:center}.ok{color:#34d399}.err{color:#f87171}h1{margin:0 0 8px;font-size:20px}p{margin:8px 0;font-size:14px;color:#a1a1aa}code{background:#000;padding:2px 6px;border-radius:4px;color:#fbbf24}</style></head><body><div class="box">${body}<p style="margin-top:20px;font-size:12px">Puoi chiudere questa finestra e tornare al pannello.</p></div><script>setTimeout(()=>{try{window.opener&&window.opener.postMessage(${payload},'*')}catch(e){}},300)</script></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

async function verifyShopifyHmac(params: URLSearchParams, secret: string): Promise<boolean> {
  const hmac = params.get("hmac");
  if (!hmac) return false;
  const entries: [string, string][] = [];
  params.forEach((v, k) => { if (k !== "hmac" && k !== "signature") entries.push([k, v]); });
  entries.sort(([a], [b]) => a.localeCompare(b));
  const message = entries.map(([k, v]) => `${k}=${v}`).join("&");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === hmac.toLowerCase();
}

export const Route = createFileRoute("/api/public/bridge/shopify-oauth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const params = url.searchParams;
        const code = params.get("code");
        const shop = params.get("shop");
        const state = params.get("state");

        if (!code || !shop || !state) return htmlResponse(`<h1 class="err">Parametri mancanti</h1>`, 400);

        const cookie = request.headers.get("cookie") ?? "";
        const cookieState = /(?:^|;\s*)bridge_oauth_state=([^;]+)/.exec(cookie)?.[1];
        if (!cookieState || cookieState !== state) {
          return htmlResponse(`<h1 class="err">State non valido (CSRF)</h1>`, 400);
        }

        const storeId = state.split(".")[0];
        if (!storeId) return htmlResponse(`<h1 class="err">store_id mancante</h1>`, 400);

        const { data: store, error } = await supabaseAdmin
          .from("bridge_stores")
          .select("id,shop_domain,shopify_api_key_encrypted,shopify_api_secret_encrypted")
          .eq("id", storeId)
          .maybeSingle();
        if (error || !store) return htmlResponse(`<h1 class="err">Store non trovato</h1>`, 404);
        if (store.shop_domain.toLowerCase() !== shop.toLowerCase()) {
          return htmlResponse(`<h1 class="err">Shop domain non corrisponde</h1>`, 400);
        }
        if (!store.shopify_api_key_encrypted || !store.shopify_api_secret_encrypted) {
          return htmlResponse(`<h1 class="err">Mancano Client ID o Secret salvati</h1>`, 400);
        }

        let clientId: string, clientSecret: string;
        try {
          clientId = await decryptString(store.shopify_api_key_encrypted);
          clientSecret = await decryptString(store.shopify_api_secret_encrypted);
        } catch {
          return htmlResponse(`<h1 class="err">Impossibile decifrare le credenziali</h1>`, 500);
        }

        const hmacOk = await verifyShopifyHmac(params, clientSecret);
        if (!hmacOk) return htmlResponse(`<h1 class="err">HMAC non valido</h1>`, 401);

        // Exchange code for access token
        const tokenRes = await fetch(`https://${store.shop_domain}/admin/oauth/access_token`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
        });
        if (!tokenRes.ok) {
          const txt = await tokenRes.text();
          await supabaseAdmin.from("bridge_stores").update({ last_error: `OAuth token exchange ${tokenRes.status}: ${txt.slice(0, 200)}` }).eq("id", storeId);
          return htmlResponse(`<h1 class="err">Token exchange fallito (${tokenRes.status})</h1><p><code>${txt.slice(0, 200)}</code></p>`, 400);
        }
        const tokenJson = (await tokenRes.json()) as { access_token: string; scope?: string };
        const encrypted = await encryptString(tokenJson.access_token);
        // Per Public App Shopify, l'HMAC dei webhook è firmato con il client_secret.
        // Lo salviamo come webhook_secret se non già presente, così la verifica HMAC funziona out-of-the-box.
        const encryptedWebhookSecret = await encryptString(clientSecret);

        const { error: updErr } = await supabaseAdmin
          .from("bridge_stores")
          .update({
            shopify_access_token_encrypted: encrypted,
            shopify_webhook_secret_encrypted: encryptedWebhookSecret,
            last_handshake_at: new Date().toISOString(),
            last_error: null,
          })
          .eq("id", storeId);
        if (updErr) return htmlResponse(`<h1 class="err">Errore salvataggio token</h1><p>${updErr.message}</p>`, 500);

        await supabaseAdmin.from("bridge_logs").insert({
          store_id: storeId,
          direction: "inbound",
          endpoint: "/api/public/bridge/shopify-oauth/callback",
          http_status: 200,
          success: true,
          payload: { shop, scope: tokenJson.scope ?? null },
        });

        // ===== Auto-registrazione webhook su Shopify =====
        const webhookAddress = `${url.origin}/api/public/bridge/shopify-webhook`;
        const auth = {
          shop_domain: store.shop_domain,
          access_token: tokenJson.access_token,
          api_version: "2024-10",
          store_id: storeId,
        };

        const created: string[] = [];
        const skipped: string[] = [];
        const failed: string[] = [];
        try {
          const existing = await shopifyListWebhooks(auth);
          for (const topic of WEBHOOK_TOPICS) {
            const already = existing.find((w) => w.topic === topic && w.address === webhookAddress);
            if (already) {
              await supabaseAdmin.from("bridge_webhooks").upsert({
                store_id: storeId,
                shopify_webhook_id: already.id,
                topic: already.topic,
                address: already.address,
                format: already.format,
                status: "active",
                last_error: null,
              } as never, { onConflict: "store_id,shopify_webhook_id" });
              skipped.push(topic);
              continue;
            }
            try {
              const wh = await shopifyCreateWebhook(auth, topic, webhookAddress);
              await supabaseAdmin.from("bridge_webhooks").upsert({
                store_id: storeId,
                shopify_webhook_id: wh.id,
                topic: wh.topic,
                address: wh.address,
                format: wh.format,
                status: "active",
                last_error: null,
              } as never, { onConflict: "store_id,shopify_webhook_id" });
              created.push(topic);
            } catch (whErr) {
              failed.push(`${topic}: ${whErr instanceof Error ? whErr.message.slice(0, 120) : "err"}`);
            }
          }
          await supabaseAdmin.from("bridge_logs").insert({
            store_id: storeId,
            direction: "shopify",
            endpoint: "/admin/api/2024-10/webhooks.json",
            http_status: failed.length === 0 ? 200 : 207,
            success: failed.length === 0,
            payload: { created, skipped, failed, address: webhookAddress },
            error: failed.length ? failed.join(" | ") : null,
          });
        } catch (whListErr) {
          await supabaseAdmin.from("bridge_logs").insert({
            store_id: storeId,
            direction: "shopify",
            endpoint: "/admin/api/2024-10/webhooks.json",
            http_status: 500,
            success: false,
            payload: { address: webhookAddress },
            error: whListErr instanceof Error ? whListErr.message : String(whListErr),
          });
        }

        const summary = `Creati: ${created.length} · Già presenti: ${skipped.length} · Falliti: ${failed.length}`;
        return htmlResponse(
          `<h1 class="ok">✓ Connesso a Shopify</h1><p>Store <code>${shop}</code> collegato.</p><p>Scope: <code>${tokenJson.scope ?? "n/d"}</code></p><p style="margin-top:12px">Webhook: <code>${summary}</code></p>${failed.length ? `<p style="color:#f87171;font-size:11px">${failed.map((f) => `· ${f}`).join("<br>")}</p>` : ""}<p style="margin-top:14px;color:#34d399;font-size:12px">↻ Token + HMAC pronti — torna al pannello e clicca <strong>Auto-compila secrets</strong>.</p>`,
          200,
          { access_token: tokenJson.access_token, webhook_secret: clientSecret }
        );
      },
    },
  },
});
