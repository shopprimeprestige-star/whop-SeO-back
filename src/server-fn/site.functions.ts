import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/lib/runtime-supabase-admin";

const DEFAULT_SITE_SETTINGS = {
  brand_name: "Atelier Nord",
  brand_url: "ateliernord.eu",
  logo_url: null,
  logo_dark_url: null,
  support_email: "hello@ateliernord.eu",
  privacy_email: "privacy@ateliernord.eu",
  legal_address: "Atelier Nord — Sede Europa",
  vat_number: null as string | null,
};

async function assertAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
}

// Lettura PUBBLICA (footer, pagine legali, header) — singleton
export const siteGetSettings = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { data, error } = await supabaseAdmin
      .from("site_settings")
      .select(
        "brand_name,brand_url,logo_url,logo_dark_url,support_email,privacy_email,legal_address,vat_number",
      )
      .eq("singleton", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ?? DEFAULT_SITE_SETTINGS;
  } catch (error) {
    console.error("siteGetSettings fallback", error);
    return DEFAULT_SITE_SETTINGS;
  }
});

// Lettura admin: include il contenuto del file di verifica Apple Pay
export const siteGetAdminSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("site_settings")
      .select(
        "brand_name,brand_url,logo_url,logo_dark_url,support_email,privacy_email,legal_address,vat_number,apple_pay_verification",
      )
      .eq("singleton", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ?? null;
  });

const SiteSettingsInput = z.object({
  brand_name: z.string().min(1).max(120),
  brand_url: z.string().min(3).max(255),
  logo_url: z.string().url().max(2000).nullable().optional(),
  logo_dark_url: z.string().url().max(2000).nullable().optional(),
  support_email: z.string().email().max(200),
  privacy_email: z.string().email().max(200),
  legal_address: z.string().max(500).nullable().optional(),
  vat_number: z.string().max(60).nullable().optional(),
  apple_pay_verification: z.string().max(20000).nullable().optional(),
});

export const siteUpdateSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof SiteSettingsInput>) => SiteSettingsInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const update: Record<string, unknown> = {
      brand_name: data.brand_name,
      brand_url: data.brand_url,
      logo_url: data.logo_url ?? null,
      logo_dark_url: data.logo_dark_url ?? null,
      support_email: data.support_email,
      privacy_email: data.privacy_email,
      legal_address: data.legal_address ?? null,
      vat_number: data.vat_number ?? null,
    };
    if (data.apple_pay_verification !== undefined) {
      update.apple_pay_verification = data.apple_pay_verification?.trim() || null;
    }
    const { error } = await supabaseAdmin
      .from("site_settings")
      .update(update as never)
      .eq("singleton", true);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Lettura PUBBLICA del contenuto del file Apple Pay (servita dalla route .well-known)
export const siteGetApplePayFile = createServerFn({ method: "GET" }).handler(async () => {
  const { data, error } = await supabaseAdmin
    .from("site_settings")
    .select("apple_pay_verification")
    .eq("singleton", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    content:
      (data as { apple_pay_verification?: string | null } | null)?.apple_pay_verification ?? null,
  };
});
