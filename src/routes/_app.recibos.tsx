import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RecibosTabs } from "@/components/recibos-tabs";

// Layout del módulo de cobranzas: la barra de secciones de la app APEX
// "Josias Muebles Cobradores" se mantiene arriba en todas sus pantallas.
export const Route = createFileRoute("/_app/recibos")({
  component: RecibosLayout,
});

function RecibosLayout() {
  return (
    <div className="space-y-6">
      <RecibosTabs />
      <Outlet />
    </div>
  );
}
