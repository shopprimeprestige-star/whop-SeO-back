import { Link } from "@tanstack/react-router";
import { Instagram, Mail } from "lucide-react";
import { useSiteSettings } from "@/hooks/use-site-settings";

export function ShopFooter() {
  const site = useSiteSettings();
  const brand = site.brand_name;
  const [first, ...rest] = brand.split(/\s+/);
  const second = rest.join(" ");

  return (
    <footer className="mt-32 border-t border-border bg-secondary/40">
      <div className="mx-auto max-w-7xl px-6 py-16">
        <div className="grid gap-12 md:grid-cols-5">
          <div className="md:col-span-2">
            <Link to="/" className="font-display text-2xl font-medium tracking-[0.18em]">
              {site.logo_url ? (
                <img src={site.logo_url} alt={brand} className="h-8 w-auto" />
              ) : (
                <>
                  {first?.toUpperCase()}
                  {second && <><span className="text-accent">·</span>{second.toUpperCase()}</>}
                </>
              )}
            </Link>
            <p className="mt-4 max-w-xs text-sm text-muted-foreground">
              {site.legal_address || `Capi essenziali realizzati in Europa con materiali nobili. Una collezione pensata per durare, libera dalle stagioni.`}
            </p>
            <form className="mt-6 flex max-w-sm gap-0 border-b border-foreground pb-2">
              <input
                type="email"
                placeholder="La tua email"
                className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
              />
              <button type="submit" className="text-xs font-medium uppercase tracking-[0.18em] text-foreground hover:text-accent">
                Iscriviti
              </button>
            </form>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Iscrivendoti accetti la nostra <Link to="/privacy" className="underline">Privacy Policy</Link>.
            </p>
          </div>

          <FooterCol title="Shop">
            <li><Link to="/shop/categoria/$slug" params={{ slug: "donna-abiti" }} className="hover:text-foreground">Donna</Link></li>
            <li><Link to="/shop/categoria/$slug" params={{ slug: "uomo-camicie" }} className="hover:text-foreground">Uomo</Link></li>
            <li><Link to="/shop/categoria/$slug" params={{ slug: "occhiali" }} className="hover:text-foreground">Accessori</Link></li>
            <li><Link to="/shop/sale" className="hover:text-foreground">Sale</Link></li>
          </FooterCol>

          <FooterCol title="Servizi">
            <FooterLink to="/shop/spedizioni">Spedizioni</FooterLink>
            <FooterLink to="/shop/resi">Resi & Rimborsi</FooterLink>
            <FooterLink to="/shop/contatti">Contatti</FooterLink>
            <FooterLink to="/shop/faq">FAQ</FooterLink>
          </FooterCol>

          <FooterCol title={brand}>
            <FooterLink to="/shop/chi-siamo">Chi siamo</FooterLink>
            <FooterLink to="/privacy">Privacy</FooterLink>
            <FooterLink to="/termini">Termini</FooterLink>
            <FooterLink to="/cookie">Cookie</FooterLink>
          </FooterCol>
        </div>

        <div className="mt-14 flex flex-col items-start justify-between gap-4 border-t border-border pt-6 md:flex-row md:items-center">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            © {new Date().getFullYear()} {brand} — {site.brand_url}
          </p>
          <div className="flex items-center gap-4 text-muted-foreground">
            <a href={`mailto:${site.support_email}`} aria-label="Email" className="hover:text-foreground">
              <Mail className="h-4 w-4" />
            </a>
            <a href="https://instagram.com" target="_blank" rel="noopener" aria-label="Instagram" className="hover:text-foreground">
              <Instagram className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[11px] font-medium uppercase tracking-[0.18em] text-foreground">{title}</h4>
      <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">{children}</ul>
    </div>
  );
}

function FooterLink(props: React.ComponentProps<typeof Link>) {
  return (
    <li>
      <Link {...props} className="hover:text-foreground" />
    </li>
  );
}
