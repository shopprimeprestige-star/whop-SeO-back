import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getRuntimeBackendInfo } from "@/server-fn/migrate-supabase.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, CheckCircle2, XCircle, AlertTriangle, ExternalLink, Copy, RefreshCw, Server, Database, Key, ShieldAlert, Download, Cloud, Wand2, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";


export const Route = createFileRoute("/ponte-admin/migrate-supabase")({
  component: MigratePage,
  head: () => ({ meta: [{ title: "Migrazione Supabase esterno — Sito Ponte" }, { name: "robots", content: "noindex, nofollow" }] }),
});

type RuntimeInfo = Awaited<ReturnType<typeof getRuntimeBackendInfo>>;
type BackendMode = "cloud" | "external";

const STORAGE_KEY = "ponte-admin:supabase-migration-config";

type SavedBackendConfig = {
  url?: string;
  anon?: string;
  encKey?: string;
  desiredMode?: BackendMode;
  savedAt?: string;
};

function readSavedConfig(): SavedBackendConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem("ponte-admin:supabase-migration-draft");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function hostFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).host; } catch { return null; }
}

function fingerprintClient(value: string | undefined): string | null {
  if (!value) return null;
  if (value.length < 8) return "***";
  return `${value.slice(0, 4)}…${value.slice(-4)} (${value.length} chars)`;
}

function MigratePage() {
  const [info, setInfo] = useState<RuntimeInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newAnon, setNewAnon] = useState("");
  const [newEncKey, setNewEncKey] = useState("");
  const [desiredMode, setDesiredMode] = useState<BackendMode>("cloud");
  const [savedAt, setSavedAt] = useState<string | null>(null);

  async function load() {
    setRefreshing(true);
    try {
      const data = await getRuntimeBackendInfo();
      setInfo(data);
      const saved = readSavedConfig();
      if (!saved?.desiredMode) setDesiredMode(data.isLovableCloud ? "cloud" : "external");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore caricamento");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    const d = readSavedConfig();
    if (d) {
      setNewUrl(d.url ?? "");
      setNewAnon(d.anon ?? "");
      setNewEncKey(d.encKey ?? "");
      if (d.desiredMode) setDesiredMode(d.desiredMode);
      if (d.savedAt) setSavedAt(d.savedAt);
    }
    void load();
  }, []);

  function persistConfig(mode: BackendMode, message?: string) {
    const now = new Date().toISOString();
    const payload = { url: newUrl, anon: newAnon, encKey: newEncKey, desiredMode: mode, savedAt: now };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      localStorage.removeItem("ponte-admin:supabase-migration-draft");
      setSavedAt(now);
      if (message) toast.success(message);
    } catch (e) {
      toast.error("Impossibile salvare: " + (e instanceof Error ? e.message : "errore"));
    }
  }

  function selectMode(mode: BackendMode) {
    setDesiredMode(mode);
    persistConfig(mode, mode === "external" ? "Supabase esterno selezionato e salvato" : "Lovable Cloud selezionato e salvato");
  }

  function saveConfig() {
    persistConfig(desiredMode, "Configurazione salvata");
  }

  function clearDraft() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem("ponte-admin:supabase-migration-draft");
    setNewUrl(""); setNewAnon(""); setNewEncKey("");
    setSavedAt(null);
    setDesiredMode(info?.isLovableCloud ? "cloud" : "external");
    toast.success("Configurazione cancellata");
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} copiato`));
  }

  if (loading) return <div className="text-zinc-500">Caricamento…</div>;
  if (!info) return null;

  const clientUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const clientPublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  const clientHost = hostFromUrl(clientUrl);
  const clientStillLovable = clientHost === info.lovableCloudHost;

  return (
    <section className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Migrazione su Supabase esterno</h1>
          <p className="text-sm text-zinc-500">Diagnostica e checklist per uscire da Lovable Cloud.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/ponte-admin" className="text-sm text-zinc-500 hover:text-zinc-900 inline-flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </Link>
          <Button onClick={load} disabled={refreshing} size="sm" variant="outline">
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Aggiorna
          </Button>
        </div>
      </div>

      {/* STATO ATTUALE */}
      <Card title="Stato attuale del backend (runtime Worker)" icon={<Server className="h-4 w-4" />}>
        <div className={`rounded-md border p-4 ${info.isLovableCloud ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
          <div className="flex items-start gap-3">
            {info.isLovableCloud ? <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" /> : <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />}
            <div className="text-sm">
              <div className="font-medium text-zinc-900">
                {info.isLovableCloud
                  ? "Il backend è ancora Lovable Cloud"
                  : "Il backend è un Supabase esterno ✓"}
              </div>
              <div className="mt-1 text-zinc-700">
                Worker punta a: <code className="rounded bg-white border px-1.5 py-0.5 text-xs">{info.host ?? "—"}</code>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-2 text-sm">
          <EnvRow label="SUPABASE_URL" present={info.env.SUPABASE_URL.present} value={info.env.SUPABASE_URL.value} copyValue={info.env.SUPABASE_URL.value} onCopy={copy} />
          <EnvRow label="SUPABASE_PROJECT_ID" present={info.env.SUPABASE_PROJECT_ID.present} value={info.env.SUPABASE_PROJECT_ID.value} copyValue={info.env.SUPABASE_PROJECT_ID.value} onCopy={copy} />
          <EnvRow label="SUPABASE_PUBLISHABLE_KEY" present={info.env.SUPABASE_PUBLISHABLE_KEY.present} value={info.env.SUPABASE_PUBLISHABLE_KEY.fingerprint} copyValue={info.env.SUPABASE_PUBLISHABLE_KEY.value} onCopy={copy} secret />
          <EnvRow label="SUPABASE_SERVICE_ROLE_KEY" present={info.env.SUPABASE_SERVICE_ROLE_KEY.present} value={info.env.SUPABASE_SERVICE_ROLE_KEY.fingerprint} copyValue={info.env.SUPABASE_SERVICE_ROLE_KEY.value} onCopy={copy} secret />
          <EnvRow label="SUPABASE_DB_URL" present={info.env.SUPABASE_DB_URL.present} value={info.env.SUPABASE_DB_URL.fingerprint} copyValue={info.env.SUPABASE_DB_URL.value} onCopy={copy} secret />
          <EnvRow label="ENCRYPTION_KEY" present={info.env.ENCRYPTION_KEY.present} value={info.env.ENCRYPTION_KEY.fingerprint} copyValue={info.env.ENCRYPTION_KEY.value} onCopy={copy} secret />
          <EnvRow label="LOVABLE_API_KEY" present={info.env.LOVABLE_API_KEY.present} value={info.env.LOVABLE_API_KEY.fingerprint} copyValue={info.env.LOVABLE_API_KEY.value} onCopy={copy} secret />
          <EnvRow label="VITE_SUPABASE_URL (client login)" present={!!clientUrl} value={clientUrl ?? null} copyValue={clientUrl ?? null} onCopy={copy} />
          <EnvRow label="VITE_SUPABASE_PUBLISHABLE_KEY (client login)" present={!!clientPublishableKey} value={fingerprintClient(clientPublishableKey)} copyValue={clientPublishableKey ?? null} onCopy={copy} secret />
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={() => {
            const block = [
              `SUPABASE_URL=${info.env.SUPABASE_URL.value ?? ""}`,
              `SUPABASE_PROJECT_ID=${info.env.SUPABASE_PROJECT_ID.value ?? ""}`,
              `SUPABASE_PUBLISHABLE_KEY=${info.env.SUPABASE_PUBLISHABLE_KEY.value ?? ""}`,
              `SUPABASE_SERVICE_ROLE_KEY=${info.env.SUPABASE_SERVICE_ROLE_KEY.value ?? ""}`,
              `SUPABASE_DB_URL=${info.env.SUPABASE_DB_URL.value ?? ""}`,
              `ENCRYPTION_KEY=${info.env.ENCRYPTION_KEY.value ?? ""}`,
              `LOVABLE_API_KEY=${info.env.LOVABLE_API_KEY.value ?? ""}`,
              `VITE_SUPABASE_URL=${clientUrl ?? info.env.SUPABASE_URL.value ?? ""}`,
              `VITE_SUPABASE_PUBLISHABLE_KEY=${clientPublishableKey ?? info.env.SUPABASE_PUBLISHABLE_KEY.value ?? ""}`,
            ].join("\n");
            copy(block, "Tutte le variabili runtime");
          }}>
            <Copy className="mr-1.5 h-3 w-3" /> Copia tutte le variabili (KEY=VALUE)
          </Button>
        </div>

        {desiredMode === "external" && clientStillLovable && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <strong>Probabile causa:</strong> il runtime server può puntare al DB esterno, ma il login/admin nel browser usa ancora
            <code className="mx-1 rounded bg-white px-1">VITE_SUPABASE_URL</code> e
            <code className="mx-1 rounded bg-white px-1">VITE_SUPABASE_PUBLISHABLE_KEY</code> del Cloud interno. Aggiungile su Cloudflare e fai redeploy.
          </div>
        )}
      </Card>

      {/* AVVISO */}
      <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
        <div className="flex items-start gap-2">
          <ShieldAlert className="h-5 w-5 shrink-0 text-rose-600" />
          <div className="space-y-1">
            <div className="font-medium">⚠ Limitazioni tecniche</div>
            <ul className="list-disc pl-5 space-y-0.5">
              <li>Il file <code>src/integrations/supabase/client.ts</code> è auto-generato da Lovable e <strong>continuerà a puntare a Lovable Cloud in preview</strong>.</li>
              <li>Il tuo Supabase esterno funziona in produzione solo se sono aggiornate sia le env runtime (<code>SUPABASE_*</code>) sia quelle client/build (<code>VITE_SUPABASE_*</code>).</li>
              <li>I token Shopify/Whop nel DB sono cifrati con la <code>ENCRYPTION_KEY</code> attuale: cambiandola devi <strong>riconnettere gli store</strong> da zero (o ri-cifrare manualmente).</li>
              <li>Non esiste un selettore runtime: il backend si cambia dalle variabili Cloudflare + nuovo deploy/build.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* DOWNLOAD SQL */}
      <Card title="1️⃣ Schema SQL pronto da incollare" icon={<Download className="h-4 w-4" />}>
        <p className="text-sm text-zinc-600">
          File completo con tutte le tabelle, RLS, funzioni, enum e trigger. Scaricalo, apri il SQL Editor del TUO nuovo
          progetto Supabase e incollalo tutto in un'unica esecuzione.
        </p>
        <div className="flex flex-wrap gap-2">
          <a href="/supabase-migration.sql" download="supabase-migration.sql">
            <Button size="sm" className="bg-zinc-900 text-white hover:bg-zinc-800">
              <Download className="mr-1.5 h-3.5 w-3.5" /> Scarica supabase-migration.sql
            </Button>
          </a>
          <a href="/supabase-migration.sql" target="_blank" rel="noreferrer">
            <Button size="sm" variant="outline"><ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Apri/visualizza</Button>
          </a>
        </div>
        <p className="text-xs text-amber-700">
          ⚠ I <strong>dati</strong> (record esistenti) NON sono in questo file: esportali separatamente da Lovable Cloud
          (Table Editor → Export CSV per ogni tabella, oppure <code>pg_dump --data-only</code>).
        </p>
      </Card>

      {/* SWITCH UI cloud/esterno */}
      <Card title="2️⃣ Scegli modalità backend (desiderata)" icon={<Cloud className="h-4 w-4" />}>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => selectMode("cloud")}
            className={`text-left rounded-md border-2 p-4 transition ${desiredMode === "cloud" ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200" : "border-zinc-200 bg-white hover:border-zinc-400"}`}
          >
            <div className="flex items-center justify-between mb-2">
              <strong className="text-sm">🏠 Lovable Cloud</strong>
              <div className="flex gap-1">
                {info.isLovableCloud && <span className="text-[10px] bg-blue-600 text-white px-1.5 py-0.5 rounded-full">RUNTIME</span>}
                {desiredMode === "cloud" && <span className="text-[10px] bg-zinc-900 text-white px-1.5 py-0.5 rounded-full">SCELTO</span>}
              </div>
            </div>
            <p className="text-xs text-zinc-600">Backend gestito da Lovable. Default per nuovi progetti.</p>
            <p className="text-xs text-zinc-500 mt-2">Host: <code>vpxlqrqxehyaqjoiyhqi.supabase.co</code></p>
          </button>
          <button
            type="button"
            onClick={() => selectMode("external")}
            className={`text-left rounded-md border-2 p-4 transition ${desiredMode === "external" ? "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200" : "border-zinc-200 bg-white hover:border-zinc-400"}`}
          >
            <div className="flex items-center justify-between mb-2">
              <strong className="text-sm">🌍 Supabase esterno</strong>
              <div className="flex gap-1">
                {!info.isLovableCloud && <span className="text-[10px] bg-emerald-600 text-white px-1.5 py-0.5 rounded-full">RUNTIME</span>}
                {desiredMode === "external" && <span className="text-[10px] bg-zinc-900 text-white px-1.5 py-0.5 rounded-full">SCELTO</span>}
              </div>
            </div>
            <p className="text-xs text-zinc-600">Tuo progetto su supabase.com. Controllo totale, pricing tuo.</p>
            <p className="text-xs text-zinc-500 mt-2">Host attuale: <code>{info.host ?? "—"}</code></p>
          </button>
        </div>
        <div className="rounded-md bg-zinc-100 border border-zinc-200 p-3 text-xs text-zinc-700">
          <strong>Nota:</strong> la scelta viene salvata subito in questo browser. L'attivazione reale (badge "RUNTIME")
          avviene dopo aver aggiornato tutte le env vars sul Worker Cloudflare e fatto <em>Redeploy</em>.
        </div>
      </Card>

      {/* WIZARD VARIABILI CLOUDFLARE */}
      <Card title="3️⃣ Inserisci credenziali Supabase esterno" icon={<Wand2 className="h-4 w-4" />}>
        <p className="text-sm text-zinc-600">
          Incolla qui sotto i valori del TUO nuovo Supabase. Premi <strong>Salva configurazione</strong> per conservarli in questo browser.
          Poi copia ogni variabile in Cloudflare → Worker → Settings → Variables and Secrets e fai redeploy.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="SUPABASE_URL (del tuo)">
            <Input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="https://abcxyz.supabase.co" className="font-mono text-xs" />
          </Field>
          <Field label="ENCRYPTION_KEY (nuova, 64 hex)">
            <Input value={newEncKey} onChange={(e) => setNewEncKey(e.target.value)} placeholder="openssl rand -hex 32" className="font-mono text-xs" />
          </Field>
          <Field label="SUPABASE_PUBLISHABLE_KEY (anon)">
            <Input value={newAnon} onChange={(e) => setNewAnon(e.target.value)} placeholder="eyJhbGciOi..." className="font-mono text-xs" />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={saveConfig} className="bg-emerald-600 text-white hover:bg-emerald-700">
            <Save className="mr-1.5 h-3.5 w-3.5" /> Salva configurazione
          </Button>
          <Button size="sm" variant="outline" onClick={clearDraft}>
            <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Cancella
          </Button>
          {savedAt && (
            <span className="text-xs text-zinc-500">Ultimo salvataggio: {new Date(savedAt).toLocaleString("it-IT")}</span>
          )}
        </div>
        <p className="text-xs text-amber-700">
          ⚠ Il salvataggio qui evita che la scelta sparisca al refresh. Per renderlo live devi avere anche le variabili corrette
          nel Worker pubblicato; se il client deve fare login sul DB esterno, imposta anche le due variabili <code>VITE_*</code> qui sotto.
        </p>


        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <strong className="text-xs uppercase tracking-wider text-zinc-700">Variabili da impostare su Cloudflare Worker</strong>
            <Button size="sm" variant="outline" onClick={() => {
              const block = [
                `SUPABASE_URL=${newUrl || "<incolla sopra>"}`,
                `SUPABASE_PUBLISHABLE_KEY=${newAnon || "<incolla sopra>"}`,
                `ENCRYPTION_KEY=${newEncKey || "<incolla sopra>"}`,
                `VITE_SUPABASE_URL=${newUrl || "<incolla sopra>"}`,
                `VITE_SUPABASE_PUBLISHABLE_KEY=${newAnon || "<incolla sopra>"}`,
              ].join("\n");
              copy(block, "Blocco variabili");
            }}>
              <Copy className="mr-1.5 h-3 w-3" /> Copia tutto
            </Button>
          </div>
          <CloudflareVar name="SUPABASE_URL" type="Plaintext" value={newUrl} onCopy={copy} />
          <CloudflareVar name="SUPABASE_PUBLISHABLE_KEY" type="Plaintext" value={newAnon} onCopy={copy} />
          <CloudflareVar name="ENCRYPTION_KEY" type="Secret (Encrypt)" value={newEncKey} onCopy={copy} secret />
          <CloudflareVar name="VITE_SUPABASE_URL" type="Plaintext (client)" value={newUrl} onCopy={copy} />
          <CloudflareVar name="VITE_SUPABASE_PUBLISHABLE_KEY" type="Plaintext (client)" value={newAnon} onCopy={copy} />
          <CloudflareVar name="LOVABLE_API_KEY" type="Secret (Encrypt)" value="(lascia invariato)" onCopy={copy} readOnly />
        </div>

        <div className="text-xs text-zinc-600 space-y-1">
          <div><strong>Dove incollare:</strong> Cloudflare Dashboard → Workers &amp; Pages → <code>whop-alx-001-checkout</code> → Settings → Variables and Secrets.</div>
          <div><strong>Importantissimo:</strong> le variabili <code>VITE_*</code> devono esistere prima del build/deploy perché finiscono nel JavaScript del browser. Dopo averle salvate, fai un nuovo deploy completo.</div>
        </div>
      </Card>

      {/* CHECKLIST */}
      <Card title="📋 Checklist completa passo-passo" icon={<Database className="h-4 w-4" />}>
        <Step n={1} title="Crea il progetto Supabase esterno">
          <p>Vai su <a className="text-blue-600 hover:underline inline-flex items-center gap-0.5" href="https://supabase.com/dashboard/projects" target="_blank" rel="noreferrer">supabase.com/dashboard <ExternalLink className="h-3 w-3" /></a> → <em>New project</em>. Annota da <em>Settings → API</em>:</p>
          <ul className="list-disc pl-5 mt-1 space-y-0.5">
            <li><code>Project URL</code> (es. <code>https://abcxyz.supabase.co</code>)</li>
            <li><code>anon public</code> key</li>
            <li><code>service_role</code> key (segreta)</li>

          </ul>
        </Step>

        <Step n={2} title="Esporta schema dal Cloud attuale">
          <p>Lovable sidebar → <strong>View Backend</strong> → SQL Editor. Esegui:</p>
          <CodeBlock onCopy={copy} label="Query schema dump" code={`-- Lista tabelle pubbliche da migrare
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' ORDER BY table_name;`} />
          <p className="mt-2">Per export completo usa <code>pg_dump</code> con la connection string da <em>Project Settings → Database → Connection string</em>:</p>
          <CodeBlock onCopy={copy} label="Comando pg_dump" code={`pg_dump "postgres://..." --schema-only --schema=public > schema.sql
pg_dump "postgres://..." --data-only --schema=public > data.sql`} />
        </Step>

        <Step n={3} title="Importa sul tuo Supabase nuovo">
          <p>SQL Editor del tuo Supabase → incolla <code>schema.sql</code>, poi <code>data.sql</code>. Verifica che ci siano tutte le tabelle: <code>articles, bridge_*, capi_*, shop_*, site_settings, sync_settings, user_roles, shadow_*, native_*, compared_products</code>.</p>
        </Step>

        <Step n={4} title="Crea i ruoli e l'utente admin">
          <p>Su Supabase nuovo → <em>Authentication → Users → Add user</em> (la tua email). Poi SQL Editor:</p>
          <CodeBlock onCopy={copy} label="Promuovi admin" code={`INSERT INTO public.user_roles (user_id, role)
VALUES ((SELECT id FROM auth.users WHERE email='tua@email.it'), 'admin');`} />
        </Step>

        <Step n={5} title="Genera nuova ENCRYPTION_KEY">
          <CodeBlock onCopy={copy} label="Comando" code={`openssl rand -hex 32`} />
          <p className="mt-1 text-amber-700">⚠ I token Shopify/Whop esistenti diventeranno illeggibili. Dovrai <strong>riconnettere ogni store</strong> dal pannello admin.</p>
        </Step>

        <Step n={6} title="Configura Auth sul tuo Supabase">
          <ul className="list-disc pl-5 space-y-0.5">
            <li><em>Authentication → URL Configuration</em>: Site URL = <code>https://whop-alx-001-checkout.shop-primeprestige.workers.dev</code> (o tuo dominio)</li>
            <li><em>Authentication → Providers</em>: abilita Email; Google se ti serve OAuth</li>
          </ul>
        </Step>

        <Step n={7} title="Aggiorna le env vars su Cloudflare Workers">
          <p>Cloudflare → Workers → <code>whop-alx-001-checkout</code> → Settings → Variables and Secrets. <strong>Sostituisci</strong> i valori:</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs border border-zinc-200">
              <thead className="bg-zinc-50">
                <tr><th className="p-2 text-left">Variabile</th><th className="p-2 text-left">Tipo</th><th className="p-2 text-left">Nuovo valore</th></tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                <tr><td className="p-2"><code>SUPABASE_URL</code></td><td className="p-2">Plaintext</td><td className="p-2">URL del TUO Supabase</td></tr>
                <tr><td className="p-2"><code>SUPABASE_PUBLISHABLE_KEY</code></td><td className="p-2">Plaintext</td><td className="p-2">anon key del TUO</td></tr>
                <tr><td className="p-2"><code>ENCRYPTION_KEY</code></td><td className="p-2">Secret</td><td className="p-2">la NUOVA chiave (step 5)</td></tr>
                <tr><td className="p-2"><code>VITE_SUPABASE_URL</code></td><td className="p-2">Plaintext / Build</td><td className="p-2">stesso URL del TUO Supabase, serve al login browser</td></tr>
                <tr><td className="p-2"><code>VITE_SUPABASE_PUBLISHABLE_KEY</code></td><td className="p-2">Plaintext / Build</td><td className="p-2">stessa anon key del TUO Supabase, serve al login browser</td></tr>
                <tr><td className="p-2"><code>LOVABLE_API_KEY</code></td><td className="p-2">Secret</td><td className="p-2">invariato (serve per AI)</td></tr>
              </tbody>
            </table>
          </div>
        </Step>

        <Step n={8} title="Nuovo deploy completo del Worker">
          <p>Cloudflare → Workers → Deployments → <em>Deploy/Redeploy</em>. Se hai aggiunto le <code>VITE_*</code> via API dopo il deploy, rifai proprio il build/deploy: non basta cambiare il secret runtime.</p>
        </Step>

        <Step n={9} title="Verifica">
          <p>Torna in questa pagina e clicca <strong>Aggiorna</strong>. Il banner in alto deve diventare verde con il TUO host. Poi:</p>
          <ul className="list-disc pl-5 space-y-0.5">
            <li>Login admin su <code>/ponte-admin/login</code> con l'utente creato allo step 4</li>
            <li>Riconnetti gli store Shopify/Whop (step 5)</li>
            <li>Verifica che webhook Shopify e Whop arrivino correttamente</li>
          </ul>
        </Step>
      </Card>

      <Card title="Note finali" icon={<Key className="h-4 w-4" />}>
        <ul className="list-disc pl-5 space-y-1 text-sm text-zinc-700">
          <li>La preview Lovable rimarrà sempre su Lovable Cloud (è hardcoded nel client auto-generato). Test reali → solo su URL Worker Cloudflare.</li>
          <li>Per disabilitare Lovable Cloud completamente: <em>sidebar Lovable → Connectors → Lovable Cloud → Disable Cloud</em> (irreversibile sul progetto).</li>
          <li>Backup periodici: configura <em>Database → Backups</em> sul tuo Supabase (Free tier = 7 giorni).</li>
        </ul>
      </Card>
    </section>
  );
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 space-y-4">
      <h3 className="flex items-center gap-2 text-sm font-medium text-zinc-700">{icon} {title}</h3>
      {children}
    </div>
  );
}

function EnvRow({ label, present, value, copyValue, onCopy, secret }: { label: string; present: boolean; value: string | null; copyValue?: string | null; onCopy?: (t: string, l: string) => void; secret?: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const display = present
    ? secret && !revealed
      ? value
      : (copyValue ?? value)
    : "non impostato";
  return (
    <div className="flex items-center justify-between gap-3 rounded border border-zinc-100 bg-zinc-50 px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        {present ? <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" /> : <XCircle className="h-4 w-4 text-rose-600 shrink-0" />}
        <code className="text-xs truncate">{label}</code>
      </div>
      <div className="flex items-center gap-2 min-w-0 max-w-[65%]">
        <div className="text-xs text-zinc-600 font-mono truncate text-right">{display}</div>
        {present && secret && copyValue && (
          <button onClick={() => setRevealed((v) => !v)} className="rounded p-1 hover:bg-zinc-200 shrink-0" title={revealed ? "Nascondi" : "Mostra"}>
            <Key className="h-3 w-3" />
          </button>
        )}
        {present && copyValue && onCopy && (
          <button onClick={() => onCopy(copyValue, label)} className="rounded p-1 hover:bg-zinc-200 shrink-0" title="Copia">
            <Copy className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="border-l-2 border-zinc-200 pl-4 py-1">
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-zinc-900 text-white text-xs font-semibold">{n}</span>
        <h4 className="text-sm font-medium text-zinc-900">{title}</h4>
      </div>
      <div className="mt-2 ml-8 text-sm text-zinc-600 space-y-1">{children}</div>
    </div>
  );
}

function CodeBlock({ code, label, onCopy }: { code: string; label: string; onCopy: (t: string, l: string) => void }) {
  return (
    <div className="relative mt-2">
      <pre className="rounded bg-zinc-900 text-zinc-100 text-xs p-3 overflow-x-auto"><code>{code}</code></pre>
      <button onClick={() => onCopy(code, label)} className="absolute top-2 right-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 p-1.5" title="Copia">
        <Copy className="h-3 w-3" />
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs uppercase tracking-wider text-zinc-500 font-medium">{label}</Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function CloudflareVar({ name, type, value, onCopy, secret, readOnly }: {
  name: string; type: string; value: string; onCopy: (t: string, l: string) => void; secret?: boolean; readOnly?: boolean;
}) {
  const display = value || "(vuoto)";
  const masked = secret && value && !readOnly ? "•".repeat(Math.min(value.length, 20)) : display;
  return (
    <div className="flex items-center justify-between gap-2 rounded bg-white border border-zinc-200 px-3 py-2 text-xs">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <code className="font-semibold shrink-0">{name}</code>
        <span className="text-[10px] uppercase text-zinc-400 shrink-0">{type}</span>
        <span className="font-mono text-zinc-600 truncate">{masked}</span>
      </div>
      {!readOnly && (
        <button onClick={() => onCopy(value, name)} disabled={!value} className="rounded p-1 hover:bg-zinc-100 disabled:opacity-30" title="Copia valore">
          <Copy className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

