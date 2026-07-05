// Scaglioni quantità globali per il negozio Atelier Nord.
// Ogni step si applica a partire da una soglia di pezzi.
export interface QuantityBreak {
  minQty: number;
  discountPct: number; // 0..1
  label: string;
}

export const QUANTITY_BREAKS: QuantityBreak[] = [
  { minQty: 1, discountPct: 0, label: "Prezzo base" },
  { minQty: 2, discountPct: 0.05, label: "-5% da 2 pezzi" },
  { minQty: 3, discountPct: 0.1, label: "-10% da 3 pezzi" },
];

export function getDiscountForQty(qty: number): QuantityBreak {
  let active = QUANTITY_BREAKS[0];
  for (const b of QUANTITY_BREAKS) if (qty >= b.minQty) active = b;
  return active;
}

export function applyQuantityDiscount(unitPrice: number, qty: number): number {
  const b = getDiscountForQty(qty);
  return Math.round(unitPrice * (1 - b.discountPct) * 100) / 100;
}
