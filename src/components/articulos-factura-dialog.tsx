import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import {
  CONDICIONES_COMPRA,
  estadoFactura,
  listarArticulosFactura,
  type ArticuloFacturaCompra,
} from "@/lib/api";
import { formatCurrency } from "@/lib/credit-applications";
import { cn, fechaPy } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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

// Lo que el modal sabe mostrar de una factura de compra. Lo cumplen
// FacturaCompra (Recibos de Proveedores), ReciboProveedorFactura (detalle de
// un recibo) y CompraPeriodo (Compras por Período). Lo opcional se muestra
// solo si viene:
//   condicion_compra  etiqueta Contado / Crédito
//   saldo (+ pagado)  estado y saldo de hoy, solo en crédito. Sin `pagado` se
//                     deduce de total − saldo (el detalle de un recibo no lo trae).
export type FacturaParaArticulos = {
  id_cabecera: number;
  referencia?: string;
  fecha?: string;
  total: number;
  proveedor?: string;
  documento?: string;
  condicion_compra?: number;
  pagado?: number;
  saldo?: number;
};

// Los artículos (COMPRAS_DETALLE) de una factura de compra. Se piden recién al
// abrir el modal: ni los listados ni el detalle del recibo los traen.
//
// Con `lista`, el modal recorre esas facturas con Anterior / Siguiente (y las
// flechas ← → del teclado), en el mismo orden en que se ven en la pantalla:
// para revisar un período no hace falta cerrar y abrir 30 veces. `onCambiar`
// recibe la factura a la que se movió.
export function ArticulosFacturaDialog<T extends FacturaParaArticulos>({
  factura,
  onClose,
  lista,
  onCambiar,
}: {
  factura: T | null;
  onClose: () => void;
  lista?: T[];
  onCambiar?: (f: T) => void;
}) {
  const [items, setItems] = useState<ArticuloFacturaCompra[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idCabecera = factura?.id_cabecera ?? null;

  useEffect(() => {
    if (idCabecera === null) return;
    // Navegando rápido, la respuesta de una factura anterior puede llegar
    // después de la actual: se descarta.
    let vigente = true;
    setLoading(true);
    setError(null);
    setItems([]);
    listarArticulosFactura(idCabecera)
      .then((r) => vigente && setItems(r))
      .catch((e) => vigente && setError(e instanceof Error ? e.message : "Error al cargar"))
      .finally(() => vigente && setLoading(false));
    return () => {
      vigente = false;
    };
  }, [idCabecera]);

  // Posición dentro de la lista, para Anterior / Siguiente.
  const navegable = !!lista && !!onCambiar && lista.length > 1;
  const pos = navegable && factura ? lista!.findIndex((f) => f.id_cabecera === factura.id_cabecera) : -1;
  const anterior = pos > 0 ? lista![pos - 1] : null;
  const siguiente = pos >= 0 && pos < lista!.length - 1 ? lista![pos + 1] : null;

  useEffect(() => {
    if (!factura || !navegable) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft" && anterior) {
        e.preventDefault();
        onCambiar!(anterior);
      } else if (e.key === "ArrowRight" && siguiente) {
        e.preventDefault();
        onCambiar!(siguiente);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [factura, navegable, anterior, siguiente, onCambiar]);

  // El ROUND va sobre la suma, no por renglón: es la misma cuenta que hace
  // Oracle para el total de la factura, así que tienen que coincidir.
  const total = Math.round(items.reduce((s, a) => s + (a.subtotal ?? 0), 0));
  const cantidad = (n?: number) => (n ?? 0).toLocaleString("es-PY");

  // La unidad sale de ARTICULOS. La columna aparece solo si el endpoint la
  // manda; y las cantidades se suman solo si todas son de la misma unidad
  // (sumar metros con unidades no dice nada).
  const conUnidad = items.some((a) => a.unidad);
  const unidades = new Set(items.map((a) => a.unidad ?? ""));
  const unidadComun = unidades.size === 1 ? [...unidades][0] : "";
  const sumaCantidad = items.reduce((s, a) => s + (a.cantidad ?? 0), 0);

  return (
    <Dialog open={factura !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader className="space-y-2 text-left">
          <div className="flex flex-wrap items-center gap-2 pr-6">
            <DialogTitle className="font-display text-xl">
              Factura {factura?.referencia || `ID ${factura?.id_cabecera ?? ""}`}
            </DialogTitle>
            {factura && <Etiquetas f={factura} />}
          </div>
          <DialogDescription>
            {[
              factura?.proveedor,
              factura?.documento && `RUC/CI ${factura.documento}`,
              fechaPy(factura?.fecha),
            ]
              .filter(Boolean)
              .join(" · ")}
          </DialogDescription>
        </DialogHeader>

        {/* Resumen: tamaño de la compra, total y, en crédito, lo que se debe hoy */}
        {factura && (
          <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl bg-muted/50 px-4 py-3">
            <p className="text-sm text-muted-foreground">
              {loading || error
                ? " "
                : `${items.length} ${items.length === 1 ? "artículo" : "artículos"}${
                    items.length > 0 && unidadComun
                      ? ` · ${cantidad(sumaCantidad)} ${unidadComun}`
                      : ""
                  }`}
            </p>
            <div className="text-right">
              <p className="font-display text-xl font-semibold tracking-tight">
                {formatCurrency(factura.total)}
              </p>
              {esCredito(factura) && factura.saldo !== undefined && factura.saldo > 0 && (
                <p className="text-xs text-muted-foreground">
                  Saldo hoy {formatCurrency(factura.saldo)}
                </p>
              )}
            </div>
          </div>
        )}

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
                  {conUnidad && <TableHead>Unid.</TableHead>}
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
                    {conUnidad && (
                      <TableCell className="text-xs text-muted-foreground">
                        {a.unidad || "—"}
                      </TableCell>
                    )}
                    <TableCell className="whitespace-nowrap text-right">
                      {formatCurrency(a.precio_unitario ?? 0)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-display font-semibold">
                      {formatCurrency(a.subtotal)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableCell colSpan={conUnidad ? 4 : 3} className="text-right font-medium">
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

        {navegable && pos >= 0 && (
          <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
            <Button
              variant="outline"
              size="sm"
              disabled={!anterior}
              onClick={() => anterior && onCambiar!(anterior)}
              className="rounded-full"
            >
              <ChevronLeft className="h-4 w-4" /> Anterior
            </Button>
            <p className="text-xs text-muted-foreground">
              Factura {pos + 1} de {lista!.length}
              <span className="ml-1.5 hidden sm:inline">· ← → para moverse</span>
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={!siguiente}
              onClick={() => siguiente && onCambiar!(siguiente)}
              className="rounded-full"
            >
              Siguiente <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Sin condición (Recibos de Proveedores) la factura es a crédito: esas
// pantallas solo listan compras a crédito.
function esCredito(f: FacturaParaArticulos) {
  return f.condicion_compra === undefined || f.condicion_compra === 2;
}

function Etiquetas({ f }: { f: FacturaParaArticulos }) {
  const base = "whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium";
  const condicion =
    f.condicion_compra !== undefined ? (
      <span
        className={cn(
          base,
          f.condicion_compra === 2 ? "bg-secondary/15 text-secondary" : "bg-muted text-muted-foreground",
        )}
      >
        {CONDICIONES_COMPRA[f.condicion_compra] ?? "—"}
      </span>
    ) : null;

  if (!esCredito(f) || f.saldo === undefined) return condicion;

  const estado = estadoFactura({
    total: f.total,
    saldo: f.saldo,
    pagado: f.pagado ?? f.total - f.saldo,
  });
  const etiqueta = {
    sin_monto: { texto: "Sin monto", clase: "bg-muted text-muted-foreground" },
    pagada: { texto: "Cancelada", clase: "bg-success/15 text-success" },
    parcial: { texto: "Pago parcial", clase: "bg-warning/20 text-warning-foreground" },
    pendiente: { texto: "Pendiente", clase: "bg-secondary/15 text-secondary" },
  }[estado];

  return (
    <>
      {condicion}
      <span className={cn(base, etiqueta.clase)}>{etiqueta.texto}</span>
    </>
  );
}
