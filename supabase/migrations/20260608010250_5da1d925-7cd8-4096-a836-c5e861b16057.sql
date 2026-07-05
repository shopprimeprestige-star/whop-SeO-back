CREATE OR REPLACE FUNCTION public.bridge_handshake(
  _store_id uuid,
  _api_key_hash text,
  _shop_domain text DEFAULT NULL,
  _integration_type text DEFAULT NULL,
  _callback_url text DEFAULT NULL,
  _ip text DEFAULT NULL,
  _user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _store RECORD;
BEGIN
  PERFORM set_config('app.bridge_handshake_rpc', '1', true);
  PERFORM set_config('app.bridge_store_id', COALESCE(_store_id::text, ''), true);
  PERFORM set_config('app.bridge_api_key_hash', COALESCE(_api_key_hash, ''), true);

  IF _store_id IS NULL THEN
    INSERT INTO public.bridge_handshake_log (
      site_a_store_id, shop_domain, integration_type, outcome, reason, ip, user_agent
    ) VALUES (
      NULL, _shop_domain, _integration_type, 'invalid_body', 'missing_store_id', _ip, _user_agent
    );

    RETURN jsonb_build_object(
      'ok', false,
      'status', 400,
      'error', 'Invalid handshake body',
      'step', 'body_validation',
      'details', jsonb_build_object('reason', 'missing_store_id')
    );
  END IF;

  SELECT id, site_a_store_id, bridge_api_key_hash, is_active
  INTO _store
  FROM public.bridge_stores
  WHERE site_a_store_id = _store_id
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.bridge_handshake_log (
      site_a_store_id, shop_domain, integration_type, outcome, reason, ip, user_agent
    ) VALUES (
      _store_id, _shop_domain, _integration_type, 'store_not_registered', NULL, _ip, _user_agent
    );

    RETURN jsonb_build_object(
      'ok', false,
      'status', 401,
      'error', 'Unknown store_id',
      'step', 'store_lookup',
      'details', jsonb_build_object('store_id', _store_id)
    );
  END IF;

  IF COALESCE(_api_key_hash, '') = '' OR COALESCE(_store.bridge_api_key_hash, '') <> _api_key_hash THEN
    INSERT INTO public.bridge_handshake_log (
      site_a_store_id, shop_domain, integration_type, outcome, reason, ip, user_agent
    ) VALUES (
      _store_id, _shop_domain, _integration_type, 'invalid_api_key', 'hash_mismatch', _ip, _user_agent
    );

    RETURN jsonb_build_object(
      'ok', false,
      'status', 401,
      'error', 'Invalid API key',
      'step', 'api_key_validation',
      'details', jsonb_build_object('reason', 'hash_mismatch')
    );
  END IF;

  IF COALESCE(_store.is_active, false) IS NOT TRUE THEN
    INSERT INTO public.bridge_handshake_log (
      site_a_store_id, shop_domain, integration_type, outcome, reason, ip, user_agent
    ) VALUES (
      _store_id, _shop_domain, _integration_type, 'error', 'store_disabled', _ip, _user_agent
    );

    RETURN jsonb_build_object(
      'ok', false,
      'status', 403,
      'error', 'Store disabled',
      'step', 'store_status',
      'details', jsonb_build_object('is_active', false)
    );
  END IF;

  UPDATE public.bridge_stores
  SET
    last_handshake_at = now(),
    last_error = NULL,
    callback_url = COALESCE(NULLIF(_callback_url, ''), callback_url)
  WHERE id = _store.id;

  INSERT INTO public.bridge_handshake_log (
    site_a_store_id, shop_domain, integration_type, outcome, reason, ip, user_agent
  ) VALUES (
    _store_id, _shop_domain, _integration_type, 'ok', NULL, _ip, _user_agent
  );

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'state', 'connected',
    'message', 'Bridge handshake OK'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.bridge_handshake(uuid, text, text, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.bridge_handshake(uuid, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_handshake(uuid, text, text, text, text, text, text) TO service_role;
GRANT SELECT, UPDATE ON public.bridge_stores TO anon;
GRANT INSERT ON public.bridge_handshake_log TO anon;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bridge_stores' AND policyname = 'Bridge RPC can read requested store'
  ) THEN
    CREATE POLICY "Bridge RPC can read requested store"
    ON public.bridge_stores
    FOR SELECT
    TO anon
    USING (
      current_setting('app.bridge_handshake_rpc', true) = '1'
      AND site_a_store_id::text = current_setting('app.bridge_store_id', true)
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bridge_stores' AND policyname = 'Bridge RPC can update verified store'
  ) THEN
    CREATE POLICY "Bridge RPC can update verified store"
    ON public.bridge_stores
    FOR UPDATE
    TO anon
    USING (
      current_setting('app.bridge_handshake_rpc', true) = '1'
      AND site_a_store_id::text = current_setting('app.bridge_store_id', true)
      AND bridge_api_key_hash = current_setting('app.bridge_api_key_hash', true)
    )
    WITH CHECK (
      current_setting('app.bridge_handshake_rpc', true) = '1'
      AND site_a_store_id::text = current_setting('app.bridge_store_id', true)
      AND bridge_api_key_hash = current_setting('app.bridge_api_key_hash', true)
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bridge_handshake_log' AND policyname = 'Bridge RPC can insert handshake logs'
  ) THEN
    CREATE POLICY "Bridge RPC can insert handshake logs"
    ON public.bridge_handshake_log
    FOR INSERT
    TO anon
    WITH CHECK (current_setting('app.bridge_handshake_rpc', true) = '1');
  END IF;
END $$;