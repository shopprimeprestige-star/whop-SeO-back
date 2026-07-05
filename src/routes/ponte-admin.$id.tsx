import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ponteGetStore } from "@/server-fn/ponte.functions";
import StoreForm from "@/components/ponte/StoreForm";
import StoreStatusPanel from "@/components/ponte/StoreStatusPanel";
import SiteAIntegrationPanel from "@/components/ponte/SiteAIntegrationPanel";
import { ArrowLeft, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/ponte-admin/$id")({
  component: EditStorePage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 text-red-600" />
          <div className="flex-1">
            <h2 className="text-base font-semibold text-red-900">Errore caricamento store</h2>
            <p className="mt-1 text-sm text-red-700 break-all">{error.message}</p>
            <div className="mt-4 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => { router.invalidate(); reset(); }}>Riprova</Button>
              <Link to="/ponte-admin/stores"><Button size="sm" variant="outline">Torna agli store</Button></Link>
            </div>
          </div>
        </div>
      </div>
    );
  },
});

function EditStorePage() {
  const { id } = Route.useParams();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["ponte", "store", id],
    queryFn: () => ponteGetStore({ data: { id } }),
    refetchInterval: 8000,
    retry: 1,
  });

  if (isLoading) return <div className="text-zinc-500">Caricamento…</div>;

  if (isError) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 text-red-600" />
          <div className="flex-1">
            <h2 className="text-base font-semibold text-red-900">Impossibile caricare lo store</h2>
            <p className="mt-1 text-sm text-red-700 break-all">{error instanceof Error ? error.message : String(error)}</p>
            <div className="mt-4 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => refetch()}>Riprova</Button>
              <Link to="/ponte-admin/stores"><Button size="sm" variant="outline">Torna agli store</Button></Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-6">
        <p className="text-zinc-600">Store non trovato.</p>
        <Link to="/ponte-admin/stores" className="mt-3 inline-flex items-center gap-1 text-sm text-zinc-900 underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Torna agli store
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <Link to="/ponte-admin/stores" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900"><ArrowLeft className="h-3.5 w-3.5" /> Tutti gli store</Link>
        <h1 className="mt-2 text-3xl font-semibold text-zinc-900">{data.display_name || data.shop_domain}</h1>
        <p className="mt-1 text-sm text-zinc-500">{data.shop_domain}</p>
      </div>

      <StoreStatusPanel store={data} />

      <SiteAIntegrationPanel store={data} />

      <StoreForm mode="edit" initial={data} />
    </div>
  );
}
