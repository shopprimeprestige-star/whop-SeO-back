import { createFileRoute } from "@tanstack/react-router";
import { corsPreflight } from "@/lib/bridge/auth.server";
import { handleCheckout } from "./api.public.bridge.generate-checkout";

export const Route = createFileRoute("/api/public/bridge/checkout")({
  server: {
    handlers: {
      GET: async () =>
        new Response(JSON.stringify({ error: "method_not_allowed" }), {
          status: 405,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-Bridge-Api-Key",
          },
        }),
      OPTIONS: async () => corsPreflight(),
      POST: async ({ request }) => handleCheckout(request, "/api/public/bridge/checkout"),
    },
  },
});
