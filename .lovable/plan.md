## Obiettivo

Store B (questo progetto) deve supportare **due flussi paralleli e indipendenti**:

1. **Catalogo nativo** (invariato): prodotti creati dall'admin, visibili nel front-end, checkout via Shopify Bridge **o** Whop nativo (configurabile per prodotto / per store).
2. **Prodotti sincronizzati da Site A**: arrivano via webhook, vengono creati come `PRD-XXXXX` (5 cifre random univoche), **nascosti dal front-end pubblico**, accessibili solo via link diretto `/shop/prodotto/PRD-xxxxx`, e — se lo store ha Whop configurato — vengono **automaticamente pubblicati su Whop** (product + plan) con immagine impostata dall'admin (default: vuota).

---

## 1. Database

Migrazione su `shop_products`:

```sql
ALTER TABLE shop_products
  ADD COLUMN source text NOT NULL DEFAULT 'native'
    CHECK (source IN ('native','synced')),
  ADD COLUMN source_store_id text,           -- id store A
  ADD COLUMN source_product_ref text,        -- id/handle originale su Site A
  ADD COLUMN source_synced_at timestamptz,
  ADD COLUMN hidden_from_listing boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX shop_products_source_uq
  ON shop_products(source_store_id, source_product_ref)
  WHERE source = 'synced';

CREATE UNIQUE INDEX shop_products_prd_code_uq ON shop_products(prd_code);
```

Tabella nuova `sync_settings` (singleton) per HMAC secret + Site A allowlist:

```sql
CREATE TABLE public.sync_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  hmac_secret_encrypted text NOT NULL DEFAULT '',
  allowed_source_origins text[] NOT NULL DEFAULT '{}',
  default_synced_image_url text,             -- immagine di fallback
  auto_publish_to_whop boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- + GRANT service_role, RLS admin-only
```

RLS pubblica su `shop_products`: estendere policy `public read` con
`AND (source = 'native' OR true)` — la lettura singola via slug `PRD-xxxxx` resta possibile, ma le **query di listing** (categoria, sale, home, search, sitemap) devono filtrare `source = 'native' AND hidden_from_listing = false` lato server-fn.

## 2. Server-fn modifiche

- `shop.functions.ts → listProducts / listByCategory / listFeatured / listSale`: aggiungere `WHERE source = 'native' AND hidden_from_listing = false`.
- `getProductBySlug`: nessun filtro (così `PRD-xxxxx` risolve via link diretto).
- Aggiungere `<meta name="robots" content="noindex,nofollow">` nel `head()` di `shop.prodotto.$slug.tsx` quando il prodotto ha `source = 'synced'`.
- Escludere `synced` dalla sitemap.

## 3. Webhook pubblico — `POST /api/public/sync-product`

`src/routes/api.public.sync-product.ts` (TanStack server route):

- Verifica `x-sync-signature` = `HMAC-SHA256(body, sync_settings.hmac_secret)` con `timingSafeEqual`.
- Verifica `Origin` ∈ `allowed_source_origins`.
- Zod schema input:
  ```
  { source_store_id, source_product_ref, title, description?,
    price, compare_at_price?, currency, image_url?,
    variants?: [{label, price_override?, stock?}] }
  ```
- Logica:
  1. Cerca prodotto esistente per `(source_store_id, source_product_ref)`.
  2. Se non esiste: genera `prd_code = PRD-` + 5 cifre random (loop su collisioni, ~100K spazio).
  3. Upsert in `shop_products` con `source='synced'`, `published=true`, `hidden_from_listing=true`, `title = prd_code`, `image_url = payload.image_url || sync_settings.default_synced_image_url || null`.
  4. Upsert varianti.
  5. Se `bridge_stores.checkout_provider = 'whop'` e `auto_publish_to_whop`: chiama `whopUpsertProduct()` (vedi sotto), salva `whop_product_id` + `whop_plan_id`, `whop_synced_at`.
- Restituisce `{ ok, prd_code, public_url, whop: { product_id, plan_id } }` così Site A può salvare il link.

## 4. Integrazione Whop (helper esistente o nuovo)

`src/lib/whop.server.ts`:

- `whopUpsertProduct({ company_id, title, price, currency, image_url, api_key })`
  - `POST https://api.whop.com/api/v2/products` (create) o `PATCH` se `whop_product_id` esiste.
  - Crea plan one-time per quel product.
  - Ritorna `{ product_id, plan_id }`.
- API key e company_id presi da `bridge_stores` (campi `whop_api_key_encrypted`, `whop_company_id`).

L'iframe checkout già esistente (`shop.checkout.whop.tsx`) usa `whop_plan_id` salvato sul prodotto → zero modifiche necessarie.

## 5. Admin UI

**Nuova scheda `/ponte-admin/sync`**:
- Lista paginata `shop_products WHERE source='synced'`.
- Per riga: `PRD-XXXXX`, thumbnail, prezzo, `source_store_id`, status Whop (✓ sincronizzato / ⚠ errore / ⏳ in attesa), link pubblico, pulsante "Risync Whop", pulsante "Imposta immagine".
- Modale "Imposta immagine": URL o upload → `shop_products.image_url`. Salva e (se Whop attivo) ri-pusha l'immagine.
- Sezione impostazioni globali: HMAC secret (genera/copia), allowed origins, `default_synced_image_url`, toggle `auto_publish_to_whop`.

**Scheda `/ponte-admin/prodotti`** resta invariata (solo `source='native'`).

## 6. Prompt per Site A

Documento `/mnt/documents/site-a-integration-prompt.md` con:

- Spiegazione architettura (Site A vetrina, Store B catalogo + Whop/Shopify).
- Endpoint: `POST https://<store-b>/api/public/sync-product`.
- Headers richiesti: `Content-Type`, `x-sync-signature`, `Origin`.
- Payload Zod-equivalente in JSON.
- Esempio firma HMAC in Node/PHP.
- Trigger consigliato: bottone "Pubblica su Store B" nella scheda prodotto admin di Site A → invia payload, salva la `public_url` restituita.
- Nota: Site A non parla più con Shopify direttamente — parla con Store B che decide il routing (Shopify Bridge o Whop) in base alla config dello store.
- Esempio prompt "copia-incolla in Lovable di Site A" con istruzioni passo-passo.

## 7. Testing

1. Migration applicata.
2. `curl` con HMAC valido → prodotto creato come `PRD-xxxxx`, hidden.
3. Visita `/shop/categoria/uomo` → prodotto sync NON appare.
4. Visita `/shop/prodotto/PRD-xxxxx` → si vede, ha `noindex`.
5. Se store Whop attivo → `whop_product_id` popolato, iframe checkout funziona.
6. Admin → cambio immagine → riflesso su DB + Whop.

---

## Note tecniche

- HMAC secret salvato cifrato con `crypto.server.ts` esistente (stessa logica delle Shopify token).
- Codice PRD: generato con `crypto.randomInt(10000, 99999)`, retry su collisione UNIQUE.
- Slug del prodotto sync = `prd_code` lowercase (`prd-08112`) per URL pulito.
- Le query di listing già passano per server-fn quindi nessuna leak via REST diretta a Supabase.

## Cosa NON cambio

- Catalogo nativo, Shopify Bridge, checkout esistente, admin prodotti nativi, header/footer/shop.
- L'iframe Whop checkout resta come l'ho appena rifatto.
