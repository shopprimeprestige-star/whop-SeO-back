import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Check, Copy, AlertTriangle, Info, ExternalLink, Lock, Globe } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/deploy-guide")({
  component: DeployGuide,
  head: () => ({
    meta: [
      { title: "Guida Deploy Cloudflare Workers" },
      { name: "description", content: "Guida passo-passo per configurare le variabili d'ambiente su Cloudflare Workers." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

type Row = {
  name: string;
  value: string;
  note?: string;
  sensitive?: boolean;
};

const PLAINTEXT_VARS: Row[] = [
  { name: "VITE_SUPABASE_URL", value: "https://<tuo-project-ref>.supabase.co", note: "Deve essere il Project URL del Supabase esterno; serve al login nel browser." },
  {
    name: "VITE_SUPABASE_PUBLISHABLE_KEY",
    value: "<anon/public key del Supabase esterno>",
    note: "Deve essere la stessa anon key usata dal server come SUPABASE_PUBLISHABLE_KEY.",
  },
  { name: "VITE_SUPABASE_PROJECT_ID", value: "<tuo-project-ref>", note: "Solo se il tuo deploy lo richiede; non è una chiave segreta." },
  {
    name: "PUBLIC_APP_URL",
    value: "https://<nome-worker>.workers.dev",
    note: "Sostituisci con l'URL definitivo del tuo Worker",
  },
];

const SECRET_VARS: Row[] = [
  { name: "SUPABASE_URL", value: "https://<tuo-project-ref>.supabase.co" },
  {
    name: "SUPABASE_PUBLISHABLE_KEY",
    value: "<anon/public key del Supabase esterno>",
  },
  {
    name: "BRIDGE_REDIRECT_SECRET",
    value: "<genera con: openssl rand -hex 32>",
    sensitive: true,
    note: "Non presente nei secret Lovable: generane uno nuovo se non lo hai già altrove.",
  },
  {
    name: "PONTE_ADMIN_PASSWORD",
    value: "<scegli una password forte (20+ caratteri)>",
    sensitive: true,
    note: "Userai questa per accedere a /ponte-admin/login",
  },
  {
    name: "BRIDGE_ADMIN_PASSWORD",
    value: "<scegli una password forte (20+ caratteri)>",
    sensitive: true,
    note: "Userai questa per accedere a /bridge-admin/login",
  },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1 px-2 text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          toast.success("Copiato");
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Impossibile copiare");
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copiato" : "Copia"}
    </Button>
  );
}

function VarTable({ rows, kind }: { rows: Row[]; kind: "plaintext" | "secret" }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Nome variabile</th>
            <th className="px-3 py-2 text-left font-medium">Valore</th>
            <th className="px-3 py-2 text-right font-medium">Azione</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.name} className="align-top">
              <td className="px-3 py-3">
                <code className="font-mono text-xs font-semibold">{row.name}</code>
                {row.sensitive && (
                  <Badge variant="outline" className="ml-2 gap-1 text-[10px]">
                    <Lock className="h-3 w-3" /> sensibile
                  </Badge>
                )}
                {row.note && (
                  <p className="mt-1 text-xs text-muted-foreground">{row.note}</p>
                )}
              </td>
              <td className="px-3 py-3">
                <code className="block break-all rounded bg-muted px-2 py-1 font-mono text-[11px] leading-relaxed">
                  {row.value}
                </code>
              </td>
              <td className="px-3 py-3 text-right">
                {!row.value.startsWith("<") && <CopyButton text={row.value} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        {kind === "plaintext" ? (
          <span className="inline-flex items-center gap-1">
            <Globe className="h-3.5 w-3.5" /> Type: <strong>Plaintext</strong> (build-time, finiscono nel bundle client)
          </span>
        ) : (
          <span className="inline-flex items-center gap-1">
            <Lock className="h-3.5 w-3.5" /> Type: <strong>Secret / Encrypt</strong> (runtime, MAI esposti al client)
          </span>
        )}
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
        {n}
      </div>
      <div className="flex-1 space-y-2 pt-1">
        <h3 className="text-base font-semibold">{title}</h3>
        <div className="text-sm text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

function DeployGuide() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-10 md:py-14">
        <div className="mb-8">
          <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
            ← Torna al sito
          </Link>
          <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
            Guida deploy su Cloudflare Workers
          </h1>
          <p className="mt-2 text-muted-foreground">
            Configurazione passo-passo delle variabili d'ambiente <strong>Plaintext</strong> e{" "}
            <strong>Secret</strong> per il Worker.
          </p>
        </div>

        <Alert className="mb-8">
          <Info className="h-4 w-4" />
          <AlertTitle>Differenza fondamentale</AlertTitle>
          <AlertDescription>
            <strong>Plaintext</strong> = visibili nel bundle client (le <code>VITE_*</code> e{" "}
            <code>PUBLIC_*</code>). <strong>Secret</strong> = solo runtime server-side, mai esposte al
            browser. Su Cloudflare i due tipi si configurano nello stesso pannello ma con il selettore{" "}
            <em>Type</em> diverso.
          </AlertDescription>
        </Alert>

        <Card className="space-y-6 p-6">
          <h2 className="text-xl font-semibold">Passi su Cloudflare</h2>
          <Separator />

          <Step n={1} title="Apri il pannello del Worker">
            <p>
              Vai su{" "}
              <a
                href="https://dash.cloudflare.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                dash.cloudflare.com <ExternalLink className="h-3 w-3" />
              </a>{" "}
              → <strong>Workers & Pages</strong> → seleziona il tuo Worker.
            </p>
          </Step>

          <Step n={2} title="Vai su Settings → Variables and Secrets">
            <p>
              Nella sidebar del Worker apri <strong>Settings</strong>, poi scorri fino alla sezione{" "}
              <strong>Variables and Secrets</strong>.
            </p>
          </Step>

          <Step n={3} title="Aggiungi le 4 variabili Plaintext">
            <p>
              Per ognuna: clicca <strong>Add variable</strong>, scegli <strong>Type: Plaintext</strong>,
              incolla nome e valore.
            </p>
          </Step>

          <Step n={4} title="Aggiungi le 5 variabili Secret">
            <p>
              Per ognuna: clicca <strong>Add variable</strong>, scegli <strong>Type: Secret</strong>{" "}
              (o <em>Encrypt</em>), incolla nome e valore. Una volta salvati, i valori non saranno più
              visibili.
            </p>
          </Step>

          <Step n={5} title="Salva e rideploya">
            <p>
              Clicca <strong>Deploy</strong> in alto. Le secret diventano effettive solo con un nuovo
              deploy: vai su <strong>Deployments → Retry deployment</strong> oppure pusha un commit.
            </p>
          </Step>
        </Card>

        <section className="mt-10 space-y-3">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold">Variabili Plaintext (4)</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Visibili nel bundle JS lato client. Vanno bene per chiavi pubbliche e URL.
          </p>
          <VarTable rows={PLAINTEXT_VARS} kind="plaintext" />
        </section>

        <section className="mt-10 space-y-3">
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold">Variabili Secret (5)</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Lette solo lato server (Worker handler). Mai incluse nel bundle client.
          </p>
          <VarTable rows={SECRET_VARS} kind="secret" />
        </section>

        <Alert variant="destructive" className="mt-10">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Attenzione alle chiavi sensibili</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              <strong>BRIDGE_REDIRECT_SECRET</strong>: se la cambi, tutti i link <code>/wash</code> già
              emessi non passano più la verifica firma.
            </p>
          </AlertDescription>
        </Alert>

        <Card className="mt-10 space-y-4 p-6">
          <h2 className="text-xl font-semibold">Dove recuperare le chiavi sensibili</h2>
          <div className="space-y-3 text-sm">
            <div>
              <p className="font-semibold">BRIDGE_REDIRECT_SECRET</p>
              <p className="text-muted-foreground">
                Non presente nei secret Lovable. Se non lo usi già altrove, generane uno nuovo:
              </p>
              <code className="mt-1 block rounded bg-muted px-2 py-1 font-mono text-xs">
                openssl rand -hex 32
              </code>
            </div>
          </div>
        </Card>

        <Card className="mt-10 space-y-3 p-6">
          <h2 className="text-xl font-semibold">Verifica finale</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Apri l'URL del Worker: la home deve caricare senza errori 500.</li>
            <li>
              Controlla i log del Worker per il messaggio{" "}
              <code>Missing Supabase server environment variables</code>: se compare, una Secret è
              mancante o scritta male.
            </li>
            <li>
              Dopo il primo deploy aggiorna <code>PUBLIC_APP_URL</code> con l'URL reale del Worker e
              rideploya un'ultima volta.
            </li>
          </ul>
        </Card>

        <p className="mt-10 text-center text-xs text-muted-foreground">
          Pagina interna alla guida deploy. Non indicizzata.
        </p>
      </div>
    </div>
  );
}
