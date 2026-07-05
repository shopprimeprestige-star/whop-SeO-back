
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
