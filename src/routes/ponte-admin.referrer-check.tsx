import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { buildReferrerTestLink } from "@/server-fn/referrer.functions";

export const Route = createFileRoute("/ponte-admin/referrer-check")({
  component: ReferrerCheck,
  head: () => ({ meta: [{ title: "Referrer Check — Ponte Admin" }] }),
});

type Probe = {
  id: string;
  store_id: string | null;
  referer: string | null;
  user_agent: string | null;
  target_host: string | null;
  source: string;
  created_at: string;
};

function classifyReferer(ref: string | null, expectedOrigin?: string): { ok: boolean; label: string; tone: "default" | "destructive" } {
  if (!ref || ref === "None" || ref === "null") return { ok: false, label: "VUOTO / None", tone: "destructive" };
  try {
    const url = new URL(ref);
    if (expectedOrigin && url.origin !== expectedOrigin) {
      return { ok: false, label: `origine errata: ${url.hostname}`, tone: "destructive" };
    }
    return { ok: true, label: url.hostname, tone: "default" };
  } catch {
    return { ok: false, label: "non valido", tone: "destructive" };
  }
}

function validateTargetInput(value: string): string | null {
  const raw = value.trim();
  if (!raw) return "Inserisci il link Shopify reale da testare";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return "Il link deve usare HTTPS";
    if (!/\.myshopify\.com$/i.test(url.hostname) && !/^checkout\./i.test(url.hostname)) {
      return "Inserisci un dominio Shopify valido";
    }
    return null;
  } catch {
    return "Inserisci un URL valido";
  }
}

function ReferrerCheck() {
  const [items, setItems] = useState<Probe[]>([]);
  const [loading, setLoading] = useState(false);
  const [target, setTarget] = useState("");
  const [targetError, setTargetError] = useState<string | null>(null);
  const [washUrl, setWashUrl] = useState("");
  const [building, setBuilding] = useState(false);
  const buildLink = useServerFn(buildReferrerTestLink);
  const expectedOrigin = typeof window !== "undefined" ? window.location.origin : undefined;

  async function refresh() {
    setLoading(true);
    try {
      const r = await fetch("/api/public/bridge/referrer-probe?limit=30", { cache: "no-store" });
      const j = await r.json();
      if (j.ok) setItems(j.items);
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextError = validateTargetInput(target);
    setTargetError(nextError);
    if (nextError) return;

    setBuilding(true);
    try {
      const result = await buildLink({ data: { target } });
      setWashUrl(result.washUrl);
    } catch (error) {
      setTargetError(error instanceof Error ? error.message : "Impossibile generare il link di test");
    } finally {
      setBuilding(false);
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 8000);
    return () => clearInterval(id);
  }, []);

  const lastOk = useMemo(() => items.find((p) => classifyReferer(p.referer, expectedOrigin).ok), [items, expectedOrigin]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Referrer Check</h1>
          <p className="text-sm text-muted-foreground">
            Verifica che il checkout verso Shopify parta con il dominio reale di Sito B come origine del Referer.
          </p>
        </div>
        <Button onClick={refresh} variant="outline" size="sm" disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Aggiorna
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stato</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {lastOk ? (
            <div className="flex items-center gap-2">
              <Badge>OK</Badge>
              <span>
                Ultimo Referer coerente con Sito B: <code className="rounded bg-muted px-1 py-0.5">{classifyReferer(lastOk.referer, expectedOrigin).label}</code>
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Badge variant="destructive">Referer mancante o non coerente</Badge>
              <span className="text-muted-foreground">Genera il link verso lo store reale e aprilo da browser.</span>
            </div>
          )}
          {expectedOrigin ? (
            <p className="text-xs text-muted-foreground">
              Origin attesa di Sito B: <code>{expectedOrigin}</code>
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Target Shopify reale</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <form onSubmit={handleGenerateLink} className="space-y-3">
            <div className="space-y-2">
              <label htmlFor="shopify-target" className="text-sm font-medium">URL store/cart o checkout</label>
              <Input
                id="shopify-target"
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder="https://nome-store.myshopify.com/cart"
                value={target}
                onChange={(event) => {
                  setTarget(event.target.value);
                  if (targetError) setTargetError(validateTargetInput(event.target.value));
                }}
              />
              <p className="text-xs text-muted-foreground">
                Inserisci il link Shopify reale del negozio attuale. Il link di test verrà firmato lato server.
              </p>
              {targetError ? <p className="text-xs text-destructive">{targetError}</p> : null}
            </div>
            <Button type="submit" size="sm" disabled={building}>
              {building ? "Generazione..." : "Genera link di test"}
            </Button>
          </form>

          <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Il link passa da una pagina bridge same-origin minimale che esegue un submit nativo verso Shopify per preservare un referrer naturale di Sito B.
          </p>
            <code className="block break-all rounded bg-muted px-2 py-1 text-xs">{washUrl || "Genera prima un link valido"}</code>
            {washUrl ? (
              <a href={washUrl}>
                <Button size="sm" variant="outline">
                  <ExternalLink className="mr-1 h-3 w-3" />Apri test reale
                </Button>
              </a>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ultimi probe ({items.length})</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {items.length === 0 ? (
            <p className="text-muted-foreground">Nessun probe ricevuto ancora.</p>
          ) : (
            <div className="space-y-2">
              {items.map((probe) => {
                const classified = classifyReferer(probe.referer, expectedOrigin);
                return (
                  <div key={probe.id} className="flex items-start gap-3 rounded-md border p-3">
                    <Badge variant={classified.tone === "destructive" ? "destructive" : "default"}>{classified.label}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-muted-foreground">
                        {new Date(probe.created_at).toLocaleString("it-IT")} — target: <code>{probe.target_host ?? "—"}</code>
                      </div>
                      <div className="break-all text-xs">
                        <span className="text-muted-foreground">Referer:</span> <code>{probe.referer ?? "(vuoto)"}</code>
                      </div>
                      <div className="truncate text-[10px] text-muted-foreground">{probe.user_agent}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        ← <Link to="/ponte-admin">Torna agli stores</Link>
      </p>
    </div>
  );
}
