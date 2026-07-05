import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/ponte-admin/site-setting")({
  beforeLoad: () => {
    throw redirect({ to: "/ponte-admin/site-settings" });
  },
});