// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  nitro: {
    preset: "cloudflare-module",
    cloudflare: { nodeCompat: true },
  },
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    resolve: {
      alias: {
        "@/integrations/supabase/client.server": fileURLToPath(new URL("./src/lib/runtime-supabase-admin.ts", import.meta.url)),
      },
    },
  },
});