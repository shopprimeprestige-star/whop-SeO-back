import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { Lock, ChevronDown, Loader2, CheckCircle2 } from "lucide-react";
import { WhopCheckoutEmbed, useCheckoutEmbedControls } from "@whop/checkout/react";
import { createServerFn } from "@tanstack/react-start";
import { detectGeo, makeT, localeForLang, flagEmoji, countryName, currencyForCountry, getRates, convertAmount, formatMoney, COUNTRY_TO_CURRENCY, COUNTRY_TO_LANG, type Lang } from "@/lib/checkout-i18n";
import { useSiteSettings } from "@/hooks/use-site-settings";

const searchSchema = z.object({
  plan: z.string().min(1).max(120),
  session: z.string().uuid().optional(),
});

type SessionItem = {
  product_title?: string;
  title?: string;
  prd_code?: string;
  sku?: string;
  product_slug?: string;
  variant_label?: string | null;
  quantity?: number;
  unit_price?: number;
  price?: number;
  image_url?: string;
  display_image_url?: string;
  product_image?: string;
};

type ShippingMethod = {
  id: string;
  label: string;
  description: string | null;
  price: number;
  delivery_estimate: string | null;
  free_over: number | null;
};

function isCode(v?: string) {
  return !!v && (/^prd-\d+$/i.test(v) || /^\d{3,}$/.test(v));
}
function itemLabel(it: SessionItem, fallback: string) {
  const raw = it.product_title || it.title || it.prd_code || it.sku || it.product_slug || "";
  // I codici-disguise (es. PRD-04318) non vengono mostrati al cliente: usa un'etichetta pulita.
  return isCode(raw) || !raw ? fallback : raw;
}
function itemImage(it: SessionItem) {
  return it.display_image_url || it.image_url || it.product_image || "";
}

// --- server: carica sessione (articoli) + metodi di spedizione ---
const loadCheckout = createServerFn({ method: "POST" })
  .inputValidator((input: { sessionId: string }) => z.object({ sessionId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/lib/runtime-supabase-admin");
    const { data: rows } = await supabaseAdmin.rpc("get_native_checkout_session", { _session_id: data.sessionId });
    const s = Array.isArray(rows) ? rows[0] : null;
    if (!s) return { ok: false as const, reason: "session_not_found" };
    let methods: ShippingMethod[] = [];
    try {
      const { data: m } = await supabaseAdmin.rpc("get_shipping_methods" as never, { _bridge_store_id: (s as Record<string, unknown>).bridge_store_id ?? null } as never);
      methods = (Array.isArray(m) ? m : []) as ShippingMethod[];
    } catch { /* tabella assente */ }
    return {
      ok: true as const,
      items: ((s as Record<string, unknown>).items ?? []) as SessionItem[],
      currency: (((s as Record<string, unknown>).currency as string) ?? "EUR"),
      subtotal: Number((s as Record<string, unknown>).amount_total ?? 0),
      methods,
    };
  });

// --- server: (ri)crea un piano Whop per il totale (subtotale + spedizione) ---
const preparePlan = createServerFn({ method: "POST" })
  .inputValidator((input: { sessionId: string; amount: number; currency?: string }) =>
    z.object({ sessionId: z.string().uuid(), amount: z.number().positive(), currency: z.string().min(3).max(3).optional() }).parse(input))
  .handler(async ({ data }): Promise<{ ok: boolean; plan_id?: string; reason?: string }> => {
    const { supabaseAdmin } = await import("@/lib/runtime-supabase-admin");
    const { data: rows } = await supabaseAdmin.rpc("get_native_checkout_session", { _session_id: data.sessionId });
    const s = Array.isArray(rows) ? rows[0] : null;
    if (!s) return { ok: false, reason: "session_not_found" };
    const storeId = (s as Record<string, unknown>).bridge_store_id as string | null;
    if (!storeId) return { ok: false, reason: "missing_store" };
    const { data: store } = await supabaseAdmin
      .from("bridge_stores")
      .select("id, whop_api_key_encrypted, whop_company_id")
      .eq("id", storeId)
      .maybeSingle();
    const row = store as { whop_api_key_encrypted?: string | null; whop_company_id?: string | null } | null;
    if (!row?.whop_api_key_encrypted || !row?.whop_company_id) return { ok: false, reason: "missing_whop_config" };
    try {
      const { decryptString } = await import("@/lib/bridge/crypto.server");
      const { whopUpsertProductPlan, normalizeWhopCompanyId } = await import("@/lib/sync.server");
      const apiKey = (await decryptString(row.whop_api_key_encrypted)).trim();
      if (!apiKey || apiKey.startsWith("v1:")) return { ok: false, reason: "api_key_encrypted" };
      const companyId = normalizeWhopCompanyId(String(row.whop_company_id));
      const currency = (data.currency || String((s as Record<string, unknown>).currency ?? "EUR")).toUpperCase();
      const res = await whopUpsertProductPlan({
        apiKey, companyId,
        productDbId: `${data.sessionId}-${currency}-${Math.round(data.amount * 100)}`,
        title: "Ordine",
        description: `Checkout ${data.sessionId}`,
        price: data.amount,
        currency,
        existingWhopProductId: null,
        existingWhopPlanId: null,
      });
      // Salva il plan_id nella sessione (metadata) per collegare il webhook Whop alla sessione.
      try {
        const { data: cur } = await supabaseAdmin
          .from("native_checkout_sessions")
          .select("metadata")
          .eq("id", data.sessionId)
          .maybeSingle();
        const meta = ((cur as { metadata?: Record<string, unknown> } | null)?.metadata ?? {}) as Record<string, unknown>;
        await supabaseAdmin
          .from("native_checkout_sessions")
          .update({ metadata: { ...meta, whop_plan_id: res.whop_plan_id } as never })
          .eq("id", data.sessionId);
      } catch { /* non bloccare il checkout */ }
      return { ok: true, plan_id: res.whop_plan_id };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : "whop_error" };
    }
  });

// --- server: a pagamento completato, marca la sessione e notifica Sito A (conversione) ---
const recordNativeConversion = createServerFn({ method: "POST" })
  .inputValidator((input: { sessionId: string; receipt?: string }) =>
    z.object({ sessionId: z.string().uuid(), receipt: z.string().max(200).optional() }).parse(input))
  .handler(async ({ data }): Promise<{ ok: boolean; notified?: boolean; reason?: string }> => {
    const { supabaseAdmin } = await import("@/lib/runtime-supabase-admin");
    const { data: s } = await supabaseAdmin
      .from("native_checkout_sessions")
      .select("id, site_a_store_id, amount_total, currency, metadata, status")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (!s) return { ok: false, reason: "session_not_found" };
    const row = s as Record<string, unknown>;

    // Idempotenza: se già pagata (es. webhook Whop già arrivato), non rinotificare (evita doppio fatturato)
    if (row.status === "paid") return { ok: true, notified: false, reason: "already_paid" };

    // marca pagata (idempotente)
    await supabaseAdmin
      .from("native_checkout_sessions")
      .update({ status: "paid", external_session_id: data.receipt ?? null, updated_at: new Date().toISOString() } as never)
      .eq("id", data.sessionId);

    const siteSession = (row.metadata as { session_id?: string } | null)?.session_id;
    const siteAStoreId = row.site_a_store_id as string;
    const { data: store } = await supabaseAdmin
      .from("bridge_stores")
      .select("*")
      .eq("site_a_store_id", siteAStoreId)
      .maybeSingle();
    if (!store) return { ok: true, notified: false, reason: "store_not_found" };
    if (!siteSession) return { ok: true, notified: false, reason: "missing_site_session" };

    const { notifyCallback } = await import("@/lib/bridge/auth.server");
    const res = await notifyCallback(store as never, "order_paid", {
      session_id: siteSession,
      amount: Number(row.amount_total ?? 0),
      currency: String(row.currency ?? "EUR"),
      receipt: data.receipt ?? null,
    });
    return { ok: true, notified: !!res?.ok, reason: res?.ok ? undefined : (res?.error || "callback_failed") };
  });

export const Route = createFileRoute("/shop/checkout/whop")({
  validateSearch: (search) => searchSchema.parse(search),
  head: () => ({
    meta: [{ title: "Checkout" }, { name: "robots", content: "noindex" }],
    links: [
      { rel: "preconnect", href: "https://js.whop.com", crossOrigin: "anonymous" },
      { rel: "preconnect", href: "https://whop.com", crossOrigin: "anonymous" },
    ],
  }),
  loader: async ({ location }) => {
    const s = (location.search ?? {}) as z.infer<typeof searchSchema>;
    if (!s.session) return { data: null };
    const res = await loadCheckout({ data: { sessionId: s.session } });
    return { data: res.ok ? res : null };
  },
  component: CheckoutPage,
});

const inputCls =
  "w-full rounded-lg border border-[#d9d9d9] bg-white px-3.5 py-3 text-[15px] text-[#1a1a1a] placeholder:text-[#737373] outline-none focus:border-[#1a1a1a] focus:ring-1 focus:ring-[#1a1a1a] transition";

function CheckoutPage() {
  const { plan: initialPlan, session } = Route.useSearch();
  const loaded = Route.useLoaderData();
  const data = loaded.data;

  const controlsRef = useCheckoutEmbedControls();
  const site = useSiteSettings();
  const [lang, setLang] = useState<Lang>("it");
  const [geoCountry, setGeoCountry] = useState<string>("IT");
  const [rates, setRates] = useState<Record<string, number>>({ EUR: 1 });
  const [displayCurrency, setDisplayCurrency] = useState<string | null>(null);
  const t = makeT(lang);
  const [plan, setPlan] = useState(initialPlan);
  const [planLoading, setPlanLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ receipt?: string } | null>(null);
  const [showSummary, setShowSummary] = useState(false);

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [newsletter, setNewsletter] = useState(true);
  const [nome, setNome] = useState("");
  const [cognome, setCognome] = useState("");
  const [indirizzo, setIndirizzo] = useState("");
  const [apt, setApt] = useState("");
  const [citta, setCitta] = useState("");
  const [provincia, setProvincia] = useState("");
  const [cap, setCap] = useState("");

  const items = data?.items ?? [];
  const sessionCurrency = (data?.currency ?? "EUR").toUpperCase();
  const currency = (displayCurrency || sessionCurrency).toUpperCase();
  const subtotalBase = useMemo(() => {
    if (data && data.subtotal > 0) return data.subtotal;
    return items.reduce((s, it) => s + Number(it.unit_price ?? it.price ?? 0) * Math.max(1, Number(it.quantity ?? 1)), 0);
  }, [data, items]);
  const methods = data?.methods ?? [];

  const [shippingId, setShippingId] = useState<string>(methods[0]?.id ?? "");
  const selectedMethod = methods.find((m) => m.id === shippingId) ?? methods[0] ?? null;

  // Importi convertiti nella valuta di visualizzazione. subtotale è in sessionCurrency,
  // i prezzi di spedizione sono in EUR (base shop), il confronto soglia free è in EUR.
  const subtotal = convertAmount(subtotalBase, sessionCurrency, currency, rates);
  const subtotalEur = convertAmount(subtotalBase, sessionCurrency, "EUR", rates);
  const shippingCost = useMemo(() => {
    if (!selectedMethod) return 0;
    if (selectedMethod.free_over != null && subtotalEur >= Number(selectedMethod.free_over)) return 0;
    return convertAmount(Number(selectedMethod.price) || 0, "EUR", currency, rates);
  }, [selectedMethod, subtotalEur, currency, rates]);
  const total = subtotal + shippingCost;

  const fmt = (n: number) => formatMoney(n, currency, lang);

  const countryOptions = useMemo(
    () => Object.keys(COUNTRY_TO_CURRENCY)
      .map((cc) => ({ cc, name: countryName(cc, lang), flag: flagEmoji(cc) }))
      .sort((a, b) => a.name.localeCompare(b.name, localeForLang(lang))),
    [lang],
  );

  // Rilevamento geo (come Sito A): paese da IP → lingua + paese spedizione + valuta.
  useEffect(() => {
    let cancelled = false;
    getRates().then((r) => { if (!cancelled) setRates(r); }).catch(() => {});
    detectGeo().then((g) => {
      if (cancelled) return;
      setLang(g.lang);
      if (g.country) {
        setGeoCountry(g.country);
        const cur = currencyForCountry(g.country);
        if (cur) setDisplayCurrency(cur);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // (Ri)crea il piano Whop nella valuta+totale correnti. Usa il piano iniziale solo
  // se valuta == sessionCurrency e nessuna spedizione a pagamento.
  const lastKeyRef = useRef<string>("");
  useEffect(() => {
    if (!session) return;
    const sameCurrency = currency === sessionCurrency;
    const noShipping = Math.round(shippingCost * 100) === 0;
    if (sameCurrency && noShipping) {
      setPlan(initialPlan);
      lastKeyRef.current = `${sessionCurrency}:${Math.round(subtotal * 100)}`;
      return;
    }
    if (total <= 0) return;
    const key = `${currency}:${Math.round(total * 100)}`;
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;
    let cancelled = false;
    setPlanLoading(true);
    preparePlan({ data: { sessionId: session, amount: total, currency } })
      .then((r) => { if (!cancelled && r.ok && r.plan_id) setPlan(r.plan_id); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setPlanLoading(false); });
    return () => { cancelled = true; };
  }, [currency, sessionCurrency, total, subtotal, shippingCost, session, initialPlan]);

  const handlePay = async () => {
    if (!controlsRef.current) return;
    if (!email) { setError(t("enter_email")); return; }
    setSubmitting(true);
    setError(null);
    try {
      await controlsRef.current.submit();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pagamento non riuscito");
    } finally {
      setSubmitting(false);
    }
  };

  const OrderSummary = (
    <div className="space-y-4">
      <ul className="space-y-4">
        {items.map((it, i) => {
          const qty = Math.max(1, Number(it.quantity ?? 1));
          const price = Number(it.unit_price ?? it.price ?? 0);
          const img = itemImage(it);
          return (
            <li key={i} className="flex items-center gap-3">
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-[#e3e3e3] bg-white">
                {img ? <img src={img} alt="" className="h-full w-full object-cover" /> : <div className="h-full w-full bg-[#f0f0f0]" />}
                <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#737373] px-1.5 text-[11px] font-medium text-white">{qty}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-[#1a1a1a]">{itemLabel(it, t("product"))}</div>
                {it.variant_label && <div className="text-[12px] text-[#737373]">{it.variant_label}</div>}
              </div>
              <div className="text-[13px] text-[#1a1a1a]">{fmt(convertAmount(price * qty, sessionCurrency, currency, rates))}</div>
            </li>
          );
        })}
      </ul>
      <div className="flex gap-2">
        <input className={inputCls + " flex-1"} placeholder={t("discount_code")} />
        <button type="button" className="rounded-lg border border-[#d9d9d9] bg-[#f5f5f5] px-4 text-[14px] font-medium text-[#737373]">{t("apply")}</button>
      </div>
      <div className="space-y-2 border-t border-[#e3e3e3] pt-4 text-[14px]">
        <div className="flex justify-between text-[#4a4a4a]"><span>{t("subtotal")}</span><span>{fmt(subtotal)}</span></div>
        <div className="flex justify-between text-[#4a4a4a]"><span>{t("shipping_label")}</span><span>{shippingCost === 0 ? t("free") : fmt(shippingCost)}</span></div>
      </div>
      <div className="flex items-end justify-between border-t border-[#e3e3e3] pt-4">
        <span className="text-[16px] font-semibold text-[#1a1a1a]">{t("total")}</span>
        <span className="text-[20px] font-semibold text-[#1a1a1a]"><span className="mr-1 text-[12px] font-normal text-[#737373]">{currency}</span>{fmt(total)}</span>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-[#e3e3e3]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 lg:px-8">
          <Link to="/" className="flex items-center gap-2">
            {site.logo_url ? (
              <img src={site.logo_url} alt={site.brand_name} className="h-8 w-auto max-w-[180px] object-contain" />
            ) : (
              <span className="text-2xl font-bold tracking-tight text-emerald-600">{site.brand_name || "Checkout"}</span>
            )}
          </Link>
          <span className="inline-flex items-center gap-1.5 text-[12px] text-[#737373]"><Lock className="h-3.5 w-3.5" /> {t("secure_payment")}</span>
        </div>
      </header>

      {done ? (
        <main className="mx-auto max-w-2xl px-4 py-20 text-center">
          <div className="mx-auto mb-6 grid h-16 w-16 place-items-center rounded-full bg-emerald-100">
            <CheckCircle2 className="h-8 w-8 text-emerald-600" />
          </div>
          <h1 className="text-[26px] font-semibold tracking-tight text-[#1a1a1a]">{t("order_confirmed")}</h1>
          <p className="mt-3 text-[15px] text-[#4a4a4a]">{t("thanks_email")}</p>
          {done.receipt && (
            <p className="mt-2 text-[13px] text-[#737373]">#<span className="font-mono">{done.receipt}</span></p>
          )}
          <div className="mx-auto mt-6 inline-flex items-center gap-3 rounded-xl border border-[#e3e3e3] bg-[#fafafa] px-5 py-3 text-[14px]">
            <span className="text-[#737373]">{t("total")}</span>
            <span className="font-semibold text-[#1a1a1a]">{currency} {fmt(total)}</span>
          </div>
          <div className="mt-8">
            <Link to="/" className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#1a1a1a] px-6 py-3 text-[14px] font-medium text-white transition hover:bg-black">
              ← {site.brand_name || "Shop"}
            </Link>
          </div>
        </main>
      ) : (
      <>
      <div className="border-b border-[#e3e3e3] bg-[#fafafa] lg:hidden">
        <button type="button" onClick={() => setShowSummary((v) => !v)} className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3 text-[14px] text-emerald-700">
          <span className="inline-flex items-center gap-1.5"><ChevronDown className={`h-4 w-4 transition ${showSummary ? "rotate-180" : ""}`} /> {showSummary ? t("hide_summary") : t("show_summary")}</span>
          <span className="font-semibold text-[#1a1a1a]">{fmt(total)}</span>
        </button>
        {showSummary && <div className="border-t border-[#e3e3e3] px-4 py-5">{OrderSummary}</div>}
      </div>

      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 py-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16 lg:px-8 lg:py-12">
        <div className="order-2 lg:order-1">
          {error && <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          <div className="space-y-8">
            <section>
              <h2 className="mb-3 text-[18px] font-semibold text-[#1a1a1a]">{t("contact")}</h2>
              <div className="space-y-3">
                <input type="email" className={inputCls} placeholder={t("email")} value={email} onChange={(e) => setEmail(e.target.value)} />
                <input type="tel" className={inputCls} placeholder={t("phone_opt")} value={phone} onChange={(e) => setPhone(e.target.value)} />
                <label className="flex items-center gap-2 text-[14px] text-[#4a4a4a]">
                  <input type="checkbox" checked={newsletter} onChange={(e) => setNewsletter(e.target.checked)} className="h-4 w-4 rounded border-[#d9d9d9]" />
                  {t("newsletter")}
                </label>
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-[18px] font-semibold text-[#1a1a1a]">{t("delivery")}</h2>
              <div className="space-y-3">
                <div className="rounded-lg border border-[#d9d9d9] bg-white px-3.5 pt-2 pb-1.5">
                  <label className="text-[11px] uppercase tracking-wide text-[#737373]">{t("country_region")}</label>
                  <select
                    value={geoCountry}
                    onChange={(e) => {
                      const cc = e.target.value;
                      setGeoCountry(cc);
                      const cur = currencyForCountry(cc);
                      if (cur) setDisplayCurrency(cur);
                      const lg = COUNTRY_TO_LANG[cc];
                      if (lg) setLang(lg);
                    }}
                    className="w-full bg-transparent text-[15px] text-[#1a1a1a] outline-none"
                  >
                    {countryOptions.map((c) => (
                      <option key={c.cc} value={c.cc}>{c.flag} {c.name}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input className={inputCls} placeholder={t("first_name")} value={nome} onChange={(e) => setNome(e.target.value)} />
                  <input className={inputCls} placeholder={t("last_name")} value={cognome} onChange={(e) => setCognome(e.target.value)} />
                </div>
                <input className={inputCls} placeholder={t("address")} value={indirizzo} onChange={(e) => setIndirizzo(e.target.value)} />
                <input className={inputCls} placeholder={t("apt_opt")} value={apt} onChange={(e) => setApt(e.target.value)} />
                <input className={inputCls} placeholder={t("city")} value={citta} onChange={(e) => setCitta(e.target.value)} />
                <div className="grid grid-cols-2 gap-3">
                  <input className={inputCls} placeholder={t("province")} value={provincia} onChange={(e) => setProvincia(e.target.value)} />
                  <input className={inputCls} placeholder={t("zip")} value={cap} onChange={(e) => setCap(e.target.value)} />
                </div>
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-[18px] font-semibold text-[#1a1a1a]">{t("shipping")}</h2>
              {methods.length === 0 ? (
                <div className="rounded-lg border border-[#e3e3e3] bg-[#fafafa] px-3.5 py-3 text-[14px] text-[#737373]">{t("no_shipping")}</div>
              ) : (
                <div className="overflow-hidden rounded-lg border border-[#d9d9d9]">
                  {methods.map((m, idx) => {
                    const free = m.free_over != null && subtotal >= Number(m.free_over);
                    const cost = free ? 0 : Number(m.price) || 0;
                    const active = (selectedMethod?.id ?? "") === m.id;
                    return (
                      <label key={m.id} className={`flex cursor-pointer items-center justify-between gap-3 px-4 py-3.5 ${idx > 0 ? "border-t border-[#e3e3e3]" : ""} ${active ? "bg-emerald-50" : "bg-white"}`}>
                        <span className="flex items-center gap-3">
                          <input type="radio" name="shipping" checked={active} onChange={() => setShippingId(m.id)} className="h-4 w-4 accent-emerald-600" />
                          <span>
                            <span className="text-[14px] font-medium text-[#1a1a1a]">{m.label}</span>
                            {m.delivery_estimate && <span className="ml-2 text-[13px] text-[#737373]">{m.delivery_estimate}</span>}
                            {m.description && <span className="block text-[12px] text-[#737373]">{m.description}</span>}
                          </span>
                        </span>
                        <span className="text-[14px] font-medium text-[#1a1a1a]">{cost === 0 ? t("free") : fmt(cost)}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </section>

            <section>
              <h2 className="mb-1 text-[18px] font-semibold text-[#1a1a1a]">{t("billing")}</h2>
              <p className="mb-3 text-[13px] text-[#737373]">{t("secure_note")}</p>
              <div className="relative overflow-hidden rounded-xl border border-[#d9d9d9]">
                {planLoading && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 text-[13px] text-[#737373]">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t("updating_total")}
                  </div>
                )}
                <div className="p-3 sm:p-4">
                  <WhopCheckoutEmbed
                    key={plan}
                    ref={controlsRef}
                    planId={plan}
                    theme="light"
                    hidePrice={true}
                    hideEmail={true}
                    disableEmail={true}
                    hideAddressForm={true}
                    hideSubmitButton={true}
                    hideTermsAndConditions={true}
                    skipRedirect={true}
                    returnUrl={typeof window !== "undefined" ? window.location.href : ""}
                    prefill={email ? { email } : undefined}
                    onComplete={(_a, b) => {
                      const receipt = typeof b === "string" ? b : undefined;
                      setDone({ receipt });
                      if (session) {
                        recordNativeConversion({ data: { sessionId: session, receipt } }).catch((e) => console.error("conversion notify failed", e));
                      }
                    }}
                  />
                </div>
              </div>
            </section>

            <button
              type="button"
              onClick={handlePay}
              disabled={submitting || planLoading || !!done}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-6 py-4 text-[15px] font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
            >
              {submitting ? (<><Loader2 className="h-4 w-4 animate-spin" /> {t("paying")}</>) : (<><Lock className="h-4 w-4" /> {t("pay_now")} · {fmt(total)}</>)}
            </button>
          </div>
        </div>

        <aside className="order-1 hidden lg:order-2 lg:block">
          <div className="sticky top-8 rounded-xl border border-[#e3e3e3] bg-[#fafafa] p-6">{OrderSummary}</div>
        </aside>
      </main>
      </>
      )}
    </div>
  );
}
