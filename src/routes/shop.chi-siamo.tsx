import { createFileRoute } from "@tanstack/react-router";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { ShopFooter } from "@/components/shop/ShopFooter";
import { CookieBanner } from "@/components/shop/CookieBanner";

export const Route = createFileRoute("/shop/chi-siamo")({
  head: () => ({ meta: [{ title: "Chi siamo — Atelier Nord" }, { name: "description", content: "Atelier Nord: capi essenziali realizzati in Europa." }] }),
  component: () => (
    <div className="min-h-screen">
      <ShopHeader />
      <main className="mx-auto max-w-3xl px-6 py-20">
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground">La nostra storia</p>
        <h1 className="mt-3 font-display text-4xl font-light md:text-5xl">Atelier Nord</h1>
        <div className="prose prose-neutral mt-10 max-w-none text-foreground/90">
          <p>Atelier Nord nasce dall'incontro di artigiani europei che condividono un'idea precisa di moda: meno, ma meglio. Le nostre collezioni sono composte da pochi capi essenziali, pensati per durare nel tempo, indipendenti dalle stagioni e dalle mode.</p>
          <h2>I nostri valori</h2>
          <p>Lavoriamo con piccoli laboratori in Italia, Portogallo e Francia. Selezioniamo tessuti naturali certificati GOTS e OEKO-TEX, garantendo trasparenza sull'intera filiera produttiva.</p>
          <h2>Produzione responsabile</h2>
          <p>Produciamo in piccole serie per evitare sprechi. Ogni capo è realizzato a mano o con macchinari sartoriali, mai in catene di montaggio industriali. I nostri partner garantiscono salari equi e condizioni di lavoro dignitose.</p>
          <h2>Il nome</h2>
          <p>Nord come riferimento all'estetica essenziale del design nordico, alla pulizia delle linee, all'attenzione per il dettaglio. Atelier come omaggio al lavoro manuale, alla bottega artigiana, al tempo dedicato a ogni capo.</p>
        </div>
      </main>
      <ShopFooter />
      <CookieBanner />
    </div>
  ),
});
