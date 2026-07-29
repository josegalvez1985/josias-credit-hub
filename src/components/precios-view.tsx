import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tag, Loader2, AlertCircle, RefreshCw, X, Search } from "lucide-react";
import { listarPrecios, type LovItem, type PrecioVenta } from "@/lib/api";
import { formatCurrency } from "@/lib/credit-applications";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AsyncCombobox } from "@/components/async-combobox";

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

// Lista de precios sobre V_PRECIOS_VENTAS, compartida por dos pantallas:
//   /precios                     -> la de asesores, que ya existía
//   /recibos/precios-articulos   -> la página 7 de la app de cobradores
// Es la misma vista y los mismos datos; solo cambia el título.
export function PreciosView({
  titulo = "Precios",
  descripcion,
}: {
  titulo?: string;
  descripcion?: string;
}) {
  const [items, setItems] = useState<PrecioVenta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [articulo, setArticulo] = useState<{ value: number; label: string } | null>(null);
  const [cuotas, setCuotas] = useState<{ value: number; label: string } | null>(null);

  // Búsqueda libre por artículo y condición: es el ítem P7_SEARCH de la página 7.
  const [query, setQuery] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => setBusqueda(query.trim().toLowerCase()), 250);
    return () => clearTimeout(debounce.current);
  }, [query]);

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

  // LOV de artículos (únicos) desde los datos cargados; busca por nombre o código.
  const fetchArticulos = useCallback(
    async (q?: string): Promise<LovItem[]> => {
      const vistos = new Map<number, string>();
      for (const i of items) if (!vistos.has(i.cod_articulo)) vistos.set(i.cod_articulo, i.nombre_articulo);
      const term = (q ?? "").trim().toLowerCase();
      const qd = term.replace(/\D/g, "");
      return [...vistos.entries()]
        .filter(([cod, nombre]) =>
          !term || nombre.toLowerCase().includes(term) || (qd ? String(cod).includes(qd) : false),
        )
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ value, label }));
    },
    [items],
  );

  // LOV de cuotas (valores únicos).
  const fetchCuotas = useCallback(
    async (q?: string): Promise<LovItem[]> => {
      const term = (q ?? "").trim();
      return [...new Set(items.map((i) => i.cantidad_cuotas))]
        .sort((a, b) => a - b)
        .filter((c) => !term || String(c).includes(term))
        .map((c) => ({ value: c, label: `${c} cuotas` }));
    },
    [items],
  );

  const filtered = useMemo(
    () =>
      items.filter(
        (i) =>
          (!articulo || i.cod_articulo === articulo.value) &&
          (!cuotas || i.cantidad_cuotas === cuotas.value) &&
          (!busqueda ||
            i.nombre_articulo.toLowerCase().includes(busqueda) ||
            (i.lista_precio ?? "").toLowerCase().includes(busqueda)),
      ),
    [items, articulo, cuotas, busqueda],
  );

  const hayFiltros = Boolean(articulo || cuotas || busqueda);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-semibold">{titulo}</h1>
          <p className="text-sm text-muted-foreground">
            {loading ? "Cargando..." : descripcion ?? `${filtered.length} de ${items.length}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hayFiltros && !loading && (
            <Button
              variant="ghost"
              onClick={() => {
                setArticulo(null);
                setCuotas(null);
                setQuery("");
              }}
              className="rounded-full text-xs"
            >
              Restablecer
            </Button>
          )}
          {!loading && API_URL && (
            <Button variant="outline" size="icon" onClick={load} aria-label="Recargar" className="rounded-full">
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
        </div>
      </header>

      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por artículo o condición..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 rounded-full bg-card pl-10"
          />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex flex-1 items-center gap-2">
            <div className="min-w-0 flex-1">
              <AsyncCombobox
                title="Artículo"
                placeholder="Todos los artículos"
                value={articulo?.value ?? null}
                label={articulo?.label ?? null}
                fetcher={fetchArticulos}
                onSelect={(it) => setArticulo({ value: it.value, label: it.label })}
              />
            </div>
            {articulo && (
              <Button variant="ghost" size="icon" onClick={() => setArticulo(null)} aria-label="Quitar artículo" className="shrink-0 rounded-full">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 sm:w-56">
            <div className="min-w-0 flex-1">
              <AsyncCombobox
                title="Cantidad de cuotas"
                placeholder="Todas las cuotas"
                value={cuotas?.value ?? null}
                label={cuotas?.label ?? null}
                fetcher={fetchCuotas}
                onSelect={(it) => setCuotas({ value: it.value, label: it.label })}
              />
            </div>
            {cuotas && (
              <Button variant="ghost" size="icon" onClick={() => setCuotas(null)} aria-label="Quitar cuotas" className="shrink-0 rounded-full">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
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
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {filtered.map((p) => (
            <Card key={`${p.cod_articulo}-${p.id_lista_precio}`} className="min-w-0 overflow-hidden p-4 sm:p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.nombre_articulo}</p>
                  <p className="font-mono text-[10px] text-muted-foreground">#{p.cod_articulo}</p>
                </div>
                <span className="shrink-0 rounded-full bg-secondary/15 px-2 py-0.5 text-[10px] font-medium text-secondary">
                  {p.lista_precio}
                </span>
              </div>

              {/* La página 7 muestra Precio (PRECIO_CON_RECARGO) y Cuota (VALOR_CUOTA);
                  la pantalla anterior solo traía la cuota. */}
              <div className="mt-3 space-y-2 rounded-xl bg-muted px-3 py-3 sm:px-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="shrink-0 text-xs text-muted-foreground">Precio</span>
                  <span className="min-w-0 truncate text-right font-display text-sm font-semibold">
                    {formatCurrency(p.precio_con_recargo)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2">
                  <span className="shrink-0 text-sm font-medium">{p.cantidad_cuotas} cuotas</span>
                  <span className="min-w-0 truncate text-right font-display text-base font-semibold sm:text-lg">
                    {p.valor_cuota != null ? `${formatCurrency(p.valor_cuota)}/mes` : "—"}
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
