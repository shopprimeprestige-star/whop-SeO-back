import { createFileRoute } from "@tanstack/react-router";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { ShopFooter } from "@/components/shop/ShopFooter";
import { CookieBanner } from "@/components/shop/CookieBanner";

const FAQ = [
  ["Spedite anche fuori dall'UE?", "Sì, in UK, Svizzera e Norvegia. Eventuali dazi all'importazione sono a carico del destinatario."],
  ["Posso modificare un ordine già confermato?", "Scrivi subito a hello@ateliernord.eu. Se l'ordine non è ancora stato spedito proviamo a modificarlo."],
  ["Quanto durano i rimborsi?", "Massimo 14 giorni dalla ricezione del reso, in genere entro 5 giorni lavorativi."],
  ["I tessuti sono certificati?", "Sì: GOTS per il cotone organico, OEKO-TEX Standard 100 per assenza di sostanze nocive."],
  ["Ci sono guide alle taglie?", "Ogni scheda prodotto include la tabella taglie specifica. In caso di dubbio scrivici prima di ordinare."],
];

export const Route = createFileRoute("/shop/faq")({
  head: () => ({ meta: [{ title: "FAQ — Atelier Nord" }] }),
  component: () => (
    <div className="min-h-screen">
      <ShopHeader />
      <main className="mx-auto max-w-3xl px-6 py-20">
        <h1 className="font-display text-4xl font-light">Domande frequenti</h1>
        <div className="mt-10 divide-y divide-border border-y border-border">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group py-5">
              <summary className="cursor-pointer list-none text-sm font-medium">{q}</summary>
              <p className="mt-3 text-sm text-muted-foreground">{a}</p>
            </details>
          ))}
        </div>
      </main>
      <ShopFooter />
      <CookieBanner />
    </div>
  ),
});
