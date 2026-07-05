import { Link, useNavigate } from "@tanstack/react-router";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useCart, cartTotal, lineUnitPrice } from "@/stores/cart";
import { Trash2, Minus, Plus, ArrowRight, ShoppingBag } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { shopCreateCheckout } from "@/server-fn/shop.functions";
import { useState } from "react";
import { toast } from "sonner";
import { getDiscountForQty } from "@/lib/quantity-breaks";

const fmt = (v: number, c: string) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: c, minimumFractionDigits: 0 }).format(v);

export function CartDrawer() {
  const isOpen = useCart((s) => s.isOpen);
  const setOpen = useCart((s) => s.setOpen);
  const close = useCart((s) => s.close);
  const lines = useCart((s) => s.lines);
  const setQty = useCart((s) => s.setQty);
  const remove = useCart((s) => s.remove);
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
      const sessionId = (typeof window !== "undefined" && localStorage.getItem("atelier-session")) || crypto.randomUUID();
      if (typeof window !== "undefined") localStorage.setItem("atelier-session", sessionId);
      const res = await checkout({
        data: {
          items: lines.map((l) => ({ productSlug: l.productSlug, variantId: l.variantId, quantity: l.quantity })),
          sessionId,
        },
      });
      if (!res.ok) {
        toast.error(("message" in res && res.message) || "Checkout non disponibile");
        return;
      }
      close();
      if ("whop" in res && res.whop) {
        navigate({ to: res.redirect_url as "/shop/checkout/whop", search: { plan: res.plan_id } } as never);
      } else if (res.demo) {
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
    <Sheet open={isOpen} onOpenChange={setOpen}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border px-6 py-5">
          <SheetTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-[0.18em]">
            <ShoppingBag className="h-4 w-4" /> Carrello ({lines.length})
          </SheetTitle>
        </SheetHeader>

        {lines.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
            <ShoppingBag className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Il tuo carrello è vuoto.</p>
            <button onClick={close} className="border-b border-foreground pb-1 text-[11px] font-medium uppercase tracking-[0.18em]">
              Continua lo shopping
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <ul className="divide-y divide-border">
                {lines.map((l) => {
                  const unit = lineUnitPrice(l);
                  const discounted = unit < l.price;
                  return (
                    <li key={l.variantId} className="flex gap-3 py-4">
                      <Link to="/shop/prodotto/$slug" params={{ slug: l.productSlug }} onClick={close} className="block h-24 w-20 shrink-0 overflow-hidden bg-muted">
                        {l.image && <img src={l.image} alt={l.productTitle} className="h-full w-full object-cover" />}
                      </Link>
                      <div className="flex flex-1 flex-col justify-between">
                        <div>
                          <Link to="/shop/prodotto/$slug" params={{ slug: l.productSlug }} onClick={close} className="text-sm font-medium leading-tight hover:underline">
                            {l.productTitle}
                          </Link>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">{l.variantLabel}</p>
                          <div className="mt-1 flex items-baseline gap-2">
                            <span className="text-sm font-medium">{fmt(unit, l.currency)}</span>
                            {discounted && (
                              <span className="text-[11px] text-muted-foreground line-through">{fmt(l.price, l.currency)}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center border border-border">
                            <button onClick={() => setQty(l.variantId, l.quantity - 1)} className="p-1.5 hover:bg-secondary"><Minus className="h-3 w-3" /></button>
                            <span className="w-7 text-center text-xs">{l.quantity}</span>
                            <button onClick={() => setQty(l.variantId, l.quantity + 1)} className="p-1.5 hover:bg-secondary"><Plus className="h-3 w-3" /></button>
                          </div>
                          <button onClick={() => remove(l.variantId)} className="text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {(() => {
                const totQty = lines.reduce((s, l) => s + l.quantity, 0);
                const b = getDiscountForQty(totQty);
                if (b.discountPct === 0 && totQty < 2) {
                  return (
                    <p className="mt-4 rounded border border-dashed border-border bg-secondary/30 p-3 text-[11px] text-muted-foreground">
                      Aggiungi un secondo articolo per ottenere <strong className="text-foreground">-5%</strong> su tutto il carrello.
                    </p>
                  );
                }
                if (b.discountPct > 0) {
                  return (
                    <p className="mt-4 rounded border border-emerald-500/40 bg-emerald-500/10 p-3 text-[11px] text-emerald-700 dark:text-emerald-400">
                      ✓ Sconto attivo: <strong>{b.label}</strong>
                    </p>
                  );
                }
                return null;
              })()}

              {lines.length > 1 && (
                <p className="mt-4 rounded border border-emerald-500/40 bg-emerald-500/10 p-3 text-[11px] text-emerald-700 dark:text-emerald-400">
                  ✓ Tutti gli articoli verranno uniti in un unico ordine sicuro.
                </p>
              )}
            </div>

            <div className="border-t border-border bg-secondary/40 px-6 py-5">
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotale</span><span>{fmt(total, currency)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Spedizione</span><span>{shipping === 0 ? "Gratis" : fmt(shipping, currency)}</span></div>
                {shipping > 0 && (
                  <p className="text-[11px] text-muted-foreground">Aggiungi {fmt(150 - total, currency)} per la spedizione gratuita.</p>
                )}
                <div className="flex justify-between border-t border-border pt-2 text-base font-medium">
                  <span>Totale</span><span>{fmt(total + shipping, currency)}</span>
                </div>
              </div>
              <button
                onClick={goCheckout}
                disabled={loading}
                className="mt-4 flex w-full items-center justify-center gap-2 bg-foreground py-3 text-[11px] font-medium uppercase tracking-[0.18em] text-background hover:bg-foreground/90 disabled:opacity-60"
              >
                <>Checkout sicuro <ArrowRight className="h-3.5 w-3.5" /></>
              </button>
              <Link to="/shop/carrello" onClick={close} className="mt-2 block text-center text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground">
                Vedi carrello completo
              </Link>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
