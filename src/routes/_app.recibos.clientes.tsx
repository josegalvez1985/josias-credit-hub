import { createFileRoute } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { SeccionPendiente } from "@/components/seccion-pendiente";

export const Route = createFileRoute("/_app/recibos/clientes")({
  head: () => ({ meta: [{ title: "Consultar Datos de Clientes — Créditos" }] }),
  component: () => (
    <SeccionPendiente
      titulo="Consultar Datos de Clientes"
      descripcion="Ficha del cliente y estado de su cuenta."
      icon={Users}
      paginaApex="página de Consultar Datos de Clientes"
    />
  ),
});
