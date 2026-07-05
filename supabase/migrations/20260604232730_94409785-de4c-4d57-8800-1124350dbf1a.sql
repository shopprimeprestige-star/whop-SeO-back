
CREATE TABLE public.shadow_checkout_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  site_a_store_id text,
  integration_type text,
  outcome text NOT NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  redirect_url text,
  error text,
  duration_ms integer,
  warmup boolean NOT NULL DEFAULT false,
  ip text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT ALL ON public.shadow_checkout_log TO service_role;
GRANT SELECT ON public.shadow_checkout_log TO authenticated;
ALTER TABLE public.shadow_checkout_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shadow_checkout_log admin read"
  ON public.shadow_checkout_log
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
CREATE INDEX shadow_checkout_log_store_idx
  ON public.shadow_checkout_log (site_a_store_id, created_at DESC);

CREATE TABLE public.native_checkout_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  site_a_store_id text NOT NULL,
  bridge_store_id uuid,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  currency text NOT NULL DEFAULT 'EUR',
  amount_total numeric NOT NULL DEFAULT 0,
  locale text,
  country text,
  status text NOT NULL DEFAULT 'pending',
  redirect_url text,
  external_session_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT ALL ON public.native_checkout_sessions TO service_role;
GRANT SELECT ON public.native_checkout_sessions TO authenticated;
ALTER TABLE public.native_checkout_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "native_checkout_sessions admin read"
  ON public.native_checkout_sessions
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
CREATE INDEX native_checkout_sessions_store_idx
  ON public.native_checkout_sessions (site_a_store_id, created_at DESC);
