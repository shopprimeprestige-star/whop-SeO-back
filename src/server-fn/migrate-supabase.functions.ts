import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

async function assertAdmin(userId: string, db: SupabaseClient<Database>) {
  const { data, error } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
}

function maskHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.host;
  } catch {
    return null;
  }
}

function fingerprint(value: string | undefined): string | null {
  if (!value) return null;
  if (value.length < 8) return "***";
  return `${value.slice(0, 4)}…${value.slice(-4)} (${value.length} chars)`;
}

/**
 * Diagnostica le env vars Supabase attive sul Worker runtime.
 * Mostra l'HOST a cui punta il backend in produzione, senza esporre le chiavi.
 */
export const getRuntimeBackendInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId, context.supabase);

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabasePub = process.env.SUPABASE_PUBLISHABLE_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const encryptionKey = process.env.ENCRYPTION_KEY;
    const lovableApiKey = process.env.LOVABLE_API_KEY;
    const dbUrl = process.env.SUPABASE_DB_URL;
    const projectId = process.env.SUPABASE_PROJECT_ID;

    const lovableCloudHost = "vpxlqrqxehyaqjoiyhqi.supabase.co";
    const currentHost = maskHost(supabaseUrl);
    const isLovableCloud = currentHost === lovableCloudHost;

    return {
      host: currentHost,
      isLovableCloud,
      lovableCloudHost,
      env: {
        SUPABASE_URL: { present: !!supabaseUrl, value: supabaseUrl ?? null },
        SUPABASE_PROJECT_ID: { present: !!projectId, value: projectId ?? null },
        SUPABASE_PUBLISHABLE_KEY: { present: !!supabasePub, fingerprint: fingerprint(supabasePub), value: supabasePub ?? null },
        SUPABASE_SERVICE_ROLE_KEY: { present: !!serviceRoleKey, fingerprint: fingerprint(serviceRoleKey), value: serviceRoleKey ?? null },
        SUPABASE_DB_URL: { present: !!dbUrl, fingerprint: fingerprint(dbUrl), value: dbUrl ?? null },
        ENCRYPTION_KEY: { present: !!encryptionKey, fingerprint: fingerprint(encryptionKey), value: encryptionKey ?? null },
        LOVABLE_API_KEY: { present: !!lovableApiKey, fingerprint: fingerprint(lovableApiKey), value: lovableApiKey ?? null },
      },
    };
  });
