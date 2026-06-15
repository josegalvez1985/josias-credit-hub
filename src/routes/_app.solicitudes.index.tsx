import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Search, FilePlus, FileText, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { listarCabeceras, nombresClientes, type Cabecera } from "@/lib/api";
import { formatCurrency } from "@/lib/credit-applications";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

export const Route = createFileRoute("/_app/solicitudes/")({
  head: () => ({
    meta: [
      { title: "Solicitudes — Créditos" },
      { name: "description", content: "Listado de solicitudes de crédito." },
    ],
  }),
  component: ApplicationsList,
});

function ApplicationsList() {
  const [items, setItems] = useState<Cabecera[]>([]);
  const [nombres, setNombres] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  function load() {
    if (!API_URL) {
      setError("Configura VITE_API_URL para ver las solicitudes del servidor.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    listarCabeceras()
      .then(async (cabs) => {
        const ordenadas = [...cabs].sort((a, b) => b.id - a.id);
        setItems(ordenadas);
        try {
          setNombres(await nombresClientes(ordenadas.map((c) => c.cod_cliente)));
        } catch {
          /* nombres opcionales */
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error al cargar"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const filtered = useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter(
      (a) =>
        String(a.nro_solicitud).includes(q) ||
        (nombres.get(a.cod_cliente) ?? "").toLowerCase().includes(q) ||
        String(a.cod_cliente).includes(q) ||
        (a.referencia ?? "").toLowerCase().includes(q),
    );
  }, [items, query, nombres]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">Solicitudes</h1>
          <p className="text-sm text-muted-foreground">
            {loading ? "Cargando..." : `${items.length} en total`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!loading && API_URL && (
            <Button variant="outline" size="icon" onClick={load} aria-label="Recargar" className="rounded-full">
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
          <Link
            to="/solicitudes/nueva"
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-soft hover:opacity-90"
          >
            <FilePlus className="h-4 w-4" />
            Nueva
          </Link>
        </div>
      </header>

      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por N° solicitud, cliente o referencia..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-11 rounded-full bg-card pl-10"
        />
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">Cargando solicitudes...</p>
        </div>
      ) : error ? (
        <Card className="flex flex-col items-center justify-center gap-3 p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertCircle className="h-5 w-5" />
          </div>
          <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
          {API_URL && (
            <Button variant="outline" onClick={load} className="mt-1">
              <RefreshCw className="h-4 w-4" /> Reintentar
            </Button>
          )}
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-3 p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <FileText className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">No hay solicitudes que coincidan.</p>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {filtered.map((a) => {
            const nombre = nombres.get(a.cod_cliente) ?? `Cliente ${a.cod_cliente}`;
            return (
              <Link key={a.id} to="/solicitudes/$id" params={{ id: String(a.id) }} className="block">
                <Card className="h-full p-5 transition-all hover:-translate-y-0.5 hover:shadow-elegant">
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-caramel text-primary-foreground shadow-soft">
                      <span className="font-display text-base font-semibold">{nombre.charAt(0)}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="truncate font-medium">{nombre}</p>
                        <span className="font-mono text-[10px] text-muted-foreground">#{a.nro_solicitud}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{a.cantidad_cuotas} cuotas</span>
                        <span aria-hidden>·</span>
                        <span>{formatCurrency(a.monto_cuota)}/mes</span>
                        {a.fecha_factura && (
                          <>
                            <span aria-hidden>·</span>
                            <span>{formatDate(a.fecha_factura)}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-display text-lg font-semibold tracking-tight">{formatCurrency(a.total)}</p>
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatDate(d: string) {
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  return date.toLocaleDateString("es-PY", { day: "2-digit", month: "short" });
}
