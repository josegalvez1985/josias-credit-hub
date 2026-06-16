import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Plus,
  Trash2,
  User,
  Package,
  Briefcase,
  Users,
  ClipboardCheck,
  UserPlus,
} from "lucide-react";
import { formatCurrency } from "@/lib/credit-applications";
import {
  crearSolicitud,
  lov,
  type DetalleInput,
  type ReferenciaInput,
  type LovItem,
} from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { AsyncCombobox } from "@/components/async-combobox";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/solicitudes/nueva")({
  head: () => ({
    meta: [
      { title: "Nueva solicitud — Créditos" },
      { name: "description", content: "Registra una nueva solicitud de crédito." },
    ],
  }),
  component: NewApplication,
});

const STEPS = [
  { key: "cliente", label: "Cliente", icon: User },
  { key: "articulos", label: "Artículos", icon: Package },
  { key: "actividad", label: "Actividad laboral", icon: Briefcase },
  { key: "referencias", label: "Referencias", icon: Users },
  { key: "resumen", label: "Resumen", icon: ClipboardCheck },
] as const;

type DetalleRow = DetalleInput & { label: string };

// Formatea un string de dígitos con separador de miles (es-PY usa punto). "" si vacío.
const fmtMiles = (v: string) => {
  const d = v.replace(/\D/g, "");
  return d ? Number(d).toLocaleString("es-PY") : "";
};

function NewApplication() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);

  // ---- Cliente / cabecera
  const [cliente, setCliente] = useState<{ value: number; label: string } | null>(null);
  const [ciudad, setCiudad] = useState<{ value: number; label: string } | null>(null);
  const [vendedor, setVendedor] = useState<{ value: number; label: string } | null>(null);
  const [fechaFactura, setFechaFactura] = useState(() => new Date().toISOString().slice(0, 10));
  const [cantidadCuotas, setCantidadCuotas] = useState("12");
  const [entregaInicial, setEntregaInicial] = useState("");
  const [porcInteres, setPorcInteres] = useState("0");
  const [fecVencInicial, setFecVencInicial] = useState("");

  // ---- Detalle (artículos)
  const [detalles, setDetalles] = useState<DetalleRow[]>([]);
  const [artSel, setArtSel] = useState<{ value: number; label: string } | null>(null);
  const [artCantidad, setArtCantidad] = useState("1");
  const [artPrecio, setArtPrecio] = useState("");

  // ---- Actividad laboral
  const [actEnabled, setActEnabled] = useState(false);
  const [act, setAct] = useState({
    es_empleado: "S",
    nombre_empresa: "",
    direccion: "",
    puesto_ocupado: "",
    ingresos_mensuales: "",
    otros_ingresos: "",
    antiguedad: "",
    telefono: "",
    aporta_ips: "N",
  });
  const [actProfesion, setActProfesion] = useState<{ value: number; label: string } | null>(null);
  const [actCiudad, setActCiudad] = useState<{ value: number; label: string } | null>(null);

  // ---- Referencias
  const [referencias, setReferencias] = useState<ReferenciaInput[]>([]);
  const [refRow, setRefRow] = useState<ReferenciaInput>({ relacion: "", telefono: "", nombre_apellido: "" });

  // ---- Cálculos
  const total = useMemo(
    () => detalles.reduce((s, d) => s + d.cantidad * d.precio_unitario, 0),
    [detalles],
  );
  const cuotas = Number(cantidadCuotas) || 1;
  const entrega = Number(entregaInicial.replace(/\D/g, "")) || 0;
  const interes = Number(porcInteres) || 0;
  const montoCuota = useMemo(() => {
    const base = Math.max(total - entrega, 0) * (1 + interes / 100);
    return cuotas > 0 ? Math.round(base / cuotas) : 0;
  }, [total, entrega, interes, cuotas]);

  function addDetalle() {
    if (!artSel) return toast.error("Selecciona un artículo");
    const cantidad = Number(artCantidad) || 0;
    const precio = Number(artPrecio.replace(/\D/g, "")) || 0;
    if (cantidad <= 0 || precio <= 0) return toast.error("Cantidad y precio deben ser mayores a 0");
    setDetalles((d) => [...d, { cod_articulo: artSel.value, cantidad, precio_unitario: precio, label: artSel.label }]);
    setArtSel(null);
    setArtCantidad("1");
    setArtPrecio("");
  }

  function addReferencia() {
    if (!refRow.nombre_apellido.trim() || !refRow.telefono.trim()) {
      return toast.error("Nombre y teléfono son obligatorios");
    }
    setReferencias((r) => [...r, refRow]);
    setRefRow({ relacion: "", telefono: "", nombre_apellido: "" });
  }

  function canAdvance(): boolean {
    if (step === 0) return !!cliente && !!ciudad && !!vendedor;
    if (step === 1) return detalles.length > 0;
    return true; // actividad y referencias son opcionales
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!cliente || !ciudad || !vendedor) return;
    setLoading(true);
    try {
      const { id } = await crearSolicitud({
        cabecera: {
          nro_solicitud: Date.now() % 1000000000,
          fecha_factura: fechaFactura,
          referencia: "",
          cod_cliente: cliente.value,
          cantidad_cuotas: cuotas,
          total,
          monto_cuota: montoCuota,
          cod_ciudad: ciudad.value,
          cod_vendedor: vendedor.value,
          fec_vencimiento_inicial: fecVencInicial || fechaFactura,
          entrega_inicial: entrega,
          porc_interes: interes,
        },
        detalles: detalles.map(({ label: _l, ...d }) => d),
        referencias,
        actividad:
          actEnabled && actProfesion && actCiudad
            ? {
                ...act,
                ingresos_mensuales: Number(act.ingresos_mensuales) || 0,
                otros_ingresos: Number(act.otros_ingresos) || 0,
                cod_profesion: actProfesion.value,
                cod_ciudad: actCiudad.value,
              }
            : undefined,
      });
      toast.success(`Solicitud #${id} registrada`);
      navigate({ to: "/solicitudes" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al registrar");
    } finally {
      setLoading(false);
    }
  }

  const CurrentIcon = STEPS[step].icon;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to="/solicitudes" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Volver
      </Link>

      <header>
        <h1 className="font-display text-3xl font-semibold">Nueva solicitud</h1>
        <p className="text-sm text-muted-foreground">Completa la información en {STEPS.length} pasos.</p>
      </header>

      {/* Stepper */}
      <Stepper step={step} onStepClick={(i) => i < step && setStep(i)} />

      <Card className="space-y-5 p-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary/15 text-secondary">
            <CurrentIcon className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-display text-lg font-semibold leading-tight">{STEPS[step].label}</h2>
            <p className="text-xs text-muted-foreground">Paso {step + 1} de {STEPS.length}</p>
          </div>
        </div>

        {/* ---------- PASO 0: CLIENTE / CABECERA ---------- */}
        {step === 0 && (
          <div className="space-y-4">
            <Field label="Cliente" required>
              <AsyncCombobox
                value={cliente?.value ?? null}
                label={cliente?.label ?? null}
                placeholder="Buscar por nombre, CI o RUC..."
                fetcher={lov.clientes}
                onSelect={(it) => setCliente({ value: it.value, label: it.label })}
                renderItem={(it) => (
                  <div className="flex flex-col">
                    <span>{it.label}</span>
                    {Boolean(it.ci ?? it.ruc) && (
                      <span className="text-xs text-muted-foreground">
                        {String(it.ci ?? it.ruc ?? "")}
                      </span>
                    )}
                  </div>
                )}
              />
              <button
                type="button"
                onClick={() => navigate({ to: "/clientes/nuevo" })}
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-secondary hover:underline"
              >
                <UserPlus className="h-3.5 w-3.5" /> Registrar cliente nuevo
              </button>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Ciudad" required>
                <AsyncCombobox
                  value={ciudad?.value ?? null}
                  label={ciudad?.label ?? null}
                  fetcher={lov.ciudades}
                  onSelect={(it) => setCiudad({ value: it.value, label: it.label })}
                />
              </Field>
              <Field label="Vendedor" required>
                <AsyncCombobox
                  value={vendedor?.value ?? null}
                  label={vendedor?.label ?? null}
                  fetcher={lov.vendedores}
                  onSelect={(it) => setVendedor({ value: it.value, label: it.label })}
                />
              </Field>
              <Field label="Fecha de factura">
                <Input type="date" value={fechaFactura} onChange={(e) => setFechaFactura(e.target.value)} />
              </Field>
              <Field label="1er vencimiento">
                <Input type="date" value={fecVencInicial} onChange={(e) => setFecVencInicial(e.target.value)} />
              </Field>
            </div>
          </div>
        )}

        {/* ---------- PASO 1: ARTÍCULOS ---------- */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="rounded-xl border border-dashed border-border p-4">
              <Field label="Artículo">
                <AsyncCombobox
                  value={artSel?.value ?? null}
                  label={artSel?.label ?? null}
                  fetcher={lov.articulos}
                  onSelect={(it) => setArtSel({ value: it.value, label: it.label })}
                />
              </Field>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <Field label="Cantidad">
                  <Input type="number" min={1} value={artCantidad} onChange={(e) => setArtCantidad(e.target.value)} inputMode="numeric" />
                </Field>
                <Field label="Precio unitario">
                  <Input type="text" value={artPrecio} onChange={(e) => setArtPrecio(fmtMiles(e.target.value))} inputMode="numeric" />
                </Field>
                <Button type="button" onClick={addDetalle} className="col-span-2 sm:col-span-1">
                  <Plus className="h-4 w-4" /> Agregar
                </Button>
              </div>
            </div>

            {detalles.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Aún no has agregado artículos.</p>
            ) : (
              <div className="space-y-2">
                {detalles.map((d, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-xl border border-border p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{d.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {d.cantidad} × {formatCurrency(d.precio_unitario)}
                      </p>
                    </div>
                    <p className="font-display font-semibold">{formatCurrency(d.cantidad * d.precio_unitario)}</p>
                    <button
                      type="button"
                      onClick={() => setDetalles((arr) => arr.filter((_, idx) => idx !== i))}
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label="Quitar"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <div className="flex items-center justify-between rounded-xl bg-muted px-4 py-3">
                  <span className="text-sm font-medium">Total</span>
                  <span className="font-display text-lg font-semibold">{formatCurrency(total)}</span>
                </div>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Cuotas">
                <select
                  value={cantidadCuotas}
                  onChange={(e) => setCantidadCuotas(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
                >
                  {[3, 6, 12, 18, 24, 36].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </Field>
              <Field label="Entrega inicial">
                <Input type="text" value={entregaInicial} onChange={(e) => setEntregaInicial(fmtMiles(e.target.value))} inputMode="numeric" />
              </Field>
              <Field label="% Interés">
                <Input type="number" min={0} step="0.01" value={porcInteres} onChange={(e) => setPorcInteres(e.target.value)} inputMode="decimal" />
              </Field>
            </div>

            {total > 0 && (
              <Card className="bg-gradient-caramel p-5 text-primary-foreground shadow-elegant">
                <p className="text-xs uppercase tracking-wider opacity-80">Cuota estimada</p>
                <p className="mt-1 font-display text-3xl font-semibold">
                  {formatCurrency(montoCuota)} <span className="text-base font-normal opacity-80">/ mes</span>
                </p>
                <p className="mt-1 text-xs opacity-80">{cuotas} cuotas · sujeto a aprobación.</p>
              </Card>
            )}
          </div>
        )}

        {/* ---------- PASO 2: ACTIVIDAD LABORAL ---------- */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-xl border border-border p-4">
              <div>
                <p className="font-medium">Incluir actividad laboral</p>
                <p className="text-xs text-muted-foreground">Opcional, pero recomendado para evaluación.</p>
              </div>
              <Switch checked={actEnabled} onCheckedChange={setActEnabled} />
            </div>

            {actEnabled && (
              <div className="space-y-4">
                <div className="flex gap-2">
                  {(["S", "N"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setAct((a) => ({ ...a, es_empleado: v }))}
                      className={cn(
                        "flex-1 rounded-xl border px-4 py-2.5 text-sm transition-colors",
                        act.es_empleado === v
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border text-muted-foreground",
                      )}
                    >
                      {v === "S" ? "Empleado" : "Independiente"}
                    </button>
                  ))}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Empresa / Negocio">
                    <Input value={act.nombre_empresa} onChange={(e) => setAct((a) => ({ ...a, nombre_empresa: e.target.value }))} />
                  </Field>
                  <Field label="Puesto / Ocupación">
                    <Input value={act.puesto_ocupado} onChange={(e) => setAct((a) => ({ ...a, puesto_ocupado: e.target.value }))} />
                  </Field>
                  <Field label="Dirección">
                    <Input value={act.direccion} onChange={(e) => setAct((a) => ({ ...a, direccion: e.target.value }))} />
                  </Field>
                  <Field label="Teléfono">
                    <Input type="tel" value={act.telefono} onChange={(e) => setAct((a) => ({ ...a, telefono: e.target.value }))} />
                  </Field>
                  <Field label="Ingresos mensuales">
                    <Input type="number" min={0} value={act.ingresos_mensuales} onChange={(e) => setAct((a) => ({ ...a, ingresos_mensuales: e.target.value }))} inputMode="numeric" />
                  </Field>
                  <Field label="Otros ingresos">
                    <Input type="number" min={0} value={act.otros_ingresos} onChange={(e) => setAct((a) => ({ ...a, otros_ingresos: e.target.value }))} inputMode="numeric" />
                  </Field>
                  <Field label="Antigüedad">
                    <Input value={act.antiguedad} onChange={(e) => setAct((a) => ({ ...a, antiguedad: e.target.value }))} placeholder="Ej: 2 años" />
                  </Field>
                  <Field label="Profesión">
                    <AsyncCombobox
                      value={actProfesion?.value ?? null}
                      label={actProfesion?.label ?? null}
                      fetcher={lov.profesiones}
                      onSelect={(it) => setActProfesion({ value: it.value, label: it.label })}
                    />
                  </Field>
                  <Field label="Ciudad laboral">
                    <AsyncCombobox
                      value={actCiudad?.value ?? null}
                      label={actCiudad?.label ?? null}
                      fetcher={lov.ciudades}
                      onSelect={(it) => setActCiudad({ value: it.value, label: it.label })}
                    />
                  </Field>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-border p-4">
                  <p className="font-medium">¿Aporta a IPS?</p>
                  <Switch
                    checked={act.aporta_ips === "S"}
                    onCheckedChange={(v) => setAct((a) => ({ ...a, aporta_ips: v ? "S" : "N" }))}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ---------- PASO 3: REFERENCIAS ---------- */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="rounded-xl border border-dashed border-border p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nombre y apellido">
                  <Input value={refRow.nombre_apellido} onChange={(e) => setRefRow((r) => ({ ...r, nombre_apellido: e.target.value }))} />
                </Field>
                <Field label="Teléfono">
                  <Input type="tel" value={refRow.telefono} onChange={(e) => setRefRow((r) => ({ ...r, telefono: e.target.value }))} />
                </Field>
                <Field label="Relación">
                  <Input value={refRow.relacion} onChange={(e) => setRefRow((r) => ({ ...r, relacion: e.target.value }))} placeholder="Ej: Familiar, Amigo" />
                </Field>
              </div>
              <Button type="button" onClick={addReferencia} className="mt-3">
                <Plus className="h-4 w-4" /> Agregar referencia
              </Button>
            </div>

            {referencias.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Sin referencias agregadas.</p>
            ) : (
              <div className="space-y-2">
                {referencias.map((r, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-xl border border-border p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{r.nombre_apellido}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.relacion && `${r.relacion} · `}{r.telefono}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setReferencias((arr) => arr.filter((_, idx) => idx !== i))}
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label="Quitar"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---------- PASO 4: RESUMEN ---------- */}
        {step === 4 && (
          <div className="space-y-4">
            <SummaryRow label="Cliente" value={cliente?.label} />
            <SummaryRow label="Ciudad / Vendedor" value={`${ciudad?.label ?? "—"} · ${vendedor?.label ?? "—"}`} />
            <SummaryRow label="Artículos" value={`${detalles.length} ítem(s)`} />
            <SummaryRow label="Total" value={formatCurrency(total)} />
            <SummaryRow label="Plan" value={`${cuotas} cuotas de ${formatCurrency(montoCuota)}`} />
            <SummaryRow label="Actividad laboral" value={actEnabled ? "Incluida" : "No incluida"} />
            <SummaryRow label="Referencias" value={`${referencias.length}`} />
          </div>
        )}
      </Card>

      {/* Navegación */}
      <div className="flex gap-3">
        {step > 0 && (
          <Button type="button" variant="outline" onClick={() => setStep((s) => s - 1)} className="flex-1">
            <ArrowLeft className="h-4 w-4" /> Atrás
          </Button>
        )}
        {step < STEPS.length - 1 ? (
          <Button
            type="button"
            onClick={() => (canAdvance() ? setStep((s) => s + 1) : toast.error("Completa los campos requeridos"))}
            className="flex-1 bg-primary text-primary-foreground hover:opacity-90"
          >
            Siguiente <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={onSubmit} disabled={loading} className="flex-1 bg-primary text-primary-foreground hover:opacity-90">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (<><Check className="h-4 w-4" /> Registrar solicitud</>)}
          </Button>
        )}
      </div>
    </div>
  );
}

function Stepper({ step, onStepClick }: { step: number; onStepClick: (i: number) => void }) {
  return (
    <div className="flex items-center">
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        const done = i < step;
        const active = i === step;
        return (
          <div key={s.key} className="flex flex-1 items-center last:flex-none">
            <button
              type="button"
              onClick={() => onStepClick(i)}
              disabled={i >= step}
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                done && "border-success bg-success text-success-foreground",
                active && "border-primary bg-primary text-primary-foreground",
                !done && !active && "border-border bg-muted text-muted-foreground",
              )}
              aria-label={s.label}
            >
              {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
            </button>
            {i < STEPS.length - 1 && (
              <div className={cn("mx-1.5 h-0.5 flex-1 rounded-full transition-colors", i < step ? "bg-success" : "bg-border")} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-3 last:border-0 last:pb-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium">{value || "—"}</span>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
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
