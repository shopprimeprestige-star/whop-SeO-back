import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { ShopFooter } from "@/components/shop/ShopFooter";
import { CookieBanner } from "@/components/shop/CookieBanner";
import { ShopProductCard } from "@/components/shop/ShopProductCard";
import { shopListProducts } from "@/server-fn/shop.functions";

export const Route = createFileRoute("/shop/sale")({
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureQueryData({ queryKey: ["shop", "products", "sale"], queryFn: () => shopListProducts({ data: { limit: 200 } }) }),
  head: () => ({ meta: [{ title: "Sale — Atelier Nord" }, { name: "description", content: "Capi in promozione." }] }),
  component: SalePage,
});

function SalePage() {
  const all = useSuspenseQuery({ queryKey: ["shop", "products", "sale"], queryFn: () => shopListProducts({ data: { limit: 200 } }) });
  const sale = all.data.filter((p) => p.compare_at_price && Number(p.compare_at_price) > Number(p.price));
  return (
    <div className="min-h-screen">
      <ShopHeader />
      <main>
        <div className="border-b border-border bg-secondary/40">
          <div className="mx-auto max-w-7xl px-6 py-12">
            <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground">Promozioni</p>
            <h1 className="mt-3 font-display text-4xl font-light md:text-5xl">Sale</h1>
            <p className="mt-3 text-sm text-muted-foreground">{sale.length} capi in promozione.</p>
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-6 py-12">
          <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
            {sale.map((p) => <ShopProductCard key={p.id} p={p} />)}
          </div>
        </div>
      </main>
      <ShopFooter />
      <CookieBanner />
    </div>
  );
}
