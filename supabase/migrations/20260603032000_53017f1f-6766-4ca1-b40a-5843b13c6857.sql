
ALTER TABLE public.bridge_stores
  ADD COLUMN IF NOT EXISTS checkout_provider text NOT NULL DEFAULT 'shopify'
    CHECK (checkout_provider IN ('shopify','native','whop')),
  ADD COLUMN IF NOT EXISTS whop_api_key_encrypted text,
  ADD COLUMN IF NOT EXISTS whop_product_id text,
  ADD COLUMN IF NOT EXISTS whop_plan_id text,
  ADD COLUMN IF NOT EXISTS whop_webhook_secret_encrypted text;
