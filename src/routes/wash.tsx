import { createFileRoute } from "@tanstack/react-router";
import { hmacSha256Hex, safeEqual } from "@/lib/bridge/crypto.server";
import { supabaseAdmin } from "@/lib/runtime-supabase-admin";

function b64urlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const norm = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  if (typeof atob === "function") return atob(norm);
  return Buffer.from(norm, "base64").toString("utf-8");
}

function isShopifyNativeHost(host: string): boolean {
  return /\.myshopify\.com$/i.test(host) || /^checkout\./i.test(host);
}

function isShopifyHost(host: string): boolean {
  return isShopifyNativeHost(host);
}

/**
 * Carica la whitelist dinamica dei domini consentiti per il redirect /wash.
 * Include shop_domain (*.myshopify.com) e custom_domains configurati per ogni store.
 * I match nativi *.myshopify.com / checkout.* sono comunque sempre consentiti come fallback.
 */
async function loadAllowedHosts(): Promise<Set<string>> {
  const set = new Set<string>();
  const addHost = (value: unknown) => {
    if (!value) return;
    const raw = String(value).trim().toLowerCase();
    if (!raw) return;
    try {
      const normalized = raw.includes("://") ? new URL(raw).hostname.toLowerCase() : raw.replace(/\/$/, "");
      if (normalized) set.add(normalized);
    } catch {
      set.add(raw.replace(/\/$/, ""));
    }
  };
  try {
    const { data } = await supabaseAdmin
      .from("bridge_stores")
      .select("shop_domain, display_name, custom_domains")
      .eq("is_active", true);
    for (const row of data ?? []) {
      addHost(row.shop_domain);
      addHost((row as { display_name?: string | null }).display_name);
      const arr = (row as { custom_domains?: string[] }).custom_domains;
      if (Array.isArray(arr)) {
        for (const d of arr) addHost(d);
      }
    }
  } catch (e) {
    console.error("[wash] loadAllowedHosts failed:", e);
  }
  return set;
}

// Fallback statico: domini sempre consentiti anche se non ancora configurati
// come custom_domains nel DB. Utile per evitare blocchi durante l'onboarding.
const STATIC_ALLOWED_HOSTS = new Set<string>([
  "nexa-world.vip",
  "nexa-world.shop",
]);

async function isAllowedUrl(raw: string): Promise<boolean> {
  let host = "";
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") {
      console.warn("[wash] Forbidden destination (non-https):", u.protocol, u.hostname);
      return false;
    }
    host = u.hostname.toLowerCase();
    if (isShopifyNativeHost(host)) return true;
    if (STATIC_ALLOWED_HOSTS.has(host)) return true;
    const allowed = await loadAllowedHosts();
    if (allowed.has(host)) return true;
    console.warn("[wash] Forbidden destination:", host, "— allowed set:", Array.from(allowed));
    return false;
  } catch (e) {
    console.warn("[wash] Forbidden destination (parse error):", raw, e);
    return false;
  }
}

async function logForbidden(host: string, path: string) {
  try {
    await supabaseAdmin.from("bridge_logs").insert({
      direction: "wash_redirect",
      endpoint: "/wash",
      http_status: 403,
      success: false,
      error: "forbidden_destination",
      payload: { host, path },
    });
  } catch (e) {
    console.error("[wash] logForbidden failed:", e);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Marca un rid come usato. Restituisce true se è la prima volta (OK), false se
 * era già stato consumato (replay rilevato).
 */
async function consumeRid(rid: string, expSeconds: number): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin
      .from("bridge_wash_nonces")
      .insert({
        rid,
        expires_at: new Date(expSeconds * 1000).toISOString(),
      });
    if (!error) return true;
    // 23505 = unique violation → replay
    return false;
  } catch {
    return false;
  }
}

/**
 * Guard runtime: blocca qualunque tentativo (presente o futuro) di chiamare
 * Shopify lato server da dentro l'handler /wash. Se qualcuno modifica /wash
 * per fare fetch verso Shopify, l'errore viene loggato e la richiesta cade.
 */
function withNoShopifyFetch<T>(fn: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  const guardedFetch: typeof fetch = (input, init) => {
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
      const host = new URL(url).hostname;
      if (isShopifyHost(host)) {
        // Log diagnostico, poi rigetta. Non leakiamo dati.
        console.error("[wash][guard] BLOCKED server-side fetch to Shopify:", host);
        throw new Error("wash: server-side fetch to Shopify is forbidden");
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("wash:")) throw e;
      // URL non parsabile: lascia passare.
    }
    return originalFetch(input as RequestInfo, init);
  };
  globalThis.fetch = guardedFetch;
  return fn().finally(() => {
    globalThis.fetch = originalFetch;
  });
}

export const Route = createFileRoute("/wash")({
  server: {
    handlers: {
      GET: async ({ request }) => withNoShopifyFetch(async () => {
        const url = new URL(request.url);
        // Accetta sia "u" (base64url firmato, legacy) sia "target" (URL diretto).
        const u = url.searchParams.get("u") || "";
        const targetParam = url.searchParams.get("target") || "";
        const s = url.searchParams.get("s") || "";
        const r = url.searchParams.get("r") || "";
        const expRaw = url.searchParams.get("exp") || "";
        const rid = url.searchParams.get("rid") || "";
        const debug = url.searchParams.get("debug") === "1";
        const noClick = url.searchParams.get("noclick") === "1";

        let target = "";
        if (u) {
          try {
            target = b64urlDecode(u);
          } catch {
            return new Response("Bad u encoding", { status: 400 });
          }

          const secret = process.env.BRIDGE_REDIRECT_SECRET;
          if (secret) {
            // exp e rid sono OBBLIGATORI quando è configurato il secret.
            if (!expRaw || !/^\d{10,}$/.test(expRaw)) {
              return new Response("Missing or invalid exp", { status: 400 });
            }
            if (!rid || !/^[a-f0-9]{32}$/.test(rid)) {
              return new Response("Missing or invalid rid", { status: 400 });
            }
            const exp = Number(expRaw);
            const now = Math.floor(Date.now() / 1000);
            if (exp < now) {
              return new Response("Link expired", { status: 410 });
            }
            // Limite massimo TTL accettato (1h) per evitare exp arbitrariamente lunghi.
            if (exp > now + 60 * 60) {
              return new Response("exp too far in future", { status: 400 });
            }
            if (!s) return new Response("Missing signature", { status: 401 });
            const expected = await hmacSha256Hex(secret, `${u}.${exp}.${rid}`);
            if (!safeEqual(expected, s)) {
              return new Response("Invalid signature", { status: 401 });
            }
            // Anti-replay: rid deve essere fresco.
            // In modalità noclick (ispezione admin) NON consumiamo il rid:
            // la pagina serve solo per leggere il DOM, non per navigare,
            // quindi il link resta riusabile fino alla scadenza naturale exp.
            if (!noClick) {
              const ok = await consumeRid(rid, exp);
              if (!ok) {
                return new Response("Replay detected", { status: 409 });
              }
            }
          }
        } else if (targetParam) {
          // Modalità non firmata: accettata solo come fallback dev/manuale.
          target = targetParam;
        } else {
          return new Response("Missing target", { status: 400 });
        }

        if (!(await isAllowedUrl(target))) {
          let host = "";
          let path = "";
          try {
            const parsed = new URL(target);
            host = parsed.hostname;
            path = parsed.pathname;
          } catch { /* ignore */ }
          await logForbidden(host, path);
          return new Response("Forbidden destination", { status: 403 });
        }

        // Debug log server-side: se attivato via ?debug=1 logga i metadati di
        // sicurezza per diagnosi (no PII, no body).
        if (debug) {
          console.log("[wash][debug]", JSON.stringify({
            target_host: new URL(target).hostname,
            ref_path: r || null,
            user_agent: request.headers.get("user-agent"),
            client_referer: request.headers.get("referer"),
            ts: new Date().toISOString(),
          }));
        }

        const safeTarget = escapeHtml(target);
        const safeRefPath = r && /^\/[A-Za-z0-9\-_/.~%?=&]*$/.test(r) ? r : "";

        const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="referrer" content="no-referrer-when-downgrade">
  <meta name="robots" content="noindex, nofollow">
  <title>Redirecting to secure shop…</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      min-height: 100vh;
      background: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #111;
    }
    .wrap {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 16px;
      padding: 24px;
      text-align: center;
    }
    .spinner {
      width: 28px;
      height: 28px;
      border: 3px solid #e5e7eb;
      border-top-color: #111;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .msg { font-size: 15px; color: #374151; }
    .fallback {
      margin-top: 12px;
      display: none;
      padding: 10px 18px;
      background: #111;
      color: #fff;
      text-decoration: none;
      border-radius: 6px;
      font-size: 14px;
    }
    .fallback.visible { display: inline-block; }
    .debug-box {
      margin-top: 24px;
      max-width: 720px;
      width: 100%;
      text-align: left;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 12px 14px;
      color: #111;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .debug-box.hidden { display: none; }
    .debug-box h3 { margin: 0 0 8px; font-size: 13px; }
  </style>
</head>
<body>
  <main class="wrap">
    <div class="spinner" aria-hidden="true"></div>
    <p class="msg">Redirecting to secure shop…</p>
    <a id="bridge-link"
       class="fallback"
       href="${safeTarget}"
       referrerpolicy="no-referrer-when-downgrade"
       rel="noopener">Continua allo store</a>
    <noscript>
      <a href="${safeTarget}" referrerpolicy="no-referrer-when-downgrade" class="fallback visible">Continua allo store</a>
    </noscript>
    <div id="debug" class="debug-box hidden" aria-live="polite"></div>
  </main>
  <script>
    (function () {
      var target = ${JSON.stringify(target)};
      var refPath = ${JSON.stringify(safeRefPath)};
      var debug = ${JSON.stringify(debug)};
      var noClick = ${JSON.stringify(noClick)};
      var navigated = false;
      var clickAttempts = 0;
      var tStart = performance.now();

      // Estrae anche da query string, così la stessa logica funziona anche
      // se l'URL viene riscritto lato client.
      try {
        var qsTarget = new URLSearchParams(window.location.search).get('target');
        if (qsTarget && /^https:\\/\\//i.test(qsTarget)) {
          target = qsTarget;
        }
      } catch (e) {}

      if (!target) return;

      function showFallback() {
        var el = document.getElementById('bridge-link');
        if (el) el.classList.add('visible');
      }

      function dlog(label, data) {
        if (!debug) return;
        try {
          console.log('[wash][client]', label, data);
          var box = document.getElementById('debug');
          if (box) {
            box.classList.remove('hidden');
            var line = '[' + new Date().toISOString() + '] ' + label + ' → ' + JSON.stringify(data);
            box.textContent = box.textContent + line + '\\n';
          }
        } catch (e) {}
      }

      function rewriteHistory() {
        try {
          if (refPath && window.history && typeof window.history.replaceState === 'function') {
            window.history.replaceState(null, '', refPath);
            dlog('history.replaceState', { newUrl: window.location.href });
          }
        } catch (e) {}
      }

      function go() {
        if (navigated) return;
        clickAttempts++;
        var link = document.getElementById('bridge-link');
        if (!link) {
          link = document.createElement('a');
          link.href = target;
          link.rel = 'noopener';
          link.referrerPolicy = 'no-referrer-when-downgrade';
          link.style.position = 'absolute';
          link.style.left = '-9999px';
          document.body.appendChild(link);
        } else {
          link.referrerPolicy = 'no-referrer-when-downgrade';
        }

        dlog('about-to-click', {
          attempt: clickAttempts,
          documentURL: window.location.href,
          referrerPolicy: document.referrer ? 'present' : 'empty',
          targetHost: new URL(target).hostname,
        });

        try {
          link.click();
          navigated = true;
        } catch (e) {
          dlog('click-error', { error: String(e) });
          showFallback();
          return;
        }

        // Se dopo 1.5s la pagina è ancora qui, l'anti-bot ha bloccato il click.
        setTimeout(function () {
          if (document.visibilityState !== 'hidden' && clickAttempts < 2) {
            dlog('retry-click', { reason: 'still-visible' });
            navigated = false;
            go();
          } else {
            showFallback();
          }
        }, 1500);
      }

      function start() {
        rewriteHistory();
        dlog('boot', {
          documentURL: window.location.href,
          documentReferrer: document.referrer || '(empty)',
          tElapsedMs: Math.round(performance.now() - tStart),
        });
        if (noClick) {
          dlog('noclick-mode', { reason: 'auto-click disabled for inspection' });
          showFallback();
          return;
        }
        // Aspetta un frame in più dopo il rendering per garantire che il
        // browser abbia stabilizzato la history prima del click.
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            setTimeout(function () {
              dlog('click-timing', { tElapsedMs: Math.round(performance.now() - tStart) });
              go();
            }, 100);
          });
        });
      }

      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        start();
      } else {
        document.addEventListener('DOMContentLoaded', start, { once: true });
      }
    })();
  </script>
</body>
</html>`;

        return new Response(html, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Referrer-Policy": "no-referrer-when-downgrade",
            "Cache-Control": "no-store, max-age=0",
            "X-Robots-Tag": "noindex, nofollow",
          },
        });
      }),
    },
  },
});
