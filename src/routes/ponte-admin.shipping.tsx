import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ponteListShipping, ponteUpsertShipping, ponteDeleteShipping } from "@/server-fn/ponte.functions";

export const Route = createFileRoute("/ponte-admin/shipping")({
  component: ShippingAdminPage,
  head: () => ({ meta: [{ title: "Spedizioni — Sito Ponte" }, { name: "robots", content: "noindex, nofollow" }] }),
});

type Method = {
  id: string;
  label: string;
  description: string | null;
  price: number;
  delivery_estimate: string | null;
  free_over: number | null;
  sort_order: number;
  is_active: boolean;
};

type FormState = {
  id?: string;
  label: string;
  description: string;
  price: string;
  delivery_estimate: string;
  free_over: string;
  sort_order: string;
  is_active: boolean;
};

const empty: FormState = { label: "", description: "", price: "0", delivery_estimate: "", free_over: "", sort_order: "0", is_active: true };

function ShippingAdminPage() {
  const qc = useQueryClient();

  const { data: methods = [], isLoading } = useQuery({ queryKey: ["ponte", "shipping"], queryFn: () => ponteListShipping() });
  const [form, setForm] = useState<FormState>(empty);
  const editing = !!form.id;

  const save = useMutation({
    mutationFn: () =>
      ponteUpsertShipping({
        data: {
          id: form.id,
          label: form.label.trim(),
          description: form.description.trim() || null,
          price: Number(form.price) || 0,
          delivery_estimate: form.delivery_estimate.trim() || null,
          free_over: form.free_over.trim() === "" ? null : Number(form.free_over),
          sort_order: Number(form.sort_order) || 0,
          is_active: form.is_active,
        },
      }),
    onSuccess: () => {
      toast.success(editing ? "Metodo aggiornato" : "Metodo creato");
      setForm(empty);
      qc.invalidateQueries({ queryKey: ["ponte", "shipping"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => ponteDeleteShipping({ data: { id } }),
    onSuccess: () => {
      toast.success("Metodo eliminato");
      qc.invalidateQueries({ queryKey: ["ponte", "shipping"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const startEdit = (m: Method) =>
    setForm({
      id: m.id,
      label: m.label,
      description: m.description ?? "",
      price: String(m.price),
      delivery_estimate: m.delivery_estimate ?? "",
      free_over: m.free_over == null ? "" : String(m.free_over),
      sort_order: String(m.sort_order),
      is_active: m.is_active,
    });

  const inputCls = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Spedizioni</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Metodi di spedizione mostrati nel checkout nativo di Sito B. I prezzi sono in <strong>EUR</strong> (base) e vengono convertiti automaticamente nella valuta del cliente.
        </p>
      </div>

      {/* Form */}
      <div className="rounded-lg border border-border p-5">
        <div className="mb-3 text-sm font-semibold">{editing ? "Modifica metodo" : "Nuovo metodo"}</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Nome *</label>
            <input className={inputCls} placeholder="Spedizione standard" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Tempi di consegna</label>
            <input className={inputCls} placeholder="3-5 giorni" value={form.delivery_estimate} onChange={(e) => setForm({ ...form, delivery_estimate: e.target.value })} />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Descrizione</label>
            <input className={inputCls} placeholder="Corriere tracciato" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Prezzo €</label>
              <input className={inputCls} type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Gratis sopra €</label>
              <input className={inputCls} type="number" step="0.01" placeholder="—" value={form.free_over} onChange={(e) => setForm({ ...form, free_over: e.target.value })} />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Ordine</label>
              <input className={inputCls} type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} />
            </div>
          </div>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="h-4 w-4" />
          Attivo (mostrato nel checkout)
        </label>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={save.isPending || !form.label.trim()}
            onClick={() => save.mutate()}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
          >
            {save.isPending ? "Salvataggio…" : editing ? "Aggiorna" : "Crea metodo"}
          </button>
          {editing && (
            <button type="button" onClick={() => setForm(empty)} className="rounded-md border border-border px-4 py-2 text-sm">Annulla</button>
          )}
        </div>
      </div>

      {/* Lista */}
      <div className="rounded-lg border border-border">
        <div className="grid grid-cols-[1.6fr_1fr_0.8fr_0.8fr_0.6fr_auto] gap-2 border-b border-border px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">
          <span>Nome</span><span>Tempi</span><span>Prezzo</span><span>Gratis sopra</span><span>Stato</span><span className="text-right">Azioni</span>
        </div>
        {isLoading ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">Caricamento…</div>
        ) : (methods as Method[]).length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">Nessun metodo. Creane uno sopra.</div>
        ) : (
          (methods as Method[]).map((m) => (
            <div key={m.id} className="grid grid-cols-[1.6fr_1fr_0.8fr_0.8fr_0.6fr_auto] items-center gap-2 border-b border-border px-4 py-3 text-sm last:border-0">
              <div>
                <div className="font-medium">{m.label}</div>
                {m.description && <div className="text-xs text-muted-foreground">{m.description}</div>}
              </div>
              <div className="text-muted-foreground">{m.delivery_estimate || "—"}</div>
              <div>{m.price === 0 ? "Gratis" : `€ ${Number(m.price).toFixed(2)}`}</div>
              <div className="text-muted-foreground">{m.free_over == null ? "—" : `€ ${Number(m.free_over).toFixed(2)}`}</div>
              <div>{m.is_active ? <span className="text-emerald-600">Attivo</span> : <span className="text-muted-foreground">Off</span>}</div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => startEdit(m)} className="rounded border border-border px-2.5 py-1 text-xs">Modifica</button>
                <button type="button" onClick={() => { if (confirm(`Eliminare "${m.label}"?`)) remove.mutate(m.id); }} className="rounded border border-destructive/40 px-2.5 py-1 text-xs text-destructive">Elimina</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
