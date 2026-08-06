import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Briefcase,
  CalendarClock,
  Loader2,
  Package,
  Printer,
  ScrollText,
  Users,
  AlertCircle,
} from "lucide-react";
import { obtenerCreditoCompleto, type CreditoCompleto } from "@/lib/api";
import { imprimirSolicitud } from "@/lib/impresion-solicitud";
import { imprimirPagare } from "@/lib/impresion-pagare";
import { formatCurrency } from "@/lib/credit-applications";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/admin/creditos/$id")({
  component: CreditoDetallePage,
});

// Detalle del crédito otorgado: el maestro de la página 18 con sus tres IG
// hijos, más el plan de cuotas. Solo lectura.
function CreditoDetallePage() {
  const { id } = Route.useParams();
  const [datos, setDatos] = useState<CreditoCompleto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    obtenerCreditoCompleto(Number(id))
      .then(setDatos)
      .catch((e) => setError(e instanceof Error ? e.message : "Error al cargar"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-sm">Cargando crédito...</p>
      </div>
    );
  }

  if (error || !datos) {
    return (
      <div className="space-y-6">
        <Volver />
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertCircle className="h-5 w-5" />
          </div>
          <p className="max-w-sm text-sm text-muted-foreground">{error ?? "Crédito no encontrado."}</p>
        </Card>
      </div>
    );
  }

  const { cabecera: c, articulos, actividad, referencias, cuotas } = datos;

  const totalCobrado = cuotas.reduce((s, q) => s + (q.cobrado ?? 0), 0);
  const totalSaldo = cuotas.reduce((s, q) => s + (q.saldo_cuota ?? 0), 0);

  // Réplica del botón PDF de la página 18 de APEX, que abría la página 57.
  // El impreso se abre en pestaña nueva, igual que allá.
  function imprimir() {
    try {
      imprimirSolicitud({
        cabecera: c,
        articulos,
        actividad,
        referencias,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo abrir el impreso");
    }
  }

  // El pagaré sale solo de la cabecera: monto, monto en letras, % de interés y
  // los datos del titular. No necesita los bloques hijos.
  function imprimirElPagare() {
    try {
      imprimirPagare(c);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo abrir el pagaré");
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Volver />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={imprimir} className="rounded-full">
            <Printer className="h-4 w-4" /> Imprimir solicitud
          </Button>
          <Button variant="outline" onClick={imprimirElPagare} className="rounded-full">
            <ScrollText className="h-4 w-4" /> Imprimir pagaré
          </Button>
        </div>
      </div>

      {/* Encabezado con el monto, como en el detalle de solicitudes */}
      <Card className="min-w-0 overflow-hidden rounded-3xl bg-gradient-caramel p-6 text-primary-foreground shadow-elegant">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider opacity-80">
              Solicitud N° {c.nro_solicitud}
            </p>
            <p className="mt-1 truncate font-display text-2xl font-semibold">
              {c.razon_social || `Cliente ${c.cod_cliente}`}
            </p>
            {c.documento && <p className="text-sm opacity-80">CI/RUC {c.documento}</p>}
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wider opacity-80">Total</p>
            <p className="font-display text-3xl font-semibold tracking-tight">
              {c.total != null ? formatCurrency(c.total) : "—"}
            </p>
          </div>
        </div>
      </Card>

      {/* Datos del crédito */}
      <Card className="space-y-5 p-6">
        <Titulo icon={<CalendarClock className="h-5 w-5" />} texto="Datos del crédito" />
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Row label="Fecha de factura" value={formatDate(c.fecha_factura)} />
          <Row label="Nro. de factura" value={c.referencia} />
          <Row label="Cantidad de cuotas" value={c.cantidad_cuotas} />
          <Row label="Monto de la cuota" value={money(c.monto_cuota)} />
          <Row label="Entrega inicial" value={money(c.entrega_inicial)} />
          <Row label="% Interés" value={c.porc_interes != null ? `${c.porc_interes}%` : undefined} />
          <Row label="Vencimiento inicial" value={formatDate(c.fec_vencimiento_inicial)} />
          <Row label="Ciudad" value={c.ciudad} />
          <Row label="Vendedor" value={c.vendedor} />
          {/* Viene de SOLICITUD_VENTAS_CABECERA por ID_SOLICITUD; los créditos
              viejos no tienen esa referencia y llegan sin estado. */}
          <Row label="Estado" value={c.estado} />
        </div>
      </Card>

      {/* Datos del cliente */}
      <Card className="space-y-5 p-6">
        <Titulo icon={<Users className="h-5 w-5" />} texto="Cliente" />
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Row label="Razón social" value={c.razon_social} />
          <Row label="CI / RUC" value={c.documento} />
          <Row label="Teléfono" value={c.nro_telefono} />
          <Row label="Dirección" value={c.direccion} />
          <Row label="Nro. de casa" value={c.nro_casa} />
          <Row label="Ciudad" value={c.ciudad_cliente} />
          <Row label="Estado civil" value={c.estado_civil} />
          <Row label="Fecha de nacimiento" value={formatDate(c.fecha_nacimiento)} />
        </div>
      </Card>

      {/* Artículos */}
      <Card className="space-y-5 p-6">
        <Titulo icon={<Package className="h-5 w-5" />} texto="Artículos" contador={articulos.length} />
        {articulos.length === 0 ? (
          <Vacio texto="Este crédito no tiene artículos cargados." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/60 hover:bg-muted/60">
                  <TableHead>Artículo</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead className="text-right">Precio unitario</TableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {articulos.map((a) => (
                  <TableRow key={a.id_detalle}>
                    <TableCell className="max-w-[24rem] truncate">
                      {a.articulo || `Artículo ${a.cod_articulo}`}
                    </TableCell>
                    <TableCell className="text-right">{a.cantidad ?? "—"}</TableCell>
                    <TableCell className="text-right">{money(a.precio_unitario)}</TableCell>
                    <TableCell className="text-right font-medium">{money(a.subtotal)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* Actividad laboral */}
      <Card className="space-y-5 p-6">
        <Titulo
          icon={<Briefcase className="h-5 w-5" />}
          texto="Actividad laboral"
          contador={actividad.length}
        />
        {actividad.length === 0 ? (
          <Vacio texto="Sin actividad laboral cargada." />
        ) : (
          actividad.map((a) => (
            <div
              key={a.id_detalle}
              className="grid gap-x-6 gap-y-3 rounded-xl border border-border p-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              <Row label="¿Es empleado?" value={sino(a.es_empleado)} />
              <Row label="Empresa" value={a.nombre_empresa} />
              <Row label="Cargo ocupado" value={a.puesto_ocupado} />
              <Row label="Dirección" value={a.direccion} />
              <Row label="Teléfono" value={a.telefono} />
              <Row label="Antigüedad" value={a.antiguedad} />
              <Row label="Ingresos mensuales" value={money(a.ingresos_mensuales)} />
              <Row label="Otros ingresos" value={money(a.otros_ingresos)} />
              <Row label="Profesión" value={a.profesion} />
              <Row label="Ciudad" value={a.ciudad} />
              <Row label="Aporta IPS" value={sino(a.aporta_ips)} />
            </div>
          ))
        )}
      </Card>

      {/* Referencias personales */}
      <Card className="space-y-5 p-6">
        <Titulo
          icon={<Users className="h-5 w-5" />}
          texto="Referencias personales"
          contador={referencias.length}
        />
        {referencias.length === 0 ? (
          <Vacio texto="Sin referencias cargadas." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/60 hover:bg-muted/60">
                  <TableHead>Nombre y apellido</TableHead>
                  <TableHead>Relación</TableHead>
                  <TableHead>Teléfono</TableHead>
                  <TableHead>Garante</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {referencias.map((r) => (
                  <TableRow key={r.id_detalle}>
                    <TableCell className="max-w-[20rem] truncate font-medium">
                      {r.nombre_apellido || "—"}
                    </TableCell>
                    <TableCell>{r.relacion_desc || "—"}</TableCell>
                    <TableCell>{r.telefono || "—"}</TableCell>
                    <TableCell>
                      {r.ind_garante === "S" ? (
                        <span className="rounded-full bg-secondary/15 px-2 py-0.5 text-[11px] font-medium text-secondary">
                          Garante
                        </span>
                      ) : (
                        <span className="text-muted-foreground">No</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* Plan de cuotas. No está en la página 18 de APEX: lo generan los
          triggers de VENTAS_CABECERA y sirve para ver el estado de cobranza. */}
      <Card className="space-y-5 p-6">
        <Titulo
          icon={<CalendarClock className="h-5 w-5" />}
          texto="Plan de cuotas"
          contador={cuotas.length}
        />
        {cuotas.length === 0 ? (
          <Vacio texto="Este crédito no tiene cuotas generadas." />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-muted px-4 py-3">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Cobrado</p>
                <p className="font-display text-xl font-semibold">{formatCurrency(totalCobrado)}</p>
              </div>
              <div className="rounded-xl bg-muted px-4 py-3">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Saldo pendiente</p>
                <p className="font-display text-xl font-semibold">{formatCurrency(totalSaldo)}</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/60 hover:bg-muted/60">
                    <TableHead>Cuota</TableHead>
                    <TableHead>Vencimiento</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead className="text-right">Cobrado</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cuotas.map((q) => {
                    const saldada = (q.saldo_cuota ?? 0) === 0;
                    return (
                      <TableRow key={q.nro_cuota} className={cn(saldada && "opacity-60")}>
                        <TableCell className="whitespace-nowrap font-medium">
                          {q.nro_cuota === 0 ? "Entrega inicial" : `Cuota ${q.nro_cuota}`}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{formatDate(q.fec_vencimiento)}</TableCell>
                        <TableCell className="text-right">{money(q.monto_cuota)}</TableCell>
                        <TableCell className="text-right">{money(q.cobrado)}</TableCell>
                        <TableCell className="text-right font-medium">{money(q.saldo_cuota)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function Volver() {
  return (
    <Link to="/admin/creditos">
      <Button variant="ghost" size="sm" className="-ml-2 gap-1.5 text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Volver a Solicitud de Créditos
      </Button>
    </Link>
  );
}

function Titulo({
  icon,
  texto,
  contador,
}: {
  icon: React.ReactNode;
  texto: string;
  contador?: number;
}) {
  return (
    <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
      <span className="text-secondary">{icon}</span>
      {texto}
      {contador !== undefined && (
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
          {contador}
        </span>
      )}
    </h2>
  );
}

function Row({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border/60 pb-2">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-sm font-medium">{value || "—"}</span>
    </div>
  );
}

function Vacio({ texto }: { texto: string }) {
  return <p className="py-4 text-center text-sm text-muted-foreground">{texto}</p>;
}

function money(v?: number | null) {
  return v != null ? formatCurrency(v) : undefined;
}

function sino(v?: string) {
  if (v === "S") return "Sí";
  if (v === "N") return "No";
  return undefined;
}

function formatDate(d?: string) {
  if (!d) return undefined;
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  return date.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });
}
