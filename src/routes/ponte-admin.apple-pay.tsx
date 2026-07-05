import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ponteListApplePayStores, ponteSetApplePay } from "@/server-fn/ponte.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, Apple, Upload, X, CheckCircle2, AlertTriangle, ExternalLink, Copy } from "lucide-react";

export const Route = createFileRoute("/ponte-admin/apple-pay")({
  component: ApplePayPage,
  head: () => ({ meta: [{ title: "Apple Pay (Whop) — Sito Ponte" }, { name: "robots", content: "noindex, nofollow" }] }),
});

type Store = { id: string; display_name: string | null; shop_domain: string; custom_domains: string[] | null; apple_pay_verification: string | null };

function ApplePayPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState<string>("");
  const [content, setContent] = useState<string>("");
  const [domain, setDomain] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const rows = await ponteListApplePayStores();
      setStores(rows as Store[]);
      if (rows.length && !storeId) selectStore(rows[0] as Store);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore caricamento");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  function selectStore(s: Store) {
    setStoreId(s.id);
    setContent(s.apple_pay_verification ?? "");
    setDomain((s.custom_domains?.[0] ?? "").replace(/^https?:\/\//, ""));
  }

  const current = useMemo(() => stores.find((s) => s.id === storeId) || null, [stores, storeId]);
  const wellKnownPath = "/.well-known/apple-developer-merchantid-domain-association";
  const cleanDomain = domain.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const fullUrl = cleanDomain ? `https://${cleanDomain}${wellKnownPath}` : `https://<dominio-store>${wellKnownPath}`;
  const hasContent = content.trim().length > 0;

  async function save() {
    if (!storeId) { toast.error("Seleziona uno store"); return; }
    setSaving(true);
    try {
      await ponteSetApplePay({ data: { id: storeId, content: content.trim() || null, public_domain: cleanDomain || null } });
      toast.success("Apple Pay salvato per questo store. Ora aggiungi il dominio su Whop.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Salvataggio fallito");
    } finally {
      setSaving(false);
    }
  }

  async function onFile(file: File) {
    try {
      const text = (await file.text()).trim();
      if (!text) { toast.error("File vuoto"); return; }
      setContent(text);
      toast.success("File letto. Clicca 'Salva' per attivarlo su questo store.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Lettura file fallita");
    }
  }

  if (loading) return <div className="text-zinc-500">Caricamento…</div>;

  return (
    <section className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-zinc-900">
            <Apple className="h-6 w-6" /> Apple / Google Pay (Whop)
          </h1>
          <p className="text-sm text-zinc-500">Verifica il dominio di pagamento per ogni store, per abilitare Apple Pay e Google Pay sul checkout Whop.</p>
        </div>
        <Link to="/ponte-admin" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900">
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </Link>
      </div>

      {stores.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-500">Nessuno store. Aggiungi prima uno store.</div>
      ) : (
      <>
        {/* Store selector */}
        <div className="rounded-lg border border-zinc-200 bg-white p-5">
          <Label className="text-xs font-medium uppercase tracking-wider text-zinc-500">Store</Label>
          <select
            className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
            value={storeId}
            onChange={(e) => { const s = stores.find((x) => x.id === e.target.value); if (s) selectStore(s); }}
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.display_name || s.shop_domain}{s.apple_pay_verification ? " · ✓ configurato" : " · — da configurare"}
              </option>
            ))}
          </select>
        </div>

        {/* Stato */}
        <div className={`flex items-start gap-3 rounded-lg border p-4 ${hasContent ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
          {hasContent ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" /> : <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />}
          <div className="text-sm">
            {hasContent
              ? <><div className="font-medium text-emerald-900">File pubblicato per questo store</div><div className="text-emerald-800">Servito sul dominio impostato qui sotto.</div></>
              : <><div className="font-medium text-amber-900">Nessun file per questo store</div><div className="text-amber-800">Whop non potrà verificare il dominio finché non lo carichi.</div></>}
          </div>
        </div>

        {/* Dominio pubblico */}
        <div className="rounded-lg border border-zinc-200 bg-white p-5 space-y-2">
          <Label className="text-xs font-medium uppercase tracking-wider text-zinc-500">Dominio pubblico dello store</Label>
          <Input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="es. oclak.store"
            className="border-zinc-200 font-mono text-sm"
          />
          <p className="text-xs text-zinc-500">Il dominio su cui questo store fa checkout. Serve a servire il file Apple Pay corretto su quel dominio.</p>
        </div>

        {/* Istruzioni */}
        <div className="rounded-lg border border-zinc-200 bg-white p-5 space-y-3">
          <h3 className="text-sm font-medium text-zinc-700">Come fare</h3>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-zinc-700">
            <li>Su <strong>Whop dashboard → Settings → Checkout → Payment domains</strong> aggiungi il dominio <code className="rounded bg-zinc-100 px-1 text-xs">{cleanDomain || "tuo-dominio"}</code> e scarica il file <code className="rounded bg-zinc-100 px-1 text-xs">apple-developer-merchantid-domain-association</code>.</li>
            <li>Carica il file qui sotto (o incolla il contenuto) e imposta il dominio sopra.</li>
            <li>Clicca <strong>Salva</strong>, poi su Whop completa la verifica. Google Pay si attiva da solo.</li>
          </ol>
        </div>

        {/* Upload + textarea */}
        <div className="rounded-lg border border-zinc-200 bg-white p-5 space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium uppercase tracking-wider text-zinc-500">Contenuto del file</Label>
            <div className="flex items-center gap-2">
              <input type="file" className="hidden" id="apple-pay-file" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); (e.target as HTMLInputElement).value = ""; }} />
              <Button type="button" variant="outline" size="sm" onClick={() => document.getElementById("apple-pay-file")?.click()} className="border-zinc-200">
                <Upload className="mr-1.5 h-3.5 w-3.5" /> Carica file
              </Button>
              {hasContent && <Button type="button" variant="ghost" size="sm" onClick={() => setContent("")} className="text-zinc-500"><X className="mr-1 h-3.5 w-3.5" /> Svuota</Button>}
            </div>
          </div>
          <Textarea rows={10} value={content} onChange={(e) => setContent(e.target.value)} placeholder="7B2276657273696F6E223A312C2270737049..." className="border-zinc-200 bg-white font-mono text-xs" />
          <div className="flex items-center justify-end">
            <Button onClick={save} disabled={saving} className="bg-zinc-900 text-white hover:bg-zinc-800">{saving ? "Salvataggio…" : "Salva"}</Button>
          </div>
        </div>

        {/* URL pubblico */}
        <div className="rounded-lg border border-zinc-200 bg-white p-5 space-y-3">
          <h3 className="text-sm font-medium text-zinc-700">URL pubblico del file (per questo store)</h3>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto whitespace-nowrap rounded bg-zinc-100 px-3 py-2 text-xs text-zinc-800">{fullUrl}</code>
            <Button type="button" variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(fullUrl); toast.success("URL copiato"); }} className="border-zinc-200"><Copy className="h-3.5 w-3.5" /></Button>
            {cleanDomain && (
              <a href={fullUrl} target="_blank" rel="noreferrer"><Button type="button" variant="outline" size="sm" className="border-zinc-200"><ExternalLink className="h-3.5 w-3.5" /></Button></a>
            )}
          </div>
          <p className="text-xs text-zinc-500">Apri il link per verificare che il file venga servito su quel dominio prima di cliccare "Aggiungi" su Whop.</p>
        </div>
      </>
      )}
    </section>
  );
}
