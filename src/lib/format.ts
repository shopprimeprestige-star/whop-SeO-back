export function formatPrice(value: number | null | undefined, currency = "EUR") {
  if (value == null) return "—";
  return new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(Number(value));
}

export function discountPct(price?: number | null, compareAt?: number | null) {
  if (!price || !compareAt || compareAt <= price) return null;
  return Math.round(((compareAt - price) / compareAt) * 100);
}

export function formatDate(d: string | Date | null | undefined) {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "long", year: "numeric" }).format(date);
}
