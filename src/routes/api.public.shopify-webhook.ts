import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/lib/runtime-supabase-admin";

// Shopify topic -> Meta standard event
const TOPIC_MAP: Record<string, string> = {
  "orders/create": "Purchase",
  "orders/paid": "Purchase",
  "orders/fulfilled": "Purchase",
  "checkouts/create": "InitiateCheckout",
  "checkouts/update": "AddPaymentInfo",
  "carts/create": "AddToCart",
  "carts/update": "AddToCart",
  "customers/create": "CompleteRegistration",
};

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Base64(secret: string, body: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, body as BufferSource);
  let s = "";
  const bytes = new Uint8Array(sig);
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function hashLower(v: unknown): Promise<string | undefined> {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim().toLowerCase();
  if (!s) return undefined;
  return sha256Hex(s);
}

async function hashPhone(v: unknown): Promise<string | undefined> {
  if (!v) return undefined;
  // E.164 without + per Meta spec (digits only)
  const digits = String(v).replace(/\D/g, "");
  if (!digits) return undefined;
  return sha256Hex(digits);
}

async function hashRaw(v: unknown): Promise<string | undefined> {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  return sha256Hex(s);
}

function parseCookieHeader(h: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  for (const part of h.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

async function logEvent(row: {
  topic: string | null;
  status: string;
  http_status: number | null;
  meta_event_name?: string | null;
  error?: string | null;
  payload_excerpt?: string | null;
}) {
  try {
    await supabaseAdmin.from("capi_events").insert(row);
    const { data } = await supabaseAdmin
      .from("capi_events")
      .select("id")
      .order("created_at", { ascending: false })
      .range(20, 999);
    if (data && data.length) {
      await supabaseAdmin.from("capi_events").delete().in("id", data.map((r) => r.id));
    }
  } catch {
    /* swallow */
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/shopify-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const topic = request.headers.get("x-shopify-topic");
        const hmacHeader = request.headers.get("x-shopify-hmac-sha256") ?? "";
        const xff = request.headers.get("x-forwarded-for") ?? "";
        const clientIp = xff.split(",")[0]?.trim() || undefined;
        const userAgent = request.headers.get("user-agent") ?? undefined;
        const cookies = parseCookieHeader(request.headers.get("cookie"));
        const fbp = cookies["_fbp"];
        const fbc = cookies["_fbc"];

        const rawBuf = new Uint8Array(await request.arrayBuffer());

        const { data: cfg } = await supabaseAdmin
          .from("capi_config")
          .select("*")
          .eq("singleton", true)
          .maybeSingle();

        if (!cfg?.shopify_webhook_secret || !cfg?.meta_pixel_id || !cfg?.meta_access_token) {
          await logEvent({ topic, status: "error", http_status: 500, error: "config missing" });
          return json({ error: "relay not configured" }, 500);
        }

        const expected = await hmacSha256Base64(cfg.shopify_webhook_secret, rawBuf);
        if (!safeEqual(hmacHeader, expected)) {
          await logEvent({ topic, status: "invalid_hmac", http_status: 401, error: "invalid HMAC" });
          return json({ error: "invalid hmac" }, 401);
        }

        const eventName = topic ? TOPIC_MAP[topic] : undefined;
        if (!eventName) {
          await logEvent({ topic, status: "skipped", http_status: 200 });
          return json({ status: "skipped" });
        }

        let payload: any;
        try {
          payload = JSON.parse(new TextDecoder().decode(rawBuf));
        } catch {
          await logEvent({ topic, status: "error", http_status: 400, error: "invalid JSON" });
          return json({ error: "invalid json" }, 400);
        }

        const customer = payload.customer ?? {};
        const ship = payload.shipping_address ?? payload.billing_address ?? {};
        const bill = payload.billing_address ?? {};

        const email = payload.email ?? customer.email ?? payload.contact_email;
        const phone = payload.phone ?? customer.phone ?? ship.phone ?? bill.phone;
        const firstName = ship.first_name ?? bill.first_name ?? customer.first_name;
        const lastName = ship.last_name ?? bill.last_name ?? customer.last_name;
        const city = ship.city ?? bill.city;
        const province = ship.province_code ?? bill.province_code;
        const zip = ship.zip ?? bill.zip;
        const country = ship.country_code ?? bill.country_code;
        const externalId = customer.id ?? payload.customer_id ?? payload.user_id;
        const dob = customer.birthday ?? customer.date_of_birth;
        const gender = customer.gender;

        const value = Number(
          payload.total_price ?? payload.current_total_price ?? payload.subtotal_price ?? 0,
        );
        const currency = payload.currency ?? payload.presentment_currency ?? "EUR";

        const lineItems = Array.isArray(payload.line_items) ? payload.line_items : [];
        const contents = lineItems.map((it: any) => ({
          id: String(it.product_id ?? it.variant_id ?? it.sku ?? ""),
          quantity: Number(it.quantity ?? 1),
          item_price: Number(it.price ?? 0),
        }));
        const numItems = contents.reduce((s: number, c: any) => s + (c.quantity || 0), 0) || lineItems.length;

        const userData: Record<string, unknown> = {
          em: email ? [await hashLower(email)] : undefined,
          ph: phone ? [await hashPhone(phone)] : undefined,
          fn: firstName ? [await hashLower(firstName)] : undefined,
          ln: lastName ? [await hashLower(lastName)] : undefined,
          ct: city ? [await hashLower(String(city).replace(/\s+/g, ""))] : undefined,
          st: province ? [await hashLower(province)] : undefined,
          zp: zip ? [await hashLower(zip)] : undefined,
          country: country ? [await hashLower(country)] : undefined,
          external_id: externalId ? [await hashRaw(externalId)] : undefined,
          db: dob ? [await hashLower(String(dob).replace(/-/g, ""))] : undefined,
          ge: gender ? [await hashLower(String(gender).charAt(0))] : undefined,
        };
        if (clientIp) userData.client_ip_address = clientIp;
        if (userAgent) userData.client_user_agent = userAgent;
        if (fbp) userData.fbp = fbp;
        if (fbc) userData.fbc = fbc;
        for (const k of Object.keys(userData)) if (userData[k] === undefined) delete userData[k];

        const targetUrl = cfg.target_site_url || "";
        const orderName = payload.name ?? payload.order_number ?? payload.id;

        const metaPayload: Record<string, unknown> = {
          data: [
            {
              event_name: eventName,
              event_time: Math.floor(Date.now() / 1000),
              event_source_url: targetUrl,
              action_source: "website",
              event_id: String(payload.id ?? payload.token ?? crypto.randomUUID()),
              user_data: userData,
              custom_data: {
                currency,
                value,
                contents,
                content_ids: contents.map((c: any) => c.id).filter(Boolean),
                content_type: "product",
                order_id: String(orderName ?? ""),
                num_items: numItems,
              },
            },
          ],
        };
        if (cfg.meta_test_event_code) metaPayload.test_event_code = cfg.meta_test_event_code;

        const metaUrl = `https://graph.facebook.com/v19.0/${encodeURIComponent(cfg.meta_pixel_id)}/events?access_token=${encodeURIComponent(cfg.meta_access_token)}`;
        try {
          const res = await fetch(metaUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(metaPayload),
          });
          const txt = await res.text();
          if (!res.ok) {
            await logEvent({
              topic,
              status: "meta_error",
              http_status: res.status,
              meta_event_name: eventName,
              error: txt.slice(0, 500),
            });
            return json({ error: "meta capi error", details: txt }, 500);
          }
          await logEvent({
            topic,
            status: "sent",
            http_status: 200,
            meta_event_name: eventName,
            payload_excerpt: txt.slice(0, 300),
          });
          return json({ status: "sent" });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await logEvent({ topic, status: "error", http_status: 500, meta_event_name: eventName, error: msg });
          return json({ error: msg }, 500);
        }
      },
    },
  },
});
