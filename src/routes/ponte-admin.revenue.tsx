import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ponteGetRevenueOverview, ponteSyncRevenueAllStores } from "@/server-fn/ponte.functions";
import { getRuntimeSupabaseClient } from "@/lib/runtime-supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { RefreshCw, TrendingUp, ShoppingBag, Calendar, DollarSign, DownloadCloud, Link2, ExternalLink, CheckCircle2 } from "lucide-react";
import { formatPrice } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/ponte-admin/revenue")({
  component: RevenuePage,
  head: () => ({ meta: [{ title: "Fatturato Shopify — Sito Ponte" }] }),
});

type Overview = Awaited<ReturnType<typeof ponteGetRevenueOverview>>;

function RevenuePage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await ponteGetRevenueOverview();
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function syncFromShopify() {
    setSyncing(true);
    try {
      const res = await ponteSyncRevenueAllStores();
      const ok = res.results.filter((r) => !r.error);
      const ko = res.results.filter((r) => r.error);
      const total = ok.reduce((s, r) => s + r.imported, 0);
      toast.success(`Sincronizzati ${total} ordini da ${ok.length} store${ko.length ? ` · ${ko.length} errori` : ""}`);
      if (ko.length) {
        for (const k of ko) toast.error(`${k.shop_domain}: ${k.error}`);
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    let remove: (() => void) | undefined;
    load();
    getRuntimeSupabaseClient().then((supabase) => {
      if (cancelled) return;
      const ch = supabase
        .channel("bridge_revenue_events")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "bridge_revenue_events" }, () => load())
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "bridge_revenue_events" }, () => load())
        .subscribe();
      remove = () => { supabase.removeChannel(ch); };
    });
    const interval = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      remove?.();
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fmt = (v: number, c?: string) => formatPrice(v, c ?? "EUR");
  const g = data?.global;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-zinc-900">Fatturato Shopify</h1>
          <p className="mt-1 text-sm text-zinc-500">Aggiornamento in tempo reale via webhook · sync ogni 60s</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Aggiorna
          </Button>
          <Button size="sm" onClick={syncFromShopify} disabled={syncing}>
            <DownloadCloud className={`mr-2 h-4 w-4 ${syncing ? "animate-pulse" : ""}`} />
            {syncing ? "Sincronizzazione…" : "Sincronizza da Shopify"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <Card className="border-zinc-200 bg-white">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-zinc-700">Totale per store</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Store</TableHead>
                <TableHead className="text-right">Totale</TableHead>
                <TableHead className="text-right">Oggi</TableHead>
                <TableHead className="text-right">Ordini</TableHead>
                <TableHead className="text-right">Rimborsi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.byStore ?? []).map((s) => (
                <TableRow key={s.store_id}>
                  <TableCell>
                    <div className="font-medium text-zinc-900">{s.display_name ?? s.shop_domain}</div>
                    <div className="text-xs text-zinc-500">{s.shop_domain}</div>
                  </TableCell>
                  <TableCell className="text-right text-zinc-900 font-semibold">{fmt(s.lifetime_paid, s.currency)}</TableCell>
                  <TableCell className="text-right text-emerald-600 font-medium">{fmt(s.today_paid, s.currency)}</TableCell>
                  <TableCell className="text-right text-zinc-600">{s.orders_count}</TableCell>
                  <TableCell className="text-right text-zinc-500">{fmt(s.lifetime_refunded, s.currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={<TrendingUp className="h-4 w-4" />} label="Fatturato totale" value={g ? fmt(g.lifetime_paid, g.currency) : "—"} sub={g ? `${g.lifetime_orders} ordini` : ""} />
        <KpiCard icon={<Calendar className="h-4 w-4" />} label="Oggi" value={g ? fmt(g.today_paid, g.currency) : "—"} sub={g ? `${g.today_orders} ordini` : ""} accent />
        <KpiCard icon={<ShoppingBag className="h-4 w-4" />} label="Ultimi 7 giorni" value={g ? fmt(g.week_paid, g.currency) : "—"} />
        <KpiCard icon={<DollarSign className="h-4 w-4" />} label="Ultimi 30 giorni" value={g ? fmt(g.month_paid, g.currency) : "—"} sub={g ? `Rimborsi: ${fmt(g.lifetime_refunded, g.currency)}` : ""} />
      </div>

      <Card className="border-zinc-200 bg-white">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-zinc-700">Fatturato giornaliero (ultimi 30 giorni)</CardTitle>
        </CardHeader>
        <CardContent>
          <DailyBars daily={data?.daily ?? []} currency={g?.currency ?? "EUR"} />
        </CardContent>
      </Card>

      <Card className="border-zinc-200 bg-white">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-zinc-700">Eventi recenti</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Store</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Ordine</TableHead>
                <TableHead className="text-right">Importo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.recent ?? []).map((e) => (
                <TableRow key={`${e.shopify_order_id}-${e.event_type}`}>
                  <TableCell className="text-zinc-500 text-xs">{new Date(e.occurred_at).toLocaleString("it-IT")}</TableCell>
                  <TableCell className="text-zinc-700 text-xs">{e.shop_domain}</TableCell>
                  <TableCell><EventBadge type={e.event_type} /></TableCell>
                  <TableCell className="text-zinc-700 text-xs">{e.order_number ?? `#${e.shopify_order_id}`}</TableCell>
                  <TableCell className="text-right text-zinc-900 font-medium">{fmt(Number(e.amount || 0), e.currency ?? undefined)}</TableCell>
                </TableRow>
              ))}
              {(!data || data.recent.length === 0) && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-zinc-500 py-6">Nessun evento</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ icon, label, value, sub, accent }: { icon: React.ReactNode; label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <Card className={accent ? "border-emerald-200 bg-emerald-50" : "border-zinc-200 bg-white"}>
      <CardContent className="p-4">
        <div className={`flex items-center gap-2 text-xs ${accent ? "text-emerald-700" : "text-zinc-500"}`}>
          {icon} {label}
        </div>
        <div className={`mt-2 text-2xl font-semibold ${accent ? "text-emerald-700" : "text-zinc-900"}`}>{value}</div>
        {sub && <div className="mt-1 text-xs text-zinc-500">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function EventBadge({ type }: { type: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    order_paid: { label: "Pagato", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    order_created: { label: "Creato", cls: "bg-blue-50 text-blue-700 border-blue-200" },
    order_cancelled: { label: "Annullato", cls: "bg-zinc-100 text-zinc-600 border-zinc-200" },
    order_refunded: { label: "Rimborsato", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  };
  const m = map[type] ?? { label: type, cls: "bg-zinc-100 text-zinc-700 border-zinc-200" };
  return <Badge variant="outline" className={m.cls}>{m.label}</Badge>;
}

function DailyBars({ daily, currency }: { daily: Array<{ day: string; paid: number; orders: number; net: number }>; currency: string }) {
  const max = Math.max(1, ...daily.map((d) => d.paid));
  return (
    <div className="space-y-2">
      <div className="flex h-40 items-end gap-1">
        {daily.map((d) => {
          const h = Math.round((d.paid / max) * 100);
          return (
            <div key={d.day} className="group relative flex-1" title={`${d.day} · ${formatPrice(d.paid, currency)} (${d.orders} ord.)`}>
              <div
                className="w-full rounded-t bg-zinc-900 transition hover:bg-zinc-700"
                style={{ height: `${h}%`, minHeight: d.paid > 0 ? "2px" : "0" }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-xs text-zinc-500">
        <span>{daily[0]?.day ?? ""}</span>
        <span>oggi</span>
      </div>
    </div>
  );
}

function b64url(s: string) {
  if (typeof window === "undefined") return "";
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function ReferrerTestCard({ byStore }: { byStore: Array<{ shop_domain: string }> }) {
  const [copied, setCopied] = useState(false);
  const sample = byStore[0]?.shop_domain ?? "test-store.myshopify.com";
  const target = `https://${sample}/checkout`;
  const origin = typeof window !== "undefined" ? window.location.origin : "https://dealbridge.lovable.app";
  const washUrl = `${origin}/wash?u=${b64url(target)}`;
  async function copy() {
    try { await navigator.clipboard.writeText(washUrl); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* noop */ }
  }
  return (
    <Card className="border-blue-200 bg-blue-50/50">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-blue-900 flex items-center gap-2">
          <Link2 className="h-4 w-4" /> Test Referrer Shopify
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-blue-900/80">
          La pagina <code className="rounded bg-white px-1.5 py-0.5 text-blue-700">/wash</code> serve un HTML branded di Sito B prima di reindirizzare a Shopify.
          Risultato: nei report Shopify <strong>Referring site</strong> mostrerà <code className="rounded bg-white px-1.5 py-0.5 text-blue-700">{new URL(origin).hostname}</code> invece di <em>None</em>.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            readOnly
            value={washUrl}
            className="flex-1 rounded-md border border-blue-200 bg-white px-3 py-2 text-xs font-mono text-blue-900"
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button size="sm" variant="outline" onClick={copy} className="border-blue-300 bg-white">
            {copied ? <><CheckCircle2 className="mr-1.5 h-3.5 w-3.5 text-emerald-600" /> Copiato</> : "Copia link"}
          </Button>
          <Button asChild size="sm">
            <a href={washUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Apri test
            </a>
          </Button>
        </div>
        <p className="text-[11px] text-blue-900/60">
          Verifica: dopo aver aperto il link, in Shopify Admin → Analytics → Sessions vedrai una sessione con Referring site = <strong>{new URL(origin).hostname}</strong>.
        </p>
      </CardContent>
    </Card>
  );
}
