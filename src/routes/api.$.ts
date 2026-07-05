import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: async ({ request }) => notFound(new URL(request.url).pathname),
      POST: async ({ request }) => notFound(new URL(request.url).pathname),
      PUT: async ({ request }) => notFound(new URL(request.url).pathname),
      PATCH: async ({ request }) => notFound(new URL(request.url).pathname),
      DELETE: async ({ request }) => notFound(new URL(request.url).pathname),
      OPTIONS: async ({ request }) => notFound(new URL(request.url).pathname),
    },
  },
});

function notFound(path: string | undefined) {
  return new Response(JSON.stringify({ error: "route_not_found", path: path ?? "/api" }), {
    status: 404,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Bridge-Api-Key",
    },
  });
}