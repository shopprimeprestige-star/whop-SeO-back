import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  syncListProducts, syncGetSettings, syncSaveSettings,
  syncGenerateSecret, syncSetProductImage,
  syncPublishToStores, syncListPublications,
} from "@/server-fn/sync.functions";
import { ponteListWhopStores, ponteSetStoreSyncKey } from "@/server-fn/ponte.functions";
import { ArrowLeft, Copy, RefreshCw, Image as ImageIcon, ExternalLink, KeyRound, Send, CheckCircle2, Tag, X } from "lucide-react";

export const Route = createFileRoute("/ponte-admin/sync")({
  component: SyncAdmin,
  head: () => ({ meta: [{ title: "Sync Site A — Sito Ponte" }, { name: "robots", content: "noindex, nofollow" }] }),
});

type SyncedProduct = {
  id: string; prd_code: string; slug: string; title: string;
  price: number; currency: string; image_url: string | null;
  source_store_id: string | null; source_product_ref: string | null;
  source_synced_at: string | null;
  whop_plan_id: string | null; whop_product_id: string | null;
  whop_synced_at: string | null; whop_sync_error: string | null;
};

type Settings = {
  hmac_secret_preview: string | null;
  hmac_secret_full: string | null;
  allowed_source_origins: string[];
  default_synced_image_url: string | null;
  auto_publish_to_whop: boolean;
  default_whop_store_id: string | null;
};

type WhopStore = { id: string; display_name: string | null; shop_domain: string; sync_key: string | null };

function SyncAdmin() {
  const list = useServerFn(syncListProducts);
  const getSettings = useServerFn(syncGetSettings);
  const saveSettings = useServerFn(syncSaveSettings);
  const genSecret = useServerFn(syncGenerateSecret);
  const setImg = useServerFn(syncSetProductImage);
  const publish = useServerFn(syncPublishToStores);
  const listPubs = useServerFn(syncListPublications);
  const listStores = useServerFn(ponteListWhopStores);
  const setStoreKey = useServerFn(ponteSetStoreSyncKey);

  const [items, setItems] = useState<SyncedProduct[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [stores, setStores] = useState<WhopStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [origins, setOrigins] = useState("");
  const [defaultImg, setDefaultImg] = useState("");
  const [autoPublish, setAutoPublish] = useState(true);
  const [whopStoreId, setWhopStoreId] = useState<string>("");
  const [editingImage, setEditingImage] = useState<{ id: string; url: string } | null>(null);
  const [whopModal, setWhopModal] = useState<{ productId: string; prdCode: string } | null>(null);
  const [whopSelected, setWhopSelected] = useState<Set<string>>(new Set());
  const [whopBusy, setWhopBusy] = useState(false);
  const [whopPubs, setWhopPubs] = useState<Array<{ bridge_store_id: string; whop_plan_id: string | null; whop_checkout_url: string | null; last_error: string | null; last_synced_at: string | null }>>([]);

  async function load() {
    setLoading(true);
    try {
      const [products, s, st] = await Promise.all([list(), getSettings(), listStores().catch(() => [])]);
      setItems(products as SyncedProduct[]);
      setSettings(s);
      setStores(st as WhopStore[]);
      setOrigins((s.allowed_source_origins ?? []).join("\n"));
      setDefaultImg(s.default_synced_image_url ?? "");
      setAutoPublish(!!s.auto_publish_to_whop);
      setWhopStoreId(s.default_whop_store_id ?? "");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore caricamento");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function saveAll() {
    try {
      await saveSettings({ data: {
        allowed_source_origins: origins.split("\n").map((s) => s.trim()).filter(Boolean),
        default_synced_image_url: defaultImg.trim() || null,
        auto_publish_to_whop: autoPublish,
        default_whop_store_id: whopStoreId || null,
      }});
      toast.success("Impostazioni salvate");
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Errore"); }
  }

  async function generateNewSecret() {
    if (!confirm("Generare un nuovo HMAC secret? Il vecchio smetter\u00e0 di funzionare.")) return;
    try {
      const { secret } = await genSecret();
      await navigator.clipboard.writeText(secret).catch(() => {});
      toast.success("Nuovo HMAC secret generato e copiato negli appunti");
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Errore"); }
  }

  async function copySecret() {
    if (!settings?.hmac_secret_full) return;
    await navigator.clipboard.writeText(settings.hmac_secret_full);
    toast.success("Secret copiato");
  }

  async function saveImage() {
    if (!editingImage) return;
    try {
      await setImg({ data: { productId: editingImage.id, image_url: editingImage.url.trim() || null } });
      toast.success("Immagine salvata");
      setEditingImage(null);
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Errore"); }
  }

  async function openWhopModal(productId: string, prdCode: string) {
    setWhopModal({ productId, prdCode });
    setWhopSelected(new Set());
    setWhopPubs([]);
    try {
      const pubs = await listPubs({ data: { productId } });
      setWhopPubs(pubs);
      // Pre-seleziona gli store dove è già pubblicato con successo
      const pre = new Set<string>();
      for (const p of pubs) if (p.whop_plan_id) pre.add(p.bridge_store_id);
      setWhopSelected(pre);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore caricamento pubblicazioni");
    }
  }

  function toggleWhopStore(id: string) {
    setWhopSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAllWhop() {
    setWhopSelected(new Set(stores.map((s) => s.id)));
  }

  function clearWhopSelection() {
    setWhopSelected(new Set());
  }

  async function confirmWhopPublish(allStores = false) {
    if (!whopModal) return;
    if (!allStores && whopSelected.size === 0) {
      toast.error("Seleziona almeno uno store"); return;
    }
    setWhopBusy(true);
    try {
      const { results } = await publish({ data: {
        productId: whopModal.productId,
        storeIds: allStores ? [] : Array.from(whopSelected),
        allStores,
      }});
      const ok = results.filter((r) => r.ok).length;
      const ko = results.length - ok;
      if (ko === 0) toast.success(`Pubblicato su ${ok} store Whop`);
      else if (ok === 0) toast.error(`Errore su tutti gli store (${ko})`);
      else toast.warning(`Pubblicato su ${ok} store, ${ko} con errori`);
      setWhopModal(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore pubblicazione");
    } finally {
      setWhopBusy(false);
    }
  }

  async function saveStoreKey(storeId: string, key: string) {
    const trimmed = key.trim().toLowerCase();
    if (trimmed && !/^[a-z0-9][a-z0-9-_]*$/.test(trimmed)) {
      toast.error("Solo lettere, numeri, - e _ (min 2 caratteri)"); return;
    }
    try {
      await setStoreKey({ data: { storeId, sync_key: trimmed || null } });
      toast.success("Sync key salvata");
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Errore"); }
  }

  const endpoint = typeof window !== "undefined" ? `${window.location.origin}/api/public/sync-product` : "";

  return (
    <section className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Sync da Site A</h1>
          <p className="text-sm text-zinc-500">Prodotti ricevuti via webhook, mascherati come PRD-XXXXX, nascosti dai listing pubblici.</p>
        </div>
        <Link to="/ponte-admin" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900">
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </Link>
      </div>

      {/* Endpoint info */}
      <div className="rounded-lg border border-zinc-200 bg-white p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900">Endpoint webhook (per Site A)</h2>
          <Badge variant="outline" className="text-xs">POST</Badge>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded bg-zinc-100 px-3 py-2 text-xs text-zinc-800 break-all">{endpoint}</code>
          <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(endpoint); toast.success("Copiato"); }}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
        <p className="text-xs text-zinc-500">
          Site A deve inviare JSON con header <code className="bg-zinc-100 px-1">x-sync-signature</code> (HMAC-SHA256 hex del body) e <code className="bg-zinc-100 px-1">Origin</code> ammesso. Scarica il prompt completo per Site A dal pannello impostazioni del sito.
        </p>
      </div>

      {/* Settings */}
      <div className="rounded-lg border border-zinc-200 bg-white p-5 space-y-5">
        <h2 className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
          <KeyRound className="h-4 w-4" /> Configurazione sync
        </h2>

        <div className="space-y-2">
          <Label className="text-xs">HMAC secret</Label>
          <div className="flex items-center gap-2">
            <Input readOnly value={settings?.hmac_secret_full ?? "(non configurato)"} className="font-mono text-xs bg-zinc-50" />
            <Button size="sm" variant="outline" onClick={copySecret} disabled={!settings?.hmac_secret_full}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" onClick={generateNewSecret} className="bg-zinc-900 hover:bg-zinc-800">
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Genera nuovo
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Origini autorizzate (una per riga, lasciare vuoto = qualsiasi)</Label>
          <textarea
            value={origins} onChange={(e) => setOrigins(e.target.value)} rows={3}
            placeholder="https://sitea.it"
            className="w-full rounded border border-zinc-200 bg-white p-2 text-sm font-mono"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Immagine di default per prodotti sync (URL)</Label>
          <Input value={defaultImg} onChange={(e) => setDefaultImg(e.target.value)} placeholder="https://… (opzionale, lasciare vuoto = nessuna)" />
        </div>

        <div className="flex items-center justify-between rounded border border-zinc-100 p-3">
          <div>
            <Label className="text-sm">Pubblica automaticamente su Whop</Label>
            <p className="text-xs text-zinc-500">Quando un prodotto arriva da Site A, crea subito product+plan su Whop.</p>
          </div>
          <Switch checked={autoPublish} onCheckedChange={setAutoPublish} />
        </div>

        {stores.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs">Store Whop di default per la sync</Label>
            <select
              value={whopStoreId} onChange={(e) => setWhopStoreId(e.target.value)}
              className="w-full rounded border border-zinc-200 bg-white px-3 py-2 text-sm"
            >
              <option value="">— Primo store Whop attivo —</option>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.display_name || s.shop_domain}</option>)}
            </select>
          </div>
        )}

        <div className="flex justify-end">
          <Button onClick={saveAll} className="bg-zinc-900 hover:bg-zinc-800">Salva impostazioni</Button>
        </div>
      </div>

      {/* Sync keys per store Whop */}
      <div className="rounded-lg border border-zinc-200 bg-white">
        <div className="border-b border-zinc-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
            <Tag className="h-4 w-4" /> Sync key per store Whop
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Assegna un nome univoco a ciascun store Whop. Site A include <code className="bg-zinc-100 px-1">whop_store_key</code> nel payload per indirizzare il prodotto al Whop giusto.
          </p>
        </div>
        {stores.length === 0 ? (
          <div className="px-5 py-6 text-sm text-zinc-500">Nessuno store Whop configurato.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Store</th>
                <th className="px-4 py-3 text-left font-medium">Sync key</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {stores.map((s) => (
                <StoreSyncKeyRow key={s.id} store={s} onSave={saveStoreKey} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Lista prodotti sync */}
      <div className="rounded-lg border border-zinc-200 bg-white">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-zinc-900">Prodotti sincronizzati ({items.length})</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-zinc-500">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Foto</th>
              <th className="px-4 py-3 text-left font-medium">Codice</th>
              <th className="px-4 py-3 text-left font-medium">Sorgente</th>
              <th className="px-4 py-3 text-right font-medium">Prezzo</th>
              <th className="px-4 py-3 text-left font-medium">Whop</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-zinc-500">Caricamento…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-zinc-500">Nessun prodotto sincronizzato. Site A non ha ancora inviato nulla.</td></tr>
            ) : items.map((p) => (
              <tr key={p.id} className="border-t border-zinc-100 hover:bg-zinc-50/50">
                <td className="px-4 py-2">
                  {p.image_url ? (
                    <img src={p.image_url} alt="" className="h-12 w-12 rounded object-cover border border-zinc-200" />
                  ) : (
                    <div className="grid h-12 w-12 place-items-center rounded bg-zinc-100 text-zinc-400">
                      <ImageIcon className="h-5 w-5"/>
                    </div>
                  )}
                </td>
                <td className="px-4 py-2">
                  <div className="font-mono text-sm font-medium text-zinc-900">{p.prd_code}</div>
                  <Link to="/shop/prodotto/$slug" params={{ slug: p.slug }} className="text-xs text-zinc-500 hover:text-zinc-900 inline-flex items-center gap-0.5">
                    /shop/prodotto/{p.slug} <ExternalLink className="h-3 w-3" />
                  </Link>
                </td>
                <td className="px-4 py-2 text-xs text-zinc-600">
                  <div className="font-mono">{p.source_store_id ?? "—"}</div>
                  <div className="text-zinc-400">{p.source_product_ref ?? "—"}</div>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">€ {Number(p.price).toFixed(2)}</td>
                <td className="px-4 py-2">
                  {p.whop_plan_id
                    ? <Badge className="bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-50"><CheckCircle2 className="h-3 w-3 mr-1" />Sincronizzato</Badge>
                    : p.whop_sync_error
                      ? <Badge variant="outline" className="text-red-600 border-red-200" title={p.whop_sync_error}>Errore</Badge>
                      : <Badge variant="outline" className="text-zinc-500">—</Badge>}
                </td>
                <td className="px-4 py-2 text-right space-x-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditingImage({ id: p.id, url: p.image_url ?? "" })}>
                    <ImageIcon className="h-3.5 w-3.5 mr-1" /> Immagine
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openWhopModal(p.id, p.prd_code)}>
                    <Send className="h-3.5 w-3.5 mr-1" /> Invia su Whop
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modale immagine */}
      {editingImage && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setEditingImage(null)}>
          <div className="w-full max-w-md rounded-lg bg-white p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold">Imposta immagine prodotto</h3>
            <Input
              value={editingImage.url}
              onChange={(e) => setEditingImage({ ...editingImage, url: e.target.value })}
              placeholder="https://… (lascia vuoto per rimuovere)"
            />
            {editingImage.url && (
              <img src={editingImage.url} alt="" className="max-h-48 w-full rounded object-cover border border-zinc-200" />
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditingImage(null)}>Annulla</Button>
              <Button onClick={saveImage} className="bg-zinc-900 hover:bg-zinc-800">Salva</Button>
            </div>
          </div>
        </div>
      )}

      {/* Modale selezione store Whop */}
      {whopModal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => !whopBusy && setWhopModal(null)}>
          <div className="w-full max-w-lg rounded-lg bg-white p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900">Invia <span className="font-mono">{whopModal.prdCode}</span> su Whop</h3>
                <p className="text-xs text-zinc-500 mt-0.5">Seleziona uno o più store Whop a cui inviare il prodotto.</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setWhopModal(null)} disabled={whopBusy}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {stores.length === 0 ? (
              <div className="rounded border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
                Nessuno store Whop configurato. Aggiungi uno store con API key Whop dalla dashboard.
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500">{whopSelected.size} di {stores.length} selezionati</span>
                  <div className="space-x-2">
                    <button type="button" onClick={selectAllWhop} className="text-zinc-700 hover:text-zinc-900 underline">Seleziona tutti</button>
                    <button type="button" onClick={clearWhopSelection} className="text-zinc-500 hover:text-zinc-900 underline">Deseleziona</button>
                  </div>
                </div>

                <div className="max-h-72 overflow-y-auto rounded border border-zinc-200 divide-y divide-zinc-100">
                  {stores.map((s) => {
                    const pub = whopPubs.find((p) => p.bridge_store_id === s.id);
                    const checked = whopSelected.has(s.id);
                    return (
                      <label key={s.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleWhopStore(s.id)}
                          disabled={whopBusy}
                          className="h-4 w-4 rounded border-zinc-300"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-zinc-900 truncate">{s.display_name || s.shop_domain}</div>
                          <div className="text-xs text-zinc-500 truncate">{s.shop_domain}</div>
                        </div>
                        {pub?.whop_plan_id ? (
                          <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-50 text-[10px]">
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Già pubblicato
                          </Badge>
                        ) : pub?.last_error ? (
                          <Badge variant="outline" className="text-red-600 border-red-200 text-[10px]" title={pub.last_error}>Errore</Badge>
                        ) : null}
                      </label>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between gap-2 pt-2">
                  <Button variant="outline" size="sm" onClick={() => confirmWhopPublish(true)} disabled={whopBusy || stores.length === 0}>
                    Invia a tutti ({stores.length})
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => setWhopModal(null)} disabled={whopBusy}>Annulla</Button>
                    <Button onClick={() => confirmWhopPublish(false)} disabled={whopBusy || whopSelected.size === 0} className="bg-zinc-900 hover:bg-zinc-800">
                      {whopBusy ? "Invio…" : `Invia ai selezionati (${whopSelected.size})`}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function StoreSyncKeyRow({ store, onSave }: { store: WhopStore; onSave: (id: string, key: string) => void | Promise<void> }) {
  const [value, setValue] = useState(store.sync_key ?? "");
  const dirty = (value || "") !== (store.sync_key ?? "");
  return (
    <tr className="border-t border-zinc-100">
      <td className="px-4 py-2">
        <div className="font-medium text-zinc-900">{store.display_name || store.shop_domain}</div>
        <div className="text-xs text-zinc-500">{store.shop_domain}</div>
      </td>
      <td className="px-4 py-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="es. store-uomo"
          className="font-mono text-xs max-w-xs"
        />
      </td>
      <td className="px-4 py-2 text-right">
        <Button size="sm" disabled={!dirty} onClick={() => onSave(store.id, value)} className="bg-zinc-900 hover:bg-zinc-800">
          Salva
        </Button>
      </td>
    </tr>
  );
}

