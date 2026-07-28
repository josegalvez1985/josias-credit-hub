import { createFileRoute } from "@tanstack/react-router";
import { MapPin } from "lucide-react";
import { SeccionPendiente } from "@/components/seccion-pendiente";

export const Route = createFileRoute("/_app/recibos/ubicaciones")({
  head: () => ({ meta: [{ title: "Ubicaciones — Créditos" }] }),
  component: () => (
    <SeccionPendiente
      titulo="Ubicaciones"
      descripcion="Consulta de ubicaciones de clientes."
      icon={MapPin}
      paginaApex="página de Ubicaciones"
    />
  ),
});
