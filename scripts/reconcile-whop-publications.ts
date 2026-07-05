// Riconciliazione anti-duplicati Whop.
//
// Problema: i prodotti inviati a Site B PRIMA del fix avevano creato il
// prodotto su Whop ma NON avevano salvato la pubblicazione (la tabella usata
// non esisteva). Senza traccia, il prossimo invio da Site A li ricrea =
// duplicati su Whop.
//
// Questo script, per ogni store Whop collegato, legge i prodotti gia' esistenti
// su Whop che hanno metadata.bridge_product_id e crea la riga mancante in
// shop_product_whop_publications, cosi' il fan-out li SALTA invece di ricrearli.
//
// Uso (dry-run, NON scrive nulla):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... bun run scripts/reconcile-whop-publications.ts
// Per applicare davvero:
//   ... bun run scripts/reconcile-whop-publications.ts --apply
//
// Nota: i token Whop in DB sono in chiaro (ENCRYPTION_KEY non piu' usata).

import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const SUPABASE_URL = process.env.SUPABASE_URL || "https://jizvyvehbhdakugygogv.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "";

if (!SUPABASE_KEY) {
  console.error("Manca SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_PUBLISHABLE_KEY) nell'env.");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

function normalizeCompanyId(value?: string | null) {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const m = raw.match(/\b(?:biz|company)_[a-z0-9_-]+\b/i);
  return (m?.[0] ?? raw.replace(/\/+$/, "")).trim() || null;
}

async function whopGet(apiKey: string, path: string): Promise<Record<string, unknown>> {
  const token = apiKey.trim().replace(/^Bearer\s+/i, "");
  const res = await fetch(`https://api.whop.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const txt = await res.text();
  const json = txt ? JSON.parse(txt) : {};
  if (!res.ok) throw new Error(`Whop ${res.status} ${path}: ${txt.slice(0, 200)}`);
  return json as Record<string, unknown>;
}

function asArray(j: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(j.data)) return j.data as Record<string, unknown>[];
  if (Array.isArray(j)) return j as unknown as Record<string, unknown>[];
  return [];
}

async function main() {
  console.log(`Modo: ${APPLY ? "APPLY (scrive)" : "DRY-RUN (nessuna scrittura)"}  DB: ${SUPABASE_URL}`);

  const { data: stores, error } = await db
    .from("bridge_stores")
    .select("id, display_name, checkout_provider, whop_api_key_encrypted, whop_company_id, whop_plan_id")
    .in("checkout_provider", ["whop", "native"]);
  if (error) { console.error("bridge_stores:", error.message); process.exit(1); }

  const whopStores = (stores ?? []).filter((s: any) => !!s.whop_api_key_encrypted);
  console.log(`Store Whop trovati: ${whopStores.length}`);

  let createdRows = 0, skipped = 0, errors = 0;

  for (const s of whopStores as any[]) {
    const apiKey = String(s.whop_api_key_encrypted).trim();
    const companyId = normalizeCompanyId(s.whop_company_id) ?? normalizeCompanyId(s.whop_plan_id);
    const label = s.display_name || s.id;
    if (apiKey.startsWith("v1:")) { console.log(`  [${label}] API key ancora cifrata, salto`); errors++; continue; }

    try {
      // Pagina i prodotti Whop dell'azienda.
      let page = 1;
      const products: Record<string, unknown>[] = [];
      for (; page <= 50; page++) {
        const q = `/api/v1/products?per_page=50&page=${page}${companyId ? `&company_id=${encodeURIComponent(companyId)}` : ""}`;
        const j = await whopGet(apiKey, q);
        const batch = asArray(j);
        products.push(...batch);
        if (batch.length < 50) break;
      }

      const withRef = products.filter((p) => {
        const md = (p.metadata as Record<string, unknown> | undefined) ?? {};
        return typeof md.bridge_product_id === "string" && md.bridge_product_id;
      });
      console.log(`  [${label}] prodotti Whop: ${products.length}, con bridge_product_id: ${withRef.length}`);

      // Pubblicazioni gia' presenti per questo store.
      const { data: existing } = await db
        .from("shop_product_whop_publications")
        .select("product_id")
        .eq("bridge_store_id", s.id);
      const have = new Set((existing ?? []).map((r: any) => r.product_id));

      for (const p of withRef) {
        const md = p.metadata as Record<string, unknown>;
        const productId = String(md.bridge_product_id);
        const whopProductId = String(p.id ?? "");
        if (have.has(productId)) { skipped++; continue; }

        // Recupera un plan (one_time) per questo prodotto.
        let whopPlanId: string | null = null;
        try {
          const pj = await whopGet(apiKey, `/api/v1/plans?product_id=${encodeURIComponent(whopProductId)}&per_page=10`);
          const plans = asArray(pj);
          whopPlanId = plans.length ? String(plans[0].id ?? "") || null : null;
        } catch { /* plan opzionale */ }

        const row = {
          product_id: productId,
          bridge_store_id: s.id,
          whop_product_id: whopProductId,
          whop_plan_id: whopPlanId,
          whop_checkout_url: whopPlanId ? `https://whop.com/checkout/${whopPlanId}` : null,
          last_synced_at: new Date().toISOString(),
          last_error: null,
        };

        if (APPLY) {
          const { error: upErr } = await db
            .from("shop_product_whop_publications")
            .upsert(row, { onConflict: "product_id,bridge_store_id" });
          if (upErr) { console.log(`    ! ${productId}: ${upErr.message}`); errors++; continue; }
        }
        console.log(`    + ${productId}  whop_product=${whopProductId}  plan=${whopPlanId ?? "?"}`);
        createdRows++;
      }
    } catch (e) {
      console.log(`  [${label}] errore: ${e instanceof Error ? e.message : String(e)}`);
      errors++;
    }
  }

  console.log(`\nRisultato: ${createdRows} righe ${APPLY ? "create" : "da creare"}, ${skipped} gia' presenti, ${errors} errori.`);
  if (!APPLY) console.log("Esegui di nuovo con --apply per scrivere.");
}

main();
