
CREATE OR REPLACE FUNCTION public.bridge_lookup_session_for_whop(_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _session RECORD;
  _store RECORD;
  _shadow RECORD;
  _source_product_id text;
  _source_product_code text;
  _source_product_slug text;
  _first_item jsonb;
BEGIN
  SELECT id, site_a_store_id, bridge_store_id, items, amount_total, currency, metadata
  INTO _session
  FROM public.native_checkout_sessions
  WHERE id = _session_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'session_not_found');
  END IF;

  IF _session.bridge_store_id IS NULL AND _session.site_a_store_id IS NOT NULL THEN
    UPDATE public.native_checkout_sessions
    SET bridge_store_id = (
      SELECT id FROM public.bridge_stores
      WHERE site_a_store_id = _session.site_a_store_id::uuid AND is_active = true
      LIMIT 1
    )
    WHERE id = _session_id
    RETURNING bridge_store_id INTO _session.bridge_store_id;
  END IF;

  IF _session.bridge_store_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bridge_store_not_found');
  END IF;

  SELECT id, checkout_provider, whop_api_key_encrypted, whop_company_id
  INTO _store
  FROM public.bridge_stores
  WHERE id = _session.bridge_store_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bridge_store_not_found');
  END IF;

  _first_item := COALESCE(_session.items->0, '{}'::jsonb);
  _source_product_id := COALESCE(_session.metadata->>'source_product_id', _first_item->>'source_product_id', _first_item->>'source_product_code', _first_item->>'product_slug', _session_id::text);
  _source_product_code := COALESCE(_session.metadata->>'source_product_code', _first_item->>'source_product_code');
  _source_product_slug := COALESCE(_session.metadata->>'source_product_slug', _first_item->>'source_product_slug', _first_item->>'product_slug');

  SELECT whop_product_id, whop_plan_id, whop_checkout_url
  INTO _shadow
  FROM public.bridge_shadow_products
  WHERE bridge_store_id = _store.id
    AND (
      source_product_id = _source_product_id
      OR (_source_product_code IS NOT NULL AND source_product_code = _source_product_code)
      OR (_source_product_slug IS NOT NULL AND source_product_slug = _source_product_slug)
    )
  ORDER BY (whop_plan_id IS NOT NULL) DESC, updated_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'session', jsonb_build_object(
      'id', _session.id,
      'site_a_store_id', _session.site_a_store_id,
      'bridge_store_id', _session.bridge_store_id,
      'items', _session.items,
      'amount_total', _session.amount_total,
      'currency', _session.currency,
      'metadata', _session.metadata
    ),
    'store', jsonb_build_object(
      'id', _store.id,
      'checkout_provider', _store.checkout_provider,
      'whop_api_key_encrypted', _store.whop_api_key_encrypted,
      'whop_company_id', _store.whop_company_id
    ),
    'source_product_id', _source_product_id,
    'source_product_code', _source_product_code,
    'source_product_slug', _source_product_slug,
    'shadow', CASE WHEN _shadow.whop_plan_id IS NOT NULL OR _shadow.whop_product_id IS NOT NULL
      THEN jsonb_build_object(
        'whop_product_id', _shadow.whop_product_id,
        'whop_plan_id', _shadow.whop_plan_id,
        'whop_checkout_url', _shadow.whop_checkout_url
      )
      ELSE NULL END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bridge_lookup_session_for_whop(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bridge_lookup_session_for_whop(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bridge_save_shadow_whop_mapping(
  _bridge_store_id uuid,
  _session_id uuid,
  _source_product_id text,
  _source_product_code text,
  _source_product_slug text,
  _title text,
  _price numeric,
  _currency text,
  _whop_product_id text,
  _whop_plan_id text,
  _whop_checkout_url text,
  _last_error text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _meta jsonb;
BEGIN
  INSERT INTO public.bridge_shadow_products (
    bridge_store_id, source_product_id, source_product_code, source_product_slug,
    title, price, currency, whop_product_id, whop_plan_id, whop_checkout_url, last_error
  ) VALUES (
    _bridge_store_id, _source_product_id, _source_product_code, _source_product_slug,
    _title, _price, _currency, _whop_product_id, _whop_plan_id, _whop_checkout_url, _last_error
  )
  ON CONFLICT (bridge_store_id, source_product_id) DO UPDATE SET
    source_product_code = COALESCE(EXCLUDED.source_product_code, public.bridge_shadow_products.source_product_code),
    source_product_slug = COALESCE(EXCLUDED.source_product_slug, public.bridge_shadow_products.source_product_slug),
    title = COALESCE(NULLIF(EXCLUDED.title, ''), public.bridge_shadow_products.title),
    price = COALESCE(EXCLUDED.price, public.bridge_shadow_products.price),
    currency = COALESCE(EXCLUDED.currency, public.bridge_shadow_products.currency),
    whop_product_id = COALESCE(EXCLUDED.whop_product_id, public.bridge_shadow_products.whop_product_id),
    whop_plan_id = COALESCE(EXCLUDED.whop_plan_id, public.bridge_shadow_products.whop_plan_id),
    whop_checkout_url = COALESCE(EXCLUDED.whop_checkout_url, public.bridge_shadow_products.whop_checkout_url),
    last_error = EXCLUDED.last_error,
    updated_at = now();

  IF _session_id IS NOT NULL THEN
    SELECT metadata INTO _meta FROM public.native_checkout_sessions WHERE id = _session_id;
    _meta := COALESCE(_meta, '{}'::jsonb) || jsonb_build_object(
      'source_product_id', _source_product_id,
      'source_product_code', _source_product_code,
      'source_product_slug', _source_product_slug,
      'whop_product_id', _whop_product_id,
      'whop_plan_id', _whop_plan_id,
      'whop_checkout_url', _whop_checkout_url,
      'whop_synced_at', now()
    );
    UPDATE public.native_checkout_sessions
    SET metadata = _meta, updated_at = now()
    WHERE id = _session_id;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bridge_save_shadow_whop_mapping(uuid, uuid, text, text, text, text, numeric, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bridge_save_shadow_whop_mapping(uuid, uuid, text, text, text, text, numeric, text, text, text, text, text) TO authenticated, service_role;
