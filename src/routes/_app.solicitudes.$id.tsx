import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, AlertCircle, Package, Users, Briefcase, FileText, User } from "lucide-react";
import {
  obtenerCabecera,
  obtenerCliente,
  listarDetalles,
  listarReferencias,
  listarActividad,
  lovLabels,
  type Cabecera,
  type Cliente,
  type DetalleRow,
  type ReferenciaRow,
  type ActividadRow,
} from "@/lib/api";
import { formatCurrency } from "@/lib/credit-applications";
import { Card } from "@/components/ui/card";

const ESTADO_CIVIL: Record<string, string> = {
  S: "Soltero/a",
  C: "Casado/a",
  D: "Divorciado/a",
  O: "Concubinado/a",
  V: "Viudo/a",
};
const VIVIENDA: Record<string, string> = { P: "Propia", A: "Alquiler", F: "Familiar" };

type Labels = {
  articulos: Map<number, string>;
  ciudades: Map<number, string>;
  vendedores: Map<number, string>;
  profesiones: Map<number, string>;
};

export const Route = createFileRoute("/_app/solicitudes/$id")({
  head: () => ({
    meta: [{ title: "Detalle de solicitud — Créditos" }],
  }),
  component: SolicitudDetalle,
});

function SolicitudDetalle() {
  const { id } = Route.useParams();
  const sid = Number(id);

  const [cab, setCab] = useState<Cabecera | null>(null);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [detalles, setDetalles] = useState<DetalleRow[]>([]);
  const [referencias, setReferencias] = useState<ReferenciaRow[]>([]);
  const [actividad, setActividad] = useState<ActividadRow | null>(null);
  const [labels, setLabels] = useState<Labels>({
    articulos: new Map(),
    ciudades: new Map(),
    vendedores: new Map(),
    profesiones: new Map(),
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      obtenerCabecera(sid),
      listarDetalles(sid),
      listarReferencias(sid),
      listarActividad(sid),
    ])
      .then(async ([c, d, r, a]) => {
        setCab(c);
        setDetalles(d);
        setReferencias(r);
        setActividad(a[0] ?? null);
        const [cli, articulos, ciudades, vendedores, profesiones] = await Promise.all([
          obtenerCliente(c.cod_cliente).catch(() => null),
          lovLabels("articulos").catch(() => new Map<number, string>()),
          lovLabels("ciudades").catch(() => new Map<number, string>()),
          lovLabels("vendedores").catch(() => new Map<number, string>()),
          lovLabels("profesiones").catch(() => new Map<number, string>()),
        ]);
        setCliente(cli);
        setLabels({ articulos, ciudades, vendedores, profesiones });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error al cargar"))
      .finally(() => setLoading(false));
  }, [sid]);

  const nombre = cliente?.razon_social ?? (cab ? `Cliente ${cab.cod_cliente}` : "");

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-sm">Cargando solicitud...</p>
      </div>
    );
  }

  if (error || !cab) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Link to="/solicitudes" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Volver
        </Link>
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertCircle className="h-5 w-5" />
          </div>
          <p className="text-sm text-muted-foreground">{error ?? "Solicitud no encontrada"}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to="/solicitudes" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Volver
      </Link>

      {/* Encabezado */}
      <Card className="relative overflow-hidden p-6">
        <div className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-secondary/20 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-caramel text-primary-foreground shadow-elegant">
              <span className="font-display text-xl font-semibold">{nombre.charAt(0)}</span>
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-2xl font-semibold">{nombre}</h1>
                {cab.estado && (
                  <span className="rounded-full bg-secondary/15 px-2.5 py-0.5 text-[11px] font-medium text-secondary">
                    {cab.estado}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Solicitud {cab.estado === "APROBADO" ? `#${cab.nro_solicitud}` : "—"} · ID {cab.id}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-display text-2xl font-semibold tracking-tight">{formatCurrency(cab.total)}</p>
            <p className="text-sm text-muted-foreground">{cab.cantidad_cuotas} cuotas de {formatCurrency(cab.monto_cuota)}</p>
          </div>
        </div>
      </Card>

      {/* Datos del cliente */}
      <Card className="p-6">
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold">
          <User className="h-5 w-5 text-secondary" /> Datos del cliente
        </h2>
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <Row label="Razón social / Nombre" value={cliente?.razon_social} />
          <Row label="Nombre de fantasía" value={cliente?.nombre_fantasia} />
          <Row label="Cédula (CI)" value={cliente?.ci} />
          <Row label="RUC" value={cliente?.ruc} />
          <Row label="Teléfono" value={cliente?.nro_telefono} />
          <Row label="Sexo" value={cliente?.sexo === "F" ? "Femenino" : cliente?.sexo === "M" ? "Masculino" : cliente?.sexo} />
          <Row label="Estado civil" value={cliente?.estado_civil ? ESTADO_CIVIL[cliente.estado_civil] ?? cliente.estado_civil : undefined} />
          <Row label="Fecha de nacimiento" value={cliente?.fecha_nacimiento ? formatDate(cliente.fecha_nacimiento) : undefined} />
          <Row label="Ciudad" value={cliente?.cod_ciudad ? labels.ciudades.get(cliente.cod_ciudad) : undefined} />
          <Row label="Dirección" value={[cliente?.direccion, cliente?.nro_casa].filter(Boolean).join(" ")} />
          <Row label="Vivienda" value={cliente?.vivienda ? VIVIENDA[cliente.vivienda] ?? cliente.vivienda : undefined} />
        </div>
      </Card>

      {/* Datos del crédito */}
      <Card className="p-6">
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold">
          <FileText className="h-5 w-5 text-secondary" /> Datos del crédito
        </h2>
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <Row label="Ciudad" value={labels.ciudades.get(cab.cod_ciudad)} />
          <Row label="Vendedor" value={labels.vendedores.get(cab.cod_vendedor)} />
          <Row label="Fecha de factura" value={formatDate(cab.fecha_factura)} />
          <Row label="1er vencimiento" value={formatDate(cab.fec_vencimiento_inicial)} />
          <Row label="Total" value={formatCurrency(cab.total)} />
          <Row label="Entrega inicial" value={formatCurrency(cab.entrega_inicial)} />
          <Row label="Cantidad de cuotas" value={cab.cantidad_cuotas} />
          <Row label="Monto por cuota" value={formatCurrency(cab.monto_cuota)} />
          <Row label="% Interés" value={`${cab.porc_interes}%`} />
          {cab.referencia && <Row label="Referencia" value={cab.referencia} />}
        </div>
      </Card>

      {/* Artículos */}
      <Card className="p-6">
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold">
          <Package className="h-5 w-5 text-secondary" /> Artículos
          <span className="text-sm font-normal text-muted-foreground">({detalles.length})</span>
        </h2>
        {detalles.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin artículos.</p>
        ) : (
          <div className="space-y-2">
            {detalles.map((d) => (
              <div key={d.id_detalle} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{labels.articulos.get(d.cod_articulo) ?? `Artículo ${d.cod_articulo}`}</p>
                  <p className="text-xs text-muted-foreground">{d.cantidad} × {formatCurrency(d.precio_unitario)}</p>
                </div>
                <p className="font-display font-semibold">{formatCurrency(d.cantidad * d.precio_unitario)}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Actividad laboral */}
      {actividad && (
        <Card className="p-6">
          <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold">
            <Briefcase className="h-5 w-5 text-secondary" /> Actividad laboral
          </h2>
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Row label="Situación" value={actividad.es_empleado === "S" ? "Empleado" : "Independiente"} />
            <Row label="Empresa / Negocio" value={actividad.nombre_empresa} />
            <Row label="Puesto / Ocupación" value={actividad.puesto_ocupado} />
            <Row label="Profesión" value={labels.profesiones.get(actividad.cod_profesion)} />
            <Row label="Antigüedad" value={actividad.antiguedad} />
            <Row label="Ingresos mensuales" value={formatCurrency(actividad.ingresos_mensuales)} />
            <Row label="Otros ingresos" value={formatCurrency(actividad.otros_ingresos)} />
            <Row label="Dirección" value={actividad.direccion} />
            <Row label="Ciudad laboral" value={labels.ciudades.get(actividad.cod_ciudad)} />
            <Row label="Teléfono" value={actividad.telefono} />
            <Row label="Aporta IPS" value={actividad.aporta_ips === "S" ? "Sí" : "No"} />
          </div>
        </Card>
      )}

      {/* Referencias */}
      <Card className="p-6">
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold">
          <Users className="h-5 w-5 text-secondary" /> Referencias
          <span className="text-sm font-normal text-muted-foreground">({referencias.length})</span>
        </h2>
        {referencias.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin referencias.</p>
        ) : (
          <div className="space-y-2">
            {referencias.map((r) => (
              <div key={r.id_detalle} className="rounded-xl border border-border p-3">
                <p className="font-medium">{r.nombre_apellido}</p>
                <p className="text-xs text-muted-foreground">
                  {r.relacion && `${r.relacion} · `}{r.telefono}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | number }) {
  return (
    <div className="flex items-center justify-between border-b border-border/60 pb-2 sm:border-0 sm:pb-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium">{value || "—"}</span>
    </div>
  );
}

function formatDate(d?: string) {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  return date.toLocaleDateString("es-PY", { day: "2-digit", month: "short", year: "numeric" });
}
