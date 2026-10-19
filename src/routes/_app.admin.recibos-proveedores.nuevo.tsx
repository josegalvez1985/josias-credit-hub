import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRightLeft,
  Banknote,
  Check,
  CircleAlert,
  CircleCheck,
  HandCoins,
  Loader2,
  Plus,
  ScrollText,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  crearReciboProveedor,
  DOCUMENTO_DE,
  FORMAS_PAGO,
  listarFacturasCompra,
  lovProveedores,
  type FacturaCompra,
  type FormaPago,
  type LovItem,
  type ProveedorLov,
} from "@/lib/api";
import { formatCurrency } from "@/lib/credit-applications";
import { cn, fechaPy, hoyISO } from "@/lib/utils";
import { AsyncCombobox } from "@/components/async-combobox";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

type Busqueda = { proveedor?: number; factura?: number };

export const Route = createFileRoute("/_app/admin/recibos-proveedores/nuevo")({
  // Desde el botón "Pagar" del listado llegan el proveedor y la factura ya
  // elegidos. Los dos son opcionales: "Nuevo recibo" entra sin nada.
  validateSearch: (s: Record<string, unknown>): Busqueda => {
    const out: Busqueda = {};
    const p = Number(s.proveedor);
    const f = Number(s.factura);
    if (Number.isInteger(p) && p > 0) out.proveedor = p;
    if (Number.isInteger(f) && f > 0) out.factura = f;
    return out;
  },
  head: () => ({
    meta: [
      { title: "Nuevo recibo de proveedor — Administración" },
      { name: "description", content: "Carga de un pago a proveedor." },
    ],
  }),
  component: NuevoReciboProveedor,
});

// Una forma de pago mientras se carga. `monto` guarda solo dígitos; banco y
// fechas solo los usa el cheque (en las otras formas no se mandan).
type PagoForm = {
  key: number;
  forma: FormaPago;
  nro: string;
  banco: string;
  emision: string; // YYYY-MM-DD
  vencimiento: string; // YYYY-MM-DD
  monto: string;
};

const ICONO_FORMA: Record<FormaPago, LucideIcon> = {
  EFECTIVO: Banknote,
  TRANSFERENCIA: ArrowRightLeft,
  CHEQUE: ScrollText,
};

// Un recibo tiene dos lados que tienen que cuadrar (2026-10-19): QUÉ se paga
// (facturas → RECIBOS_COMPRA_DETALLE) y CON QUÉ se paga (efectivo,
// transferencias y cheques → RECIBOS_COMPRA_PAGOS). El resumen de la derecha
// muestra todo el tiempo cuánto falta o sobra, y "Guardar" se habilita recién
// cuando los dos lados son iguales: es la misma regla que pkg_recibos_compra.
function NuevoReciboProveedor() {
  const { proveedor: codInicial, factura: facturaInicial } = Route.useSearch();
  const navigate = useNavigate();

  const [proveedor, setProveedor] = useState<ProveedorLov | null>(null);
  const [facturas, setFacturas] = useState<FacturaCompra[]>([]);
  const [cargandoFacturas, setCargandoFacturas] = useState(false);

  // id_cabecera -> monto a aplicar, solo dígitos. Una factura está elegida si
  // tiene clave acá, aunque el monto esté vacío.
  const [montos, setMontos] = useState<Record<number, string>>({});

  const [nroRecibo, setNroRecibo] = useState("");
  const [fecha, setFecha] = useState(hoyISO);
  const [observacion, setObservacion] = useState("");
  const [pagos, setPagos] = useState<PagoForm[]>([]);
  const siguienteKey = useRef(1);
  const [guardando, setGuardando] = useState(false);

  // Proveedor que viene en la URL (botón "Pagar" del listado): se busca entre
  // los que tienen saldo, igual que en el combobox. Una URL escrita a mano con
  // un proveedor al que no se le debe nada no lo deja elegido.
  useEffect(() => {
    if (!codInicial) return;
    proveedoresConSaldo()
      .then((ps) => {
        const p = ps.find((x) => x.value === codInicial);
        if (p) setProveedor(p);
        else toast.info("Ese proveedor no tiene facturas a crédito con saldo.");
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "No se pudo cargar el proveedor"));
  }, [codInicial]);

  // Facturas con saldo del proveedor elegido, las más viejas primero: es el
  // orden en que se suelen pagar.
  useEffect(() => {
    if (!proveedor) {
      setFacturas([]);
      return;
    }
    setCargandoFacturas(true);
    listarFacturasCompra({ codProveedor: proveedor.value, pendientes: true })
      .then((fs) => {
        const orden = [...fs].sort(
          (a, b) =>
            (a.fecha ?? "9999").localeCompare(b.fecha ?? "9999") || a.id_cabecera - b.id_cabecera,
        );
        setFacturas(orden);
        const f = facturaInicial ? orden.find((x) => x.id_cabecera === facturaInicial) : undefined;
        setMontos(f ? { [f.id_cabecera]: String(f.saldo) } : {});
      })
      .catch((e) => {
        setFacturas([]);
        toast.error(e instanceof Error ? e.message : "No se pudieron traer las facturas");
      })
      .finally(() => setCargandoFacturas(false));
  }, [proveedor, facturaInicial]);

  function elegirProveedor(it: LovItem) {
    setProveedor(it as ProveedorLov);
    setMontos({});
  }

  const montoDe = (id: number) => Number(montos[id] ?? 0) || 0;
  const elegidas = facturas.filter((f) => f.id_cabecera in montos);
  const todas = facturas.length > 0 && elegidas.length === facturas.length;

  // Los dos lados del recibo. diferencia > 0: falta asignar; < 0: sobra.
  const aPagar = elegidas.reduce((s, f) => s + montoDe(f.id_cabecera), 0);
  const pagado = pagos.reduce((s, p) => s + (Number(p.monto) || 0), 0);
  const diferencia = aPagar - pagado;
  const cuadra = aPagar > 0 && diferencia === 0;

  // Al marcar una factura se propone pagarla entera; el monto se puede bajar
  // para un pago parcial.
  function alternar(f: FacturaCompra, marcada: boolean) {
    setMontos((prev) => {
      const next = { ...prev };
      if (marcada) next[f.id_cabecera] = String(f.saldo);
      else delete next[f.id_cabecera];
      return next;
    });
  }

  function alternarTodas(marcadas: boolean) {
    setMontos(
      marcadas ? Object.fromEntries(facturas.map((f) => [f.id_cabecera, String(f.saldo)])) : {},
    );
  }

  // Una forma de pago nueva arranca con lo que falta asignar: si el recibo se
  // paga con una sola, se resuelve con un clic. El cheque arranca "al día"
  // (emisión y vencimiento = fecha del recibo); si es diferido se cambia el
  // vencimiento.
  function agregarPago(forma: FormaPago) {
    const key = siguienteKey.current++;
    setPagos((prev) => [
      ...prev,
      {
        key,
        forma,
        nro: "",
        banco: "",
        emision: forma === "CHEQUE" ? fecha : "",
        vencimiento: forma === "CHEQUE" ? fecha : "",
        monto: diferencia > 0 ? String(diferencia) : "",
      },
    ]);
  }

  function cambiarPago(key: number, cambios: Partial<PagoForm>) {
    setPagos((prev) => prev.map((p) => (p.key === key ? { ...p, ...cambios } : p)));
  }

  function quitarPago(key: number) {
    setPagos((prev) => prev.filter((p) => p.key !== key));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();

    // Las mismas reglas que valida pkg_recibos_compra.crear. Acá van para
    // avisar todo junto antes de ir al servidor; allá, porque el endpoint
    // se puede llamar directo.
    const faltantes: string[] = [];
    if (!proveedor) faltantes.push("Proveedor");
    if (!nroRecibo.trim()) faltantes.push("Nro. de recibo");
    if (!fecha) faltantes.push("Fecha");
    if (elegidas.length === 0) faltantes.push("Al menos una factura");
    if (pagos.length === 0) faltantes.push("Al menos una forma de pago");
    pagos.forEach((p, i) => {
      const n = `pago ${i + 1}`;
      const doc = DOCUMENTO_DE[p.forma];
      if (doc && !p.nro.trim()) faltantes.push(`${doc} (${n})`);
      if (p.forma === "CHEQUE" && !p.banco.trim()) faltantes.push(`Banco (${n})`);
      if (p.forma === "CHEQUE" && !p.emision) faltantes.push(`Emisión (${n})`);
      if (p.forma === "CHEQUE" && !p.vencimiento) faltantes.push(`Vencimiento (${n})`);
      if (!(Number(p.monto) > 0)) faltantes.push(`Monto (${n})`);
    });
    if (faltantes.length) return toast.error(`Completá: ${faltantes.join(", ")}`);

    if (fecha > hoyISO()) return toast.error("La fecha no puede ser posterior a hoy");

    const sinMonto = elegidas.filter((f) => montoDe(f.id_cabecera) <= 0);
    if (sinMonto.length) {
      return toast.error(`Falta el monto de: ${sinMonto.map(nombreFactura).join(", ")}`);
    }
    const excedidas = elegidas.filter((f) => montoDe(f.id_cabecera) > f.saldo);
    if (excedidas.length) {
      return toast.error(`El monto supera el saldo de: ${excedidas.map(nombreFactura).join(", ")}`);
    }

    for (const [i, p] of pagos.entries()) {
      if (p.forma !== "CHEQUE") continue;
      if (p.emision > fecha) {
        return toast.error(`Pago ${i + 1}: la emisión del cheque no puede ser posterior a la fecha del recibo`);
      }
      if (p.vencimiento < p.emision) {
        return toast.error(`Pago ${i + 1}: el vencimiento no puede ser anterior a la emisión`);
      }
    }

    const docs = pagos.filter((p) => p.forma !== "EFECTIVO").map((p) => `${p.forma}|${p.nro.trim()}`);
    if (new Set(docs).size < docs.length) {
      return toast.error("Un mismo número de transferencia o cheque aparece dos veces");
    }

    if (!cuadra) {
      return toast.error(
        diferencia > 0
          ? `Falta asignar ${formatCurrency(diferencia)} a una forma de pago`
          : `Las formas de pago superan lo aplicado en ${formatCurrency(-diferencia)}`,
      );
    }

    setGuardando(true);
    try {
      const { id_recibo } = await crearReciboProveedor({
        cod_proveedor: proveedor!.value,
        nro_recibo: nroRecibo.trim(),
        fecha,
        observacion: observacion.trim() || undefined,
        facturas: elegidas.map((f) => ({
          id_cabecera: f.id_cabecera,
          monto_aplicado: montoDe(f.id_cabecera),
        })),
        // Cada forma manda solo sus datos: el CHECK de la tabla exige NULL en
        // lo que no le corresponde.
        pagos: pagos.map((p) => ({
          forma_pago: p.forma,
          nro_documento: p.forma === "EFECTIVO" ? undefined : p.nro.trim(),
          banco: p.forma === "CHEQUE" ? p.banco.trim() : undefined,
          fecha_emision: p.forma === "CHEQUE" ? p.emision : undefined,
          fecha_vencimiento: p.forma === "CHEQUE" ? p.vencimiento : undefined,
          monto: Number(p.monto),
        })),
      });
      toast.success(`Recibo N° ${nroRecibo.trim()} cargado`);
      navigate({ to: "/admin/recibos-proveedores/$id", params: { id: String(id_recibo) } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar el recibo");
      setGuardando(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link
        to="/admin/recibos-proveedores"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Volver
      </Link>

      <header className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-secondary/15 text-secondary">
          <HandCoins className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-semibold">Nuevo recibo de proveedor</h1>
          <p className="text-sm text-muted-foreground">
            Qué facturas se pagan y con qué: efectivo, transferencias o cheques.
          </p>
        </div>
      </header>

      <form
        onSubmit={onSubmit}
        autoComplete="off"
        className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]"
      >
        <div className="min-w-0 space-y-6">
          {/* ① Proveedor y recibo */}
          <Card className="space-y-5 p-6">
            <Paso n={1} titulo="Proveedor y recibo" />
            <Field label="Proveedor" required>
              <AsyncCombobox
                title="Proveedor"
                placeholder="Seleccionar proveedor..."
                emptyText="Ningún proveedor con facturas pendientes"
                value={proveedor?.value ?? null}
                label={proveedor?.label ?? null}
                fetcher={proveedoresConSaldo}
                onSelect={elegirProveedor}
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
              <p className="mt-1.5 text-xs text-muted-foreground">
                Solo aparecen proveedores con facturas a crédito pendientes.
              </p>
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Nro. de recibo del proveedor" required>
                <Input
                  value={nroRecibo}
                  onChange={(e) => setNroRecibo(e.target.value)}
                  maxLength={20}
                  placeholder="Ej. 001-001-0000123"
                />
              </Field>
              <Field label="Fecha" required>
                <Input
                  type="date"
                  value={fecha}
                  max={hoyISO()}
                  onChange={(e) => setFecha(e.target.value)}
                />
              </Field>
            </div>
          </Card>

          {/* ② Facturas */}
          <Card className="space-y-5 p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Paso n={2} titulo="Facturas a pagar" />
              {facturas.length > 0 && (
                <div className="flex items-center gap-3">
                  <p className="text-sm text-muted-foreground">
                    {elegidas.length} de {facturas.length} elegidas
                  </p>
                  {!todas && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => alternarTodas(true)}
                      className="rounded-full"
                    >
                      Pagar todo
                    </Button>
                  )}
                </div>
              )}
            </div>

            {!proveedor ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Elegí un proveedor para ver sus facturas pendientes.
              </p>
            ) : cargandoFacturas ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Trayendo facturas...
              </div>
            ) : facturas.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Este proveedor no tiene facturas a crédito con saldo.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/60 hover:bg-muted/60">
                      <TableHead className="w-10">
                        <Checkbox
                          checked={todas ? true : elegidas.length > 0 ? "indeterminate" : false}
                          onCheckedChange={(v) => alternarTodas(v === true)}
                          aria-label="Elegir todas"
                        />
                      </TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Nro. Factura</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Pagado</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                      <TableHead className="w-44 text-right">A aplicar</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {facturas.map((f) => {
                      const elegida = f.id_cabecera in montos;
                      const monto = montoDe(f.id_cabecera);
                      const excede = elegida && monto > f.saldo;
                      return (
                        <TableRow
                          key={f.id_cabecera}
                          className={cn(!elegida && "text-muted-foreground")}
                        >
                          <TableCell>
                            <Checkbox
                              checked={elegida}
                              onCheckedChange={(v) => alternar(f, v === true)}
                              aria-label={`Elegir factura ${nombreFactura(f)}`}
                            />
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{fechaPy(f.fecha)}</TableCell>
                          <TableCell className="whitespace-nowrap font-mono text-xs">
                            {nombreFactura(f)}
                          </TableCell>
                          <TableCell className="text-right">{formatCurrency(f.total)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(f.pagado)}</TableCell>
                          <TableCell className="text-right font-medium text-foreground">
                            {formatCurrency(f.saldo)}
                          </TableCell>
                          <TableCell className="text-right">
                            {elegida ? (
                              <div className="space-y-1">
                                <MontoInput
                                  value={montos[f.id_cabecera]}
                                  onChange={(v) =>
                                    setMontos((prev) => ({ ...prev, [f.id_cabecera]: v }))
                                  }
                                  invalido={excede || monto <= 0}
                                  aria-label={`Monto a aplicar a ${nombreFactura(f)}`}
                                />
                                {excede ? (
                                  <p className="text-xs text-destructive">Supera el saldo</p>
                                ) : monto > 0 && monto < f.saldo ? (
                                  <p className="text-xs text-warning-foreground">Pago parcial</p>
                                ) : null}
                              </div>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>

          {/* ③ Formas de pago */}
          <Card className="space-y-5 p-6">
            <Paso n={3} titulo="Formas de pago" />

            {pagos.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                Agregá con qué se paga. Se puede combinar: por ejemplo, una parte en efectivo y
                el resto con un cheque.
              </div>
            ) : (
              <div className="space-y-3">
                {pagos.map((p, i) => (
                  <PagoCard
                    key={p.key}
                    n={i + 1}
                    pago={p}
                    falta={diferencia}
                    onChange={(c) => cambiarPago(p.key, c)}
                    onQuitar={() => quitarPago(p.key)}
                  />
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {(Object.keys(FORMAS_PAGO) as FormaPago[]).map((fp) => {
                const Icon = ICONO_FORMA[fp];
                return (
                  <Button
                    key={fp}
                    type="button"
                    variant="outline"
                    onClick={() => agregarPago(fp)}
                    className="rounded-full"
                  >
                    <Plus className="h-4 w-4" />
                    <Icon className="h-4 w-4 text-secondary" />
                    {FORMAS_PAGO[fp]}
                  </Button>
                );
              })}
            </div>
          </Card>

          {/* ④ Observación */}
          <Card className="space-y-5 p-6">
            <Paso n={4} titulo="Observación" />
            <Textarea
              rows={3}
              value={observacion}
              onChange={(e) => setObservacion(e.target.value)}
              maxLength={500}
              placeholder="Opcional"
              aria-label="Observación"
            />
          </Card>
        </div>

        {/* Resumen fijo: los dos lados del recibo y si cuadran */}
        <aside className="space-y-4 lg:sticky lg:top-20">
          <Card className="space-y-5 p-5">
            <h2 className="font-display text-lg font-semibold">Resumen</h2>

            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">A pagar</p>
              <p className="font-display text-2xl font-semibold tracking-tight">
                {formatCurrency(aPagar)}
              </p>
              <p className="text-xs text-muted-foreground">
                {elegidas.length === 0
                  ? "Ninguna factura elegida"
                  : `${elegidas.length} ${elegidas.length === 1 ? "factura" : "facturas"}`}
              </p>
            </div>

            <div className="space-y-2 border-t border-border pt-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Pagado con</p>
              {pagos.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin formas de pago</p>
              ) : (
                <ul className="space-y-1.5">
                  {pagos.map((p) => {
                    const Icon = ICONO_FORMA[p.forma];
                    return (
                      <li key={p.key} className="flex min-w-0 items-center gap-2 text-sm">
                        <Icon className="h-4 w-4 shrink-0 text-secondary" />
                        <span className="min-w-0 flex-1 truncate">
                          {FORMAS_PAGO[p.forma]}
                          {p.nro.trim() && (
                            <span className="text-muted-foreground"> {p.nro.trim()}</span>
                          )}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {formatCurrency(Number(p.monto) || 0)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="flex items-baseline justify-between pt-1">
                <span className="text-sm font-medium">Total pagado</span>
                <span className="font-display text-lg font-semibold tabular-nums">
                  {formatCurrency(pagado)}
                </span>
              </div>
            </div>

            <Balance aPagar={aPagar} diferencia={diferencia} />

            <div className="space-y-2">
              <Button
                type="submit"
                disabled={guardando || !cuadra}
                className="h-11 w-full bg-primary text-primary-foreground hover:opacity-90"
              >
                {guardando ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Check className="h-4 w-4" /> Guardar recibo
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => navigate({ to: "/admin/recibos-proveedores" })}
                className="w-full text-muted-foreground"
              >
                Cancelar
              </Button>
            </div>
          </Card>
        </aside>
      </form>
    </div>
  );
}

// Una forma de pago. Muestra solo los campos que esa forma lleva: los mismos
// que exige el CHECK RECIBOS_COMPRA_PAG_CK_DATOS, así no hay combinación
// inválida que armar.
function PagoCard({
  n,
  pago,
  falta,
  onChange,
  onQuitar,
}: {
  n: number;
  pago: PagoForm;
  falta: number;
  onChange: (c: Partial<PagoForm>) => void;
  onQuitar: () => void;
}) {
  const Icon = ICONO_FORMA[pago.forma];
  const doc = DOCUMENTO_DE[pago.forma];
  const esCheque = pago.forma === "CHEQUE";
  const monto = Number(pago.monto) || 0;
  const diasDiferido =
    esCheque && pago.emision && pago.vencimiento > pago.emision
      ? diasEntre(pago.emision, pago.vencimiento)
      : 0;

  return (
    <div className="space-y-3 rounded-xl border border-border bg-background/50 p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary/15 text-secondary">
          <Icon className="h-4 w-4" />
        </span>
        <p className="min-w-0 flex-1 truncate font-medium">
          {FORMAS_PAGO[pago.forma]}
          <span className="ml-2 text-xs font-normal text-muted-foreground">Pago {n}</span>
        </p>
        {diasDiferido > 0 && (
          <span className="shrink-0 rounded-full bg-warning/20 px-2 py-0.5 text-[11px] font-medium text-warning-foreground">
            Diferido · {diasDiferido} {diasDiferido === 1 ? "día" : "días"}
          </span>
        )}
        <button
          type="button"
          onClick={onQuitar}
          aria-label={`Quitar pago ${n}`}
          title="Quitar"
          className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div
        className={cn(
          "grid grid-cols-1 gap-3",
          esCheque ? "sm:grid-cols-2 xl:grid-cols-3" : doc ? "sm:grid-cols-2" : "sm:max-w-xs",
        )}
      >
        {esCheque && (
          <Field label="Banco" required>
            <Input
              value={pago.banco}
              onChange={(e) => onChange({ banco: e.target.value })}
              maxLength={100}
              placeholder="Banco que emite el cheque"
            />
          </Field>
        )}
        {doc && (
          <Field label={doc} required>
            <Input
              value={pago.nro}
              onChange={(e) => onChange({ nro: e.target.value })}
              maxLength={30}
            />
          </Field>
        )}
        {esCheque && (
          <>
            <Field label="Emisión" required>
              <Input
                type="date"
                value={pago.emision}
                onChange={(e) => onChange({ emision: e.target.value })}
              />
            </Field>
            <Field label="Vencimiento" required>
              <Input
                type="date"
                value={pago.vencimiento}
                min={pago.emision || undefined}
                onChange={(e) => onChange({ vencimiento: e.target.value })}
              />
            </Field>
          </>
        )}
        <Field label="Monto" required>
          <MontoInput
            value={pago.monto}
            onChange={(v) => onChange({ monto: v })}
            invalido={pago.monto !== "" && monto <= 0}
            aria-label={`Monto del pago ${n}`}
          />
          {/* Atajo para cerrar la diferencia con esta forma de pago. */}
          {falta > 0 && (
            <button
              type="button"
              onClick={() => onChange({ monto: String(monto + falta) })}
              className="mt-1 text-xs text-secondary hover:underline"
            >
              + {formatCurrency(falta)} que falta
            </button>
          )}
        </Field>
      </div>
    </div>
  );
}

// Si los dos lados del recibo cuadran. Es lo que habilita "Guardar".
function Balance({ aPagar, diferencia }: { aPagar: number; diferencia: number }) {
  if (aPagar === 0) {
    return (
      <div className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
        Elegí las facturas que paga este recibo.
      </div>
    );
  }
  if (diferencia === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-success/15 px-4 py-3 text-sm font-medium text-success">
        <CircleCheck className="h-4 w-4 shrink-0" /> Cuadra
      </div>
    );
  }
  const falta = diferencia > 0;
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-xl px-4 py-3 text-sm",
        falta ? "bg-warning/20 text-warning-foreground" : "bg-destructive/10 text-destructive",
      )}
    >
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="font-medium">
          {falta ? "Falta asignar" : "Sobran"} {formatCurrency(Math.abs(diferencia))}
        </p>
        <p className="text-xs opacity-80">
          {falta
            ? "Agregá o completá una forma de pago."
            : "Las formas de pago superan lo aplicado a las facturas."}
        </p>
      </div>
    </div>
  );
}

// Monto en guaraníes: guarda solo dígitos y muestra con separador de miles.
function MontoInput({
  value,
  onChange,
  invalido,
  ...rest
}: {
  value: string | undefined;
  onChange: (digitos: string) => void;
  invalido?: boolean;
  "aria-label"?: string;
}) {
  return (
    <Input
      inputMode="numeric"
      value={value ? Number(value).toLocaleString("es-PY") : ""}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
      aria-invalid={invalido}
      className={cn("h-9 text-right font-medium", invalido && "border-destructive")}
      {...rest}
    />
  );
}

function Paso({ n, titulo }: { n: number; titulo: string }) {
  return (
    <h2 className="flex items-center gap-2.5 font-display text-lg font-semibold">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 font-sans text-xs font-semibold text-primary">
        {n}
      </span>
      {titulo}
    </h2>
  );
}

// Días entre dos fechas YYYY-MM-DD. Date.UTC en los dos lados: la cuenta no
// depende del huso horario (GUIA-FRONTEND §7).
function diasEntre(desde: string, hasta: string) {
  const utc = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(hasta) - utc(desde)) / 86_400_000);
}

// En el alta solo se ofrecen proveedores a los que se les debe algo: al menos
// una factura a crédito con saldo > 0 (el `saldo` del LOV suma solo esas).
// Es la única fuente de proveedores de esta pantalla —la usan el combobox y el
// proveedor de la URL— para que ningún camino deje elegir uno sin saldo.
// Va fuera del componente para que el fetcher del combobox sea estable.
async function proveedoresConSaldo(q?: string): Promise<ProveedorLov[]> {
  return (await lovProveedores(q)).filter((p) => p.saldo > 0);
}

// Hay facturas sin nro. de factura (REFERENCIA NULL): se nombran por su ID.
function nombreFactura(f: FacturaCompra) {
  return f.referencia || `ID ${f.id_cabecera}`;
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
    </div>
  );
}
