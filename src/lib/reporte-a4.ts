// Piezas comunes de los reportes en hoja A4 vertical (Administración →
// Reportes). Todos salen con la misma cara —la de los impresos en hoja,
// impresion-recibo.ts es la referencia: logo, encabezado, tabla con
// encabezado oscuro, recuadro del total— y por el mismo mecanismo: HTML en
// pestaña nueva con document.write, y el PDF se saca con "Imprimir / Guardar
// PDF".
//
// Dos diferencias con los impresos, a propósito:
//
//   · A4 (210 × 297 mm) y no oficio, y puede ocupar VARIAS hojas. Con
//     @page en margen cero (la regla de los impresos, que además esconde la
//     URL y la fecha que agrega el navegador), el padding de .hoja solo da
//     margen arriba de la primera hoja y abajo de la última. El margen de las
//     hojas del medio lo ponen las filas .margen del thead y el tfoot, que el
//     navegador repite en cada hoja al imprimir. Toda tabla de datos lleva
//     las dos (ver filaMargen).
//   · NO abre el diálogo de impresión solo: un reporte primero se mira.

import { getStoredUsername } from "./auth";

// Escapa el texto que va al HTML: nombres y nros. de factura son texto libre.
export function esc(v: unknown): string {
  if (v == null) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Separador de miles sin decimales.
export function gs(n: unknown): string {
  const num = Number(n);
  if (n == null || n === "" || isNaN(num)) return "0";
  return new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(num);
}

// YYYY-MM-DD -> DD/MM/YYYY sin pasar por Date (ver fechaPy en utils.ts).
export function fecha(d?: string): string {
  const m = d?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (d ?? "");
}

export function hoyTexto(): string {
  return new Date().toLocaleDateString("es-PY", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// Un dato del recuadro de resumen de arriba.
export function kv(label: string, valor: string): string {
  return `<div class="kv"><div class="k">${esc(label)}</div><div class="v">${esc(valor)}</div></div>`;
}

// La fila de 10 mm que da margen a las hojas del medio. Va en el thead y en el
// tfoot de cada tabla de datos, con el colspan de la tabla.
export function filaMargen(columnas: number): string {
  return `<tr class="margen"><td colspan="${columnas}"></td></tr>`;
}

// Estilo común. Cada reporte puede sumar el suyo (ver documentoA4).
const ESTILO = `
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
`;

export type DocumentoA4 = {
  titulo: string; // <title>: el nombre que propone "Guardar como PDF"
  reporte: string; // nombre del reporte, debajo de JOSIAS MUEBLES
  destacado: string; // primera línea de la derecha, en grande ("Al 19/10/2026")
  detalles: string[]; // las líneas de abajo, a la derecha
  resumen: string; // contenido del recuadro gris: kv(...) × 3
  cuerpo: string; // tablas y total
  nota: string;
  estilo?: string; // CSS propio del reporte, se suma al común
  logoUrl: string;
};

export function documentoA4(d: DocumentoA4): string {
  const usuario = getStoredUsername();
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${esc(d.titulo)}</title>
<style>${ESTILO}${d.estilo ?? ""}</style>
</head>
<body>

<div class="barra noprint">
  <button class="primario" onclick="window.print()">Imprimir / Guardar PDF</button>
  <button onclick="window.close()">Cerrar</button>
  <span class="barra-nota">Hoja A4 vertical. Para el archivo, elegí «Guardar como PDF» en el destino.</span>
</div>

<div class="hoja">
  <div class="head">
    <div class="logo">${d.logoUrl ? `<img src="${esc(d.logoUrl)}" alt="">` : ""}</div>
    <div class="tit">
      <h1>JOSIAS MUEBLES</h1>
      <div class="rep">${esc(d.reporte)}</div>
      <div class="sub">RUC: 3829408-7 · Ruta 1 Km 21 Capiatá · Cel.: (0981) 460 091</div>
    </div>
    <div class="der">
      <div class="al">${esc(d.destacado)}</div>
      ${d.detalles.map((l) => `<div>${esc(l)}</div>`).join("\n      ")}
    </div>
  </div>

  <hr class="gruesa">

  <div class="resumen">
    ${d.resumen}
  </div>

  ${d.cuerpo}

  <div class="nota">${esc(d.nota)}</div>

  <div class="pie">
    <span>Generado: ${esc(new Date().toLocaleString("es-PY"))}${usuario ? ` · ${esc(usuario)}` : ""}</span>
    <span>Josias Muebles · Administración</span>
  </div>
</div>

</body>
</html>`;
}

function cargando(mensaje: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Generando reporte...</title></head>
<body style="font-family:Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#555">
${esc(mensaje)}</body></html>`;
}

// Abre un reporte en una pestaña nueva. `generar` pide los datos y devuelve el
// HTML (con documentoA4); recibe la URL absoluta del logo.
//
// La pestaña se abre YA, dentro del click, y se llena cuando llegan los datos.
// Si se abriera después del await, el bloqueador de ventanas emergentes la
// frena cuando la consulta tarda (el navegador deja de considerarla una acción
// del usuario). Por eso quien llame NO tiene que hacer ningún await antes. Si
// la consulta falla, la pestaña se cierra y el error sube.
//
// document.write y no blob URL, como los demás impresos: con blob el logo no
// resuelve (ver impresion-recibo.ts).
export async function abrirReporteA4(
  mensajeCargando: string,
  generar: (logoUrl: string) => Promise<string>,
): Promise<void> {
  const logoUrl = new URL(`${import.meta.env.BASE_URL}logo.png`, window.location.origin).href;

  const win = window.open("", "_blank");
  if (!win) {
    throw new Error(
      "El navegador bloqueó la ventana emergente. Permitila para este sitio y volvé a intentar.",
    );
  }
  win.document.write(cargando(mensajeCargando));
  win.document.close();

  try {
    const html = await generar(logoUrl);
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
  } catch (e) {
    win.close();
    throw e;
  }
}
