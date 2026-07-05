import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/p/$slug")({
  loader: ({ params }) => {
    throw redirect({
      to: "/shop/prodotto/$slug",
      params: { slug: params.slug },
    });
  },
});