// Reporte "Ventas vs Pagos": lo vendido a crédito en un período contra lo
// pagado a proveedores en el mismo período. Hoja A4 vertical, misma cara y
// mecanismo que los otros reportes (reporte-a4.ts).
//
// Datos: GET /ventas-pagos/resumen (backend/ventas-pagos.sql), que trae solo
// los totales. Acá se hacen las cuentas, así la pantalla y el PDF usan las
// mismas. Decisiones de Jose (2026-10-27), detalladas en el .sql:
//
//   · Ventas: créditos otorgados (VENTAS_CABECERA) por FECHA_FACTURA. TOTAL
//     es el precio a crédito, con el interés y la entrega inicial.
//   · Pagos: recibos de proveedores por la fecha del recibo (los cheques
//     diferidos también) + compras al contado.
//   · Diferencia = ventas − pagos.

import { resumenVentasPagos, type VentasPagos } from "./api";
import { abrirReporteA4, documentoA4, esc, fecha, filaMargen, gs, kv } from "./reporte-a4";

export type TotalesVentasPagos = {
  ventas: number;
  pagos: number; // recibos + contado
  diferencia: number; // ventas − pagos
  // Parte de los recibos sin forma de pago cargada en RECIBOS_COMPRA_PAGOS
  // (recibos anteriores al 2026-10-19). 0 si el desglose cierra.
  sinRegistrar: number;
};

export function totalesVentasPagos(r: VentasPagos): TotalesVentasPagos {
  const rc = r.recibos;
  const pagos = rc.total + r.contado.total;
  return {
    ventas: r.ventas.total,
    pagos,
    diferencia: r.ventas.total - pagos,
    sinRegistrar: rc.total - (rc.efectivo + rc.transferencia + rc.cheque),
  };
}

// "12 créditos", "1 recibo".
export function cuantos(n: number, singular: string, plural: string): string {
  return `${n.toLocaleString("es-PY")} ${n === 1 ? singular : plural}`;
}

export type OpcionesVentasPagos = {
  desde: string; // YYYY-MM-DD
  hasta: string; // YYYY-MM-DD
};

function tabla(r: VentasPagos, t: TotalesVentasPagos): string {
  const rc = r.recibos;
  const fila = (concepto: string, cant: string, monto: number, clase = "") =>
    `<tr class="${clase}"><td>${esc(concepto)}</td><td class="num">${esc(cant)}</td><td class="num">${gs(monto)}</td></tr>`;
  const parte = (concepto: string, monto: number) => fila(concepto, "", monto, "parte");

  return `<table class="datos">
    <thead>
      ${filaMargen(3)}
      <tr>
        <th>Concepto</th>
        <th class="num" style="width:25mm">Cantidad</th>
        <th class="num" style="width:40mm">Monto (Gs.)</th>
      </tr>
    </thead>
    <tfoot>${filaMargen(3)}</tfoot>
    <tbody>
      <tr class="grupo"><td colspan="3">VENTAS</td></tr>
      ${fila("Créditos otorgados", cuantos(r.ventas.cantidad, "crédito", "créditos"), r.ventas.total)}
      ${parte("Entrega inicial incluida", r.ventas.entrega_inicial)}
      <tr class="subtotal"><td colspan="2">Total vendido</td><td class="num">${gs(t.ventas)}</td></tr>
    </tbody>
    <tbody>
      <tr class="grupo"><td colspan="3">PAGOS A PROVEEDORES</td></tr>
      ${fila("Recibos de proveedores", cuantos(rc.cantidad, "recibo", "recibos"), rc.total)}
      ${parte("Efectivo", rc.efectivo)}
      ${parte("Transferencia", rc.transferencia)}
      ${parte("Cheque", rc.cheque)}
      ${t.sinRegistrar !== 0 ? parte("Sin forma de pago registrada", t.sinRegistrar) : ""}
      ${fila("Compras al contado", cuantos(r.contado.cantidad, "factura", "facturas"), r.contado.total)}
      <tr class="subtotal"><td colspan="2">Total pagado</td><td class="num">${gs(t.pagos)}</td></tr>
    </tbody>
  </table>`;
}

function construirHtml(r: VentasPagos, op: OpcionesVentasPagos, logoUrl: string): string {
  const t = totalesVentasPagos(r);
  const periodo = `Del ${fecha(op.desde)} al ${fecha(op.hasta)}`;

  const cuerpo = `${tabla(r, t)}
    <div class="tot">
      <span class="rot">DIFERENCIA (VENTAS − PAGOS)</span>
      <span class="imp">Gs. ${gs(t.diferencia)}</span>
    </div>`;

  const nota = [
    "Ventas = créditos otorgados con fecha de factura dentro del período, a precio de crédito (con el interés y la entrega inicial): no es lo cobrado.",
    "Pagos = recibos de proveedores por la fecha del recibo (los cheques diferidos también) y facturas de compra al contado.",
    t.sinRegistrar !== 0
      ? `Gs. ${gs(t.sinRegistrar)} de recibos no tienen forma de pago registrada (recibos anteriores al 19/10/2026).`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return documentoA4({
    titulo: `Ventas vs pagos ${fecha(op.desde).replace(/\//g, "-")} al ${fecha(op.hasta).replace(/\//g, "-")}`,
    reporte: "Ventas vs Pagos",
    destacado: periodo,
    detalles: ["Total general del período"],
    resumen:
      kv("Total vendido", `Gs. ${gs(t.ventas)}`) +
      kv("Total pagado", `Gs. ${gs(t.pagos)}`) +
      kv("Diferencia", `Gs. ${gs(t.diferencia)}`),
    cuerpo,
    nota,
    estilo: `
      .parte td { color: #555; font-size: 8pt; }
      .parte td:first-child { padding-left: 7mm; }
    `,
    logoUrl,
  });
}

// Abre el reporte en una pestaña nueva. Sin await antes de llamarla: la
// pestaña se abre dentro del click (ver abrirReporteA4). Vuelve a consultar,
// así el PDF sale con los datos del momento.
export function abrirReporteVentasPagos(op: OpcionesVentasPagos): Promise<void> {
  return abrirReporteA4("Generando el reporte de ventas vs pagos...", async (logoUrl) => {
    const r = await resumenVentasPagos(op);
    return construirHtml(r, op, logoUrl);
  });
}
