import { createFileRoute, Outlet, Link, useNavigate, useRouterState, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getRuntimeSupabaseClient } from "@/lib/runtime-supabase";
import {
  LogOut, Menu, X, ExternalLink, LayoutDashboard,
  Store, BarChart3, ScrollText, Package, Truck,
  RefreshCw, Cloud, Database, ArrowLeftRight,
  Globe, Activity, MousePointerClick, Bug, HeartPulse, Wallet,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/ponte-admin")({
  component: PonteShell,
  head: () => ({ meta: [{ title: "Sito Ponte — Admin" }, { name: "robots", content: "noindex, nofollow" }] }),
  beforeLoad: async ({ location }) => {
    if (typeof window === "undefined") return;
    if (location.pathname === "/ponte-admin/login") return;
    const supabase = await getRuntimeSupabaseClient();
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/ponte-admin/login" });
  },
});

type NavItem = { to: string; label: string; icon: React.ComponentType<{ className?: string }>; exact?: boolean };
type NavGroup = { title: string; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    title: "Operazioni",
    items: [
      { to: "/ponte-admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
      { to: "/ponte-admin/stores", label: "Stores", icon: Store },
      { to: "/ponte-admin/revenue", label: "Fatturato", icon: BarChart3 },
      { to: "/ponte-admin/logs", label: "Logs", icon: ScrollText },
    ],
  },
  {
    title: "Catalogo",
    items: [
      { to: "/ponte-admin/prodotti", label: "Prodotti", icon: Package },
      { to: "/ponte-admin/shipping", label: "Spedizioni", icon: Truck },
    ],
  },
  {
    title: "Configurazione",
    items: [
      { to: "/ponte-admin/site-settings", label: "Sito", icon: Globe },
      { to: "/ponte-admin/apple-pay", label: "Apple/Google Pay", icon: Wallet },
      { to: "/ponte-admin/capi", label: "Meta CAPI", icon: Activity },
    ],
  },
  {
    title: "Diagnostica",
    items: [
      { to: "/ponte-admin/clones-health", label: "Cloni Health", icon: HeartPulse },
    ],
  },
];

function PonteShell() {
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    let cancel = false;
    let unsubscribe: (() => void) | undefined;
    (async () => {
      const supabase = await getRuntimeSupabaseClient();
      const { data } = await supabase.auth.getSession();
      if (!cancel) setAuthed(!!data.session);
      const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
        setAuthed(!!s);
        if (!s && path !== "/ponte-admin/login") navigate({ to: "/ponte-admin/login" });
      });
      unsubscribe = () => sub.subscription.unsubscribe();
    })();
    return () => { cancel = true; unsubscribe?.(); };
  }, [navigate, path]);

  // chiudi il menu mobile al cambio pagina
  useEffect(() => { setMobileOpen(false); }, [path]);

  async function logout() {
    const supabase = await getRuntimeSupabaseClient();
    await supabase.auth.signOut();
    toast.success("Disconnesso");
    navigate({ to: "/ponte-admin/login" });
  }

  if (path === "/ponte-admin/login") return <Outlet />;
  if (authed === false) return null;

  const sidebar = (
    <div className="flex h-full flex-col">
      <Link to="/ponte-admin" className="flex items-center gap-2.5 px-5 py-5">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-zinc-900 text-sm font-semibold text-white">P</span>
        <div>
          <div className="text-sm font-semibold leading-tight">Sito Ponte</div>
          <div className="text-[11px] text-muted-foreground">Dashboard bridge</div>
        </div>
      </Link>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-6">
        {NAV.map((group) => (
          <div key={group.title}>
            <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">{group.title}</div>
            <div className="space-y-0.5">
              {group.items.map((it) => {
                const active = it.exact ? path === it.to : path.startsWith(it.to);
                const Icon = it.icon;
                return (
                  <Link
                    key={it.to}
                    to={it.to}
                    className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                      active ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {it.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t px-3 py-3">
        <Link to="/" className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted-foreground hover:bg-zinc-100 hover:text-foreground">
          <ExternalLink className="h-4 w-4" /> Vai al sito
        </Link>
        <button onClick={logout} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted-foreground hover:bg-zinc-100 hover:text-foreground">
          <LogOut className="h-4 w-4" /> Esci
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* sidebar desktop */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 border-r bg-card lg:block">{sidebar}</aside>

      {/* topbar mobile */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
        <button onClick={() => setMobileOpen(true)} className="rounded-md p-1.5 hover:bg-zinc-100"><Menu className="h-5 w-5" /></button>
        <span className="text-sm font-semibold">Sito Ponte</span>
        <button onClick={logout} className="rounded-md p-1.5 text-muted-foreground hover:bg-zinc-100"><LogOut className="h-5 w-5" /></button>
      </header>

      {/* drawer mobile */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64 bg-card shadow-xl">
            <button onClick={() => setMobileOpen(false)} className="absolute right-3 top-3 rounded-md p-1.5 hover:bg-zinc-100"><X className="h-5 w-5" /></button>
            {sidebar}
          </div>
        </div>
      )}

      <main className="px-4 py-6 lg:ml-60 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
