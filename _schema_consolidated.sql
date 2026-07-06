-- >>> 20260603031533_184d34bc-9774-4522-bbbe-af9fcc0c7a4b.sql

-- =========================================
-- ROLES
-- =========================================
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin','moderator','user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

DO $$ BEGIN
  CREATE POLICY "Users can view own roles" ON public.user_roles
    FOR SELECT TO authenticated USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Seed admin role for the configured admin user
INSERT INTO public.user_roles (user_id, role)
VALUES ('4d150ba6-60e4-44c7-b3cf-bb952499e084', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;

-- =========================================
-- SITE SETTINGS (singleton)
-- =========================================
CREATE TABLE IF NOT EXISTS public.site_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  brand_name text NOT NULL DEFAULT 'Atelier Nord',
  brand_url text NOT NULL DEFAULT 'ateliernord.eu',
  logo_url text,
  logo_dark_url text,
  support_email text NOT NULL DEFAULT 'hello@ateliernord.eu',
  privacy_email text NOT NULL DEFAULT 'privacy@ateliernord.eu',
  legal_address text,
  vat_number text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.site_settings TO anon, authenticated;
GRANT ALL ON public.site_settings TO service_role;
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "site_settings public read" ON public.site_settings FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
INSERT INTO public.site_settings (singleton) VALUES (true) ON CONFLICT DO NOTHING;

-- =========================================
-- SHOPIFY STORES (legacy compare table)
-- =========================================
CREATE TABLE IF NOT EXISTS public.shopify_stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  shop_domain text NOT NULL UNIQUE,
  storefront_access_token text,
  currency text DEFAULT 'EUR',
  status text DEFAULT 'active',
  logo_url text,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.shopify_stores TO anon, authenticated;
GRANT ALL ON public.shopify_stores TO service_role;
ALTER TABLE public.shopify_stores ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "shopify_stores public read" ON public.shopify_stores FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================================
-- COMPARED PRODUCTS + ARTICLES
-- =========================================
CREATE TABLE IF NOT EXISTS public.compared_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  image_url text,
  price numeric,
  compare_at_price numeric,
  currency text DEFAULT 'EUR',
  category text,
  shopify_store_id uuid REFERENCES public.shopify_stores(id) ON DELETE SET NULL,
  shopify_product_handle text,
  featured boolean NOT NULL DEFAULT false,
  published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.compared_products TO anon, authenticated;
GRANT ALL ON public.compared_products TO service_role;
ALTER TABLE public.compared_products ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "compared_products public read" ON public.compared_products FOR SELECT USING (published = true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  excerpt text,
  content text,
  cover_image text,
  category text,
  featured boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.articles TO anon, authenticated;
GRANT ALL ON public.articles TO service_role;
ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "articles public read" ON public.articles FOR SELECT USING (published_at IS NOT NULL AND published_at <= now());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================================
-- BRIDGE STORES + related
-- =========================================
CREATE TABLE IF NOT EXISTS public.bridge_stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_a_store_id uuid NOT NULL UNIQUE,
  shop_domain text NOT NULL,
  display_name text,
  shopify_access_token_encrypted text NOT NULL DEFAULT '',
  shopify_api_version text NOT NULL DEFAULT '2024-10',
  shopify_api_key_encrypted text,
  shopify_api_secret_encrypted text,
  bridge_api_key_hash text NOT NULL DEFAULT '',
  bridge_api_key_encrypted text NOT NULL DEFAULT '',
  shopify_webhook_secret_encrypted text,
  callback_url text,
  allowed_origin text,
  is_active boolean NOT NULL DEFAULT true,
  last_handshake_at timestamptz,
  last_sync_at timestamptz,
  last_callback_at timestamptz,
  last_error text,
  default_tags text,
  default_order_note text,
  default_note_attributes jsonb DEFAULT '[]'::jsonb,
  user_agent text,
  rate_limit_rps int DEFAULT 2,
  custom_domains text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bridge_stores TO authenticated;
GRANT ALL ON public.bridge_stores TO service_role;
ALTER TABLE public.bridge_stores ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "bridge_stores admin all" ON public.bridge_stores FOR ALL TO authenticated
    USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.bridge_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES public.bridge_stores(id) ON DELETE CASCADE,
  direction text NOT NULL,
  endpoint text NOT NULL,
  http_status int,
  success boolean NOT NULL DEFAULT false,
  payload jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bridge_logs TO authenticated;
GRANT ALL ON public.bridge_logs TO service_role;
ALTER TABLE public.bridge_logs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "bridge_logs admin all" ON public.bridge_logs FOR ALL TO authenticated
    USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.bridge_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.bridge_stores(id) ON DELETE CASCADE,
  shopify_order_id text NOT NULL,
  order_number text,
  total_price numeric,
  currency text,
  financial_status text,
  cancelled_at timestamptz,
  created_at_shopify timestamptz,
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, shopify_order_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bridge_orders TO authenticated;
GRANT ALL ON public.bridge_orders TO service_role;
ALTER TABLE public.bridge_orders ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "bridge_orders admin all" ON public.bridge_orders FOR ALL TO authenticated
    USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.bridge_revenue_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.bridge_stores(id) ON DELETE CASCADE,
  shopify_order_id text NOT NULL,
  event_type text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  currency text,
  order_number text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, shopify_order_id, event_type)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bridge_revenue_events TO authenticated;
GRANT ALL ON public.bridge_revenue_events TO service_role;
ALTER TABLE public.bridge_revenue_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "bridge_revenue_events admin all" ON public.bridge_revenue_events FOR ALL TO authenticated
    USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.bridge_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.bridge_stores(id) ON DELETE CASCADE,
  shopify_webhook_id bigint NOT NULL,
  topic text NOT NULL,
  address text NOT NULL,
  format text DEFAULT 'json',
  status text DEFAULT 'active',
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, shopify_webhook_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bridge_webhooks TO authenticated;
GRANT ALL ON public.bridge_webhooks TO service_role;
ALTER TABLE public.bridge_webhooks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "bridge_webhooks admin all" ON public.bridge_webhooks FOR ALL TO authenticated
    USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.bridge_referrer_probes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES public.bridge_stores(id) ON DELETE CASCADE,
  referer text,
  user_agent text,
  target_host text,
  source text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bridge_referrer_probes TO authenticated;
GRANT ALL ON public.bridge_referrer_probes TO service_role;
ALTER TABLE public.bridge_referrer_probes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "bridge_referrer_probes admin all" ON public.bridge_referrer_probes FOR ALL TO authenticated
    USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.bridge_rate_limits (
  store_id uuid PRIMARY KEY REFERENCES public.bridge_stores(id) ON DELETE CASCADE,
  last_call_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bridge_rate_limits TO authenticated;
GRANT ALL ON public.bridge_rate_limits TO service_role;
ALTER TABLE public.bridge_rate_limits ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "bridge_rate_limits admin all" ON public.bridge_rate_limits FOR ALL TO authenticated
    USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.bridge_wash_nonces (
  rid text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bridge_wash_nonces TO authenticated;
GRANT ALL ON public.bridge_wash_nonces TO service_role;
ALTER TABLE public.bridge_wash_nonces ENABLE ROW LEVEL SECURITY;

-- =========================================
-- SHOP (catalog)
-- =========================================
CREATE TABLE IF NOT EXISTS public.shop_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  image_url text,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.shop_categories TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.shop_categories TO authenticated;
GRANT ALL ON public.shop_categories TO service_role;
ALTER TABLE public.shop_categories ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "shop_categories public read" ON public.shop_categories FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "shop_categories admin write" ON public.shop_categories FOR ALL TO authenticated
    USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.shop_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  description text,
  long_description text,
  price numeric NOT NULL DEFAULT 0,
  compare_at_price numeric,
  currency text NOT NULL DEFAULT 'EUR',
  image_url text,
  gallery jsonb DEFAULT '[]'::jsonb,
  brand text,
  category_id uuid REFERENCES public.shop_categories(id) ON DELETE SET NULL,
  featured boolean NOT NULL DEFAULT false,
  published boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  bridge_store_id uuid REFERENCES public.bridge_stores(id) ON DELETE SET NULL,
  prd_code text NOT NULL DEFAULT 'PRD-00000',
  shopify_product_id text,
  shopify_product_handle text,
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.shop_products TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.shop_products TO authenticated;
GRANT ALL ON public.shop_products TO service_role;
ALTER TABLE public.shop_products ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "shop_products public read" ON public.shop_products FOR SELECT USING (published = true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "shop_products admin write" ON public.shop_products FOR ALL TO authenticated
    USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.shop_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.shop_products(id) ON DELETE CASCADE,
  label text NOT NULL,
  size text,
  color text,
  sku text,
  price_override numeric,
  stock int,
  shopify_variant_label text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.shop_variants TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.shop_variants TO authenticated;
GRANT ALL ON public.shop_variants TO service_role;
ALTER TABLE public.shop_variants ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "shop_variants public read" ON public.shop_variants FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "shop_variants admin write" ON public.shop_variants FOR ALL TO authenticated
    USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================================
-- CAPI (singleton config + events log)
-- =========================================
CREATE TABLE IF NOT EXISTS public.capi_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  shopify_webhook_secret text,
  meta_pixel_id text,
  meta_access_token text,
  target_site_url text,
  meta_test_event_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.capi_config TO authenticated;
GRANT ALL ON public.capi_config TO service_role;
ALTER TABLE public.capi_config ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "capi_config admin all" ON public.capi_config FOR ALL TO authenticated
    USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
INSERT INTO public.capi_config (singleton) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.capi_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text,
  status text NOT NULL,
  http_status int,
  meta_event_name text,
  error text,
  payload_excerpt text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.capi_events TO authenticated;
GRANT ALL ON public.capi_events TO service_role;
ALTER TABLE public.capi_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "capi_events admin all" ON public.capi_events FOR ALL TO authenticated
    USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- >>> 20260603032000_53017f1f-6766-4ca1-b40a-5843b13c6857.sql

ALTER TABLE public.bridge_stores
  ADD COLUMN IF NOT EXISTS checkout_provider text NOT NULL DEFAULT 'shopify'
    CHECK (checkout_provider IN ('shopify','native','whop')),
  ADD COLUMN IF NOT EXISTS whop_api_key_encrypted text,
  ADD COLUMN IF NOT EXISTS whop_product_id text,
  ADD COLUMN IF NOT EXISTS whop_plan_id text,
  ADD COLUMN IF NOT EXISTS whop_webhook_secret_encrypted text;

-- >>> 20260603034250_7e688a82-e5bb-443c-ba34-0648d996a907.sql
ALTER TABLE public.shop_products
  ADD COLUMN IF NOT EXISTS whop_product_id text,
  ADD COLUMN IF NOT EXISTS whop_plan_id text,
  ADD COLUMN IF NOT EXISTS whop_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS whop_sync_error text;
-- >>> 20260603042332_67ecda45-535c-4b85-b91b-614b7d511453.sql
ALTER TABLE public.bridge_stores ADD COLUMN IF NOT EXISTS whop_company_id TEXT;
-- >>> 20260603172349_566aa881-77cc-406e-b3cc-493b833d27f2.sql

ALTER TABLE public.shop_products
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'native',
  ADD COLUMN IF NOT EXISTS source_store_id text,
  ADD COLUMN IF NOT EXISTS source_product_ref text,
  ADD COLUMN IF NOT EXISTS source_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS hidden_from_listing boolean NOT NULL DEFAULT false;

ALTER TABLE public.shop_products
  DROP CONSTRAINT IF EXISTS shop_products_source_check;
ALTER TABLE public.shop_products
  ADD CONSTRAINT shop_products_source_check CHECK (source IN ('native','synced'));

CREATE UNIQUE INDEX IF NOT EXISTS shop_products_source_uq
  ON public.shop_products(source_store_id, source_product_ref)
  WHERE source = 'synced';

CREATE TABLE IF NOT EXISTS public.sync_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  hmac_secret_encrypted text NOT NULL DEFAULT '',
  allowed_source_origins text[] NOT NULL DEFAULT '{}',
  default_synced_image_url text,
  auto_publish_to_whop boolean NOT NULL DEFAULT true,
  default_whop_store_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_settings TO authenticated;
GRANT ALL ON public.sync_settings TO service_role;

ALTER TABLE public.sync_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sync_settings admin all" ON public.sync_settings;
CREATE POLICY "sync_settings admin all" ON public.sync_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

INSERT INTO public.sync_settings (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

-- >>> 20260603174250_1deceae4-8af3-4ce5-8113-bf2418f07014.sql
ALTER TABLE public.bridge_stores ADD COLUMN IF NOT EXISTS sync_key text;
CREATE UNIQUE INDEX IF NOT EXISTS bridge_stores_sync_key_uq ON public.bridge_stores(sync_key) WHERE sync_key IS NOT NULL;
-- >>> 20260604232201_d7e99d17-47f2-4e98-95cb-e23463b341cc.sql

CREATE TABLE public.bridge_handshake_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  site_a_store_id uuid,
  shop_domain text,
  integration_type text,
  outcome text NOT NULL,
  reason text,
  ip text,
  user_agent text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT ALL ON public.bridge_handshake_log TO service_role;
GRANT SELECT ON public.bridge_handshake_log TO authenticated;

ALTER TABLE public.bridge_handshake_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bridge_handshake_log admin read"
ON public.bridge_handshake_log
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX bridge_handshake_log_store_idx ON public.bridge_handshake_log (site_a_store_id, created_at DESC);

-- >>> 20260604232730_94409785-de4c-4d57-8800-1124350dbf1a.sql

CREATE TABLE public.shadow_checkout_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  site_a_store_id text,
  integration_type text,
  outcome text NOT NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  redirect_url text,
  error text,
  duration_ms integer,
  warmup boolean NOT NULL DEFAULT false,
  ip text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT ALL ON public.shadow_checkout_log TO service_role;
GRANT SELECT ON public.shadow_checkout_log TO authenticated;
ALTER TABLE public.shadow_checkout_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shadow_checkout_log admin read"
  ON public.shadow_checkout_log
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
CREATE INDEX shadow_checkout_log_store_idx
  ON public.shadow_checkout_log (site_a_store_id, created_at DESC);

CREATE TABLE public.native_checkout_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  site_a_store_id text NOT NULL,
  bridge_store_id uuid,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  currency text NOT NULL DEFAULT 'EUR',
  amount_total numeric NOT NULL DEFAULT 0,
  locale text,
  country text,
  status text NOT NULL DEFAULT 'pending',
  redirect_url text,
  external_session_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT ALL ON public.native_checkout_sessions TO service_role;
GRANT SELECT ON public.native_checkout_sessions TO authenticated;
ALTER TABLE public.native_checkout_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "native_checkout_sessions admin read"
  ON public.native_checkout_sessions
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
CREATE INDEX native_checkout_sessions_store_idx
  ON public.native_checkout_sessions (site_a_store_id, created_at DESC);

-- >>> 20260604234238_2440155f-3f07-43d2-b0fa-0cea11f1235e.sql
CREATE TABLE IF NOT EXISTS public.shadow_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_store_id text NOT NULL,
  source_product_id text NOT NULL,
  shadow_handle text NOT NULL UNIQUE,
  shadow_title text NOT NULL,
  shopify_product_id text,
  shopify_handle text,
  product_url text,
  variant_map jsonb NOT NULL DEFAULT '[]'::jsonb,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  status text NOT NULL DEFAULT 'draft',
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_store_id, source_product_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shadow_products TO authenticated;
GRANT ALL ON public.shadow_products TO service_role;
ALTER TABLE public.shadow_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shadow_products admin read" ON public.shadow_products
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.bridge_push_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_a_store_id text,
  source_product_id text,
  shadow_handle text,
  shopify_product_id text,
  http_status integer,
  outcome text NOT NULL,
  error text,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.bridge_push_log TO authenticated;
GRANT ALL ON public.bridge_push_log TO service_role;
ALTER TABLE public.bridge_push_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bridge_push_log admin read" ON public.bridge_push_log
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_shadow_products_source ON public.shadow_products(source_store_id, source_product_id);
CREATE INDEX IF NOT EXISTS idx_bridge_push_log_store_created ON public.bridge_push_log(site_a_store_id, created_at DESC);
-- >>> 20260605013118_997e2aad-6765-4071-85ef-03d1ebcded87.sql
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS apple_pay_verification text;
-- >>> 20260608005828_2b1f0afe-e29b-48ee-bb9e-68dfd7bbb37c.sql
CREATE OR REPLACE FUNCTION public.bridge_handshake(
  _store_id uuid,
  _api_key_hash text,
  _shop_domain text DEFAULT NULL,
  _integration_type text DEFAULT NULL,
  _callback_url text DEFAULT NULL,
  _ip text DEFAULT NULL,
  _user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _store RECORD;
BEGIN
  IF _store_id IS NULL THEN
    INSERT INTO public.bridge_handshake_log (
      site_a_store_id, shop_domain, integration_type, outcome, reason, ip, user_agent
    ) VALUES (
      NULL, _shop_domain, _integration_type, 'invalid_body', 'missing_store_id', _ip, _user_agent
    );

    RETURN jsonb_build_object(
      'ok', false,
      'status', 400,
      'error', 'Invalid handshake body',
      'step', 'body_validation',
      'details', jsonb_build_object('reason', 'missing_store_id')
    );
  END IF;

  SELECT id, site_a_store_id, bridge_api_key_hash, is_active
  INTO _store
  FROM public.bridge_stores
  WHERE site_a_store_id = _store_id
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.bridge_handshake_log (
      site_a_store_id, shop_domain, integration_type, outcome, reason, ip, user_agent
    ) VALUES (
      _store_id, _shop_domain, _integration_type, 'store_not_registered', NULL, _ip, _user_agent
    );

    RETURN jsonb_build_object(
      'ok', false,
      'status', 401,
      'error', 'Unknown store_id',
      'step', 'store_lookup',
      'details', jsonb_build_object('store_id', _store_id)
    );
  END IF;

  IF COALESCE(_api_key_hash, '') = '' OR COALESCE(_store.bridge_api_key_hash, '') <> _api_key_hash THEN
    INSERT INTO public.bridge_handshake_log (
      site_a_store_id, shop_domain, integration_type, outcome, reason, ip, user_agent
    ) VALUES (
      _store_id, _shop_domain, _integration_type, 'invalid_api_key', 'hash_mismatch', _ip, _user_agent
    );

    RETURN jsonb_build_object(
      'ok', false,
      'status', 401,
      'error', 'Invalid API key',
      'step', 'api_key_validation',
      'details', jsonb_build_object('reason', 'hash_mismatch')
    );
  END IF;

  IF COALESCE(_store.is_active, false) IS NOT TRUE THEN
    INSERT INTO public.bridge_handshake_log (
      site_a_store_id, shop_domain, integration_type, outcome, reason, ip, user_agent
    ) VALUES (
      _store_id, _shop_domain, _integration_type, 'error', 'store_disabled', _ip, _user_agent
    );

    RETURN jsonb_build_object(
      'ok', false,
      'status', 403,
      'error', 'Store disabled',
      'step', 'store_status',
      'details', jsonb_build_object('is_active', false)
    );
  END IF;

  UPDATE public.bridge_stores
  SET
    last_handshake_at = now(),
    last_error = NULL,
    callback_url = COALESCE(NULLIF(_callback_url, ''), callback_url)
  WHERE id = _store.id;

  INSERT INTO public.bridge_handshake_log (
    site_a_store_id, shop_domain, integration_type, outcome, reason, ip, user_agent
  ) VALUES (
    _store_id, _shop_domain, _integration_type, 'ok', NULL, _ip, _user_agent
  );

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'state', 'connected',
    'message', 'Bridge handshake OK'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bridge_handshake(uuid, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bridge_handshake(uuid, text, text, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.bridge_handshake(uuid, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_handshake(uuid, text, text, text, text, text, text) TO service_role;
-- >>> 20260608010150_192681d3-a28f-4c53-91fc-eb884b9b8b88.sql
GRANT EXECUTE ON FUNCTION public.bridge_handshake(uuid, text, text, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.bridge_handshake(uuid, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_handshake(uuid, text, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_handshake(uuid, text, text, text, text, text, text) TO supabase_read_only_user;
-- >>> 20260608010250_5da1d925-7cd8-4096-a836-c5e861b16057.sql
CREATE OR REPLACE FUNCTION public.bridge_handshake(
  _store_id uuid,
  _api_key_hash text,
  _shop_domain text DEFAULT NULL,
  _integration_type text DEFAULT NULL,
  _callback_url text DEFAULT NULL,
  _ip text DEFAULT NULL,
  _user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _store RECORD;
BEGIN
  PERFORM set_config('app.bridge_handshake_rpc', '1', true);
  PERFORM set_config('app.bridge_store_id', COALESCE(_store_id::text, ''), true);
  PERFORM set_config('app.bridge_api_key_hash', COALESCE(_api_key_hash, ''), true);

  IF _store_id IS NULL THEN
    INSERT INTO public.bridge_handshake_log (
      site_a_store_id, shop_domain, integration_type, outcome, reason, ip, user_agent
    ) VALUES (
      NULL, _shop_domain, _integration_type, 'invalid_body', 'missing_store_id', _ip, _user_agent
    );

    RETURN jsonb_build_object(
      'ok', false,
      'status', 400,
      'error', 'Invalid handshake body',
      'step', 'body_validation',
      'details', jsonb_build_object('reason', 'missing_store_id')
    );
  END IF;

  SELECT id, site_a_store_id, bridge_api_key_hash, is_active
  INTO _store
  FROM public.bridge_stores
  WHERE site_a_store_id = _store_id
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.bridge_handshake_log (
      site_a_store_id, shop_domain, integration_type, outcome, reason, ip, user_agent
    ) VALUES (
      _store_id, _shop_domain, _integration_type, 'store_not_registered', NULL, _ip, _user_agent
    );

    RETURN jsonb_build_object(
      'ok', false,
      'status', 401,
      'error', 'Unknown store_id',
      'step', 'store_lookup',
      'details', jsonb_build_object('store_id', _store_id)
    );
  END IF;

  IF COALESCE(_api_key_hash, '') = '' OR COALESCE(_store.bridge_api_key_hash, '') <> _api_key_hash THEN
    INSERT INTO public.bridge_handshake_log (
      site_a_store_id, shop_domain, integration_type, outcome, reason, ip, user_agent
    ) VALUES (
      _store_id, _shop_domain, _integration_type, 'invalid_api_key', 'hash_mismatch', _ip, _user_agent
    );

    RETURN jsonb_build_object(
      'ok', false,
      'status', 401,
      'error', 'Invalid API key',
      'step', 'api_key_validation',
      'details', jsonb_build_object('reason', 'hash_mismatch')
    );
  END IF;

  IF COALESCE(_store.is_active, false) IS NOT TRUE THEN
    INSERT INTO public.bridge_handshake_log (
      site_a_store_id, shop_domain, integration_type, outcome, reason, ip, user_agent
    ) VALUES (
      _store_id, _shop_domain, _integration_type, 'error', 'store_disabled', _ip, _user_agent
    );

    RETURN jsonb_build_object(
      'ok', false,
      'status', 403,
      'error', 'Store disabled',
      'step', 'store_status',
      'details', jsonb_build_object('is_active', false)
    );
  END IF;

  UPDATE public.bridge_stores
  SET
    last_handshake_at = now(),
    last_error = NULL,
    callback_url = COALESCE(NULLIF(_callback_url, ''), callback_url)
  WHERE id = _store.id;

  INSERT INTO public.bridge_handshake_log (
    site_a_store_id, shop_domain, integration_type, outcome, reason, ip, user_agent
  ) VALUES (
    _store_id, _shop_domain, _integration_type, 'ok', NULL, _ip, _user_agent
  );

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'state', 'connected',
    'message', 'Bridge handshake OK'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.bridge_handshake(uuid, text, text, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.bridge_handshake(uuid, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_handshake(uuid, text, text, text, text, text, text) TO service_role;
GRANT SELECT, UPDATE ON public.bridge_stores TO anon;
GRANT INSERT ON public.bridge_handshake_log TO anon;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bridge_stores' AND policyname = 'Bridge RPC can read requested store'
  ) THEN
    CREATE POLICY "Bridge RPC can read requested store"
    ON public.bridge_stores
    FOR SELECT
    TO anon
    USING (
      current_setting('app.bridge_handshake_rpc', true) = '1'
      AND site_a_store_id::text = current_setting('app.bridge_store_id', true)
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bridge_stores' AND policyname = 'Bridge RPC can update verified store'
  ) THEN
    CREATE POLICY "Bridge RPC can update verified store"
    ON public.bridge_stores
    FOR UPDATE
    TO anon
    USING (
      current_setting('app.bridge_handshake_rpc', true) = '1'
      AND site_a_store_id::text = current_setting('app.bridge_store_id', true)
      AND bridge_api_key_hash = current_setting('app.bridge_api_key_hash', true)
    )
    WITH CHECK (
      current_setting('app.bridge_handshake_rpc', true) = '1'
      AND site_a_store_id::text = current_setting('app.bridge_store_id', true)
      AND bridge_api_key_hash = current_setting('app.bridge_api_key_hash', true)
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bridge_handshake_log' AND policyname = 'Bridge RPC can insert handshake logs'
  ) THEN
    CREATE POLICY "Bridge RPC can insert handshake logs"
    ON public.bridge_handshake_log
    FOR INSERT
    TO anon
    WITH CHECK (current_setting('app.bridge_handshake_rpc', true) = '1');
  END IF;
END $$;
-- >>> 20260608013626_d4c0c7e2-30f6-4a1a-ac70-2749fcf5a28d.sql
CREATE OR REPLACE FUNCTION public.bridge_push_shadow_prepare(
  _store_id uuid,
  _api_key_hash text,
  _source_product_id text,
  _shadow_handle text,
  _shadow_title text,
  _ip text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _store RECORD;
  _existing RECORD;
BEGIN
  IF _store_id IS NULL THEN
    INSERT INTO public.bridge_push_log (
      site_a_store_id, source_product_id, shadow_handle, http_status, outcome, error, ip
    ) VALUES (
      NULL, _source_product_id, _shadow_handle, 400, 'invalid_body', 'missing_store_id', _ip
    );

    RETURN jsonb_build_object(
      'ok', false,
      'status', 400,
      'error', 'Invalid push-shadow-product body',
      'step', 'body_validation',
      'details', jsonb_build_object('reason', 'missing_store_id')
    );
  END IF;

  SELECT
    id,
    site_a_store_id,
    shop_domain,
    shopify_access_token_encrypted,
    shopify_api_version,
    bridge_api_key_hash,
    is_active,
    user_agent
  INTO _store
  FROM public.bridge_stores
  WHERE site_a_store_id = _store_id
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.bridge_push_log (
      site_a_store_id, source_product_id, shadow_handle, http_status, outcome, error, ip
    ) VALUES (
      _store_id::text, _source_product_id, _shadow_handle, 401, 'invalid_api_key', 'store_not_found', _ip
    );

    RETURN jsonb_build_object(
      'ok', false,
      'status', 401,
      'error', 'invalid_api_key',
      'step', 'store_lookup',
      'details', jsonb_build_object('reason', 'store_not_found')
    );
  END IF;

  IF COALESCE(_api_key_hash, '') = '' OR COALESCE(_store.bridge_api_key_hash, '') <> _api_key_hash THEN
    INSERT INTO public.bridge_push_log (
      site_a_store_id, source_product_id, shadow_handle, http_status, outcome, error, ip
    ) VALUES (
      _store_id::text, _source_product_id, _shadow_handle, 401, 'invalid_api_key', 'hash_mismatch', _ip
    );

    RETURN jsonb_build_object(
      'ok', false,
      'status', 401,
      'error', 'invalid_api_key',
      'step', 'api_key_validation',
      'details', jsonb_build_object('reason', 'hash_mismatch')
    );
  END IF;

  IF COALESCE(_store.is_active, false) IS NOT TRUE THEN
    INSERT INTO public.bridge_push_log (
      site_a_store_id, source_product_id, shadow_handle, http_status, outcome, error, ip
    ) VALUES (
      _store_id::text, _source_product_id, _shadow_handle, 403, 'store_disabled', NULL, _ip
    );

    RETURN jsonb_build_object(
      'ok', false,
      'status', 403,
      'error', 'store_disabled',
      'step', 'store_status',
      'details', jsonb_build_object('is_active', false)
    );
  END IF;

  SELECT shopify_product_id
  INTO _existing
  FROM public.shadow_products
  WHERE source_store_id = _store_id::text
    AND source_product_id = _source_product_id
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'store', jsonb_build_object(
      'id', _store.id,
      'site_a_store_id', _store.site_a_store_id,
      'shop_domain', _store.shop_domain,
      'shopify_access_token_encrypted', _store.shopify_access_token_encrypted,
      'shopify_api_version', _store.shopify_api_version,
      'user_agent', _store.user_agent
    ),
    'existing', jsonb_build_object(
      'shopify_product_id', COALESCE(_existing.shopify_product_id, NULL)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.bridge_push_shadow_record_error(
  _store_id uuid,
  _source_product_id text,
  _shadow_handle text,
  _shadow_title text,
  _error text,
  _ip text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.shadow_products (
    source_store_id,
    source_product_id,
    shadow_handle,
    shadow_title,
    tags,
    status,
    last_error,
    updated_at
  ) VALUES (
    _store_id::text,
    _source_product_id,
    _shadow_handle,
    _shadow_title,
    ARRAY['shadow', 'hidden', 'bridge'],
    'error',
    LEFT(COALESCE(_error, 'unknown_error'), 1000),
    now()
  )
  ON CONFLICT (source_store_id, source_product_id)
  DO UPDATE SET
    shadow_handle = EXCLUDED.shadow_handle,
    shadow_title = EXCLUDED.shadow_title,
    tags = EXCLUDED.tags,
    status = 'error',
    last_error = EXCLUDED.last_error,
    updated_at = now();

  INSERT INTO public.bridge_push_log (
    site_a_store_id, source_product_id, shadow_handle, http_status, outcome, error, ip
  ) VALUES (
    _store_id::text, _source_product_id, _shadow_handle, 502, 'shopify_error', LEFT(COALESCE(_error, 'unknown_error'), 1000), _ip
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.bridge_push_shadow_save_success(
  _store_id uuid,
  _source_product_id text,
  _shadow_handle text,
  _shadow_title text,
  _shopify_product_id text,
  _shopify_handle text,
  _product_url text,
  _variant_map jsonb,
  _ip text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.shadow_products (
    source_store_id,
    source_product_id,
    shadow_handle,
    shadow_title,
    shopify_product_id,
    shopify_handle,
    product_url,
    variant_map,
    tags,
    status,
    last_error,
    updated_at
  ) VALUES (
    _store_id::text,
    _source_product_id,
    _shadow_handle,
    _shadow_title,
    _shopify_product_id,
    _shopify_handle,
    _product_url,
    COALESCE(_variant_map, '[]'::jsonb),
    ARRAY['shadow', 'hidden', 'bridge'],
    'ok',
    NULL,
    now()
  )
  ON CONFLICT (source_store_id, source_product_id)
  DO UPDATE SET
    shadow_handle = EXCLUDED.shadow_handle,
    shadow_title = EXCLUDED.shadow_title,
    shopify_product_id = EXCLUDED.shopify_product_id,
    shopify_handle = EXCLUDED.shopify_handle,
    product_url = EXCLUDED.product_url,
    variant_map = EXCLUDED.variant_map,
    tags = EXCLUDED.tags,
    status = 'ok',
    last_error = NULL,
    updated_at = now();

  INSERT INTO public.bridge_push_log (
    site_a_store_id, source_product_id, shadow_handle, shopify_product_id, http_status, outcome, ip
  ) VALUES (
    _store_id::text, _source_product_id, _shadow_handle, _shopify_product_id, 200, 'ok', _ip
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.bridge_push_shadow_prepare(uuid, text, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.bridge_push_shadow_prepare(uuid, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_push_shadow_prepare(uuid, text, text, text, text, text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bridge_push_shadow_record_error(uuid, text, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.bridge_push_shadow_record_error(uuid, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_push_shadow_record_error(uuid, text, text, text, text, text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bridge_push_shadow_save_success(uuid, text, text, text, text, text, text, jsonb, text) TO anon;
GRANT EXECUTE ON FUNCTION public.bridge_push_shadow_save_success(uuid, text, text, text, text, text, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_push_shadow_save_success(uuid, text, text, text, text, text, text, jsonb, text) TO service_role;
-- >>> 20260608013830_9e90fa48-1401-4cca-a467-efa8478a0bce.sql
CREATE OR REPLACE FUNCTION public.bridge_push_shadow_record_error(
  _store_id uuid,
  _api_key_hash text,
  _source_product_id text,
  _shadow_handle text,
  _shadow_title text,
  _error text,
  _ip text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _store RECORD;
BEGIN
  SELECT id, bridge_api_key_hash, is_active
  INTO _store
  FROM public.bridge_stores
  WHERE site_a_store_id = _store_id
  LIMIT 1;

  IF NOT FOUND OR COALESCE(_api_key_hash, '') = '' OR COALESCE(_store.bridge_api_key_hash, '') <> _api_key_hash OR COALESCE(_store.is_active, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 401,
      'error', 'invalid_api_key',
      'step', 'api_key_validation'
    );
  END IF;

  INSERT INTO public.shadow_products (
    source_store_id,
    source_product_id,
    shadow_handle,
    shadow_title,
    tags,
    status,
    last_error,
    updated_at
  ) VALUES (
    _store_id::text,
    _source_product_id,
    _shadow_handle,
    _shadow_title,
    ARRAY['shadow', 'hidden', 'bridge'],
    'error',
    LEFT(COALESCE(_error, 'unknown_error'), 1000),
    now()
  )
  ON CONFLICT (source_store_id, source_product_id)
  DO UPDATE SET
    shadow_handle = EXCLUDED.shadow_handle,
    shadow_title = EXCLUDED.shadow_title,
    tags = EXCLUDED.tags,
    status = 'error',
    last_error = EXCLUDED.last_error,
    updated_at = now();

  INSERT INTO public.bridge_push_log (
    site_a_store_id, source_product_id, shadow_handle, http_status, outcome, error, ip
  ) VALUES (
    _store_id::text, _source_product_id, _shadow_handle, 502, 'shopify_error', LEFT(COALESCE(_error, 'unknown_error'), 1000), _ip
  );

  RETURN jsonb_build_object('ok', true, 'status', 200);
END;
$$;

CREATE OR REPLACE FUNCTION public.bridge_push_shadow_save_success(
  _store_id uuid,
  _api_key_hash text,
  _source_product_id text,
  _shadow_handle text,
  _shadow_title text,
  _shopify_product_id text,
  _shopify_handle text,
  _product_url text,
  _variant_map jsonb,
  _ip text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _store RECORD;
BEGIN
  SELECT id, bridge_api_key_hash, is_active
  INTO _store
  FROM public.bridge_stores
  WHERE site_a_store_id = _store_id
  LIMIT 1;

  IF NOT FOUND OR COALESCE(_api_key_hash, '') = '' OR COALESCE(_store.bridge_api_key_hash, '') <> _api_key_hash OR COALESCE(_store.is_active, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 401,
      'error', 'invalid_api_key',
      'step', 'api_key_validation'
    );
  END IF;

  INSERT INTO public.shadow_products (
    source_store_id,
    source_product_id,
    shadow_handle,
    shadow_title,
    shopify_product_id,
    shopify_handle,
    product_url,
    variant_map,
    tags,
    status,
    last_error,
    updated_at
  ) VALUES (
    _store_id::text,
    _source_product_id,
    _shadow_handle,
    _shadow_title,
    _shopify_product_id,
    _shopify_handle,
    _product_url,
    COALESCE(_variant_map, '[]'::jsonb),
    ARRAY['shadow', 'hidden', 'bridge'],
    'ok',
    NULL,
    now()
  )
  ON CONFLICT (source_store_id, source_product_id)
  DO UPDATE SET
    shadow_handle = EXCLUDED.shadow_handle,
    shadow_title = EXCLUDED.shadow_title,
    shopify_product_id = EXCLUDED.shopify_product_id,
    shopify_handle = EXCLUDED.shopify_handle,
    product_url = EXCLUDED.product_url,
    variant_map = EXCLUDED.variant_map,
    tags = EXCLUDED.tags,
    status = 'ok',
    last_error = NULL,
    updated_at = now();

  INSERT INTO public.bridge_push_log (
    site_a_store_id, source_product_id, shadow_handle, shopify_product_id, http_status, outcome, ip
  ) VALUES (
    _store_id::text, _source_product_id, _shadow_handle, _shopify_product_id, 200, 'ok', _ip
  );

  RETURN jsonb_build_object('ok', true, 'status', 200);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bridge_push_shadow_record_error(uuid, text, text, text, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bridge_push_shadow_save_success(uuid, text, text, text, text, text, text, jsonb, text) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.bridge_push_shadow_record_error(uuid, text, text, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.bridge_push_shadow_record_error(uuid, text, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_push_shadow_save_success(uuid, text, text, text, text, text, text, text, jsonb, text) TO anon;
GRANT EXECUTE ON FUNCTION public.bridge_push_shadow_save_success(uuid, text, text, text, text, text, text, text, jsonb, text) TO service_role;
-- >>> 20260608020229_24aba26d-35e8-472d-ad0e-fb118af5fee7.sql
CREATE OR REPLACE FUNCTION public.bridge_push_shadow_prepare(_store_id uuid, _api_key_hash text, _source_product_id text, _shadow_handle text, _shadow_title text, _ip text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _store RECORD;
  _existing RECORD;
BEGIN
  IF _store_id IS NULL THEN
    INSERT INTO public.bridge_push_log (site_a_store_id, source_product_id, shadow_handle, http_status, outcome, error, ip)
    VALUES (NULL, _source_product_id, _shadow_handle, 400, 'invalid_body', 'missing_store_id', _ip);
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', 'Invalid push-shadow-product body', 'step', 'body_validation', 'details', jsonb_build_object('reason', 'missing_store_id'));
  END IF;

  SELECT id, site_a_store_id, shop_domain, shopify_access_token_encrypted, shopify_api_version, bridge_api_key_hash, is_active, user_agent, checkout_provider
  INTO _store
  FROM public.bridge_stores
  WHERE site_a_store_id = _store_id
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.bridge_push_log (site_a_store_id, source_product_id, shadow_handle, http_status, outcome, error, ip)
    VALUES (_store_id::text, _source_product_id, _shadow_handle, 401, 'invalid_api_key', 'store_not_found', _ip);
    RETURN jsonb_build_object('ok', false, 'status', 401, 'error', 'invalid_api_key', 'step', 'store_lookup', 'details', jsonb_build_object('reason', 'store_not_found'));
  END IF;

  IF COALESCE(_api_key_hash, '') = '' OR COALESCE(_store.bridge_api_key_hash, '') <> _api_key_hash THEN
    INSERT INTO public.bridge_push_log (site_a_store_id, source_product_id, shadow_handle, http_status, outcome, error, ip)
    VALUES (_store_id::text, _source_product_id, _shadow_handle, 401, 'invalid_api_key', 'hash_mismatch', _ip);
    RETURN jsonb_build_object('ok', false, 'status', 401, 'error', 'invalid_api_key', 'step', 'api_key_validation', 'details', jsonb_build_object('reason', 'hash_mismatch'));
  END IF;

  IF COALESCE(_store.is_active, false) IS NOT TRUE THEN
    INSERT INTO public.bridge_push_log (site_a_store_id, source_product_id, shadow_handle, http_status, outcome, error, ip)
    VALUES (_store_id::text, _source_product_id, _shadow_handle, 403, 'store_disabled', NULL, _ip);
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', 'store_disabled', 'step', 'store_status', 'details', jsonb_build_object('is_active', false));
  END IF;

  SELECT shopify_product_id INTO _existing
  FROM public.shadow_products
  WHERE source_store_id = _store_id::text AND source_product_id = _source_product_id
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'store', jsonb_build_object(
      'id', _store.id,
      'site_a_store_id', _store.site_a_store_id,
      'shop_domain', _store.shop_domain,
      'shopify_access_token_encrypted', _store.shopify_access_token_encrypted,
      'shopify_api_version', _store.shopify_api_version,
      'user_agent', _store.user_agent,
      'checkout_provider', COALESCE(_store.checkout_provider, 'shopify')
    ),
    'existing', jsonb_build_object('shopify_product_id', COALESCE(_existing.shopify_product_id, NULL))
  );
END;
$function$;
-- >>> 20260608214642_e37c1b9d-3182-4535-83f3-70bfacf3c91a.sql
ALTER TABLE public.shop_products ADD COLUMN IF NOT EXISTS material TEXT;
-- >>> 20260608215250_4976620f-2ba1-4c32-94fe-901c2f445c3a.sql
ALTER TABLE public.shop_products
ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];
-- >>> 20260608231921_256a4d9a-78fc-4ba8-a574-59775755ff02.sql

-- Lovable Sync: tabella prodotti ricevuti + configurazione (api_key + hmac secret cifrati)

CREATE TABLE IF NOT EXISTS public.lovable_sync_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  api_key_encrypted text,
  hmac_secret_encrypted text,
  enabled boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lovable_sync_config TO authenticated;
GRANT ALL ON public.lovable_sync_config TO service_role;
ALTER TABLE public.lovable_sync_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage lovable_sync_config"
  ON public.lovable_sync_config FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.lovable_sync_config (singleton) VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

-- Tabella prodotti sincronizzati dal Sito A (canale Lovable Sync, indipendente dal bridge)
CREATE TABLE IF NOT EXISTS public.lovable_synced_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_ref text NOT NULL,
  external_id text NOT NULL,
  source text NOT NULL DEFAULT 'lovable-sync',
  title text NOT NULL,
  slug text,
  description_short text,
  description_long text,
  price numeric(12,2),
  compare_price numeric(12,2),
  currency text DEFAULT 'EUR',
  locale text DEFAULT 'it',
  images jsonb DEFAULT '[]'::jsonb,
  variants jsonb DEFAULT '[]'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  received_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_ref, external_id)
);
GRANT SELECT ON public.lovable_synced_products TO authenticated;
GRANT ALL ON public.lovable_synced_products TO service_role;
ALTER TABLE public.lovable_synced_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read lovable_synced_products"
  ON public.lovable_synced_products FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_lovable_synced_products_store_ref ON public.lovable_synced_products(store_ref);
CREATE INDEX IF NOT EXISTS idx_lovable_synced_products_received_at ON public.lovable_synced_products(received_at DESC);

-- >>> 20260608234726_f1ec4b45-0aa8-4832-b975-45daec012d9e.sql
CREATE OR REPLACE FUNCTION public.get_public_synced_product_by_slug(_slug text)
RETURNS TABLE (
  source text,
  id uuid,
  slug text,
  title text,
  description text,
  price numeric,
  compare_at_price numeric,
  currency text,
  image_url text,
  gallery jsonb,
  variants jsonb,
  prd_code text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH bridge AS (
    SELECT
      'bridge'::text AS source,
      sp.id,
      COALESCE(sp.shopify_handle, sp.shadow_handle) AS slug,
      COALESCE(NULLIF(sp.shadow_title, ''), sp.shadow_handle) AS title,
      NULL::text AS description,
      COALESCE((sp.variant_map->0->>'price')::numeric, 0::numeric) AS price,
      NULLIF(sp.variant_map->0->>'compare_price', '')::numeric AS compare_at_price,
      'EUR'::text AS currency,
      NULL::text AS image_url,
      '[]'::jsonb AS gallery,
      sp.variant_map AS variants,
      sp.shadow_handle AS prd_code,
      sp.updated_at
    FROM public.shadow_products sp
    WHERE lower(sp.shadow_handle) = lower(_slug)
       OR lower(COALESCE(sp.shopify_handle, '')) = lower(_slug)
    ORDER BY sp.updated_at DESC
    LIMIT 1
  ), synced AS (
    SELECT
      'lovable-sync'::text AS source,
      lp.id,
      COALESCE(lp.slug, lp.external_id) AS slug,
      lp.title,
      COALESCE(lp.description_long, lp.description_short) AS description,
      COALESCE(lp.price, 0::numeric) AS price,
      lp.compare_price AS compare_at_price,
      COALESCE(lp.currency, 'EUR') AS currency,
      CASE
        WHEN jsonb_typeof(lp.images) = 'array' AND jsonb_array_length(lp.images) > 0 AND jsonb_typeof(lp.images->0) = 'string' THEN trim(both '"' from (lp.images->0)::text)
        WHEN jsonb_typeof(lp.images) = 'array' AND jsonb_array_length(lp.images) > 0 AND jsonb_typeof(lp.images->0) = 'object' THEN COALESCE(lp.images->0->>'url', lp.images->0->>'src', lp.images->0->>'image_url')
        ELSE NULL
      END AS image_url,
      COALESCE(lp.images, '[]'::jsonb) AS gallery,
      COALESCE(lp.variants, '[]'::jsonb) AS variants,
      lp.external_id AS prd_code,
      lp.updated_at
    FROM public.lovable_synced_products lp
    WHERE lower(COALESCE(lp.slug, '')) = lower(_slug)
       OR lower(lp.external_id) = lower(_slug)
    ORDER BY lp.updated_at DESC
    LIMIT 1
  )
  SELECT source, id, slug, title, description, price, compare_at_price, currency, image_url, gallery, variants, prd_code
  FROM bridge
  UNION ALL
  SELECT source, id, slug, title, description, price, compare_at_price, currency, image_url, gallery, variants, prd_code
  FROM synced
  WHERE NOT EXISTS (SELECT 1 FROM bridge)
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_synced_product_by_slug(text) TO anon, authenticated, service_role;
-- >>> 20260609004421_d0ecbde0-e27b-485e-9412-34ac2a2a231b.sql
CREATE OR REPLACE FUNCTION public.bridge_create_native_checkout_session(
  _store_id uuid,
  _api_key_hash text,
  _items jsonb,
  _currency text DEFAULT 'EUR',
  _locale text DEFAULT 'en',
  _country text DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb,
  _ip text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _store RECORD;
  _session_id uuid;
  _amount_total numeric := 0;
  _item jsonb;
BEGIN
  IF _store_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', 'invalid_body', 'step', 'body_validation', 'details', jsonb_build_object('reason', 'missing_store_id'));
  END IF;

  SELECT id, site_a_store_id, bridge_api_key_hash, is_active, checkout_provider
  INTO _store
  FROM public.bridge_stores
  WHERE site_a_store_id = _store_id
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.shadow_checkout_log (site_a_store_id, integration_type, outcome, items, error, duration_ms, warmup, ip)
    VALUES (_store_id::text, 'native_bridge', 'invalid_api_key', COALESCE(_items, '[]'::jsonb), 'store_not_found', 0, false, _ip);
    RETURN jsonb_build_object('ok', false, 'status', 401, 'error', 'invalid_api_key', 'step', 'store_lookup', 'details', jsonb_build_object('reason', 'store_not_found'));
  END IF;

  IF COALESCE(_api_key_hash, '') = '' OR COALESCE(_store.bridge_api_key_hash, '') <> _api_key_hash THEN
    INSERT INTO public.shadow_checkout_log (site_a_store_id, integration_type, outcome, items, error, duration_ms, warmup, ip)
    VALUES (_store_id::text, COALESCE(_store.checkout_provider, 'native_bridge'), 'invalid_api_key', COALESCE(_items, '[]'::jsonb), 'hash_mismatch', 0, false, _ip);
    RETURN jsonb_build_object('ok', false, 'status', 401, 'error', 'invalid_api_key', 'step', 'api_key_validation', 'details', jsonb_build_object('reason', 'hash_mismatch'));
  END IF;

  IF COALESCE(_store.is_active, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', 'store_disabled', 'step', 'store_status', 'details', jsonb_build_object('is_active', false));
  END IF;

  IF jsonb_typeof(COALESCE(_items, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(_items, '[]'::jsonb)) < 1 THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', 'invalid_body', 'step', 'body_validation', 'details', jsonb_build_object('reason', 'items_required'));
  END IF;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    _amount_total := _amount_total + COALESCE(NULLIF(_item->>'unit_price', '')::numeric, NULLIF(_item->>'price', '')::numeric, 0) * GREATEST(COALESCE(NULLIF(_item->>'quantity', '')::int, 1), 1);
  END LOOP;

  INSERT INTO public.native_checkout_sessions (
    site_a_store_id,
    bridge_store_id,
    items,
    currency,
    amount_total,
    locale,
    country,
    status,
    metadata
  ) VALUES (
    _store_id::text,
    _store.id,
    _items,
    UPPER(COALESCE(NULLIF(_currency, ''), 'EUR')),
    _amount_total,
    COALESCE(NULLIF(_locale, ''), 'en'),
    NULLIF(_country, ''),
    'pending',
    COALESCE(_metadata, '{}'::jsonb)
  )
  RETURNING id INTO _session_id;

  INSERT INTO public.shadow_checkout_log (site_a_store_id, integration_type, outcome, items, duration_ms, warmup, ip)
  VALUES (_store_id::text, COALESCE(_store.checkout_provider, 'native_bridge'), 'ok', _items, 0, false, _ip);

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'session_id', _session_id,
    'bridge_store_id', _store.id,
    'checkout_provider', COALESCE(_store.checkout_provider, 'native')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.bridge_create_native_checkout_session(uuid, text, jsonb, text, text, text, jsonb, text) TO anon, authenticated, service_role;
-- >>> 20260609005413_d904920b-9eea-49ca-b1a3-8110591c8668.sql
CREATE OR REPLACE FUNCTION public.bridge_create_native_checkout_session(_store_id uuid, _api_key_hash text, _items jsonb, _currency text DEFAULT 'EUR'::text, _locale text DEFAULT 'en'::text, _country text DEFAULT NULL::text, _metadata jsonb DEFAULT '{}'::jsonb, _ip text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _store RECORD;
  _session_id uuid;
  _amount_total numeric := 0;
  _item jsonb;
  _legacy_encrypted_hash text;
BEGIN
  IF _store_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', 'invalid_body', 'step', 'body_validation', 'details', jsonb_build_object('reason', 'missing_store_id'));
  END IF;

  SELECT id, site_a_store_id, bridge_api_key_hash, bridge_api_key_encrypted, is_active, checkout_provider
  INTO _store
  FROM public.bridge_stores
  WHERE site_a_store_id = _store_id
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.shadow_checkout_log (site_a_store_id, integration_type, outcome, items, error, duration_ms, warmup, ip)
    VALUES (_store_id::text, 'native_bridge', 'invalid_api_key', COALESCE(_items, '[]'::jsonb), 'store_not_found', 0, false, _ip);
    RETURN jsonb_build_object('ok', false, 'status', 401, 'error', 'invalid_api_key', 'step', 'store_lookup', 'details', jsonb_build_object('reason', 'store_not_found'));
  END IF;

  IF COALESCE(_store.bridge_api_key_encrypted, '') LIKE 'v1:%' THEN
    _legacy_encrypted_hash := encode(extensions.digest(_store.bridge_api_key_encrypted, 'sha256'), 'hex');
  END IF;

  IF COALESCE(_api_key_hash, '') = '' OR (
    COALESCE(_store.bridge_api_key_hash, '') <> _api_key_hash
    AND COALESCE(_legacy_encrypted_hash, '') <> _api_key_hash
  ) THEN
    INSERT INTO public.shadow_checkout_log (site_a_store_id, integration_type, outcome, items, error, duration_ms, warmup, ip)
    VALUES (_store_id::text, COALESCE(_store.checkout_provider, 'native_bridge'), 'invalid_api_key', COALESCE(_items, '[]'::jsonb), 'hash_mismatch', 0, false, _ip);
    RETURN jsonb_build_object('ok', false, 'status', 401, 'error', 'invalid_api_key', 'step', 'api_key_validation', 'details', jsonb_build_object('reason', 'hash_mismatch'));
  END IF;

  IF COALESCE(_store.is_active, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', 'store_disabled', 'step', 'store_status', 'details', jsonb_build_object('is_active', false));
  END IF;

  IF jsonb_typeof(COALESCE(_items, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(_items, '[]'::jsonb)) < 1 THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', 'invalid_body', 'step', 'body_validation', 'details', jsonb_build_object('reason', 'items_required'));
  END IF;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    _amount_total := _amount_total + COALESCE(NULLIF(_item->>'unit_price', '')::numeric, NULLIF(_item->>'price', '')::numeric, 0) * GREATEST(COALESCE(NULLIF(_item->>'quantity', '')::int, 1), 1);
  END LOOP;

  INSERT INTO public.native_checkout_sessions (
    site_a_store_id,
    bridge_store_id,
    items,
    currency,
    amount_total,
    locale,
    country,
    status,
    metadata
  ) VALUES (
    _store_id::text,
    _store.id,
    _items,
    UPPER(COALESCE(NULLIF(_currency, ''), 'EUR')),
    _amount_total,
    COALESCE(NULLIF(_locale, ''), 'en'),
    NULLIF(_country, ''),
    'pending',
    COALESCE(_metadata, '{}'::jsonb)
  )
  RETURNING id INTO _session_id;

  INSERT INTO public.shadow_checkout_log (site_a_store_id, integration_type, outcome, items, duration_ms, warmup, ip)
  VALUES (_store_id::text, COALESCE(_store.checkout_provider, 'native_bridge'), 'ok', _items, 0, false, _ip);

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'session_id', _session_id,
    'bridge_store_id', _store.id,
    'checkout_provider', COALESCE(_store.checkout_provider, 'native')
  );
END;
$function$;
-- >>> 20260609013242_83357482-9746-40c3-a643-46667b0e16e1.sql
CREATE OR REPLACE FUNCTION public.bridge_create_native_checkout_session(
  _store_id uuid,
  _api_key_hash text,
  _items jsonb,
  _currency text DEFAULT 'EUR'::text,
  _locale text DEFAULT 'en'::text,
  _country text DEFAULT NULL::text,
  _metadata jsonb DEFAULT '{}'::jsonb,
  _ip text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _store RECORD;
  _session_id uuid;
  _amount_total numeric := 0;
  _item jsonb;
  _validation jsonb;
  _validation_status int;
BEGIN
  IF _store_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', 'invalid_body', 'step', 'body_validation', 'details', jsonb_build_object('reason', 'missing_store_id'));
  END IF;

  _validation := public.bridge_handshake(
    _store_id,
    _api_key_hash,
    NULL,
    'native_bridge_checkout',
    NULL,
    _ip,
    NULL
  );
  _validation_status := COALESCE((_validation->>'status')::int, CASE WHEN (_validation->>'ok')::boolean IS TRUE THEN 200 ELSE 500 END);

  IF COALESCE((_validation->>'ok')::boolean, false) IS NOT TRUE THEN
    INSERT INTO public.shadow_checkout_log (site_a_store_id, integration_type, outcome, items, error, duration_ms, warmup, ip)
    VALUES (
      _store_id::text,
      'native_bridge',
      CASE WHEN _validation_status = 401 THEN 'invalid_api_key' ELSE 'error' END,
      COALESCE(_items, '[]'::jsonb),
      COALESCE(_validation->>'error', 'bridge_validation_failed'),
      0,
      false,
      _ip
    );
    RETURN _validation;
  END IF;

  SELECT id, site_a_store_id, bridge_api_key_hash, is_active, checkout_provider
  INTO _store
  FROM public.bridge_stores
  WHERE site_a_store_id = _store_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'status', 401, 'error', 'invalid_api_key', 'step', 'store_lookup', 'details', jsonb_build_object('reason', 'store_not_found'));
  END IF;

  IF jsonb_typeof(COALESCE(_items, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(_items, '[]'::jsonb)) < 1 THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', 'invalid_body', 'step', 'body_validation', 'details', jsonb_build_object('reason', 'items_required'));
  END IF;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    _amount_total := _amount_total + COALESCE(NULLIF(_item->>'unit_price', '')::numeric, NULLIF(_item->>'price', '')::numeric, 0) * GREATEST(COALESCE(NULLIF(_item->>'quantity', '')::int, 1), 1);
  END LOOP;

  INSERT INTO public.native_checkout_sessions (
    site_a_store_id,
    bridge_store_id,
    items,
    currency,
    amount_total,
    locale,
    country,
    status,
    metadata
  ) VALUES (
    _store_id::text,
    _store.id,
    _items,
    UPPER(COALESCE(NULLIF(_currency, ''), 'EUR')),
    _amount_total,
    COALESCE(NULLIF(_locale, ''), 'en'),
    NULLIF(_country, ''),
    'pending',
    COALESCE(_metadata, '{}'::jsonb)
  )
  RETURNING id INTO _session_id;

  INSERT INTO public.shadow_checkout_log (site_a_store_id, integration_type, outcome, items, duration_ms, warmup, ip)
  VALUES (_store_id::text, COALESCE(_store.checkout_provider, 'native_bridge'), 'ok', _items, 0, false, _ip);

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'session_id', _session_id,
    'bridge_store_id', _store.id,
    'checkout_provider', COALESCE(_store.checkout_provider, 'native')
  );
END;
$$;
-- >>> 20260609013734_92a34207-a22d-4d61-a916-0c4991f05f01.sql
CREATE OR REPLACE FUNCTION public.bridge_create_native_checkout_session(
  _store_id uuid,
  _api_key_hash text,
  _items jsonb,
  _currency text DEFAULT 'EUR'::text,
  _locale text DEFAULT 'en'::text,
  _country text DEFAULT NULL::text,
  _metadata jsonb DEFAULT '{}'::jsonb,
  _ip text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _store RECORD;
  _session_id uuid;
  _amount_total numeric := 0;
  _item jsonb;
  _validation jsonb;
  _validation_status int;
BEGIN
  IF _store_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', 'invalid_body', 'step', 'body_validation', 'details', jsonb_build_object('reason', 'missing_store_id'));
  END IF;

  _validation := public.bridge_handshake(
    _store_id,
    _api_key_hash,
    NULL,
    'native_bridge_checkout',
    NULL,
    _ip,
    NULL
  );
  _validation_status := COALESCE((_validation->>'status')::int, CASE WHEN (_validation->>'ok')::boolean IS TRUE THEN 200 ELSE 500 END);

  IF COALESCE((_validation->>'ok')::boolean, false) IS NOT TRUE THEN
    INSERT INTO public.shadow_checkout_log (site_a_store_id, integration_type, outcome, items, error, duration_ms, warmup, ip)
    VALUES (
      _store_id::text,
      'native_bridge',
      CASE WHEN _validation_status = 401 THEN 'invalid_api_key' ELSE 'error' END,
      COALESCE(_items, '[]'::jsonb),
      COALESCE(_validation->>'error', 'bridge_validation_failed'),
      0,
      false,
      _ip
    );
    RETURN _validation;
  END IF;

  SELECT id, site_a_store_id, bridge_api_key_hash, is_active, checkout_provider
  INTO _store
  FROM public.bridge_stores
  WHERE site_a_store_id = _store_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'status', 401, 'error', 'invalid_api_key', 'step', 'store_lookup', 'details', jsonb_build_object('reason', 'store_not_found'));
  END IF;

  IF lower(COALESCE(_store.checkout_provider, 'shopify')) <> 'native' THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'error', 'checkout_provider_not_native', 'step', 'checkout_provider', 'details', jsonb_build_object('checkout_provider', COALESCE(_store.checkout_provider, 'shopify')));
  END IF;

  IF jsonb_typeof(COALESCE(_items, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(_items, '[]'::jsonb)) < 1 THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', 'invalid_body', 'step', 'body_validation', 'details', jsonb_build_object('reason', 'items_required'));
  END IF;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    _amount_total := _amount_total + COALESCE(NULLIF(_item->>'unit_price', '')::numeric, NULLIF(_item->>'price', '')::numeric, 0) * GREATEST(COALESCE(NULLIF(_item->>'quantity', '')::int, 1), 1);
  END LOOP;

  INSERT INTO public.native_checkout_sessions (
    site_a_store_id,
    bridge_store_id,
    items,
    currency,
    amount_total,
    locale,
    country,
    status,
    metadata
  ) VALUES (
    _store_id::text,
    _store.id,
    _items,
    UPPER(COALESCE(NULLIF(_currency, ''), 'EUR')),
    _amount_total,
    COALESCE(NULLIF(_locale, ''), 'en'),
    NULLIF(_country, ''),
    'pending',
    COALESCE(_metadata, '{}'::jsonb)
  )
  RETURNING id INTO _session_id;

  INSERT INTO public.shadow_checkout_log (site_a_store_id, integration_type, outcome, items, duration_ms, warmup, ip)
  VALUES (_store_id::text, COALESCE(_store.checkout_provider, 'native_bridge'), 'ok', _items, 0, false, _ip);

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'session_id', _session_id,
    'bridge_store_id', _store.id,
    'checkout_provider', COALESCE(_store.checkout_provider, 'native')
  );
END;
$$;
-- >>> 20260609014258_3a4aec89-9494-4d11-aee6-c20217a20ea9.sql
CREATE OR REPLACE FUNCTION public.get_native_checkout_session(_session_id uuid)
RETURNS TABLE (
  id uuid,
  site_a_store_id text,
  bridge_store_id uuid,
  items jsonb,
  currency text,
  amount_total numeric,
  status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    ncs.id,
    ncs.site_a_store_id,
    ncs.bridge_store_id,
    ncs.items,
    ncs.currency,
    ncs.amount_total,
    ncs.status
  FROM public.native_checkout_sessions ncs
  WHERE ncs.id = _session_id
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_native_checkout_session(uuid) TO anon, authenticated, service_role;
-- >>> 20260609201151_dde02d08-9756-45dc-86aa-e5809c8bd664.sql

CREATE TABLE IF NOT EXISTS public.bridge_shadow_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bridge_store_id uuid REFERENCES public.bridge_stores(id) ON DELETE CASCADE,
  source_product_id text NOT NULL,
  source_product_code text,
  source_product_slug text,
  title text,
  price numeric,
  currency text,
  whop_product_id text,
  whop_plan_id text,
  whop_checkout_url text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bridge_store_id, source_product_id)
);

CREATE INDEX IF NOT EXISTS bridge_shadow_products_code_idx ON public.bridge_shadow_products (bridge_store_id, source_product_code);
CREATE INDEX IF NOT EXISTS bridge_shadow_products_slug_idx ON public.bridge_shadow_products (bridge_store_id, source_product_slug);

GRANT SELECT ON public.bridge_shadow_products TO authenticated;
GRANT ALL ON public.bridge_shadow_products TO service_role;

ALTER TABLE public.bridge_shadow_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bridge_shadow_products admin read"
  ON public.bridge_shadow_products
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.bridge_shadow_products_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bridge_shadow_products_updated_at ON public.bridge_shadow_products;
CREATE TRIGGER bridge_shadow_products_updated_at
  BEFORE UPDATE ON public.bridge_shadow_products
  FOR EACH ROW EXECUTE FUNCTION public.bridge_shadow_products_set_updated_at();

-- >>> 20260609201803_cd0e02cc-0b2e-4f91-bf57-4598f8e8af6c.sql

CREATE OR REPLACE FUNCTION public.bridge_lookup_session_for_whop(_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _session RECORD;
  _store RECORD;
  _shadow RECORD;
  _source_product_id text;
  _source_product_code text;
  _source_product_slug text;
  _first_item jsonb;
BEGIN
  SELECT id, site_a_store_id, bridge_store_id, items, amount_total, currency, metadata
  INTO _session
  FROM public.native_checkout_sessions
  WHERE id = _session_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'session_not_found');
  END IF;

  IF _session.bridge_store_id IS NULL AND _session.site_a_store_id IS NOT NULL THEN
    UPDATE public.native_checkout_sessions
    SET bridge_store_id = (
      SELECT id FROM public.bridge_stores
      WHERE site_a_store_id = _session.site_a_store_id::uuid AND is_active = true
      LIMIT 1
    )
    WHERE id = _session_id
    RETURNING bridge_store_id INTO _session.bridge_store_id;
  END IF;

  IF _session.bridge_store_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bridge_store_not_found');
  END IF;

  SELECT id, checkout_provider, whop_api_key_encrypted, whop_company_id
  INTO _store
  FROM public.bridge_stores
  WHERE id = _session.bridge_store_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bridge_store_not_found');
  END IF;

  _first_item := COALESCE(_session.items->0, '{}'::jsonb);
  _source_product_id := COALESCE(_session.metadata->>'source_product_id', _first_item->>'source_product_id', _first_item->>'source_product_code', _first_item->>'product_slug', _session_id::text);
  _source_product_code := COALESCE(_session.metadata->>'source_product_code', _first_item->>'source_product_code');
  _source_product_slug := COALESCE(_session.metadata->>'source_product_slug', _first_item->>'source_product_slug', _first_item->>'product_slug');

  SELECT whop_product_id, whop_plan_id, whop_checkout_url
  INTO _shadow
  FROM public.bridge_shadow_products
  WHERE bridge_store_id = _store.id
    AND (
      source_product_id = _source_product_id
      OR (_source_product_code IS NOT NULL AND source_product_code = _source_product_code)
      OR (_source_product_slug IS NOT NULL AND source_product_slug = _source_product_slug)
    )
  ORDER BY (whop_plan_id IS NOT NULL) DESC, updated_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'session', jsonb_build_object(
      'id', _session.id,
      'site_a_store_id', _session.site_a_store_id,
      'bridge_store_id', _session.bridge_store_id,
      'items', _session.items,
      'amount_total', _session.amount_total,
      'currency', _session.currency,
      'metadata', _session.metadata
    ),
    'store', jsonb_build_object(
      'id', _store.id,
      'checkout_provider', _store.checkout_provider,
      'whop_api_key_encrypted', _store.whop_api_key_encrypted,
      'whop_company_id', _store.whop_company_id
    ),
    'source_product_id', _source_product_id,
    'source_product_code', _source_product_code,
    'source_product_slug', _source_product_slug,
    'shadow', CASE WHEN _shadow.whop_plan_id IS NOT NULL OR _shadow.whop_product_id IS NOT NULL
      THEN jsonb_build_object(
        'whop_product_id', _shadow.whop_product_id,
        'whop_plan_id', _shadow.whop_plan_id,
        'whop_checkout_url', _shadow.whop_checkout_url
      )
      ELSE NULL END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bridge_lookup_session_for_whop(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bridge_lookup_session_for_whop(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bridge_save_shadow_whop_mapping(
  _bridge_store_id uuid,
  _session_id uuid,
  _source_product_id text,
  _source_product_code text,
  _source_product_slug text,
  _title text,
  _price numeric,
  _currency text,
  _whop_product_id text,
  _whop_plan_id text,
  _whop_checkout_url text,
  _last_error text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _meta jsonb;
BEGIN
  INSERT INTO public.bridge_shadow_products (
    bridge_store_id, source_product_id, source_product_code, source_product_slug,
    title, price, currency, whop_product_id, whop_plan_id, whop_checkout_url, last_error
  ) VALUES (
    _bridge_store_id, _source_product_id, _source_product_code, _source_product_slug,
    _title, _price, _currency, _whop_product_id, _whop_plan_id, _whop_checkout_url, _last_error
  )
  ON CONFLICT (bridge_store_id, source_product_id) DO UPDATE SET
    source_product_code = COALESCE(EXCLUDED.source_product_code, public.bridge_shadow_products.source_product_code),
    source_product_slug = COALESCE(EXCLUDED.source_product_slug, public.bridge_shadow_products.source_product_slug),
    title = COALESCE(NULLIF(EXCLUDED.title, ''), public.bridge_shadow_products.title),
    price = COALESCE(EXCLUDED.price, public.bridge_shadow_products.price),
    currency = COALESCE(EXCLUDED.currency, public.bridge_shadow_products.currency),
    whop_product_id = COALESCE(EXCLUDED.whop_product_id, public.bridge_shadow_products.whop_product_id),
    whop_plan_id = COALESCE(EXCLUDED.whop_plan_id, public.bridge_shadow_products.whop_plan_id),
    whop_checkout_url = COALESCE(EXCLUDED.whop_checkout_url, public.bridge_shadow_products.whop_checkout_url),
    last_error = EXCLUDED.last_error,
    updated_at = now();

  IF _session_id IS NOT NULL THEN
    SELECT metadata INTO _meta FROM public.native_checkout_sessions WHERE id = _session_id;
    _meta := COALESCE(_meta, '{}'::jsonb) || jsonb_build_object(
      'source_product_id', _source_product_id,
      'source_product_code', _source_product_code,
      'source_product_slug', _source_product_slug,
      'whop_product_id', _whop_product_id,
      'whop_plan_id', _whop_plan_id,
      'whop_checkout_url', _whop_checkout_url,
      'whop_synced_at', now()
    );
    UPDATE public.native_checkout_sessions
    SET metadata = _meta, updated_at = now()
    WHERE id = _session_id;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bridge_save_shadow_whop_mapping(uuid, uuid, text, text, text, text, numeric, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bridge_save_shadow_whop_mapping(uuid, uuid, text, text, text, text, numeric, text, text, text, text, text) TO authenticated, service_role;

-- >>> 20260609232321_f7b90b0d-80d1-4cfd-b571-612f7bb94863.sql

REVOKE ALL ON FUNCTION public.bridge_lookup_session_for_whop(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bridge_lookup_session_for_whop(uuid) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.bridge_save_shadow_whop_mapping(uuid, uuid, text, text, text, text, numeric, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bridge_save_shadow_whop_mapping(uuid, uuid, text, text, text, text, numeric, text, text, text, text, text) TO anon, authenticated, service_role;

-- >>> 20260615195758_41e74250-58e7-4b57-88ea-3dfd4508e1eb.sql

CREATE TABLE public.shop_product_whop_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.shop_products(id) ON DELETE CASCADE,
  bridge_store_id uuid NOT NULL REFERENCES public.bridge_stores(id) ON DELETE CASCADE,
  whop_product_id text,
  whop_plan_id text,
  whop_checkout_url text,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, bridge_store_id)
);

CREATE INDEX shop_product_whop_publications_product_idx ON public.shop_product_whop_publications(product_id);
CREATE INDEX shop_product_whop_publications_store_idx ON public.shop_product_whop_publications(bridge_store_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shop_product_whop_publications TO authenticated;
GRANT ALL ON public.shop_product_whop_publications TO service_role;

ALTER TABLE public.shop_product_whop_publications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage whop publications"
ON public.shop_product_whop_publications FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.shop_product_whop_publications_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER shop_product_whop_publications_updated_at
BEFORE UPDATE ON public.shop_product_whop_publications
FOR EACH ROW EXECUTE FUNCTION public.shop_product_whop_publications_set_updated_at();

-- >>> 20260617210828_1f0e38fa-b27b-4d63-a165-8283c00c7f87.sql

CREATE TABLE IF NOT EXISTS public.external_db_config (
  id text PRIMARY KEY DEFAULT 'default',
  external_url text,
  external_service_role_key text,
  external_publishable_key text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT external_db_config_singleton CHECK (id = 'default')
);

GRANT SELECT, INSERT, UPDATE ON public.external_db_config TO authenticated;
GRANT ALL ON public.external_db_config TO service_role;

ALTER TABLE public.external_db_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read external_db_config"
  ON public.external_db_config FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins write external_db_config"
  ON public.external_db_config FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins update external_db_config"
  ON public.external_db_config FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.external_db_config (id) VALUES ('default')
ON CONFLICT (id) DO NOTHING;

