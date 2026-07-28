import { Link, useRouterState } from "@tanstack/react-router";
import { Receipt, Share2, MapPin, MapPinPlus, Tag, Users } from "lucide-react";
import { cn } from "@/lib/utils";

// Las secciones del menú de la app APEX "Josias Muebles Cobradores" (266784),
// en el mismo orden. Las que todavía no se migraron muestran una pantalla vacía.
export const SECCIONES = [
  { to: "/recibos", label: "Recibos", icon: Receipt },
  { to: "/recibos/derivaciones", label: "Derivaciones", icon: Share2 },
  { to: "/recibos/ubicaciones", label: "Ubicaciones", icon: MapPin },
  { to: "/recibos/cargar-ubicacion", label: "Cargar Ubicación", icon: MapPinPlus },
  { to: "/recibos/precios-articulos", label: "Precios de Artículos", icon: Tag },
  { to: "/recibos/clientes", label: "Consultar Datos de Clientes", icon: Users },
] as const;

export function RecibosTabs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    // En el celular no entran seis pestañas: scrollean de costado, con los bordes
    // difuminados para que se note que hay más. El overflow-hidden del <nav>
    // evita que el bleed negativo empuje el ancho de la página.
    <nav className="relative -mx-4 overflow-hidden sm:-mx-6">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-4 bg-gradient-to-r from-background to-transparent sm:w-6" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-4 bg-gradient-to-l from-background to-transparent sm:w-6" />

      <ul className="flex gap-1 overflow-x-auto px-4 pb-2 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {SECCIONES.map((s) => {
          const Icon = s.icon;
          const active = pathname === s.to || pathname.endsWith(s.to);
          return (
            <li key={s.to} className="shrink-0">
              <Link
                to={s.to}
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-2 text-sm transition-colors",
                  active
                    ? "border-primary bg-primary/10 font-medium text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
