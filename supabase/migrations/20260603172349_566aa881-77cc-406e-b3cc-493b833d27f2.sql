
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
