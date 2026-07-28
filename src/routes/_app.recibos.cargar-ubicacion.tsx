import { createFileRoute } from "@tanstack/react-router";
import { MapPinPlus } from "lucide-react";
import { SeccionPendiente } from "@/components/seccion-pendiente";

export const Route = createFileRoute("/_app/recibos/cargar-ubicacion")({
  head: () => ({ meta: [{ title: "Cargar Ubicación — Créditos" }] }),
  component: () => (
    <SeccionPendiente
      titulo="Cargar Ubicación"
      descripcion="Registro de la ubicación del domicilio del cliente."
      icon={MapPinPlus}
      paginaApex="página de Cargar Ubicación"
    />
  ),
});
