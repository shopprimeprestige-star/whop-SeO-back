import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshCw, Plus, Trash2, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/ponte-admin/clones-health")({
  component: ClonesHealthPage,
  head: () => ({ meta: [{ title: "Cloni — Health Check" }, { name: "robots", content: "noindex, nofollow" }] }),
});

type HealthResult = {
  ok: boolean | null;
  status?: number;
  checkedAt?: string;
  data?: any;
  error?: string;
  durationMs?: number;
};

const STORAGE_KEY = "ponte_admin_clone_domains";
const DEFAULT_CLONES = ["oclak.store", "oclak-deals.shop"];

function loadClones(): string[] {
  if (typeof window === "undefined") return DEFAULT_CLONES;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CLONES;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {}
  return DEFAULT_CLONES;
}

function saveClones(domains: string[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(domains));
}

async function checkClone(domain: string): Promise<HealthResult> {
  const url = `https://${domain}/api/public/bridge/health`;
  const start = Date.now();
  try {
    const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
    const durationMs = Date.now() - start;
    let data: any = null;
    try { data = await res.json(); } catch {}
    return {
      ok: res.ok && data?.ok === true,
      status: res.status,
      checkedAt: new Date().toISOString(),
      data,
      durationMs,
    };
  } catch (e: any) {
    return {
      ok: false,
      checkedAt: new Date().toISOString(),
      error: e?.message || "Network error",
      durationMs: Date.now() - start,
    };
  }
}

function ClonesHealthPage() {
  const [clones, setClones] = useState<string[]>([]);
  const [results, setResults] = useState<Record<string, HealthResult>>({});
  const [newDomain, setNewDomain] = useState("");
  const [checking, setChecking] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setClones(loadClones());
  }, []);

  async function refreshAll() {
    for (const d of clones) await refreshOne(d);
  }

  async function refreshOne(domain: string) {
    setChecking((p) => ({ ...p, [domain]: true }));
    const r = await checkClone(domain);
    setResults((p) => ({ ...p, [domain]: r }));
    setChecking((p) => ({ ...p, [domain]: false }));
  }

  function addDomain() {
    const d = newDomain.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!d) return;
    if (clones.includes(d)) {
      toast.error("Dominio già presente");
      return;
    }
    const next = [...clones, d];
    setClones(next);
    saveClones(next);
    setNewDomain("");
    refreshOne(d);
  }

  function removeDomain(d: string) {
    const next = clones.filter((x) => x !== d);
    setClones(next);
    saveClones(next);
    setResults((p) => {
      const { [d]: _, ...rest } = p;
      return rest;
    });
  }

  useEffect(() => {
    if (clones.length === 0) return;
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clones.length]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Cloni — Health Check</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Stato di <code>/api/public/bridge/health</code> per ogni clone. Mostra quali secret risultano configurati sul Worker Cloudflare.
          </p>
        </div>
        <Button onClick={refreshAll} variant="outline" size="sm">
          <RefreshCw className="mr-2 h-4 w-4" /> Aggiorna tutti
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Aggiungi clone</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              placeholder="es. esempio.store"
              onKeyDown={(e) => { if (e.key === "Enter") addDomain(); }}
            />
            <Button onClick={addDomain}>
              <Plus className="mr-2 h-4 w-4" /> Aggiungi
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {clones.map((d) => {
          const r = results[d];
          const isChecking = checking[d];
          return (
            <Card key={d}>
              <CardHeader className="pb-3 flex flex-row items-start justify-between space-y-0">
                <div className="space-y-1">
                  <CardTitle className="text-base flex items-center gap-2">
                    <StatusIcon r={r} loading={isChecking} />
                    {d}
                  </CardTitle>
                  <div className="text-xs text-muted-foreground">
                    {r?.checkedAt ? (
                      <>Ultimo check: {new Date(r.checkedAt).toLocaleString("it-IT")}{r.durationMs != null && ` · ${r.durationMs}ms`}</>
                    ) : (
                      "Non ancora verificato"
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => refreshOne(d)} disabled={isChecking}>
                    <RefreshCw className={`h-4 w-4 ${isChecking ? "animate-spin" : ""}`} />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => removeDomain(d)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant={r?.data?.has_service_role ? "default" : "destructive"}>
                    service_role: {r?.data?.has_service_role ? "OK" : "MISSING"}
                  </Badge>
                  <Badge variant={r?.data?.has_publishable ? "default" : "destructive"}>
                    publishable: {r?.data?.has_publishable ? "OK" : "MISSING"}
                  </Badge>
                  <Badge variant={r?.data?.has_bridge_api_key ? "default" : "destructive"}>
                    bridge_api_key: {r?.data?.has_bridge_api_key ? "OK" : "MISSING"}
                  </Badge>
                  <Badge variant="outline" className="opacity-70">
                    encryption_key: {r?.data?.has_encryption_key ? "OK" : "opzionale"}
                  </Badge>
                  {r?.data?.version && <Badge variant="outline">v {r.data.version}</Badge>}
                  {r?.data?.project_ref && <Badge variant="outline">ref: {r.data.project_ref}</Badge>}
                  {r?.status != null && <Badge variant="outline">HTTP {r.status}</Badge>}
                </div>

                {r?.data?.service_role_source && (
                  <div className="text-xs text-muted-foreground">
                    Service role letta da: <code className="font-mono">{r.data.service_role_source}</code>
                  </div>
                )}
                {Array.isArray(r?.data?.missing_env) && r.data.missing_env.length > 0 && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs space-y-3">
                    <div className="font-medium text-destructive">
                      Secret mancanti — aggiungili su Cloudflare Workers → Settings → Variables and Secrets (tipo: Secret), poi Deploy:
                    </div>
                    {r.data.missing_env.map((name: string) => {
                      const help = r.data?.env_help?.[name] as
                        | { accepted?: string[]; value?: string; hint?: string }
                        | undefined;
                      return (
                        <div key={name} className="rounded border border-destructive/20 bg-background p-2 space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">Variable name:</span>
                            <code className="font-mono font-semibold">{name}</code>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2"
                              onClick={() => {
                                navigator.clipboard.writeText(name);
                                toast.success(`Copiato: ${name}`);
                              }}
                            >
                              Copia nome
                            </Button>
                          </div>
                          {help?.accepted && help.accepted.length > 1 && (
                            <div className="text-muted-foreground">
                              Alias accettati: {help.accepted.map((a) => <code key={a} className="font-mono mr-1">{a}</code>)}
                            </div>
                          )}
                          {help?.hint && <div className="text-muted-foreground">{help.hint}</div>}
                          {help?.value ? (
                            <div className="flex items-start gap-2">
                              <span className="text-muted-foreground shrink-0">API key / valore:</span>
                              <code className="font-mono break-all text-[10px] bg-muted px-1.5 py-0.5 rounded">{help.value}</code>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 shrink-0"
                                onClick={() => {
                                  navigator.clipboard.writeText(help.value!);
                                  toast.success("Valore copiato");
                                }}
                              >
                                Copia valore
                              </Button>
                            </div>
                          ) : (
                            <div className="text-muted-foreground space-y-1">
                              <div><span className="font-medium">API key / valore:</span> da copiare manualmente.</div>
                              {name === "SUPABASE_SERVICE_ROLE_KEY" && (
                                <div className="rounded bg-muted/50 p-2 space-y-1">
                                  <div>Va bene <strong>una qualsiasi</strong> di queste due (project_ref <code className="font-mono">{r?.data?.project_ref}</code>):</div>
                                  <div>• <strong>Nuova Secret key</strong> (consigliata) — Supabase Dashboard → Settings → <strong>API Keys</strong> → tab "<strong>Publishable and secret API keys</strong>" → sezione "<strong>Secret keys</strong>" → clicca l'occhio sulla riga <code className="font-mono">default</code> per rivelare la chiave <code className="font-mono">sb_secret_…</code> e copiala.</div>
                                  <div>• <strong>Legacy service_role JWT</strong> — stesso menu → tab "<strong>Legacy anon, service_role API keys</strong>" → riga <strong>service_role</strong> (NON la anon).</div>
                                  <div className="pt-1">Incolla il valore come <strong>Secret</strong> in Cloudflare Workers usando uno qualsiasi di questi nomi: <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code>, <code className="font-mono">SUPABASE_SECRET_KEY</code>.</div>
                                </div>
                              )}
                              {name === "BRIDGE_API_KEY" && <div>Generala dall'admin Ponte → Stores → Bridge API Key.</div>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {r?.error && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                    Errore di rete: {r.error}
                  </div>
                )}
                {r?.data && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Risposta JSON completa</summary>
                    <pre className="mt-2 overflow-auto rounded-md bg-muted p-3 font-mono text-[11px]">{JSON.stringify(r.data, null, 2)}</pre>
                  </details>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Cloudflare — Cache & Routing</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2 text-muted-foreground">
          <p>Per assicurare che il Worker stia servendo la versione più recente di ciascun clone:</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Cloudflare Dashboard → <strong>Workers & Pages</strong> → seleziona il Worker → tab <strong>Deployments</strong>: verifica che la versione corrente corrisponda alla <code>version</code> mostrata sopra (<code>{BRIDGE_WORKER_VERSION_DISPLAY}</code>).</li>
            <li>Tab <strong>Settings → Triggers / Routes</strong>: il route deve essere <code>{`<dominio>/*`}</code> e puntare a questo Worker.</li>
            <li>Dashboard → dominio → <strong>Caching → Configuration → Purge Everything</strong> (oppure Purge by URL su <code>{`/api/public/bridge/*`}</code>).</li>
            <li>Dashboard → dominio → <strong>Rules → Cache Rules</strong>: aggiungi una regola "Bypass cache" per <code>URI Path starts with /api/</code>.</li>
            <li>Ricarica con <strong>Aggiorna tutti</strong> e verifica che la <code>version</code> sia quella attesa.</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

const BRIDGE_WORKER_VERSION_DISPLAY = "2026-06-18.health-v2";

function StatusIcon({ r, loading }: { r?: HealthResult; loading?: boolean }) {
  if (loading) return <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />;
  if (!r) return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
  if (r.ok) return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  return <XCircle className="h-4 w-4 text-destructive" />;
}
