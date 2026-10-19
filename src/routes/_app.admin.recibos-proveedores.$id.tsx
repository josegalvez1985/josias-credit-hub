import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  FileText,
  Loader2,
  Package,
  Receipt,
  Trash2,
  Wallet,
} from "lucide-react";
import {
  eliminarReciboProveedor,
  FORMAS_PAGO,
  obtenerReciboProveedor,
  type ReciboProveedorDetalle,
  type ReciboProveedorFactura,
} from "@/lib/api";
import { formatCurrency } from "@/lib/credit-applications";
import { fechaPy, hoyISO } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { ArticulosFacturaDialog } from "@/components/articulos-factura-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/admin/recibos-proveedores/$id")({
  component: ReciboProveedorPage,
});

function ReciboProveedorPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [recibo, setRecibo] = useState<ReciboProveedorDetalle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [verFactura, setVerFactura] = useState<ReciboProveedorFactura | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    obtenerReciboProveedor(Number(id))
      .then(setRecibo)
      .catch((e) => setError(e instanceof Error ? e.message : "Error al cargar"))
      .finally(() => setLoading(false));
  }, [id]);

  // No hay anulación: un recibo mal cargado se elimina y se vuelve a cargar.
  // El saldo de las facturas vuelve solo, porque es calculado.
  async function eliminar() {
    if (!recibo) return;
    setEliminando(true);
    try {
      await eliminarReciboProveedor(recibo.id_recibo);
      toast.success(`Recibo N° ${recibo.nro_recibo} eliminado`);
      navigate({ to: "/admin/recibos-proveedores", search: { tab: "recibos" } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo eliminar el recibo");
      setEliminando(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-sm">Cargando recibo...</p>
      </div>
    );
  }

  if (error || !recibo) {
    return (
      <div className="space-y-6">
        <Volver />
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertCircle className="h-5 w-5" />
          </div>
          <p className="max-w-sm text-sm text-muted-foreground">
            {error ?? "Recibo no encontrado."}
          </p>
        </Card>
      </div>
    );
  }

  const r = recibo;
  const hoy = hoyISO();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Volver />
        <Button
          variant="outline"
          onClick={() => setConfirmar(true)}
          disabled={eliminando}
          className="rounded-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          {eliminando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
          Eliminar recibo
        </Button>
      </div>

      <Card className="min-w-0 overflow-hidden rounded-3xl bg-gradient-caramel p-6 text-primary-foreground shadow-elegant">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider opacity-80">Recibo N° {r.nro_recibo}</p>
            <p className="mt-1 truncate font-display text-2xl font-semibold">
              {r.proveedor || `Proveedor ${r.cod_proveedor}`}
            </p>
            {r.documento && <p className="text-sm opacity-80">RUC/CI {r.documento}</p>}
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wider opacity-80">Total pagado</p>
            <p className="font-display text-3xl font-semibold tracking-tight">
              {formatCurrency(r.monto_total)}
            </p>
          </div>
        </div>
      </Card>

      <Card className="space-y-5 p-6">
        <Titulo icon={<Receipt className="h-5 w-5" />} texto="Datos del recibo" />
        <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <Row label="Fecha" value={fechaPy(r.fecha)} />
        </div>
        {r.observacion && (
          <div className="rounded-xl bg-muted px-4 py-3 text-sm">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Observación</p>
            <p className="mt-1 whitespace-pre-line">{r.observacion}</p>
          </div>
        )}
      </Card>

      <Card className="space-y-5 p-6">
        <Titulo
          icon={<Wallet className="h-5 w-5" />}
          texto="Formas de pago"
          contador={r.pagos.length}
        />
        {r.pagos.length === 0 ? (
          // Recibo anterior al 2026-10-19: la forma de pago estaba en una
          // columna de la cabecera que se borró.
          <p className="text-sm text-muted-foreground">
            Sin registrar. El recibo se cargó antes de que las formas de pago se guardaran aparte.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/60 hover:bg-muted/60">
                  <TableHead>Forma</TableHead>
                  <TableHead>Nro.</TableHead>
                  <TableHead>Emisión</TableHead>
                  <TableHead>Vencimiento</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.pagos.map((p) => {
                  const diferido = !!p.fecha_vencimiento && p.fecha_vencimiento > hoy;
                  return (
                    <TableRow key={p.id_pago}>
                      <TableCell className="font-medium">{FORMAS_PAGO[p.forma_pago] ?? p.forma_pago}</TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        {p.nro_documento || "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {p.fecha_emision ? fechaPy(p.fecha_emision) : "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {p.fecha_vencimiento ? (
                          <span className="inline-flex items-center gap-2">
                            {fechaPy(p.fecha_vencimiento)}
                            {diferido && (
                              <span className="rounded-full bg-warning/20 px-2 py-0.5 text-[11px] font-medium text-warning-foreground">
                                Diferido
                              </span>
                            )}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right font-display font-semibold">
                        {formatCurrency(p.monto)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <Card className="space-y-5 p-6">
        <Titulo
          icon={<FileText className="h-5 w-5" />}
          texto="Facturas pagadas"
          contador={r.facturas.length}
        />
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/60 hover:bg-muted/60">
                <TableHead>Fecha</TableHead>
                <TableHead>Nro. Factura</TableHead>
                <TableHead className="text-right">Total factura</TableHead>
                <TableHead className="text-right">Aplicado</TableHead>
                {/* El saldo de hoy: incluye lo que pagaron otros recibos después. */}
                <TableHead className="text-right">Saldo actual</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.facturas.map((f) => (
                <TableRow key={f.id_detalle}>
                  <TableCell className="whitespace-nowrap">{fechaPy(f.fecha)}</TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs">
                    {f.referencia || `ID ${f.id_cabecera}`}
                  </TableCell>
                  <TableCell className="text-right">{formatCurrency(f.total)}</TableCell>
                  <TableCell className="text-right font-display font-semibold">
                    {formatCurrency(f.monto_aplicado)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {f.saldo <= 0 ? "Pagada" : formatCurrency(f.saldo)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setVerFactura(f)}
                      className="gap-1.5 whitespace-nowrap text-secondary hover:bg-secondary/15 hover:text-secondary"
                    >
                      <Package className="h-4 w-4" /> Ver artículos
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <AlertDialog open={confirmar} onOpenChange={setConfirmar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar el recibo N° {r.nro_recibo}?</AlertDialogTitle>
            <AlertDialogDescription>
              {r.facturas.length === 1
                ? `La factura que paga vuelve a quedar con ${formatCurrency(r.monto_total)} más de saldo.`
                : `Las ${r.facturas.length} facturas que paga vuelven a quedar con saldo (${formatCurrency(r.monto_total)} en total).`}{" "}
              No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={eliminar}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ArticulosFacturaDialog
        factura={verFactura}
        onClose={() => setVerFactura(null)}
        lista={r.facturas}
        onCambiar={setVerFactura}
      />
    </div>
  );
}

function Volver() {
  return (
    <Link to="/admin/recibos-proveedores" search={{ tab: "recibos" }}>
      <Button variant="ghost" size="sm" className="-ml-2 gap-1.5 text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Volver a Recibos de Proveedores
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
