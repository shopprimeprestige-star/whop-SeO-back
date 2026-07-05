import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/bridge-admin/prodotti")({
  beforeLoad: async () => {
    throw redirect({ to: "/ponte-admin" });
  },
  component: () => null,
});
