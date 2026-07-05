CREATE OR REPLACE FUNCTION public.bridge_push_shadow_record_error(
  _store_id uuid,
  _api_key_hash text,
  _source_product_id text,
  _shadow_handle text,
  _shadow_title text,
  _error text,
  _ip text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _store RECORD;
BEGIN
  SELECT id, bridge_api_key_hash, is_active
  INTO _store
  FROM public.bridge_stores
  WHERE site_a_store_id = _store_id
  LIMIT 1;

  IF NOT FOUND OR COALESCE(_api_key_hash, '') = '' OR COALESCE(_store.bridge_api_key_hash, '') <> _api_key_hash OR COALESCE(_store.is_active, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 401,
      'error', 'invalid_api_key',
      'step', 'api_key_validation'
    );
  END IF;

  INSERT INTO public.shadow_products (
    source_store_id,
    source_product_id,
    shadow_handle,
    shadow_title,
    tags,
    status,
    last_error,
    updated_at
  ) VALUES (
    _store_id::text,
    _source_product_id,
    _shadow_handle,
    _shadow_title,
    ARRAY['shadow', 'hidden', 'bridge'],
    'error',
    LEFT(COALESCE(_error, 'unknown_error'), 1000),
    now()
  )
  ON CONFLICT (source_store_id, source_product_id)
  DO UPDATE SET
    shadow_handle = EXCLUDED.shadow_handle,
    shadow_title = EXCLUDED.shadow_title,
    tags = EXCLUDED.tags,
    status = 'error',
    last_error = EXCLUDED.last_error,
    updated_at = now();

  INSERT INTO public.bridge_push_log (
    site_a_store_id, source_product_id, shadow_handle, http_status, outcome, error, ip
  ) VALUES (
    _store_id::text, _source_product_id, _shadow_handle, 502, 'shopify_error', LEFT(COALESCE(_error, 'unknown_error'), 1000), _ip
  );

  RETURN jsonb_build_object('ok', true, 'status', 200);
END;
$$;

CREATE OR REPLACE FUNCTION public.bridge_push_shadow_save_success(
  _store_id uuid,
  _api_key_hash text,
  _source_product_id text,
  _shadow_handle text,
  _shadow_title text,
  _shopify_product_id text,
  _shopify_handle text,
  _product_url text,
  _variant_map jsonb,
  _ip text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _store RECORD;
BEGIN
  SELECT id, bridge_api_key_hash, is_active
  INTO _store
  FROM public.bridge_stores
  WHERE site_a_store_id = _store_id
  LIMIT 1;

  IF NOT FOUND OR COALESCE(_api_key_hash, '') = '' OR COALESCE(_store.bridge_api_key_hash, '') <> _api_key_hash OR COALESCE(_store.is_active, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 401,
      'error', 'invalid_api_key',
      'step', 'api_key_validation'
    );
  END IF;

  INSERT INTO public.shadow_products (
    source_store_id,
    source_product_id,
    shadow_handle,
    shadow_title,
    shopify_product_id,
    shopify_handle,
    product_url,
    variant_map,
    tags,
    status,
    last_error,
    updated_at
  ) VALUES (
    _store_id::text,
    _source_product_id,
    _shadow_handle,
    _shadow_title,
    _shopify_product_id,
    _shopify_handle,
    _product_url,
    COALESCE(_variant_map, '[]'::jsonb),
    ARRAY['shadow', 'hidden', 'bridge'],
    'ok',
    NULL,
    now()
  )
  ON CONFLICT (source_store_id, source_product_id)
  DO UPDATE SET
    shadow_handle = EXCLUDED.shadow_handle,
    shadow_title = EXCLUDED.shadow_title,
    shopify_product_id = EXCLUDED.shopify_product_id,
    shopify_handle = EXCLUDED.shopify_handle,
    product_url = EXCLUDED.product_url,
    variant_map = EXCLUDED.variant_map,
    tags = EXCLUDED.tags,
    status = 'ok',
    last_error = NULL,
    updated_at = now();

  INSERT INTO public.bridge_push_log (
    site_a_store_id, source_product_id, shadow_handle, shopify_product_id, http_status, outcome, ip
  ) VALUES (
    _store_id::text, _source_product_id, _shadow_handle, _shopify_product_id, 200, 'ok', _ip
  );

  RETURN jsonb_build_object('ok', true, 'status', 200);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bridge_push_shadow_record_error(uuid, text, text, text, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bridge_push_shadow_save_success(uuid, text, text, text, text, text, text, jsonb, text) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.bridge_push_shadow_record_error(uuid, text, text, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.bridge_push_shadow_record_error(uuid, text, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_push_shadow_save_success(uuid, text, text, text, text, text, text, text, jsonb, text) TO anon;
GRANT EXECUTE ON FUNCTION public.bridge_push_shadow_save_success(uuid, text, text, text, text, text, text, text, jsonb, text) TO service_role;