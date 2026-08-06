import { createFileRoute, Outlet } from "@tanstack/react-router";
import { LayoutGrid, Lock, Monitor } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { esUsuarioAdmin, useEsEscritorio } from "@/lib/permisos";
import { AdminSidebar } from "@/components/admin-sidebar";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_app/admin")({
  head: () => ({
    meta: [
      { title: "Administración — Josias Muebles" },
      { name: "description", content: "Módulo administrativo." },
    ],
  }),
  component: AdminLayout,
});

// Layout del módulo administrativo. El menú del header ya no se dibuja para
// quien no corresponde, pero la ruta se puede escribir a mano en la barra de
// direcciones: por eso el permiso se vuelve a mirar acá.
//
// ⚠ Esto sigue siendo una barrera de interfaz. La restricción de verdad va del
// lado de Oracle cuando estas pantallas tengan endpoints propios: cada handler
// tiene que validar contra el token quién está llamando.
function AdminLayout() {
  const { user } = useAuth();
  const esEscritorio = useEsEscritorio();
  const habilitado = esUsuarioAdmin(user?.username);

  if (!habilitado) {
    return (
      <Aviso
        icon={<Lock className="h-5 w-5" />}
        titulo="Sin acceso"
        texto="Tu usuario no tiene habilitado el módulo administrativo. Si creés que es un error, hablá con Jose."
      />
    );
  }

  // El usuario está habilitado pero entró desde el celular. Se explica en vez de
  // esconder: si escribió la URL, es porque esperaba encontrar algo.
  if (!esEscritorio) {
    return (
      <Aviso
        icon={<Monitor className="h-5 w-5" />}
        titulo="Solo desde una computadora"
        texto="El módulo administrativo está pensado para pantalla grande. Abrilo desde una notebook o PC."
      />
    );
  }

  // El layout `_app` envuelve todo en `mx-auto max-w-6xl px-4 py-6`, pensado
  // para las pantallas del cobrador. El módulo administrativo necesita el ancho
  // completo y la barra lateral pegada al borde, así que ese contenedor se
  // neutraliza con márgenes negativos que compensan exactamente su padding.
  //
  // Los valores tienen que seguir a `_app.tsx`: si allá cambia el padding o el
  // max-w, acá hay que acompañarlo.
  return (
    <div className="-mx-4 -my-6 sm:-mx-6 sm:-my-8 xl:-mx-[max(0px,calc((100vw-72rem)/2))]">
      <div className="flex min-h-[calc(100vh-4rem)] items-stretch">
        <AdminSidebar />
        {/* min-w-0: sin esto una tabla ancha estira el flex item y empuja la
            barra lateral fuera de la pantalla (GUIA-FRONTEND §9). */}
        <div className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

function Aviso({ icon, titulo, texto }: { icon: React.ReactNode; titulo: string; texto: string }) {
  return (
    <Card className="mx-auto flex max-w-md flex-col items-center gap-3 p-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </div>
      <div>
        <h1 className="font-display text-lg font-semibold">{titulo}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{texto}</p>
      </div>
    </Card>
  );
}

// Encabezado que comparten las pantallas del módulo. Se exporta para que cada
// sección nueva lo reuse y todas arranquen igual.
export function AdminHeader({ titulo, descripcion }: { titulo: string; descripcion?: string }) {
  return (
    <header className="flex items-center gap-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-secondary/15 text-secondary">
        <LayoutGrid className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <h1 className="truncate font-display text-3xl font-semibold">{titulo}</h1>
        {descripcion && <p className="text-sm text-muted-foreground">{descripcion}</p>}
      </div>
    </header>
  );
}
