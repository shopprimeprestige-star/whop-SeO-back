import { hmacSha256Hex } from "@/lib/bridge/crypto.server";

function b64urlEncode(input: string) {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomRid(): string {
  // 128-bit random id, hex.
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * TTL del link /wash. Volutamente breve: il link è single-use e va consumato
 * subito dopo la generazione lato client.
 */
const DEFAULT_TTL_SECONDS = 5 * 60; // 5 minuti

export async function buildWashUrl(
  targetUrl: string,
  requestUrl?: string,
  refererPath?: string,
  options?: { ttlSeconds?: number }
) {
  const origin = requestUrl ? new URL(requestUrl).origin : process.env.PUBLIC_APP_URL;
  if (!origin) return targetUrl;

  const ttl = Math.max(30, Math.min(options?.ttlSeconds ?? DEFAULT_TTL_SECONDS, 60 * 60));
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const rid = randomRid();

  const u = b64urlEncode(targetUrl);
  const params = new URLSearchParams({ u, exp: String(exp), rid });
  if (refererPath) {
    params.set("r", refererPath.startsWith("/") ? refererPath : `/${refererPath}`);
  }
  const secret = process.env.BRIDGE_REDIRECT_SECRET;

  if (secret) {
    // Firma su tutti i parametri di sicurezza così exp e rid sono autenticati.
    const signature = await hmacSha256Hex(secret, `${u}.${exp}.${rid}`);
    params.set("s", signature);
  }
  return `${origin}/wash?${params.toString()}`;
}
