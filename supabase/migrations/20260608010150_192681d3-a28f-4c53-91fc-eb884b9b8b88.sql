GRANT EXECUTE ON FUNCTION public.bridge_handshake(uuid, text, text, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.bridge_handshake(uuid, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_handshake(uuid, text, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_handshake(uuid, text, text, text, text, text, text) TO supabase_read_only_user;