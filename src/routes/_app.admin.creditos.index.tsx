import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Eye,
  FileSpreadsheet,
  Loader2,
  Printer,
  RefreshCw,
  ScrollText,
  Search,
} from "lucide-react";
import {
  listarCreditos,
  obtenerCredito,
  obtenerCreditoCompleto,
  type CreditoRow,
} from "@/lib/api";
import { imprimirSolicitud } from "@/lib/impresion-solicitud";
import { imprimirPagare } from "@/lib/impresion-pagare";
import { formatCurrency } from "@/lib/credit-applications";
import { AdminHeader } from "./_app.admin";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

export const Route = createFileRoute("/_app/admin/creditos/")({
  head: () => ({
    meta: [
      { title: "Solicitud de Créditos — Administración" },
      { name: "description", content: "Consulta de créditos otorgados." },
    ],
  }),
  component: CreditosPage,
});

// Página 18 de APEX ("Facturas" / Créditos Otorgados), en modo consulta.
// Como el módulo es de escritorio (ver src/lib/permisos.ts), acá sí va una
// tabla y no la grilla de tarjetas del resto de la app: se usa en una PC y
// conservar las columnas del Interactive Grid es lo que se espera.
function CreditosPage() {
  const [items, setItems] = useState<CreditoRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMas, setLoadingMas] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Búsqueda server-side: son muchas filas, así que se espera a que el usuario
  // deje de tipear antes de pegarle a la API (mismo criterio que recibos).
  const [busqueda, setBusqueda] = useState("");
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => setBusqueda(query), 350);
    return () => clearTimeout(debounce.current);
  }, [query]);

  // ORDS pagina por número de página (?page=N), no por offset: el handler es
  // json/query y la paginación la maneja él. Ver listarCreditos en api.ts.
  const [pagina, setPagina] = useState(0);

  const load = useCallback(() => {
    if (!API_URL) {
      setError("Configura VITE_API_URL para ver los créditos del servidor.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    listarCreditos({ buscar: busqueda })
      .then((r) => {
        setItems(r.items);
        setHasMore(r.hasMore);
        setPagina(0);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error al cargar"))
      .finally(() => setLoading(false));
  }, [busqueda]);

  useEffect(load, [load]);

  function cargarMas() {
    const siguiente = pagina + 1;
    setLoadingMas(true);
    listarCreditos({ buscar: busqueda, page: siguiente })
      .then((r) => {
        setItems((prev) => [...prev, ...r.items]);
        setHasMore(r.hasMore);
        setPagina(siguiente);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error al cargar"))
      .finally(() => setLoadingMas(false));
  }

  // Réplica de la columna PDF de la página 18 de APEX, que abría la página 57.
  //
  // El listado solo tiene la cabecera, así que hay que traer los tres bloques
  // hijos antes de armar el impreso. Se hace al vuelo y no al cargar la tabla:
  // son 3 requests por crédito y nadie imprime las 30 filas de una.
  // Guarda qué fila está cargando y para cuál de los dos impresos.
  const [imprimiendo, setImprimiendo] = useState<{ id: number; doc: "sol" | "pag" } | null>(null);

  async function imprimir(id: number) {
    setImprimiendo({ id, doc: "sol" });
    try {
      const d = await obtenerCreditoCompleto(id);
      imprimirSolicitud({
        cabecera: d.cabecera,
        articulos: d.articulos,
        actividad: d.actividad,
        referencias: d.referencias,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo abrir el impreso");
    } finally {
      setImprimiendo(null);
    }
  }

  // El pagaré solo necesita la cabecera (monto, monto en letras, % interés y
  // datos del titular), así que se pide sola en vez del crédito completo.
  async function pagare(id: number) {
    setImprimiendo({ id, doc: "pag" });
    try {
      imprimirPagare(await obtenerCredito(id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo abrir el pagaré");
    } finally {
      setImprimiendo(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <AdminHeader
          titulo="Solicitud de Créditos"
          descripcion={loading ? "Cargando..." : `${items.length}${hasMore ? "+" : ""} créditos otorgados`}
        />
        {!loading && API_URL && (
          <Button variant="outline" size="icon" onClick={load} aria-label="Recargar" className="rounded-full">
            <RefreshCw className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por nro. de solicitud, factura, CI/RUC o nombre..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-11 rounded-full bg-card pl-10"
        />
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">Cargando créditos...</p>
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
      ) : items.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-3 p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">
            {busqueda ? "No hay créditos que coincidan." : "Todavía no hay créditos otorgados."}
          </p>
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/60 hover:bg-muted/60">
                    <TableHead className="w-14">Ver</TableHead>
                    <TableHead className="w-14">Sol.</TableHead>
                    <TableHead className="w-14">Pagaré</TableHead>
                    <TableHead className="text-right">Nro. Solicitud</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Nro. Factura</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Cuotas</TableHead>
                    <TableHead className="text-right">Monto Cuota</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Vendedor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Link
                          to="/admin/creditos/$id"
                          params={{ id: String(c.id) }}
                          aria-label={`Ver crédito ${c.nro_solicitud}`}
                          className="inline-flex rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary/15 hover:text-secondary"
                        >
                          <Eye className="h-4 w-4" />
                        </Link>
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => imprimir(c.id)}
                          disabled={imprimiendo !== null}
                          aria-label={`Imprimir solicitud ${c.nro_solicitud}`}
                          title="Imprimir solicitud"
                          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary/15 hover:text-secondary disabled:opacity-40"
                        >
                          {imprimiendo?.id === c.id && imprimiendo.doc === "sol" ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Printer className="h-4 w-4" />
                          )}
                        </button>
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => pagare(c.id)}
                          disabled={imprimiendo !== null}
                          aria-label={`Imprimir pagaré ${c.nro_solicitud}`}
                          title="Imprimir pagaré"
                          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary/15 hover:text-secondary disabled:opacity-40"
                        >
                          {imprimiendo?.id === c.id && imprimiendo.doc === "pag" ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <ScrollText className="h-4 w-4" />
                          )}
                        </button>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{c.nro_solicitud}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(c.fecha_factura)}</TableCell>
                      <TableCell className="max-w-[10rem] truncate">{c.referencia || "—"}</TableCell>
                      {/* max-w + truncate: una <td> no se achica sola y el
                          nombre del cliente es el texto más largo de la fila. */}
                      <TableCell className="max-w-[20rem]">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{c.razon_social || `Cliente ${c.cod_cliente}`}</p>
                          {c.documento && (
                            <p className="truncate text-xs text-muted-foreground">{c.documento}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{c.cantidad_cuotas ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        {c.monto_cuota != null ? formatCurrency(c.monto_cuota) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-display font-semibold">
                        {c.total != null ? formatCurrency(c.total) : "—"}
                      </TableCell>
                      <TableCell className="max-w-[12rem] truncate text-sm text-muted-foreground">
                        {c.vendedor || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>

          {hasMore && (
            <div className="flex flex-col items-center gap-1.5 pt-2">
              <Button variant="outline" onClick={cargarMas} disabled={loadingMas} className="rounded-full">
                {loadingMas ? <Loader2 className="h-4 w-4 animate-spin" /> : "Mostrar más"}
              </Button>
              <p className="text-xs text-muted-foreground">Mostrando {items.length} créditos</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function formatDate(d?: string) {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  return date.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });
}
