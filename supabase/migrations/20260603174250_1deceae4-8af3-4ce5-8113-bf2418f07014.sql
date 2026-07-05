ALTER TABLE public.bridge_stores ADD COLUMN IF NOT EXISTS sync_key text;
CREATE UNIQUE INDEX IF NOT EXISTS bridge_stores_sync_key_uq ON public.bridge_stores(sync_key) WHERE sync_key IS NOT NULL;