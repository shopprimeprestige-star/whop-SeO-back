import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getExternalDbConfig,
  saveExternalDbConfig,
  clearExternalDbKey,
  testExternalDbConfig,
} from "@/server-fn/external-db.functions";
import { Database, ShieldCheck, ShieldAlert, Loader2, Trash2 } from "lucide-react";

export const Route = createFileRoute("/ponte-admin/external-db")({
  component: ExternalDbPage,
  head: () => ({
    meta: [
      { title: "DB Esterno — Sito Ponte" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

type Status = {
  external_url: string;
  service_role_key_masked: string | null;
  publishable_key_masked: string | null;
  has_service_role: boolean;
  has_publishable: boolean;
  updated_at: string | null;
};

function ExternalDbPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [url, setUrl] = useState("");
  const [serviceRole, setServiceRole] = useState("");
  const [publishable, setPublishable] = useState("");
  const [testResult, setTestResult] = useState<Record<string, unknown> | null>(null);

  async function refresh() {
    try {
      const data = await getExternalDbConfig();
      setStatus(data);
      setUrl(data.external_url || "");
      setServiceRole("");
      setPublishable("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore caricamento");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function onSave() {
    if (!url.trim()) {
      toast.error("URL obbligatorio");
      return;
    }
    setSaving(true);
    try {
      await saveExternalDbConfig({
        data: {
          external_url: url.trim(),
          external_service_role_key: serviceRole.trim() || undefined,
          external_publishable_key: publishable.trim() || undefined,
        },
      });
      toast.success("Configurazione salvata");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore salvataggio");
    } finally {
      setSaving(false);
    }
  }

  async function onClear(which: "service_role" | "publishable") {
    if (!confirm(`Rimuovere la chiave ${which}?`)) return;
    try {
      await clearExternalDbKey({ data: { which } });
      toast.success("Chiave rimossa");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    }
  }

  async function onTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testExternalDbConfig();
      setTestResult(res as Record<string, unknown>);
      if ((res as { ok?: boolean }).ok) toast.success("Connessione OK");
      else toast.error("Test fallito — vedi dettagli");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore test");
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Database className="h-6 w-6" /> Database Esterno (Bridge)
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Configura URL e chiavi del database Supabase usato per handshake, get-config,
          update-config e checkout. Lasciato vuoto, il sistema usa il database Lovable
          Cloud locale (env vars <code>SUPABASE_*</code>) come fallback. Il database
          <code> /sync-product</code> usa <strong>sempre</strong> Lovable Cloud.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-5 space-y-2">
        <div className="text-sm font-medium flex items-center gap-2">
          {status?.has_service_role ? (
            <ShieldCheck className="h-4 w-4 text-green-600" />
          ) : (
            <ShieldAlert className="h-4 w-4 text-amber-600" />
          )}
          Stato configurazione
        </div>
        <dl className="text-xs grid grid-cols-[160px_1fr] gap-y-1">
          <dt className="text-muted-foreground">URL attivo:</dt>
          <dd className="font-mono">{status?.external_url || <span className="text-muted-foreground italic">(non impostato — fallback env)</span>}</dd>
          <dt className="text-muted-foreground">Service role:</dt>
          <dd className="font-mono">
            {status?.service_role_key_masked || <span className="text-muted-foreground italic">(non impostata)</span>}
            {status?.has_service_role && (
              <button onClick={() => onClear("service_role")} className="ml-2 text-destructive hover:underline">
                <Trash2 className="inline h-3 w-3" /> rimuovi
              </button>
            )}
          </dd>
          <dt className="text-muted-foreground">Publishable:</dt>
          <dd className="font-mono">
            {status?.publishable_key_masked || <span className="text-muted-foreground italic">(non impostata)</span>}
            {status?.has_publishable && (
              <button onClick={() => onClear("publishable")} className="ml-2 text-destructive hover:underline">
                <Trash2 className="inline h-3 w-3" /> rimuovi
              </button>
            )}
          </dd>
          <dt className="text-muted-foreground">Ultimo update:</dt>
          <dd>{status?.updated_at ? new Date(status.updated_at).toLocaleString("it-IT") : "—"}</dd>
        </dl>
      </div>

      <div className="rounded-lg border bg-card p-5 space-y-4">
        <div>
          <Label htmlFor="ext-url">EXTERNAL_SUPABASE_URL</Label>
          <Input
            id="ext-url"
            placeholder="https://xxxxxxxx.supabase.co"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="mt-1 font-mono"
          />
          <p className="mt-1 text-xs text-muted-foreground">URL del progetto Supabase esterno (Sito B canonico).</p>
        </div>
        <div>
          <Label htmlFor="ext-srk">EXTERNAL_SUPABASE_SERVICE_ROLE_KEY</Label>
          <Input
            id="ext-srk"
            type="password"
            placeholder={status?.has_service_role ? "(impostata — lascia vuoto per non modificare)" : "eyJhbGc... oppure sb_secret_..."}
            value={serviceRole}
            onChange={(e) => setServiceRole(e.target.value)}
            className="mt-1 font-mono"
            autoComplete="off"
          />
          <p className="mt-1 text-xs text-muted-foreground">Bypassa RLS, usata per leggere bridge_stores e chiamare le RPC.</p>
        </div>
        <div>
          <Label htmlFor="ext-pub">EXTERNAL_SUPABASE_PUBLISHABLE_KEY</Label>
          <Input
            id="ext-pub"
            type="password"
            placeholder={status?.has_publishable ? "(impostata — lascia vuoto per non modificare)" : "eyJhbGc... (anon key)"}
            value={publishable}
            onChange={(e) => setPublishable(e.target.value)}
            className="mt-1 font-mono"
            autoComplete="off"
          />
          <p className="mt-1 text-xs text-muted-foreground">Opzionale — usata per la RPC pubblica <code>bridge_handshake</code>.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={onSave} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Salva
          </Button>
          <Button variant="outline" onClick={onTest} disabled={testing}>
            {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Testa connessione
          </Button>
        </div>
      </div>

      {testResult && (
        <div className="rounded-lg border bg-muted/30 p-5">
          <div className="text-sm font-medium mb-2">Risultato test</div>
          <pre className="text-xs overflow-x-auto">{JSON.stringify(testResult, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
