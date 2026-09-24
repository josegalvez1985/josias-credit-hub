import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Check, HandCoins, Loader2 } from "lucide-react";
import {
  COMPROBANTE_DE,
  crearReciboProveedor,
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
  const [formaPago, setFormaPago] = useState<FormaPago | null>(null);
  const [nroComprobante, setNroComprobante] = useState("");
  const [observacion, setObservacion] = useState("");
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
  const total = elegidas.reduce((s, f) => s + montoDe(f.id_cabecera), 0);
  const todas = facturas.length > 0 && elegidas.length === facturas.length;

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

  // null en efectivo (y sin forma elegida): no lleva comprobante.
  const etiquetaComprobante = formaPago ? COMPROBANTE_DE[formaPago] : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();

    // Las mismas reglas que valida pkg_recibos_compra.crear. Acá van para
    // avisar todo junto antes de ir al servidor; allá, porque el endpoint
    // se puede llamar directo.
    const faltantes: string[] = [];
    if (!proveedor) faltantes.push("Proveedor");
    if (!nroRecibo.trim()) faltantes.push("Nro. de recibo");
    if (!fecha) faltantes.push("Fecha");
    if (!formaPago) faltantes.push("Forma de pago");
    if (etiquetaComprobante && !nroComprobante.trim()) faltantes.push(etiquetaComprobante);
    if (elegidas.length === 0) faltantes.push("Al menos una factura");
    if (faltantes.length) return toast.error(`Completá: ${faltantes.join(", ")}`);

    const sinMonto = elegidas.filter((f) => montoDe(f.id_cabecera) <= 0);
    if (sinMonto.length) {
      return toast.error(`Falta el monto de: ${sinMonto.map(nombreFactura).join(", ")}`);
    }
    const excedidas = elegidas.filter((f) => montoDe(f.id_cabecera) > f.saldo);
    if (excedidas.length) {
      return toast.error(`El monto supera el saldo de: ${excedidas.map(nombreFactura).join(", ")}`);
    }
    if (fecha > hoyISO()) return toast.error("La fecha no puede ser posterior a hoy");

    setGuardando(true);
    try {
      const { id_recibo } = await crearReciboProveedor({
        cod_proveedor: proveedor!.value,
        nro_recibo: nroRecibo.trim(),
        fecha,
        forma_pago: formaPago!,
        nro_comprobante: etiquetaComprobante ? nroComprobante.trim() : undefined,
        observacion: observacion.trim() || undefined,
        facturas: elegidas.map((f) => ({
          id_cabecera: f.id_cabecera,
          monto_aplicado: montoDe(f.id_cabecera),
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
    <div className="mx-auto max-w-4xl space-y-6">
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
            Registrá un pago y a qué facturas de compra a crédito se aplica.
          </p>
        </div>
      </header>

      <form onSubmit={onSubmit} className="space-y-6" autoComplete="off">
        <Card className="space-y-5 p-6">
          <h2 className="font-display text-lg font-semibold">Proveedor</h2>
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
        </Card>

        {proveedor && (
          <Card className="space-y-5 p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-lg font-semibold">Facturas a pagar</h2>
              {facturas.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {elegidas.length} de {facturas.length} elegidas
                </p>
              )}
            </div>

            {cargandoFacturas ? (
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
                                <Input
                                  inputMode="numeric"
                                  value={montos[f.id_cabecera] ? monto.toLocaleString("es-PY") : ""}
                                  onChange={(e) =>
                                    setMontos((prev) => ({
                                      ...prev,
                                      [f.id_cabecera]: e.target.value.replace(/\D/g, ""),
                                    }))
                                  }
                                  aria-invalid={excede || monto <= 0}
                                  className={cn(
                                    "h-9 text-right font-medium",
                                    (excede || monto <= 0) && "border-destructive",
                                  )}
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
        )}

        <Card className="space-y-5 p-6">
          <h2 className="font-display text-lg font-semibold">Datos del recibo</h2>

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

          <Field label="Forma de pago" required>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {(Object.keys(FORMAS_PAGO) as FormaPago[]).map((fp) => (
                <button
                  key={fp}
                  type="button"
                  onClick={() => setFormaPago(fp)}
                  aria-pressed={formaPago === fp}
                  className={cn(
                    "h-10 rounded-xl border px-2 text-sm font-medium transition-colors",
                    formaPago === fp
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {FORMAS_PAGO[fp]}
                </button>
              ))}
            </div>
          </Field>

          {/* En efectivo no hay comprobante: el backend lo guarda NULL. */}
          {etiquetaComprobante && (
            <Field label={etiquetaComprobante} required>
              <Input
                value={nroComprobante}
                onChange={(e) => setNroComprobante(e.target.value)}
                maxLength={30}
              />
            </Field>
          )}

          <Field label="Observación">
            <Textarea
              rows={3}
              value={observacion}
              onChange={(e) => setObservacion(e.target.value)}
              maxLength={500}
            />
          </Field>
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-primary bg-primary/10 px-5 py-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Total del recibo</p>
            <p className="text-xs text-muted-foreground">
              {elegidas.length === 0
                ? "Elegí las facturas que paga este recibo."
                : `${elegidas.length} ${elegidas.length === 1 ? "factura" : "facturas"}`}
            </p>
          </div>
          <p className="shrink-0 font-display text-3xl font-semibold tracking-tight">
            {formatCurrency(total)}
          </p>
        </div>

        <div className="flex gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: "/admin/recibos-proveedores" })}
            className="flex-1"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={guardando}
            className="flex-1 bg-primary text-primary-foreground hover:opacity-90"
          >
            {guardando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Check className="h-4 w-4" /> Guardar recibo
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
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
