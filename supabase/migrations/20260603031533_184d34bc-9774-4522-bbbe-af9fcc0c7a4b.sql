
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
