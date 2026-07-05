ALTER TABLE public.shop_products
ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];