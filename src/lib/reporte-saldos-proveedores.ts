// Reporte "Saldos de Proveedores": lo que se le debe a cada proveedor por
// facturas de compra a crédito, en hoja A4 vertical.
//
// Sale con la misma cara que los impresos en hoja (impresion-recibo.ts es la
// referencia: logo, encabezado, tabla con encabezado oscuro, recuadro del
// total) y por el mismo mecanismo: HTML en pestaña nueva con document.write,
// y el PDF se saca con "Imprimir / Guardar PDF". Dos diferencias a propósito:
//
//   · A4 (210 × 297 mm) y no oficio, y puede ocupar VARIAS hojas. Con
//     @page en margen cero (la regla de los impresos, que además esconde la
//     URL y la fecha que agrega el navegador), el padding de .hoja solo da
//     margen arriba de la primera hoja y abajo de la última. El margen de las
//     hojas del medio lo ponen las filas .margen del thead y el tfoot, que el
//     navegador repite en cada hoja al imprimir.
//   · NO abre el diálogo de impresión solo: un reporte primero se mira.
//
// Los datos salen de los endpoints de la pantalla de Recibos de Proveedores:
// GET /proveedores/facturas (con ?pendientes=S salvo en "Todos") y, cuando se
// piden los recibos, GET /proveedores/pagos.

import {
  estadoFactura,
  FORMAS_PAGO,
  listarFacturasCompra,
  listarPagosFacturas,
  type FacturaCompra,
  type PagoFactura,
} from "./api";
import { getStoredUsername } from "./auth";

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

export type Grupo = {
  cod: number | null;
  nombre: string;
  documento?: string;
  facturas: FacturaCompra[];
  total: number;
  pagado: number;
  saldo: number;
};

// Escapa el texto que va al HTML: nombres y nros. de factura son texto libre.
function esc(v: unknown): string {
  if (v == null) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Separador de miles sin decimales.
function gs(n: unknown): string {
  const num = Number(n);
  if (n == null || n === "" || isNaN(num)) return "0";
  return new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(num);
}

// YYYY-MM-DD -> DD/MM/YYYY sin pasar por Date (ver fechaPy en utils.ts).
function fecha(d?: string): string {
  const m = d?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (d ?? "");
}

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

function hoyTexto(): string {
  return new Date().toLocaleDateString("es-PY", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// Agrupa por proveedor: alfabético, con las facturas más viejas primero. Las
// facturas sin proveedor (hay algunas en COMPRAS_CABECERA) van al final en su
// propio grupo: también son deuda, y así se ven.
export function agrupar(facturas: FacturaCompra[]): Grupo[] {
  const grupos = new Map<string, Grupo>();
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

function kv(label: string, valor: string): string {
  return `<div class="kv"><div class="k">${esc(label)}</div><div class="v">${esc(valor)}</div></div>`;
}

// Un recibo debajo de su factura. El monto va en la columna "Pagado": los
// recibos de una factura suman lo que dice su fila.
function filaPago(p: PagoFactura): string {
  const forma = p.forma_pago ? FORMAS_PAGO[p.forma_pago] : "";
  const detalle = [forma, p.nro_comprobante].filter(Boolean).join(" ");
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
  const usuario = getStoredUsername();
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

  // El <title> es el nombre que propone "Guardar como PDF".
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Saldos de Proveedores ${esc(hoy.replace(/\//g, "-"))}</title>
<style>
  /* A4 vertical, margen CERO como el resto de los impresos: si se le da un
     valor, el navegador suma su propio margen y agrega la URL y la fecha en
     los bordes. El margen real lo dibujan el padding de .hoja (primera y
     última hoja) y las filas .margen del thead/tfoot (todas las demás). */
  @page { size: A4 portrait; margin: 0; }

  *, *::before, *::after { box-sizing: border-box; }

  body {
    margin: 0;
    background: #f3f4f6;
    font-family: Helvetica, Arial, sans-serif;
    font-size: 8.5pt;
    color: #000;
  }
  .hoja {
    width: 210mm;
    margin: 8mm auto;
    padding: 10mm 12mm;
    background: #fff;
    box-shadow: 0 1px 6px rgba(0,0,0,.25);
  }
  /* Solo en pantalla: al imprimir, un alto mínimo exacto de 297mm puede
     empujar una hoja en blanco de más por redondeo. */
  @media screen { .hoja { min-height: 297mm; } }

  .margen { display: none; }
  .margen td { height: 10mm; padding: 0 !important; border: 0 !important; background: none !important; }

  @media print {
    body { background: #fff; }
    .hoja { margin: 0; box-shadow: none; }
    .noprint { display: none !important; }
    .margen { display: table-row; }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    tr { break-inside: avoid; }
    /* Los fondos son parte del diseño: sin esto el navegador los descarta. */
    th, .grupo td, .subtotal td, .tot, .resumen {
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
  }

  /* Encabezado, igual que impresion-recibo.ts */
  .head { display: flex; align-items: flex-start; gap: 4mm; }
  .head .logo { width: 20mm; height: 20mm; flex: 0 0 20mm; }
  .head img { width: 100%; height: 100%; object-fit: contain; }
  .head .tit { flex: 1; }
  .head h1 { margin: 0; font-size: 15pt; }
  .head .rep { font-size: 11pt; font-weight: bold; margin-top: 1mm; }
  .head .sub { font-size: 8.5pt; margin-top: 1mm; }
  .head .der { text-align: right; font-size: 8.5pt; white-space: nowrap; }
  .head .der .al { font-size: 11pt; font-weight: bold; }

  hr.gruesa { border: 0; border-top: .4mm solid #000; margin: 4mm 0; }

  .resumen {
    display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4mm;
    padding: 3mm 4mm; background: #f3f3f3; border: .2mm solid #bbb;
  }
  .kv .k { font-size: 7pt; font-weight: bold; text-transform: uppercase; letter-spacing: .3px; }
  .kv .v { font-size: 11pt; font-weight: bold; margin-top: .5mm; }

  table.datos { width: 100%; border-collapse: collapse; margin-top: 4mm; }
  th { background: #373737; color: #fff; text-align: left; padding: 1.8mm 2mm; font-weight: bold; }
  td { padding: 1.5mm 2mm; border-bottom: .1mm solid #ddd; vertical-align: top; }
  td.num, th.num { text-align: right; white-space: nowrap; }

  /* Detalle: una banda por proveedor y su subtotal. */
  .grupo td {
    background: #e6e6e6; font-weight: bold; font-size: 9pt;
    border-top: .3mm solid #000; border-bottom: .2mm solid #999; padding-top: 2mm;
  }
  .grupo .doc { font-weight: normal; font-size: 8pt; margin-left: 3mm; color: #333; }
  .subtotal td { font-weight: bold; background: #f7f7f7; border-bottom: .2mm solid #999; }
  .cancelada td { color: #555; }

  /* Recibos debajo de su factura: más chicos y corridos a la derecha, para
     que se lean como parte de la factura de arriba y no como una más. */
  .pago td {
    font-size: 7.5pt; color: #444; padding-top: .8mm; padding-bottom: .8mm;
    border-bottom: .1mm dotted #ccc;
  }
  .pago td.desc { padding-left: 6mm; }

  .tot {
    display: flex; justify-content: space-between; align-items: baseline;
    margin-top: 4mm; padding: 3mm 4mm; background: #ebebeb; border: .3mm solid #000;
    break-inside: avoid;
  }
  .tot .rot { font-size: 10pt; font-weight: bold; letter-spacing: 1px; }
  .tot .imp { font-size: 15pt; font-weight: bold; }

  .vacio { margin: 12mm 0; text-align: center; font-size: 11pt; color: #444; }

  .nota { margin-top: 4mm; font-size: 7.5pt; color: #555; }
  .pie { margin-top: 6mm; font-size: 7pt; color: #787878; display: flex; justify-content: space-between; }

  /* Barra de acciones — solo en pantalla */
  .barra {
    position: sticky; top: 0; z-index: 10;
    display: flex; gap: 8px; justify-content: center; align-items: center; flex-wrap: wrap;
    padding: 10px; background: #fff; border-bottom: 1px solid #e5e7eb;
    font-family: Helvetica, Arial, sans-serif;
  }
  .barra-nota { font-size: 12px; color: #57534e; }
  .barra button {
    font: inherit; font-size: 13px; padding: 8px 16px; border-radius: 999px;
    border: 1px solid #d1d5db; background: #fff; cursor: pointer;
  }
  .barra button.primario { background: #1e3a8a; border-color: #1e3a8a; color: #fff; }
</style>
</head>
<body>

<div class="barra noprint">
  <button class="primario" onclick="window.print()">Imprimir / Guardar PDF</button>
  <button onclick="window.close()">Cerrar</button>
  <span class="barra-nota">Hoja A4 vertical. Para el archivo, elegí «Guardar como PDF» en el destino.</span>
</div>

<div class="hoja">
  <div class="head">
    <div class="logo">${logoUrl ? `<img src="${esc(logoUrl)}" alt="">` : ""}</div>
    <div class="tit">
      <h1>JOSIAS MUEBLES</h1>
      <div class="rep">Saldos de Proveedores</div>
      <div class="sub">RUC: 3829408-7 · Ruta 1 Km 21 Capiatá · Cel.: (0981) 460 091</div>
    </div>
    <div class="der">
      <div class="al">Al ${esc(hoy)}</div>
      <div>${esc(quien)}</div>
      <div>${esc(ALCANCES[op.alcance].encabezado)}</div>
      <div>${op.detalle ? "Con detalle de facturas" : "Resumen por proveedor"}</div>
    </div>
  </div>

  <hr class="gruesa">

  <div class="resumen">
    ${resumen}
    ${kv("Saldo total", `Gs. ${gs(saldo)}`)}
  </div>

  ${cuerpo}

  <div class="nota">${esc(nota)}</div>

  <div class="pie">
    <span>Generado: ${esc(new Date().toLocaleString("es-PY"))}${usuario ? ` · ${esc(usuario)}` : ""}</span>
    <span>Josias Muebles · Administración</span>
  </div>
</div>

</body>
</html>`;
}

const CARGANDO = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Generando reporte...</title></head>
<body style="font-family:Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#555">
Generando el reporte de saldos...</body></html>`;

// Abre el reporte en una pestaña nueva.
//
// La pestaña se abre YA, dentro del click, y se llena cuando llegan los datos.
// Si se abriera después del await, el bloqueador de ventanas emergentes la
// frena cuando la consulta tarda (el navegador deja de considerarla una acción
// del usuario). Si la consulta falla, la pestaña se cierra y el error sube.
//
// document.write y no blob URL, como los demás impresos: con blob el logo no
// resuelve (ver impresion-recibo.ts).
export async function abrirReporteSaldosProveedores(op: OpcionesSaldos): Promise<void> {
  const logoUrl = new URL(`${import.meta.env.BASE_URL}logo.png`, window.location.origin).href;

  const win = window.open("", "_blank");
  if (!win) {
    throw new Error(
      "El navegador bloqueó la ventana emergente. Permitila para este sitio y volvé a intentar.",
    );
  }
  win.document.write(CARGANDO);
  win.document.close();

  try {
    const codProveedor = op.proveedor?.value;
    const conRecibos = op.alcance !== "saldo" && op.detalle;
    const [facturas, lista] = await Promise.all([
      listarFacturasCompra({ pendientes: op.alcance !== "todos", codProveedor }),
      conRecibos ? listarPagosFacturas({ codProveedor }) : Promise.resolve(null),
    ]);

    const pagos: PagosPorFactura = lista ? indexarPagos(lista) : null;

    win.document.open();
    win.document.write(construirHtml(facturas, pagos, op, logoUrl));
    win.document.close();
    win.focus();
  } catch (e) {
    win.close();
    throw e;
  }
}
