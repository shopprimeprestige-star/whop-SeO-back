CREATE OR REPLACE FUNCTION public.get_native_checkout_session(_session_id uuid)
RETURNS TABLE (
  id uuid,
  site_a_store_id text,
  bridge_store_id uuid,
  items jsonb,
  currency text,
  amount_total numeric,
  status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    ncs.id,
    ncs.site_a_store_id,
    ncs.bridge_store_id,
    ncs.items,
    ncs.currency,
    ncs.amount_total,
    ncs.status
  FROM public.native_checkout_sessions ncs
  WHERE ncs.id = _session_id
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_native_checkout_session(uuid) TO anon, authenticated, service_role;