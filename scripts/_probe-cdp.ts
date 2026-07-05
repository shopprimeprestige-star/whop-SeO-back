// Probe CDP minimale: usa Chromium via DevTools Protocol per misurare il
// Referer reale che il flusso /wash invia al server di destinazione (Shopify).
// Niente dipendenze: solo WebSocket nativo di Bun.

const PRODUCT_URL = process.env.PROBE_URL ?? "https://shop-path-secure.lovable.app/shop/prodotto/donna-top-022";
const SITE_B_ORIGIN = new URL(PRODUCT_URL).origin;
const CDP_URL = process.env.CDP_URL ?? "http://127.0.0.1:9223";

type CDPMessage = { id?: number; method?: string; params?: any; result?: any; error?: any; sessionId?: string };

async function browserWS(): Promise<string> {
  const r = await fetch(`${CDP_URL}/json/version`);
  const j = await r.json();
  return j.webSocketDebuggerUrl as string;
}

class Client {
  ws!: WebSocket;
  nextId = 1;
  pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  sessions = new Set<string>();
  events: ((m: CDPMessage) => void)[] = [];

  async connect(url: string) {
    this.ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(new Error("ws error"));
    });
    this.ws.onmessage = (m) => {
      const data: CDPMessage = JSON.parse(m.data.toString());
      if (data.id && this.pending.has(data.id)) {
        const p = this.pending.get(data.id)!;
        this.pending.delete(data.id);
        if (data.error) p.reject(new Error(JSON.stringify(data.error)));
        else p.resolve(data.result);
        return;
      }
      for (const cb of this.events) cb(data);
    };
  }

  send(method: string, params: any = {}, sessionId?: string): Promise<any> {
    const id = this.nextId++;
    const payload: CDPMessage = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  on(cb: (m: CDPMessage) => void) { this.events.push(cb); }
}

const SHOPIFY_RE = /(\.myshopify\.com|^https?:\/\/checkout\.)/i;
const WASH_RE = /\/wash\?/;

(async () => {
  const wsUrl = await browserWS();
  const c = new Client();
  await c.connect(wsUrl);
  console.log(`[cdp] connected to ${wsUrl}`);

  // New target/page
  const target = await c.send("Target.createTarget", { url: "about:blank" });
  const targetId = target.targetId;
  const attached = await c.send("Target.attachToTarget", { targetId, flatten: true });
  const sessionId = attached.sessionId;
  console.log(`[cdp] page session ${sessionId}`);

  await c.send("Network.enable", {}, sessionId);
  await c.send("Page.enable", {}, sessionId);

  type Captured = { url: string; method: string; referer: string | null; type: string; documentURL?: string; redirectChain?: string[] };
  const captured: Captured[] = [];
  const allUrls: string[] = [];

  c.on((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === "Network.requestWillBeSent") {
      const req = m.params!;
      const url = req.request.url as string;
      allUrls.push(url);
      if (SHOPIFY_RE.test(url) || WASH_RE.test(url)) {
        captured.push({
          url,
          method: req.request.method,
          referer: req.request.headers["Referer"] ?? req.request.headers["referer"] ?? null,
          type: req.type,
          documentURL: req.documentURL,
          redirectChain: req.redirectResponse ? [req.redirectResponse.url] : undefined,
        });
      }
    }
    if (m.method === "Page.frameNavigated") {
      const url = m.params!.frame.url;
      console.log(`[nav] ${url}`);
    }
  });

  console.log(`[1] navigate to ${PRODUCT_URL}`);
  await c.send("Page.navigate", { url: PRODUCT_URL }, sessionId);
  await new Promise((r) => setTimeout(r, 4000));

  // Inspect buttons
  const evalRes = await c.send("Runtime.evaluate", {
    expression: `Array.from(document.querySelectorAll('button, a')).slice(0,80).map(e => (e.innerText||'').trim()).filter(t => t && t.length<60)`,
    returnByValue: true,
  }, sessionId);
  console.log("[buttons]", (evalRes.result.value || []).join(" | "));

  // Click "Aggiungi al carrello" if present
  await c.send("Runtime.evaluate", {
    expression: `(function(){
      const btns = Array.from(document.querySelectorAll('button, a'));
      const target = btns.find(b => /aggiungi|add to cart|acquista/i.test(b.innerText||''));
      if (target) { target.click(); return 'clicked: ' + (target.innerText||'').trim(); }
      return 'no add-to-cart found';
    })()`,
    returnByValue: true,
  }, sessionId).then((r) => console.log("[add]", r.result.value));
  await new Promise((r) => setTimeout(r, 2000));

  // Click checkout
  await c.send("Runtime.evaluate", {
    expression: `(function(){
      const btns = Array.from(document.querySelectorAll('button, a'));
      const target = btns.find(b => /checkout|procedi/i.test(b.innerText||''));
      if (target) { target.click(); return 'clicked: ' + (target.innerText||'').trim(); }
      return 'no checkout found';
    })()`,
    returnByValue: true,
  }, sessionId).then((r) => console.log("[checkout]", r.result.value));

  // Wait for navigation chain to settle
  await new Promise((r) => setTimeout(r, 12000));

  const finalUrl = await c.send("Runtime.evaluate", { expression: "location.href", returnByValue: true }, sessionId);
  console.log(`\n=== final URL ===\n${finalUrl.result.value}`);

  console.log(`\n=== captured wash/shopify requests (expected origin: ${SITE_B_ORIGIN}) ===`);
  for (const r of captured) {
    const ok = r.referer && new URL(r.referer).origin === SITE_B_ORIGIN ? "✅" : (r.referer ? "⚠️ wrong origin" : "❌ no referer");
    console.log(`${ok} [${r.method} ${r.type}] ${r.url}\n     referer: ${r.referer ?? "(none)"}\n     documentURL: ${r.documentURL ?? "—"}`);
  }

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
