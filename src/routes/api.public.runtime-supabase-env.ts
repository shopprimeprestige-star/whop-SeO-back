import { createFileRoute } from "@tanstack/react-router";
import { SHARED_SUPABASE_URL, SHARED_SUPABASE_PUBLISHABLE_KEY } from "@/lib/supabase-shared";

export const Route = createFileRoute("/api/public/runtime-supabase-env")({
  server: {
    handlers: {
      GET: async () => {
        const workerEnv = (globalThis as { __PONTE_WORKER_ENV__?: Record<string, unknown> }).__PONTE_WORKER_ENV__;
        const read = (name: string) => {
          const fromProcess = process.env?.[name];
          if (typeof fromProcess === "string" && fromProcess) return fromProcess;
          const fromWorker = workerEnv?.[name];
          if (typeof fromWorker === "string" && fromWorker) return fromWorker;
          const fromBuild = import.meta.env?.[name];
          return typeof fromBuild === "string" && fromBuild ? fromBuild : undefined;
        };
        const url = read("VITE_SUPABASE_URL") || read("SUPABASE_URL") || SHARED_SUPABASE_URL;
        const publishableKey = read("VITE_SUPABASE_PUBLISHABLE_KEY") || read("SUPABASE_PUBLISHABLE_KEY") || SHARED_SUPABASE_PUBLISHABLE_KEY;
        const encryptionKeyPresent = Boolean(process.env.ENCRYPTION_KEY);

        if (!url || !publishableKey) {
          return Response.json(
            {
              error: "Runtime Supabase env incompleta",
              present: { url: Boolean(url), publishableKey: Boolean(publishableKey), encryptionKey: encryptionKeyPresent },
            },
            { status: 500, headers: { "Cache-Control": "no-store" } },
          );
        }

        return Response.json(
          { url, publishableKey, present: { encryptionKey: encryptionKeyPresent } },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});