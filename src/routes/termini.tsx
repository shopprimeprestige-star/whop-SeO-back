import { createFileRoute } from "@tanstack/react-router";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { ShopFooter } from "@/components/shop/ShopFooter";
import { CookieBanner } from "@/components/shop/CookieBanner";

export const Route = createFileRoute("/termini")({
  component: Termini,
  head: () => ({
    meta: [
      { title: "Termini e Condizioni — Atelier Nord" },
      { name: "description", content: "Termini e condizioni di vendita di Atelier Nord. Diritto di recesso, garanzia, foro competente." },
    ],
  }),
});

function Termini() {
  return (
    <div className="min-h-screen">
      <ShopHeader />
      <main className="mx-auto max-w-3xl px-6 py-20">
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground">Documento contrattuale</p>
        <h1 className="mt-3 font-display text-4xl font-light md:text-5xl">Termini e Condizioni</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Ultimo aggiornamento: {new Date().toLocaleDateString("it-IT")}
        </p>

        <div className="prose prose-neutral mt-10 max-w-none text-foreground/90">
          <h2>1. Premessa</h2>
          <p>I presenti Termini disciplinano la vendita a distanza di articoli di abbigliamento e accessori tramite il sito <strong>ateliernord.eu</strong>, gestito da Atelier Nord. L'inoltro dell'ordine costituisce accettazione integrale dei presenti Termini.</p>

          <h2>2. Venditore e mercato</h2>
          <p>Le vendite sono effettuate da Atelier Nord verso consumatori e professionisti residenti in tutti i Paesi dello Spazio Economico Europeo (UE 27 + Islanda, Liechtenstein, Norvegia) e nel Regno Unito.</p>

          <h2>3. Prodotti e disponibilità</h2>
          <p>Le immagini e descrizioni dei prodotti hanno carattere indicativo. Eventuali lievi differenze cromatiche sono dovute alla resa del display. La disponibilità è aggiornata in tempo reale; in caso di indisponibilità sopravvenuta sarà offerto rimborso integrale o sostituzione.</p>

          <h2>4. Prezzi e fatturazione</h2>
          <p>I prezzi sono espressi in Euro e includono l'IVA secondo l'aliquota del Paese di destinazione (regime OSS UE). Atelier Nord emette fattura elettronica o ricevuta commerciale conforme alla normativa fiscale italiana ed europea.</p>

          <h2>5. Pagamento</h2>
          <p>Sono accettati i seguenti metodi: carte di credito/debito (Visa, Mastercard, American Express), PayPal, Apple Pay, Google Pay, bonifico bancario SEPA. I pagamenti sono processati tramite gateway PCI-DSS certificati. Atelier Nord non memorizza i dati delle carte.</p>

          <h2>6. Spedizione e consegna</h2>
          <p>La consegna avviene tramite corriere espresso entro 3-7 giorni lavorativi nell'UE. La spedizione è gratuita per ordini superiori a 150€. I rischi di perdita o danneggiamento si trasferiscono al consumatore al momento della consegna materiale (art. 63 Cod. Consumo).</p>

          <h2>7. Diritto di recesso (D.Lgs. 21/2014)</h2>
          <p>Il consumatore ha diritto di recedere senza fornire alcuna motivazione entro <strong>14 giorni</strong> dalla consegna. Atelier Nord estende tale termine a <strong>30 giorni</strong> come gesto commerciale. Per esercitare il recesso scrivere a hello@ateliernord.eu indicando numero d'ordine. Il rimborso integrale (incluse spese di spedizione standard) sarà effettuato entro 14 giorni dalla ricezione del reso.</p>
          <p>Sono esclusi dal recesso, ai sensi dell'art. 59 D.Lgs. 206/2005, i prodotti sigillati per ragioni igieniche (intimo, costumi) una volta aperti.</p>

          <h2>8. Garanzia legale di conformità</h2>
          <p>Tutti i prodotti godono della garanzia legale di conformità di <strong>24 mesi</strong> ai sensi del D.Lgs. 170/2021 (recepimento Direttiva UE 2019/771). In caso di difetto di conformità il consumatore ha diritto al ripristino della conformità tramite riparazione o sostituzione, o in subordine alla riduzione del prezzo o alla risoluzione del contratto.</p>

          <h2>9. Reclami e risoluzione delle controversie</h2>
          <p>I reclami vanno indirizzati a hello@ateliernord.eu. In caso di controversia non risolta il consumatore può ricorrere alla piattaforma ODR della Commissione Europea: <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener">ec.europa.eu/consumers/odr</a>.</p>

          <h2>10. Legge applicabile e foro competente</h2>
          <p>Il contratto è regolato dalla legge italiana. Per i consumatori è competente il foro del luogo di residenza o domicilio elettivo, salva diversa scelta. Per i professionisti è competente in via esclusiva il foro di Milano.</p>

          <h2>11. Proprietà intellettuale</h2>
          <p>Tutti i contenuti del sito (testi, immagini, marchi, logo) sono di proprietà esclusiva di Atelier Nord o dei rispettivi titolari e protetti dalla normativa sul diritto d'autore.</p>
        </div>
      </main>
      <ShopFooter />
      <CookieBanner />
    </div>
  );
}
