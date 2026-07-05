import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/bridge-admin/stores")({
  beforeLoad: async () => {
    throw redirect({ to: "/ponte-admin" });
  },
  component: () => null,
});
