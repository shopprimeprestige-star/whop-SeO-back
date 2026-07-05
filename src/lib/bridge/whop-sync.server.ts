// Sincronizza un prodotto del catalogo (shop_products) su TUTTI gli account Whop collegati.
// Idempotente: usa la tabella shop_product_whop_publications per saltare i Whop già sincronizzati.
import { supabaseAdmin } from "@/lib/runtime-supabase-admin";
import { decryptString } from "@/lib/bridge/crypto.server";

async function whopFetch(apiKey: string, path: string, init?: RequestInit) {
  const token = apiKey.trim().replace(/^Bearer\s+/i, "");
  if (/^whsec_/i.test(token)) throw new Error("Whop API key non valida (è un webhook secret)");
  const res = await fetch(`https://api.whop.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json", ...(init?.headers ?? {}) },
  });
  const txt = await res.text();
  let json: Record<string, unknown> | null = null;
  try { json = txt ? (JSON.parse(txt) as Record<string, unknown>) : null; } catch { /* raw */ }
  if (!res.ok) {
    const errObj = json?.error as Record<string, unknown> | string | undefined;
    const detail = (typeof json?.message === "string" && json.message)
      || (typeof errObj === "string" && errObj)
      || (errObj && typeof errObj === "object" && typeof errObj.message === "string" && errObj.message)
      || txt.slice(0, 200) || res.statusText;
    throw new Error(`Whop ${res.status} ${path}: ${detail}`);
  }
  return (json ?? {}) as Record<string, unknown>;
}

function whopTitle(title: string) {
  return title.length > 80 ? `${title.slice(0, 77)}...` : title;
}

function normalizeCompanyId(value?: string | null) {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const match = raw.match(/\b(?:biz|company)_[a-z0-9_-]+\b/i);
  return (match?.[0] ?? raw.replace(/\/+$/, "")).trim() || null;
}

export type WhopFanoutResult = {
  ok: boolean;
  product_id: string;
  synced: number;
  skipped: number;
  failed: number;
  lastError?: string;
  results: Array<{ store_id: string; status: "synced" | "skipped" | "failed"; whop_plan_id?: string | null; error?: string }>;
};

export async function syncShopProductToAllWhop(shopProductId: string): Promise<WhopFanoutResult> {
  const out: WhopFanoutResult = { ok: true, product_id: shopProductId, synced: 0, skipped: 0, failed: 0, results: [] };

  const { data: product, error: pErr } = await supabaseAdmin
    .from("shop_products")
    .select("id, title, description, price, currency")
    .eq("id", shopProductId)
    .maybeSingle();
  if (pErr || !product) { out.ok = false; return out; }
  const p = product as { id: string; title: string; description: string | null; price: number; currency: string | null };

  // Tutti gli store con Whop configurato.
  const { data: stores } = await supabaseAdmin
    .from("bridge_stores")
    .select("id, checkout_provider, whop_api_key_encrypted, whop_company_id, whop_plan_id")
    .in("checkout_provider", ["whop", "native"]);
  const whopStores = (stores ?? []).filter((s) => !!(s as { whop_api_key_encrypted?: string | null }).whop_api_key_encrypted);
  if (whopStores.length === 0) return out;

  // Link già esistenti per questo prodotto (idempotenza).
  const { data: links } = await supabaseAdmin
    .from("shop_product_whop_publications")
    .select("id, bridge_store_id, whop_plan_id")
    .eq("product_id", p.id);
  const linkByStore = new Map<string, { id: string; whop_plan_id: string | null }>(
    (links ?? []).map((l) => [(l as { bridge_store_id: string }).bridge_store_id, { id: (l as { id: string }).id, whop_plan_id: (l as { whop_plan_id?: string | null }).whop_plan_id ?? null }]),
  );
  const done = new Set([...linkByStore.entries()].filter(([, v]) => v.whop_plan_id).map(([k]) => k));

  for (const sRaw of whopStores) {
    const s = sRaw as { id: string; whop_api_key_encrypted: string; whop_company_id?: string | null; whop_plan_id?: string | null };
    if (done.has(s.id)) { out.skipped++; out.results.push({ store_id: s.id, status: "skipped" }); continue; }
    try {
      const apiKey = (await decryptString(s.whop_api_key_encrypted)).trim();
      if (!apiKey || apiKey.startsWith("v1:")) throw new Error("API key Whop non decifrabile");
      const companyId = normalizeCompanyId(s.whop_company_id) ?? normalizeCompanyId(s.whop_plan_id);
      if (!companyId) throw new Error("Whop Company ID mancante sullo store");

      const created = await whopFetch(apiKey, "/api/v1/products", {
        method: "POST",
        body: JSON.stringify({
          company_id: companyId,
          title: whopTitle(p.title),
          description: p.description ?? p.title,
          visibility: "visible",
          collect_shipping_address: true,
          metadata: { bridge_product_id: p.id },
        }),
      });
      const whopProductId = String(created.id ?? "");
      if (!whopProductId) throw new Error("Whop non ha restituito un product id");

      const plan = await whopFetch(apiKey, "/api/v1/plans", {
        method: "POST",
        body: JSON.stringify({
          company_id: companyId,
          product_id: whopProductId,
          plan_type: "one_time",
          release_method: "buy_now",
          title: whopTitle(p.title),
          description: p.description ?? p.title,
          initial_price: Number(p.price),
          currency: (p.currency ?? "EUR").toLowerCase(),
          visibility: "visible",
          unlimited_stock: true,
          metadata: { bridge_product_id: p.id },
        }),
      });
      const whopPlanId = String(plan.id ?? "");
      if (!whopPlanId) throw new Error("Whop non ha restituito un plan id");

      // Scrittura link robusta (no onConflict): update se esiste, altrimenti insert. Errori NON silenziosi.
      const checkoutUrl = whopPlanId ? `https://whop.com/checkout/${whopPlanId}` : null;
      const existing = linkByStore.get(s.id);
      let writeErr: { message?: string } | null = null;
      if (existing) {
        ({ error: writeErr } = await supabaseAdmin
          .from("shop_product_whop_publications")
          .update({ whop_product_id: whopProductId, whop_plan_id: whopPlanId, whop_checkout_url: checkoutUrl, last_synced_at: new Date().toISOString(), last_error: null } as never)
          .eq("id", existing.id));
      } else {
        ({ error: writeErr } = await supabaseAdmin
          .from("shop_product_whop_publications")
          .insert({ product_id: p.id, bridge_store_id: s.id, whop_product_id: whopProductId, whop_plan_id: whopPlanId, whop_checkout_url: checkoutUrl, last_synced_at: new Date().toISOString() } as never));
      }
      if (writeErr) throw new Error(`link_write: ${writeErr.message}`);

      out.synced++;
      out.results.push({ store_id: s.id, status: "synced", whop_plan_id: whopPlanId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.failed++;
      out.lastError = msg;
      out.results.push({ store_id: s.id, status: "failed", error: msg });
      try {
        const existing = linkByStore.get(s.id);
        if (existing) {
          await supabaseAdmin.from("shop_product_whop_publications").update({ last_error: msg, last_synced_at: new Date().toISOString() } as never).eq("id", existing.id);
        } else {
          await supabaseAdmin.from("shop_product_whop_publications").insert({ product_id: p.id, bridge_store_id: s.id, last_error: msg, last_synced_at: new Date().toISOString() } as never);
        }
      } catch { /* ignore */ }
    }
  }
  return out;
}
