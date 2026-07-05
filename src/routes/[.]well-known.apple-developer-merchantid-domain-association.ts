import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/lib/runtime-supabase-admin";

const STATIC_APPLE_PAY_VERIFICATION =
  "7b2276657273696f6e223a312c227073704964223a2236343641384242363234393134464232453835354239443531364642353530333338314132444446383545414643463630323336443830413044434235334632222c22637265617465644f6e223a313736303636343737373433327d";

function applePayResponse(content: string) {
  return new Response(content, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}

function applePayHeadResponse() {
  return new Response(null, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}

// Serve il file di verifica del dominio Apple Pay a:
// /.well-known/apple-developer-merchantid-domain-association
// Contenuto gestito da /ponte-admin/site-settings (campo apple_pay_verification).
export const Route = createFileRoute("/.well-known/apple-developer-merchantid-domain-association")({
  server: {
    handlers: {
      HEAD: async () => applePayHeadResponse(),
      GET: async ({ request }) => {
        const host = (request.headers.get("host") || "").toLowerCase().replace(/:\d+$/, "");
        try {
          // 1) File specifico dello store che corrisponde al dominio richiesto (per-store).
          if (host) {
            const { data: stores } = await supabaseAdmin
              .from("bridge_stores")
              .select("shop_domain, custom_domains, apple_pay_verification");
            const match = (stores ?? []).find((s) => {
              const sd = (s as { shop_domain?: string }).shop_domain?.toLowerCase();
              if (sd && sd === host) return true;
              const cds = ((s as { custom_domains?: string[] | null }).custom_domains ?? []).map((d) => d.toLowerCase());
              return cds.includes(host);
            }) as { apple_pay_verification?: string | null } | undefined;
            const perStore = match?.apple_pay_verification?.trim();
            if (perStore) return applePayResponse(perStore);
          }
          // 2) Fallback globale (site_settings).
          const { data } = await supabaseAdmin
            .from("site_settings")
            .select("apple_pay_verification")
            .eq("singleton", true)
            .maybeSingle();
          const content = (data as { apple_pay_verification?: string | null } | null)?.apple_pay_verification?.trim();
          return applePayResponse(content || STATIC_APPLE_PAY_VERIFICATION);
        } catch (error) {
          console.error("Apple Pay verification fallback", error);
          return applePayResponse(STATIC_APPLE_PAY_VERIFICATION);
        }
      },
    },
  },
});
