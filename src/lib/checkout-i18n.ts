// i18n + geo per il checkout nativo di Sito B.
// Stesso approccio di Sito A: rileva il paese via ipapi.co, mappa paese→lingua,
// traduce la UI e formatta la valuta secondo il locale. La conversione valuta
// dei prezzi è già fatta da Sito A (gli importi della sessione sono nella valuta
// dell'utente); qui formattiamo con il locale corretto.

export type Lang =
  | "it" | "en" | "de" | "fr" | "es" | "pt" | "nl"
  | "bg" | "cs" | "da" | "el" | "et" | "fi" | "hr" | "hu" | "lt" | "lv"
  | "mt" | "pl" | "ro" | "sk" | "sl" | "sv" | "no" | "is"
  | "ja" | "ko" | "zh" | "ar" | "he";

export const COUNTRY_TO_LANG: Record<string, Lang> = {
  IT: "it", SM: "it", VA: "it",
  GB: "en", IE: "en", US: "en", CA: "en", AU: "en", NZ: "en", SG: "en",
  DE: "de", AT: "de", LI: "de", CH: "de",
  FR: "fr", BE: "fr", LU: "fr", MC: "fr",
  ES: "es", AD: "es",
  PT: "pt",
  NL: "nl",
  BG: "bg", CZ: "cs", DK: "da", GR: "el", EE: "et", FI: "fi",
  HR: "hr", HU: "hu", LT: "lt", LV: "lv", MT: "mt", PL: "pl",
  RO: "ro", SK: "sk", SI: "sl", SE: "sv", CY: "el",
  NO: "no", IS: "is",
  JP: "ja", KR: "ko", TW: "zh", HK: "zh",
  AE: "ar", QA: "ar", KW: "ar", SA: "ar", IL: "he",
};

const LOCALE_FOR_LANG: Record<string, string> = {
  it: "it-IT", en: "en-GB", de: "de-DE", fr: "fr-FR", es: "es-ES", pt: "pt-PT", nl: "nl-NL",
  bg: "bg-BG", cs: "cs-CZ", da: "da-DK", el: "el-GR", et: "et-EE", fi: "fi-FI",
  hr: "hr-HR", hu: "hu-HU", lt: "lt-LT", lv: "lv-LV", mt: "mt-MT", pl: "pl-PL",
  ro: "ro-RO", sk: "sk-SK", sl: "sl-SI", sv: "sv-SE", no: "nb-NO", is: "is-IS",
  ja: "ja-JP", ko: "ko-KR", zh: "zh-TW", ar: "ar-AE", he: "he-IL",
};

export function localeForLang(lang: string): string {
  return LOCALE_FOR_LANG[lang] || "it-IT";
}

// --- Valute: mappa paese→valuta (come Sito A) + tassi di cambio live (base EUR) ---
export const COUNTRY_TO_CURRENCY: Record<string, string> = {
  AT: "EUR", BE: "EUR", CY: "EUR", DE: "EUR", EE: "EUR", ES: "EUR", FI: "EUR",
  FR: "EUR", GR: "EUR", HR: "EUR", IE: "EUR", IT: "EUR", LT: "EUR", LU: "EUR",
  LV: "EUR", MT: "EUR", NL: "EUR", PT: "EUR", SI: "EUR", SK: "EUR",
  BG: "BGN", CZ: "CZK", DK: "DKK", HU: "HUF", PL: "PLN", RO: "RON", SE: "SEK",
  GB: "GBP", CH: "CHF", NO: "NOK", IS: "ISK", LI: "CHF", AD: "EUR", MC: "EUR", SM: "EUR", VA: "EUR",
  US: "USD", CA: "CAD", AU: "AUD", NZ: "NZD",
  JP: "JPY", KR: "KRW", TW: "TWD", HK: "HKD", SG: "SGD",
  AE: "AED", QA: "QAR", KW: "KWD", SA: "SAR", IL: "ILS",
};

export function currencyForCountry(country: string | null | undefined): string | null {
  if (!country) return null;
  return COUNTRY_TO_CURRENCY[country.toUpperCase()] || null;
}

const FX_CACHE_KEY = "siteb_fx_rates_v1";
const FX_TTL = 24 * 60 * 60 * 1000;
let fxInflight: Promise<Record<string, number>> | null = null;

export async function getRates(): Promise<Record<string, number>> {
  if (typeof window === "undefined") return { EUR: 1 };
  try {
    const raw = localStorage.getItem(FX_CACHE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as { ts: number; rates: Record<string, number> };
      if (Date.now() - p.ts < FX_TTL && p.rates?.EUR) return p.rates;
    }
  } catch { /* ignore */ }
  if (fxInflight) return fxInflight;
  fxInflight = (async () => {
    try {
      const r = await fetch("https://open.er-api.com/v6/latest/EUR");
      const j = await r.json();
      const rates = (j?.rates || { EUR: 1 }) as Record<string, number>;
      rates.EUR = 1;
      try { localStorage.setItem(FX_CACHE_KEY, JSON.stringify({ ts: Date.now(), rates })); } catch { /* ignore */ }
      return rates;
    } catch {
      return { EUR: 1 };
    } finally {
      fxInflight = null;
    }
  })();
  return fxInflight;
}

const ZERO_DECIMAL = new Set(["HUF", "ISK", "JPY", "KRW", "TWD"]);

// Converte da una valuta all'altra usando tassi base EUR.
export function convertAmount(amount: number, from: string, to: string, rates: Record<string, number>): number {
  if (from === to) return amount;
  const rf = rates[from] || 1;
  const rt = rates[to] || 1;
  const eur = amount / rf;
  const out = eur * rt;
  return ZERO_DECIMAL.has(to) ? Math.round(out) : Math.round(out * 100) / 100;
}

export function formatMoney(amount: number, currency: string, lang: string): string {
  const digits = ZERO_DECIMAL.has(currency) ? 0 : 2;
  try {
    return new Intl.NumberFormat(localeForLang(lang), { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
  } catch {
    return `${amount.toFixed(digits)} ${currency}`;
  }
}

export type TKey =
  | "secure_payment" | "show_summary" | "hide_summary" | "order_summary"
  | "contact" | "email" | "phone_opt" | "newsletter"
  | "delivery" | "country_region" | "first_name" | "last_name" | "address" | "apt_opt" | "city" | "province" | "zip"
  | "shipping" | "no_shipping" | "billing" | "secure_note" | "updating_total"
  | "pay_now" | "paying" | "discount_code" | "apply" | "subtotal" | "shipping_label" | "free" | "total"
  | "order_confirmed" | "thanks_email" | "enter_email" | "product";

type Dict = Record<TKey, string>;

const it: Dict = {
  secure_payment: "Pagamento sicuro", show_summary: "Mostra riepilogo ordine", hide_summary: "Nascondi riepilogo ordine", order_summary: "Riepilogo ordine",
  contact: "Contatto", email: "Email", phone_opt: "Telefono (opzionale)", newsletter: "Ricevi offerte esclusive via email",
  delivery: "Consegna", country_region: "Paese / Regione", first_name: "Nome", last_name: "Cognome", address: "Indirizzo", apt_opt: "Appartamento, interno (opzionale)", city: "Città", province: "Provincia / Regione", zip: "CAP",
  shipping: "Spedizione", no_shipping: "Nessun metodo di spedizione configurato.", billing: "Fatturazione", secure_note: "Tutte le transazioni sono sicure e crittografate.", updating_total: "Aggiorno il totale…",
  pay_now: "Paga ora", paying: "Pagamento in corso…", discount_code: "Codice sconto", apply: "Applica", subtotal: "Subtotale", shipping_label: "Spedizione", free: "Gratuita", total: "Totale",
  order_confirmed: "Ordine confermato", thanks_email: "Grazie! Riceverai una email di conferma.", enter_email: "Inserisci la tua email", product: "Prodotto",
};
const en: Dict = {
  secure_payment: "Secure payment", show_summary: "Show order summary", hide_summary: "Hide order summary", order_summary: "Order summary",
  contact: "Contact", email: "Email", phone_opt: "Phone (optional)", newsletter: "Email me with exclusive offers",
  delivery: "Delivery", country_region: "Country / Region", first_name: "First name", last_name: "Last name", address: "Address", apt_opt: "Apartment, suite, etc. (optional)", city: "City", province: "State / Province", zip: "ZIP code",
  shipping: "Shipping", no_shipping: "No shipping method configured.", billing: "Payment", secure_note: "All transactions are secure and encrypted.", updating_total: "Updating total…",
  pay_now: "Pay now", paying: "Processing payment…", discount_code: "Discount code", apply: "Apply", subtotal: "Subtotal", shipping_label: "Shipping", free: "Free", total: "Total",
  order_confirmed: "Order confirmed", thanks_email: "Thank you! You'll receive a confirmation email.", enter_email: "Enter your email", product: "Product",
};
const de: Dict = {
  secure_payment: "Sichere Zahlung", show_summary: "Bestellübersicht anzeigen", hide_summary: "Bestellübersicht ausblenden", order_summary: "Bestellübersicht",
  contact: "Kontakt", email: "E-Mail", phone_opt: "Telefon (optional)", newsletter: "Exklusive Angebote per E-Mail erhalten",
  delivery: "Lieferung", country_region: "Land / Region", first_name: "Vorname", last_name: "Nachname", address: "Adresse", apt_opt: "Wohnung, etc. (optional)", city: "Stadt", province: "Bundesland / Region", zip: "PLZ",
  shipping: "Versand", no_shipping: "Keine Versandart konfiguriert.", billing: "Zahlung", secure_note: "Alle Transaktionen sind sicher und verschlüsselt.", updating_total: "Summe wird aktualisiert…",
  pay_now: "Jetzt bezahlen", paying: "Zahlung wird verarbeitet…", discount_code: "Rabattcode", apply: "Anwenden", subtotal: "Zwischensumme", shipping_label: "Versand", free: "Kostenlos", total: "Gesamt",
  order_confirmed: "Bestellung bestätigt", thanks_email: "Danke! Du erhältst eine Bestätigungs-E-Mail.", enter_email: "Gib deine E-Mail ein", product: "Produkt",
};
const fr: Dict = {
  secure_payment: "Paiement sécurisé", show_summary: "Afficher le récapitulatif", hide_summary: "Masquer le récapitulatif", order_summary: "Récapitulatif de commande",
  contact: "Contact", email: "E-mail", phone_opt: "Téléphone (facultatif)", newsletter: "Recevoir des offres exclusives par e-mail",
  delivery: "Livraison", country_region: "Pays / Région", first_name: "Prénom", last_name: "Nom", address: "Adresse", apt_opt: "Appartement, etc. (facultatif)", city: "Ville", province: "Région", zip: "Code postal",
  shipping: "Expédition", no_shipping: "Aucun mode de livraison configuré.", billing: "Paiement", secure_note: "Toutes les transactions sont sécurisées et chiffrées.", updating_total: "Mise à jour du total…",
  pay_now: "Payer maintenant", paying: "Paiement en cours…", discount_code: "Code de réduction", apply: "Appliquer", subtotal: "Sous-total", shipping_label: "Expédition", free: "Gratuite", total: "Total",
  order_confirmed: "Commande confirmée", thanks_email: "Merci ! Vous recevrez un e-mail de confirmation.", enter_email: "Entrez votre e-mail", product: "Produit",
};
const es: Dict = {
  secure_payment: "Pago seguro", show_summary: "Mostrar resumen del pedido", hide_summary: "Ocultar resumen del pedido", order_summary: "Resumen del pedido",
  contact: "Contacto", email: "Correo electrónico", phone_opt: "Teléfono (opcional)", newsletter: "Recibir ofertas exclusivas por correo",
  delivery: "Entrega", country_region: "País / Región", first_name: "Nombre", last_name: "Apellidos", address: "Dirección", apt_opt: "Apartamento, etc. (opcional)", city: "Ciudad", province: "Provincia / Región", zip: "Código postal",
  shipping: "Envío", no_shipping: "Ningún método de envío configurado.", billing: "Pago", secure_note: "Todas las transacciones son seguras y cifradas.", updating_total: "Actualizando el total…",
  pay_now: "Pagar ahora", paying: "Procesando el pago…", discount_code: "Código de descuento", apply: "Aplicar", subtotal: "Subtotal", shipping_label: "Envío", free: "Gratis", total: "Total",
  order_confirmed: "Pedido confirmado", thanks_email: "¡Gracias! Recibirás un correo de confirmación.", enter_email: "Introduce tu correo electrónico", product: "Producto",
};
const pt: Dict = {
  secure_payment: "Pagamento seguro", show_summary: "Mostrar resumo do pedido", hide_summary: "Ocultar resumo do pedido", order_summary: "Resumo do pedido",
  contact: "Contacto", email: "E-mail", phone_opt: "Telefone (opcional)", newsletter: "Receber ofertas exclusivas por e-mail",
  delivery: "Entrega", country_region: "País / Região", first_name: "Nome", last_name: "Apelido", address: "Morada", apt_opt: "Apartamento, etc. (opcional)", city: "Cidade", province: "Distrito / Região", zip: "Código postal",
  shipping: "Envio", no_shipping: "Nenhum método de envio configurado.", billing: "Pagamento", secure_note: "Todas as transações são seguras e encriptadas.", updating_total: "A atualizar o total…",
  pay_now: "Pagar agora", paying: "A processar o pagamento…", discount_code: "Código de desconto", apply: "Aplicar", subtotal: "Subtotal", shipping_label: "Envio", free: "Grátis", total: "Total",
  order_confirmed: "Pedido confirmado", thanks_email: "Obrigado! Receberá um e-mail de confirmação.", enter_email: "Introduza o seu e-mail", product: "Produto",
};
const nl: Dict = {
  secure_payment: "Veilig betalen", show_summary: "Toon besteloverzicht", hide_summary: "Verberg besteloverzicht", order_summary: "Besteloverzicht",
  contact: "Contact", email: "E-mail", phone_opt: "Telefoon (optioneel)", newsletter: "Ontvang exclusieve aanbiedingen per e-mail",
  delivery: "Levering", country_region: "Land / Regio", first_name: "Voornaam", last_name: "Achternaam", address: "Adres", apt_opt: "Appartement, etc. (optioneel)", city: "Stad", province: "Provincie / Regio", zip: "Postcode",
  shipping: "Verzending", no_shipping: "Geen verzendmethode geconfigureerd.", billing: "Betaling", secure_note: "Alle transacties zijn veilig en versleuteld.", updating_total: "Totaal bijwerken…",
  pay_now: "Nu betalen", paying: "Betaling verwerken…", discount_code: "Kortingscode", apply: "Toepassen", subtotal: "Subtotaal", shipping_label: "Verzending", free: "Gratis", total: "Totaal",
  order_confirmed: "Bestelling bevestigd", thanks_email: "Bedankt! Je ontvangt een bevestigingsmail.", enter_email: "Voer je e-mail in", product: "Product",
};

const DICTS: Partial<Record<Lang, Dict>> = { it, en, de, fr, es, pt, nl };

export function makeT(lang: Lang) {
  const d = DICTS[lang] || en;
  return (key: TKey): string => d[key] || en[key] || key;
}

export function flagEmoji(cc: string): string {
  if (!cc || cc.length !== 2) return "🏳️";
  return cc.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

export function countryName(cc: string, lang: string): string {
  try {
    // @ts-ignore DisplayNames disponibile nei browser moderni
    const dn = new Intl.DisplayNames([localeForLang(lang)], { type: "region" });
    return dn.of(cc.toUpperCase()) || cc;
  } catch {
    return cc;
  }
}

export interface GeoResult { country: string | null; lang: Lang; }

// Rileva il paese via ipapi.co (come Sito A). Fallback: locale del browser.
export async function detectGeo(): Promise<GeoResult> {
  let country: string | null = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch("https://ipapi.co/json/", { signal: ctrl.signal });
    clearTimeout(timer);
    if (r.ok) {
      const j = await r.json();
      if (j?.country_code && typeof j.country_code === "string") country = j.country_code.toUpperCase();
    }
  } catch { /* fallback sotto */ }

  if (!country && typeof navigator !== "undefined") {
    const loc = (navigator.languages?.[0] || navigator.language || "").toUpperCase();
    const parts = loc.split("-");
    if (parts[1]) country = parts[1];
  }

  const lang = (country && COUNTRY_TO_LANG[country]) || "en";
  return { country, lang };
}
