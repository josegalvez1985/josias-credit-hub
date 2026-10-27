import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  FileChartColumn,
  HandCoins,
  Loader2,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { resumenVentasPagos, type VentasPagos } from "@/lib/api";
import {
  abrirReporteVentasPagos,
  cuantos,
  totalesVentasPagos,
} from "@/lib/reporte-ventas-pagos";
import { formatCurrency } from "@/lib/credit-applications";
import { cn, fechaPy, hoyISO } from "@/lib/utils";
import { AdminHeader } from "./_app.admin";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

export const Route = createFileRoute("/_app/admin/reportes/ventas-pagos")({
  head: () => ({
    meta: [
      { title: "Ventas vs Pagos — Reportes" },
      {
        name: "description",
        content: "Lo vendido a crédito en un período contra lo pagado a proveedores.",
      },
    ],
  }),
  component: VentasPagosPage,
});

const dos = (n: number) => String(n).padStart(2, "0");

// Atajos de período, armados con componentes locales (nunca toISOString: da
// la fecha UTC, ver GUIA-FRONTEND §7). Mismo criterio que Compras por Período.
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
  { label: "Últimos 3 meses", rango: () => [rangoMes(-2)[0], hoyISO()] },
  { label: "Este año", rango: () => [`${hoyISO().slice(0, 4)}-01-01`, hoyISO()] },
];

// Pantalla del reporte: período, una vista previa con los totales y su
// desglose, y el botón que abre el PDF (src/lib/reporte-ventas-pagos.ts). Los
// totales se piden al servidor cada vez que cambian las fechas.
function VentasPagosPage() {
  const [desde, setDesde] = useState(() => rangoMes(0)[0]);
  const [hasta, setHasta] = useState(hoyISO);

  const [datos, setDatos] = useState<VentasPagos | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generando, setGenerando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  const rangoValido = !!desde && !!hasta && desde <= hasta;

  useEffect(() => {
    if (!API_URL) {
      setError("Configura VITE_API_URL para ver el reporte.");
      setLoading(false);
      return;
    }
    if (!rangoValido) {
      setDatos(null);
      setLoading(false);
      return;
    }
    // Si el usuario cambia las fechas antes de que vuelva la consulta
    // anterior, esa respuesta vieja se descarta.
    let vigente = true;
    setLoading(true);
    setError(null);
    resumenVentasPagos({ desde, hasta })
      .then((r) => vigente && setDatos(r))
      .catch((e) => vigente && setError(e instanceof Error ? e.message : "Error al cargar"))
      .finally(() => vigente && setLoading(false));
    return () => {
      vigente = false;
    };
  }, [desde, hasta, rangoValido, recarga]);

  const t = useMemo(() => (datos ? totalesVentasPagos(datos) : null), [datos]);
  const vacio =
    !!datos &&
    datos.ventas.cantidad === 0 &&
    datos.recibos.cantidad === 0 &&
    datos.contado.cantidad === 0;

  // Sin await antes de abrirReporteVentasPagos: la pestaña tiene que abrirse
  // dentro del click para que el bloqueador de ventanas emergentes no la frene.
  function generar() {
    setGenerando(true);
    abrirReporteVentasPagos({ desde, hasta })
      .catch((e) => toast.error(e instanceof Error ? e.message : "No se pudo generar el reporte"))
      .finally(() => setGenerando(false));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <AdminHeader
          titulo="Ventas vs Pagos"
          descripcion="Lo vendido a crédito contra lo pagado a proveedores · PDF A4 vertical"
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
        <h2 className="font-display text-lg font-semibold">Período</h2>

        <div className="max-w-md space-y-1.5">
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
                  onClick={() => {
                    setDesde(d);
                    setHasta(h);
                  }}
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
            <Loader2 className="h-4 w-4 animate-spin" /> Calculando totales...
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
        ) : !rangoValido || !datos || !t ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Elegí un período válido para ver el reporte.
          </p>
        ) : vacio ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No hay ventas ni pagos a proveedores en el período.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Indicador
                titulo="Total vendido"
                valor={formatCurrency(t.ventas)}
                extra={cuantos(datos.ventas.cantidad, "crédito", "créditos")}
              />
              <Indicador
                titulo="Total pagado"
                valor={formatCurrency(t.pagos)}
                extra="A proveedores"
              />
              <Indicador
                titulo="Diferencia"
                valor={formatCurrency(t.diferencia)}
                extra="Ventas − pagos"
                negativo={t.diferencia < 0}
                destacado
              />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Desglose icon={TrendingUp} titulo="Ventas" total={t.ventas} rotuloTotal="Total vendido">
                <Linea
                  concepto="Créditos otorgados"
                  cantidad={cuantos(datos.ventas.cantidad, "crédito", "créditos")}
                  monto={datos.ventas.total}
                />
                <Linea concepto="Entrega inicial incluida" monto={datos.ventas.entrega_inicial} parte />
              </Desglose>

              <Desglose
                icon={HandCoins}
                titulo="Pagos a proveedores"
                total={t.pagos}
                rotuloTotal="Total pagado"
              >
                <Linea
                  concepto="Recibos de proveedores"
                  cantidad={cuantos(datos.recibos.cantidad, "recibo", "recibos")}
                  monto={datos.recibos.total}
                />
                <Linea concepto="Efectivo" monto={datos.recibos.efectivo} parte />
                <Linea concepto="Transferencia" monto={datos.recibos.transferencia} parte />
                <Linea concepto="Cheque" monto={datos.recibos.cheque} parte />
                {t.sinRegistrar !== 0 && (
                  <Linea concepto="Sin forma de pago registrada" monto={t.sinRegistrar} parte />
                )}
                <Linea
                  concepto="Compras al contado"
                  cantidad={cuantos(datos.contado.cantidad, "factura", "facturas")}
                  monto={datos.contado.total}
                />
              </Desglose>
            </div>

            {t.sinRegistrar !== 0 && (
              <div className="flex items-start gap-2.5 rounded-xl border border-border bg-warning/20 px-4 py-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
                <p className="text-sm text-warning-foreground">
                  {formatCurrency(t.sinRegistrar)} de recibos no tienen forma de pago registrada
                  (recibos anteriores al 19/10/2026). Entran en el total pagado igual.
                </p>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Ventas: créditos otorgados con fecha de factura en el período, a precio de crédito (con
              el interés y la entrega inicial): no es lo cobrado. Pagos: recibos de proveedores por
              la fecha del recibo (los cheques diferidos también) y facturas de compra al contado.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}

function Indicador({
  titulo,
  valor,
  extra,
  destacado,
  negativo,
}: {
  titulo: string;
  valor: string;
  extra?: string;
  destacado?: boolean;
  negativo?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-xl border p-4",
        destacado ? "border-primary bg-primary/10" : "border-border",
      )}
    >
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{titulo}</p>
      <p
        className={cn(
          "mt-1 truncate font-display text-2xl font-semibold tracking-tight",
          negativo && "text-destructive",
        )}
      >
        {valor}
      </p>
      {extra && <p className="truncate text-xs text-muted-foreground">{extra}</p>}
    </div>
  );
}

function Desglose({
  icon: Icon,
  titulo,
  total,
  rotuloTotal,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  titulo: string;
  total: number;
  rotuloTotal: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border p-4">
      <h3 className="mb-3 flex items-center gap-2 font-display text-base font-semibold">
        <Icon className="h-4 w-4 text-secondary" />
        {titulo}
      </h3>
      <ul className="space-y-1.5">{children}</ul>
      <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-border pt-3">
        <span className="text-sm font-medium">{rotuloTotal}</span>
        <span className="font-display text-lg font-semibold tabular-nums">
          {formatCurrency(total)}
        </span>
      </div>
    </div>
  );
}

// Un renglón del desglose. `parte` es un componente del renglón de arriba:
// va sangrado y en gris, y no suma aparte.
function Linea({
  concepto,
  cantidad,
  monto,
  parte,
}: {
  concepto: string;
  cantidad?: string;
  monto: number;
  parte?: boolean;
}) {
  return (
    <li
      className={cn(
        "flex items-baseline justify-between gap-4 text-sm",
        parte && "pl-5 text-muted-foreground",
      )}
    >
      <span className="min-w-0">
        {concepto}
        {cantidad && <span className="ml-2 text-xs text-muted-foreground">{cantidad}</span>}
      </span>
      <span className="shrink-0 tabular-nums">{formatCurrency(monto)}</span>
    </li>
  );
}
