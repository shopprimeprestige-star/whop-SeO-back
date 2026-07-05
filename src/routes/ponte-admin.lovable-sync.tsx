import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Copy, KeyRound, RefreshCw, Send, Trash2 } from "lucide-react";
import {
  lovableSyncGetConfig,
  lovableSyncSaveConfig,
  lovableSyncListProducts,
  lovableSyncDeleteProduct,
  lovableSyncDeleteAll,
} from "@/server-fn/lovable-sync.functions";

export const Route = createFileRoute("/ponte-admin/lovable-sync")({
  component: LovableSyncAdmin,
  head: () => ({ meta: [{ title: "Lovable Sync — Sito Ponte" }, { name: "robots", content: "noindex, nofollow" }] }),
});

type Product = {
  id: string; source?: string; store_ref: string; external_id: string; title: string; slug: string | null;
  price: number | null; compare_price: number | null; currency: string | null; locale: string | null;
  status: string; received_at: string; updated_at: string;
};

function LovableSyncAdmin() {
  const getConfig = useServerFn(lovableSyncGetConfig);
  const saveConfig = useServerFn(lovableSyncSaveConfig);
  const list = useServerFn(lovableSyncListProducts);
  const deleteProduct = useServerFn(lovableSyncDeleteProduct);
  const deleteAll = useServerFn(lovableSyncDeleteAll);

  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [hmac, setHmac] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<Product[]>([]);
  const [testing, setTesting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [cfg, products] = await Promise.all([getConfig(), list()]);
      setEnabled(cfg.enabled);
      setApiKey(cfg.api_key ?? "");
      setHmac(cfg.hmac_secret ?? "");
      setNotes(cfg.notes ?? "");
      setItems(products as Product[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore caricamento");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function save() {
    try {
      await saveConfig({ data: {
        api_key: apiKey.trim() || null,
        hmac_secret: hmac.trim() || null,
        enabled,
        notes: notes.trim() || null,
      }});
      toast.success("Configurazione salvata");
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Errore"); }
  }

  function generate(prefix: "lvs_" | "hmac_") {
    const rnd = (crypto.randomUUID() + crypto.randomUUID()).replaceAll("-", "");
    const val = `${prefix}${rnd.slice(0, 40)}`;
    if (prefix === "lvs_") setApiKey(val); else setHmac(val);
  }

  function copy(value: string, label: string) {
    if (!value) return;
    navigator.clipboard.writeText(value).then(() => toast.success(`${label} copiato`));
  }

  async function testPing() {
    if (!apiKey) { toast.error("Inserisci l'API key prima di testare"); return; }
    setTesting(true);
    try {
      const body = "{}";
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Lovable-Sync-Key": apiKey,
      };
      if (hmac) {
        const enc = new TextEncoder();
        const key = await crypto.subtle.importKey("raw", enc.encode(hmac), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
        const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
        headers["X-Lovable-Sync-Signature"] = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
      }
      const r = await fetch("/api/public/lovable-sync/ping", { method: "POST", headers, body });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.pong) toast.success("Ping OK ✓");
      else toast.error(`Ping fallito: ${j.error ?? r.status}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore ping");
    } finally { setTesting(false); }
  }

  async function handleDelete(p: Product) {
    if (!confirm(`Eliminare "${p.title}"?`)) return;
    try {
      await deleteProduct({ data: { source: (p.source === "bridge" ? "bridge" : "lovable-sync"), id: p.id } });
      setItems((prev) => prev.filter((x) => x.id !== p.id));
      toast.success("Prodotto eliminato");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Errore eliminazione"); }
  }

  async function handleDeleteAll() {
    if (!confirm(`Eliminare TUTTI i ${items.length} prodotti ricevuti? L'azione è irreversibile.`)) return;
    try {
      await deleteAll({ data: { source: "all" } });
      setItems([]);
      toast.success("Tutti i prodotti eliminati");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Errore eliminazione"); }
  }

  const pingEndpoint = typeof window !== "undefined" ? `${window.location.origin}/api/public/lovable-sync/ping` : "";
  const pushEndpoint = typeof window !== "undefined" ? `${window.location.origin}/api/public/lovable-sync/push-product` : "";

  return (
    <section className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Lovable Sync — ricezione prodotti</h1>
          <p className="text-sm text-zinc-500">Configura API key e HMAC secret per ricevere prodotti via webhook dal Sito A.</p>
        </div>
        <Link to="/ponte-admin" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900">
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </Link>
      </div>

      {/* Endpoints */}
      <div className="rounded-lg border border-zinc-200 bg-white p-5 space-y-3">
        <h2 className="text-sm font-semibold text-zinc-900">Endpoint (incolla in Sito A)</h2>
        <div>
          <Label className="text-xs">URL app Lovable (base)</Label>
          <div className="flex items-center gap-2 mt-1">
            <code className="flex-1 rounded bg-zinc-100 px-3 py-2 text-xs text-zinc-800 break-all">{typeof window !== "undefined" ? window.location.origin : ""}</code>
            <Button size="sm" variant="outline" onClick={() => copy(window.location.origin, "URL")}><Copy className="h-3.5 w-3.5"/></Button>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Ping</Label>
            <code className="block rounded bg-zinc-100 px-3 py-2 text-xs text-zinc-800 break-all">POST {pingEndpoint}</code>
          </div>
          <div>
            <Label className="text-xs">Push prodotto</Label>
            <code className="block rounded bg-zinc-100 px-3 py-2 text-xs text-zinc-800 break-all">POST {pushEndpoint}</code>
          </div>
        </div>
        <p className="text-xs text-zinc-500">
          Header richiesti: <code className="bg-zinc-100 px-1">X-Lovable-Sync-Key</code> (API key) e — se HMAC valorizzato — <code className="bg-zinc-100 px-1">X-Lovable-Sync-Signature</code> (sha256 hex del body, opz. con prefisso <code>sha256=</code>).
        </p>
      </div>

      {/* Config */}
      <div className="rounded-lg border border-zinc-200 bg-white p-5 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 flex items-center gap-2"><KeyRound className="h-4 w-4"/> Credenziali sync</h2>
          <div className="flex items-center gap-2">
            <Label className="text-xs">Abilitato</Label>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">API Key (X-Lovable-Sync-Key) — DEVE combaciare con quella in Sito A</Label>
          <div className="flex items-center gap-2">
            <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="lvs_..." className="font-mono text-xs"/>
            <Button size="sm" variant="outline" onClick={() => copy(apiKey, "API key")}><Copy className="h-3.5 w-3.5"/></Button>
            <Button size="sm" variant="outline" onClick={() => generate("lvs_")}><RefreshCw className="h-3.5 w-3.5 mr-1"/>genera</Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">HMAC Secret (opzionale) — DEVE combaciare con quello in Sito A se attivo</Label>
          <div className="flex items-center gap-2">
            <Input value={hmac} onChange={(e) => setHmac(e.target.value)} placeholder="hmac_..." className="font-mono text-xs"/>
            <Button size="sm" variant="outline" onClick={() => copy(hmac, "HMAC")}><Copy className="h-3.5 w-3.5"/></Button>
            <Button size="sm" variant="outline" onClick={() => generate("hmac_")}><RefreshCw className="h-3.5 w-3.5 mr-1"/>genera</Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Note (opzionali)</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="es. Store Uomo — sync da sitea.it" />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={testPing} disabled={testing || !apiKey}>
            <Send className="h-3.5 w-3.5 mr-1.5"/> {testing ? "Ping…" : "Test ping"}
          </Button>
          <Button onClick={save} className="bg-zinc-900 hover:bg-zinc-800">Salva</Button>
        </div>
      </div>

      {/* Lista prodotti */}
      <div className="rounded-lg border border-zinc-200 bg-white">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-zinc-900">Prodotti ricevuti ({items.length})</h2>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={load}><RefreshCw className="h-3.5 w-3.5 mr-1.5"/>Aggiorna</Button>
            {items.length > 0 && (
              <Button size="sm" variant="outline" onClick={handleDeleteAll} className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200">
                <Trash2 className="h-3.5 w-3.5 mr-1.5"/>Elimina tutti
              </Button>
            )}
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-zinc-500">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Titolo</th>
              <th className="px-4 py-3 text-left font-medium">Origine</th>
              <th className="px-4 py-3 text-left font-medium">Store ref</th>
              <th className="px-4 py-3 text-left font-medium">External ID</th>
              <th className="px-4 py-3 text-right font-medium">Prezzo</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Ricevuto</th>
              <th className="px-4 py-3 text-right font-medium">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-zinc-500">Caricamento…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-zinc-500">Nessun prodotto ricevuto. Configura API key e HMAC, salva, poi invia da Sito A.</td></tr>
            ) : items.map((p) => (
              <tr key={`${p.source ?? "lovable-sync"}-${p.id}`} className="border-t border-zinc-100 hover:bg-zinc-50/50">
                <td className="px-4 py-2">
                  <div className="font-medium text-zinc-900">{p.title}</div>
                  {p.slug && <div className="text-xs text-zinc-500">/{p.slug}</div>}
                </td>
                <td className="px-4 py-2"><Badge variant="outline">{p.source === "bridge" ? "Bridge" : "Lovable Sync"}</Badge></td>
                <td className="px-4 py-2 font-mono text-xs text-zinc-600">{p.store_ref}</td>
                <td className="px-4 py-2 font-mono text-xs text-zinc-600">{p.external_id}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {p.price != null ? `${(p.currency ?? "EUR")} ${Number(p.price).toFixed(2)}` : "—"}
                </td>
                <td className="px-4 py-2">
                  <Badge variant={p.status === "active" ? "default" : "outline"} className={p.status === "active" ? "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-50" : ""}>{p.status}</Badge>
                </td>
                <td className="px-4 py-2 text-xs text-zinc-500">{new Date(p.received_at).toLocaleString("it-IT")}</td>
                <td className="px-4 py-2 text-right">
                  <Button size="sm" variant="ghost" onClick={() => handleDelete(p)} className="text-red-600 hover:text-red-700 hover:bg-red-50">
                    <Trash2 className="h-3.5 w-3.5"/>
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
