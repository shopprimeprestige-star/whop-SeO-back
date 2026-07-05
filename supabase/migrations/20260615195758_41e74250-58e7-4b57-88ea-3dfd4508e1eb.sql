
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
