// POST /api/public/whop-webhook — webhook server-to-server di Whop (canale affidabile).
// Alla ricezione di un pagamento valido: trova la sessione di checkout collegata (via whop plan_id),
// la marca pagata e INOLTRA a Sito A (notifyCallback "order_paid") → conversione + fatturato per-store.
// Configura questo URL nel dashboard Whop e incolla il "webhook secret" nello store (Sito Ponte → store).
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/lib/runtime-supabase-admin";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Whop-Signature, Whop-Signature, X-Signature",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
}

function extractPlanIds(raw: string, parsed: any): string[] {
  const out = new Set<string>();
  const d = parsed?.data ?? parsed ?? {};
  for (const v of [d.plan_id, d.plan, d?.plan?.id, d?.membership?.plan, d?.membership?.plan_id, parsed?.plan_id]) {
    if (typeof v === "string" && v.startsWith("plan_")) out.add(v);
  }
  for (const m of raw.match(/plan_[A-Za-z0-9]+/g) ?? []) out.add(m);
  return [...out];
}

function isPaidEvent(parsed: any): boolean {
  const a = String(parsed?.action ?? parsed?.event ?? parsed?.type ?? "").toLowerCase();
  if (!a) return true; // se non c'è action, proviamo comunque (match by plan)
  return /valid|succeed|success|completed|paid|active/.test(a);
}

export const Route = createFileRoute("/api/public/whop-webhook")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const raw = await request.text();
        let parsed: any = null;
        try { parsed = JSON.parse(raw); } catch { return json(400, { ok: false, error: "invalid_body" }); }

        if (!isPaidEvent(parsed)) return json(200, { ok: true, ignored: "event_not_paid" });

        const planIds = extractPlanIds(raw, parsed);
        if (planIds.length === 0) return json(200, { ok: true, ignored: "no_plan_id" });

        // Trova la sessione collegata al plan_id
        let session: any = null;
        for (const pid of planIds) {
          const { data } = await supabaseAdmin
            .from("native_checkout_sessions")
            .select("id, site_a_store_id, bridge_store_id, amount_total, currency, metadata, status")
            .filter("metadata->>whop_plan_id", "eq", pid)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (data) { session = data; break; }
        }
        if (!session) return json(200, { ok: true, ignored: "session_not_found", plan_ids: planIds });

        // Idempotenza: se già pagata e già notificata, esci
        if (session.status === "paid") return json(200, { ok: true, already: true });

        // Store + verifica firma (best-effort se è impostato un secret)
        const { data: store } = await supabaseAdmin
          .from("bridge_stores")
          .select("*")
          .eq("id", session.bridge_store_id)
          .maybeSingle();
        if (!store) return json(200, { ok: true, ignored: "store_not_found" });

        let signatureOk: boolean | null = null;
        const sigHeader = request.headers.get("x-whop-signature") || request.headers.get("whop-signature") || request.headers.get("x-signature");
        const secEnc = (store as { whop_webhook_secret_encrypted?: string | null }).whop_webhook_secret_encrypted;
        if (secEnc && sigHeader) {
          try {
            const { decryptString } = await import("@/lib/bridge/crypto.server");
            const { verifyHmacSignature } = await import("@/lib/sync.server");
            const secret = await decryptString(secEnc);
            signatureOk = await verifyHmacSignature(secret, raw, sigHeader);
          } catch { signatureOk = false; }
          // Se la firma è configurata ma non valida, rifiuta (sicurezza).
          if (signatureOk === false) return json(401, { ok: false, error: "invalid_signature" });
        }

        // Marca pagata
        await supabaseAdmin
          .from("native_checkout_sessions")
          .update({ status: "paid", updated_at: new Date().toISOString() } as never)
          .eq("id", session.id);

        // Inoltra a Sito A (conversione + fatturato per-store)
        const siteSession = (session.metadata as { session_id?: string } | null)?.session_id;
        let notified = false;
        if (siteSession) {
          const { notifyCallback } = await import("@/lib/bridge/auth.server");
          const res = await notifyCallback(store as never, "order_paid", {
            session_id: siteSession,
            amount: Number(session.amount_total ?? 0),
            currency: String(session.currency ?? "EUR"),
            source: "whop_webhook",
          });
          notified = !!res?.ok;
        }
        return json(200, { ok: true, matched: true, notified, signature: signatureOk });
      },
    },
  },
});
