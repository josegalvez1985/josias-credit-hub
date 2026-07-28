import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Share2, Loader2, Check, AlertCircle } from "lucide-react";
import {
  derivarCuota,
  filtrarLov,
  lovRecibos,
  type CuotaLov,
  type LovItem,
} from "@/lib/api";
import { formatCurrency } from "@/lib/credit-applications";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AsyncCombobox } from "@/components/async-combobox";
import { ClienteCombobox } from "@/components/cliente-combobox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/recibos/derivaciones")({
  head: () => ({
    meta: [
      { title: "Derivaciones — Créditos" },
      { name: "description", content: "Derivación de cuotas a gestión de cobranza." },
    ],
  }),
  component: Derivaciones,
});

type Opcion = { value: number; label: string };

const hoy = () => new Date().toISOString().slice(0, 10);

function Derivaciones() {
  const [cliente, setCliente] = useState<Opcion | null>(null);
  const [solicitud, setSolicitud] = useState<Opcion | null>(null);
  const [cuota, setCuota] = useState<CuotaLov | null>(null);
  const [fecha, setFecha] = useState(hoy);
  const [guardando, setGuardando] = useState(false);
  const [confirmar, setConfirmar] = useState(false);

  function elegirCliente(it: LovItem) {
    setCliente({ value: it.value, label: it.label });
    setSolicitud(null);
    setCuota(null);
  }

  function elegirSolicitud(it: LovItem) {
    setSolicitud({ value: it.value, label: it.label });
    setCuota(null);
  }

  const fetchSolicitudes = useCallback(
    async (q?: string) => (cliente ? filtrarLov(await lovRecibos.solicitudes(cliente.value), q) : []),
    [cliente],
  );

  // A diferencia de recibos, acá el LOV solo trae cuotas con saldo pendiente:
  // es el filtro `and nvl(saldo_cuota,0) <> 0` de la página 4.
  const fetchCuotas = useCallback(
    async (q?: string) => (solicitud ? filtrarLov(await lovRecibos.cuotas(solicitud.value, true), q) : []),
    [solicitud],
  );

  // La página 4 limpia todo al abrirse (acción dinámica "Nuevo").
  useEffect(() => {
    setFecha(hoy());
  }, []);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const faltantes: string[] = [];
    if (!cliente) faltantes.push("Cliente");
    if (!solicitud) faltantes.push("Solicitud");
    if (!cuota) faltantes.push("Cuota");
    if (!fecha) faltantes.push("Fecha de derivación");
    if (faltantes.length) return toast.error(`Completá: ${faltantes.join(", ")}`);
    setConfirmar(true);
  }

  async function guardar() {
    setConfirmar(false);
    setGuardando(true);
    try {
      await derivarCuota(solicitud!.value, cuota!.value, fecha);
      toast.success("Derivación guardada");
      setCuota(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar la derivación");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary/15 text-secondary">
          <Share2 className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-semibold">Derivaciones</h1>
          <p className="text-sm text-muted-foreground">
            Marcá la fecha en que la cuota pasa a gestión de cobranza.
          </p>
        </div>
      </header>

      <form onSubmit={onSubmit} className="space-y-6" autoComplete="off">
        <Card className="space-y-5 p-6">
          <Field label="Cliente" required>
            <ClienteCombobox
              value={cliente?.value ?? null}
              label={cliente?.label ?? null}
              onSelect={elegirCliente}
            />
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
                onSelect={(it) => setCuota(it as CuotaLov)}
              />
            ) : (
              <Deshabilitado>Elegí primero una solicitud</Deshabilitado>
            )}
            <p className="mt-1.5 text-xs text-muted-foreground">
              Solo aparecen cuotas con saldo pendiente.
            </p>
          </Field>
        </Card>

        {cuota && (
          <Card className="space-y-5 p-6">
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Dato label="Saldo de la cuota" value={formatCurrency(cuota.saldo_cuota)} />
              <Dato
                label="Fecha de vencimiento"
                value={cuota.fec_vencimiento ? formatFecha(cuota.fec_vencimiento) : "—"}
              />
            </div>

            {/* APEX no avisaba esto: si la cuota ya se derivó, guardar de nuevo
                pisa la fecha anterior sin dejar rastro. */}
            {cuota.fec_derivacion && (
              <div className="flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/10 p-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
                <p className="text-sm text-warning-foreground">
                  Esta cuota ya fue derivada el{" "}
                  <span className="font-medium">{formatFecha(cuota.fec_derivacion)}</span>. Si
                  guardás, se reemplaza esa fecha.
                </p>
              </div>
            )}

            <Field label="Fecha de derivación" required>
              <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </Field>
          </Card>
        )}

        <Button
          type="submit"
          disabled={guardando || !cuota}
          className="w-full bg-primary text-primary-foreground hover:opacity-90"
        >
          {guardando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Check className="h-4 w-4" /> Guardar derivación
            </>
          )}
        </Button>
      </form>

      {/* El botón Guardar de la página 4 pedía confirmación con estilo warning. */}
      <AlertDialog open={confirmar} onOpenChange={setConfirmar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Está seguro de guardar esta derivación?</AlertDialogTitle>
            <AlertDialogDescription>
              {cliente?.label} · {cuota?.label} · {formatFecha(fecha)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={guardar}>Guardar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
