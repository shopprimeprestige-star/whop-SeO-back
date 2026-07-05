// Installs a global fetch interceptor that attaches the Supabase access token
// to TanStack Start server function requests, so requireSupabaseAuth works.
import { getRuntimeSupabaseClient } from "@/lib/runtime-supabase";

let installed = false;

export function installAuthFetchInterceptor() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
          ? input.toString()
          : input.url;

      // Only inject for server function calls
      if (url && url.includes("/_serverFn/")) {
        const supabase = await getRuntimeSupabaseClient();
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (token) {
          const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
          if (!headers.has("authorization")) {
            headers.set("authorization", `Bearer ${token}`);
          }
          return originalFetch(input, { ...init, headers });
        }
      }
    } catch {
      // fall through to original fetch
    }
    return originalFetch(input, init);
  };
}
