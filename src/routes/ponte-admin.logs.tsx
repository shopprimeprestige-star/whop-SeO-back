import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ponteClearLogs, ponteListLogs, ponteListStores } from "@/server-fn/ponte.functions";
import { getRuntimeSupabaseClient } from "@/lib/runtime-supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/ponte-admin/logs")({ component: LogsPage });

interface LogRow {
  id: string;
  store_id: string | null;
  direction: string;
  endpoint: string | null;
  http_status: number | null;
  success: boolean;
  error: string | null;
  payload?: unknown;
  created_at: string;
}

function dayStartIso(value: string) {
  return value ? new Date(`${value}T00:00:00.000Z`).toISOString() : undefined;
}

function dayEndIso(value: string) {
  return value ? new Date(`${value}T23:59:59.999Z`).toISOString() : undefined;
}

function LogsPage() {
  const qc = useQueryClient();
  const [storeId, setStoreId] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const filters = useMemo(
    () => ({
      storeId: storeId || undefined,
      dateFrom: dayStartIso(dateFrom),
      dateTo: dayEndIso(dateTo),
    }),
    [storeId, dateFrom, dateTo]
  );

  const { data: stores = [] } = useQuery({
    queryKey: ["ponte", "stores"],
    queryFn: () => ponteListStores(),
  });

  const { data: rows = [] } = useQuery({
    queryKey: ["ponte", "logs", filters],
    queryFn: () => ponteListLogs({ data: filters }),
  });

  useEffect(() => {
    let cancelled = false;
    let remove: (() => void) | undefined;
    getRuntimeSupabaseClient().then((supabase) => {
      if (cancelled) return;
      const ch = supabase
        .channel("bridge_logs_live")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "bridge_logs" }, () => {
          qc.invalidateQueries({ queryKey: ["ponte", "logs"] });
        })
        .subscribe();
      remove = () => { supabase.removeChannel(ch); };
    });
    return () => {
      cancelled = true;
      remove?.();
    };
  }, [qc]);

  const clearAll = useMutation({
    mutationFn: () => ponteClearLogs({ data: { storeId: storeId || undefined } }),
    onSuccess: (r) => {
      toast.success(`Eliminati ${r.deleted} log`);
      qc.invalidateQueries({ queryKey: ["ponte", "logs"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Errore"),
  });

  const storeMap = new Map(stores.map((s) => [s.id, s.display_name || s.shop_domain]));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-zinc-900">Log realtime</h1>
          <p className="mt-1 text-sm text-zinc-500">Webhook Shopify, callback verso Sito A e traffico bridge con dettaglio completo.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
          disabled={clearAll.isPending || rows.length === 0}
          onClick={() => {
            if (confirm(storeId ? "Eliminare i log dello store selezionato?" : "Eliminare TUTTI i log? Questa azione è irreversibile.")) {
              clearAll.mutate();
            }
          }}
        >
          <Trash2 className="mr-2 h-3.5 w-3.5" />
          {clearAll.isPending ? "Elimino…" : storeId ? "Elimina log store" : "Elimina tutti i log"}
        </Button>
      </div>

      <div className="grid gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm md:grid-cols-[1.4fr_1fr_1fr_auto]">
        <label className="space-y-1 text-sm">
          <span className="text-zinc-600">Store</span>
          <select
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            className="flex h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none"
          >
            <option value="">Tutti gli store</option>
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.display_name || store.shop_domain}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-zinc-600">Dal</span>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-zinc-600">Al</span>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
        <div className="flex items-end">
          <Button variant="outline" onClick={() => { setStoreId(""); setDateFrom(""); setDateTo(""); }}>
            Reset
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">Quando</th>
              <th className="px-4 py-3 font-medium">Store</th>
              <th className="px-4 py-3 font-medium">Direzione</th>
              <th className="px-4 py-3 font-medium">Endpoint</th>
              <th className="px-4 py-3 font-medium">HTTP</th>
              <th className="px-4 py-3 font-medium">Esito</th>
              <th className="px-4 py-3 font-medium">Dettaglio</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 text-xs">
            {rows.map((r) => (
              <tr key={r.id} className="align-top hover:bg-zinc-50">
                <td className="px-4 py-3 text-zinc-500">{new Date(r.created_at).toLocaleString("it-IT")}</td>
                <td className="px-4 py-3 text-zinc-700">{r.store_id ? storeMap.get(r.store_id) ?? r.store_id : "—"}</td>
                <td className="px-4 py-3 font-medium text-zinc-700">{r.direction}</td>
                <td className="px-4 py-3 text-zinc-700">{r.endpoint}</td>
                <td className="px-4 py-3 text-zinc-600">{r.http_status ?? "—"}</td>
                <td className="px-4 py-3">{r.success ? <span className="text-emerald-600">ok</span> : <span className="text-red-600">fail</span>}</td>
                <td className="px-4 py-3">
                  <details className="group max-w-[460px]">
                    <summary className="cursor-pointer list-none text-zinc-600 underline-offset-2 group-open:text-zinc-900 group-open:underline">
                      Apri
                    </summary>
                    <div className="mt-2 space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                      {r.error ? <div className="text-red-600">{r.error}</div> : null}
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-zinc-700">
                        {JSON.stringify(r.payload ?? {}, null, 2)}
                      </pre>
                    </div>
                  </details>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">Nessun log trovato per i filtri selezionati.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
