CREATE OR REPLACE FUNCTION public.bridge_create_native_checkout_session(
  _store_id uuid,
  _api_key_hash text,
  _items jsonb,
  _currency text DEFAULT 'EUR',
  _locale text DEFAULT 'en',
  _country text DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb,
  _ip text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _store RECORD;
  _session_id uuid;
  _amount_total numeric := 0;
  _item jsonb;
BEGIN
  IF _store_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', 'invalid_body', 'step', 'body_validation', 'details', jsonb_build_object('reason', 'missing_store_id'));
  END IF;

  SELECT id, site_a_store_id, bridge_api_key_hash, is_active, checkout_provider
  INTO _store
  FROM public.bridge_stores
  WHERE site_a_store_id = _store_id
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.shadow_checkout_log (site_a_store_id, integration_type, outcome, items, error, duration_ms, warmup, ip)
    VALUES (_store_id::text, 'native_bridge', 'invalid_api_key', COALESCE(_items, '[]'::jsonb), 'store_not_found', 0, false, _ip);
    RETURN jsonb_build_object('ok', false, 'status', 401, 'error', 'invalid_api_key', 'step', 'store_lookup', 'details', jsonb_build_object('reason', 'store_not_found'));
  END IF;

  IF COALESCE(_api_key_hash, '') = '' OR COALESCE(_store.bridge_api_key_hash, '') <> _api_key_hash THEN
    INSERT INTO public.shadow_checkout_log (site_a_store_id, integration_type, outcome, items, error, duration_ms, warmup, ip)
    VALUES (_store_id::text, COALESCE(_store.checkout_provider, 'native_bridge'), 'invalid_api_key', COALESCE(_items, '[]'::jsonb), 'hash_mismatch', 0, false, _ip);
    RETURN jsonb_build_object('ok', false, 'status', 401, 'error', 'invalid_api_key', 'step', 'api_key_validation', 'details', jsonb_build_object('reason', 'hash_mismatch'));
  END IF;

  IF COALESCE(_store.is_active, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', 'store_disabled', 'step', 'store_status', 'details', jsonb_build_object('is_active', false));
  END IF;

  IF jsonb_typeof(COALESCE(_items, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(_items, '[]'::jsonb)) < 1 THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', 'invalid_body', 'step', 'body_validation', 'details', jsonb_build_object('reason', 'items_required'));
  END IF;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    _amount_total := _amount_total + COALESCE(NULLIF(_item->>'unit_price', '')::numeric, NULLIF(_item->>'price', '')::numeric, 0) * GREATEST(COALESCE(NULLIF(_item->>'quantity', '')::int, 1), 1);
  END LOOP;

  INSERT INTO public.native_checkout_sessions (
    site_a_store_id,
    bridge_store_id,
    items,
    currency,
    amount_total,
    locale,
    country,
    status,
    metadata
  ) VALUES (
    _store_id::text,
    _store.id,
    _items,
    UPPER(COALESCE(NULLIF(_currency, ''), 'EUR')),
    _amount_total,
    COALESCE(NULLIF(_locale, ''), 'en'),
    NULLIF(_country, ''),
    'pending',
    COALESCE(_metadata, '{}'::jsonb)
  )
  RETURNING id INTO _session_id;

  INSERT INTO public.shadow_checkout_log (site_a_store_id, integration_type, outcome, items, duration_ms, warmup, ip)
  VALUES (_store_id::text, COALESCE(_store.checkout_provider, 'native_bridge'), 'ok', _items, 0, false, _ip);

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'session_id', _session_id,
    'bridge_store_id', _store.id,
    'checkout_provider', COALESCE(_store.checkout_provider, 'native')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.bridge_create_native_checkout_session(uuid, text, jsonb, text, text, text, jsonb, text) TO anon, authenticated, service_role;