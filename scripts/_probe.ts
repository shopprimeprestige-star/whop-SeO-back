import { chromium } from "playwright";

const PRODUCT_URL = "https://shop-path-secure.lovable.app/shop/prodotto/donna-top-022";
const SITE_B_ORIGIN = new URL(PRODUCT_URL).origin;

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const ctx = browser.contexts()[0] ?? await browser.newContext();
  const page = await ctx.newPage();

  const reqs: { url: string; referer: string | null; method: string; redirected: string | null }[] = [];
  page.on("request", (req) => {
    const u = req.url();
    if (/myshopify\.com|^https:\/\/checkout\./.test(u) || /\/wash\?/.test(u)) {
      reqs.push({
        url: u,
        referer: req.headers()["referer"] ?? null,
        method: req.method(),
        redirected: req.redirectedFrom()?.url() ?? null,
      });
    }
  });

  console.log(`[1] open ${PRODUCT_URL}`);
  await page.goto(PRODUCT_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  console.log("[2] dump add-to-cart-like buttons");
  const buttons = await page.locator("button, a").evaluateAll((els) =>
    els.slice(0, 60).map((el) => (el.textContent || "").trim()).filter((t) => t.length > 0 && t.length < 60)
  );
  console.log("  ", buttons.join(" | "));

  // Try add to cart
  const addCandidates = ["Aggiungi al carrello", "Aggiungi", "Acquista", "Buy", "Add to cart"];
  for (const t of addCandidates) {
    const b = page.getByRole("button", { name: new RegExp(t, "i") }).first();
    if (await b.count() > 0) {
      console.log(`[3] click "${t}"`);
      try { await b.click({ timeout: 4000 }); break; } catch (e) { console.log("   click failed:", String(e).slice(0, 120)); }
    }
  }
  await page.waitForTimeout(1500);

  // Try checkout
  const ckCandidates = ["Checkout sicuro", "Procedi al checkout", "Checkout"];
  for (const t of ckCandidates) {
    const b = page.getByRole("button", { name: new RegExp(t, "i") }).first();
    if (await b.count() > 0) {
      console.log(`[4] click "${t}"`);
      try { await b.click({ timeout: 6000 }); break; } catch (e) { console.log("   click failed:", String(e).slice(0, 120)); }
    }
  }
  await page.waitForTimeout(10000);

  console.log("\n=== final URL ===\n" + page.url());
  console.log("\n=== requests to wash/shopify ===");
  for (const r of reqs) {
    console.log(`[${r.method}] ${r.url}\n   referer: ${r.referer ?? "(none)"}${r.redirected ? `\n   redirected_from: ${r.redirected}` : ""}`);
  }
  console.log(`\nexpected origin: ${SITE_B_ORIGIN}`);

  await page.close();
})().catch((e) => { console.error(e); process.exit(1); });
