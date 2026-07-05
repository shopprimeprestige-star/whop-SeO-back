// AES-GCM encryption + SHA-256 + HMAC helpers for the Sito Ponte.
// SERVER-ONLY. Uses Web Crypto (works in Workers).

const KEY_ENV = "ENCRYPTION_KEY";

type RuntimeGlobal = typeof globalThis & {
  __PONTE_WORKER_ENV__?: Record<string, unknown>;
};

function readRuntimeSecret(name: string): string | undefined {
  const fromProcess = typeof process === "undefined" ? undefined : process.env?.[name];
  if (fromProcess) return fromProcess;

  const workerEnv = (globalThis as RuntimeGlobal).__PONTE_WORKER_ENV__;
  const fromWorker = workerEnv?.[name];
  return typeof fromWorker === "string" && fromWorker ? fromWorker : undefined;
}

function runtimeSecretSources(name: string) {
  const fromProcess = typeof process !== "undefined" && typeof process.env?.[name] === "string" && !!process.env[name];
  const workerEnv = (globalThis as RuntimeGlobal).__PONTE_WORKER_ENV__;
  const fromWorker = typeof workerEnv?.[name] === "string" && !!workerEnv[name];
  return { processEnv: fromProcess, workerEnv: fromWorker };
}

function decodeEncryptionKey(raw: string): Uint8Array {
  const normalized = raw.trim().replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);

  try {
    const decoded = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    if (decoded.length === 32) return decoded;
  } catch {
    // fall through and try raw utf-8 bytes
  }

  const utf8 = new TextEncoder().encode(raw.trim());
  if (utf8.length === 32) return utf8;

  throw new Error(`${KEY_ENV} must be 32 bytes (base64/base64url or raw 32-char secret)`);
}

async function importKey(): Promise<CryptoKey | null> {
  const raw = readRuntimeSecret(KEY_ENV);
  if (!raw) {
    return null;
  }
  try {
    const bytes = decodeEncryptionKey(raw);
    return crypto.subtle.importKey("raw", bytes as BufferSource, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  } catch (error) {
    console.warn(`${KEY_ENV} ignored: invalid format`, { ...runtimeSecretSources(KEY_ENV), error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

const b64 = {
  enc: (b: ArrayBuffer | Uint8Array) => {
    const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  },
  dec: (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
};

export async function encryptString(plaintext: string): Promise<string> {
  // ENCRYPTION_KEY rimosso dall'intero sistema: i segreti vengono salvati in chiaro
  // così che i Worker checkout (senza ENCRYPTION_KEY) possano sempre rileggerli.
  return plaintext;
}

export async function decryptString(payload: string): Promise<string> {
  const parts = payload.split(":");
  // Non cifrato (plaintext salvato senza ENCRYPTION_KEY)
  if (parts.length !== 3 || parts[0] !== "v1") return payload;
  const key = await importKey();
  // ENCRYPTION_KEY non configurata: non possiamo decifrare, restituiamo il payload com'è
  // così l'app non va in crash. Il valore andrà reinserito in chiaro dall'admin.
  if (!key) {
    console.warn("[crypto] ENCRYPTION_KEY non configurata: valore cifrato restituito as-is");
    return payload;
  }
  const iv = b64.dec(parts[1]);
  const ct = b64.dec(parts[2]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Base64(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return b64.enc(sig);
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function generateBridgeApiKey(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replaceAll("-", "");
}
