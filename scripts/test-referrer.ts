import { chromium, firefox, webkit, type Browser, type BrowserType, type Request } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const TARGET = process.env.TARGET ?? "https://example-store.myshopify.com/cart";
const EXPECTED_ORIGIN = new URL(BASE_URL).origin;

function b64url(value: string) {
  return Buffer.from(value, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizeOrigin(value: string | null) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isShopifyRequest(request: Request) {
  try {
    const hostname = new URL(request.url()).hostname;
    return /\.myshopify\.com$/i.test(hostname) || /^checkout\./i.test(hostname);
  } catch {
    return false;
  }
}

async function testBrowser(name: string, type: BrowserType): Promise<{
  name: string;
  ok: boolean;
  referer: string | null;
  refererOrigin: string | null;
  targetUrl: string | null;
  error?: string;
}> {
  let browser: Browser | null = null;

  try {
    browser = await type.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    let capturedReferer: string | null = null;
    let capturedTargetUrl: string | null = null;

    page.on("request", (request) => {
      if (!isShopifyRequest(request) || capturedReferer !== null) return;
      capturedTargetUrl = request.url();
      capturedReferer = request.headers()["referer"] ?? null;
    });

    const washUrl = `${BASE_URL}/wash?u=${encodeURIComponent(b64url(TARGET))}`;
    await page.goto(washUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(4500);

    const refererOrigin = normalizeOrigin(capturedReferer);
    const ok = !!capturedReferer && capturedReferer !== "None" && refererOrigin === EXPECTED_ORIGIN;

    await context.close();

    return {
      name,
      ok,
      referer: capturedReferer,
      refererOrigin,
      targetUrl: capturedTargetUrl,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      referer: null,
      refererOrigin: null,
      targetUrl: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (browser) await browser.close();
  }
}

async function main() {
  console.log(`[referrer-test] BASE_URL=${BASE_URL} EXPECTED_ORIGIN=${EXPECTED_ORIGIN} TARGET=${TARGET}\n`);

  const results = await Promise.all([
    testBrowser("chromium", chromium),
    testBrowser("firefox", firefox),
    testBrowser("webkit", webkit),
  ]);

  let pass = 0;
  for (const result of results) {
    const tag = result.ok ? "✅ PASS" : "❌ FAIL";
    const mismatch = result.refererOrigin && result.refererOrigin !== EXPECTED_ORIGIN
      ? ` origin_attesa=${EXPECTED_ORIGIN} origin_ricevuta=${result.refererOrigin}`
      : "";
    const targetInfo = result.targetUrl ? ` target=${result.targetUrl}` : "";
    console.log(`${tag} ${result.name.padEnd(8)} → Referer: ${result.referer ?? "(vuoto)"}${mismatch}${targetInfo}${result.error ? ` err=${result.error}` : ""}`);
    if (result.ok) pass++;
  }

  console.log(`\n${pass}/${results.length} browser hanno passato il test.`);
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
