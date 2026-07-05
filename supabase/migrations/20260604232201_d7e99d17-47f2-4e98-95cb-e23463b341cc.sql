
CREATE TABLE public.bridge_handshake_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  site_a_store_id uuid,
  shop_domain text,
  integration_type text,
  outcome text NOT NULL,
  reason text,
  ip text,
  user_agent text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT ALL ON public.bridge_handshake_log TO service_role;
GRANT SELECT ON public.bridge_handshake_log TO authenticated;

ALTER TABLE public.bridge_handshake_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bridge_handshake_log admin read"
ON public.bridge_handshake_log
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX bridge_handshake_log_store_idx ON public.bridge_handshake_log (site_a_store_id, created_at DESC);
