import { createFileRoute } from "@tanstack/react-router";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { ShopFooter } from "@/components/shop/ShopFooter";
import { CookieBanner } from "@/components/shop/CookieBanner";

export const Route = createFileRoute("/shop/resi")({
  head: () => ({ meta: [{ title: "Resi e Rimborsi — Atelier Nord" }] }),
  component: () => (
    <div className="min-h-screen">
      <ShopHeader />
      <main className="mx-auto max-w-3xl px-6 py-20">
        <h1 className="font-display text-4xl font-light">Resi e Rimborsi</h1>
        <div className="prose prose-neutral mt-8 max-w-none">
          <h2>Diritto di recesso</h2>
          <p>Ai sensi del D.Lgs. 21/2014 (recepimento Direttiva UE 2011/83), hai 14 giorni dalla consegna per esercitare il diritto di recesso senza fornire motivazione. Atelier Nord estende questo termine a 30 giorni come gesto di cortesia.</p>
          <h2>Come restituire</h2>
          <ol>
            <li>Scrivi a hello@ateliernord.eu indicando numero d'ordine e articoli da restituire</li>
            <li>Riceverai un'etichetta di reso prepagata (gratuita per UE)</li>
            <li>Imballa i capi nella loro confezione originale, con cartellini integri</li>
            <li>Affida il pacco al corriere indicato</li>
          </ol>
          <h2>Rimborso</h2>
          <p>Riceverai il rimborso sullo stesso metodo di pagamento utilizzato entro 14 giorni dalla ricezione del reso. Le spese di spedizione iniziali sono rimborsate solo per il reso completo dell'ordine.</p>
          <h2>Cambio taglia</h2>
          <p>Per cambiare taglia segui la procedura di reso e effettua un nuovo ordine. La nuova spedizione è gratuita.</p>
          <h2>Esclusioni</h2>
          <p>Non si accettano resi su capi indossati, lavati, danneggiati o privi di cartellini originali. Intimo e costumi sono esclusi per ragioni igieniche se aperti.</p>
        </div>
      </main>
      <ShopFooter />
      <CookieBanner />
    </div>
  ),
});
