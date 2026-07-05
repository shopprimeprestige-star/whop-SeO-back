// /api/public/bridge/referrer-probe — endpoint diagnostico.
// POST: registra il Referer ricevuto (chiamato da pagina di test o dal /wash).
// GET:  ritorna gli ultimi N probe per /ponte-admin.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/lib/runtime-supabase-admin";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

export const Route = createFileRoute("/api/public/bridge/referrer-probe")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const referer = request.headers.get("referer") || request.headers.get("referrer") || null;
        const ua = request.headers.get("user-agent") || null;
        let body: { target?: string; storeId?: string; source?: string } = {};
        try { body = await request.json(); } catch { /* allow empty */ }
        let targetHost: string | null = null;
        if (body.target) {
          try { targetHost = new URL(body.target).hostname; } catch { targetHost = null; }
        }
        await supabaseAdmin.from("bridge_referrer_probes").insert({
          store_id: body.storeId ?? null,
          referer,
          user_agent: ua,
          target_host: targetHost,
          source: body.source ?? "wash",
        });
        return new Response(JSON.stringify({ ok: true, referer }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...CORS },
        });
      },
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 20), 100);
        const { data, error } = await supabaseAdmin
          .from("bridge_referrer_probes")
          .select("id,store_id,referer,user_agent,target_host,source,created_at")
          .order("created_at", { ascending: false })
          .limit(limit);
        if (error) {
          return new Response(JSON.stringify({ ok: false, error: error.message }), {
            status: 500, headers: { "Content-Type": "application/json", ...CORS },
          });
        }
        return new Response(JSON.stringify({ ok: true, items: data ?? [] }), {
          status: 200, headers: { "Content-Type": "application/json", ...CORS },
        });
      },
    },
  },
});
