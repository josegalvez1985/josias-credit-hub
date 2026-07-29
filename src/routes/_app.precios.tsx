import { createFileRoute } from "@tanstack/react-router";
import { PreciosView } from "@/components/precios-view";

export const Route = createFileRoute("/_app/precios")({
  head: () => ({
    meta: [
      { title: "Precios — Créditos" },
      { name: "description", content: "Lista de precios de venta por cuotas." },
    ],
  }),
  component: () => <PreciosView titulo="Precios" />,
});
