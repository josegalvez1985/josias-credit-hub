import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, AlertTriangle, FileChartColumn, Loader2, RefreshCw, X } from "lucide-react";
import {
  FORMAS_PAGO,
  filtrarLov,
  listarFacturasCompra,
  listarPagosFacturas,
  type FacturaCompra,
  type LovItem,
  type PagoFactura,
  type ProveedorLov,
} from "@/lib/api";
import {
  abrirReporteSaldosProveedores,
  agrupar,
  ALCANCES,
  cierreFactura,
  diasDesde,
  indexarPagos,
  type AlcanceSaldos,
  type Grupo,
  type PagosPorFactura,
} from "@/lib/reporte-saldos-proveedores";
import { formatCurrency } from "@/lib/credit-applications";
import { cn, fechaPy } from "@/lib/utils";
import { AdminHeader } from "./_app.admin";
import { AsyncCombobox } from "@/components/async-combobox";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

export const Route = createFileRoute("/_app/admin/reportes/saldos-proveedores")({
  head: () => ({
    meta: [
      { title: "Saldos de Proveedores — Reportes" },
      { name: "description", content: "Reporte en PDF de saldos a pagar a proveedores." },
    ],
  }),
  component: SaldosProveedoresPage,
});

// Pantalla del reporte: opciones, una vista previa y el botón que abre el PDF
// en pestaña nueva (src/lib/reporte-saldos-proveedores.ts).
//
// La vista previa muestra LO MISMO que el PDF —mismo agrupado, mismas
// facturas, los recibos cuando el alcance los pide— porque usa las funciones
// del reporte (agrupar, diasDesde, indexarPagos). El PDF vuelve a consultar al
// generarse, así que siempre sale con los datos del momento.
function SaldosProveedoresPage() {
  const [facturas, setFacturas] = useState<FacturaCompra[]>([]);
  const [pagos, setPagos] = useState<PagosPorFactura>(null);
  const [errorPagos, setErrorPagos] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filtro, setFiltro] = useState<ProveedorLov | null>(null);
  const [alcance, setAlcance] = useState<AlcanceSaldos>("saldo");
  const [detalle, setDetalle] = useState(true);
  const [generando, setGenerando] = useState(false);

  // "Con recibos" sin detalle no tendría dónde poner los recibos: van debajo
  // de cada factura. Por eso ahí el detalle queda fijo.
  const conDetalle = alcance === "recibos" || detalle;
  const conRecibos = alcance !== "saldo" && conDetalle;

  // Se trae todo una vez —todas las facturas a crédito y todos los pagos— y
  // las opciones se aplican acá, sin volver al servidor en cada cambio: son
  // pocas filas. Los pagos llevan su propio catch: si fallan, la vista previa
  // sin recibos tiene que seguir andando.
  const load = useCallback(() => {
    if (!API_URL) {
      setError("Configura VITE_API_URL para ver los saldos de proveedores.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    Promise.all([
      listarFacturasCompra(),
      listarPagosFacturas()
        .then((lista) => {
          setErrorPagos(null);
          return indexarPagos(lista);
        })
        .catch((e) => {
          setErrorPagos(e instanceof Error ? e.message : "Error al cargar los recibos");
          return null;
        }),
    ])
      .then(([f, p]) => {
        setFacturas(f);
        setPagos(p);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error al cargar"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  // Proveedores del combobox con lo que se les debe, sacados de las mismas
  // facturas. Las facturas sin proveedor no se pueden elegir como filtro.
  const proveedores = useMemo<ProveedorLov[]>(
    () =>
      agrupar(facturas).flatMap((g) => {
        if (g.cod === null) return [];
        const conSaldo = g.facturas.filter((f) => f.saldo > 0);
        return [
          {
            value: g.cod,
            label: g.nombre,
            documento: g.documento,
            pendientes: conSaldo.length,
            saldo: conSaldo.reduce((s, f) => s + f.saldo, 0),
          },
        ];
      }),
    [facturas],
  );

  // "Todos" incluye a los proveedores que ya no tienen saldo; los otros dos
  // alcances, solo a los que se les debe algo.
  const base = useMemo(
    () => (alcance === "todos" ? proveedores : proveedores.filter((p) => p.saldo > 0)),
    [proveedores, alcance],
  );

  function elegirAlcance(a: AlcanceSaldos) {
    setAlcance(a);
    // Un proveedor sin saldo elegido en "Todos" no tiene nada que mostrar en
    // los otros dos alcances.
    if (a !== "todos" && filtro && filtro.saldo <= 0) setFiltro(null);
  }

  // El combobox busca sobre la lista ya cargada, sin volver a pedirla.
  const fetchProveedores = useCallback(async (q?: string) => filtrarLov(base, q), [base]);

  // Las mismas facturas que va a llevar el PDF.
  const grupos = useMemo(
    () =>
      agrupar(
        facturas.filter(
          (f) =>
            (alcance === "todos" || f.saldo > 0) && (!filtro || f.cod_proveedor === filtro.value),
        ),
      ),
    [facturas, alcance, filtro],
  );
  const cantFacturas = grupos.reduce((s, g) => s + g.facturas.length, 0);
  const saldoTotal = grupos.reduce((s, g) => s + g.saldo, 0);

  // Sin await antes de abrirReporte...: la pestaña tiene que abrirse dentro
  // del click para que el bloqueador de ventanas emergentes no la frene.
  function generar() {
    setGenerando(true);
    abrirReporteSaldosProveedores({ proveedor: filtro, alcance, detalle: conDetalle })
      .catch((e) => toast.error(e instanceof Error ? e.message : "No se pudo generar el reporte"))
      .finally(() => setGenerando(false));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <AdminHeader
          titulo="Saldos de Proveedores"
          descripcion="Lo que se le debe a cada proveedor por compras a crédito · PDF A4 vertical"
        />
        <Button
          onClick={generar}
          disabled={generando || loading || !!error}
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
            <Label>Proveedor</Label>
            <div className="flex min-w-0 gap-2">
              <div className="min-w-0 flex-1">
                <AsyncCombobox
                  title="Proveedor"
                  placeholder="Todos los proveedores"
                  emptyText={
                    alcance === "todos"
                      ? "Ningún proveedor con facturas a crédito"
                      : "Ningún proveedor con saldo"
                  }
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
                          {[p.documento, formatCurrency(p.saldo)].filter(Boolean).join(" · ")}
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

          <div className="space-y-1.5">
            <Label>Qué incluir</Label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(ALCANCES) as AlcanceSaldos[]).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => elegirAlcance(a)}
                  aria-pressed={alcance === a}
                  className={cn(
                    "h-10 rounded-xl border text-sm font-medium transition-colors",
                    alcance === a
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {ALCANCES[a].label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{ALCANCES[alcance].descripcion}</p>
          </div>
        </div>

        <label
          className={cn(
            "flex items-start gap-3 rounded-xl border border-border p-4",
            alcance === "recibos" ? "cursor-not-allowed opacity-70" : "cursor-pointer",
          )}
        >
          <Checkbox
            checked={conDetalle}
            disabled={alcance === "recibos"}
            onCheckedChange={(v) => setDetalle(v === true)}
            className="mt-0.5"
          />
          <div className="min-w-0">
            <p className="text-sm font-medium">Incluir el detalle de facturas</p>
            <p className="text-xs text-muted-foreground">
              {alcance === "recibos"
                ? "Con recibos siempre sale con detalle: los recibos van debajo de cada factura."
                : alcance === "todos"
                  ? "Cada factura con sus recibos y un subtotal por proveedor. Sin tildar, sale una línea por proveedor, sin recibos."
                  : "Cada factura con su antigüedad y un subtotal por proveedor. Sin tildar, sale una línea por proveedor."}
            </p>
          </div>
        </label>
      </Card>

      <Card className="space-y-5 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold">Vista previa</h2>
            {!loading && !error && (
              <p className="text-sm text-muted-foreground">
                {grupos.length} {grupos.length === 1 ? "proveedor" : "proveedores"} · {cantFacturas}{" "}
                {cantFacturas === 1 ? "factura" : "facturas"} · saldo {formatCurrency(saldoTotal)}
              </p>
            )}
          </div>
          {!loading && API_URL && (
            <Button
              variant="ghost"
              size="sm"
              onClick={load}
              className="gap-1.5 text-muted-foreground"
            >
              <RefreshCw className="h-4 w-4" /> Actualizar
            </Button>
          )}
        </div>

        {conRecibos && errorPagos && !loading && (
          <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/15 px-4 py-3 text-sm text-warning-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="min-w-0">
              No se pudieron cargar los recibos: {errorPagos}. La vista previa sale sin ellos.
            </p>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando saldos...
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertCircle className="h-5 w-5" />
            </div>
            <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
            {API_URL && (
              <Button variant="outline" onClick={load}>
                <RefreshCw className="h-4 w-4" /> Reintentar
              </Button>
            )}
          </div>
        ) : grupos.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {alcance === "todos"
              ? "No hay facturas de compra a crédito."
              : "No hay facturas a crédito con saldo pendiente."}
          </p>
        ) : conDetalle ? (
          <VistaDetalle grupos={grupos} pagos={conRecibos ? pagos : null} />
        ) : (
          <VistaResumen grupos={grupos} />
        )}
      </Card>
    </div>
  );
}

// Una línea por proveedor, como el PDF sin detalle.
function VistaResumen({ grupos }: { grupos: Grupo[] }) {
  const suma = (k: "total" | "pagado" | "saldo") => grupos.reduce((s, g) => s + g[k], 0);
  const cant = grupos.reduce((s, g) => s + g.facturas.length, 0);
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/60 hover:bg-muted/60">
            <TableHead>Proveedor</TableHead>
            <TableHead>RUC / CI</TableHead>
            <TableHead className="text-right">Facturas</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Pagado</TableHead>
            <TableHead className="text-right">Saldo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {grupos.map((g) => (
            <TableRow key={g.cod ?? "sin"}>
              <TableCell className="max-w-[24rem] truncate font-medium">{g.nombre}</TableCell>
              <TableCell className="text-muted-foreground">{g.documento || "—"}</TableCell>
              <TableCell className="text-right">{g.facturas.length}</TableCell>
              <TableCell className="text-right">{formatCurrency(g.total)}</TableCell>
              <TableCell className="text-right">{formatCurrency(g.pagado)}</TableCell>
              <TableCell className="text-right font-display font-semibold">
                {formatCurrency(g.saldo)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={2} className="font-medium">
              {grupos.length} {grupos.length === 1 ? "proveedor" : "proveedores"}
            </TableCell>
            <TableCell className="text-right font-medium">{cant}</TableCell>
            <TableCell className="text-right font-medium">
              {formatCurrency(suma("total"))}
            </TableCell>
            <TableCell className="text-right font-medium">
              {formatCurrency(suma("pagado"))}
            </TableCell>
            <TableCell className="text-right font-display text-base font-semibold">
              {formatCurrency(suma("saldo"))}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

// Facturas agrupadas por proveedor, con los recibos debajo de cada una cuando
// `pagos` viene cargado: la misma tabla que el PDF con detalle.
function VistaDetalle({ grupos, pagos }: { grupos: Grupo[]; pagos: PagosPorFactura }) {
  const saldo = grupos.reduce((s, g) => s + g.saldo, 0);
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/60 hover:bg-muted/60">
            <TableHead className="w-28">Fecha</TableHead>
            <TableHead>Nro. Factura</TableHead>
            <TableHead className="w-16 text-right">Días</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Pagado</TableHead>
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
            {g.facturas.map((f) => {
              const cierre = cierreFactura(f);
              return (
                <Fragment key={f.id_cabecera}>
                  <TableRow className={cn(cierre && "text-muted-foreground")}>
                    <TableCell className="whitespace-nowrap">{fechaPy(f.fecha)}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {f.referencia || `ID ${f.id_cabecera}`}
                    </TableCell>
                    <TableCell className="text-right">{cierre ? "" : diasDesde(f.fecha)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(f.total)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(f.pagado)}</TableCell>
                    <TableCell className="text-right font-medium">
                      {cierre ?? formatCurrency(f.saldo)}
                    </TableCell>
                  </TableRow>
                  {(pagos?.get(f.id_cabecera) ?? []).map((p) => (
                    <FilaRecibo key={p.id_detalle} p={p} />
                  ))}
                </Fragment>
              );
            })}
            <TableRow className="font-medium hover:bg-transparent">
              <TableCell colSpan={3} className="text-muted-foreground">
                Subtotal · {g.facturas.length} {g.facturas.length === 1 ? "factura" : "facturas"}
              </TableCell>
              <TableCell className="text-right">{formatCurrency(g.total)}</TableCell>
              <TableCell className="text-right">{formatCurrency(g.pagado)}</TableCell>
              <TableCell className="text-right">{formatCurrency(g.saldo)}</TableCell>
            </TableRow>
          </TableBody>
        ))}
        <TableFooter>
          <TableRow>
            <TableCell colSpan={5} className="font-medium">
              Saldo total a pagar
            </TableCell>
            <TableCell className="text-right font-display text-base font-semibold">
              {formatCurrency(saldo)}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

// Un recibo debajo de su factura. El monto va en la columna "Pagado": los
// recibos de una factura suman lo que dice su fila. El número abre el recibo.
function FilaRecibo({ p }: { p: PagoFactura }) {
  const forma = [p.forma_pago ? FORMAS_PAGO[p.forma_pago] : "", p.nro_comprobante]
    .filter(Boolean)
    .join(" ");
  return (
    <TableRow className="text-xs text-muted-foreground hover:bg-transparent">
      <TableCell className="whitespace-nowrap py-1.5">{fechaPy(p.fecha)}</TableCell>
      <TableCell colSpan={3} className="py-1.5 pl-8">
        <Link
          to="/admin/recibos-proveedores/$id"
          params={{ id: String(p.id_recibo) }}
          className="text-secondary hover:underline"
        >
          Recibo N° {p.nro_recibo}
        </Link>
        {forma && ` · ${forma}`}
      </TableCell>
      <TableCell className="py-1.5 text-right">{formatCurrency(p.monto_aplicado)}</TableCell>
      <TableCell className="py-1.5" />
    </TableRow>
  );
}
