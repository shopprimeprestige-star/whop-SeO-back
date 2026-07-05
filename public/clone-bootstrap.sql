-- =============================================================================
-- CLONE BOOTSTRAP — esegui questo file sul Supabase DI OGNI CLONE (Sito B clones)
-- es. oclak.store, oclak-deals.shop, ecc.
--
-- Dove incollarlo:
--   Supabase Dashboard del clone → SQL Editor → New query → Paste → Run.
--
-- È idempotente: puoi rieseguirlo senza rompere niente.
-- Allinea lo schema del clone a quello canonico di Sito B
-- (whop-alx-001-checkout) per le rotte /api/public/bridge/*.
-- =============================================================================

-- ---------- ROLE / RLS HELPERS ------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    CREATE TYPE public.app_role AS ENUM ('admin','moderator','user');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL    ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- ---------- BRIDGE STORES -----------------------------------------------------
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
  rate_limit_rps integer DEFAULT 2,
  custom_domains text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  checkout_provider text NOT NULL DEFAULT 'shopify'
    CHECK (checkout_provider IN ('shopify','native','whop')),
  whop_api_key_encrypted text,
  whop_product_id text,
  whop_plan_id text,
  whop_webhook_secret_encrypted text,
  whop_company_id text,
  sync_key text,
  product_push_url text
);
CREATE UNIQUE INDEX IF NOT EXISTS bridge_stores_sync_key_uq
  ON public.bridge_stores (sync_key) WHERE sync_key IS NOT NULL;
GRANT SELECT, INSERT, UPDATE ON public.bridge_stores TO anon;
GRANT ALL ON public.bridge_stores TO service_role;
ALTER TABLE public.bridge_stores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Bridge RPC can read requested store"   ON public.bridge_stores;
DROP POLICY IF EXISTS "Bridge RPC can update verified store" ON public.bridge_stores;
DROP POLICY IF EXISTS "bridge_stores admin all"               ON public.bridge_stores;
CREATE POLICY "Bridge RPC can read requested store" ON public.bridge_stores
  FOR SELECT TO anon USING (
    current_setting('app.bridge_handshake_rpc', true) = '1'
    AND site_a_store_id::text = current_setting('app.bridge_store_id', true)
  );
CREATE POLICY "Bridge RPC can update verified store" ON public.bridge_stores
  FOR UPDATE TO anon USING (
    current_setting('app.bridge_handshake_rpc', true) = '1'
    AND site_a_store_id::text = current_setting('app.bridge_store_id', true)
    AND bridge_api_key_hash = current_setting('app.bridge_api_key_hash', true)
  ) WITH CHECK (
    current_setting('app.bridge_handshake_rpc', true) = '1'
    AND site_a_store_id::text = current_setting('app.bridge_store_id', true)
    AND bridge_api_key_hash = current_setting('app.bridge_api_key_hash', true)
  );
CREATE POLICY "bridge_stores admin all" ON public.bridge_stores
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ---------- NATIVE CHECKOUT SESSIONS ------------------------------------------
CREATE TABLE IF NOT EXISTS public.native_checkout_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_a_store_id text NOT NULL,
  bridge_store_id uuid REFERENCES public.bridge_stores(id) ON DELETE SET NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  currency text NOT NULL DEFAULT 'EUR',
  amount_total numeric NOT NULL DEFAULT 0,
  locale text,
  country text,
  status text NOT NULL DEFAULT 'pending',
  redirect_url text,
  external_session_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS native_checkout_sessions_store_idx
  ON public.native_checkout_sessions (site_a_store_id, created_at DESC);
GRANT SELECT ON public.native_checkout_sessions TO authenticated;
GRANT ALL    ON public.native_checkout_sessions TO service_role;
ALTER TABLE public.native_checkout_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "native_checkout_sessions admin read" ON public.native_checkout_sessions;
CREATE POLICY "native_checkout_sessions admin read" ON public.native_checkout_sessions
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- ---------- BRIDGE SHADOW PRODUCTS (mapping Whop) -----------------------------
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
CREATE INDEX IF NOT EXISTS bridge_shadow_products_code_idx
  ON public.bridge_shadow_products (bridge_store_id, source_product_code);
CREATE INDEX IF NOT EXISTS bridge_shadow_products_slug_idx
  ON public.bridge_shadow_products (bridge_store_id, source_product_slug);
GRANT SELECT ON public.bridge_shadow_products TO authenticated;
GRANT ALL    ON public.bridge_shadow_products TO service_role;
ALTER TABLE public.bridge_shadow_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bridge_shadow_products admin read" ON public.bridge_shadow_products;
CREATE POLICY "bridge_shadow_products admin read" ON public.bridge_shadow_products
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.bridge_shadow_products_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS bridge_shadow_products_updated_at ON public.bridge_shadow_products;
CREATE TRIGGER bridge_shadow_products_updated_at
  BEFORE UPDATE ON public.bridge_shadow_products
  FOR EACH ROW EXECUTE FUNCTION public.bridge_shadow_products_set_updated_at();

-- ---------- LOG TABLES (necessarie alle RPC) ----------------------------------
CREATE TABLE IF NOT EXISTS public.bridge_handshake_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_a_store_id uuid,
  shop_domain text,
  integration_type text,
  outcome text NOT NULL,
  reason text,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT INSERT ON public.bridge_handshake_log TO anon, authenticated;
GRANT ALL    ON public.bridge_handshake_log TO service_role;
ALTER TABLE public.bridge_handshake_log ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.shadow_checkout_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_a_store_id text,
  integration_type text,
  outcome text NOT NULL,
  items jsonb,
  error text,
  duration_ms integer,
  warmup boolean,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT INSERT ON public.shadow_checkout_log TO anon, authenticated;
GRANT ALL    ON public.shadow_checkout_log TO service_role;
ALTER TABLE public.shadow_checkout_log ENABLE ROW LEVEL SECURITY;

-- ---------- RPC: bridge_handshake --------------------------------------------
CREATE OR REPLACE FUNCTION public.bridge_handshake(
  _store_id uuid,
  _api_key_hash text,
  _shop_domain text DEFAULT NULL,
  _integration_type text DEFAULT NULL,
  _callback_url text DEFAULT NULL,
  _ip text DEFAULT NULL,
  _user_agent text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _store RECORD;
BEGIN
  PERFORM set_config('app.bridge_handshake_rpc', '1', true);
  PERFORM set_config('app.bridge_store_id', COALESCE(_store_id::text,''), true);
  PERFORM set_config('app.bridge_api_key_hash', COALESCE(_api_key_hash,''), true);

  IF _store_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'status',400,'error','Invalid handshake body','step','body_validation');
  END IF;

  SELECT id, bridge_api_key_hash, is_active INTO _store
  FROM public.bridge_stores WHERE site_a_store_id = _store_id LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'status',401,'error','Unknown store_id','step','store_lookup');
  END IF;
  IF COALESCE(_api_key_hash,'') = '' OR COALESCE(_store.bridge_api_key_hash,'') <> _api_key_hash THEN
    RETURN jsonb_build_object('ok',false,'status',401,'error','Invalid API key','step','api_key_validation');
  END IF;
  IF COALESCE(_store.is_active,false) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok',false,'status',403,'error','Store disabled','step','store_status');
  END IF;

  UPDATE public.bridge_stores
    SET last_handshake_at = now(), last_error = NULL,
        callback_url = COALESCE(NULLIF(_callback_url,''), callback_url)
    WHERE id = _store.id;

  RETURN jsonb_build_object('ok',true,'status',200,'state','connected');
END $$;
GRANT EXECUTE ON FUNCTION public.bridge_handshake(uuid,text,text,text,text,text,text)
  TO anon, authenticated, service_role;

-- ---------- RPC: bridge_create_native_checkout_session ------------------------
-- Firma IDENTICA a quella canonica di Sito B. PostgREST risolve per NOME dei
-- parametri, quindi l'ordine non importa: l'importante è che i nomi combacino.
CREATE OR REPLACE FUNCTION public.bridge_create_native_checkout_session(
  _store_id uuid,
  _api_key_hash text,
  _items jsonb,
  _currency text DEFAULT 'EUR',
  _locale text DEFAULT 'en',
  _country text DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb,
  _ip text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _store RECORD;
  _session_id uuid;
  _amount_total numeric := 0;
  _item jsonb;
  _validation jsonb;
BEGIN
  IF _store_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'status',400,'error','invalid_body','step','body_validation');
  END IF;

  _validation := public.bridge_handshake(_store_id,_api_key_hash,NULL,'native_bridge_checkout',NULL,_ip,NULL);
  IF COALESCE((_validation->>'ok')::boolean,false) IS NOT TRUE THEN
    INSERT INTO public.shadow_checkout_log(site_a_store_id,integration_type,outcome,items,error,duration_ms,warmup,ip)
    VALUES (_store_id::text,'native_bridge','error',COALESCE(_items,'[]'::jsonb),
            COALESCE(_validation->>'error','bridge_validation_failed'),0,false,_ip);
    RETURN _validation;
  END IF;

  SELECT id, checkout_provider INTO _store
  FROM public.bridge_stores WHERE site_a_store_id = _store_id LIMIT 1;

  IF lower(COALESCE(_store.checkout_provider,'shopify')) <> 'native' THEN
    RETURN jsonb_build_object('ok',false,'status',409,'error','checkout_provider_not_native',
      'details',jsonb_build_object('checkout_provider',_store.checkout_provider));
  END IF;

  IF jsonb_typeof(COALESCE(_items,'[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(_items,'[]'::jsonb)) < 1 THEN
    RETURN jsonb_build_object('ok',false,'status',400,'error','invalid_body','details',jsonb_build_object('reason','items_required'));
  END IF;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _amount_total := _amount_total
      + COALESCE(NULLIF(_item->>'unit_price','')::numeric, NULLIF(_item->>'price','')::numeric, 0)
      * GREATEST(COALESCE(NULLIF(_item->>'quantity','')::int,1),1);
  END LOOP;

  INSERT INTO public.native_checkout_sessions(
    site_a_store_id,bridge_store_id,items,currency,amount_total,locale,country,status,metadata)
  VALUES (_store_id::text,_store.id,_items,UPPER(COALESCE(NULLIF(_currency,''),'EUR')),
          _amount_total,COALESCE(NULLIF(_locale,''),'en'),NULLIF(_country,''),'pending',
          COALESCE(_metadata,'{}'::jsonb))
  RETURNING id INTO _session_id;

  INSERT INTO public.shadow_checkout_log(site_a_store_id,integration_type,outcome,items,duration_ms,warmup,ip)
  VALUES (_store_id::text,COALESCE(_store.checkout_provider,'native_bridge'),'ok',_items,0,false,_ip);

  RETURN jsonb_build_object('ok',true,'status',200,'session_id',_session_id,
    'bridge_store_id',_store.id,'checkout_provider',COALESCE(_store.checkout_provider,'native'));
END $$;

GRANT EXECUTE ON FUNCTION public.bridge_create_native_checkout_session(
  uuid,text,jsonb,text,text,text,jsonb,text
) TO anon, authenticated, service_role;

-- ---------- RPC: lookup + save shadow Whop mapping ----------------------------
CREATE OR REPLACE FUNCTION public.bridge_lookup_session_for_whop(_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _session RECORD; _store RECORD; _shadow RECORD;
  _src_id text; _src_code text; _src_slug text; _first jsonb;
BEGIN
  SELECT id,site_a_store_id,bridge_store_id,items,amount_total,currency,metadata
  INTO _session FROM public.native_checkout_sessions WHERE id = _session_id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','session_not_found'); END IF;

  IF _session.bridge_store_id IS NULL AND _session.site_a_store_id IS NOT NULL THEN
    UPDATE public.native_checkout_sessions
      SET bridge_store_id = (SELECT id FROM public.bridge_stores
                             WHERE site_a_store_id = _session.site_a_store_id::uuid AND is_active LIMIT 1)
      WHERE id = _session_id
      RETURNING bridge_store_id INTO _session.bridge_store_id;
  END IF;
  IF _session.bridge_store_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','bridge_store_not_found');
  END IF;

  SELECT id,checkout_provider,whop_api_key_encrypted,whop_company_id INTO _store
  FROM public.bridge_stores WHERE id = _session.bridge_store_id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','bridge_store_not_found'); END IF;

  _first := COALESCE(_session.items->0,'{}'::jsonb);
  _src_id   := COALESCE(_session.metadata->>'source_product_id',  _first->>'source_product_id',  _first->>'source_product_code', _first->>'product_slug', _session_id::text);
  _src_code := COALESCE(_session.metadata->>'source_product_code',_first->>'source_product_code');
  _src_slug := COALESCE(_session.metadata->>'source_product_slug',_first->>'source_product_slug',_first->>'product_slug');

  SELECT whop_product_id,whop_plan_id,whop_checkout_url INTO _shadow
  FROM public.bridge_shadow_products
  WHERE bridge_store_id = _store.id
    AND (source_product_id = _src_id
         OR (_src_code IS NOT NULL AND source_product_code = _src_code)
         OR (_src_slug IS NOT NULL AND source_product_slug = _src_slug))
  ORDER BY (whop_plan_id IS NOT NULL) DESC, updated_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'ok',true,
    'session',jsonb_build_object('id',_session.id,'site_a_store_id',_session.site_a_store_id,
      'bridge_store_id',_session.bridge_store_id,'items',_session.items,
      'amount_total',_session.amount_total,'currency',_session.currency,'metadata',_session.metadata),
    'store',jsonb_build_object('id',_store.id,'checkout_provider',_store.checkout_provider,
      'whop_api_key_encrypted',_store.whop_api_key_encrypted,'whop_company_id',_store.whop_company_id),
    'source_product_id',_src_id,'source_product_code',_src_code,'source_product_slug',_src_slug,
    'shadow', CASE WHEN _shadow.whop_plan_id IS NOT NULL OR _shadow.whop_product_id IS NOT NULL
      THEN jsonb_build_object('whop_product_id',_shadow.whop_product_id,
        'whop_plan_id',_shadow.whop_plan_id,'whop_checkout_url',_shadow.whop_checkout_url)
      ELSE NULL END);
END $$;
GRANT EXECUTE ON FUNCTION public.bridge_lookup_session_for_whop(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bridge_save_shadow_whop_mapping(
  _bridge_store_id uuid,_session_id uuid,_source_product_id text,
  _source_product_code text,_source_product_slug text,_title text,
  _price numeric,_currency text,_whop_product_id text,_whop_plan_id text,
  _whop_checkout_url text,_last_error text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _meta jsonb;
BEGIN
  INSERT INTO public.bridge_shadow_products(
    bridge_store_id,source_product_id,source_product_code,source_product_slug,
    title,price,currency,whop_product_id,whop_plan_id,whop_checkout_url,last_error)
  VALUES (_bridge_store_id,_source_product_id,_source_product_code,_source_product_slug,
          _title,_price,_currency,_whop_product_id,_whop_plan_id,_whop_checkout_url,_last_error)
  ON CONFLICT (bridge_store_id,source_product_id) DO UPDATE SET
    source_product_code = COALESCE(EXCLUDED.source_product_code, public.bridge_shadow_products.source_product_code),
    source_product_slug = COALESCE(EXCLUDED.source_product_slug, public.bridge_shadow_products.source_product_slug),
    title = COALESCE(NULLIF(EXCLUDED.title,''), public.bridge_shadow_products.title),
    price = COALESCE(EXCLUDED.price, public.bridge_shadow_products.price),
    currency = COALESCE(EXCLUDED.currency, public.bridge_shadow_products.currency),
    whop_product_id = COALESCE(EXCLUDED.whop_product_id, public.bridge_shadow_products.whop_product_id),
    whop_plan_id = COALESCE(EXCLUDED.whop_plan_id, public.bridge_shadow_products.whop_plan_id),
    whop_checkout_url = COALESCE(EXCLUDED.whop_checkout_url, public.bridge_shadow_products.whop_checkout_url),
    last_error = EXCLUDED.last_error, updated_at = now();

  IF _session_id IS NOT NULL THEN
    SELECT metadata INTO _meta FROM public.native_checkout_sessions WHERE id = _session_id;
    _meta := COALESCE(_meta,'{}'::jsonb) || jsonb_build_object(
      'source_product_id',_source_product_id,'source_product_code',_source_product_code,
      'source_product_slug',_source_product_slug,'whop_product_id',_whop_product_id,
      'whop_plan_id',_whop_plan_id,'whop_checkout_url',_whop_checkout_url,
      'whop_synced_at',now());
    UPDATE public.native_checkout_sessions SET metadata = _meta, updated_at = now() WHERE id = _session_id;
  END IF;

  RETURN jsonb_build_object('ok',true);
END $$;
GRANT EXECUTE ON FUNCTION public.bridge_save_shadow_whop_mapping(
  uuid,uuid,text,text,text,text,numeric,text,text,text,text,text
) TO anon, authenticated, service_role;

-- =============================================================================
-- DONE. Dopo aver eseguito:
--   1. Sul Cloudflare Worker del clone, imposta i secret:
--        wrangler secret put SUPABASE_URL
--        wrangler secret put SUPABASE_PUBLISHABLE_KEY
--        wrangler secret put SUPABASE_SERVICE_ROLE_KEY
--        wrangler secret put ENCRYPTION_KEY
--        wrangler secret put WHOP_API_KEY        -- opzionale, fallback globale
--   2. wrangler deploy
--   3. Inserisci in bridge_stores una riga con:
--        site_a_store_id, shop_domain, bridge_api_key_hash (sha256 hex della
--        API key del bridge), checkout_provider='native', whop_company_id e
--        whop_api_key_encrypted (cifrato con la stessa ENCRYPTION_KEY del Worker).
-- =============================================================================
