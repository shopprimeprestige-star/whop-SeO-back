import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ponteDeleteStore, ponteListStores, ponteTestShopify } from "@/server-fn/ponte.functions";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/format";
import { Plus, RefreshCw, Trash2, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/ponte-admin/stores")({ component: StoresList });

function StoresList() {
  const qc = useQueryClient();
  const bridgeUrl = typeof window !== "undefined" ? `${window.location.protocol}//${window.location.host}` : "";
  const { data: stores = [], isLoading } = useQuery({ queryKey: ["ponte", "stores"], queryFn: () => ponteListStores() });

  const test = useMutation({
    mutationFn: (id: string) => ponteTestShopify({ data: { id } }),
    onSuccess: (r) => toast.success(`Shopify OK — ${r.shop_name}`),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Errore"),
  });
  const del = useMutation({
    mutationFn: (id: string) => ponteDeleteStore({ data: { id } }),
    onSuccess: () => { toast.success("Store rimosso"); qc.invalidateQueries({ queryKey: ["ponte", "stores"] }); },
  });

  function badge(s: { last_handshake_at: string | null; last_error: string | null }) {
    if (s.last_error) return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Errore</span>;
    if (s.last_handshake_at) return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Connesso</span>;
    return <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">Mai connesso</span>;
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Stores</h1>
          <p className="mt-1 text-sm text-zinc-500">Store gestiti dal Sito Ponte.</p>
        </div>
        <Link to="/ponte-admin/new"><Button className="bg-zinc-900 text-white hover:bg-zinc-800"><Plus className="mr-2 h-4 w-4" /> Nuovo store</Button></Link>
      </div>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-5 py-3 font-medium">Bridge URL</th>
              <th className="px-5 py-3 font-medium">Site A store_id</th>
              <th className="px-5 py-3 font-medium">Stato</th>
              <th className="px-5 py-3 font-medium">Fatturato totale</th>
              <th className="px-5 py-3 font-medium">Ultimo sync</th>
              <th className="px-5 py-3 font-medium">Ultimo callback</th>
              <th className="px-5 py-3 text-right font-medium">Azioni</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {isLoading && <tr><td colSpan={7} className="px-5 py-6 text-center text-zinc-500">Caricamento…</td></tr>}
            {!isLoading && stores.length === 0 && <tr><td colSpan={7} className="px-5 py-10 text-center text-zinc-500">Nessuno store. Clicca "Nuovo store".</td></tr>}
            {stores.map((s) => (
              <tr key={s.id} className="hover:bg-zinc-50">
                <td className="px-5 py-3">
                  <div className="font-medium text-zinc-900">{bridgeUrl || s.shop_domain}</div>
                  <div className="text-xs text-zinc-500">{s.shop_domain}</div>
                </td>
                <td className="px-5 py-3 font-mono text-xs text-zinc-500">{s.site_a_store_id}</td>
                <td className="px-5 py-3">{badge(s)}</td>
                <td className="px-5 py-3">
                  <div className="font-medium text-zinc-900">{formatPrice(s.lifetime_revenue ?? 0, s.currency ?? "EUR")}</div>
                  <div className="text-xs text-zinc-500">Oggi {formatPrice(s.today_revenue ?? 0, s.currency ?? "EUR")} · {s.today_orders ?? 0} ordini oggi</div>
                </td>
                <td className="px-5 py-3 text-xs text-zinc-500">{s.last_sync_at ? new Date(s.last_sync_at).toLocaleString("it-IT") : "—"}</td>
                <td className="px-5 py-3 text-xs text-zinc-500">{s.last_callback_at ? new Date(s.last_callback_at).toLocaleString("it-IT") : "—"}</td>
                <td className="px-5 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => test.mutate(s.id)} disabled={test.isPending}>
                      <RefreshCw className="mr-2 h-3.5 w-3.5" /> Test
                    </Button>
                    <Link to="/ponte-admin/$id" params={{ id: s.id }}>
                      <Button size="sm" variant="outline"><ExternalLink className="h-3.5 w-3.5" /></Button>
                    </Link>
                    <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Eliminare ${s.shop_domain}?`)) del.mutate(s.id); }}>
                      <Trash2 className="h-3.5 w-3.5 text-red-500" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
