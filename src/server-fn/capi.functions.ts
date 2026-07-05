import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/lib/runtime-supabase-admin";

async function assertAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error || !data) throw new Error("forbidden");
}

export const capiGetConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data } = await supabaseAdmin
      .from("capi_config")
      .select("*")
      .eq("singleton", true)
      .maybeSingle();
    return data ?? null;
  });

const ConfigSchema = z.object({
  shopify_webhook_secret: z.string().max(2048).nullable().optional(),
  meta_pixel_id: z.string().max(128).nullable().optional(),
  meta_access_token: z.string().max(4096).nullable().optional(),
  target_site_url: z.string().max(2048).nullable().optional(),
  meta_test_event_code: z.string().max(128).nullable().optional(),
});

export const capiUpdateConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ConfigSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const patch: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) patch[k] = v === "" ? null : (v as string | null);
    }
    const { error } = await supabaseAdmin
      .from("capi_config")
      .update(patch as never)
      .eq("singleton", true);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export const capiListEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data } = await supabaseAdmin
      .from("capi_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    return data ?? [];
  });

export const capiTestMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data: cfg } = await supabaseAdmin
      .from("capi_config")
      .select("meta_pixel_id, meta_access_token")
      .eq("singleton", true)
      .maybeSingle();
    if (!cfg?.meta_pixel_id || !cfg?.meta_access_token) {
      return { ok: false, status: 0, error: "config missing" };
    }
    const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(cfg.meta_pixel_id)}?access_token=${encodeURIComponent(cfg.meta_access_token)}`;
    try {
      const res = await fetch(url);
      return { ok: res.ok, status: res.status, error: res.ok ? null : (await res.text()).slice(0, 300) };
    } catch (e) {
      return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
    }
  });
