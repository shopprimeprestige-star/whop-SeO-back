// Server-fn admin per Lovable Sync: configurazione (API key + HMAC secret) e lista prodotti ricevuti.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { decryptString, encryptString } from "@/lib/bridge/crypto.server";

async function assertAdmin(userId: string, db: SupabaseClient<Database>) {
  const { data, error } = await db
    .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Non autorizzato");
}

type ConfigRow = {
  api_key_encrypted: string | null;
  hmac_secret_encrypted: string | null;
  enabled: boolean;
  notes: string | null;
};

async function readConfig(db: SupabaseClient<Database>) {
  const { data, error } = await db
    .from("lovable_sync_config" as never)
    .select("api_key_encrypted,hmac_secret_encrypted,enabled,notes")
    .eq("singleton", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    const { data: ins, error: insErr } = await db
      .from("lovable_sync_config" as never)
      .insert({ singleton: true } as never)
      .select("api_key_encrypted,hmac_secret_encrypted,enabled,notes")
      .single();
    if (insErr) throw new Error(insErr.message);
    return ins as ConfigRow;
  }
  return data as ConfigRow;
}

export const lovableSyncGetConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase;
    await assertAdmin(context.userId, db);
    const row = await readConfig(db);
    let api_key: string | null = null;
    let hmac_secret: string | null = null;
    if (row.api_key_encrypted) { try { api_key = await decryptString(row.api_key_encrypted); } catch { /* ignore */ } }
    if (row.hmac_secret_encrypted) { try { hmac_secret = await decryptString(row.hmac_secret_encrypted); } catch { /* ignore */ } }
    return {
      api_key,
      hmac_secret,
      enabled: row.enabled,
      notes: row.notes,
    };
  });

export const lovableSyncSaveConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { api_key?: string | null; hmac_secret?: string | null; enabled?: boolean; notes?: string | null }) =>
    z.object({
      api_key: z.string().min(8).max(512).nullable().optional(),
      hmac_secret: z.string().min(8).max(512).nullable().optional(),
      enabled: z.boolean().optional(),
      notes: z.string().max(1000).nullable().optional(),
    }).parse(i)
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    await assertAdmin(context.userId, db);
    await readConfig(db); // ensure row exists
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.api_key !== undefined) {
      updates.api_key_encrypted = data.api_key ? await encryptString(data.api_key) : null;
    }
    if (data.hmac_secret !== undefined) {
      updates.hmac_secret_encrypted = data.hmac_secret ? await encryptString(data.hmac_secret) : null;
    }
    if (data.enabled !== undefined) updates.enabled = data.enabled;
    if (data.notes !== undefined) updates.notes = data.notes;
    const { error } = await db
      .from("lovable_sync_config" as never)
      .update(updates as never)
      .eq("singleton", true);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const lovableSyncListProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase;
    await assertAdmin(context.userId, db);
    const { data: lovableProducts, error } = await db
      .from("lovable_synced_products" as never)
      .select("id,store_ref,external_id,title,slug,price,compare_price,currency,locale,status,received_at,updated_at,images")
      .order("received_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    const { data: bridgeProducts, error: bridgeError } = await db
      .from("shadow_products" as never)
      .select("id,source_store_id,source_product_id,shadow_handle,shadow_title,shopify_handle,variant_map,status,created_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(500);
    if (bridgeError) throw new Error(bridgeError.message);
    type JsonValue = string | number | boolean | null | { [k: string]: JsonValue } | JsonValue[];
    type ProductDto = {
      id: string; source: string; store_ref: string; external_id: string; title: string; slug: string | null;
      price: number | null; compare_price: number | null; currency: string | null; locale: string | null;
      status: string; received_at: string; updated_at: string; images: JsonValue[];
    };
    const synced = ((lovableProducts ?? []) as Array<ProductDto>).map((p) => ({ ...p, source: "lovable-sync" }));
    const bridged = ((bridgeProducts ?? []) as Array<{
      id: string; source_store_id: string; source_product_id: string; shadow_handle: string; shadow_title: string | null;
      shopify_handle: string | null; variant_map: JsonValue[] | null; status: string | null; created_at: string; updated_at: string;
    }>).map((p) => {
      const firstVariant = Array.isArray(p.variant_map) && typeof p.variant_map[0] === "object" && p.variant_map[0] !== null
        ? p.variant_map[0] as { price?: unknown; compare_price?: unknown }
        : null;
      return {
        id: p.id,
        source: "bridge",
        store_ref: p.source_store_id,
        external_id: p.source_product_id,
        title: p.shadow_title || p.shadow_handle,
        slug: p.shopify_handle || p.shadow_handle,
        price: typeof firstVariant?.price === "number" ? firstVariant.price : null,
        compare_price: typeof firstVariant?.compare_price === "number" ? firstVariant.compare_price : null,
        currency: "EUR",
        locale: null,
        status: p.status || "ok",
        received_at: p.created_at,
        updated_at: p.updated_at,
        images: [],
      } satisfies ProductDto;
    });
    return [...synced, ...bridged]
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 500);
  });

export const lovableSyncDeleteProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { source: string; id: string }) =>
    z.object({
      source: z.enum(["lovable-sync", "bridge"]),
      id: z.string().min(1).max(200),
    }).parse(i)
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    await assertAdmin(context.userId, db);
    const table = data.source === "bridge" ? "shadow_products" : "lovable_synced_products";
    const { error } = await db.from(table as never).delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const lovableSyncDeleteAll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { source?: "lovable-sync" | "bridge" | "all" }) =>
    z.object({ source: z.enum(["lovable-sync", "bridge", "all"]).default("all") }).parse(i)
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    await assertAdmin(context.userId, db);
    const targets = data.source === "all" ? ["lovable_synced_products", "shadow_products"] : [data.source === "bridge" ? "shadow_products" : "lovable_synced_products"];
    for (const t of targets) {
      const { error } = await db.from(t as never).delete().not("id", "is", null);
      if (error) throw new Error(`${t}: ${error.message}`);
    }
    return { ok: true };
  });
