import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { useMemo } from "react";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { ShopFooter } from "@/components/shop/ShopFooter";
import { CookieBanner } from "@/components/shop/CookieBanner";
import { createServerFn } from "@tanstack/react-start";

const search = z.object({
  session: z.string().uuid().optional(),
  p: z.string().optional(),
  v: z.string().optional(),
  q: z.coerce.number().optional(),
});

type SessionItem = {
  product_id?: string;
  product_slug?: string;
  product_title?: string;
  title?: string;
  prd_code?: string;
  sku?: string;
  source_product_id?: string;
  variant_label?: string | null;
  quantity?: number;
  unit_price?: number;
  price?: number;
  image_url?: string;
  currency?: string;
};

function itemLabel(it: SessionItem, i: number) {
  return it.product_title || it.title || it.prd_code || it.sku || it.product_slug || `Item ${i + 1}`;
}

const resolveSession = createServerFn({ method: "POST" })
  .inputValidator((input: { sessionId: string }) =>
    z.object({ sessionId: z.string().uuid() }).parse(input)
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/lib/runtime-supabase-admin");
    const { data: rows, error } = await supabaseAdmin.rpc("get_native_checkout_session", {
      _session_id: data.sessionId,
    });
    if (error) return { ok: false as const, reason: error.message, whop_checkout_url: null as string | null, whop_plan_id: null as string | null };
    const session = Array.isArray(rows) ? rows[0] : null;
    if (!session) return { ok: false as const, reason: "session_not_found", whop_checkout_url: null, whop_plan_id: null };

    const baseResult = {
      session_id: session.id as string,
      items: (session.items ?? []) as SessionItem[],
      currency: (session.currency ?? "EUR") as string,
      amount_total: Number(session.amount_total ?? 0),
      status: session.status as string,
    };

    // Resolve / provision Whop plan for iframe embed.
    let whop_plan_id: string | null = null;
    let whop_checkout_url: string | null = null;
    try {
      const { data: lookupRaw } = await supabaseAdmin.rpc(
        "bridge_lookup_session_for_whop" as never,
        { _session_id: data.sessionId } as never,
      );
      const lookup = (lookupRaw && typeof lookupRaw === "object" ? lookupRaw : {}) as Record<string, unknown>;
      if (lookup.ok === true) {
        const store = (lookup.store ?? {}) as Record<string, unknown>;
        const shadow = (lookup.shadow ?? null) as Record<string, unknown> | null;
        const sess = (lookup.session ?? {}) as Record<string, unknown>;
        const meta = (sess.metadata && typeof sess.metadata === "object" ? sess.metadata : {}) as Record<string, unknown>;

        whop_plan_id = (shadow?.whop_plan_id as string | null) ?? (typeof meta.whop_plan_id === "string" ? meta.whop_plan_id : null);
        whop_checkout_url = (shadow?.whop_checkout_url as string | null) ?? (typeof meta.whop_checkout_url === "string" ? meta.whop_checkout_url : null);

        if (!whop_plan_id
          && String(store.checkout_provider ?? "").toLowerCase() === "native"
          && typeof store.whop_api_key_encrypted === "string"
          && store.whop_api_key_encrypted
          && typeof store.whop_company_id === "string"
          && store.whop_company_id) {
          const { decryptString } = await import("@/lib/bridge/crypto.server");
          const { whopUpsertProductPlan, normalizeWhopCompanyId, WhopApiError } = await import("@/lib/sync.server");
          const apiKey = (await decryptString(store.whop_api_key_encrypted)).trim();
          const companyId = normalizeWhopCompanyId(String(store.whop_company_id));
          const items = Array.isArray(sess.items) ? sess.items as SessionItem[] : [];
          const amount = Number(sess.amount_total ?? items.reduce((s, it) => s + Number(it.unit_price ?? it.price ?? 0) * Math.max(1, Number(it.quantity ?? 1)), 0));
          const title = items.length > 1
            ? items.map((it, i) => itemLabel(it, i)).slice(0, 3).join(" + ")
            : itemLabel(items[0] ?? {}, 0);
          if (apiKey && !apiKey.startsWith("v1:") && companyId && amount > 0) {
            try {
              const res = await whopUpsertProductPlan({
                apiKey, companyId,
                productDbId: String(lookup.source_product_id ?? data.sessionId),
                title,
                description: `Checkout ${data.sessionId}`,
                price: amount,
                currency: String(sess.currency ?? baseResult.currency),
                existingWhopProductId: (shadow?.whop_product_id as string | null) ?? null,
                existingWhopPlanId: null,
              });
              whop_plan_id = res.whop_plan_id;
              whop_checkout_url = res.whop_checkout_url;
              await supabaseAdmin.rpc("bridge_save_shadow_whop_mapping" as never, {
                _bridge_store_id: String(store.id),
                _session_id: data.sessionId,
                _source_product_id: String(lookup.source_product_id ?? data.sessionId),
                _source_product_code: (lookup.source_product_code ?? null) as string | null,
                _source_product_slug: (lookup.source_product_slug ?? null) as string | null,
                _title: title,
                _price: amount,
                _currency: String(sess.currency ?? baseResult.currency),
                _whop_product_id: res.whop_product_id,
                _whop_plan_id: res.whop_plan_id,
                _whop_checkout_url: res.whop_checkout_url,
                _last_error: null,
              } as never);
            } catch (e) {
              console.warn("[checkout/demo] whop_upsert_failed", e instanceof WhopApiError ? { status: e.status, body: e.body } : String(e));
            }
          }
        }
      }
    } catch (e) {
      console.warn("[checkout/demo] whop_resolve_failed", e);
    }

    if (!whop_checkout_url && whop_plan_id) {
      whop_checkout_url = `https://whop.com/checkout/${encodeURIComponent(whop_plan_id)}/?embed=true`;
    }

    return { ok: true as const, ...baseResult, whop_plan_id, whop_checkout_url };
  });


export const Route = createFileRoute("/shop/checkout/demo")({
  validateSearch: search,
  head: () => ({ meta: [{ title: "Checkout" }, { name: "robots", content: "noindex" }] }),
  loader: async ({ location }) => {
    const s = (location.search ?? {}) as z.infer<typeof search>;
    if (!s.session) return { mode: "empty" as const };
    const res = await resolveSession({ data: { sessionId: s.session } });
    if (res.ok && res.whop_plan_id) {
      const { redirect } = await import("@tanstack/react-router");
      throw redirect({ to: "/shop/checkout/whop", search: { plan: res.whop_plan_id } });
    }
    return { mode: "session" as const, data: res };
  },
  component: InternalCheckout,
});

function InternalCheckout() {
  const loaded = Route.useLoaderData();

  const session = loaded.mode === "session" && loaded.data.ok ? loaded.data : null;
  const items = session?.items ?? [];
  const currency = session?.currency ?? "EUR";
  const total = useMemo(() => {
    if (!session) return 0;
    if (session.amount_total > 0) return session.amount_total;
    return items.reduce((s, it) => s + Number(it.unit_price ?? it.price ?? 0) * Math.max(1, Number(it.quantity ?? 1)), 0);
  }, [session, items]);

  const fmt = (n: number) => new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(n);

  if (loaded.mode === "empty") {
    return (
      <Shell>
        <h1 className="font-display text-3xl font-light">Nessuna sessione</h1>
        <p className="mt-4 text-sm text-muted-foreground">Apri il checkout dal carrello.</p>
        <div className="mt-8"><Link to="/shop/carrello" className="border border-border px-5 py-2.5 text-[11px] uppercase tracking-[0.18em]">Torna al carrello</Link></div>
      </Shell>
    );
  }

  if (!session) {
    return (
      <Shell>
        <h1 className="font-display text-3xl font-light">Sessione non trovata</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          {loaded.mode === "session" && !loaded.data.ok ? loaded.data.reason : "Riprova dal carrello."}
        </p>
        <div className="mt-8"><Link to="/shop/carrello" className="border border-border px-5 py-2.5 text-[11px] uppercase tracking-[0.18em]">Torna al carrello</Link></div>
      </Shell>
    );
  }


  const whopUrl = session.whop_checkout_url;

  return (
    <div className="min-h-screen">
      <ShopHeader />
      <main className="mx-auto grid max-w-6xl gap-10 px-6 py-12 md:grid-cols-[1.4fr_1fr]">
        <section>
          <h1 className="font-display text-2xl font-light">Checkout</h1>
          <p className="mt-2 text-xs text-muted-foreground">Pagamento sicuro via Whop, integrato nel sito.</p>

          <div className="mt-6 overflow-hidden rounded border border-border bg-secondary/20">
            {whopUrl ? (
              <iframe
                title="Whop checkout"
                src={whopUrl}
                allow="payment *; clipboard-write"
                className="h-[820px] w-full bg-background"
              />
            ) : (
              <div className="p-10 text-center text-sm text-muted-foreground">
                Impossibile caricare il checkout. Plan Whop non disponibile per questa sessione.
                {session.whop_plan_id ? null : <div className="mt-2 text-[11px]">Nessun plan_id risolto.</div>}
              </div>
            )}
          </div>
        </section>


        <aside className="rounded border border-border p-6">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Riepilogo ordine</div>
          <ul className="mt-4 divide-y divide-border">
            {items.map((it, i) => {
              const qty = Math.max(1, Number(it.quantity ?? 1));
              const price = Number(it.unit_price ?? it.price ?? 0);
              return (
                <li key={i} className="flex items-start justify-between gap-3 py-3 text-sm">
                  <div>
                    <div className="font-medium">{itemLabel(it, i)}</div>
                    {it.variant_label && <div className="text-xs text-muted-foreground">{it.variant_label}</div>}
                    <div className="text-xs text-muted-foreground">Qtà {qty}</div>
                  </div>
                  <div className="whitespace-nowrap">{fmt(price * qty)}</div>
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex items-center justify-between border-t border-border pt-4 text-sm font-medium">
            <span>Totale</span>
            <span>{fmt(total)}</span>
          </div>
          <div className="mt-4 text-[10px] text-muted-foreground">Sessione: {session.session_id}</div>
        </aside>
      </main>
      <ShopFooter />
      <CookieBanner />
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <ShopHeader />
      <main className="mx-auto max-w-2xl px-6 py-20 text-center">{children}</main>
      <ShopFooter />
      <CookieBanner />
    </div>
  );
}
