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