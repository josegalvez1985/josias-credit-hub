import { Link, useRouterState } from "@tanstack/react-router";
import { Receipt, Share2, MapPin, MapPinPlus, Tag, Users } from "lucide-react";
import { cn } from "@/lib/utils";

// Las secciones del menú de la app APEX "Josias Muebles Cobradores" (266784),
// en el mismo orden. `corta` es la etiqueta que se muestra cuando la sección
// está activa: el nombre completo no entra en la píldora en un celular.
export const SECCIONES = [
  { to: "/recibos", label: "Recibos", corta: "Recibos", icon: Receipt },
  { to: "/recibos/derivaciones", label: "Derivaciones", corta: "Derivac.", icon: Share2 },
  { to: "/recibos/ubicaciones", label: "Ubicaciones", corta: "Ubicac.", icon: MapPin },
  { to: "/recibos/cargar-ubicacion", label: "Cargar Ubicación", corta: "Cargar", icon: MapPinPlus },
  { to: "/recibos/precios-articulos", label: "Precios de Artículos", corta: "Precios", icon: Tag },
  { to: "/recibos/clientes", label: "Consultar Datos de Clientes", corta: "Clientes", icon: Users },
] as const;

// Barra de secciones al estilo Material 3: las seis entran sin scrollear porque
// solo la activa muestra su texto; las demás quedan como icono y se expanden al
// tocarlas. Antes scrolleaba de costado y escondía la mitad de las opciones.
export function RecibosTabs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav aria-label="Secciones de cobranzas">
      {/* Medidas ajustadas para que a 360 px la píldora activa tenga ~70 px de
          texto: 5 iconos de 40 px + gaps de 2 px. Desde sm todo respira más. */}
      <ul className="flex items-center gap-0.5 rounded-full bg-muted/60 p-1 sm:gap-1">
        {SECCIONES.map((s) => {
          const Icon = s.icon;
          const active = pathname === s.to || pathname.endsWith(s.to);
          return (
            <li key={s.to} className={cn("min-w-0", active ? "flex-1" : "shrink-0")}>
              <Link
                to={s.to}
                aria-label={s.label}
                aria-current={active ? "page" : undefined}
                title={s.label}
                className={cn(
                  "flex h-10 items-center justify-center gap-1.5 rounded-full transition-all duration-200 sm:h-11",
                  active
                    ? "bg-card px-2.5 font-medium text-foreground shadow-soft sm:px-4"
                    : "w-10 text-muted-foreground hover:bg-card/60 hover:text-foreground active:scale-95 sm:w-11",
                )}
              >
                <Icon className="h-4 w-4 shrink-0 sm:h-[18px] sm:w-[18px]" strokeWidth={active ? 2.4 : 1.8} />
                {active && <span className="truncate text-xs sm:text-sm">{s.corta}</span>}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* El nombre completo de la sección, que en la píldora no entra. */}
      <p className="mt-2 px-1 text-xs text-muted-foreground">
        {SECCIONES.find((s) => pathname === s.to || pathname.endsWith(s.to))?.label}
      </p>
    </nav>
  );
}
