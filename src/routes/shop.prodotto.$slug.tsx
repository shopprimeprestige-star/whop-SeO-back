import { useState } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { ShopFooter } from "@/components/shop/ShopFooter";
import { CookieBanner } from "@/components/shop/CookieBanner";
import { shopGetProduct } from "@/server-fn/shop.functions";
import { useCart } from "@/stores/cart";
import { Truck, RotateCcw, ShieldCheck, Minus, Plus, Check } from "lucide-react";
import { toast } from "sonner";

const fmt = (v: number, c: string) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: c, minimumFractionDigits: 0 }).format(v);

export const Route = createFileRoute("/shop/prodotto/$slug")({
  loader: async ({ params, context: { queryClient } }) => {
    const data = await queryClient.ensureQueryData({
      queryKey: ["shop", "product", params.slug],
      queryFn: () => shopGetProduct({ data: { slug: params.slug } }),
    });
    if (!data) throw notFound();
    return data;
  },
  head: ({ loaderData }) => {
    const p = loaderData?.product;
    const isSynced = (p as { source?: string } | undefined)?.source === "synced";
    const title = p ? `${p.title} — Atelier Nord` : "Prodotto — Atelier Nord";
    const desc = p?.description?.slice(0, 155) ?? "Capo essenziale Atelier Nord.";
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        ...(isSynced ? [{ name: "robots", content: "noindex, nofollow" }] : []),
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        ...(p?.image_url ? [{ property: "og:image", content: p.image_url }] : []),
      ],
    };
  },
  notFoundComponent: () => (
    <div className="min-h-screen">
      <ShopHeader />
      <main className="mx-auto max-w-3xl px-6 py-32 text-center">
        <h1 className="font-display text-4xl">Prodotto non trovato</h1>
        <Link to="/" className="mt-6 inline-block underline">Torna alla home</Link>
      </main>
      <ShopFooter />
    </div>
  ),
  errorComponent: ({ error }) => <div className="p-10 text-sm text-destructive">Errore: {error.message}</div>,
  component: ProductPage,
});

function ProductPage() {
  const { slug } = Route.useParams();
  const { data } = useSuspenseQuery({
    queryKey: ["shop", "product", slug],
    queryFn: () => shopGetProduct({ data: { slug } }),
  });
  const product = data!.product;
  const variants = data!.variants;

  const [variantId, setVariantId] = useState<string | null>(variants[0]?.id ?? null);
  const [qty, setQty] = useState(1);
  const [imgIdx, setImgIdx] = useState(0);
  
  const add = useCart((s) => s.add);

  const gallery = (Array.isArray(product.gallery) ? product.gallery as string[] : []);
  const images = gallery.length > 0 ? gallery : (product.image_url ? [product.image_url] : []);
  const variant = variants.find((v) => v.id === variantId) ?? variants[0];
  const price = variant?.price_override ?? Number(product.price);
  const onSale = product.compare_at_price && Number(product.compare_at_price) > price;
  const whopPlanId = (product as { whop_plan_id?: string | null }).whop_plan_id ?? null;

  const handleAdd = () => {
    if (!variant) return toast.error("Seleziona una taglia");
    add({
      productId: product.id,
      productSlug: product.slug,
      productTitle: product.title,
      variantId: variant.id,
      variantLabel: variant.label,
      price,
      currency: product.currency,
      image: images[0] ?? null,
      quantity: qty,
    });
    toast.success(`Aggiunto al carrello — ${variant.label}`);
  };


  return (
    <div className="min-h-screen">
      <ShopHeader />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <nav className="mb-6 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          <Link to="/" className="hover:text-foreground">Home</Link>
          {" / "}
          {product.shop_categories && (
            <>
              <Link to="/shop/categoria/$slug" params={{ slug: (product.shop_categories as { slug: string }).slug }} className="hover:text-foreground">
                {(product.shop_categories as { name: string }).name}
              </Link>
              {" / "}
            </>
          )}
          <span className="text-foreground">{product.title}</span>
        </nav>

        <div className="grid gap-10 lg:grid-cols-2">
          {/* GALLERY */}
          <div>
            <div className="aspect-[3/4] overflow-hidden bg-muted">
              {images[imgIdx] && (
                <img src={images[imgIdx]} alt={product.title} className="h-full w-full object-cover" />
              )}
            </div>
            {images.length > 1 && (
              <div className="mt-3 grid grid-cols-4 gap-2">
                {images.map((src, i) => (
                  <button
                    key={i}
                    onClick={() => setImgIdx(i)}
                    className={`aspect-square overflow-hidden bg-muted ring-1 ${imgIdx === i ? "ring-foreground" : "ring-transparent"}`}
                  >
                    <img src={src} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* INFO */}
          <div className="space-y-6 lg:pl-8">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-muted-foreground">{product.brand}</p>
              <h1 className="mt-2 font-display text-3xl font-light md:text-4xl">{product.title}</h1>
            </div>

            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-medium text-foreground">{fmt(price, product.currency)}</span>
              {onSale && (
                <span className="text-base text-muted-foreground line-through">
                  {fmt(Number(product.compare_at_price), product.currency)}
                </span>
              )}
            </div>

            {(product as { material?: string | null }).material && (
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Composizione: <span className="text-foreground normal-case tracking-normal">{(product as { material?: string | null }).material}</span>
              </p>
            )}

            {/* VARIANTI */}
            {variants.length > 0 && (
              <div>
                <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-foreground">
                  {variants[0]?.size ? "Taglia" : "Variante"}
                </p>
                <div className="flex flex-wrap gap-2">
                  {variants.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => setVariantId(v.id)}
                      disabled={(v.stock ?? 0) <= 0}
                      className={`min-w-[3rem] border px-4 py-2.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-30 disabled:line-through ${
                        variantId === v.id
                          ? "border-foreground bg-foreground text-background"
                          : "border-border bg-background text-foreground hover:border-foreground"
                      }`}
                    >
                      {v.size ?? v.label}
                    </button>
                  ))}
                </div>
                {variant && (variant.stock ?? 0) <= 5 && (variant.stock ?? 0) > 0 && (
                  <p className="mt-2 text-[11px] text-accent">Ultimi {variant.stock} disponibili</p>
                )}
              </div>
            )}

            {/* QTY + ADD TO CART */}
            <div className="flex gap-3">
              <div className="flex items-center border border-border">
                <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="p-3 text-foreground hover:bg-secondary">
                  <Minus className="h-3 w-3" />
                </button>
                <span className="w-10 text-center text-sm">{qty}</span>
                <button onClick={() => setQty((q) => Math.min(10, q + 1))} className="p-3 text-foreground hover:bg-secondary">
                  <Plus className="h-3 w-3" />
                </button>
              </div>
              <button
                onClick={handleAdd}
                className="flex-1 bg-foreground py-3.5 text-[11px] font-medium uppercase tracking-[0.18em] text-background hover:bg-foreground/90"
              >
                Aggiungi al carrello
              </button>
            </div>

            {/* WHOP CHECKOUT — pagina nativa con form Whop embeddato */}
            {whopPlanId && (
              <Link
                to="/shop/checkout/whop"
                search={{ plan: whopPlanId }}
                className="block w-full text-center border border-foreground bg-background py-3.5 text-[11px] font-medium uppercase tracking-[0.18em] text-foreground hover:bg-foreground hover:text-background transition"
              >
                Acquista subito — Checkout sicuro
              </Link>
            )}

            {/* DESCRIZIONE */}
            {product.description && (
              <div className="border-t border-border pt-6">
                <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{product.description}</p>
              </div>
            )}

            {/* ICONE SERVIZI */}
            <div className="grid gap-3 border-t border-border pt-6 text-xs text-muted-foreground">
              <div className="flex items-center gap-3">
                <Truck className="h-4 w-4 text-foreground" />
                <span>Spedizione gratuita in tutta Europa sopra 150€ (3-5 giorni lavorativi)</span>
              </div>
              <div className="flex items-center gap-3">
                <RotateCcw className="h-4 w-4 text-foreground" />
                <span>Resi gratuiti entro 30 giorni — cambio taglia o rimborso</span>
              </div>
              <div className="flex items-center gap-3">
                <ShieldCheck className="h-4 w-4 text-foreground" />
                <span>Pagamenti sicuri SSL — Visa, Mastercard, PayPal, bonifico</span>
              </div>
              <div className="flex items-center gap-3">
                <Check className="h-4 w-4 text-foreground" />
                <span>Made in Europe — atelier certificati</span>
              </div>
            </div>
          </div>
        </div>
      </main>
      <ShopFooter />
      <CookieBanner />

    </div>
  );
}
