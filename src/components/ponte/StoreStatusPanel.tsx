import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ponteClearLogs, ponteListLogs, ponteSaveSecrets, ponteSendTestPayload, ponteTestCallback, ponteTestShopify } from "@/server-fn/ponte.functions";
import { formatPrice } from "@/lib/format";
import { CheckCircle2, ChevronDown, ChevronRight, KeyRound, Lock, RefreshCw, Save, Send, Sparkles, Trash2, Wifi, WifiOff, XCircle } from "lucide-react";
import { toast } from "sonner";

interface StoreSummary {
  id: string;
  shop_domain: string;
  callback_url?: string | null;
  is_active?: boolean;
  last_handshake_at?: string | null;
  last_callback_at?: string | null;
  last_sync_at?: string | null;
  last_error?: string | null;
  shopify_oauth_connected?: boolean;
  lifetime_revenue?: number;
  today_revenue?: number;
  orders_count?: number;
  today_orders?: number;
  currency?: string | null;
}

function fmt(d?: string | null) {
  return d ? new Date(d).toLocaleString("it-IT") : "—";
}

function fmtPrice(value: number, currency: string) {
  return formatPrice(value, currency);
}

export default function StoreStatusPanel({ store }: { store: StoreSummary }) {
  const qc = useQueryClient();
  const logs = useQuery({
    queryKey: ["ponte", "logs", store.id],
    queryFn: () => ponteListLogs({ data: { storeId: store.id } }),
    refetchInterval: 5000,
  });

  const testShopify = useMutation({
    mutationFn: () => ponteTestShopify({ data: { id: store.id } }),
    onSuccess: (r) => { toast.success(`Shopify OK — ${r.shop_name} (${r.currency})`); qc.invalidateQueries({ queryKey: ["ponte"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Errore"),
  });
  const testCallback = useMutation({
    mutationFn: () => ponteTestCallback({ data: { id: store.id } }),
    onSuccess: (r) => { r.ok ? toast.success(`Sito A OK (${r.status})`) : toast.error(`Sito A fallito: ${r.response ?? r.status}`); qc.invalidateQueries({ queryKey: ["ponte"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Errore"),
  });
  const sendStats = useMutation({
    mutationFn: () => ponteSendTestPayload({ data: { id: store.id, type: "stats_update" } }),
    onSuccess: (r) => { r.ok ? toast.success(`Stats inviato (${r.status})`) : toast.error(`Invio fallito: ${r.response ?? r.status}`); qc.invalidateQueries({ queryKey: ["ponte"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Errore"),
  });
  const sendOrder = useMutation({
    mutationFn: () => ponteSendTestPayload({ data: { id: store.id, type: "order_paid" } }),
    onSuccess: (r) => { r.ok ? toast.success(`order_paid inviato (${r.status})`) : toast.error(`Invio fallito: ${r.response ?? r.status}`); qc.invalidateQueries({ queryKey: ["ponte"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Errore"),
  });
  const resetLogs = useMutation({
    mutationFn: () => ponteClearLogs({ data: { storeId: store.id } }),
    onSuccess: (r) => {
      toast.success(`Eliminati ${r.deleted} log`);
      qc.invalidateQueries({ queryKey: ["ponte", "logs", store.id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Errore"),
  });

  const [logsOpen, setLogsOpen] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const saveSecrets = useMutation({
    mutationFn: (vars: { webhook_secret?: string | null; access_token?: string | null }) =>
      ponteSaveSecrets({ data: { id: store.id, ...vars } }),
    onSuccess: (r) => {
      toast.success(`Salvati ${r.updated} secret${r.updated === 1 ? "" : "s"}`);
      setWebhookSecret("");
      setAccessToken("");
      qc.invalidateQueries({ queryKey: ["ponte"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Errore"),
  });

  // Pre-fill secrets ricevuti dal popup OAuth
  const [pendingFromOauth, setPendingFromOauth] = useState<{ access_token?: string; webhook_secret?: string } | null>(null);
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      if (ev.data?.type === "shopify-oauth-done" && (ev.data.access_token || ev.data.webhook_secret)) {
        setPendingFromOauth({ access_token: ev.data.access_token, webhook_secret: ev.data.webhook_secret });
        if (ev.data.access_token) setAccessToken(ev.data.access_token);
        if (ev.data.webhook_secret) setWebhookSecret(ev.data.webhook_secret);
        toast.success("Secret ricevuti dall'OAuth");
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const shopifyOnline = !!store.shopify_oauth_connected && !store.last_error;
  const siteAReachable = !!store.last_callback_at && !logs.data?.find((l) => l.direction === "outbound" && !l.success && new Date(l.created_at) >= new Date(store.last_callback_at!));

  return (
    <div className="space-y-6">
      {/* === STATO === */}
      <section className="grid gap-3 md:grid-cols-2">
        <StatusCard
          title="Fatturato totale"
          online={(store.lifetime_revenue ?? 0) > 0}
          subtitle={`${fmtPrice(store.lifetime_revenue ?? 0, store.currency ?? "EUR")} · ${store.orders_count ?? 0} ordini`}
          last={`Oggi: ${fmtPrice(store.today_revenue ?? 0, store.currency ?? "EUR")} · ${store.today_orders ?? 0} ordini`}
        />
        <StatusCard
          title="Shopify"
          online={shopifyOnline}
          subtitle={store.shopify_oauth_connected ? `Token OAuth presente` : "OAuth non ancora completato"}
          last={`Ultimo handshake: ${fmt(store.last_handshake_at)}`}
          error={store.last_error ?? undefined}
        />
        <StatusCard
          title="Sito A (callback)"
          online={siteAReachable}
          subtitle={store.callback_url ? store.callback_url : "callback_url non impostato"}
          last={`Ultimo callback: ${fmt(store.last_callback_at)}`}
        />
      </section>

      {/* === AZIONI TEST === */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-zinc-900">Test connessioni</h2>
        <p className="mt-1 text-xs text-zinc-500">Verifica Shopify e Sito A. Ogni azione viene tracciata nei log qui sotto.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => testShopify.mutate()} disabled={testShopify.isPending}>
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${testShopify.isPending ? "animate-spin" : ""}`} /> Testa Shopify
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => testCallback.mutate()} disabled={testCallback.isPending || !store.callback_url}>
            <Wifi className="mr-2 h-3.5 w-3.5" /> Testa Sito A
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => sendStats.mutate()} disabled={sendStats.isPending || !store.callback_url}>
            <Send className="mr-2 h-3.5 w-3.5" /> Invia stats
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => sendOrder.mutate()} disabled={sendOrder.isPending || !store.callback_url}>
            <Send className="mr-2 h-3.5 w-3.5" /> Invia ordine test
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
            disabled={resetLogs.isPending || !logs.data || logs.data.length === 0}
            onClick={() => {
              if (confirm(`Eliminare TUTTI i log di questo store (${logs.data?.length ?? 0})?`)) resetLogs.mutate();
            }}
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" /> Reset log
          </Button>
        </div>

        {pendingFromOauth && (pendingFromOauth.access_token || pendingFromOauth.webhook_secret) && (
          <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="text-xs text-emerald-800">
              <Sparkles className="mr-1.5 inline h-3.5 w-3.5" />
              Token e HMAC ricevuti dall'OAuth Shopify.
            </div>
            <Button
              type="button"
              size="sm"
              disabled={saveSecrets.isPending}
              onClick={() => {
                saveSecrets.mutate({
                  access_token: pendingFromOauth.access_token ?? null,
                  webhook_secret: pendingFromOauth.webhook_secret ?? null,
                });
                setPendingFromOauth(null);
              }}
            >
              <Save className="mr-1.5 h-3.5 w-3.5" /> Salva
            </Button>
          </div>
        )}

        <div className="mt-5 grid gap-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4 md:grid-cols-2">
          <div>
            <Label className="flex items-center gap-1.5 text-xs font-medium text-zinc-700">
              <Lock className="h-3.5 w-3.5" /> Webhook signing secret (HMAC)
            </Label>
            <div className="mt-1.5 flex gap-2">
              <Input
                type="password"
                placeholder="shpss_••••••••"
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
                className="font-mono text-xs"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!webhookSecret || saveSecrets.isPending}
                onClick={() => saveSecrets.mutate({ webhook_secret: webhookSecret })}
              >
                <Save className="mr-1.5 h-3.5 w-3.5" /> Salva
              </Button>
            </div>
          </div>
          <div>
            <Label className="flex items-center gap-1.5 text-xs font-medium text-zinc-700">
              <KeyRound className="h-3.5 w-3.5" /> Access token Shopify
            </Label>
            <div className="mt-1.5 flex gap-2">
              <Input
                type="password"
                placeholder="shpat_••••••••"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                className="font-mono text-xs"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!accessToken || saveSecrets.isPending}
                onClick={() => saveSecrets.mutate({ access_token: accessToken })}
              >
                <Save className="mr-1.5 h-3.5 w-3.5" /> Salva
              </Button>
            </div>
            <p className="mt-1 text-[11px] text-zinc-500">Incolla qui il token <code>shpat_...</code> della Custom App.</p>
          </div>
        </div>
      </section>

      {/* === LOGS === */}
      <Collapsible open={logsOpen} onOpenChange={setLogsOpen} className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <div className="flex items-center justify-between p-6">
          <CollapsibleTrigger className="flex items-center gap-2 text-left">
            {logsOpen ? <ChevronDown className="h-4 w-4 text-zinc-400" /> : <ChevronRight className="h-4 w-4 text-zinc-400" />}
            <h2 className="text-base font-semibold text-zinc-900">Log eventi</h2>
            <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 ring-1 ring-zinc-200">{logs.data?.length ?? 0}</span>
          </CollapsibleTrigger>
          <Button type="button" variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); logs.refetch(); }} className="text-zinc-500 hover:text-zinc-900">
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${logs.isFetching ? "animate-spin" : ""}`} /> Aggiorna
          </Button>
        </div>
        <CollapsibleContent>
          <div className="px-6 pb-6">
            <div className="max-h-[480px] overflow-auto rounded-lg border border-zinc-200">
              {!logs.data || logs.data.length === 0 ? (
                <div className="p-6 text-center text-xs text-zinc-500">Nessun log per questo store.</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-zinc-50 text-zinc-500">
                    <tr className="border-b border-zinc-200">
                      <th className="px-3 py-2 text-left">Quando</th>
                      <th className="px-3 py-2 text-left">Direzione</th>
                      <th className="px-3 py-2 text-left">Endpoint</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-left">Esito</th>
                      <th className="px-3 py-2 text-left">Dettagli</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.data.map((l) => (
                      <tr key={l.id} className="border-b border-zinc-100 align-top">
                        <td className="px-3 py-2 text-zinc-500 whitespace-nowrap">{new Date(l.created_at).toLocaleTimeString("it-IT")}</td>
                        <td className="px-3 py-2">
                          <span className={`rounded px-1.5 py-0.5 ring-1 ${
                            l.direction === "outbound" ? "bg-blue-50 text-blue-700 ring-blue-200"
                            : l.direction === "shopify" ? "bg-violet-50 text-violet-700 ring-violet-200"
                            : "bg-emerald-50 text-emerald-700 ring-emerald-200"
                          }`}>{l.direction}</span>
                        </td>
                        <td className="px-3 py-2 font-mono text-zinc-700 max-w-[260px] truncate" title={l.endpoint ?? ""}>{l.endpoint ?? "—"}</td>
                        <td className="px-3 py-2 text-zinc-700">{l.http_status ?? "—"}</td>
                        <td className="px-3 py-2">{l.success ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-red-500" />}</td>
                        <td className="px-3 py-2 text-zinc-500 max-w-[360px]">
                          {l.error && <div className="text-red-600 break-all">{l.error}</div>}
                          {l.payload && <details className="cursor-pointer"><summary className="text-zinc-500 hover:text-zinc-900">payload</summary><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[11px] text-zinc-700 bg-zinc-50 p-2 rounded">{JSON.stringify(l.payload, null, 2)}</pre></details>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function StatusCard({ title, online, subtitle, last, error }: { title: string; online: boolean; subtitle: string; last: string; error?: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
        {online ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 ring-1 ring-emerald-200"><Wifi className="h-3 w-3" /> Online</span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 ring-1 ring-zinc-200"><WifiOff className="h-3 w-3" /> Offline</span>
        )}
      </div>
      <p className="mt-2 text-xs text-zinc-600 break-all">{subtitle}</p>
      <p className="mt-1 text-xs text-zinc-400">{last}</p>
      {error && <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700 ring-1 ring-red-200 break-all">⚠ {error}</p>}
    </div>
  );
}
