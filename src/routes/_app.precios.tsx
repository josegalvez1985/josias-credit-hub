import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Search, Tag, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { listarPrecios, type PrecioVenta } from "@/lib/api";
import { formatCurrency } from "@/lib/credit-applications";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

export const Route = createFileRoute("/_app/precios")({
  head: () => ({
    meta: [
      { title: "Precios — Créditos" },
      { name: "description", content: "Lista de precios de venta por cuotas." },
    ],
  }),
  component: PreciosPage,
});

function PreciosPage() {
  const [items, setItems] = useState<PrecioVenta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [cuotas, setCuotas] = useState("");

  function load() {
    if (!API_URL) {
      setError("Configura VITE_API_URL para ver los precios del servidor.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    listarPrecios()
      .then((rows) =>
        setItems(
          [...rows].sort(
            (a, b) =>
              a.nombre_articulo.localeCompare(b.nombre_articulo) ||
              a.cantidad_cuotas - b.cantidad_cuotas,
          ),
        ),
      )
      .catch((e) => setError(e instanceof Error ? e.message : "Error al cargar"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const opcionesCuotas = useMemo(
    () => [...new Set(items.map((i) => i.cantidad_cuotas))].sort((a, b) => a - b),
    [items],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qd = q.replace(/\D/g, "");
    return items.filter((i) => {
      if (cuotas && String(i.cantidad_cuotas) !== cuotas) return false;
      if (!q) return true;
      if (i.nombre_articulo.toLowerCase().includes(q)) return true;
      return qd ? String(i.cod_articulo).includes(qd) : false;
    });
  }, [items, query, cuotas]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">Precios</h1>
          <p className="text-sm text-muted-foreground">
            {loading ? "Cargando..." : `${filtered.length} de ${items.length}`}
          </p>
        </div>
        {!loading && API_URL && (
          <Button variant="outline" size="icon" onClick={load} aria-label="Recargar" className="rounded-full">
            <RefreshCw className="h-4 w-4" />
          </Button>
        )}
      </header>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar artículo por nombre o código..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 rounded-full bg-card pl-10"
          />
        </div>
        <select
          value={cuotas}
          onChange={(e) => setCuotas(e.target.value)}
          className="h-11 rounded-full border border-input bg-card px-4 text-sm sm:w-48"
        >
          <option value="">Todas las cuotas</option>
          {opcionesCuotas.map((c) => (
            <option key={c} value={c}>{c} cuotas</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">Cargando precios...</p>
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
            <Tag className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">No hay precios que coincidan.</p>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {filtered.map((p) => (
            <Card key={`${p.cod_articulo}-${p.id_lista_precio}`} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.nombre_articulo}</p>
                  <p className="font-mono text-[10px] text-muted-foreground">#{p.cod_articulo}</p>
                </div>
                <span className="shrink-0 rounded-full bg-secondary/15 px-2 py-0.5 text-[10px] font-medium text-secondary">
                  {p.lista_precio}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <Stat label="Precio base" value={formatCurrency(p.precio_unitario)} />
                <Stat label={`Con recargo (${p.porcentaje}%)`} value={formatCurrency(p.precio_con_recargo)} />
              </div>

              <div className="mt-3 flex items-center justify-between rounded-xl bg-muted px-4 py-3">
                <span className="text-sm font-medium">{p.cantidad_cuotas} cuotas</span>
                <span className="font-display text-lg font-semibold">
                  {p.valor_cuota != null ? `${formatCurrency(p.valor_cuota)}/mes` : "—"}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
