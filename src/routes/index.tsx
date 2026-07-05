import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { ShopFooter } from "@/components/shop/ShopFooter";
import { CookieBanner } from "@/components/shop/CookieBanner";
import { ShopProductCard } from "@/components/shop/ShopProductCard";
import { shopListCategories, shopListProducts } from "@/server-fn/shop.functions";

export const Route = createFileRoute("/")({
  loader: async ({ context: { queryClient } }) => {
    await Promise.all([
      queryClient.ensureQueryData({ queryKey: ["shop", "categories"], queryFn: () => shopListCategories() }),
      queryClient.ensureQueryData({ queryKey: ["shop", "products", "featured"], queryFn: () => shopListProducts({ data: { featured: true, limit: 8 } }) }),
      queryClient.ensureQueryData({ queryKey: ["shop", "products", "new"], queryFn: () => shopListProducts({ data: { limit: 12 } }) }),
    ]);
  },
  head: () => ({
    meta: [
      { title: "Atelier Nord — Capi essenziali Made in Europe" },
      { name: "description", content: "Collezione di capi essenziali realizzati in Europa con materiali nobili. Spedizione gratuita in tutta Europa sopra 150€." },
      { property: "og:title", content: "Atelier Nord — Capi essenziali Made in Europe" },
      { property: "og:description", content: "Collezione essenziale, libera dalle stagioni." },
      { property: "og:image", content: "https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=1600&q=80" },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const categories = useSuspenseQuery({ queryKey: ["shop", "categories"], queryFn: () => shopListCategories() });
  const featured = useSuspenseQuery({ queryKey: ["shop", "products", "featured"], queryFn: () => shopListProducts({ data: { featured: true, limit: 8 } }) });
  const newest = useSuspenseQuery({ queryKey: ["shop", "products", "new"], queryFn: () => shopListProducts({ data: { limit: 12 } }) });

  return (
    <div className="min-h-screen">
      <ShopHeader />
      <section className="relative h-[78vh] min-h-[520px] overflow-hidden bg-secondary">
        <img src="https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=2400&q=80" alt="Atelier Nord SS25" className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-foreground/40 to-transparent" />
        <div className="absolute inset-0 flex items-end">
          <div className="mx-auto w-full max-w-7xl px-6 pb-16 text-background">
            <p className="text-[11px] font-medium uppercase tracking-[0.25em]">Collezione SS25</p>
            <h1 className="mt-4 max-w-2xl font-display text-5xl font-light leading-[1.05] md:text-7xl">L'eleganza<br />del necessario.</h1>
            <p className="mt-6 max-w-md text-sm text-background/85">Tessuti naturali, tagli essenziali, sartoria europea.</p>
            <Link to="/shop/categoria/$slug" params={{ slug: "donna-abiti" }} className="mt-8 inline-block bg-background px-8 py-3.5 text-[11px] font-medium uppercase tracking-[0.18em] text-foreground hover:bg-accent hover:text-accent-foreground">
              Scopri la collezione
            </Link>
          </div>
        </div>
      </section>

      <section className="border-b border-border bg-background">
        <div className="mx-auto grid max-w-7xl gap-6 px-6 py-10 text-center md:grid-cols-4">
          {[{t:"Made in Europe",s:"Atelier in Italia, Portogallo, Francia"},{t:"Spedizione gratuita",s:"Sopra i 150€ in tutta Europa"},{t:"Resi 30 giorni",s:"Cambio taglia o rimborso"},{t:"Pagamenti sicuri",s:"Carte, PayPal, bonifico"}].map((v) => (
            <div key={v.t}><p className="text-xs font-medium uppercase tracking-[0.18em]">{v.t}</p><p className="mt-1.5 text-xs text-muted-foreground">{v.s}</p></div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20">
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground">Esplora</p>
        <h2 className="mt-2 font-display text-3xl font-light md:text-4xl">Le nostre categorie</h2>
        <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-4">
          {categories.data.slice(0, 8).map((c) => (
            <Link key={c.id} to="/shop/categoria/$slug" params={{ slug: c.slug }} className="group relative aspect-[3/4] overflow-hidden bg-muted">
              {c.image_url && <img src={c.image_url} alt={c.name} loading="lazy" className="h-full w-full object-cover transition duration-700 group-hover:scale-105" />}
              <div className="absolute inset-0 flex items-end bg-gradient-to-t from-foreground/60 to-transparent p-5">
                <span className="text-sm font-medium uppercase tracking-[0.18em] text-background">{c.name}</span>
              </div>
            </Link>
          ))}
          {categories.data.length === 0 && <EmptyGridMessage>Collega il database prodotti per mostrare le categorie.</EmptyGridMessage>}
        </div>
      </section>

      <section className="bg-secondary/40 py-20">
        <div className="mx-auto max-w-7xl px-6">
          <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground">Selezione</p>
          <h2 className="mt-2 font-display text-3xl font-light md:text-4xl">I nostri preferiti</h2>
          <div className="mt-10 grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-4">
            {featured.data.map((p) => <ShopProductCard key={p.id} p={p} />)}
            {featured.data.length === 0 && <EmptyGridMessage>Collega il database prodotti per mostrare la selezione.</EmptyGridMessage>}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20">
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground">Just in</p>
        <h2 className="mt-2 font-display text-3xl font-light md:text-4xl">Nuovi arrivi</h2>
        <div className="mt-10 grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-4 lg:grid-cols-6">
          {newest.data.slice(0, 12).map((p) => <ShopProductCard key={p.id} p={p} />)}
            {newest.data.length === 0 && <EmptyGridMessage>Collega il database prodotti per mostrare i nuovi arrivi.</EmptyGridMessage>}
        </div>
      </section>

      <section className="border-t border-border bg-background py-24">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground">Manifesto</p>
          <h2 className="mt-4 font-display text-4xl font-light md:text-5xl">Crediamo nella bellezza che dura.</h2>
          <p className="mt-6 text-sm leading-relaxed text-muted-foreground md:text-base">
            Ogni capo Atelier Nord nasce da una scelta deliberata: meno collezioni, più qualità. Lavoriamo con piccoli laboratori europei che condividono i nostri valori — tessuti certificati, condizioni di lavoro etiche, produzione su misura per evitare sprechi.
          </p>
          <Link to="/shop/chi-siamo" className="mt-10 inline-block border-b border-foreground pb-1 text-[11px] font-medium uppercase tracking-[0.18em] hover:text-accent hover:border-accent">Scopri di più</Link>
        </div>
      </section>

      <ShopFooter />
      <CookieBanner />
    </div>
  );
}

function EmptyGridMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="col-span-full border border-dashed border-border bg-background px-6 py-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
