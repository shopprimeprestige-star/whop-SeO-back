import { createFileRoute, Link } from "@tanstack/react-router";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { ShopFooter } from "@/components/shop/ShopFooter";
import { CookieBanner } from "@/components/shop/CookieBanner";

export const Route = createFileRoute("/shop/account")({
  head: () => ({ meta: [{ title: "Account — Atelier Nord" }] }),
  component: AccountPage,
});

function AccountPage() {
  return (
    <div className="min-h-screen">
      <ShopHeader />
      <main className="mx-auto max-w-md px-6 py-20 text-center">
        <h1 className="font-display text-3xl font-light">Il tuo account</h1>
        <p className="mt-4 text-sm text-muted-foreground">L'area clienti sarà disponibile a breve. Nel frattempo puoi acquistare come ospite — riceverai un'email con il riepilogo dell'ordine.</p>
        <Link to="/" className="mt-8 inline-block border-b border-foreground pb-1 text-[11px] font-medium uppercase tracking-[0.18em]">Torna allo shop</Link>
      </main>
      <ShopFooter />
      <CookieBanner />
    </div>
  );
}
