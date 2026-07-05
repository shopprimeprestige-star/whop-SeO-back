import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ponteListStores } from "@/server-fn/ponte.functions";
import { formatPrice } from "@/lib/format";
import { Store, BarChart3, Package, Truck, Plus, ArrowRight, CheckCircle2, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/ponte-admin/")({ component: Dashboard });

function Dashboard() {
  const bridgeUrl = typeof window !== "undefined" ? `${window.location.protocol}//${window.location.host}` : "";
  const { data: stores = [], isLoading } = useQuery({ queryKey: ["ponte", "stores"], queryFn: () => ponteListStores() });

  const currency = stores[0]?.currency ?? "EUR";
  const total = stores.reduce((s, x) => s + Number(x.lifetime_revenue ?? 0), 0);
  const today = stores.reduce((s, x) => s + Number(x.today_revenue ?? 0), 0);
  const todayOrders = stores.reduce((s, x) => s + Number(x.today_orders ?? 0), 0);
  const active = stores.filter((s) => s.is_active).length;
  const connected = stores.filter((s) => s.last_handshake_at && !s.last_error).length;
  const errored = stores.filter((s) => s.last_error).length;

  const cards = [
    { label: "Store attivi", value: `${active}/${stores.length}`, sub: `${connected} connessi`, icon: Store },
    { label: "Fatturato oggi", value: formatPrice(today, currency), sub: `${todayOrders} ordini oggi`, icon: BarChart3 },
    { label: "Fatturato totale", value: formatPrice(total, currency), sub: "All-time", icon: BarChart3 },
    { label: "Stato bridge", value: errored > 0 ? `${errored} errori` : "OK", sub: errored > 0 ? "da verificare" : "tutti connessi", icon: errored > 0 ? AlertTriangle : CheckCircle2, alert: errored > 0 },
  ];

  const quick = [
    { to: "/ponte-admin/stores", label: "Gestisci store", icon: Store },
    { to: "/ponte-admin/prodotti", label: "Prodotti", icon: Package },
    { to: "/ponte-admin/shipping", label: "Spedizioni", icon: Truck },
    { to: "/ponte-admin/new", label: "Nuovo store", icon: Plus },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-500">Panoramica del Sito Ponte.</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className={`rounded-2xl border bg-white p-5 shadow-sm ${c.alert ? "border-amber-200 bg-amber-50/40" : "border-zinc-200"}`}>
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                <Icon className={`h-4 w-4 ${c.alert ? "text-amber-500" : "text-zinc-400"}`} /> {c.label}
              </div>
              <div className="mt-2 text-2xl font-semibold text-zinc-900">{isLoading ? "…" : c.value}</div>
              <div className="mt-0.5 text-xs text-zinc-500">{c.sub}</div>
            </div>
          );
        })}
      </div>

      {/* quick actions */}
      <div>
        <div className="mb-3 text-sm font-semibold text-zinc-900">Azioni rapide</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {quick.map((q) => {
            const Icon = q.icon;
            return (
              <Link key={q.to} to={q.to} className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-800 shadow-sm transition hover:border-zinc-900">
                <span className="flex items-center gap-2"><Icon className="h-4 w-4 text-zinc-500" /> {q.label}</span>
                <ArrowRight className="h-4 w-4 text-zinc-400" />
              </Link>
            );
          })}
        </div>
      </div>

      {/* stores quick list */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-zinc-900">Store</div>
          <Link to="/ponte-admin/stores" className="text-xs text-zinc-500 hover:text-zinc-900">Vedi tutti →</Link>
        </div>
        <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
          {isLoading ? (
            <div className="px-5 py-6 text-center text-sm text-zinc-500">Caricamento…</div>
          ) : stores.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-zinc-500">Nessuno store. <Link to="/ponte-admin/new" className="underline">Creane uno</Link>.</div>
          ) : (
            stores.map((s) => (
              <Link key={s.id} to="/ponte-admin/$id" params={{ id: s.id }} className="flex items-center justify-between border-b border-zinc-100 px-5 py-3 last:border-0 hover:bg-zinc-50">
                <div>
                  <div className="text-sm font-medium text-zinc-900">{bridgeUrl || s.shop_domain}</div>
                  <div className="text-xs text-zinc-500">{s.shop_domain}</div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right text-xs text-zinc-500">
                    <div className="font-medium text-zinc-900">{formatPrice(s.lifetime_revenue ?? 0, s.currency ?? "EUR")}</div>
                    <div>oggi {formatPrice(s.today_revenue ?? 0, s.currency ?? "EUR")}</div>
                  </div>
                  {s.last_error
                    ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Errore</span>
                    : s.last_handshake_at
                      ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Connesso</span>
                      : <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">Mai connesso</span>}
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
