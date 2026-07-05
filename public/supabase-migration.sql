-- =====================================================================
-- MIGRATION SCRIPT: Lovable Cloud → External Supabase
-- =====================================================================
-- Esegui questo file nel SQL Editor del TUO nuovo progetto Supabase.
-- Crea tutte le tabelle, RLS, funzioni e enum necessari.
-- I DATI vanno migrati separatamente (export CSV o pg_dump --data-only).
-- =====================================================================

-- ---------- ENUMS ----------
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- FUNZIONI ----------
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- =====================================================================
-- TABELLE
-- =====================================================================

-- user_roles
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- site_settings (singleton)
CREATE TABLE IF NOT EXISTS public.site_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  brand_name text NOT NULL DEFAULT 'Atelier Nord',
  brand_url text NOT NULL DEFAULT 'ateliernord.eu',
  logo_url text, logo_dark_url text,
  support_email text NOT NULL DEFAULT 'hello@ateliernord.eu',
  privacy_email text NOT NULL DEFAULT 'privacy@ateliernord.eu',
  legal_address text, vat_number text, apple_pay_verification text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.site_settings TO anon, authenticated;
GRANT ALL ON public.site_settings TO service_role;
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "site_settings public read" ON public.site_settings;
CREATE POLICY "site_settings public read" ON public.site_settings FOR SELECT USING (true);
INSERT INTO public.site_settings (singleton) VALUES (true) ON CONFLICT DO NOTHING;

-- articles
CREATE TABLE IF NOT EXISTS public.articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  excerpt text, content text, cover_image text, category text,
  featured boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.articles TO anon, authenticated;
GRANT ALL ON public.articles TO service_role;
ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "articles public read" ON public.articles;
CREATE POLICY "articles public read" ON public.articles FOR SELECT USING (published_at IS NOT NULL AND published_at <= now());

-- shop_categories
CREATE TABLE IF NOT EXISTS public.shop_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text, image_url text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.shop_categories TO anon, authenticated;
GRANT ALL ON public.shop_categories TO service_role;
ALTER TABLE public.shop_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "shop_categories public read" ON public.shop_categories;
CREATE POLICY "shop_categories public read" ON public.shop_categories FOR SELECT USING (true);
DROP POLICY IF EXISTS "shop_categories admin write" ON public.shop_categories;
CREATE POLICY "shop_categories admin write" ON public.shop_categories FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

-- shop_products
CREATE TABLE IF NOT EXISTS public.shop_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  prd_code text NOT NULL DEFAULT 'PRD-00000',
  title text NOT NULL,
  description text, long_description text,
  price numeric NOT NULL DEFAULT 0, compare_at_price numeric,
  currency text NOT NULL DEFAULT 'EUR',
  image_url text, gallery jsonb DEFAULT '[]'::jsonb,
  brand text, category_id uuid REFERENCES public.shop_categories(id),
  featured boolean NOT NULL DEFAULT false,
  published boolean NOT NULL DEFAULT true,
  hidden_from_listing boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  bridge_store_id uuid,
  shopify_product_id text, shopify_product_handle text,
  whop_product_id text, whop_plan_id text,
  whop_synced_at timestamptz, whop_sync_error text,
  source text NOT NULL DEFAULT 'native',
  source_store_id text, source_product_ref text, source_synced_at timestamptz,
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.shop_products TO anon, authenticated;
GRANT ALL ON public.shop_products TO service_role;
ALTER TABLE public.shop_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "shop_products public read" ON public.shop_products;
CREATE POLICY "shop_products public read" ON public.shop_products FOR SELECT USING (published = true);
DROP POLICY IF EXISTS "shop_products admin write" ON public.shop_products;
CREATE POLICY "shop_products admin write" ON public.shop_products FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

-- shop_variants
CREATE TABLE IF NOT EXISTS public.shop_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.shop_products(id) ON DELETE CASCADE,
  label text NOT NULL, color text, size text, sku text, stock integer,
  price_override numeric, shopify_variant_label text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.shop_variants TO anon, authenticated;
GRANT ALL ON public.shop_variants TO service_role;
ALTER TABLE public.shop_variants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "shop_variants public read" ON public.shop_variants;
CREATE POLICY "shop_variants public read" ON public.shop_variants FOR SELECT USING (true);
DROP POLICY IF EXISTS "shop_variants admin write" ON public.shop_variants;
CREATE POLICY "shop_variants admin write" ON public.shop_variants FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

-- shopify_stores
CREATE TABLE IF NOT EXISTS public.shopify_stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, shop_domain text NOT NULL UNIQUE,
  storefront_access_token text, logo_url text,
  currency text DEFAULT 'EUR', status text DEFAULT 'active',
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.shopify_stores TO anon, authenticated;
GRANT ALL ON public.shopify_stores TO service_role;
ALTER TABLE public.shopify_stores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "shopify_stores public read" ON public.shopify_stores;
CREATE POLICY "shopify_stores public read" ON public.shopify_stores FOR SELECT USING (true);

-- compared_products
CREATE TABLE IF NOT EXISTS public.compared_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL, description text, image_url text,
  price numeric, compare_at_price numeric, currency text DEFAULT 'EUR',
  category text, shopify_store_id uuid, shopify_product_handle text,
  featured boolean NOT NULL DEFAULT false,
  published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.compared_products TO anon, authenticated;
GRANT ALL ON public.compared_products TO service_role;
ALTER TABLE public.compared_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "compared_products public read" ON public.compared_products;
CREATE POLICY "compared_products public read" ON public.compared_products FOR SELECT USING (published = true);

-- =====================================================================
-- BRIDGE TABLES
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.bridge_stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_a_store_id uuid NOT NULL, shop_domain text NOT NULL,
  display_name text, sync_key text,
  shopify_access_token_encrypted text NOT NULL DEFAULT '',
  shopify_api_version text NOT NULL DEFAULT '2024-10',
  shopify_api_key_encrypted text, shopify_api_secret_encrypted text,
  shopify_webhook_secret_encrypted text,
  bridge_api_key_hash text NOT NULL DEFAULT '',
  bridge_api_key_encrypted text NOT NULL DEFAULT '',
  callback_url text, allowed_origin text,
  is_active boolean NOT NULL DEFAULT true,
  last_handshake_at timestamptz, last_sync_at timestamptz,
  last_callback_at timestamptz, last_error text,
  default_tags text, default_order_note text,
  default_note_attributes jsonb DEFAULT '[]'::jsonb,
  user_agent text, rate_limit_rps integer DEFAULT 2,
  custom_domains text[] DEFAULT '{}',
  checkout_provider text NOT NULL DEFAULT 'shopify',
  whop_api_key_encrypted text, whop_product_id text, whop_plan_id text,
  whop_webhook_secret_encrypted text, whop_company_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.bridge_stores TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bridge_stores TO authenticated;
ALTER TABLE public.bridge_stores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bridge_stores admin all" ON public.bridge_stores;
CREATE POLICY "bridge_stores admin all" ON public.bridge_stores FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.bridge_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid, endpoint text NOT NULL, direction text NOT NULL,
  success boolean NOT NULL DEFAULT false, http_status integer,
  error text, payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.bridge_logs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bridge_logs TO authenticated;
ALTER TABLE public.bridge_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bridge_logs admin all" ON public.bridge_logs;
CREATE POLICY "bridge_logs admin all" ON public.bridge_logs FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.bridge_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL, shopify_order_id text NOT NULL,
  order_number text, total_price numeric, currency text,
  financial_status text, cancelled_at timestamptz,
  created_at_shopify timestamptz, notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(store_id, shopify_order_id)
);
GRANT ALL ON public.bridge_orders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bridge_orders TO authenticated;
ALTER TABLE public.bridge_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bridge_orders admin all" ON public.bridge_orders;
CREATE POLICY "bridge_orders admin all" ON public.bridge_orders FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.bridge_revenue_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL, shopify_order_id text NOT NULL,
  event_type text NOT NULL, amount numeric NOT NULL DEFAULT 0,
  currency text, order_number text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.bridge_revenue_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bridge_revenue_events TO authenticated;
ALTER TABLE public.bridge_revenue_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bridge_revenue_events admin all" ON public.bridge_revenue_events;
CREATE POLICY "bridge_revenue_events admin all" ON public.bridge_revenue_events FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.bridge_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL, shopify_webhook_id bigint NOT NULL,
  topic text NOT NULL, address text NOT NULL,
  format text DEFAULT 'json', status text DEFAULT 'active',
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.bridge_webhooks TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bridge_webhooks TO authenticated;
ALTER TABLE public.bridge_webhooks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bridge_webhooks admin all" ON public.bridge_webhooks;
CREATE POLICY "bridge_webhooks admin all" ON public.bridge_webhooks FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.bridge_rate_limits (
  store_id uuid PRIMARY KEY,
  last_call_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.bridge_rate_limits TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bridge_rate_limits TO authenticated;
ALTER TABLE public.bridge_rate_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bridge_rate_limits admin all" ON public.bridge_rate_limits;
CREATE POLICY "bridge_rate_limits admin all" ON public.bridge_rate_limits FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.bridge_handshake_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_a_store_id uuid, shop_domain text, integration_type text,
  outcome text NOT NULL, reason text, ip text, user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.bridge_handshake_log TO service_role;
GRANT SELECT ON public.bridge_handshake_log TO authenticated;
ALTER TABLE public.bridge_handshake_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bridge_handshake_log admin read" ON public.bridge_handshake_log;
CREATE POLICY "bridge_handshake_log admin read" ON public.bridge_handshake_log FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.bridge_push_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_a_store_id text, source_product_id text,
  shadow_handle text, shopify_product_id text,
  outcome text NOT NULL, http_status integer, error text, ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.bridge_push_log TO service_role;
GRANT SELECT ON public.bridge_push_log TO authenticated;
ALTER TABLE public.bridge_push_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bridge_push_log admin read" ON public.bridge_push_log;
CREATE POLICY "bridge_push_log admin read" ON public.bridge_push_log FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.bridge_referrer_probes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid, source text, target_host text, referer text, user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.bridge_referrer_probes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bridge_referrer_probes TO authenticated;
ALTER TABLE public.bridge_referrer_probes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bridge_referrer_probes admin all" ON public.bridge_referrer_probes;
CREATE POLICY "bridge_referrer_probes admin all" ON public.bridge_referrer_probes FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.bridge_wash_nonces (
  rid text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.bridge_wash_nonces TO service_role;
ALTER TABLE public.bridge_wash_nonces ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- CAPI / SYNC / SHADOW / CHECKOUT
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.capi_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  meta_pixel_id text, meta_access_token text, meta_test_event_code text,
  shopify_webhook_secret text, target_site_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.capi_config TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.capi_config TO authenticated;
ALTER TABLE public.capi_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "capi_config admin all" ON public.capi_config;
CREATE POLICY "capi_config admin all" ON public.capi_config FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
INSERT INTO public.capi_config (singleton) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.capi_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL, http_status integer,
  meta_event_name text, topic text, error text, payload_excerpt text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.capi_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.capi_events TO authenticated;
ALTER TABLE public.capi_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "capi_events admin all" ON public.capi_events;
CREATE POLICY "capi_events admin all" ON public.capi_events FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

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
GRANT ALL ON public.sync_settings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_settings TO authenticated;
ALTER TABLE public.sync_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sync_settings admin all" ON public.sync_settings;
CREATE POLICY "sync_settings admin all" ON public.sync_settings FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
INSERT INTO public.sync_settings (singleton) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.shadow_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_store_id text NOT NULL, source_product_id text NOT NULL,
  shadow_handle text NOT NULL, shadow_title text NOT NULL,
  shopify_handle text, shopify_product_id text,
  status text NOT NULL DEFAULT 'draft',
  tags text[] NOT NULL DEFAULT '{}',
  variant_map jsonb NOT NULL DEFAULT '[]'::jsonb,
  product_url text, last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.shadow_products TO service_role;
GRANT SELECT ON public.shadow_products TO authenticated;
ALTER TABLE public.shadow_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "shadow_products admin read" ON public.shadow_products;
CREATE POLICY "shadow_products admin read" ON public.shadow_products FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.shadow_checkout_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_a_store_id text, integration_type text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  outcome text NOT NULL, redirect_url text, error text,
  duration_ms integer, warmup boolean NOT NULL DEFAULT false, ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.shadow_checkout_log TO service_role;
GRANT SELECT ON public.shadow_checkout_log TO authenticated;
ALTER TABLE public.shadow_checkout_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "shadow_checkout_log admin read" ON public.shadow_checkout_log;
CREATE POLICY "shadow_checkout_log admin read" ON public.shadow_checkout_log FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.native_checkout_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_a_store_id text NOT NULL, bridge_store_id uuid,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  amount_total numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'EUR',
  locale text, country text,
  status text NOT NULL DEFAULT 'pending',
  redirect_url text, external_session_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.native_checkout_sessions TO service_role;
GRANT SELECT ON public.native_checkout_sessions TO authenticated;
ALTER TABLE public.native_checkout_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "native_checkout_sessions admin read" ON public.native_checkout_sessions;
CREATE POLICY "native_checkout_sessions admin read" ON public.native_checkout_sessions FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'));

-- =====================================================================
-- TRIGGERS updated_at (su tabelle con quella colonna)
-- =====================================================================
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'site_settings','articles','shop_categories','shop_products','shop_variants',
    'shopify_stores','compared_products','bridge_stores','bridge_webhooks',
    'bridge_rate_limits','capi_config','sync_settings','shadow_products',
    'native_checkout_sessions'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t, t);
  END LOOP;
END $$;

-- =====================================================================
-- POST-MIGRAZIONE: crea il PRIMO admin
-- =====================================================================
-- 1) Vai su Authentication → Users → Add user (la tua email)
-- 2) Esegui questa query sostituendo l'email:
--
-- INSERT INTO public.user_roles (user_id, role)
-- VALUES ((SELECT id FROM auth.users WHERE email='TUA@EMAIL.IT'), 'admin');
-- =====================================================================
