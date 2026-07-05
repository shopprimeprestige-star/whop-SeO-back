
REVOKE ALL ON FUNCTION public.bridge_lookup_session_for_whop(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bridge_lookup_session_for_whop(uuid) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.bridge_save_shadow_whop_mapping(uuid, uuid, text, text, text, text, numeric, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bridge_save_shadow_whop_mapping(uuid, uuid, text, text, text, text, numeric, text, text, text, text, text) TO anon, authenticated, service_role;
