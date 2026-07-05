import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/bridge-admin/login")({
  beforeLoad: async () => {
    throw redirect({ to: "/ponte-admin/login" });
  },
  component: () => null,
});
