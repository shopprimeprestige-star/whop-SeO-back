import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/bridge-admin")({
  beforeLoad: async () => {
    throw redirect({ to: "/ponte-admin" });
  },
  component: () => null,
});
