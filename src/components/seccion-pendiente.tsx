import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";

// Placeholder de las secciones del menú de cobradores que todavía no se
// portaron desde APEX. Se borra cuando llega la página real.
export function SeccionPendiente({
  titulo,
  descripcion,
  icon: Icon,
  paginaApex,
}: {
  titulo: string;
  descripcion: string;
  icon: LucideIcon;
  paginaApex?: string;
}) {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl font-semibold">{titulo}</h1>
        <p className="text-sm text-muted-foreground">{descripcion}</p>
      </header>

      <Card className="flex flex-col items-center justify-center gap-3 p-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">Esta sección todavía no se migró desde APEX.</p>
        {paginaApex && (
          <p className="text-xs text-muted-foreground">
            Falta el export de la {paginaApex} y el DDL de sus tablas.
          </p>
        )}
      </Card>
    </div>
  );
}
