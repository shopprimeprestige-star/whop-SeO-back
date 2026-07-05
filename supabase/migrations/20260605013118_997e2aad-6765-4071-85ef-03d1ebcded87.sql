ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS apple_pay_verification text;