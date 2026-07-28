import { createFileRoute } from "@tanstack/react-router";
import { Tag } from "lucide-react";
import { SeccionPendiente } from "@/components/seccion-pendiente";

export const Route = createFileRoute("/_app/recibos/precios-articulos")({
  head: () => ({ meta: [{ title: "Precios de Artículos — Créditos" }] }),
  component: () => (
    <SeccionPendiente
      titulo="Precios de Artículos"
      descripcion="Lista de precios por cantidad de cuotas."
      icon={Tag}
      paginaApex="página de Precios de Artículos"
    />
  ),
});
