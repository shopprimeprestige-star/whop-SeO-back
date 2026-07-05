import { Link } from "@tanstack/react-router";

export interface ShopProductCardData {
  id: string;
  slug: string;
  title: string;
  brand: string | null;
  price: number;
  compare_at_price: number | null;
  currency: string;
  image_url: string | null;
}

const fmt = (v: number, c: string) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: c, minimumFractionDigits: 0 }).format(v);

export function ShopProductCard({ p }: { p: ShopProductCardData }) {
  const onSale = p.compare_at_price && p.compare_at_price > p.price;
  return (
    <Link to="/shop/prodotto/$slug" params={{ slug: p.slug }} className="group block">
      <div className="relative aspect-[3/4] overflow-hidden bg-muted">
        {p.image_url ? (
          <img
            src={p.image_url}
            alt={p.title}
            loading="lazy"
            className="h-full w-full object-cover transition duration-700 group-hover:scale-105"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-xs text-muted-foreground">No image</div>
        )}
        {onSale && (
          <span className="absolute left-3 top-3 bg-accent px-2 py-1 text-[10px] font-medium uppercase tracking-[0.15em] text-accent-foreground">
            Sale
          </span>
        )}
      </div>
      <div className="mt-3 space-y-1">
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{p.brand}</p>
        <h3 className="line-clamp-1 text-sm font-medium text-foreground">{p.title}</h3>
        <div className="flex items-baseline gap-2 text-sm">
          <span className="font-medium text-foreground">{fmt(p.price, p.currency)}</span>
          {onSale && (
            <span className="text-xs text-muted-foreground line-through">
              {fmt(p.compare_at_price as number, p.currency)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
