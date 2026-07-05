import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { ShopFooter } from "@/components/shop/ShopFooter";
import { CookieBanner } from "@/components/shop/CookieBanner";
import { ShopProductCard } from "@/components/shop/ShopProductCard";
import { shopListCategories, shopListProducts } from "@/server-fn/shop.functions";

export const Route = createFileRoute("/shop/categoria/$slug")({
  loader: async ({ params, context: { queryClient } }) => {
    const cats = await queryClient.ensureQueryData({ queryKey: ["shop", "categories"], queryFn: () => shopListCategories() });
    const cat = cats.find((c) => c.slug === params.slug);
    if (!cat) throw notFound();
    await queryClient.ensureQueryData({
      queryKey: ["shop", "products", "cat", params.slug],
      queryFn: () => shopListProducts({ data: { categorySlug: params.slug, limit: 100 } }),
    });
    return { category: cat };
  },
  head: ({ loaderData }) => {
    const c = loaderData?.category;
    const title = c ? `${c.name} — Atelier Nord` : "Categoria — Atelier Nord";
    return {
      meta: [
        { title },
        { name: "description", content: c?.description ?? `Scopri la nostra selezione di ${c?.name?.toLowerCase() ?? "prodotti"}.` },
        { property: "og:title", content: title },
        { property: "og:description", content: c?.description ?? `Scopri la nostra selezione di ${c?.name?.toLowerCase() ?? "prodotti"}.` },
        ...(c?.image_url ? [{ property: "og:image", content: c.image_url }] : []),
      ],
    };
  },
  notFoundComponent: () => (
    <div className="min-h-screen">
      <ShopHeader />
      <main className="mx-auto max-w-3xl px-6 py-32 text-center">
        <h1 className="font-display text-4xl">Categoria non trovata</h1>
        <Link to="/" className="mt-6 inline-block underline">Torna alla home</Link>
      </main>
      <ShopFooter />
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="p-10 text-sm text-destructive">Errore: {error.message}</div>
  ),
  component: CategoryPage,
});

function CategoryPage() {
  const { slug } = Route.useParams();
  const { category } = Route.useLoaderData();
  const products = useSuspenseQuery({
    queryKey: ["shop", "products", "cat", slug],
    queryFn: () => shopListProducts({ data: { categorySlug: slug, limit: 100 } }),
  });

  return (
    <div className="min-h-screen">
      <ShopHeader />
      <main>
        <div className="border-b border-border bg-secondary/40">
          <div className="mx-auto max-w-7xl px-6 py-12 md:py-16">
            <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground">Collezione</p>
            <h1 className="mt-3 font-display text-4xl font-light md:text-5xl">{category.name}</h1>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
              {products.data.length} capi selezionati. Spedizione gratuita sopra i 150€ in tutta Europa.
            </p>
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-6 py-12">
          {products.data.length === 0 ? (
            <p className="py-20 text-center text-sm text-muted-foreground">Nessun prodotto in questa categoria.</p>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
              {products.data.map((p) => (
                <ShopProductCard key={p.id} p={p} />
              ))}
            </div>
          )}
        </div>
      </main>
      <ShopFooter />
      <CookieBanner />
    </div>
  );
}
