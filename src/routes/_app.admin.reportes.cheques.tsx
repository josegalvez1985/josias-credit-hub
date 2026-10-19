import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, FileChartColumn, Loader2, RefreshCw, X } from "lucide-react";
import {
  filtrarLov,
  listarChequesProveedor,
  type ChequeProveedor,
  type LovItem,
  type ProveedorLov,
} from "@/lib/api";
import {
  abrirReporteCheques,
  agruparPorVencimiento,
  diaVencimiento,
  estadoCheque,
  filtrarCheques,
  textoVencimiento,
  totalesCheques,
  type GrupoVencimiento,
} from "@/lib/reporte-cheques";
import { formatCurrency } from "@/lib/credit-applications";
import { cn, fechaPy, hoyISO } from "@/lib/utils";
import { AdminHeader } from "./_app.admin";
import { AsyncCombobox } from "@/components/async-combobox";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

export const Route = createFileRoute("/_app/admin/reportes/cheques")({
  head: () => ({
    meta: [
      { title: "Cheques a Vencer — Reportes" },
      {
        name: "description",
        content: "Reporte en PDF de los cheques entregados a proveedores, por fecha de vencimiento.",
      },
    ],
  }),
  component: ChequesVencerPage,
});

const dos = (n: number) => String(n).padStart(2, "0");

// Fechas armadas con componentes locales (nunca toISOString: da la fecha UTC,
// ver GUIA-FRONTEND §7). `new Date(y, m, d)` acomoda solo los desbordes de
// día y de mes.
function iso(d: Date): string {
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

function hoyMas(dias: number = 0, meses: number = 0): Date {
  const [y, m, d] = hoyISO().split("-").map(Number);
  return new Date(y, m - 1 + meses, d + dias);
}

// Último día del mes que está `desplazamiento` meses después del actual.
function finDeMes(desplazamiento: number): string {
  const [y, m] = hoyISO().split("-").map(Number);
  return iso(new Date(y, m + desplazamiento, 0));
}

const ATAJOS: { label: string; rango: () => [string, string] }[] = [
  { label: "Este mes", rango: () => [`${hoyISO().slice(0, 7)}-01`, finDeMes(0)] },
  { label: "Próximos 30 días", rango: () => [hoyISO(), iso(hoyMas(30))] },
  { label: "Hasta fin del mes que viene", rango: () => [hoyISO(), finDeMes(1)] },
  { label: "Próximos 6 meses", rango: () => [hoyISO(), iso(hoyMas(0, 6))] },
];

// Pantalla del reporte: rango de vencimiento y proveedor, una vista previa y
// el botón que abre el PDF (src/lib/reporte-cheques.ts). Los cheques del rango
// se piden al servidor cada vez que cambian las fechas; el proveedor se filtra
// acá, sin volver a pedir.
function ChequesVencerPage() {
  const [desde, setDesde] = useState(hoyISO);
  const [hasta, setHasta] = useState(() => finDeMes(1));
  const [filtro, setFiltro] = useState<ProveedorLov | null>(null);

  const [cheques, setCheques] = useState<ChequeProveedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generando, setGenerando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  const rangoValido = !!desde && !!hasta && desde <= hasta;

  useEffect(() => {
    if (!API_URL) {
      setError("Configura VITE_API_URL para ver los cheques.");
      setLoading(false);
      return;
    }
    if (!rangoValido) {
      setCheques([]);
      setLoading(false);
      return;
    }
    // Si el usuario cambia las fechas antes de que vuelva la consulta
    // anterior, esa respuesta vieja se descarta.
    let vigente = true;
    setLoading(true);
    setError(null);
    listarChequesProveedor({ desde, hasta })
      .then((cs) => vigente && setCheques(cs))
      .catch((e) => vigente && setError(e instanceof Error ? e.message : "Error al cargar"))
      .finally(() => vigente && setLoading(false));
    return () => {
      vigente = false;
    };
  }, [desde, hasta, rangoValido, recarga]);

  // Proveedores con cheques en el rango, para el filtro. `pendientes` y
  // `saldo` llevan la cantidad y el total de sus cheques.
  const proveedores = useMemo<ProveedorLov[]>(() => {
    const porCod = new Map<number, ProveedorLov>();
    for (const c of cheques) {
      const p = porCod.get(c.cod_proveedor);
      if (p) {
        p.pendientes++;
        p.saldo += c.monto;
      } else {
        porCod.set(c.cod_proveedor, {
          value: c.cod_proveedor,
          label: c.proveedor || "Sin proveedor",
          documento: c.documento,
          pendientes: 1,
          saldo: c.monto,
        });
      }
    }
    return [...porCod.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [cheques]);
  const fetchProveedores = useCallback(
    async (q?: string) => filtrarLov(proveedores, q),
    [proveedores],
  );

  // Las mismas opciones que va a usar el PDF.
  const op = { desde, hasta, proveedor: filtro };
  const visibles = useMemo(
    () => filtrarCheques(cheques, { desde, hasta, proveedor: filtro }),
    [cheques, desde, hasta, filtro],
  );
  const grupos = useMemo(() => agruparPorVencimiento(visibles), [visibles]);
  const t = totalesCheques(visibles);

  // Sin await antes de abrirReporteCheques: la pestaña tiene que abrirse
  // dentro del click para que el bloqueador de ventanas emergentes no la frene.
  function generar() {
    setGenerando(true);
    abrirReporteCheques(op)
      .catch((e) => toast.error(e instanceof Error ? e.message : "No se pudo generar el reporte"))
      .finally(() => setGenerando(false));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <AdminHeader
          titulo="Cheques a Vencer"
          descripcion="Cheques entregados a proveedores, por fecha de vencimiento · PDF A4 vertical"
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
            <Label>Vencimiento</Label>
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
            {!rangoValido ? (
              <p className="text-xs text-destructive">
                Elegí las dos fechas, y que "desde" no sea posterior a "hasta".
              </p>
            ) : (
              desde < hoyISO() && (
                <p className="text-xs text-muted-foreground">
                  Incluye cheques ya vencidos: la base no registra si se cobraron.
                </p>
              )
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Proveedor</Label>
            <div className="flex min-w-0 gap-2">
              <div className="min-w-0 flex-1">
                <AsyncCombobox
                  title="Proveedor"
                  placeholder="Todos los proveedores"
                  emptyText="Ningún proveedor con cheques en el período"
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
                            `${p.pendientes} ${p.pendientes === 1 ? "cheque" : "cheques"}`,
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
        </div>
      </Card>

      <Card className="space-y-5 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold">Vista previa</h2>
            {rangoValido && (
              <p className="text-sm text-muted-foreground">
                Vencimientos del {fechaPy(desde)} al {fechaPy(hasta)}
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
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando cheques...
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
            Elegí un período válido para ver los cheques.
          </p>
        ) : (
          <>
            {/* Los mismos tres totales que el recuadro del PDF */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Total titulo="Vencidos" cant={t.vencidos.cant} monto={t.vencidos.total} />
              <Total titulo="A vencer" cant={t.aVencer.cant} monto={t.aVencer.total} />
              <Total titulo="Total del período" cant={t.cant} monto={t.total} destacado />
            </div>

            {visibles.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No hay cheques que venzan en el período
                {filtro ? " para este proveedor" : ""}.
              </p>
            ) : (
              <VistaPorDia grupos={grupos} total={t.total} />
            )}
          </>
        )}
      </Card>
    </div>
  );
}

function Total({
  titulo,
  cant,
  monto,
  destacado,
}: {
  titulo: string;
  cant: number;
  monto: number;
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
        {cant} {cant === 1 ? "cheque" : "cheques"}
      </p>
    </div>
  );
}

// Una banda por día de vencimiento con su subtotal, como el PDF.
function VistaPorDia({ grupos, total }: { grupos: GrupoVencimiento[]; total: number }) {
  const cant = grupos.reduce((s, g) => s + g.cheques.length, 0);
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/60 hover:bg-muted/60">
            <TableHead>Nro. Cheque</TableHead>
            <TableHead>Banco</TableHead>
            <TableHead>Proveedor</TableHead>
            <TableHead>Recibo</TableHead>
            <TableHead className="w-28">Emisión</TableHead>
            <TableHead className="text-right">Monto</TableHead>
          </TableRow>
        </TableHeader>
        {grupos.map((g) => (
          <TableBody key={g.fecha}>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableCell colSpan={6}>
                <span className="font-semibold capitalize">{diaVencimiento(g.fecha)}</span>
                <EstadoBadge vencimiento={g.fecha} />
              </TableCell>
            </TableRow>
            {g.cheques.map((c) => (
              <TableRow key={c.id_pago}>
                <TableCell className="whitespace-nowrap font-mono text-xs">
                  {c.nro_documento || "—"}
                </TableCell>
                <TableCell className="max-w-[12rem] truncate">{c.banco || "—"}</TableCell>
                <TableCell className="max-w-[22rem]">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.proveedor || "Sin proveedor"}</p>
                    {c.documento && (
                      <p className="truncate text-xs text-muted-foreground">{c.documento}</p>
                    )}
                  </div>
                </TableCell>
                <TableCell className="max-w-[14rem]">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs">{c.nro_recibo}</p>
                    {c.facturas && (
                      <p className="truncate text-xs text-muted-foreground">Fact. {c.facturas}</p>
                    )}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap">{fechaPy(c.fecha_emision)}</TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  {formatCurrency(c.monto)}
                  {c.monto_recibo > c.monto && (
                    <p className="text-xs text-muted-foreground">
                      de {formatCurrency(c.monto_recibo)}
                    </p>
                  )}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="font-medium hover:bg-transparent">
              <TableCell colSpan={5} className="text-muted-foreground">
                Subtotal del día · {g.cheques.length} {g.cheques.length === 1 ? "cheque" : "cheques"}
              </TableCell>
              <TableCell className="text-right">{formatCurrency(g.total)}</TableCell>
            </TableRow>
          </TableBody>
        ))}
        <TableFooter>
          <TableRow>
            <TableCell colSpan={5} className="font-medium">
              Total del período · {cant} {cant === 1 ? "cheque" : "cheques"}
            </TableCell>
            <TableCell className="text-right font-display text-base font-semibold">
              {formatCurrency(total)}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

function EstadoBadge({ vencimiento }: { vencimiento: string }) {
  const estado = estadoCheque(vencimiento);
  return (
    <span
      className={cn(
        "ml-2 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium",
        estado === "vencido"
          ? "bg-muted text-muted-foreground"
          : estado === "hoy"
            ? "bg-warning/20 text-warning-foreground"
            : "bg-secondary/15 text-secondary",
      )}
    >
      {textoVencimiento(vencimiento)}
    </span>
  );
}
