import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildReferrerTestLink } from "@/server-fn/referrer.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/ponte-admin/wash-debug")({
  component: WashDebugPage,
  head: () => ({ meta: [{ title: "Wash Debug — Sito Ponte" }, { name: "robots", content: "noindex, nofollow" }] }),
});

interface PolicySnapshot {
  metaContent: string | null;
  linkRefPolicy: string | null;
  linkHasRel: boolean;
  documentReferrerPolicy: string;
  documentReferrer: string;
  innerDebugLog: string;
}

function WashDebugPage() {
  const [target, setTarget] = useState("https://example-store.myshopify.com/cart");
  const [washUrl, setWashUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<PolicySnapshot | null>(null);
  const [iframeKey, setIframeKey] = useState(0);

  const debugWashUrl = useMemo(() => {
    if (!washUrl) return null;
    const u = new URL(washUrl);
    u.searchParams.set("debug", "1");
    // noclick=1 evita che l'iframe navighi cross-origin durante l'ispezione.
    u.searchParams.set("noclick", "1");
    return u.toString();
  }, [washUrl]);

  async function generate() {
    setLoading(true);
    setSnapshot(null);
    try {
      const res = await buildReferrerTestLink({ data: { target } });
      setWashUrl(res.washUrl);
      setIframeKey((k) => k + 1);
      toast.success("Wash URL generato");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore generazione URL");
    } finally {
      setLoading(false);
    }
  }

  // Inspect del DOM dell'iframe per leggere la policy effettiva applicata.
  function inspectIframe(silent = false) {
    const iframe = document.getElementById("wash-iframe") as HTMLIFrameElement | null;
    const doc = iframe?.contentDocument;
    if (!doc) {
      if (!silent) toast.error("Impossibile accedere al DOM dell'iframe (cross-origin?)");
      return;
    }
    const meta = doc.querySelector('meta[name="referrer"]') as HTMLMetaElement | null;
    const link = doc.getElementById("bridge-link") as HTMLAnchorElement | null;
    const debugBox = doc.getElementById("debug") as HTMLDivElement | null;
    setSnapshot({
      metaContent: meta?.content ?? null,
      linkRefPolicy: link?.referrerPolicy ?? null,
      linkHasRel: !!link?.rel,
      documentReferrerPolicy: (doc as Document & { referrerPolicy?: string }).referrerPolicy ?? "(unset)",
      documentReferrer: doc.referrer || "(empty)",
      innerDebugLog: debugBox?.textContent?.trim() || "(no debug log)",
    });
  }

  useEffect(() => {
    if (!debugWashUrl) return;
    const iframe = document.getElementById("wash-iframe") as HTMLIFrameElement | null;
    if (!iframe) return;
    const onLoad = () => {
      // Più tentativi: il debug box si popola dopo i RAF interni.
      setTimeout(() => inspectIframe(true), 250);
      setTimeout(() => inspectIframe(true), 800);
      setTimeout(() => inspectIframe(true), 1600);
    };
    iframe.addEventListener("load", onLoad);
    return () => iframe.removeEventListener("load", onLoad);
  }, [debugWashUrl, iframeKey]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Wash Debug</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Diagnostica end-to-end del bridge <code>/wash</code>: genera un URL firmato,
          apri la pagina in un iframe e leggi quale Referrer-Policy effettiva è stata
          applicata al DOM (meta tag + attributo del link).
        </p>
      </div>

      <Card className="p-5 space-y-4">
        <div>
          <Label htmlFor="target">Target Shopify</Label>
          <Input
            id="target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="https://example-store.myshopify.com/cart"
            className="mt-1.5"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Solo host <code>*.myshopify.com</code> o <code>checkout.*</code> sono accettati.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={generate} disabled={loading || !target}>
            {loading ? "Generazione…" : "Genera Wash URL firmato"}
          </Button>
          {washUrl && (
            <Button variant="outline" onClick={() => navigator.clipboard.writeText(washUrl)}>
              Copia URL
            </Button>
          )}
        </div>
        {debugWashUrl && (
          <div className="rounded border bg-muted/40 p-3 text-xs font-mono break-all">
            {debugWashUrl}
          </div>
        )}
      </Card>

      {debugWashUrl && (
        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Snapshot DOM <code>/wash</code></h2>
            <Button variant="outline" size="sm" onClick={() => inspectIframe(false)}>
              Re-ispeziona
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            L'iframe carica <code>/wash?debug=1&amp;noclick=1</code>: la modalità noclick
            disabilita la navigazione automatica così possiamo ispezionare il DOM finale
            senza che l'iframe parta verso Shopify (cross-origin).
          </p>

          <iframe
            id="wash-iframe"
            key={iframeKey}
            src={debugWashUrl}
            sandbox="allow-scripts allow-same-origin"
            className="h-[420px] w-full rounded border"
            title="wash debug"
          />

          {snapshot && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <Field label="meta[name=referrer]" value={snapshot.metaContent} />
                <Field label="link.referrerPolicy" value={snapshot.linkRefPolicy} />
                <Field label="document.referrerPolicy" value={snapshot.documentReferrerPolicy} />
                <Field label="link.rel presente" value={snapshot.linkHasRel ? "sì" : "no"} />
                <Field label="document.referrer (iframe)" value={snapshot.documentReferrer} />
              </div>
              <div className="rounded border bg-muted/40 p-3">
                <div className="text-xs font-medium text-muted-foreground mb-1">
                  Debug log interno /wash (boot, timing, history)
                </div>
                <pre className="font-mono text-xs whitespace-pre-wrap break-all max-h-48 overflow-auto">
                  {snapshot.innerDebugLog}
                </pre>
              </div>
            </>
          )}

          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Cosa controlla questo strumento?</summary>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              <li><b>exp/rid</b>: il backend rifiuta link scaduti, senza rid o riusati.</li>
              <li><b>Anti-replay</b>: ogni rid è single-use (tabella <code>bridge_wash_nonces</code>).</li>
              <li><b>Guard server</b>: il route handler blocca runtime ogni fetch verso Shopify lato server.</li>
              <li><b>Click sicuro</b>: programmatic click su <code>&lt;a&gt;</code> con <code>referrerpolicy</code> esplicita, dopo 2 RAF + 100ms.</li>
              <li><b>Fallback</b>: se il click viene bloccato (anti-bot), retry o pulsante "Continua allo store".</li>
            </ul>
          </details>
        </Card>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded border bg-card p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-sm break-all">{value ?? <span className="text-muted-foreground">(null)</span>}</div>
    </div>
  );
}
