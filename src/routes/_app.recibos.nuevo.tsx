import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Loader2, Receipt, Check } from "lucide-react";
import {
  crearRecibo,
  datosCuota,
  filtrarLov,
  lovRecibos,
  obtenerRecibo,
  type DatosCuota,
  type LovItem,
  type ReciboDetalle,
} from "@/lib/api";
import { ReciboAcciones, ticketDesdeRecibo } from "@/components/recibo-acciones";
import { ClienteCombobox } from "@/components/cliente-combobox";
import { formatCurrency } from "@/lib/credit-applications";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AsyncCombobox } from "@/components/async-combobox";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/recibos/nuevo")({
  head: () => ({
    meta: [
      { title: "Crear recibo — Créditos" },
      { name: "description", content: "Emisión de un recibo de cobranza." },
    ],
  }),
  component: NuevoRecibo,
});

type Opcion = { value: number; label: string };

const hoy = () => new Date().toISOString().slice(0, 10);

function NuevoRecibo() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [emitido, setEmitido] = useState<ReciboDetalle | null>(null);

  // Cascada: cliente -> solicitud -> cuota. Es la de la página 3 de APEX.
  const [cliente, setCliente] = useState<Opcion | null>(null);
  const [solicitud, setSolicitud] = useState<Opcion | null>(null);
  const [cuota, setCuota] = useState<Opcion | null>(null);

  const [datos, setDatos] = useState<DatosCuota | null>(null);
  const [cargandoCuota, setCargandoCuota] = useState(false);

  const [monto, setMonto] = useState("");
  const [concepto, setConcepto] = useState("");
  const [fecha, setFecha] = useState(hoy);

  // Al cambiar el cliente se cae todo lo de abajo; al cambiar la solicitud, la cuota.
  function elegirCliente(it: LovItem) {
    setCliente({ value: it.value, label: it.label });
    setSolicitud(null);
    setCuota(null);
    setDatos(null);
    setMonto("");
    setConcepto("");
  }

  function elegirSolicitud(it: LovItem) {
    setSolicitud({ value: it.value, label: it.label });
    setCuota(null);
    setDatos(null);
    setMonto("");
  }

  const fetchSolicitudes = useCallback(
    async (q?: string) => (cliente ? filtrarLov(await lovRecibos.solicitudes(cliente.value), q) : []),
    [cliente],
  );

  const fetchCuotas = useCallback(
    async (q?: string) => (solicitud ? filtrarLov(await lovRecibos.cuotas(solicitud.value), q) : []),
    [solicitud],
  );

  // Equivale a la acción dinámica CALCULOS: al elegir la cuota trae saldo,
  // interés, vencimiento y el concepto sugerido, y propone el monto = saldo.
  useEffect(() => {
    if (!cliente || !solicitud || !cuota) return;
    setCargandoCuota(true);
    datosCuota(cliente.value, solicitud.value, cuota.value)
      .then((d) => {
        setDatos(d);
        setMonto(String(d.saldo_cuota ?? 0));
        if (d.concepto) setConcepto(d.concepto);
      })
      .catch((e) => {
        setDatos(null);
        toast.error(e instanceof Error ? e.message : "No se pudieron traer los datos de la cuota");
      })
      .finally(() => setCargandoCuota(false));
  }, [cliente, solicitud, cuota]);

  const montoNum = Number(monto.replace(/\D/g, "")) || 0;
  const saldo = datos?.saldo_cuota ?? 0;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();

    const faltantes: string[] = [];
    if (!cliente) faltantes.push("Cliente");
    if (!solicitud) faltantes.push("Solicitud");
    if (!cuota) faltantes.push("Cuota");
    if (faltantes.length) return toast.error(`Completá: ${faltantes.join(", ")}`);

    if (montoNum <= 0) return toast.error("El monto debe ser mayor a cero");
    if (saldo > 0 && montoNum > saldo) {
      return toast.error(`El monto supera el saldo de la cuota (${formatCurrency(saldo)})`);
    }
    if (fecha > hoy()) return toast.error("La fecha no puede ser posterior a hoy");

    setLoading(true);
    try {
      const { nro_recibo } = await crearRecibo({
        cod_cliente: cliente!.value,
        id_solicitud: solicitud!.value,
        id_cuota: cuota!.value,
        monto: montoNum,
        fecha_recibo: fecha,
        concepto: concepto.trim() || undefined,
      });
      toast.success(`Recibo #${nro_recibo} emitido`);

      // En vez de volver al listado, se relee el recibo recién creado y se
      // muestra listo para imprimir o mandar por WhatsApp: es lo que el cobrador
      // hace siempre a continuación, parado frente al cliente.
      const r = await obtenerRecibo(nro_recibo).catch(() => null);
      if (r) setEmitido(r);
      else navigate({ to: "/recibos" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al emitir el recibo");
    } finally {
      setLoading(false);
    }
  }

  if (emitido) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Card className="space-y-5 p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground">
              <Check className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <h1 className="font-display text-2xl font-semibold">
                Recibo #{emitido.nro_recibo}
              </h1>
              <p className="text-sm text-muted-foreground">Emitido correctamente.</p>
            </div>
          </div>

          <div className="rounded-2xl bg-gradient-caramel p-5 text-primary-foreground shadow-elegant">
            <p className="text-xs uppercase tracking-wider opacity-80">Monto cobrado</p>
            <p className="mt-1 font-display text-3xl font-semibold">
              {formatCurrency(emitido.monto)}
            </p>
            {emitido.monto_letras && <p className="mt-1 text-xs opacity-80">{emitido.monto_letras}</p>}
          </div>

          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Dato label="Cliente" value={emitido.razon_social ?? "—"} />
            <Dato label="Documento" value={emitido.documento ?? "—"} />
            <Dato label="Solicitud" value={String(emitido.nro_solicitud)} />
            <Dato label="Cuota" value={emitido.cuota_texto ?? String(emitido.nro_cuota)} />
          </div>

          <div className="space-y-2 border-t border-border pt-4">
            <ReciboAcciones
              datos={ticketDesdeRecibo(emitido)}
              telefono={emitido.nro_telefono}
              recibo={emitido}
            />
          </div>
        </Card>

        <div className="flex gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: "/recibos" })}
            className="flex-1"
          >
            Ir al listado
          </Button>
          <Button
            type="button"
            onClick={() => {
              // Otro cobro del mismo cliente es el caso más común, así que se
              // conserva el cliente y se reinicia lo de abajo.
              setEmitido(null);
              setSolicitud(null);
              setCuota(null);
              setDatos(null);
              setMonto("");
              setConcepto("");
              setFecha(hoy());
            }}
            className="flex-1 bg-primary text-primary-foreground hover:opacity-90"
          >
            <Receipt className="h-4 w-4" /> Otro recibo
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        to="/recibos"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Volver
      </Link>

      <header className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary/15 text-secondary">
          <Receipt className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-semibold">Crear recibo</h1>
          <p className="text-sm text-muted-foreground">Registrá el cobro de una cuota.</p>
        </div>
      </header>

      <form onSubmit={onSubmit} className="space-y-6" autoComplete="off">
        <Card className="space-y-5 p-6">
          <h2 className="font-display text-lg font-semibold">Cuota a cobrar</h2>

          <Field label="Cliente" required>
            <ClienteCombobox
              value={cliente?.value ?? null}
              label={cliente?.label ?? null}
              onSelect={elegirCliente}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Solo aparecen clientes con cuotas pendientes.
            </p>
          </Field>

          <Field label="Solicitud" required>
            {cliente ? (
              <AsyncCombobox
                title="Solicitud"
                placeholder="Seleccionar solicitud..."
                value={solicitud?.value ?? null}
                label={solicitud?.label ?? null}
                fetcher={fetchSolicitudes}
                onSelect={elegirSolicitud}
              />
            ) : (
              <Deshabilitado>Elegí primero un cliente</Deshabilitado>
            )}
          </Field>

          <Field label="Cuota" required>
            {solicitud ? (
              <AsyncCombobox
                title="Cuota"
                placeholder="Seleccionar cuota..."
                value={cuota?.value ?? null}
                label={cuota?.label ?? null}
                fetcher={fetchCuotas}
                onSelect={(it) => setCuota({ value: it.value, label: it.label })}
              />
            ) : (
              <Deshabilitado>Elegí primero una solicitud</Deshabilitado>
            )}
          </Field>
        </Card>

        {/* Datos de la cuota elegida */}
        {cargandoCuota ? (
          <Card className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Trayendo datos de la cuota...
          </Card>
        ) : datos ? (
          <Card className="space-y-5 p-6">
            <h2 className="font-display text-lg font-semibold">Cobro</h2>

            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Dato label="Saldo de la cuota" value={formatCurrency(datos.saldo_cuota)} />
              <Dato
                label="Vencimiento"
                value={datos.fec_vencimiento ? formatFecha(datos.fec_vencimiento) : "—"}
              />
              {datos.total_interes > 0 && (
                <Dato label="Intereses" value={formatCurrency(datos.total_interes)} />
              )}
              {datos.cuota_texto && <Dato label="Cuota" value={datos.cuota_texto} />}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Monto a cobrar" required>
                <Input
                  inputMode="numeric"
                  value={montoNum ? montoNum.toLocaleString("es-PY") : ""}
                  onChange={(e) => setMonto(e.target.value.replace(/\D/g, ""))}
                  className="font-display text-lg font-semibold"
                />
                {montoNum > 0 && saldo > 0 && montoNum < saldo && (
                  <p className="mt-1.5 text-xs text-warning-foreground">
                    Pago parcial. Queda un saldo de {formatCurrency(saldo - montoNum)}.
                  </p>
                )}
              </Field>

              <Field label="Fecha del recibo" required>
                <Input
                  type="date"
                  value={fecha}
                  max={hoy()}
                  onChange={(e) => setFecha(e.target.value)}
                />
              </Field>
            </div>

            <Field label="Concepto">
              <Textarea
                rows={3}
                value={concepto}
                onChange={(e) => setConcepto(e.target.value)}
                maxLength={500}
              />
            </Field>
          </Card>
        ) : null}

        <div className="flex gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: "/recibos" })}
            className="flex-1"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={loading || !datos}
            className="flex-1 bg-primary text-primary-foreground hover:opacity-90"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Check className="h-4 w-4" /> Emitir recibo
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
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

function Deshabilitado({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-10 w-full items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function Dato({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-2 sm:border-0 sm:pb-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium">{value}</span>
    </div>
  );
}

function formatFecha(d: string) {
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  return date.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });
}
