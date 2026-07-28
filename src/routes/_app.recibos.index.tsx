import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Search, Receipt, Loader2, AlertCircle, RefreshCw, Plus, Ban, Eye } from "lucide-react";
import { listarRecibos, obtenerRecibo, type Recibo, type ReciboDetalle } from "@/lib/api";
import { formatCurrency } from "@/lib/credit-applications";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReciboAcciones, ticketDesdeRecibo } from "@/components/recibo-acciones";
import { cn } from "@/lib/utils";

const API_URL = import.meta.env.VITE_API_URL as string | undefined;
const PAGINA = 50;

export const Route = createFileRoute("/_app/recibos/")({
  head: () => ({
    meta: [
      { title: "Recibos — Créditos" },
      { name: "description", content: "Emisión y gestión de recibos." },
    ],
  }),
  component: RecibosPage,
});

type Filtro = "N" | "S" | "T";

const FILTROS: { key: Filtro; label: string }[] = [
  { key: "N", label: "Vigentes" },
  { key: "S", label: "Anulados" },
  { key: "T", label: "Todos" },
];

const claveRecibo = (r: Recibo) => `${r.nro_recibo}-${r.id_solicitud}-${r.id_cuota}`;

function RecibosPage() {
  const [items, setItems] = useState<Recibo[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMas, setLoadingMas] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [anulados, setAnulados] = useState<Filtro>("N");
  const [verNro, setVerNro] = useState<number | null>(null);

  // La búsqueda es server-side (son 130.000+ recibos), así que se espera a que
  // el usuario deje de tipear antes de pegarle a la API.
  const [busqueda, setBusqueda] = useState("");
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => setBusqueda(query), 350);
    return () => clearTimeout(debounce.current);
  }, [query]);

  const load = useCallback(() => {
    if (!API_URL) {
      setError("Configura VITE_API_URL para ver los recibos del servidor.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    listarRecibos({ q: busqueda, anulados, limit: PAGINA, offset: 0 })
      .then((r) => {
        setItems(r.items);
        setHasMore(r.hasMore);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error al cargar"))
      .finally(() => setLoading(false));
  }, [busqueda, anulados]);

  useEffect(load, [load]);

  function cargarMas() {
    setLoadingMas(true);
    listarRecibos({ q: busqueda, anulados, limit: PAGINA, offset: items.length })
      .then((r) => {
        setItems((prev) => [...prev, ...r.items]);
        setHasMore(r.hasMore);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error al cargar"))
      .finally(() => setLoadingMas(false));
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-semibold">Recibos</h1>
          <p className="text-sm text-muted-foreground">
            {loading ? "Cargando..." : `${items.length}${hasMore ? "+" : ""} recibos`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!loading && API_URL && (
            <Button variant="outline" size="icon" onClick={load} aria-label="Recargar" className="rounded-full">
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
          <Link
            to="/recibos/nuevo"
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-soft hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Crear Recibo
          </Link>
        </div>
      </header>

      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por cliente, CI, nro. de recibo o solicitud..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 rounded-full bg-card pl-10"
          />
        </div>

        <div className="flex gap-2">
          {FILTROS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setAnulados(f.key)}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors",
                anulados === f.key
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">Cargando recibos...</p>
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
            <Receipt className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">
            {busqueda ? "No hay recibos que coincidan." : "Todavía no hay recibos."}
          </p>
        </Card>
      ) : (
        <>
          {/* Escritorio: la misma grilla de la página 2 de APEX */}
          <Card className="hidden overflow-hidden p-0 lg:block">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/60 hover:bg-muted/60">
                    <TableHead className="w-14">Ver</TableHead>
                    <TableHead className="text-right">Nro Recibo</TableHead>
                    <TableHead>Fecha Recibo</TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead className="text-right">Nro Solicitud</TableHead>
                    <TableHead className="text-right">Nro Cuota</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((r) => {
                    const anulado = r.anulado === "S";
                    return (
                      <TableRow key={claveRecibo(r)} className={cn(anulado && "opacity-60")}>
                        <TableCell>
                          <button
                            type="button"
                            onClick={() => setVerNro(r.nro_recibo)}
                            aria-label={`Ver recibo ${r.nro_recibo}`}
                            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary/15 hover:text-secondary"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">{r.nro_recibo}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatDate(r.fecha_recibo)}</TableCell>
                        <TableCell className="max-w-[22rem]">
                          <div className="flex items-center gap-1.5">
                            <span className={cn("min-w-0 truncate font-medium", anulado && "line-through")}>
                              {r.nombre}
                            </span>
                            {anulado && <BadgeAnulado />}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{r.nro_solicitud}</TableCell>
                        <TableCell className="text-right">
                          {r.nro_cuota === 0 ? "Ent. inicial" : r.nro_cuota}
                        </TableCell>
                        <TableCell className="text-right font-display font-semibold">
                          {formatCurrency(r.monto)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>

          {/* Celular: cada fila como tarjeta.
              grid-cols-1 no es decorativo: sin columnas explícitas el track es
              `auto` y no baja del ancho del contenido, así que un nombre largo
              estira la tarjeta fuera de la pantalla. Tailwind define grid-cols-1
              como minmax(0, 1fr), que sí permite achicar. */}
          <div className="grid grid-cols-1 gap-3 lg:hidden">
            {items.map((r) => (
              <ReciboCard key={claveRecibo(r)} recibo={r} onVer={() => setVerNro(r.nro_recibo)} />
            ))}
          </div>

          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={cargarMas} disabled={loadingMas} className="rounded-full">
                {loadingMas ? <Loader2 className="h-4 w-4 animate-spin" /> : "Cargar más"}
              </Button>
            </div>
          )}
        </>
      )}

      <DetalleDialog nroRecibo={verNro} onClose={() => setVerNro(null)} />
    </div>
  );
}

function BadgeAnulado() {
  return (
    <span className="shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
      Anulado
    </span>
  );
}

function ReciboCard({ recibo: r, onVer }: { recibo: Recibo; onVer: () => void }) {
  const anulado = r.anulado === "S";
  return (
    <Card
      onClick={onVer}
      className={cn(
        "min-w-0 cursor-pointer overflow-hidden p-5 transition-all active:scale-[0.99] hover:shadow-elegant",
        anulado && "opacity-70",
      )}
    >
      <div className="flex min-w-0 items-start gap-4">
        <div
          className={cn(
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-soft",
            anulado ? "bg-muted text-muted-foreground" : "bg-gradient-caramel text-primary-foreground",
          )}
        >
          {anulado ? <Ban className="h-5 w-5" /> : <Receipt className="h-5 w-5" />}
        </div>

        <div className="min-w-0 flex-1">
          {/* min-w-0 en el <p>: sin eso el truncate no achica nada. Un flex item
              tiene min-width:auto por defecto y no baja del ancho del texto, así
              que un nombre largo desborda la tarjeta en vez de cortarse. */}
          <div className="flex items-center gap-2">
            <p className={cn("min-w-0 flex-1 truncate font-medium", anulado && "line-through")}>
              {r.nombre}
            </p>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              #{r.nro_recibo}
            </span>
            {anulado && <BadgeAnulado />}
          </div>

          <p className="mt-1 truncate font-display text-lg font-semibold tracking-tight">
            {formatCurrency(r.monto)}
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="whitespace-nowrap">Solicitud {r.nro_solicitud}</span>
            <span aria-hidden>·</span>
            <span className="whitespace-nowrap">
              {r.nro_cuota === 0 ? "Entrega inicial" : `Cuota ${r.nro_cuota}`}
            </span>
            <span aria-hidden>·</span>
            <span className="whitespace-nowrap">{formatDate(r.fecha_recibo)}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

// La columna "Ver" de APEX abre la página 3 como modal; acá se mantiene modal.
function DetalleDialog({ nroRecibo, onClose }: { nroRecibo: number | null; onClose: () => void }) {
  const [detalle, setDetalle] = useState<ReciboDetalle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (nroRecibo === null) return;
    setLoading(true);
    setError(null);
    setDetalle(null);
    obtenerRecibo(nroRecibo)
      .then(setDetalle)
      .catch((e) => setError(e instanceof Error ? e.message : "Error al cargar"))
      .finally(() => setLoading(false));
  }, [nroRecibo]);

  return (
    <Dialog open={nroRecibo !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={undefined} className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display text-xl">
            Recibo #{nroRecibo}
            {detalle?.anulado === "S" && <span className="ml-2 align-middle"><BadgeAnulado /></span>}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Cargando...
          </div>
        ) : error ? (
          <p className="py-6 text-center text-sm text-destructive">{error}</p>
        ) : !detalle ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Recibo no encontrado.</p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-2xl bg-gradient-caramel p-5 text-primary-foreground shadow-elegant">
              <p className="text-xs uppercase tracking-wider opacity-80">Monto cobrado</p>
              <p className="mt-1 font-display text-3xl font-semibold">{formatCurrency(detalle.monto)}</p>
              {detalle.monto_letras && (
                <p className="mt-1 text-xs opacity-80">{detalle.monto_letras}</p>
              )}
            </div>

            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Row label="Fecha" value={formatDate(detalle.fecha_recibo)} />
              <Row label="Cliente" value={detalle.razon_social} />
              <Row label="Documento" value={detalle.documento} />
              <Row label="Teléfono" value={detalle.nro_telefono} />
              <Row label="Solicitud" value={detalle.nro_solicitud} />
              <Row
                label="Cuota"
                value={detalle.cuota_texto ?? (detalle.nro_cuota === 0 ? "Entrega inicial" : String(detalle.nro_cuota))}
              />
              <Row label="Vencimiento" value={detalle.fec_vencimiento ? formatDate(detalle.fec_vencimiento) : undefined} />
              <Row label="Monto de la cuota" value={detalle.monto_cuota != null ? formatCurrency(detalle.monto_cuota) : undefined} />
              <Row label="Saldo previo" value={detalle.saldo_cuota != null ? formatCurrency(detalle.saldo_cuota) : undefined} />
              <Row label="Intereses" value={detalle.total_interes != null ? formatCurrency(detalle.total_interes) : undefined} />
              <Row label="Cobrador" value={detalle.nombre_usuario ?? detalle.cod_usuario} />
            </div>

            {detalle.concepto && (
              <div className="rounded-xl border border-border p-3">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Concepto</p>
                <p className="mt-1 text-sm">{detalle.concepto}</p>
              </div>
            )}

            {/* Los botones ORIGINAL / DUPLICADO / WhatsApp de la página 3 de APEX,
                que allá aparecían solo con el recibo ya guardado. */}
            {detalle.anulado !== "S" && (
              <div className="space-y-2 border-t border-border pt-4">
                <ReciboAcciones datos={ticketDesdeRecibo(detalle)} telefono={detalle.nro_telefono} />
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value?: string | number }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-2 sm:border-0 sm:pb-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium">{value || "—"}</span>
    </div>
  );
}

function formatDate(d: string) {
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  return date.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });
}
