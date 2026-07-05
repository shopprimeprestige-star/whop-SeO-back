CREATE OR REPLACE FUNCTION public.bridge_push_shadow_prepare(_store_id uuid, _api_key_hash text, _source_product_id text, _shadow_handle text, _shadow_title text, _ip text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _store RECORD;
  _existing RECORD;
BEGIN
  IF _store_id IS NULL THEN
    INSERT INTO public.bridge_push_log (site_a_store_id, source_product_id, shadow_handle, http_status, outcome, error, ip)
    VALUES (NULL, _source_product_id, _shadow_handle, 400, 'invalid_body', 'missing_store_id', _ip);
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', 'Invalid push-shadow-product body', 'step', 'body_validation', 'details', jsonb_build_object('reason', 'missing_store_id'));
  END IF;

  SELECT id, site_a_store_id, shop_domain, shopify_access_token_encrypted, shopify_api_version, bridge_api_key_hash, is_active, user_agent, checkout_provider
  INTO _store
  FROM public.bridge_stores
  WHERE site_a_store_id = _store_id
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.bridge_push_log (site_a_store_id, source_product_id, shadow_handle, http_status, outcome, error, ip)
    VALUES (_store_id::text, _source_product_id, _shadow_handle, 401, 'invalid_api_key', 'store_not_found', _ip);
    RETURN jsonb_build_object('ok', false, 'status', 401, 'error', 'invalid_api_key', 'step', 'store_lookup', 'details', jsonb_build_object('reason', 'store_not_found'));
  END IF;

  IF COALESCE(_api_key_hash, '') = '' OR COALESCE(_store.bridge_api_key_hash, '') <> _api_key_hash THEN
    INSERT INTO public.bridge_push_log (site_a_store_id, source_product_id, shadow_handle, http_status, outcome, error, ip)
    VALUES (_store_id::text, _source_product_id, _shadow_handle, 401, 'invalid_api_key', 'hash_mismatch', _ip);
    RETURN jsonb_build_object('ok', false, 'status', 401, 'error', 'invalid_api_key', 'step', 'api_key_validation', 'details', jsonb_build_object('reason', 'hash_mismatch'));
  END IF;

  IF COALESCE(_store.is_active, false) IS NOT TRUE THEN
    INSERT INTO public.bridge_push_log (site_a_store_id, source_product_id, shadow_handle, http_status, outcome, error, ip)
    VALUES (_store_id::text, _source_product_id, _shadow_handle, 403, 'store_disabled', NULL, _ip);
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', 'store_disabled', 'step', 'store_status', 'details', jsonb_build_object('is_active', false));
  END IF;

  SELECT shopify_product_id INTO _existing
  FROM public.shadow_products
  WHERE source_store_id = _store_id::text AND source_product_id = _source_product_id
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
      'user_agent', _store.user_agent,
      'checkout_provider', COALESCE(_store.checkout_provider, 'shopify')
    ),
    'existing', jsonb_build_object('shopify_product_id', COALESCE(_existing.shopify_product_id, NULL))
  );
END;
$function$;