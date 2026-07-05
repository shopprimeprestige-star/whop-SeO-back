
CREATE TABLE IF NOT EXISTS public.external_db_config (
  id text PRIMARY KEY DEFAULT 'default',
  external_url text,
  external_service_role_key text,
  external_publishable_key text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT external_db_config_singleton CHECK (id = 'default')
);

GRANT SELECT, INSERT, UPDATE ON public.external_db_config TO authenticated;
GRANT ALL ON public.external_db_config TO service_role;

ALTER TABLE public.external_db_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read external_db_config"
  ON public.external_db_config FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins write external_db_config"
  ON public.external_db_config FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins update external_db_config"
  ON public.external_db_config FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.external_db_config (id) VALUES ('default')
ON CONFLICT (id) DO NOTHING;
