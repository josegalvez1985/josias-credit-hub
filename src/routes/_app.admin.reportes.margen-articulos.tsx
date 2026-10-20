import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronRight,
  FileChartColumn,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { listarMargenArticulos, type MargenPlan } from "@/lib/api";
import {
  abrirReporteMargen,
  agruparMargen,
  ordenarMargen,
  pct,
  textoPlan,
  totalesMargen,
  type MargenArticulo,
  type OrdenMargen,
} from "@/lib/reporte-margen";
import { formatCurrency } from "@/lib/credit-applications";
import { cn, fechaPy, hoyISO } from "@/lib/utils";
import { AdminHeader } from "./_app.admin";
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

export const Route = createFileRoute("/_app/admin/reportes/margen-articulos")({
  head: () => ({
    meta: [
      { title: "Margen de Ventas por Artículos — Reportes" },
      {
        name: "description",
        content: "Ganancia y margen de cada artículo vendido a crédito en un período.",
      },
    ],
  }),
  component: MargenArticulosPage,
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

// Pantalla del reporte: período, una vista previa con indicadores y una tabla
// por artículo (cada uno se despliega en sus planes de cuotas), y el botón que
// abre el PDF (src/lib/reporte-margen.ts). Las ventas se piden al servidor
// cada vez que cambian las fechas; búsqueda, orden y filtro son locales.
function MargenArticulosPage() {
  const [desde, setDesde] = useState(() => rangoMes(0)[0]);
  const [hasta, setHasta] = useState(hoyISO);
  const [conPlanes, setConPlanes] = useState(false);

  const [filas, setFilas] = useState<MargenPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generando, setGenerando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  const [buscar, setBuscar] = useState("");
  const [orden, setOrden] = useState<OrdenMargen>("venta");
  const [asc, setAsc] = useState(false);
  const [soloSinCosto, setSoloSinCosto] = useState(false);
  const [abiertos, setAbiertos] = useState<Set<number>>(new Set());

  const rangoValido = !!desde && !!hasta && desde <= hasta;

  useEffect(() => {
    if (!API_URL) {
      setError("Configura VITE_API_URL para ver el reporte.");
      setLoading(false);
      return;
    }
    if (!rangoValido) {
      setFilas([]);
      setLoading(false);
      return;
    }
    // Si el usuario cambia las fechas antes de que vuelva la consulta
    // anterior, esa respuesta vieja se descarta.
    let vigente = true;
    setLoading(true);
    setError(null);
    listarMargenArticulos({ desde, hasta })
      .then((fs) => {
        if (!vigente) return;
        setFilas(fs);
        setAbiertos(new Set());
      })
      .catch((e) => vigente && setError(e instanceof Error ? e.message : "Error al cargar"))
      .finally(() => vigente && setLoading(false));
    return () => {
      vigente = false;
    };
  }, [desde, hasta, rangoValido, recarga]);

  const articulos = useMemo(() => agruparMargen(filas), [filas]);
  // Los indicadores son del período entero: no cambian con la búsqueda.
  const t = useMemo(() => totalesMargen(articulos), [articulos]);

  const visibles = useMemo(() => {
    const termino = buscar.trim().toLowerCase();
    const filtrados = articulos.filter(
      (a) =>
        (!soloSinCosto || a.costo == null) &&
        (!termino || a.nombre.toLowerCase().includes(termino) || String(a.cod).includes(termino)),
    );
    return ordenarMargen(filtrados, orden, asc);
  }, [articulos, buscar, soloSinCosto, orden, asc]);
  const tv = useMemo(() => totalesMargen(visibles), [visibles]);

  // Si ya no quedan artículos sin costo (otro período), se apaga el filtro.
  useEffect(() => {
    if (t.sinCosto.articulos === 0) setSoloSinCosto(false);
  }, [t.sinCosto.articulos]);

  function aplicarAtajo(rango: [string, string]) {
    setDesde(rango[0]);
    setHasta(rango[1]);
  }

  // Click en el mismo encabezado invierte el orden; en otro, arranca de mayor
  // a menor (de A a Z en el nombre).
  function ordenarPor(o: OrdenMargen) {
    if (o === orden) setAsc((v) => !v);
    else {
      setOrden(o);
      setAsc(o === "articulo");
    }
  }

  function alternar(cod: number) {
    setAbiertos((s) => {
      const n = new Set(s);
      if (n.has(cod)) n.delete(cod);
      else n.add(cod);
      return n;
    });
  }

  // Sin await antes de abrirReporteMargen: la pestaña tiene que abrirse
  // dentro del click para que el bloqueador de ventanas emergentes no la frene.
  function generar() {
    setGenerando(true);
    abrirReporteMargen({ desde, hasta, orden, asc, planes: conPlanes })
      .catch((e) => toast.error(e instanceof Error ? e.message : "No se pudo generar el reporte"))
      .finally(() => setGenerando(false));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <AdminHeader
          titulo="Margen de Ventas por Artículos"
          descripcion="Ganancia de cada artículo vendido a crédito · PDF A4 vertical"
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

          <label className="flex cursor-pointer items-start gap-3 self-start rounded-xl border border-border p-4">
            <Checkbox
              checked={conPlanes}
              onCheckedChange={(v) => setConPlanes(v === true)}
              className="mt-0.5"
            />
            <div className="min-w-0">
              <p className="text-sm font-medium">Detallar planes de cuotas en el PDF</p>
              <p className="text-xs text-muted-foreground">
                Debajo de cada artículo, en qué planes se vendió. En pantalla se ven desplegando
                la fila.
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
                Solicitudes aprobadas del {fechaPy(desde)} al {fechaPy(hasta)}
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
            <Loader2 className="h-4 w-4 animate-spin" /> Calculando márgenes...
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
            Elegí un período válido para ver el reporte.
          </p>
        ) : articulos.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No hay ventas aprobadas en el período.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Indicador titulo="Total vendido" valor={formatCurrency(t.total_venta)} />
              <Indicador
                titulo="Costo"
                valor={formatCurrency(t.conCosto.costo)}
                extra={t.sinCosto.articulos > 0 ? "Sin los artículos sin costo" : undefined}
              />
              <Indicador
                titulo="Ganancia"
                valor={formatCurrency(t.conCosto.ganancia)}
                negativo={t.conCosto.ganancia < 0}
                destacado
              />
              <Indicador
                titulo="Margen sobre costo"
                valor={pct(t.conCosto.margen_costo)}
                extra={`Sobre la venta: ${pct(t.conCosto.margen_venta)}`}
                negativo={(t.conCosto.margen_costo ?? 0) < 0}
              />
              <Indicador
                titulo="Unidades vendidas"
                valor={t.unidades.toLocaleString("es-PY")}
                extra={`${t.articulos} ${t.articulos === 1 ? "artículo" : "artículos"}`}
              />
            </div>

            {t.sinCosto.articulos > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-warning/20 px-4 py-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
                  <p className="text-sm text-warning-foreground">
                    <span className="font-medium">
                      {t.sinCosto.articulos}{" "}
                      {t.sinCosto.articulos === 1 ? "artículo no tiene" : "artículos no tienen"}{" "}
                      compra registrada
                    </span>{" "}
                    ({formatCurrency(t.sinCosto.venta)} vendidos). No entran en el costo, la
                    ganancia ni el margen.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSoloSinCosto((v) => !v)}
                  className="shrink-0"
                >
                  {soloSinCosto ? "Ver todos" : "Ver solo esos"}
                </Button>
              </div>
            )}

            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar artículo o código..."
                value={buscar}
                onChange={(e) => setBuscar(e.target.value)}
                className="pl-9"
              />
            </div>

            {visibles.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Ningún artículo coincide con la búsqueda.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/60 hover:bg-muted/60">
                      <TableHead className="w-10" />
                      <Encabezado o="articulo" orden={orden} asc={asc} onClick={ordenarPor}>
                        Artículo
                      </Encabezado>
                      <Encabezado o="unidades" orden={orden} asc={asc} onClick={ordenarPor} num>
                        Unid.
                      </Encabezado>
                      <TableHead className="text-right">P. venta</TableHead>
                      <TableHead className="text-right">Costo</TableHead>
                      <Encabezado o="venta" orden={orden} asc={asc} onClick={ordenarPor} num>
                        Total venta
                      </Encabezado>
                      <TableHead className="text-right">Total costo</TableHead>
                      <Encabezado o="ganancia" orden={orden} asc={asc} onClick={ordenarPor} num>
                        Ganancia
                      </Encabezado>
                      <Encabezado o="margen" orden={orden} asc={asc} onClick={ordenarPor} num>
                        Margen
                      </Encabezado>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibles.map((a) => (
                      <FilaArticulo
                        key={a.cod}
                        a={a}
                        abierto={abiertos.has(a.cod)}
                        onAlternar={() => alternar(a.cod)}
                      />
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell />
                      <TableCell className="font-medium">
                        {visibles.length} {visibles.length === 1 ? "artículo" : "artículos"}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {tv.unidades.toLocaleString("es-PY")}
                      </TableCell>
                      <TableCell colSpan={2} />
                      <TableCell className="text-right font-medium">
                        {formatCurrency(tv.total_venta)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(tv.conCosto.costo)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-display text-base font-semibold",
                          tv.conCosto.ganancia < 0 && "text-destructive",
                        )}
                      >
                        {formatCurrency(tv.conCosto.ganancia)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {pct(tv.conCosto.margen_costo)}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Precio de venta: el de la solicitud, a crédito y con el interés incluido. Costo: la
              última compra del artículo hasta el {fechaPy(hasta)}. Margen: ganancia sobre el
              costo (pasá el mouse para verlo sobre la venta). No incluye el artículo 217.
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

function Encabezado({
  o,
  orden,
  asc,
  onClick,
  num,
  children,
}: {
  o: OrdenMargen;
  orden: OrdenMargen;
  asc: boolean;
  onClick: (o: OrdenMargen) => void;
  num?: boolean;
  children: React.ReactNode;
}) {
  const activo = o === orden;
  const Icono = !activo ? ArrowUpDown : asc ? ArrowUp : ArrowDown;
  return (
    <TableHead className={cn(num && "text-right")} aria-sort={activo ? (asc ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onClick(o)}
        className={cn(
          "inline-flex items-center gap-1 whitespace-nowrap transition-colors hover:text-foreground",
          activo && "text-foreground",
        )}
      >
        {children}
        <Icono className={cn("h-3.5 w-3.5", !activo && "opacity-40")} />
      </button>
    </TableHead>
  );
}

// La barra va de 0 a 100 % (un margen mayor la llena); en rojo si es negativo.
function Margen({ a }: { a: MargenArticulo }) {
  if (a.margen_costo == null) return <span className="text-muted-foreground">—</span>;
  const negativo = a.margen_costo < 0;
  return (
    <div
      className="flex items-center justify-end gap-2"
      title={`Sobre la venta: ${pct(a.margen_venta)}`}
    >
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", negativo ? "bg-destructive" : "bg-primary")}
          style={{ width: `${Math.min(Math.abs(a.margen_costo), 100)}%` }}
        />
      </div>
      <span className={cn("w-16 text-right tabular-nums", negativo && "font-medium text-destructive")}>
        {pct(a.margen_costo)}
      </span>
    </div>
  );
}

function FilaArticulo({
  a,
  abierto,
  onAlternar,
}: {
  a: MargenArticulo;
  abierto: boolean;
  onAlternar: () => void;
}) {
  const sinCosto = a.costo == null;
  const negativo = a.ganancia != null && a.ganancia < 0;
  return (
    <Fragment>
      <TableRow className="cursor-pointer" onClick={onAlternar} data-state={abierto ? "selected" : undefined}>
        <TableCell>
          <button
            type="button"
            aria-expanded={abierto}
            aria-label={`${abierto ? "Ocultar" : "Ver"} planes de cuotas de ${a.nombre}`}
            onClick={(e) => {
              e.stopPropagation();
              onAlternar();
            }}
            className="inline-flex rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className={cn("h-4 w-4 transition-transform", abierto && "rotate-90")} />
          </button>
        </TableCell>
        <TableCell className="max-w-[22rem]">
          <p className="truncate font-medium">{a.nombre}</p>
          <p className="truncate text-xs text-muted-foreground">
            Cód. {a.cod} · {a.solicitudes} {a.solicitudes === 1 ? "solicitud" : "solicitudes"}
          </p>
        </TableCell>
        <TableCell className="text-right tabular-nums">{a.cantidad.toLocaleString("es-PY")}</TableCell>
        <TableCell className="text-right tabular-nums">
          {a.precio_prom == null ? "—" : formatCurrency(a.precio_prom)}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {sinCosto ? (
            <span className="whitespace-nowrap rounded-full bg-warning/20 px-2 py-0.5 text-[11px] font-medium text-warning-foreground">
              Sin costo
            </span>
          ) : (
            formatCurrency(a.costo!)
          )}
        </TableCell>
        <TableCell className="text-right tabular-nums">{formatCurrency(a.total_venta)}</TableCell>
        <TableCell className="text-right tabular-nums text-muted-foreground">
          {a.total_costo == null ? "—" : formatCurrency(a.total_costo)}
        </TableCell>
        <TableCell
          className={cn("text-right font-medium tabular-nums", negativo && "text-destructive")}
        >
          {a.ganancia == null ? "—" : formatCurrency(a.ganancia)}
        </TableCell>
        <TableCell className="text-right">
          <Margen a={a} />
        </TableCell>
      </TableRow>

      {abierto && (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell />
          <TableCell colSpan={8} className="py-3">
            <p className="mb-2 text-xs text-muted-foreground">
              {sinCosto
                ? "Sin compra registrada hasta el fin del período: no se puede calcular la ganancia."
                : `Costo de la compra del ${fechaPy(a.fecha_costo ?? "")}.`}{" "}
              El plan es el de la solicitud entera, no solo de este artículo.
            </p>
            <ul className="space-y-1">
              {a.planes.map((p, i) => (
                <li
                  key={i}
                  className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5 text-sm"
                >
                  <span className="min-w-0">{textoPlan(p)}</span>
                  <span className="whitespace-nowrap text-muted-foreground tabular-nums">
                    {p.solicitudes} {p.solicitudes === 1 ? "solicitud" : "solicitudes"} ·{" "}
                    {p.cantidad.toLocaleString("es-PY")} u. · {formatCurrency(p.total_venta)}
                  </span>
                </li>
              ))}
            </ul>
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}
