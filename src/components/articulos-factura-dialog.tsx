import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { type ArticuloFacturaCompra, listarArticulosFactura } from "@/lib/api";
import { formatCurrency } from "@/lib/credit-applications";
import { fechaPy } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Lo justo de una factura de compra para el encabezado del modal. Lo cumplen
// FacturaCompra (listado) y ReciboProveedorFactura (detalle de un recibo).
export type FacturaParaArticulos = {
  id_cabecera: number;
  referencia?: string;
  fecha?: string;
  total: number;
  proveedor?: string;
};

// Los artículos (COMPRAS_DETALLE) de una factura de compra. Se piden recién al
// abrir el modal: ni el listado de facturas ni el detalle del recibo los traen.
export function ArticulosFacturaDialog({
  factura,
  onClose,
}: {
  factura: FacturaParaArticulos | null;
  onClose: () => void;
}) {
  const [items, setItems] = useState<ArticuloFacturaCompra[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idCabecera = factura?.id_cabecera ?? null;

  useEffect(() => {
    if (idCabecera === null) return;
    setLoading(true);
    setError(null);
    setItems([]);
    listarArticulosFactura(idCabecera)
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : "Error al cargar"))
      .finally(() => setLoading(false));
  }, [idCabecera]);

  // El ROUND va sobre la suma, no por renglón: es la misma cuenta que hace
  // Oracle para el total de la factura, así que tienen que coincidir.
  const total = Math.round(items.reduce((s, a) => s + (a.subtotal ?? 0), 0));
  const cantidad = (n?: number) => (n ?? 0).toLocaleString("es-PY");

  return (
    <Dialog open={factura !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display text-xl">
            Factura {factura?.referencia || `ID ${factura?.id_cabecera ?? ""}`}
          </DialogTitle>
          <DialogDescription>
            {[factura?.proveedor, fechaPy(factura?.fecha), `Total ${formatCurrency(factura?.total ?? 0)}`]
              .filter(Boolean)
              .join(" · ")}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Cargando artículos...
          </div>
        ) : error ? (
          <p className="py-6 text-center text-sm text-destructive">{error}</p>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            La factura no tiene artículos cargados.
          </p>
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
                {items.map((a) => (
                  <TableRow key={a.id_detalle}>
                    <TableCell className="max-w-[22rem]">
                      <p className="truncate font-medium">
                        {a.articulo || (a.cod_articulo ? `Artículo ${a.cod_articulo}` : "—")}
                      </p>
                      {a.cod_articulo != null && (
                        <p className="font-mono text-xs text-muted-foreground">
                          Cód. {a.cod_articulo}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{cantidad(a.cantidad)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {formatCurrency(a.precio_unitario ?? 0)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-display font-semibold">
                      {formatCurrency(a.subtotal)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableCell colSpan={3} className="text-right font-medium">
                    Total
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right font-display text-base font-semibold">
                    {formatCurrency(total)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
