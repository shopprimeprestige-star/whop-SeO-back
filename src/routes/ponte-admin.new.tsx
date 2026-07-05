import { createFileRoute, useNavigate } from "@tanstack/react-router";
import StoreForm from "@/components/ponte/StoreForm";

export const Route = createFileRoute("/ponte-admin/new")({ component: NewStorePage });

function NewStorePage() {
  const navigate = useNavigate();
  return (
    <div>
      <h1 className="text-3xl font-semibold text-zinc-900">Nuovo bridge store</h1>
      <p className="mt-1 text-sm text-zinc-500">Collega un nuovo store Shopify e definisci la connessione con il Sito A.</p>
      <div className="mt-8">
        <StoreForm mode="create" onSaved={(id) => navigate({ to: "/ponte-admin/$id", params: { id } })} />
      </div>
    </div>
  );
}
