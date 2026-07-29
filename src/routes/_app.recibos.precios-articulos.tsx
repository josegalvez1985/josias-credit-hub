import { createFileRoute } from "@tanstack/react-router";
import { PreciosView } from "@/components/precios-view";

// Página 7 de la app de cobradores. Es la misma vista V_PRECIOS_VENTAS que ya
// consultaba /precios, así que comparten componente en vez de duplicarse.
export const Route = createFileRoute("/_app/recibos/precios-articulos")({
  head: () => ({
    meta: [
      { title: "Precios de Artículos — Créditos" },
      { name: "description", content: "Lista de precios por cantidad de cuotas." },
    ],
  }),
  component: () => <PreciosView titulo="Precios de Artículos" />,
});
