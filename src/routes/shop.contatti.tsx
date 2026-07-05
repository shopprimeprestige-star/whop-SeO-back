import { createFileRoute } from "@tanstack/react-router";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { ShopFooter } from "@/components/shop/ShopFooter";
import { CookieBanner } from "@/components/shop/CookieBanner";

export const Route = createFileRoute("/shop/contatti")({
  head: () => ({ meta: [{ title: "Contatti — Atelier Nord" }] }),
  component: () => (
    <div className="min-h-screen">
      <ShopHeader />
      <main className="mx-auto max-w-3xl px-6 py-20">
        <h1 className="font-display text-4xl font-light">Contatti</h1>
        <div className="prose prose-neutral mt-8 max-w-none">
          <p>Servizio clienti: <a href="mailto:hello@ateliernord.eu">hello@ateliernord.eu</a></p>
          <p>Risposta entro 24h nei giorni lavorativi (lun-ven 9:00-18:00 CET).</p>
          <p>Per ordini, spedizioni e resi indica sempre il numero d'ordine ricevuto via email.</p>
          <h2>Sede legale</h2>
          <p>Atelier Nord SRL · Via dell'Artigianato 12 · 20121 Milano (MI) · Italia<br />P.IVA IT00000000000</p>
        </div>
      </main>
      <ShopFooter />
      <CookieBanner />
    </div>
  ),
});
