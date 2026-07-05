import { createFileRoute } from "@tanstack/react-router";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { ShopFooter } from "@/components/shop/ShopFooter";
import { CookieBanner } from "@/components/shop/CookieBanner";

export const Route = createFileRoute("/cookie")({
  component: CookiePage,
  head: () => ({
    meta: [
      { title: "Cookie Policy — Atelier Nord" },
      { name: "description", content: "Informativa sui cookie utilizzati dal sito Atelier Nord ai sensi del Provvedimento Garante 10 giugno 2021." },
    ],
  }),
});

function CookiePage() {
  return (
    <div className="min-h-screen">
      <ShopHeader />
      <main className="mx-auto max-w-3xl px-6 py-20">
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground">Informativa</p>
        <h1 className="mt-3 font-display text-4xl font-light md:text-5xl">Cookie Policy</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Ai sensi del Provvedimento del Garante Privacy del 10 giugno 2021 e delle Linee guida EDPB 03/2022.
        </p>

        <div className="prose prose-neutral mt-10 max-w-none text-foreground/90">
          <h2>1. Cosa sono i cookie</h2>
          <p>I cookie sono piccoli file di testo che i siti visitati salvano sul terminale dell'Utente per memorizzare informazioni (preferenze di navigazione, contenuto del carrello, sessione di login) o raccogliere dati statistici.</p>

          <h2>2. Tipologie di cookie utilizzati</h2>

          <h3>Cookie tecnici (necessari)</h3>
          <p>Indispensabili per il funzionamento del sito. Non richiedono consenso ai sensi dell'art. 122 D.Lgs. 196/2003.</p>
          <ul>
            <li><code>atelier-nord-cart</code> — contenuto del carrello (durata: sessione + 30 giorni).</li>
            <li><code>atelier-nord-cookie</code> — memorizza la scelta sui cookie (durata: 6 mesi).</li>
            <li>Cookie di sessione di Shopify per il checkout (durata: sessione).</li>
          </ul>

          <h3>Cookie analitici aggregati</h3>
          <p>Utilizzati per misurare in forma anonima e aggregata l'uso del sito. IP anonimizzato, nessuna profilazione individuale. Equiparati ai tecnici dal Garante Privacy.</p>

          <h3>Cookie di profilazione e marketing</h3>
          <p>Attualmente <strong>non utilizziamo</strong> cookie di profilazione di terze parti né pixel pubblicitari (Meta, Google Ads, TikTok). Qualora in futuro venissero introdotti, l'Utente sarà preventivamente informato e richiesto il consenso esplicito.</p>

          <h2>3. Come gestire le preferenze</h2>
          <p>Al primo accesso al sito viene mostrato un banner che consente di accettare tutti i cookie o di selezionare solo i tecnici. La scelta può essere modificata in qualsiasi momento cancellando i cookie dal browser.</p>

          <h2>4. Disabilitare i cookie dal browser</h2>
          <ul>
            <li><a href="https://support.google.com/chrome/answer/95647" target="_blank" rel="noopener">Google Chrome</a></li>
            <li><a href="https://support.mozilla.org/it/kb/Gestione%20dei%20cookie" target="_blank" rel="noopener">Mozilla Firefox</a></li>
            <li><a href="https://support.apple.com/it-it/guide/safari/sfri11471/mac" target="_blank" rel="noopener">Safari</a></li>
            <li><a href="https://support.microsoft.com/it-it/microsoft-edge" target="_blank" rel="noopener">Microsoft Edge</a></li>
          </ul>
          <p>La disabilitazione dei cookie tecnici può compromettere il corretto funzionamento del sito (carrello, checkout, login).</p>

          <h2>5. Trasferimenti extra-UE</h2>
          <p>I dati raccolti tramite cookie restano all'interno dello Spazio Economico Europeo. Eventuali trasferimenti extra-UE da parte di provider tecnologici avvengono esclusivamente sulla base di Standard Contractual Clauses (Decisione UE 2021/914).</p>

          <h2>6. Diritti dell'Interessato</h2>
          <p>L'Utente può esercitare in qualsiasi momento i diritti previsti dagli artt. 15-22 GDPR scrivendo a <a href="mailto:privacy@ateliernord.eu">privacy@ateliernord.eu</a>. Per maggiori dettagli consulta la <a href="/privacy">Privacy Policy</a>.</p>
        </div>
      </main>
      <ShopFooter />
      <CookieBanner />
    </div>
  );
}
