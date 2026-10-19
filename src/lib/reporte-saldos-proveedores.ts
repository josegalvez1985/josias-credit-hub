// Reporte "Saldos de Proveedores": lo que se le debe a cada proveedor por
// facturas de compra a crédito, en hoja A4 vertical. La cara y el mecanismo
// (pestaña nueva, margen en todas las hojas, no imprime solo) son los de todos
// los reportes: ver reporte-a4.ts.
//
// Los datos salen de los endpoints de la pantalla de Recibos de Proveedores:
// GET /proveedores/facturas (con ?pendientes=S salvo en "Todos") y, cuando se
// piden los recibos, GET /proveedores/pagos.

import {
  estadoFactura,
  listarFacturasCompra,
  listarPagosFacturas,
  textoFormasPago,
  type FacturaCompra,
  type PagoFactura,
} from "./api";
import { abrirReporteA4, documentoA4, esc, fecha, gs, hoyTexto, kv } from "./reporte-a4";

// Qué entra en el reporte.
//   saldo    solo las facturas con saldo pendiente
//   recibos  esas mismas, con los recibos que ya las pagaron en parte
//   todos    todas las facturas a crédito, también las canceladas, con sus
//            recibos: el estado de cuenta completo
export type AlcanceSaldos = "saldo" | "recibos" | "todos";

export const ALCANCES: Record<
  AlcanceSaldos,
  { label: string; descripcion: string; encabezado: string }
> = {
  saldo: {
    label: "Solo saldo",
    descripcion: "Las facturas con saldo pendiente.",
    encabezado: "Solo saldo pendiente",
  },
  recibos: {
    label: "Con recibos",
    descripcion:
      "Las facturas con saldo y, debajo de cada una, los recibos que ya la pagaron en parte.",
    encabezado: "Saldo con recibos",
  },
  todos: {
    label: "Todos",
    descripcion:
      "Todas las facturas a crédito, también las canceladas, con sus recibos. Es el estado de cuenta completo.",
    encabezado: "Todas las facturas y recibos",
  },
};

export type OpcionesSaldos = {
  proveedor?: { value: number; label: string } | null; // null = todos
  alcance: AlcanceSaldos;
  // false = una línea por proveedor. Los recibos van dentro del detalle, así
  // que en el resumen no aparecen aunque el alcance los pida.
  detalle: boolean;
};

// Pagos de cada factura, por ID_CABECERA. null = el reporte no lleva recibos.
//
// agrupar, diasDesde e indexarPagos se exportan para la vista previa de la
// pantalla del reporte, que muestra lo mismo que el PDF: así no hay dos
// versiones del agrupado ni de la antigüedad.
export type PagosPorFactura = Map<number, PagoFactura[]> | null;

export function indexarPagos(lista: PagoFactura[]): Map<number, PagoFactura[]> {
  const pagos = new Map<number, PagoFactura[]>();
  for (const p of lista) {
    const deLaFactura = pagos.get(p.id_cabecera);
    if (deLaFactura) deLaFactura.push(p);
    else pagos.set(p.id_cabecera, [p]);
  }
  return pagos;
}

// Genérico para que Compras por Período (reporte-compras.ts) agrupe sus
// facturas, que además traen la condición, sin perder el tipo.
export type Grupo<T extends FacturaCompra = FacturaCompra> = {
  cod: number | null;
  nombre: string;
  documento?: string;
  facturas: T[];
  total: number;
  pagado: number;
  saldo: number;
};

// Días desde la fecha de la factura hasta hoy. Las compras no tienen
// vencimiento cargado, así que la antigüedad es lo único que dice qué deuda es
// más vieja. Se arma la fecha con los componentes locales: new Date("YYYY-MM-DD")
// sería medianoche UTC y daría un día de más.
// Lo que va en la columna Saldo cuando la factura ya no debe nada: "Cancelada"
// si se pagó, "Sin monto" si su total es 0 (no tiene artículos con precio, ver
// estadoFactura en api.ts). null = debe algo, se muestra el importe. Esas filas
// van apagadas y sin antigüedad, que ya no hay nada que mirar.
export function cierreFactura(f: FacturaCompra): string | null {
  const estado = estadoFactura(f);
  if (estado === "pagada") return "Cancelada";
  if (estado === "sin_monto") return "Sin monto";
  return null;
}

export function diasDesde(d?: string): string {
  const m = d?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const desde = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return String(Math.max(0, Math.round((hoy.getTime() - desde.getTime()) / 86_400_000)));
}

// Agrupa por proveedor: alfabético, con las facturas más viejas primero. Las
// facturas sin proveedor (hay algunas en COMPRAS_CABECERA) van al final en su
// propio grupo: también son deuda, y así se ven.
export function agrupar<T extends FacturaCompra>(facturas: T[]): Grupo<T>[] {
  const grupos = new Map<string, Grupo<T>>();
  for (const f of facturas) {
    const clave = f.cod_proveedor ? String(f.cod_proveedor) : "sin";
    let g = grupos.get(clave);
    if (!g) {
      g = {
        cod: f.cod_proveedor ?? null,
        nombre:
          f.proveedor ||
          (f.cod_proveedor ? `Proveedor ${f.cod_proveedor}` : "Sin proveedor asignado"),
        documento: f.documento,
        facturas: [],
        total: 0,
        pagado: 0,
        saldo: 0,
      };
      grupos.set(clave, g);
    }
    g.facturas.push(f);
    g.total += f.total;
    g.pagado += f.pagado;
    g.saldo += f.saldo;
  }

  const lista = [...grupos.values()];
  for (const g of lista) {
    g.facturas.sort(
      (a, b) =>
        (a.fecha ?? "9999").localeCompare(b.fecha ?? "9999") || a.id_cabecera - b.id_cabecera,
    );
  }
  return lista.sort(
    (a, b) =>
      Number(a.cod === null) - Number(b.cod === null) || a.nombre.localeCompare(b.nombre, "es"),
  );
}

// Un recibo debajo de su factura. El monto va en la columna "Pagado": los
// recibos de una factura suman lo que dice su fila.
function filaPago(p: PagoFactura): string {
  // "Efectivo + Cheque 4471"; vacío en un recibo sin pagos cargados.
  const detalle = textoFormasPago(p.formas_pago);
  return `<tr class="pago">
    <td>${esc(fecha(p.fecha))}</td>
    <td colspan="3" class="desc">Recibo N° ${esc(p.nro_recibo)}${detalle ? ` · ${esc(detalle)}` : ""}</td>
    <td class="num">${gs(p.monto_aplicado)}</td>
    <td></td>
  </tr>`;
}

function tablaDetalle(grupos: Grupo[], pagos: PagosPorFactura): string {
  const cuerpo = grupos
    .map((g) => {
      const filas = g.facturas
        .map((f) => {
          const cierre = cierreFactura(f);
          const recibos = (pagos?.get(f.id_cabecera) ?? []).map(filaPago).join("");
          return `<tr class="${cierre ? "cancelada" : ""}">
            <td>${esc(fecha(f.fecha))}</td>
            <td>${esc(f.referencia || `ID ${f.id_cabecera}`)}</td>
            <td class="num">${cierre ? "" : esc(diasDesde(f.fecha))}</td>
            <td class="num">${gs(f.total)}</td>
            <td class="num">${gs(f.pagado)}</td>
            <td class="num">${cierre ?? gs(f.saldo)}</td>
          </tr>${recibos}`;
        })
        .join("");
      const n = g.facturas.length;
      return `<tbody>
        <tr class="grupo"><td colspan="6">${esc(g.nombre)}${
          g.documento ? `<span class="doc">RUC/CI ${esc(g.documento)}</span>` : ""
        }</td></tr>
        ${filas}
        <tr class="subtotal">
          <td colspan="3">Subtotal · ${n} ${n === 1 ? "factura" : "facturas"}</td>
          <td class="num">${gs(g.total)}</td>
          <td class="num">${gs(g.pagado)}</td>
          <td class="num">${gs(g.saldo)}</td>
        </tr>
      </tbody>`;
    })
    .join("");

  return `<table class="datos">
    <thead>
      <tr class="margen"><td colspan="6"></td></tr>
      <tr>
        <th style="width:22mm">Fecha</th>
        <th>Nro. Factura</th>
        <th class="num" style="width:16mm">Días</th>
        <th class="num" style="width:30mm">Total Gs.</th>
        <th class="num" style="width:30mm">Pagado Gs.</th>
        <th class="num" style="width:30mm">Saldo Gs.</th>
      </tr>
    </thead>
    <tfoot><tr class="margen"><td colspan="6"></td></tr></tfoot>
    ${cuerpo}
  </table>`;
}

function tablaResumen(grupos: Grupo[]): string {
  const filas = grupos
    .map(
      (g) => `<tr>
        <td>${esc(g.nombre)}</td>
        <td>${esc(g.documento)}</td>
        <td class="num">${g.facturas.length}</td>
        <td class="num">${gs(g.total)}</td>
        <td class="num">${gs(g.pagado)}</td>
        <td class="num"><b>${gs(g.saldo)}</b></td>
      </tr>`,
    )
    .join("");

  return `<table class="datos">
    <thead>
      <tr class="margen"><td colspan="6"></td></tr>
      <tr>
        <th>Proveedor</th>
        <th style="width:26mm">RUC / CI</th>
        <th class="num" style="width:14mm">Fact.</th>
        <th class="num" style="width:28mm">Total Gs.</th>
        <th class="num" style="width:28mm">Pagado Gs.</th>
        <th class="num" style="width:28mm">Saldo Gs.</th>
      </tr>
    </thead>
    <tfoot><tr class="margen"><td colspan="6"></td></tr></tfoot>
    <tbody>${filas}</tbody>
  </table>`;
}

function construirHtml(
  facturas: FacturaCompra[],
  pagos: PagosPorFactura,
  op: OpcionesSaldos,
  logoUrl: string,
): string {
  const grupos = agrupar(facturas);
  const saldo = grupos.reduce((s, g) => s + g.saldo, 0);
  const pagado = grupos.reduce((s, g) => s + g.pagado, 0);
  const hoy = hoyTexto();
  const quien = op.proveedor ? op.proveedor.label : "Todos los proveedores";
  const todos = op.alcance === "todos";

  const cuerpo =
    grupos.length === 0
      ? `<div class="vacio">${
          todos
            ? "No hay facturas de compra a crédito"
            : "No hay facturas a crédito con saldo pendiente"
        }${op.proveedor ? " para este proveedor" : ""}.</div>`
      : `${op.detalle ? tablaDetalle(grupos, pagos) : tablaResumen(grupos)}
         <div class="tot">
           <span class="rot">SALDO TOTAL A PAGAR</span>
           <span class="imp">Gs. ${gs(saldo)}</span>
         </div>`;

  const resumen = todos
    ? kv("Facturas a crédito", String(facturas.length)) + kv("Total pagado", `Gs. ${gs(pagado)}`)
    : kv("Proveedores con saldo", String(grupos.length)) +
      kv("Facturas pendientes", String(facturas.length));

  const nota = [
    todos
      ? "Todas las facturas de compra a crédito, incluidas las canceladas."
      : "Facturas de compra a crédito con saldo.",
    "Saldo = total de la factura (con IVA) menos los pagos cargados en Recibos de Proveedores.",
    op.detalle ? "Días: antigüedad desde la fecha de la factura." : "",
    pagos ? "Debajo de cada factura, los recibos que la pagaron y el monto aplicado a ella." : "",
  ]
    .filter(Boolean)
    .join(" ");

  return documentoA4({
    titulo: `Saldos de Proveedores ${hoy.replace(/\//g, "-")}`,
    reporte: "Saldos de Proveedores",
    destacado: `Al ${hoy}`,
    detalles: [
      quien,
      ALCANCES[op.alcance].encabezado,
      op.detalle ? "Con detalle de facturas" : "Resumen por proveedor",
    ],
    resumen: resumen + kv("Saldo total", `Gs. ${gs(saldo)}`),
    cuerpo,
    nota,
    estilo: ESTILO_PAGOS,
    logoUrl,
  });
}

// Recibos debajo de su factura: más chicos y corridos a la derecha, para que
// se lean como parte de la factura de arriba y no como una más.
const ESTILO_PAGOS = `
  .pago td {
    font-size: 7.5pt; color: #444; padding-top: .8mm; padding-bottom: .8mm;
    border-bottom: .1mm dotted #ccc;
  }
  .pago td.desc { padding-left: 6mm; }
`;

// Abre el reporte en una pestaña nueva. Sin await antes de llamarla: la
// pestaña se abre dentro del click (ver abrirReporteA4).
export function abrirReporteSaldosProveedores(op: OpcionesSaldos): Promise<void> {
  return abrirReporteA4("Generando el reporte de saldos...", async (logoUrl) => {
    const codProveedor = op.proveedor?.value;
    const conRecibos = op.alcance !== "saldo" && op.detalle;
    const [facturas, lista] = await Promise.all([
      listarFacturasCompra({ pendientes: op.alcance !== "todos", codProveedor }),
      conRecibos ? listarPagosFacturas({ codProveedor }) : Promise.resolve(null),
    ]);

    const pagos: PagosPorFactura = lista ? indexarPagos(lista) : null;
    return construirHtml(facturas, pagos, op, logoUrl);
  });
}
