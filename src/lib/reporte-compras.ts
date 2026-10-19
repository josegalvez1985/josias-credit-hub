// Reporte "Compras por Período": las facturas de compra, contado y crédito,
// con fecha dentro de un rango. Hoja A4 vertical, misma cara y mecanismo que
// los otros reportes (reporte-a4.ts).
//
// Datos: GET /proveedores/compras (backend/proveedores.sql). TIPO 'C' con
// MOTIVO 'C' (compra) o 'E' (entrada). Sin IVA desglosado: la base no guarda
// la tasa (decisiones de Jose, 2026-10-19).
//
// filtrarCompras, totalesCompras, saldoCompra y ordenarPorFecha se exportan
// para la vista previa de la pantalla, que muestra lo mismo que el PDF.

import { CONDICIONES_COMPRA, listarComprasPeriodo, type CompraPeriodo } from "./api";
import { abrirReporteA4, documentoA4, esc, fecha, filaMargen, gs, kv } from "./reporte-a4";
import { agrupar, cierreFactura, type Grupo } from "./reporte-saldos-proveedores";

export type CondicionFiltro = "todas" | "contado" | "credito";

export const CONDICION_FILTRO: Record<
  CondicionFiltro,
  { label: string; encabezado: string; codigo: number | null }
> = {
  todas: { label: "Todas", encabezado: "Contado y crédito", codigo: null },
  contado: { label: "Contado", encabezado: "Solo contado", codigo: 1 },
  credito: { label: "Crédito", encabezado: "Solo crédito", codigo: 2 },
};

export type OpcionesCompras = {
  desde: string; // YYYY-MM-DD
  hasta: string; // YYYY-MM-DD
  condicion: CondicionFiltro;
  proveedor?: { value: number; label: string } | null; // null = todos
  agrupar: boolean; // por proveedor con subtotales; si no, una lista por fecha
};

export function filtrarCompras(fs: CompraPeriodo[], op: OpcionesCompras): CompraPeriodo[] {
  const codigo = CONDICION_FILTRO[op.condicion].codigo;
  return fs.filter(
    (f) =>
      (codigo === null || f.condicion_compra === codigo) &&
      (!op.proveedor || f.cod_proveedor === op.proveedor.value),
  );
}

export type TotalesCompras = {
  contado: { cant: number; total: number };
  credito: { cant: number; total: number; saldo: number };
  cant: number;
  total: number;
};

export function totalesCompras(fs: CompraPeriodo[]): TotalesCompras {
  const t: TotalesCompras = {
    contado: { cant: 0, total: 0 },
    credito: { cant: 0, total: 0, saldo: 0 },
    cant: fs.length,
    total: 0,
  };
  for (const f of fs) {
    t.total += f.total;
    if (f.condicion_compra === 2) {
      t.credito.cant++;
      t.credito.total += f.total;
      t.credito.saldo += f.saldo;
    } else {
      t.contado.cant++;
      t.contado.total += f.total;
    }
  }
  return t;
}

export function nombreCondicion(c?: number): string {
  return (c && CONDICIONES_COMPRA[c]) || "—";
}

// Qué va en la columna Saldo. Contado: "—" (se pagó en el momento). Crédito:
// null si debe algo (se muestra el importe), o "Cancelada" / "Sin monto" como
// en Saldos de Proveedores.
export function saldoCompra(f: CompraPeriodo): string | null {
  if (f.condicion_compra !== 2) return "—";
  return cierreFactura(f);
}

// Facturas por fecha, en el orden del período (la vista sin agrupar). La
// agrupada usa agrupar() de Saldos de Proveedores: mismo orden y subtotales.
export function ordenarPorFecha(fs: CompraPeriodo[]): CompraPeriodo[] {
  return [...fs].sort(
    (a, b) => (a.fecha ?? "").localeCompare(b.fecha ?? "") || a.id_cabecera - b.id_cabecera,
  );
}

function celdaSaldo(f: CompraPeriodo): string {
  return saldoCompra(f) ?? gs(f.saldo);
}

function tablaLista(fs: CompraPeriodo[]): string {
  const filas = ordenarPorFecha(fs)
    .map(
      (f) => `<tr>
        <td>${esc(fecha(f.fecha))}</td>
        <td>${esc(f.referencia || `ID ${f.id_cabecera}`)}</td>
        <td>${esc(f.proveedor || "Sin proveedor")}${
          f.documento ? `<div class="doc">${esc(f.documento)}</div>` : ""
        }</td>
        <td>${esc(nombreCondicion(f.condicion_compra))}</td>
        <td class="num">${gs(f.total)}</td>
        <td class="num">${esc(celdaSaldo(f))}</td>
      </tr>`,
    )
    .join("");

  return `<table class="datos">
    <thead>
      ${filaMargen(6)}
      <tr>
        <th style="width:20mm">Fecha</th>
        <th style="width:30mm">Nro. Factura</th>
        <th>Proveedor</th>
        <th style="width:17mm">Condición</th>
        <th class="num" style="width:28mm">Total Gs.</th>
        <th class="num" style="width:26mm">Saldo Gs.</th>
      </tr>
    </thead>
    <tfoot>${filaMargen(6)}</tfoot>
    <tbody>${filas}</tbody>
  </table>`;
}

function tablaAgrupada(grupos: Grupo<CompraPeriodo>[]): string {
  const cuerpo = grupos
    .map((g) => {
      const filas = g.facturas
        .map(
          (f) => `<tr>
            <td>${esc(fecha(f.fecha))}</td>
            <td>${esc(f.referencia || `ID ${f.id_cabecera}`)}</td>
            <td>${esc(nombreCondicion(f.condicion_compra))}</td>
            <td class="num">${gs(f.total)}</td>
            <td class="num">${esc(celdaSaldo(f))}</td>
          </tr>`,
        )
        .join("");
      const n = g.facturas.length;
      return `<tbody>
        <tr class="grupo"><td colspan="5">${esc(g.nombre)}${
          g.documento ? `<span class="doc">RUC/CI ${esc(g.documento)}</span>` : ""
        }</td></tr>
        ${filas}
        <tr class="subtotal">
          <td colspan="3">Subtotal · ${n} ${n === 1 ? "factura" : "facturas"}</td>
          <td class="num">${gs(g.total)}</td>
          <td class="num">${gs(g.saldo)}</td>
        </tr>
      </tbody>`;
    })
    .join("");

  return `<table class="datos">
    <thead>
      ${filaMargen(5)}
      <tr>
        <th style="width:22mm">Fecha</th>
        <th>Nro. Factura</th>
        <th style="width:20mm">Condición</th>
        <th class="num" style="width:32mm">Total Gs.</th>
        <th class="num" style="width:30mm">Saldo Gs.</th>
      </tr>
    </thead>
    <tfoot>${filaMargen(5)}</tfoot>
    ${cuerpo}
  </table>`;
}

function construirHtml(todas: CompraPeriodo[], op: OpcionesCompras, logoUrl: string): string {
  const fs = filtrarCompras(todas, op);
  const t = totalesCompras(fs);
  const periodo = `Del ${fecha(op.desde)} al ${fecha(op.hasta)}`;
  const n = (c: number) => `${c} ${c === 1 ? "factura" : "facturas"}`;

  const cuerpo =
    fs.length === 0
      ? `<div class="vacio">No hay facturas de compra en el período${
          op.proveedor ? " para este proveedor" : ""
        }.</div>`
      : `${op.agrupar ? tablaAgrupada(agrupar(fs)) : tablaLista(fs)}
         <div class="tot">
           <span class="rot">TOTAL DEL PERÍODO · ${esc(n(t.cant)).toUpperCase()}</span>
           <span class="imp">Gs. ${gs(t.total)}</span>
         </div>`;

  const nota = [
    "Facturas de compra y entradas de mercadería con fecha dentro del período.",
    "Total = suma de los artículos de la factura, con IVA incluido.",
    "Saldo: solo en compras a crédito, total menos los pagos cargados en Recibos de Proveedores al día de hoy.",
  ].join(" ");

  return documentoA4({
    titulo: `Compras ${fecha(op.desde).replace(/\//g, "-")} al ${fecha(op.hasta).replace(/\//g, "-")}`,
    reporte: "Compras por Período",
    destacado: periodo,
    detalles: [
      op.proveedor ? op.proveedor.label : "Todos los proveedores",
      CONDICION_FILTRO[op.condicion].encabezado,
      op.agrupar ? "Agrupado por proveedor" : "Ordenado por fecha",
    ],
    resumen:
      kv(`Contado · ${n(t.contado.cant)}`, `Gs. ${gs(t.contado.total)}`) +
      kv(`Crédito · ${n(t.credito.cant)}`, `Gs. ${gs(t.credito.total)}`) +
      kv("Total del período", `Gs. ${gs(t.total)}`),
    cuerpo,
    nota,
    // El RUC/CI debajo del nombre, en la lista sin agrupar.
    estilo: `td .doc { font-size: 7pt; color: #555; margin-top: .3mm; }`,
    logoUrl,
  });
}

// Abre el reporte en una pestaña nueva. Sin await antes de llamarla: la
// pestaña se abre dentro del click (ver abrirReporteA4). Vuelve a consultar,
// así el PDF sale con los datos del momento.
export function abrirReporteCompras(op: OpcionesCompras): Promise<void> {
  return abrirReporteA4("Generando el reporte de compras...", async (logoUrl) => {
    const fs = await listarComprasPeriodo({
      desde: op.desde,
      hasta: op.hasta,
      codProveedor: op.proveedor?.value,
    });
    return construirHtml(fs, op, logoUrl);
  });
}
