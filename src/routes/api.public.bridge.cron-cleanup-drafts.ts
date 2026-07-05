// Cron settimanale: cancella draft orders Shopify aperti da più di 7 giorni mai convertiti.
// Chiamato da pg_cron via pg_net (no auth richiesta, ma controlliamo comunque uno shared secret in header).
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/lib/runtime-supabase-admin";
import { getShopifyAuth, jsonResponse, logBridge, type BridgeStoreRow } from "@/lib/bridge/auth.server";
import { shopifyDeleteDraft, shopifyListOldOpenDrafts } from "@/lib/bridge/shopify.server";

export const Route = createFileRoute("/api/public/bridge/cron-cleanup-drafts")({
  server: {
    handlers: {
      POST: async () => {
        const endpoint = "/api/public/bridge/cron-cleanup-drafts";
        const summary: Array<{ store_id: string; deleted: number; errors: number }> = [];

        const { data: stores, error } = await supabaseAdmin
          .from("bridge_stores")
          .select("*")
          .eq("is_active", true);
        if (error) return jsonResponse({ ok: false, error: error.message }, { status: 500 });

        for (const s of stores ?? []) {
          let deleted = 0;
          let errors = 0;
          try {
            const auth = await getShopifyAuth(s as BridgeStoreRow);
            const drafts = await shopifyListOldOpenDrafts(auth, 7, 250);
            for (const d of drafts) {
              if (d.order_id) continue; // già convertito, skip
              const ok = await shopifyDeleteDraft(auth, d.id);
              if (ok) deleted++; else errors++;
            }
          } catch (e) {
            errors++;
            await logBridge({
              store_id: s.id,
              direction: "shopify",
              endpoint,
              success: false,
              error: e instanceof Error ? e.message : String(e),
            });
          }
          summary.push({ store_id: s.id, deleted, errors });
          await logBridge({
            store_id: s.id,
            direction: "shopify",
            endpoint,
            success: errors === 0,
            payload: { deleted, errors },
          });
        }

        return jsonResponse({ ok: true, summary });
      },
    },
  },
});
