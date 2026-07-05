import { createMiddleware } from "@tanstack/react-start";
import { getRuntimeSupabaseClient, getRuntimeSupabaseEnv } from "@/lib/runtime-supabase";

export const attachRuntimeSupabaseAuth = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const env = await getRuntimeSupabaseEnv();
    const supabase = await getRuntimeSupabaseClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return next({
      headers: {
        "x-supabase-url": env.url,
        "x-supabase-publishable-key": env.publishableKey,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  })
  .server(async ({ next }) => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const headers = getRequest().headers;
    const url = headers.get("x-supabase-url");
    const publishableKey = headers.get("x-supabase-publishable-key");
    const authorization = headers.get("authorization");

    if (url) process.env.SUPABASE_URL = url;
    if (publishableKey) process.env.SUPABASE_PUBLISHABLE_KEY = publishableKey;
    if (authorization) process.env.PONTE_RUNTIME_AUTHORIZATION = authorization;
    else delete process.env.PONTE_RUNTIME_AUTHORIZATION;

    return next();
  });