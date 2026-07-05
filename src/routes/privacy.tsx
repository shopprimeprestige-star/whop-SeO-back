import { createFileRoute } from "@tanstack/react-router";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { ShopFooter } from "@/components/shop/ShopFooter";
import { CookieBanner } from "@/components/shop/CookieBanner";

export const Route = createFileRoute("/privacy")({
  component: Privacy,
  head: () => ({
    meta: [
      { title: "Privacy Policy — Atelier Nord" },
      { name: "description", content: "Informativa sul trattamento dei dati personali ai sensi del Regolamento UE 2016/679 (GDPR)." },
    ],
  }),
});

function Privacy() {
  return (
    <div className="min-h-screen">
      <ShopHeader />
      <main className="mx-auto max-w-3xl px-6 py-20">
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground">Informativa</p>
        <h1 className="mt-3 font-display text-4xl font-light md:text-5xl">Privacy Policy</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Ultimo aggiornamento: {new Date().toLocaleDateString("it-IT")} — Resa ai sensi degli artt. 13 e 14 del Regolamento UE 2016/679 (GDPR).
        </p>

        <div className="prose prose-neutral mt-10 max-w-none text-foreground/90">
          <h2>1. Titolare del trattamento</h2>
          <p>Titolare del trattamento è <strong>Atelier Nord</strong>, con sede legale in Europa. Per qualsiasi richiesta relativa al trattamento dei dati personali è possibile contattare il Titolare all'indirizzo <a href="mailto:privacy@ateliernord.eu">privacy@ateliernord.eu</a>.</p>

          <h2>2. Tipologie di dati raccolti</h2>
          <p>Atelier Nord raccoglie i seguenti dati personali, forniti volontariamente dall'Utente o raccolti automaticamente durante la navigazione:</p>
          <ul>
            <li><strong>Dati di registrazione e ordine</strong>: nome, cognome, indirizzo email, indirizzo di spedizione e fatturazione, numero di telefono.</li>
            <li><strong>Dati di pagamento</strong>: gestiti direttamente da provider PCI-DSS certificati (Shopify Payments, Stripe, PayPal). Atelier Nord non memorizza i dati delle carte di credito.</li>
            <li><strong>Dati di navigazione</strong>: indirizzo IP anonimizzato, tipo di browser, dispositivo, pagine visitate, durata della sessione.</li>
            <li><strong>Comunicazioni</strong>: contenuto delle email inviate al servizio clienti, iscrizione alla newsletter.</li>
          </ul>

          <h2>3. Finalità e base giuridica del trattamento</h2>
          <ul>
            <li><strong>Esecuzione del contratto (art. 6.1.b GDPR)</strong>: gestione ordini, spedizione, assistenza post-vendita, gestione dei resi.</li>
            <li><strong>Obblighi legali (art. 6.1.c GDPR)</strong>: fatturazione, conservazione documenti contabili (10 anni ex art. 2220 c.c.), antiriciclaggio.</li>
            <li><strong>Consenso (art. 6.1.a GDPR)</strong>: invio newsletter, cookie analitici e di profilazione, comunicazioni promozionali.</li>
            <li><strong>Legittimo interesse (art. 6.1.f GDPR)</strong>: prevenzione frodi, sicurezza del sito, miglioramento del servizio.</li>
          </ul>

          <h2>4. Periodo di conservazione</h2>
          <ul>
            <li>Dati ordine e fatturazione: 10 anni (obbligo civilistico).</li>
            <li>Dati account: fino alla cancellazione dell'account o 24 mesi di inattività.</li>
            <li>Dati newsletter: fino alla revoca del consenso.</li>
            <li>Log di navigazione: 12 mesi in forma aggregata e anonima.</li>
          </ul>

          <h2>5. Destinatari dei dati</h2>
          <p>I dati possono essere comunicati a:</p>
          <ul>
            <li>Corrieri e operatori logistici (DHL, GLS, BRT, Poste Italiane) per la consegna degli ordini.</li>
            <li>Provider di pagamento (Shopify Payments, Stripe, PayPal).</li>
            <li>Provider tecnologici (hosting, email transazionali) nominati Responsabili del trattamento ex art. 28 GDPR.</li>
            <li>Autorità competenti su richiesta legale.</li>
          </ul>
          <p>Atelier Nord non vende, affitta o cede a terzi i dati personali per finalità di marketing.</p>

          <h2>6. Trasferimenti extra-UE</h2>
          <p>Alcuni fornitori tecnologici possono avere sede al di fuori dello Spazio Economico Europeo. In tali casi il trasferimento avviene esclusivamente sulla base delle <strong>Standard Contractual Clauses</strong> (Decisione UE 2021/914) o di decisioni di adeguatezza della Commissione Europea.</p>

          <h2>7. Diritti dell'Interessato (artt. 15-22 GDPR)</h2>
          <p>L'Utente ha diritto di:</p>
          <ul>
            <li>Accedere ai propri dati personali e ottenerne copia.</li>
            <li>Rettificare dati inesatti o incompleti.</li>
            <li>Cancellare i dati ("diritto all'oblio") nei limiti previsti dalla legge.</li>
            <li>Limitare o opporsi al trattamento.</li>
            <li>Ricevere i dati in formato strutturato (portabilità).</li>
            <li>Revocare in qualsiasi momento il consenso prestato.</li>
            <li>Proporre reclamo all'Autorità Garante per la protezione dei dati personali (<a href="https://www.garanteprivacy.it" target="_blank" rel="noopener">www.garanteprivacy.it</a>).</li>
          </ul>
          <p>Le richieste vanno inviate a <a href="mailto:privacy@ateliernord.eu">privacy@ateliernord.eu</a> e saranno evase entro 30 giorni.</p>

          <h2>8. Sicurezza</h2>
          <p>I dati sono protetti con crittografia TLS in transito, crittografia at-rest sul database, controllo accessi basato sui ruoli e backup periodici. Il personale autorizzato è tenuto al rispetto della riservatezza.</p>

          <h2>9. Modifiche</h2>
          <p>Eventuali aggiornamenti della presente policy saranno pubblicati su questa pagina con la data di ultimo aggiornamento. Per modifiche sostanziali sarà inviata comunicazione via email agli utenti registrati.</p>
        </div>
      </main>
      <ShopFooter />
      <CookieBanner />
    </div>
  );
}
