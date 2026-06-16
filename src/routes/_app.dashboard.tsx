import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowUpRight, FilePlus, FileText, Sparkles, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { formatCurrency } from "@/lib/credit-applications";
import { listarCabeceras, nombresClientes, type Cabecera } from "@/lib/api";
import { Card } from "@/components/ui/card";

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({
    meta: [
      { title: "Inicio — Créditos" },
      { name: "description", content: "Resumen y accesos rápidos para gestionar solicitudes." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { user } = useAuth();
  const [items, setItems] = useState<Cabecera[]>([]);
  const [nombres, setNombres] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!API_URL) {
      setLoading(false);
      return;
    }
    listarCabeceras()
      .then(async (cabs) => {
        setItems(cabs);
        try {
          setNombres(await nombresClientes(cabs.slice(0, 4).map((c) => c.cod_cliente)));
        } catch {
          /* nombres opcionales */
        }
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  const count = items.length;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches";

  return (
    <div className="space-y-8">
      {/* Hero greeting */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-wood p-7 text-primary-foreground shadow-warm sm:p-9">
        <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-secondary/30 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wider ring-1 ring-white/20">
              <Sparkles className="h-3 w-3" />
              Panel del asesor
            </div>
            <h1 className="mt-4 font-display text-3xl font-semibold sm:text-4xl">
              {greeting}, {user?.name.split(" ")[0]}.
            </h1>
            <p className="mt-2 max-w-md text-sm text-primary-foreground/80">
              Estas son tus solicitudes y movimientos recientes.
            </p>
          </div>

          <div className="flex flex-wrap gap-3 lg:shrink-0 lg:flex-col">
            <Link
              to="/solicitudes/nueva"
              className="inline-flex items-center gap-2 rounded-full bg-gradient-caramel px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-elegant transition-transform hover:scale-[1.02]"
            >
              <FilePlus className="h-4 w-4" />
              Nueva solicitud
            </Link>
            <Link
              to="/solicitudes"
              className="inline-flex items-center gap-2 rounded-full bg-white/10 px-5 py-2.5 text-sm font-medium text-primary-foreground ring-1 ring-white/20 backdrop-blur transition-colors hover:bg-white/15"
            >
              Ver todas <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Recent */}
      <section>
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="font-display text-xl font-semibold">Recientes</h2>
            <p className="text-sm text-muted-foreground">Las últimas solicitudes registradas.</p>
          </div>
          <Link to="/solicitudes" className="text-sm font-medium text-secondary hover:underline">
            Ver todas
          </Link>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Cargando...
          </div>
        ) : count === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Aún no hay solicitudes registradas.
          </Card>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {items.slice(0, 4).map((a) => (
              <Link key={a.id} to="/solicitudes" className="block">
                <Card className="flex h-full items-center gap-3 p-4 transition-all hover:-translate-y-0.5 hover:shadow-elegant">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-secondary/15 text-secondary">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate font-medium">
                        Solicitud {a.estado === "APROBADO" ? `#${a.nro_solicitud}` : "—"}
                      </p>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">ID {a.id}</span>
                      {a.estado && (
                        <span className="shrink-0 rounded-full bg-secondary/15 px-2 py-0.5 text-[10px] font-medium text-secondary">
                          {a.estado}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {nombres.get(a.cod_cliente) || a.referencia || `Cliente ${a.cod_cliente}`}
                    </p>
                    <div className="mt-1 flex items-baseline gap-2">
                      <p className="font-display text-base font-semibold">{formatCurrency(a.total)}</p>
                      <p className="text-xs text-muted-foreground">{a.cantidad_cuotas} cuotas</p>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
