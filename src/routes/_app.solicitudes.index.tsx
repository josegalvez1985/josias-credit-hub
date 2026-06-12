import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search, FilePlus, FileText } from "lucide-react";
import { useApplications, formatCurrency, STATUS_LABEL, type ApplicationStatus } from "@/lib/credit-applications";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/solicitudes/")({
  head: () => ({
    meta: [
      { title: "Solicitudes — Josias Muebles" },
      { name: "description", content: "Listado de solicitudes de crédito." },
    ],
  }),
  component: ApplicationsList,
});

const FILTERS: Array<{ key: ApplicationStatus | "todas"; label: string }> = [
  { key: "todas", label: "Todas" },
  { key: "pendiente", label: "Pendientes" },
  { key: "revision", label: "En revisión" },
  { key: "aprobada", label: "Aprobadas" },
  { key: "rechazada", label: "Rechazadas" },
];

const STATUS_STYLES: Record<ApplicationStatus, string> = {
  pendiente: "bg-warning/15 text-warning-foreground",
  revision: "bg-secondary/20 text-foreground",
  aprobada: "bg-success/15 text-success",
  rechazada: "bg-destructive/15 text-destructive",
};

function ApplicationsList() {
  const { applications } = useApplications();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ApplicationStatus | "todas">("todas");

  const filtered = useMemo(() => {
    return applications.filter((a) => {
      if (filter !== "todas" && a.status !== filter) return false;
      if (!query) return true;
      const q = query.toLowerCase();
      return (
        a.clientName.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        a.product.toLowerCase().includes(q) ||
        a.clientId.includes(q)
      );
    });
  }, [applications, query, filter]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">Solicitudes</h1>
          <p className="text-sm text-muted-foreground">{applications.length} en total</p>
        </div>
        <Link
          to="/solicitudes/nueva"
          className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-soft hover:opacity-90"
        >
          <FilePlus className="h-4 w-4" />
          Nueva
        </Link>
      </header>

      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por cliente, cédula, producto o N° de solicitud..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-11 rounded-full bg-card pl-10"
        />
      </div>

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "shrink-0 rounded-full px-4 py-1.5 text-sm transition-colors",
              filter === f.key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-3 p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <FileText className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">No hay solicitudes que coincidan.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((a) => (
            <Card key={a.id} className="p-5 transition-all hover:shadow-elegant">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-caramel text-primary-foreground shadow-soft">
                  <span className="font-display text-base font-semibold">
                    {a.clientName.charAt(0)}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="truncate font-medium">{a.clientName}</p>
                    <span className="font-mono text-[10px] text-muted-foreground">{a.id}</span>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">{a.product}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{a.termMonths} meses</span>
                    <span aria-hidden>·</span>
                    <span>{new Date(a.createdAt).toLocaleDateString("es-CO", { day: "2-digit", month: "short" })}</span>
                    <span aria-hidden>·</span>
                    <span>{a.createdBy}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <p className="font-display text-lg font-semibold tracking-tight">
                    {formatCurrency(a.amount)}
                  </p>
                  <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-medium", STATUS_STYLES[a.status])}>
                    {STATUS_LABEL[a.status]}
                  </span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
