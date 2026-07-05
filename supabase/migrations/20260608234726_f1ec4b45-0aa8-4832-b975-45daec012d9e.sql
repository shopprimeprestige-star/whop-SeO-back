CREATE OR REPLACE FUNCTION public.get_public_synced_product_by_slug(_slug text)
RETURNS TABLE (
  source text,
  id uuid,
  slug text,
  title text,
  description text,
  price numeric,
  compare_at_price numeric,
  currency text,
  image_url text,
  gallery jsonb,
  variants jsonb,
  prd_code text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH bridge AS (
    SELECT
      'bridge'::text AS source,
      sp.id,
      COALESCE(sp.shopify_handle, sp.shadow_handle) AS slug,
      COALESCE(NULLIF(sp.shadow_title, ''), sp.shadow_handle) AS title,
      NULL::text AS description,
      COALESCE((sp.variant_map->0->>'price')::numeric, 0::numeric) AS price,
      NULLIF(sp.variant_map->0->>'compare_price', '')::numeric AS compare_at_price,
      'EUR'::text AS currency,
      NULL::text AS image_url,
      '[]'::jsonb AS gallery,
      sp.variant_map AS variants,
      sp.shadow_handle AS prd_code,
      sp.updated_at
    FROM public.shadow_products sp
    WHERE lower(sp.shadow_handle) = lower(_slug)
       OR lower(COALESCE(sp.shopify_handle, '')) = lower(_slug)
    ORDER BY sp.updated_at DESC
    LIMIT 1
  ), synced AS (
    SELECT
      'lovable-sync'::text AS source,
      lp.id,
      COALESCE(lp.slug, lp.external_id) AS slug,
      lp.title,
      COALESCE(lp.description_long, lp.description_short) AS description,
      COALESCE(lp.price, 0::numeric) AS price,
      lp.compare_price AS compare_at_price,
      COALESCE(lp.currency, 'EUR') AS currency,
      CASE
        WHEN jsonb_typeof(lp.images) = 'array' AND jsonb_array_length(lp.images) > 0 AND jsonb_typeof(lp.images->0) = 'string' THEN trim(both '"' from (lp.images->0)::text)
        WHEN jsonb_typeof(lp.images) = 'array' AND jsonb_array_length(lp.images) > 0 AND jsonb_typeof(lp.images->0) = 'object' THEN COALESCE(lp.images->0->>'url', lp.images->0->>'src', lp.images->0->>'image_url')
        ELSE NULL
      END AS image_url,
      COALESCE(lp.images, '[]'::jsonb) AS gallery,
      COALESCE(lp.variants, '[]'::jsonb) AS variants,
      lp.external_id AS prd_code,
      lp.updated_at
    FROM public.lovable_synced_products lp
    WHERE lower(COALESCE(lp.slug, '')) = lower(_slug)
       OR lower(lp.external_id) = lower(_slug)
    ORDER BY lp.updated_at DESC
    LIMIT 1
  )
  SELECT source, id, slug, title, description, price, compare_at_price, currency, image_url, gallery, variants, prd_code
  FROM bridge
  UNION ALL
  SELECT source, id, slug, title, description, price, compare_at_price, currency, image_url, gallery, variants, prd_code
  FROM synced
  WHERE NOT EXISTS (SELECT 1 FROM bridge)
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_synced_product_by_slug(text) TO anon, authenticated, service_role;