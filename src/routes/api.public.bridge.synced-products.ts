// POST /api/public/bridge/synced-products
// Ritorna quali prodotti del Sito A risultano già presenti nel catalogo del Sito B (shop_products).
// Usato dalla pagina Sync del Sito A per mostrare lo stato reale ("inviato" + codice).
// Auth: X-Bridge-Api-Key / Authorization: Bearer (come push-product).
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/runtime-supabase-admin";
import { authInboundRequest, corsPreflight, handleError, jsonResponse } from "@/lib/bridge/auth.server";

const Body = z.object({
  store_id: z.string().uuid(),
  refs: z.array(z.string().min(1).max(255)).max(2000).optional(),
}).strip();

export const Route = createFileRoute("/api/public/bridge/synced-products")({
  server: {
    handlers: {
      OPTIONS: async () => corsPreflight(),
      POST: async ({ request }) => {
        const endpoint = "/api/public/bridge/synced-products";
        try {
          const apiKey = request.headers.get("X-Bridge-Api-Key") || request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || null;
          const body = Body.parse(await request.json());
          await authInboundRequest(apiKey, body.store_id);

          let query = supabaseAdmin
            .from("shop_products")
            .select("source_product_ref, slug, prd_code")
            .eq("source_store_id", body.store_id);
          if (body.refs && body.refs.length) query = query.in("source_product_ref", body.refs);
          const { data, error } = await query;
          if (error) throw new Error(error.message);

          const items = (data ?? [])
            .filter((r) => (r as { source_product_ref?: string | null }).source_product_ref)
            .map((r) => ({
              ref: (r as { source_product_ref: string }).source_product_ref,
              slug: (r as { slug?: string }).slug ?? null,
              prd_code: (r as { prd_code?: string }).prd_code ?? null,
            }));
          return jsonResponse({ ok: true, items });
        } catch (e) {
          return handleError(e, endpoint);
        }
      },
    },
  },
});
