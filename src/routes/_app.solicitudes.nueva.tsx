import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
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
  listarPrecios,
  lov,
  type DetalleInput,
  type ReferenciaInput,
  type ActividadInput,
  type LovItem,
  type PrecioVenta,
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

type DetalleRow = DetalleInput & { label: string; precio_base: number };

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
  const [fecVencInicial, setFecVencInicial] = useState("");

  // ---- Detalle (artículos)
  const [detalles, setDetalles] = useState<DetalleRow[]>([]);
  const [artSel, setArtSel] = useState<{ value: number; label: string } | null>(null);
  const [artCantidad, setArtCantidad] = useState("1");

  // ---- Precios (V_PRECIOS_VENTAS): se cargan una vez y se indexan por artículo.
  const [precios, setPrecios] = useState<PrecioVenta[]>([]);
  const preciosPorArt = useMemo(() => {
    const m = new Map<number, PrecioVenta[]>();
    for (const p of precios) {
      const arr = m.get(p.cod_articulo) ?? [];
      arr.push(p);
      m.set(p.cod_articulo, arr);
    }
    return m;
  }, [precios]);

  useEffect(() => {
    listarPrecios().then(setPrecios).catch(() => {});
  }, []);

  // LOV de artículos (únicos, con precio) filtrando localmente por nombre o código.
  const fetchArticulos = useCallback(
    async (q?: string): Promise<LovItem[]> => {
      const vistos = new Map<number, string>();
      for (const p of precios) if (!vistos.has(p.cod_articulo)) vistos.set(p.cod_articulo, p.nombre_articulo);
      const term = (q ?? "").trim().toLowerCase();
      const qd = term.replace(/\D/g, "");
      return [...vistos.entries()]
        .filter(([cod, nombre]) =>
          !term || nombre.toLowerCase().includes(term) || (qd ? String(cod).includes(qd) : false),
        )
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ value, label }));
    },
    [precios],
  );

  // Filas de precio del artículo seleccionado (para autocompletar precio base).
  const filasArtSel = artSel ? preciosPorArt.get(artSel.value) ?? [] : [];
  const precioBaseArtSel = filasArtSel[0]?.precio_unitario ?? 0;

  // Opciones de cuotas/recargo de la solicitud: las define el primer artículo agregado.
  const planArt = detalles[0] ? preciosPorArt.get(detalles[0].cod_articulo) ?? [] : [];
  const opcionesCuotas = useMemo(
    () =>
      [...new Map(planArt.map((p) => [p.cantidad_cuotas, p.porcentaje])).entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([cuotas, porcentaje]) => ({ cuotas, porcentaje })),
    [planArt],
  );

  // ---- Actividad laboral (tabla detalle: se pueden cargar varias)
  type ActRow = ActividadInput & { profesionLabel: string; ciudadLabel: string };
  const ACT_VACIA = {
    es_empleado: "S",
    nombre_empresa: "",
    direccion: "",
    puesto_ocupado: "",
    ingresos_mensuales: "",
    otros_ingresos: "",
    antiguedad: "",
    telefono: "",
    aporta_ips: "N",
  };
  const [actividades, setActividades] = useState<ActRow[]>([]);
  const [act, setAct] = useState(ACT_VACIA);
  const [actProfesion, setActProfesion] = useState<{ value: number; label: string } | null>(null);
  const [actCiudad, setActCiudad] = useState<{ value: number; label: string } | null>(null);

  // ---- Referencias (guardamos el label de la relación solo para mostrar en la lista)
  type RefRow = ReferenciaInput & { relacionLabel: string };
  const [referencias, setReferencias] = useState<RefRow[]>([]);
  const [refRow, setRefRow] = useState<RefRow>({ relacion: 0, relacionLabel: "", telefono: "", nombre_apellido: "" });

  // ---- Cálculos
  const cuotas = Number(cantidadCuotas) || 1;
  const entrega = Number(entregaInicial.replace(/\D/g, "")) || 0;
  // El % de recargo lo define la cuota elegida (del plan del primer artículo).
  const interes = opcionesCuotas.find((o) => o.cuotas === cuotas)?.porcentaje ?? 0;

  // precio_unitario por línea = precio base + recargo de la cuota elegida.
  const conRecargo = (base: number) => Math.round(base * (1 + interes / 100));
  // Total calculado a partir de los artículos (con recargo, antes de entrega).
  const totalCalculado = useMemo(
    () => detalles.reduce((s, d) => s + d.cantidad * conRecargo(d.precio_base), 0),
    [detalles, interes],
  );

  // Total negociado por el vendedor. null = usa el calculado. Se resetea cuando
  // cambian los artículos o el recargo (la base ya no aplica).
  const [totalOverride, setTotalOverride] = useState<number | null>(null);
  useEffect(() => setTotalOverride(null), [detalles, interes]);

  const total = totalOverride ?? totalCalculado;
  // Factor para repartir el total negociado proporcionalmente entre las líneas.
  const factor = totalCalculado > 0 ? total / totalCalculado : 1;

  // Monto de cuota: editable o calculado
  const [montoCuotaOverride, setMontoCuotaOverride] = useState<number | null>(null);
  useEffect(() => setMontoCuotaOverride(null), [detalles, interes]);

  const montoCuotaCalculado = useMemo(() => {
    const base = Math.max(total - entrega, 0);
    return cuotas > 0 ? Math.round(base / cuotas) : 0;
  }, [total, entrega, cuotas]);

  const montoCuota = montoCuotaOverride ?? montoCuotaCalculado;

  // Cuando se edita el monto de cuota, recalcular el total
  const handleMontoCuotaChange = (newMonto: number) => {
    setMontoCuotaOverride(newMonto);
    const nuevoTotal = newMonto * cuotas + entrega;
    setTotalOverride(nuevoTotal);
  };

  // Cuando se edita el total, recalcular la cuota
  const handleTotalChange = (newTotal: number) => {
    setTotalOverride(newTotal);
    const base = Math.max(newTotal - entrega, 0);
    const nuevaCuota = cuotas > 0 ? Math.round(base / cuotas) : 0;
    setMontoCuotaOverride(nuevaCuota);
  };

  // Función para redondear hacia arriba a múltiplo de 10.000
  const redondearMonto = (monto: number) => Math.ceil(monto / 10000) * 10000;

  // Cuando hay plan de cuotas, fija la cantidad de cuotas a una opción válida.
  useEffect(() => {
    if (opcionesCuotas.length && !opcionesCuotas.some((o) => o.cuotas === cuotas)) {
      setCantidadCuotas(String(opcionesCuotas[0].cuotas));
    }
  }, [opcionesCuotas]);

  function addDetalle() {
    if (!artSel) return toast.error("Selecciona un artículo");
    const cantidad = Number(artCantidad) || 0;
    const precio = Number(precioBaseArtSel) || 0;
    if (cantidad <= 0 || precio <= 0) return toast.error("Cantidad y precio deben ser mayores a 0");
    setDetalles((d) => [...d, { cod_articulo: artSel.value, cantidad, precio_unitario: precio, precio_base: precio, label: artSel.label }]);
    setArtSel(null);
    setArtCantidad("1");
  }

  function addReferencia() {
    if (!refRow.nombre_apellido.trim() || !refRow.telefono.trim()) {
      return toast.error("Nombre y teléfono son obligatorios");
    }
    setReferencias((r) => [...r, refRow]);
    setRefRow({ relacion: 0, relacionLabel: "", telefono: "", nombre_apellido: "" });
  }

  function addActividad() {
    if (!actProfesion || !actCiudad) {
      return toast.error("Profesión y ciudad laboral son obligatorias");
    }
    setActividades((a) => [
      ...a,
      {
        ...act,
        ingresos_mensuales: Number(act.ingresos_mensuales) || 0,
        otros_ingresos: Number(act.otros_ingresos) || 0,
        cod_profesion: actProfesion.value,
        cod_ciudad: actCiudad.value,
        profesionLabel: actProfesion.label,
        ciudadLabel: actCiudad.label,
      },
    ]);
    setAct(ACT_VACIA);
    setActProfesion(null);
    setActCiudad(null);
  }

  function canAdvance(): boolean {
    if (step === 0) return !!cliente && !!ciudad && !!vendedor;
    if (step === 1) return detalles.length > 0;
    return true; // actividad y referencias son opcionales
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!cliente || !ciudad || !vendedor) return;

    // Validar cálculos
    const totalVerificacion = montoCuota * cuotas + entrega;
    if (Math.abs(totalVerificacion - total) > 100) {
      // Tolerancia de 100 por redondeos
      toast.error(`Error de cálculo: cuota × ${cuotas} + entrega ≠ total. Revisa monto de cuota o total.`);
      return;
    }

    if (total <= entrega) {
      toast.error("El total debe ser mayor a la entrega inicial");
      return;
    }

    setLoading(true);
    try {
      const { id } = await crearSolicitud({
        cabecera: {
          nro_solicitud: null,
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
          porc_interes: 0, // el recargo ya está incluido en el precio_unitario
        },
        detalles: detalles.map(({ label: _l, precio_base, ...d }) => ({
          ...d,
          precio_unitario: Math.round(conRecargo(precio_base) * factor),
        })),
        referencias: referencias.map(({ relacionLabel: _rl, ...r }) => r),
        actividades: actividades.map(({ profesionLabel: _pl, ciudadLabel: _cl, ...a }) => a),
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
                title="Cliente"
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
                  title="Ciudad"
                  value={ciudad?.value ?? null}
                  label={ciudad?.label ?? null}
                  fetcher={lov.ciudades}
                  onSelect={(it) => setCiudad({ value: it.value, label: it.label })}
                />
              </Field>
              <Field label="Vendedor" required>
                <AsyncCombobox
                  title="Vendedor"
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
                  title="Artículo"
                  value={artSel?.value ?? null}
                  label={artSel?.label ?? null}
                  fetcher={fetchArticulos}
                  onSelect={(it) => setArtSel({ value: it.value, label: it.label })}
                />
              </Field>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <Field label="Cantidad">
                  <Input type="number" min={1} value={artCantidad} onChange={(e) => setArtCantidad(e.target.value)} inputMode="numeric" />
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
                {detalles.map((d, i) => {
                  const precioUnitario = redondearMonto(conRecargo(d.precio_base) * factor);
                  const totalLinea = redondearMonto(d.cantidad * precioUnitario);
                  return (
                  <div key={i} className="flex items-start gap-3 rounded-xl border border-border p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{d.label}</p>
                      <p className="text-xs leading-snug text-muted-foreground">
                        {d.cantidad} × {formatCurrency(precioUnitario)}
                      </p>
                    </div>
                    <p className="shrink-0 whitespace-nowrap text-right font-display font-semibold">
                      {formatCurrency(totalLinea)}
                    </p>
                    <button
                      type="button"
                      onClick={() => setDetalles((arr) => arr.filter((_, idx) => idx !== i))}
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label="Quitar"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  );
                })}
                <div className="flex items-center justify-between gap-3 rounded-xl bg-muted px-4 py-3">
                  <span className="text-sm font-medium">Total</span>
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={totalOverride !== null ? totalOverride.toLocaleString("es-PY") : redondearMonto(totalCalculado).toLocaleString("es-PY")}
                      onChange={(e) => {
                        const input = e.target.value.replace(/\D/g, "");
                        if (input) {
                          handleTotalChange(Number(input));
                        } else {
                          setTotalOverride(null);
                          setMontoCuotaOverride(null);
                        }
                      }}
                      className="h-9 w-36 bg-card text-right font-display text-lg font-semibold"
                    />
                    {totalOverride !== null && (
                      <button
                        type="button"
                        onClick={() => {
                          setTotalOverride(null);
                          setMontoCuotaOverride(null);
                        }}
                        className="text-xs font-medium text-secondary hover:underline"
                      >
                        Restablecer
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Cuotas">
                <select
                  value={cantidadCuotas}
                  onChange={(e) => setCantidadCuotas(e.target.value)}
                  disabled={opcionesCuotas.length === 0}
                  className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm disabled:opacity-50"
                >
                  {opcionesCuotas.length === 0 ? (
                    <option value="">Agregá un artículo</option>
                  ) : (
                    opcionesCuotas.map((o) => (
                      <option key={o.cuotas} value={o.cuotas}>
                        {o.cuotas} cuotas
                      </option>
                    ))
                  )}
                </select>
              </Field>
              <Field label="Entrega inicial">
                <Input type="text" value={entregaInicial} onChange={(e) => setEntregaInicial(fmtMiles(e.target.value))} inputMode="numeric" />
              </Field>
            </div>

            {total > 0 && (
              <Card className="bg-gradient-caramel p-5 text-primary-foreground shadow-elegant space-y-3">
                <div>
                  <p className="text-xs uppercase tracking-wider opacity-80">Cuota estimada</p>
                  <div className="mt-2 flex items-end gap-2">
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={montoCuotaOverride !== null ? montoCuotaOverride.toLocaleString("es-PY") : redondearMonto(montoCuota).toLocaleString("es-PY")}
                      onChange={(e) => {
                        const input = e.target.value.replace(/\D/g, "");
                        if (input) {
                          handleMontoCuotaChange(Number(input));
                        }
                      }}
                      className="h-11 bg-primary/20 text-right font-display text-2xl font-semibold text-primary-foreground placeholder-primary-foreground/50"
                      placeholder="0"
                    />
                    <span className="pb-2 text-base font-normal opacity-80">/ mes</span>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs opacity-80">
                  <span>{cuotas} cuotas</span>
                  {montoCuotaOverride !== null && (
                    <button
                      type="button"
                      onClick={() => setMontoCuotaOverride(null)}
                      className="font-medium hover:opacity-100"
                    >
                      Restablecer
                    </button>
                  )}
                </div>
                <p className="text-xs opacity-80">Total con entrega: {formatCurrency(redondearMonto(total))} (entrega: {formatCurrency(redondearMonto(entrega))})</p>
              </Card>
            )}
          </div>
        )}

        {/* ---------- PASO 2: ACTIVIDAD LABORAL ---------- */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="rounded-xl border border-dashed border-border p-4 space-y-4">
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
                  <Input inputMode="numeric" value={act.ingresos_mensuales ? Number(act.ingresos_mensuales).toLocaleString("es-PY") : ""} onChange={(e) => setAct((a) => ({ ...a, ingresos_mensuales: e.target.value.replace(/\D/g, "") }))} />
                </Field>
                <Field label="Otros ingresos">
                  <Input inputMode="numeric" value={act.otros_ingresos ? Number(act.otros_ingresos).toLocaleString("es-PY") : ""} onChange={(e) => setAct((a) => ({ ...a, otros_ingresos: e.target.value.replace(/\D/g, "") }))} />
                </Field>
                <Field label="Antigüedad">
                  <Input value={act.antiguedad} onChange={(e) => setAct((a) => ({ ...a, antiguedad: e.target.value }))} placeholder="Ej: 2 años" />
                </Field>
                <Field label="Profesión">
                  <AsyncCombobox
                    title="Profesión"
                    value={actProfesion?.value ?? null}
                    label={actProfesion?.label ?? null}
                    fetcher={lov.profesiones}
                    onSelect={(it) => setActProfesion({ value: it.value, label: it.label })}
                  />
                </Field>
                <Field label="Ciudad laboral">
                  <AsyncCombobox
                    title="Ciudad laboral"
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

              <Button type="button" onClick={addActividad} className="mt-1">
                <Plus className="h-4 w-4" /> Agregar actividad
              </Button>
            </div>

            {actividades.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Sin actividades agregadas.</p>
            ) : (
              <div className="space-y-2">
                {actividades.map((a, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-xl border border-border p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{a.nombre_empresa || a.profesionLabel}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.es_empleado === "S" ? "Empleado" : "Independiente"}
                        {a.puesto_ocupado && ` · ${a.puesto_ocupado}`}
                        {a.profesionLabel && ` · ${a.profesionLabel}`}
                        {a.ingresos_mensuales ? ` · ${formatCurrency(a.ingresos_mensuales)}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActividades((arr) => arr.filter((_, idx) => idx !== i))}
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
                  <AsyncCombobox
                    title="Relación"
                    value={refRow.relacion || null}
                    label={refRow.relacionLabel || null}
                    placeholder="Seleccionar relación..."
                    fetcher={lov.relaciones}
                    onSelect={(it) => setRefRow((r) => ({ ...r, relacion: it.value, relacionLabel: it.label }))}
                  />
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
                        {r.relacionLabel && `${r.relacionLabel} · `}{r.telefono}
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
            <SummaryRow label="Total" value={formatCurrency(redondearMonto(total))} />
            <SummaryRow label="Plan" value={`${cuotas} cuotas de ${formatCurrency(redondearMonto(montoCuota))}`} />
            <SummaryRow label="Actividad laboral" value={`${actividades.length}`} />
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
