import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/lib/runtime-supabase-admin";
import { invalidateExternalConfigCache } from "@/lib/supabase-clients.server";

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

function maskKey(s: string | null): string | null {
  if (!s) return null;
  if (s.length <= 8) return "•".repeat(s.length);
  return `${s.slice(0, 6)}••••${s.slice(-4)}`;
}

export const getExternalDbConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("external_db_config")
      .select("external_url, external_service_role_key, external_publishable_key, updated_at")
      .eq("id", "default")
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = (data as {
      external_url: string | null;
      external_service_role_key: string | null;
      external_publishable_key: string | null;
      updated_at: string | null;
    } | null) ?? null;
    return {
      external_url: row?.external_url ?? "",
      service_role_key_masked: maskKey(row?.external_service_role_key ?? null),
      publishable_key_masked: maskKey(row?.external_publishable_key ?? null),
      has_service_role: !!row?.external_service_role_key,
      has_publishable: !!row?.external_publishable_key,
      updated_at: row?.updated_at ?? null,
    };
  });

const SaveInput = z.object({
  external_url: z.string().url().max(500),
  external_service_role_key: z.string().min(20).max(4000).optional().nullable(),
  external_publishable_key: z.string().min(20).max(4000).optional().nullable(),
});

export const saveExternalDbConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof SaveInput>) => SaveInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const update: Record<string, unknown> = {
      id: "default",
      external_url: data.external_url.trim(),
      updated_at: new Date().toISOString(),
      updated_by: context.userId,
    };
    // Aggiorna le chiavi solo se fornite (string non vuota)
    if (typeof data.external_service_role_key === "string" && data.external_service_role_key.trim()) {
      update.external_service_role_key = data.external_service_role_key.trim();
    }
    if (typeof data.external_publishable_key === "string" && data.external_publishable_key.trim()) {
      update.external_publishable_key = data.external_publishable_key.trim();
    }
    const { error } = await supabaseAdmin
      .from("external_db_config")
      .upsert(update as never, { onConflict: "id" });
    if (error) throw new Error(error.message);
    invalidateExternalConfigCache();
    return { ok: true };
  });

export const clearExternalDbKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { which: "service_role" | "publishable" }) => {
    if (input?.which !== "service_role" && input?.which !== "publishable") throw new Error("invalid which");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const col = data.which === "service_role" ? "external_service_role_key" : "external_publishable_key";
    const { error } = await supabaseAdmin
      .from("external_db_config")
      .update({ [col]: null, updated_at: new Date().toISOString(), updated_by: context.userId } as never)
      .eq("id", "default");
    if (error) throw new Error(error.message);
    invalidateExternalConfigCache();
    return { ok: true };
  });

export const testExternalDbConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("external_db_config")
      .select("external_url, external_service_role_key")
      .eq("id", "default")
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = data as { external_url: string | null; external_service_role_key: string | null } | null;
    if (!row?.external_url || !row.external_service_role_key) {
      return { ok: false, step: "config", error: "URL o service role key non configurati" };
    }
    try {
      const client = createClient(row.external_url, row.external_service_role_key, {
        auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
      });
      // Tentativo: lista 1 riga da bridge_stores; controlla anche presenza RPC
      const { error: probeErr } = await client.from("bridge_stores").select("id").limit(1);
      if (probeErr) {
        return {
          ok: false,
          step: "query_bridge_stores",
          error: probeErr.message,
          hint: probeErr.code === "42P01" ? "Tabella bridge_stores assente sul DB esterno — applica clone-bootstrap.sql" : null,
        };
      }
      // Verifica funzione RPC checkout
      const { error: rpcErr } = await client.rpc("bridge_create_native_checkout_session" as never, {
        _store_id: "00000000-0000-0000-0000-000000000000",
        _api_key_hash: "",
        _items: [],
      } as never);
      const missingFn = rpcErr && (rpcErr as { code?: string }).code === "PGRST202";
      return {
        ok: true,
        url: row.external_url,
        bridge_stores_ok: true,
        rpc_present: !missingFn,
        rpc_hint: missingFn ? "Funzione public.bridge_create_native_checkout_session assente — applica clone-bootstrap.sql" : null,
      };
    } catch (e) {
      return { ok: false, step: "connect", error: e instanceof Error ? e.message : String(e) };
    }
  });
