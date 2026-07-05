import { createFileRoute } from "@tanstack/react-router";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { ShopFooter } from "@/components/shop/ShopFooter";
import { CookieBanner } from "@/components/shop/CookieBanner";

export const Route = createFileRoute("/shop/spedizioni")({
  head: () => ({ meta: [{ title: "Spedizioni — Atelier Nord" }] }),
  component: () => (
    <div className="min-h-screen">
      <ShopHeader />
      <main className="mx-auto max-w-3xl px-6 py-20">
        <h1 className="font-display text-4xl font-light">Spedizioni</h1>
        <div className="prose prose-neutral mt-8 max-w-none">
          <p>Spediamo in tutta l'Unione Europea + Regno Unito, Svizzera e Norvegia.</p>
          <h2>Tempi e costi</h2>
          <ul>
            <li><strong>Italia:</strong> 1-3 giorni lavorativi · 5,90 € (gratis sopra 150 €)</li>
            <li><strong>UE — zona 1</strong> (FR, DE, AT, BE, NL, LU, ES): 3-5 giorni · 9,90 € (gratis sopra 150 €)</li>
            <li><strong>UE — zona 2</strong> (PT, IE, DK, SE, FI, PL, CZ, SK, HU, SI, HR, BG, RO, EE, LV, LT, GR, MT, CY): 4-7 giorni · 14,90 € (gratis sopra 200 €)</li>
            <li><strong>UK / CH / NO:</strong> 5-8 giorni · 19,90 € — eventuali dazi/IVA all'importazione a carico del destinatario</li>
          </ul>
          <h2>Tracciamento</h2>
          <p>Riceverai via email il numero di tracking entro 24h dalla spedizione. Corrieri utilizzati: BRT, DHL, GLS.</p>
          <h2>Ritardi</h2>
          <p>Eventuali ritardi sono possibili nei periodi di alta stagione (Natale, Black Friday, saldi). Per problemi di consegna scrivi a hello@ateliernord.eu indicando il numero d'ordine.</p>
        </div>
      </main>
      <ShopFooter />
      <CookieBanner />
    </div>
  ),
});
