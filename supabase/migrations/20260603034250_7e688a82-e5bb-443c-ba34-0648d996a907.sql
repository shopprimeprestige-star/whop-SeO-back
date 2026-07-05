ALTER TABLE public.shop_products
  ADD COLUMN IF NOT EXISTS whop_product_id text,
  ADD COLUMN IF NOT EXISTS whop_plan_id text,
  ADD COLUMN IF NOT EXISTS whop_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS whop_sync_error text;