
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
