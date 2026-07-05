import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getRuntimeSupabaseClient } from "@/lib/runtime-supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Trash2, Upload, X, ImageIcon, ArrowLeft, Search, CheckSquare, Square, Send, Check as CheckIcon } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { ponteListWhopStores, ponteSyncProductsToWhop } from "@/server-fn/ponte.functions";

export const Route = createFileRoute("/ponte-admin/prodotti")({
  component: ProductsAdmin,
  head: () => ({ meta: [{ title: "Prodotti — Sito Ponte" }, { name: "robots", content: "noindex, nofollow" }] }),
});

interface Category { id: string; name: string; slug: string }
interface Product {
  id: string;
  slug: string;
  prd_code: string;
  title: string;
  brand: string;
  description: string | null;
  price: number;
  compare_at_price: number | null;
  currency: string;
  image_url: string | null;
  gallery: string[];
  category_id: string | null;
  published: boolean;
  featured: boolean;
  tags: string[];
  material: string | null;
  sort_order: number;
  whop_plan_id: string | null;
  whop_product_id: string | null;
  whop_synced_at: string | null;
  whop_sync_error: string | null;
  source_store_id?: string | null;
}

interface WhopStore { id: string; display_name: string | null; shop_domain: string; custom_domains?: string[] | null; checkout_provider: string }

// Dominio reale dello store (custom domain), non il placeholder native-*.
function whopStoreDomain(s: WhopStore): string {
  const d = (s.custom_domains ?? []).find(Boolean);
  return d || s.display_name || s.shop_domain || s.id;
}


const empty: Product = {
  id: "",
  slug: "",
  prd_code: "",
  title: "",
  brand: "Atelier Nord",
  description: "",
  price: 0,
  compare_at_price: null,
  currency: "EUR",
  image_url: null,
  gallery: [],
  category_id: null,
  published: true,
  featured: false,
  tags: [],
  material: null,
  sort_order: 0,
  whop_plan_id: null,
  whop_product_id: null,
  whop_synced_at: null,
  whop_sync_error: null,
};

function ProductsAdmin() {
  const [items, setItems] = useState<Product[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"catalogo" | "ricevuti">("catalogo");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Product | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [whopStores, setWhopStores] = useState<WhopStore[]>([]);
  const [selectedWhop, setSelectedWhop] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);

  const listWhopStores = useServerFn(ponteListWhopStores);
  const syncToWhop = useServerFn(ponteSyncProductsToWhop);

  async function load() {
    setLoading(true);
    const supabase = await getRuntimeSupabaseClient();
    const [{ data: p }, { data: c }] = await Promise.all([
      supabase.from("shop_products").select("*").order("sort_order", { ascending: true }).order("created_at", { ascending: false }),
      supabase.from("shop_categories").select("id, name, slug").order("name"),
    ]);
    setItems(((p ?? []) as unknown as Product[]).map((x) => ({ ...x, gallery: Array.isArray(x.gallery) ? x.gallery : [] })));
    setCats((c ?? []) as Category[]);
    setSelected(new Set());
    setLoading(false);
  }
  useEffect(() => {
    load();
    listWhopStores().then((stores) => {
      setWhopStores(stores);
      setSelectedWhop((prev) => prev.size ? prev : new Set(stores.map((s) => s.id))); // default: tutti
    }).catch(() => { /* ignore */ });
  }, []);

  function toggleWhop(id: string) {
    setSelectedWhop((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function bulkSyncWhop() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const targets = whopStores.filter((s) => selectedWhop.has(s.id));
    if (targets.length === 0) { toast.error("Seleziona almeno un account Whop"); return; }
    setSyncing(true);
    try {
      let okStores = 0, totOk = 0, totAll = 0; const errs: string[] = [];
      // Invio a tutti gli account Whop selezionati, in sequenza.
      for (const st of targets) {
        const res = await syncToWhop({ data: { storeId: st.id, productIds: ids } });
        totOk += res.synced; totAll += res.total;
        if (res.synced === res.total) okStores++;
        else {
          const firstErr = res.results.find((r) => !r.ok);
          errs.push(`${whopStoreDomain(st)}: ${firstErr ? firstErr.error : "errori"}`);
        }
      }
      if (errs.length === 0) toast.success(`Inviato a ${okStores}/${targets.length} account Whop (${totOk}/${totAll})`);
      else toast.error(`Whop: ${okStores}/${targets.length} ok. ${errs[0]}`, { duration: 10000 });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync Whop fallita");
    } finally {
      setSyncing(false);
    }
  }


  const receivedCount = useMemo(() => items.filter((p) => !!p.source_store_id).length, [items]);
  const filtered = useMemo(() => {
    const byTab = items.filter((p) => (tab === "ricevuti" ? !!p.source_store_id : !p.source_store_id));
    const t = q.trim().toLowerCase();
    if (!t) return byTab;
    return byTab.filter((p) =>
      p.title.toLowerCase().includes(t) ||
      p.slug.toLowerCase().includes(t) ||
      (p.prd_code || "").toLowerCase().includes(t)
    );
  }, [items, q, tab]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.id));
  function toggleAll() {
    if (allFilteredSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map((p) => p.id)));
  }
  function toggleOne(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  async function remove(id: string, title: string) {
    if (!confirm(`Eliminare definitivamente "${title}"?`)) return;
    const supabase = await getRuntimeSupabaseClient();
    await supabase.from("shop_variants").delete().eq("product_id", id);
    const { error } = await supabase.from("shop_products").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Prodotto eliminato");
    load();
  }

  async function bulkRemove() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`Eliminare definitivamente ${ids.length} prodotti? L'azione è irreversibile.`)) return;
    const supabase = await getRuntimeSupabaseClient();
    await supabase.from("shop_variants").delete().in("product_id", ids);
    const { error } = await supabase.from("shop_products").delete().in("id", ids);
    if (error) { toast.error(error.message); return; }
    toast.success(`${ids.length} prodotti eliminati`);
    load();
  }

  if (editing) {
    return (
      <ProductEditor
        initial={editing}
        cats={cats}
        onCancel={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); }}
      />
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Prodotti</h1>
          <p className="text-sm text-zinc-500">Gestisci catalogo, foto, prezzi e descrizioni.</p>
        </div>
        <Button onClick={() => setEditing({ ...empty })} className="bg-zinc-900 hover:bg-zinc-800">
          <Plus className="mr-2 h-4 w-4" /> Nuovo prodotto
        </Button>
      </div>

      <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-1">
        {([
          { key: "catalogo", label: "Catalogo" },
          { key: "ricevuti", label: `Prodotti ricevuti${receivedCount ? ` (${receivedCount})` : ""}` },
        ] as const).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => { setTab(t.key); setSelected(new Set()); }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${tab === t.key ? "bg-zinc-900 text-white" : "text-zinc-600 hover:text-zinc-900"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-md flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input placeholder="Cerca per titolo, slug o codice…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9 bg-white border-zinc-200" />
        </div>
        {whopStores.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-xs text-zinc-500 whitespace-nowrap">Account Whop:</Label>
            {whopStores.map((s) => {
              const on = selectedWhop.has(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleWhop(s.id)}
                  title={whopStoreDomain(s)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${on ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300"}`}
                >
                  <span className={`h-2 w-2 rounded-full ${on ? "bg-indigo-600" : "bg-zinc-300"}`} />
                  {whopStoreDomain(s)}
                </button>
              );
            })}
          </div>
        )}
        {selected.size > 0 && (
          <div className="flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm">
            <span className="text-zinc-700">{selected.size} selezionati</span>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())} className="text-zinc-500">Annulla</Button>
            {whopStores.length > 0 && (
              <Button size="sm" onClick={bulkSyncWhop} disabled={syncing || selectedWhop.size === 0} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                <Send className="mr-1.5 h-4 w-4" /> {syncing ? "Invio in corso…" : `Invia a Whop (${selectedWhop.size})`}
              </Button>
            )}
            <Button size="sm" onClick={bulkRemove} className="bg-red-600 hover:bg-red-700 text-white">
              <Trash2 className="mr-1.5 h-4 w-4" /> Elimina
            </Button>
          </div>
        )}
        {whopStores.length === 0 && (
          <p className="text-xs text-zinc-500">
            Nessuno store Whop attivo. <Link to="/ponte-admin/new" className="underline">Aggiungine uno</Link> con API key Whop per abilitare la sincronizzazione automatica.
          </p>
        )}
      </div>


      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-zinc-500">
            <tr>
              <th className="px-3 py-3 text-left font-medium w-10">
                <button type="button" onClick={toggleAll} className="text-zinc-500 hover:text-zinc-900">
                  {allFilteredSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                </button>
              </th>
              <th className="px-4 py-3 text-left font-medium">Foto</th>
              <th className="px-4 py-3 text-left font-medium">Titolo</th>
              <th className="px-4 py-3 text-left font-medium">Codice</th>
              <th className="px-4 py-3 text-right font-medium">Prezzo</th>
              <th className="px-4 py-3 text-left font-medium">Stato</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-zinc-500">Caricamento…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-zinc-500">Nessun prodotto.</td></tr>
            ) : filtered.map((p) => (
              <tr key={p.id} className={`border-t border-zinc-100 hover:bg-zinc-50/50 ${selected.has(p.id) ? "bg-zinc-50" : ""}`}>
                <td className="px-3 py-2">
                  <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggleOne(p.id)} aria-label={`Seleziona ${p.title}`} />
                </td>
                <td className="px-4 py-2">
                  {p.image_url ? (
                    <img src={p.image_url} alt="" className="h-12 w-12 rounded object-cover border border-zinc-200" />
                  ) : (
                    <div className="grid h-12 w-12 place-items-center rounded bg-zinc-100 text-zinc-400"><ImageIcon className="h-5 w-5"/></div>
                  )}
                </td>
                <td className="px-4 py-2">
                  <div className="font-medium text-zinc-900">{p.title}</div>
                  <div className="text-xs text-zinc-500">{p.slug}</div>
                </td>
                <td className="px-4 py-2 font-mono text-xs text-zinc-600">{p.prd_code}</td>
                <td className="px-4 py-2 text-right tabular-nums">€ {Number(p.price).toFixed(2)}</td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {p.published
                      ? <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-50">Pubblicato</Badge>
                      : <Badge variant="outline" className="text-zinc-500">Bozza</Badge>}
                    {p.whop_plan_id
                      ? <Badge className="bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-50"><CheckIcon className="h-3 w-3 mr-1" />Whop</Badge>
                      : p.whop_sync_error
                        ? <Badge variant="outline" className="text-red-600 border-red-200" title={p.whop_sync_error}>Whop: errore</Badge>
                        : null}
                  </div>
                </td>

                <td className="px-4 py-2 text-right">
                  <Button variant="ghost" size="sm" onClick={() => setEditing({ ...p })} className="text-zinc-700">Modifica</Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(p.id, p.title)} className="text-red-600 hover:text-red-700 hover:bg-red-50">
                    <Trash2 className="h-4 w-4" />
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

function slugify(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}
function randPrd() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "PRD-";
  for (let i = 0; i < 8; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

function ProductEditor({ initial, cats, onSaved, onCancel }: {
  initial: Product; cats: Category[]; onSaved: () => void; onCancel: () => void;
}) {
  const [p, setP] = useState<Product>({ ...initial, gallery: initial.gallery ?? [] });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const isNew = !initial.id;

  function patch<K extends keyof Product>(k: K, v: Product[K]) {
    setP((x) => ({ ...x, [k]: v }));
  }

  async function uploadFile(file: File) {
    setUploading(true);
    try {
      const supabase = await getRuntimeSupabaseClient();
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from("product-images").upload(path, file, {
        cacheControl: "31536000", contentType: file.type, upsert: false,
      });
      if (error) throw error;
      const { data } = supabase.storage.from("product-images").getPublicUrl(path);
      addImage(data.publicUrl);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload fallito");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function addImage(url: string) {
    if (!url) return;
    setP((x) => {
      const gallery = x.gallery.includes(url) ? x.gallery : [...x.gallery, url];
      return { ...x, gallery, image_url: x.image_url ?? url };
    });
  }
  function removeImage(url: string) {
    setP((x) => {
      const gallery = x.gallery.filter((u) => u !== url);
      const image_url = x.image_url === url ? (gallery[0] ?? null) : x.image_url;
      return { ...x, gallery, image_url };
    });
  }
  function setCover(url: string) { patch("image_url", url); }

  async function save() {
    if (!p.title.trim()) { toast.error("Titolo obbligatorio"); return; }
    if (!(Number(p.price) >= 0)) { toast.error("Prezzo non valido"); return; }
    setSaving(true);
    const slug = p.slug?.trim() || slugify(p.title);
    const prd_code = p.prd_code?.trim() || randPrd();
    const payload = {
      slug, prd_code, title: p.title.trim(), brand: p.brand?.trim() || "Atelier Nord",
      description: p.description, price: Number(p.price),
      compare_at_price: p.compare_at_price === null || p.compare_at_price === undefined || Number(p.compare_at_price) <= 0 ? null : Number(p.compare_at_price),
      currency: p.currency || "EUR",
      image_url: p.image_url, gallery: p.gallery as unknown as never,
      category_id: p.category_id, published: p.published, featured: p.featured,
      tags: p.tags, material: p.material, sort_order: Number(p.sort_order) || 0,
    };
    const supabase = await getRuntimeSupabaseClient();
    const { error } = isNew
      ? await supabase.from("shop_products").insert(payload as never)
      : await supabase.from("shop_products").update(payload as never).eq("id", p.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(isNew ? "Prodotto creato" : "Modifiche salvate");
    onSaved();
  }

  return (
    <section className="space-y-6">
      <div className="sticky top-0 z-10 -mx-4 flex items-center justify-between gap-3 border-b border-zinc-200 bg-background/95 px-4 py-3 backdrop-blur lg:-mx-8 lg:px-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{isNew ? "Nuovo prodotto" : p.title || "Modifica prodotto"}</h1>
          <p className="hidden text-sm text-zinc-500 sm:block">{isNew ? "Aggiungi un articolo al catalogo." : "Aggiorna foto, prezzo e dettagli."}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onCancel} className="text-zinc-600">Annulla</Button>
          <Button onClick={save} disabled={saving} className="bg-zinc-900 hover:bg-zinc-800">{saving ? "Salvataggio…" : "Salva"}</Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Colonna principale */}
        <div className="space-y-6">
          <div className="rounded-lg border border-zinc-200 bg-white p-5 space-y-4">
            <div>
              <Label className="text-zinc-700">Titolo</Label>
              <Input value={p.title} onChange={(e) => patch("title", e.target.value)} className="bg-white border-zinc-200" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label className="text-zinc-700">Slug URL</Label>
                <Input value={p.slug} onChange={(e) => patch("slug", e.target.value)} placeholder="auto da titolo" className="bg-white border-zinc-200 font-mono text-xs" />
              </div>
              <div>
                <Label className="text-zinc-700">Codice PRD</Label>
                <Input value={p.prd_code} onChange={(e) => patch("prd_code", e.target.value.toUpperCase())} placeholder="auto" className="bg-white border-zinc-200 font-mono text-xs" />
              </div>
            </div>
            <div>
              <Label className="text-zinc-700">Descrizione</Label>
              <Textarea rows={6} value={p.description ?? ""} onChange={(e) => patch("description", e.target.value)} className="bg-white border-zinc-200" />
            </div>
          </div>

          {/* Foto */}
          <div className="rounded-lg border border-zinc-200 bg-white p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-zinc-900">Foto prodotto</h3>
                <p className="text-xs text-zinc-500">La prima è la copertina. Click su una foto per impostarla come copertina.</p>
              </div>
              <div className="flex items-center gap-2">
                <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
                  onChange={(e) => { const fs = e.target.files; if (fs) Array.from(fs).forEach(uploadFile); }} />
                <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading} className="border-zinc-200">
                  <Upload className="mr-2 h-4 w-4" /> {uploading ? "Caricamento…" : "Carica file"}
                </Button>
              </div>
            </div>
            <div className="flex gap-2">
              <Input placeholder="…oppure incolla URL immagine" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} className="bg-white border-zinc-200" />
              <Button type="button" variant="outline" onClick={() => { addImage(urlInput.trim()); setUrlInput(""); }} className="border-zinc-200">Aggiungi</Button>
            </div>
            {p.gallery.length === 0 ? (
              <div className="grid place-items-center h-40 rounded border border-dashed border-zinc-200 text-zinc-400 text-sm">Nessuna foto</div>
            ) : (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {p.gallery.map((u) => (
                  <div key={u} className={`group relative aspect-square overflow-hidden rounded border ${p.image_url === u ? "border-zinc-900 ring-2 ring-zinc-900/10" : "border-zinc-200"}`}>
                    <img src={u} alt="" className="h-full w-full object-cover cursor-pointer" onClick={() => setCover(u)} />
                    {p.image_url === u && <span className="absolute left-1 top-1 rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-white">Copertina</span>}
                    <button type="button" onClick={() => removeImage(u)}
                      className="absolute right-1 top-1 rounded bg-white/90 p-1 text-zinc-700 opacity-0 transition group-hover:opacity-100 hover:bg-white">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className="rounded-lg border border-zinc-200 bg-white p-5 space-y-4">
            <h3 className="font-medium text-zinc-900">Stato</h3>
            <div className="flex items-center justify-between">
              <Label className="text-zinc-700">Pubblicato</Label>
              <Switch checked={p.published} onCheckedChange={(v) => patch("published", v)} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-zinc-700">In evidenza</Label>
              <Switch checked={p.featured} onCheckedChange={(v) => patch("featured", v)} />
            </div>
            <div>
              <Label className="text-zinc-700">Ordinamento</Label>
              <Input type="number" value={p.sort_order} onChange={(e) => patch("sort_order", Number(e.target.value))} className="bg-white border-zinc-200" />
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-5 space-y-4">
            <h3 className="font-medium text-zinc-900">Prezzo</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-zinc-700">Prezzo</Label>
                <Input type="number" step="0.01" value={p.price} onChange={(e) => patch("price", Number(e.target.value))} className="bg-white border-zinc-200" />
              </div>
              <div>
                <Label className="text-zinc-700">Compare at</Label>
                <Input type="number" step="0.01" value={p.compare_at_price ?? ""} onChange={(e) => patch("compare_at_price", e.target.value === "" ? null : Number(e.target.value))} className="bg-white border-zinc-200" />
              </div>
            </div>
            <div>
              <Label className="text-zinc-700">Valuta</Label>
              <Input value={p.currency} onChange={(e) => patch("currency", e.target.value.toUpperCase())} className="bg-white border-zinc-200" />
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-5 space-y-4">
            <h3 className="font-medium text-zinc-900">Organizzazione</h3>
            <div>
              <Label className="text-zinc-700">Categoria</Label>
              <select value={p.category_id ?? ""} onChange={(e) => patch("category_id", e.target.value || null)}
                className="w-full rounded border border-zinc-200 bg-white px-3 py-2 text-sm">
                <option value="">— nessuna —</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-zinc-700">Brand</Label>
              <Input value={p.brand} onChange={(e) => patch("brand", e.target.value)} className="bg-white border-zinc-200" />
            </div>
            <div>
              <Label className="text-zinc-700">Materiale</Label>
              <Input value={p.material ?? ""} onChange={(e) => patch("material", e.target.value || null)} className="bg-white border-zinc-200" />
            </div>
            <div>
              <Label className="text-zinc-700">Tag (separati da virgola)</Label>
              <Input
                value={(p.tags ?? []).join(", ")}
                onChange={(e) => patch("tags", e.target.value.split(",").map((t) => t.trim()).filter(Boolean))}
                className="bg-white border-zinc-200"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
