CREATE OR REPLACE FUNCTION public.bridge_push_shadow_prepare(
  _store_id uuid,
  _api_key_hash text,
  _source_product_id text,
  _shadow_handle text,
  _shadow_title text,
  _ip text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _store RECORD;
  _existing RECORD;
BEGIN
  IF _store_id IS NULL THEN
    INSERT INTO public.bridge_push_log (
      site_a_store_id, source_product_id, shadow_handle, http_status, outcome, error, ip
    ) VALUES (
      NULL, _source_product_id, _shadow_handle, 400, 'invalid_body', 'missing_store_id', _ip
    );

    RETURN jsonb_build_object(
      'ok', false,
      'status', 400,
      'error', 'Invalid push-shadow-product body',
      'step', 'body_validation',
      'details', jsonb_build_object('reason', 'missing_store_id')
    );
  END IF;

  SELECT
    id,
    site_a_store_id,
    shop_domain,
    shopify_access_token_encrypted,
    shopify_api_version,
    bridge_api_key_hash,
    is_active,
    user_agent
  INTO _store
  FROM public.bridge_stores
  WHERE site_a_store_id = _store_id
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.bridge_push_log (
      site_a_store_id, source_product_id, shadow_handle, http_status, outcome, error, ip
    ) VALUES (
      _store_id::text, _source_product_id, _shadow_handle, 401, 'invalid_api_key', 'store_not_found', _ip
    );

    RETURN jsonb_build_object(
      'ok', false,
      'status', 401,
      'error', 'invalid_api_key',
      'step', 'store_lookup',
      'details', jsonb_build_object('reason', 'store_not_found')
    );
  END IF;

  IF COALESCE(_api_key_hash, '') = '' OR COALESCE(_store.bridge_api_key_hash, '') <> _api_key_hash THEN
    INSERT INTO public.bridge_push_log (
      site_a_store_id, source_product_id, shadow_handle, http_status, outcome, error, ip
    ) VALUES (
      _store_id::text, _source_product_id, _shadow_handle, 401, 'invalid_api_key', 'hash_mismatch', _ip
    );

    RETURN jsonb_build_object(
      'ok', false,
      'status', 401,
      'error', 'invalid_api_key',
      'step', 'api_key_validation',
      'details', jsonb_build_object('reason', 'hash_mismatch')
    );
  END IF;

  IF COALESCE(_store.is_active, false) IS NOT TRUE THEN
    INSERT INTO public.bridge_push_log (
      site_a_store_id, source_product_id, shadow_handle, http_status, outcome, error, ip
    ) VALUES (
      _store_id::text, _source_product_id, _shadow_handle, 403, 'store_disabled', NULL, _ip
    );

    RETURN jsonb_build_object(
      'ok', false,
      'status', 403,
      'error', 'store_disabled',
      'step', 'store_status',
      'details', jsonb_build_object('is_active', false)
    );
  END IF;

  SELECT shopify_product_id
  INTO _existing
  FROM public.shadow_products
  WHERE source_store_id = _store_id::text
    AND source_product_id = _source_product_id
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'store', jsonb_build_object(
      'id', _store.id,
      'site_a_store_id', _store.site_a_store_id,
      'shop_domain', _store.shop_domain,
      'shopify_access_token_encrypted', _store.shopify_access_token_encrypted,
      'shopify_api_version', _store.shopify_api_version,
      'user_agent', _store.user_agent
    ),
    'existing', jsonb_build_object(
      'shopify_product_id', COALESCE(_existing.shopify_product_id, NULL)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.bridge_push_shadow_record_error(
  _store_id uuid,
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
BEGIN
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

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.bridge_push_shadow_save_success(
  _store_id uuid,
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
BEGIN
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

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.bridge_push_shadow_prepare(uuid, text, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.bridge_push_shadow_prepare(uuid, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_push_shadow_prepare(uuid, text, text, text, text, text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bridge_push_shadow_record_error(uuid, text, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.bridge_push_shadow_record_error(uuid, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_push_shadow_record_error(uuid, text, text, text, text, text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bridge_push_shadow_save_success(uuid, text, text, text, text, text, text, jsonb, text) TO anon;
GRANT EXECUTE ON FUNCTION public.bridge_push_shadow_save_success(uuid, text, text, text, text, text, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_push_shadow_save_success(uuid, text, text, text, text, text, text, jsonb, text) TO service_role;