import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { ShopFooter } from "@/components/shop/ShopFooter";
import { CookieBanner } from "@/components/shop/CookieBanner";
import { useCart, cartTotal } from "@/stores/cart";
import { useServerFn } from "@tanstack/react-start";
import { shopCreateCheckout } from "@/server-fn/shop.functions";
import { Trash2, Minus, Plus, ArrowRight } from "lucide-react";
import { toast } from "sonner";

const fmt = (v: number, c: string) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: c, minimumFractionDigits: 0 }).format(v);

export const Route = createFileRoute("/shop/carrello")({
  head: () => ({
    meta: [
      { title: "Carrello — Atelier Nord" },
      { name: "description", content: "Rivedi i tuoi articoli prima del checkout." },
    ],
  }),
  component: CartPage,
});

function CartPage() {
  const lines = useCart((s) => s.lines);
  const setQty = useCart((s) => s.setQty);
  const remove = useCart((s) => s.remove);
  const clear = useCart((s) => s.clear);
  const navigate = useNavigate();
  const checkout = useServerFn(shopCreateCheckout);
  const [loading, setLoading] = useState(false);

  const total = cartTotal(lines);
  const currency = lines[0]?.currency ?? "EUR";
  const shipping = total >= 150 || total === 0 ? 0 : 9.9;

  async function goCheckout() {
    if (lines.length === 0) return;
    setLoading(true);
    try {
      const sessionId = (typeof window !== "undefined" && localStorage.getItem("atelier-session")) ||
        crypto.randomUUID();
      if (typeof window !== "undefined") localStorage.setItem("atelier-session", sessionId);
      // Multi-line: tutte le righe vengono unite in un unico draft order
      const res = await checkout({
        data: {
          items: lines.map((l) => ({ productSlug: l.productSlug, variantId: l.variantId, quantity: l.quantity })),
          sessionId,
        },
      });
      if (!res.ok) {
        toast.error(("message" in res && res.message) || "Checkout non disponibile per questo prodotto");
        return;
      }
      if (res.demo) {
        navigate({ to: res.redirect_url as "/shop/checkout/demo" });
      } else {
        if (typeof window !== "undefined") window.location.href = res.redirect_url!;
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore checkout");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen">
      <ShopHeader />
      <main className="mx-auto max-w-6xl px-6 py-12">
        <h1 className="font-display text-3xl font-light md:text-4xl">Carrello</h1>

        {lines.length === 0 ? (
          <div className="mt-16 text-center">
            <p className="text-sm text-muted-foreground">Il tuo carrello è vuoto.</p>
            <Link to="/" className="mt-6 inline-block border-b border-foreground pb-1 text-[11px] font-medium uppercase tracking-[0.18em]">
              Continua lo shopping
            </Link>
          </div>
        ) : (
          <div className="mt-10 grid gap-12 lg:grid-cols-[1fr_360px]">
            {/* RIGHE */}
            <div className="divide-y divide-border border-y border-border">
              {lines.map((l) => (
                <div key={l.variantId} className="flex gap-4 py-6">
                  <Link to="/shop/prodotto/$slug" params={{ slug: l.productSlug }} className="block h-32 w-24 shrink-0 overflow-hidden bg-muted">
                    {l.image && <img src={l.image} alt={l.productTitle} className="h-full w-full object-cover" />}
                  </Link>
                  <div className="flex flex-1 flex-col justify-between">
                    <div>
                      <Link to="/shop/prodotto/$slug" params={{ slug: l.productSlug }} className="text-sm font-medium hover:underline">
                        {l.productTitle}
                      </Link>
                      <p className="mt-1 text-xs text-muted-foreground">{l.variantLabel}</p>
                      <p className="mt-2 text-sm font-medium">{fmt(l.price, l.currency)}</p>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center border border-border">
                        <button onClick={() => setQty(l.variantId, l.quantity - 1)} className="p-2 hover:bg-secondary"><Minus className="h-3 w-3" /></button>
                        <span className="w-8 text-center text-xs">{l.quantity}</span>
                        <button onClick={() => setQty(l.variantId, l.quantity + 1)} className="p-2 hover:bg-secondary"><Plus className="h-3 w-3" /></button>
                      </div>
                      <button onClick={() => remove(l.variantId)} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {lines.length > 1 && (
                <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] text-amber-700 dark:text-amber-400">
                  ℹ️ Il checkout sicuro elabora un ordine alla volta. Verrai indirizzato al primo articolo —
                  gli altri restano in carrello per il prossimo acquisto.
                </div>
              )}
            </div>

            {/* SUMMARY */}
            <aside className="sticky top-24 h-fit space-y-5 bg-secondary/40 p-6">
              <h2 className="text-xs font-medium uppercase tracking-[0.18em]">Riepilogo</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotale</span><span>{fmt(total, currency)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Spedizione</span><span>{shipping === 0 ? "Gratis" : fmt(shipping, currency)}</span></div>
                {shipping > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Aggiungi {fmt(150 - total, currency)} per la spedizione gratuita.
                  </p>
                )}
                <div className="flex justify-between border-t border-border pt-3 text-base font-medium">
                  <span>Totale</span><span>{fmt(total + shipping, currency)}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">IVA inclusa dove applicabile.</p>
              </div>
              <button
                onClick={goCheckout}
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 bg-foreground py-3.5 text-[11px] font-medium uppercase tracking-[0.18em] text-background hover:bg-foreground/90 disabled:opacity-60"
              >
                <>Procedi al checkout <ArrowRight className="h-3.5 w-3.5" /></>
              </button>
              <button onClick={() => clear()} className="w-full text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-destructive">
                Svuota carrello
              </button>
              <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                Pagamento sicuro via Shopify · Carte · PayPal · Bonifico
              </p>
            </aside>
          </div>
        )}
      </main>
      <ShopFooter />
      <CookieBanner />
    </div>
  );
}
