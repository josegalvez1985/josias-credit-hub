import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Eye, FileChartColumn, Loader2, RefreshCw, X } from "lucide-react";
import {
  filtrarLov,
  listarComprasPeriodo,
  type CompraPeriodo,
  type LovItem,
  type ProveedorLov,
} from "@/lib/api";
import { agrupar, type Grupo } from "@/lib/reporte-saldos-proveedores";
import {
  abrirReporteCompras,
  CONDICION_FILTRO,
  filtrarCompras,
  nombreCondicion,
  ordenarPorFecha,
  saldoCompra,
  totalesCompras,
  type CondicionFiltro,
} from "@/lib/reporte-compras";
import { formatCurrency } from "@/lib/credit-applications";
import { cn, fechaPy, hoyISO } from "@/lib/utils";
import { AdminHeader } from "./_app.admin";
import { ArticulosFacturaDialog } from "@/components/articulos-factura-dialog";
import { AsyncCombobox } from "@/components/async-combobox";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

export const Route = createFileRoute("/_app/admin/reportes/compras")({
  head: () => ({
    meta: [
      { title: "Compras por Período — Reportes" },
      { name: "description", content: "Reporte en PDF de las facturas de compra de un período." },
    ],
  }),
  component: ComprasPeriodoPage,
});

const dos = (n: number) => String(n).padStart(2, "0");

// Atajos de período, armados con componentes locales (nunca toISOString: da
// la fecha UTC, ver GUIA-FRONTEND §7).
function rangoMes(desplazamiento: number): [string, string] {
  const [y, m] = hoyISO().split("-").map(Number);
  const d = new Date(y, m - 1 + desplazamiento, 1);
  const yy = d.getFullYear();
  const mm = d.getMonth() + 1;
  const ultimo = new Date(yy, mm, 0).getDate();
  return [`${yy}-${dos(mm)}-01`, `${yy}-${dos(mm)}-${dos(ultimo)}`];
}

const ATAJOS: { label: string; rango: () => [string, string] }[] = [
  { label: "Este mes", rango: () => [rangoMes(0)[0], hoyISO()] },
  { label: "Mes anterior", rango: () => rangoMes(-1) },
  { label: "Este año", rango: () => [`${hoyISO().slice(0, 4)}-01-01`, hoyISO()] },
];

// Pantalla del reporte: período y opciones, una vista previa y el botón que
// abre el PDF (src/lib/reporte-compras.ts). Las facturas del período se piden
// al servidor cada vez que cambian las fechas; condición, proveedor y
// agrupado se aplican acá, sin volver a pedir.
function ComprasPeriodoPage() {
  const [desde, setDesde] = useState(() => rangoMes(0)[0]);
  const [hasta, setHasta] = useState(hoyISO);
  const [condicion, setCondicion] = useState<CondicionFiltro>("todas");
  const [filtro, setFiltro] = useState<ProveedorLov | null>(null);
  const [agruparProv, setAgruparProv] = useState(false);

  const [facturas, setFacturas] = useState<CompraPeriodo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generando, setGenerando] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const [verFactura, setVerFactura] = useState<CompraPeriodo | null>(null);

  const rangoValido = !!desde && !!hasta && desde <= hasta;

  useEffect(() => {
    if (!API_URL) {
      setError("Configura VITE_API_URL para ver las compras.");
      setLoading(false);
      return;
    }
    if (!rangoValido) {
      setFacturas([]);
      setLoading(false);
      return;
    }
    // Si el usuario cambia las fechas antes de que vuelva la consulta
    // anterior, esa respuesta vieja se descarta.
    let vigente = true;
    setLoading(true);
    setError(null);
    listarComprasPeriodo({ desde, hasta })
      .then((fs) => vigente && setFacturas(fs))
      .catch((e) => vigente && setError(e instanceof Error ? e.message : "Error al cargar"))
      .finally(() => vigente && setLoading(false));
    return () => {
      vigente = false;
    };
  }, [desde, hasta, rangoValido, recarga]);

  // Proveedores con compras en el período, para el filtro.
  const proveedores = useMemo<ProveedorLov[]>(
    () =>
      agrupar(facturas).flatMap((g) =>
        g.cod === null
          ? []
          : [
              {
                value: g.cod,
                label: g.nombre,
                documento: g.documento,
                pendientes: g.facturas.length,
                saldo: g.total,
              },
            ],
      ),
    [facturas],
  );
  const fetchProveedores = useCallback(
    async (q?: string) => filtrarLov(proveedores, q),
    [proveedores],
  );

  // Las mismas opciones que va a usar el PDF.
  const op = { desde, hasta, condicion, proveedor: filtro, agrupar: agruparProv };
  const visibles = useMemo(
    () => filtrarCompras(facturas, { desde, hasta, condicion, proveedor: filtro, agrupar: false }),
    [facturas, desde, hasta, condicion, filtro],
  );
  const t = totalesCompras(visibles);

  // Lo que se ve, en el orden en que se ve: el modal de artículos lo recorre
  // con Anterior / Siguiente.
  const grupos = useMemo(() => agrupar(visibles), [visibles]);
  const enOrden = useMemo(
    () => (agruparProv ? grupos.flatMap((g) => g.facturas) : ordenarPorFecha(visibles)),
    [agruparProv, grupos, visibles],
  );

  function aplicarAtajo(rango: [string, string]) {
    setDesde(rango[0]);
    setHasta(rango[1]);
  }

  // Sin await antes de abrirReporteCompras: la pestaña tiene que abrirse
  // dentro del click para que el bloqueador de ventanas emergentes no la frene.
  function generar() {
    setGenerando(true);
    abrirReporteCompras(op)
      .catch((e) => toast.error(e instanceof Error ? e.message : "No se pudo generar el reporte"))
      .finally(() => setGenerando(false));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <AdminHeader
          titulo="Compras por Período"
          descripcion="Facturas de compra al contado y a crédito · PDF A4 vertical"
        />
        <Button
          onClick={generar}
          disabled={generando || loading || !!error || !rangoValido}
          className="rounded-full bg-primary text-primary-foreground hover:opacity-90"
        >
          {generando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FileChartColumn className="h-4 w-4" />
          )}
          Generar PDF
        </Button>
      </div>

      <Card className="space-y-5 p-6">
        <h2 className="font-display text-lg font-semibold">Opciones</h2>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Período</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="date"
                value={desde}
                max={hasta || undefined}
                onChange={(e) => setDesde(e.target.value)}
                aria-label="Desde"
              />
              <Input
                type="date"
                value={hasta}
                min={desde || undefined}
                onChange={(e) => setHasta(e.target.value)}
                aria-label="Hasta"
              />
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {ATAJOS.map((a) => {
                const [d, h] = a.rango();
                const activo = d === desde && h === hasta;
                return (
                  <button
                    key={a.label}
                    type="button"
                    onClick={() => aplicarAtajo([d, h])}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition-colors",
                      activo
                        ? "border-primary bg-primary/10 font-medium text-foreground"
                        : "border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {a.label}
                  </button>
                );
              })}
            </div>
            {!rangoValido && (
              <p className="text-xs text-destructive">
                Elegí las dos fechas, y que "desde" no sea posterior a "hasta".
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Condición</Label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(CONDICION_FILTRO) as CondicionFiltro[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCondicion(c)}
                  aria-pressed={condicion === c}
                  className={cn(
                    "h-10 rounded-xl border text-sm font-medium transition-colors",
                    condicion === c
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {CONDICION_FILTRO[c].label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Proveedor</Label>
            <div className="flex min-w-0 gap-2">
              <div className="min-w-0 flex-1">
                <AsyncCombobox
                  title="Proveedor"
                  placeholder="Todos los proveedores"
                  emptyText="Ningún proveedor con compras en el período"
                  value={filtro?.value ?? null}
                  label={filtro?.label ?? null}
                  fetcher={fetchProveedores}
                  onSelect={(it: LovItem) => setFiltro(it as ProveedorLov)}
                  renderItem={(it) => {
                    const p = it as ProveedorLov;
                    return (
                      <div className="min-w-0">
                        <p className="truncate font-medium">{p.label}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[
                            p.documento,
                            `${p.pendientes} ${p.pendientes === 1 ? "factura" : "facturas"}`,
                            formatCurrency(p.saldo),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                    );
                  }}
                />
              </div>
              {filtro && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setFiltro(null)}
                  aria-label="Todos los proveedores"
                  title="Todos los proveedores"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4">
            <Checkbox
              checked={agruparProv}
              onCheckedChange={(v) => setAgruparProv(v === true)}
              className="mt-0.5"
            />
            <div className="min-w-0">
              <p className="text-sm font-medium">Agrupar por proveedor</p>
              <p className="text-xs text-muted-foreground">
                Una banda por proveedor con su subtotal. Sin tildar, una sola lista por fecha.
              </p>
            </div>
          </label>
        </div>
      </Card>

      <Card className="space-y-5 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold">Vista previa</h2>
            {rangoValido && (
              <p className="text-sm text-muted-foreground">
                Del {fechaPy(desde)} al {fechaPy(hasta)}
              </p>
            )}
          </div>
          {!loading && API_URL && rangoValido && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRecarga((n) => n + 1)}
              className="gap-1.5 text-muted-foreground"
            >
              <RefreshCw className="h-4 w-4" /> Actualizar
            </Button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando compras...
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertCircle className="h-5 w-5" />
            </div>
            <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
            {API_URL && (
              <Button variant="outline" onClick={() => setRecarga((n) => n + 1)}>
                <RefreshCw className="h-4 w-4" /> Reintentar
              </Button>
            )}
          </div>
        ) : !rangoValido ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Elegí un período válido para ver las compras.
          </p>
        ) : (
          <>
            {/* Los mismos tres totales que el recuadro del PDF */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Total
                titulo="Contado"
                cant={t.contado.cant}
                monto={t.contado.total}
              />
              <Total
                titulo="Crédito"
                cant={t.credito.cant}
                monto={t.credito.total}
                extra={t.credito.saldo > 0 ? `Saldo hoy ${formatCurrency(t.credito.saldo)}` : undefined}
              />
              <Total titulo="Total del período" cant={t.cant} monto={t.total} destacado />
            </div>

            {visibles.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No hay facturas de compra en el período
                {filtro ? " para este proveedor" : ""}.
              </p>
            ) : agruparProv ? (
              <VistaAgrupada grupos={grupos} onVer={setVerFactura} />
            ) : (
              <VistaLista facturas={enOrden} total={t.total} onVer={setVerFactura} />
            )}
          </>
        )}
      </Card>

      <ArticulosFacturaDialog
        factura={verFactura}
        onClose={() => setVerFactura(null)}
        lista={enOrden}
        onCambiar={setVerFactura}
      />
    </div>
  );
}

function BotonVer({ f, onVer }: { f: CompraPeriodo; onVer: (f: CompraPeriodo) => void }) {
  return (
    <TableCell>
      <button
        type="button"
        onClick={() => onVer(f)}
        aria-label={`Ver artículos de la factura ${f.referencia || f.id_cabecera}`}
        title="Ver artículos"
        className="inline-flex rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary/15 hover:text-secondary"
      >
        <Eye className="h-4 w-4" />
      </button>
    </TableCell>
  );
}

function Total({
  titulo,
  cant,
  monto,
  extra,
  destacado,
}: {
  titulo: string;
  cant: number;
  monto: number;
  extra?: string;
  destacado?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-xl border p-4",
        destacado ? "border-primary bg-primary/10" : "border-border",
      )}
    >
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{titulo}</p>
      <p className="mt-1 truncate font-display text-2xl font-semibold tracking-tight">
        {formatCurrency(monto)}
      </p>
      <p className="text-xs text-muted-foreground">
        {cant} {cant === 1 ? "factura" : "facturas"}
        {extra && ` · ${extra}`}
      </p>
    </div>
  );
}

function CeldaSaldo({ f }: { f: CompraPeriodo }) {
  const cierre = saldoCompra(f);
  return (
    <TableCell className={cn("text-right", cierre ? "text-muted-foreground" : "font-medium")}>
      {cierre ?? formatCurrency(f.saldo)}
    </TableCell>
  );
}

function NroFactura({ f }: { f: CompraPeriodo }) {
  return (
    <TableCell className="whitespace-nowrap font-mono text-xs">
      {f.referencia || <span className="text-muted-foreground">ID {f.id_cabecera}</span>}
    </TableCell>
  );
}

// Una sola lista por fecha, como el PDF sin agrupar.
function VistaLista({
  facturas,
  total,
  onVer,
}: {
  facturas: CompraPeriodo[];
  total: number;
  onVer: (f: CompraPeriodo) => void;
}) {
  const saldo = facturas.reduce((s, f) => s + (f.condicion_compra === 2 ? f.saldo : 0), 0);
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/60 hover:bg-muted/60">
            <TableHead className="w-14">Ver</TableHead>
            <TableHead className="w-28">Fecha</TableHead>
            <TableHead>Nro. Factura</TableHead>
            <TableHead>Proveedor</TableHead>
            <TableHead>Condición</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Saldo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {facturas.map((f) => (
            <TableRow key={f.id_cabecera}>
              <BotonVer f={f} onVer={onVer} />
              <TableCell className="whitespace-nowrap">{fechaPy(f.fecha)}</TableCell>
              <NroFactura f={f} />
              <TableCell className="max-w-[22rem]">
                <div className="min-w-0">
                  <p className="truncate font-medium">{f.proveedor || "Sin proveedor"}</p>
                  {f.documento && (
                    <p className="truncate text-xs text-muted-foreground">{f.documento}</p>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <CondicionBadge c={f.condicion_compra} />
              </TableCell>
              <TableCell className="text-right">{formatCurrency(f.total)}</TableCell>
              <CeldaSaldo f={f} />
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={5} className="font-medium">
              {facturas.length} {facturas.length === 1 ? "factura" : "facturas"}
            </TableCell>
            <TableCell className="text-right font-display text-base font-semibold">
              {formatCurrency(total)}
            </TableCell>
            <TableCell className="text-right font-medium">{formatCurrency(saldo)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

// Una banda por proveedor con su subtotal, como el PDF agrupado.
function VistaAgrupada({
  grupos,
  onVer,
}: {
  grupos: Grupo<CompraPeriodo>[];
  onVer: (f: CompraPeriodo) => void;
}) {
  const total = grupos.reduce((s, g) => s + g.total, 0);
  const saldo = grupos.reduce((s, g) => s + g.saldo, 0);
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/60 hover:bg-muted/60">
            <TableHead className="w-14">Ver</TableHead>
            <TableHead className="w-28">Fecha</TableHead>
            <TableHead>Nro. Factura</TableHead>
            <TableHead>Condición</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Saldo</TableHead>
          </TableRow>
        </TableHeader>
        {grupos.map((g) => (
          <TableBody key={g.cod ?? "sin"}>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableCell colSpan={6} className="font-semibold">
                {g.nombre}
                {g.documento && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    RUC/CI {g.documento}
                  </span>
                )}
              </TableCell>
            </TableRow>
            {g.facturas.map((f) => (
              <TableRow key={f.id_cabecera}>
                <BotonVer f={f} onVer={onVer} />
                <TableCell className="whitespace-nowrap">{fechaPy(f.fecha)}</TableCell>
                <NroFactura f={f} />
                <TableCell>
                  <CondicionBadge c={f.condicion_compra} />
                </TableCell>
                <TableCell className="text-right">{formatCurrency(f.total)}</TableCell>
                <CeldaSaldo f={f} />
              </TableRow>
            ))}
            <TableRow className="font-medium hover:bg-transparent">
              <TableCell colSpan={4} className="text-muted-foreground">
                Subtotal · {g.facturas.length} {g.facturas.length === 1 ? "factura" : "facturas"}
              </TableCell>
              <TableCell className="text-right">{formatCurrency(g.total)}</TableCell>
              <TableCell className="text-right">{formatCurrency(g.saldo)}</TableCell>
            </TableRow>
          </TableBody>
        ))}
        <TableFooter>
          <TableRow>
            <TableCell colSpan={4} className="font-medium">
              Total del período
            </TableCell>
            <TableCell className="text-right font-display text-base font-semibold">
              {formatCurrency(total)}
            </TableCell>
            <TableCell className="text-right font-medium">{formatCurrency(saldo)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

function CondicionBadge({ c }: { c?: number }) {
  return (
    <span
      className={cn(
        "whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium",
        c === 2 ? "bg-secondary/15 text-secondary" : "bg-muted text-muted-foreground",
      )}
    >
      {nombreCondicion(c)}
    </span>
  );
}
