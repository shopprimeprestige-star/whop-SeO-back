import { Outlet, createRootRouteWithContext, HeadContent, Scripts, Link } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { useEffect } from "react";
import { installAuthFetchInterceptor } from "@/integrations/supabase/fetch-interceptor";
import { siteGetSettings } from "@/server-fn/site.functions";

import appCss from "../styles.css?url";

interface RouterContext {
  queryClient: QueryClient;
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Pagina non trovata</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          La pagina che cerchi non esiste o è stata spostata.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Torna alla home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  loader: async ({ context: { queryClient } }) =>
    queryClient.ensureQueryData({
      queryKey: ["site", "settings"],
      queryFn: () => siteGetSettings(),
      staleTime: 60_000,
    }),
  head: ({ loaderData }) => {
    const brand = loaderData?.brand_name ?? "Atelier Nord";
    const desc = `${brand} — capi essenziali realizzati in Europa.`;
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: `${brand} — Capi essenziali Made in Europe` },
        { name: "description", content: desc },
        { name: "author", content: brand },
        { property: "og:title", content: brand },
        { property: "og:description", content: desc },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: brand },
        { name: "twitter:description", content: desc },
        { title: "ATELIER NORD" },
        { property: "og:title", content: "ATELIER NORD" },
        { name: "twitter:title", content: "ATELIER NORD" },
        { name: "description", content: "Project Replicate imports a zip file to create an exact replica of a project, including functions, design, and products." },
        { property: "og:description", content: "Project Replicate imports a zip file to create an exact replica of a project, including functions, design, and products." },
        { name: "twitter:description", content: "Project Replicate imports a zip file to create an exact replica of a project, including functions, design, and products." },
        { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/8eaccdc5-1dea-4d23-a122-7ba93598b7db/id-preview-d27e5196--3deccc65-9ac7-412c-b981-8230bf0de869.lovable.app-1779305560001.png" },
        { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/8eaccdc5-1dea-4d23-a122-7ba93598b7db/id-preview-d27e5196--3deccc65-9ac7-412c-b981-8230bf0de869.lovable.app-1779305560001.png" },
      ],
      links: [
        { rel: "stylesheet", href: appCss },
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
        { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap" },
      ],
    };
  },
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useEffect(() => { installAuthFetchInterceptor(); }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
