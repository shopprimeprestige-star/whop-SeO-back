import { Link } from "@tanstack/react-router";
import { ShoppingBag, Search, User } from "lucide-react";
import { useCart, cartCount } from "@/stores/cart";
import { useSiteSettings } from "@/hooks/use-site-settings";
import { CartDrawer } from "@/components/shop/CartDrawer";

const NAV = [
  { to: "/shop/categoria/$slug", params: { slug: "donna-abiti" }, label: "Donna" },
  { to: "/shop/categoria/$slug", params: { slug: "uomo-camicie" }, label: "Uomo" },
  { to: "/shop/categoria/$slug", params: { slug: "occhiali" }, label: "Accessori" },
  { to: "/shop/sale", label: "Sale" },
] as const;

export function ShopHeader() {
  const lines = useCart((s) => s.lines);
  const openCart = useCart((s) => s.open);
  const count = cartCount(lines);
  const site = useSiteSettings();
  const [first, ...rest] = site.brand_name.split(/\s+/);
  const second = rest.join(" ");

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <nav className="hidden flex-1 items-center gap-8 md:flex">
            {NAV.slice(0, 2).map((n) => (
              <Link
                key={n.label}
                to={n.to}
                params={"params" in n ? n.params : undefined}
                className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground transition hover:text-foreground"
                activeProps={{ className: "text-foreground" }}
              >
                {n.label}
              </Link>
            ))}
          </nav>

          <Link to="/" className="flex items-center gap-2 font-display text-2xl font-medium tracking-[0.18em]">
            {site.logo_url ? (
              <img src={site.logo_url} alt={site.brand_name} className="h-8 w-auto" />
            ) : (
              <>
                {first?.toUpperCase()}
                {second && (
                  <>
                    <span className="text-accent">·</span>
                    {second.toUpperCase()}
                  </>
                )}
              </>
            )}
          </Link>

          <div className="flex flex-1 items-center justify-end gap-5">
            <nav className="hidden items-center gap-8 md:flex">
              {NAV.slice(2).map((n) => (
                <Link
                  key={n.label}
                  to={n.to}
                  params={"params" in n ? n.params : undefined}
                  className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground transition hover:text-foreground"
                  activeProps={{ className: "text-foreground" }}
                >
                  {n.label}
                </Link>
              ))}
            </nav>
            <button type="button" aria-label="Cerca" className="text-muted-foreground hover:text-foreground">
              <Search className="h-4 w-4" />
            </button>
            <Link to="/shop/account" aria-label="Account" className="text-muted-foreground hover:text-foreground">
              <User className="h-4 w-4" />
            </Link>
            <button type="button" onClick={openCart} aria-label="Carrello" className="relative text-foreground">
              <ShoppingBag className="h-4 w-4" />
              {count > 0 && (
                <span className="absolute -right-2 -top-2 grid h-4 w-4 place-items-center rounded-full bg-accent text-[10px] font-medium text-accent-foreground">
                  {count}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>
      <CartDrawer />
    </>
  );
}
