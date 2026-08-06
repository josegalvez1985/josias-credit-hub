import { useEffect, useMemo, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronDown, ChevronLeft, LayoutGrid, Search, X } from "lucide-react";
import { GRUPOS_ADMIN } from "@/components/admin-menu";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

// Barra lateral del módulo administrativo.
//
// Es el patrón de navegación de un ERP: grupos plegables a la izquierda,
// siempre visibles, con la sección activa marcada. Aguanta muchos grupos sin
// romperse — que es justo lo que va a pasar acá a medida que se sumen áreas.
//
// Tres cosas que la hacen usable cuando la lista crece:
//   - Se colapsa a solo iconos y recuerda esa preferencia.
//   - Tiene buscador: con 40 entradas, tipear es más rápido que buscar con
//     el ojo. Filtra por sección y por nombre de grupo.
//   - El grupo de la ruta activa se abre solo al entrar.

const CLAVE_COLAPSADA = "jm-admin-sidebar-colapsada";

export function AdminSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // La preferencia de colapsado se lee en un efecto y no en el useState: en el
  // prerender no hay localStorage, y leerlo durante el render descuadra la
  // hidratación.
  const [colapsada, setColapsada] = useState(false);
  useEffect(() => {
    setColapsada(localStorage.getItem(CLAVE_COLAPSADA) === "1");
  }, []);

  function alternarColapso() {
    setColapsada((v) => {
      localStorage.setItem(CLAVE_COLAPSADA, v ? "0" : "1");
      return !v;
    });
  }

  const [busqueda, setBusqueda] = useState("");

  // Grupos abiertos. Arranca con el de la ruta activa; el usuario abre y
  // cierra a mano después.
  const [abiertos, setAbiertos] = useState<string[]>(() =>
    GRUPOS_ADMIN.filter((g) => g.secciones.some((s) => pathname.startsWith(s.to))).map((g) => g.id),
  );

  // Al navegar a una sección de otro grupo, ese grupo se abre solo.
  useEffect(() => {
    const activo = GRUPOS_ADMIN.find((g) => g.secciones.some((s) => pathname.startsWith(s.to)));
    if (activo) setAbiertos((prev) => (prev.includes(activo.id) ? prev : [...prev, activo.id]));
  }, [pathname]);

  function alternarGrupo(id: string) {
    setAbiertos((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  // Con búsqueda activa se muestran solo los grupos que tienen coincidencias, y
  // se ignora el estado de plegado: si buscaste, querés ver los resultados.
  const termino = busqueda.trim().toLowerCase();
  const grupos = useMemo(() => {
    if (!termino) return GRUPOS_ADMIN;
    return GRUPOS_ADMIN.map((g) => {
      // Si el término matchea el nombre del grupo, se muestra entero.
      if (g.label.toLowerCase().includes(termino)) return g;
      const secciones = g.secciones.filter(
        (s) =>
          s.label.toLowerCase().includes(termino) ||
          s.descripcion.toLowerCase().includes(termino),
      );
      return { ...g, secciones };
    }).filter((g) => g.secciones.length > 0);
  }, [termino]);

  return (
    <aside
      className={cn(
        "sticky top-16 hidden h-[calc(100vh-4rem)] shrink-0 flex-col border-r border-border bg-card/40 transition-[width] duration-200 lg:flex",
        colapsada ? "w-16" : "w-64",
      )}
    >
      {/* Encabezado */}
      <div className="flex h-14 items-center gap-2 border-b border-border px-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary/15 text-secondary">
          <LayoutGrid className="h-4 w-4" />
        </div>
        {!colapsada && (
          <Link to="/admin" className="min-w-0 truncate font-display text-sm font-semibold">
            Administración
          </Link>
        )}
      </div>

      {/* Buscador — no tiene sentido colapsado, no habría dónde escribir */}
      {!colapsada && (
        <div className="px-3 pt-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar sección..."
              aria-label="Buscar sección"
              className="h-9 rounded-lg bg-background pl-8 pr-8 text-sm"
            />
            {busqueda && (
              <button
                type="button"
                onClick={() => setBusqueda("")}
                aria-label="Limpiar búsqueda"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Grupos */}
      <nav aria-label="Secciones de administración" className="min-h-0 flex-1 overflow-y-auto p-3">
        {grupos.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            No hay secciones que coincidan.
          </p>
        ) : (
          <ul className="space-y-1">
            {grupos.map((g) => {
              const GrupoIcon = g.icon;
              const abierto = termino ? true : abiertos.includes(g.id);
              const tieneActiva = g.secciones.some((s) => pathname.startsWith(s.to));

              // Colapsada: solo el icono del grupo, con sus secciones debajo
              // como iconos. El title da el nombre al pasar el mouse.
              if (colapsada) {
                return (
                  <li key={g.id} className="space-y-1">
                    <div
                      title={g.label}
                      className={cn(
                        "flex h-9 items-center justify-center rounded-lg",
                        tieneActiva ? "text-secondary" : "text-muted-foreground",
                      )}
                    >
                      <GrupoIcon className="h-4 w-4" />
                    </div>
                    {g.secciones.map((s) => {
                      const Icon = s.icon;
                      const activa = pathname.startsWith(s.to);
                      return (
                        <Link
                          key={s.to}
                          to={s.to}
                          title={s.label}
                          aria-label={s.label}
                          aria-current={activa ? "page" : undefined}
                          className={cn(
                            "flex h-9 items-center justify-center rounded-lg transition-colors",
                            activa
                              ? "bg-primary/10 text-foreground"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground",
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </Link>
                      );
                    })}
                  </li>
                );
              }

              return (
                <li key={g.id}>
                  <button
                    type="button"
                    onClick={() => alternarGrupo(g.id)}
                    aria-expanded={abierto}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted",
                      tieneActiva ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <GrupoIcon className={cn("h-4 w-4 shrink-0", tieneActiva && "text-secondary")} />
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wider">
                      {g.label}
                    </span>
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 transition-transform duration-200",
                        !abierto && "-rotate-90",
                      )}
                    />
                  </button>

                  {abierto && (
                    <ul className="mt-0.5 space-y-0.5 pl-3">
                      {g.secciones.map((s) => {
                        const Icon = s.icon;
                        const activa = pathname.startsWith(s.to);
                        return (
                          <li key={s.to}>
                            <Link
                              to={s.to}
                              aria-current={activa ? "page" : undefined}
                              className={cn(
                                // La barrita a la izquierda marca la sección
                                // activa sin depender solo del color de fondo.
                                "flex min-w-0 items-center gap-2 rounded-lg border-l-2 py-2 pl-2.5 pr-2 text-sm transition-colors",
                                activa
                                  ? "border-secondary bg-primary/10 font-medium text-foreground"
                                  : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
                              )}
                            >
                              <Icon className="h-4 w-4 shrink-0" />
                              <span className="min-w-0 truncate">{s.label}</span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      {/* Colapsar / expandir */}
      <div className="border-t border-border p-2">
        <button
          type="button"
          onClick={alternarColapso}
          aria-label={colapsada ? "Expandir menú" : "Colapsar menú"}
          title={colapsada ? "Expandir menú" : "Colapsar menú"}
          className={cn(
            "flex h-9 w-full items-center gap-2 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            colapsada && "justify-center px-0",
          )}
        >
          <ChevronLeft
            className={cn("h-4 w-4 shrink-0 transition-transform duration-200", colapsada && "rotate-180")}
          />
          {!colapsada && <span>Colapsar</span>}
        </button>
      </div>
    </aside>
  );
}
