import { createFileRoute, Link } from "@tanstack/react-router";
import { PackageOpen } from "lucide-react";
import { GRUPOS_ADMIN, SECCIONES_ADMIN } from "@/components/admin-menu";
import { AdminHeader } from "./_app.admin";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_app/admin/")({
  component: AdminIndex,
});

// Índice del módulo administrativo: las secciones agrupadas, igual que en la
// barra lateral. Todo sale de GRUPOS_ADMIN (admin-menu.tsx), así que agregar
// una entrada ahí la hace aparecer acá y en la sidebar sola.
function AdminIndex() {
  return (
    <div className="space-y-8">
      <AdminHeader
        titulo="Administración"
        descripcion="Módulo administrativo de Josias Muebles."
      />

      {SECCIONES_ADMIN.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <PackageOpen className="h-5 w-5" />
          </div>
          <p className="max-w-sm text-sm text-muted-foreground">
            Todavía no hay secciones cargadas. La primera se agrega en{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">GRUPOS_ADMIN</code>.
          </p>
        </Card>
      ) : (
        GRUPOS_ADMIN.map((g) => {
          const GrupoIcon = g.icon;
          return (
            <section key={g.id} className="space-y-3">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <GrupoIcon className="h-4 w-4 text-secondary" />
                {g.label}
              </h2>

              {/* grid-cols-1 explícito: sin columnas definidas el track es
                  `auto` y no baja del ancho del contenido (GUIA-FRONTEND §9). */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {g.secciones.map((s) => {
                  const Icon = s.icon;
                  return (
                    <Link key={s.to} to={s.to}>
                      <Card className="flex h-full min-w-0 items-start gap-4 p-5 transition-all hover:shadow-elegant active:scale-[0.99]">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-caramel text-primary-foreground shadow-soft">
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{s.label}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{s.descripcion}</p>
                        </div>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
