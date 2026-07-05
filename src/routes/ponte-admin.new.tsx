import { createFileRoute, useNavigate } from "@tanstack/react-router";
import StoreWizard from "@/components/ponte/StoreWizard";

export const Route = createFileRoute("/ponte-admin/new")({ component: NewStorePage });

function NewStorePage() {
  const navigate = useNavigate();
  return (
    <div>
      <h1 className="text-3xl font-semibold text-zinc-900">Nuovo store</h1>
      <p className="mt-1 text-sm text-zinc-500">Wizard guidato: collega un nuovo store al Sito A passo per passo.</p>
      <div className="mt-8">
        <StoreWizard onSaved={(id) => navigate({ to: "/ponte-admin/$id", params: { id } })} />
      </div>
    </div>
  );
}
