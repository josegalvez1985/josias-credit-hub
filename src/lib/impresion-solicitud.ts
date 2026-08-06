// Impreso "Solicitud de Venta a Crédito" — la página 57 de APEX.
//
// Allá el PDF se arma con jsPDF + autotable dibujando por coordenadas y se
// abre con doc.output("bloburl"). Acá se genera el mismo documento como HTML
// y se abre en una pestaña nueva, que dispara el diálogo de impresión: sale
// igual en papel y desde ahí el usuario puede "Guardar como PDF" si lo quiere
// en archivo. Sin dependencias nuevas — jspdf + autotable son ~350 KB que no
// tiene sentido cargarle a una PWA que se usa mayormente en el celular.
//
// El layout replica el de APEX: mismo tamaño de hoja, mismos márgenes, mismas
// secciones y en el mismo orden. Si allá cambia, hay que replicarlo acá.
//
//   Hoja      216 × 330 mm  (OFICIO, no A4 — así está en la página 57)
//   Márgenes  12 mm
//   Tipos     Helvetica; labels 7.5pt bold, valores 9pt
//   Columnas  3, a 0 / 64 / 128 mm del margen izquierdo

import type {
  CreditoActividad,
  CreditoArticulo,
  CreditoCabecera,
  CreditoReferencia,
} from "./api";

export type DatosSolicitud = {
  cabecera: CreditoCabecera;
  articulos: CreditoArticulo[];
  actividad: CreditoActividad[];
  referencias: CreditoReferencia[];
};

// Escapa el texto que va al HTML. Todo lo que viene de la base pasa por acá:
// los nombres y direcciones son texto libre cargado a mano y un `&` suelto
// —o algo peor— no puede romper el documento.
function esc(v: unknown): string {
  if (v == null) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Separador de miles sin decimales, como el gs() de la página 57.
function gs(n: unknown): string {
  if (n == null || n === "") return "0";
  const num = Number(n);
  if (isNaN(num)) return "0";
  return new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(num);
}

// 'S'/'N' → 'Sí'/'No', como el sn() de la página 57.
function sn(v?: string): string {
  if (v === "S") return "Sí";
  if (v === "N") return "No";
  return v ?? "";
}

// Las fechas llegan como YYYY-MM-DD desde ORDS; el impreso las muestra
// DD/MM/YYYY, igual que el TO_CHAR del proceso de APEX.
function fecha(d?: string): string {
  if (!d) return "";
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}

// Un par label/valor de los que van en tres columnas.
function kv(label: string, valor: unknown): string {
  return `<div class="kv"><div class="k">${esc(label)}</div><div class="v">${esc(valor)}</div></div>`;
}

function construirHtml(d: DatosSolicitud, logoUrl: string): string {
  const c = d.cabecera;

  const filasArticulos =
    d.articulos.length === 0
      ? `<tr><td colspan="5" class="vacio">Sin artículos</td></tr>`
      : d.articulos
          .map(
            (a) => `<tr>
              <td>${esc(a.cod_articulo)}</td>
              <td>${esc(a.articulo)}</td>
              <td class="num">${gs(a.cantidad)}</td>
              <td class="num">${gs(a.precio_unitario)}</td>
              <td class="num">${gs(a.subtotal)}</td>
            </tr>`,
          )
          .join("");

  const bloquesLaboral =
    d.actividad.length === 0
      ? `<p class="vacio">Sin datos</p>`
      : d.actividad
          .map(
            (l, i) => `
            <div class="lab${i > 0 ? " sep" : ""}">
              <div class="cols">
                ${kv("¿Es empleado?", sn(l.es_empleado))}
                ${kv("Empresa", l.nombre_empresa)}
                ${kv("Cargo", l.puesto_ocupado)}
              </div>
              <div class="cols">
                ${kv("Profesión", l.profesion)}
                ${kv("Antigüedad", l.antiguedad)}
                ${kv("Aporta IPS", sn(l.aporta_ips))}
              </div>
              <div class="cols">
                ${kv("Ing. Mensuales", gs(l.ingresos_mensuales))}
                ${kv("Otros Ingresos", gs(l.otros_ingresos))}
                ${kv("Teléfono", l.telefono)}
              </div>
              <div class="cols">
                ${kv("Dirección", l.direccion)}
              </div>
            </div>`,
          )
          .join("");

  const filasReferencias =
    d.referencias.length === 0
      ? `<tr><td colspan="4" class="vacio">Sin referencias</td></tr>`
      : d.referencias
          .map(
            (r) => `<tr>
              <td>${esc(r.relacion_desc ?? r.relacion)}</td>
              <td>${esc(r.nombre_apellido)}</td>
              <td>${esc(r.telefono)}</td>
              <td class="centro">${sn(r.ind_garante)}</td>
            </tr>`,
          )
          .join("");

  const titulo = `Solicitud ${c.nro_solicitud ?? c.id}`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${esc(titulo)}</title>
<style>
  /* Hoja oficio, igual que el jsPDF de APEX: format [216, 330] en mm. */
  @page { size: 216mm 330mm; margin: 12mm; }

  /* En pantalla se simula la hoja para que la vista previa se parezca al
     papel; al imprimir, @page ya pone el margen y esto se neutraliza. */
  body {
    margin: 0;
    background: #f3f4f6;
    font-family: Helvetica, Arial, sans-serif;
    font-size: 9pt;
    color: #000;
  }
  .hoja {
    width: 192mm;              /* 216 - 12*2 de márgenes */
    min-height: 306mm;
    margin: 8mm auto;
    padding: 12mm;
    background: #fff;
    box-shadow: 0 1px 6px rgba(0,0,0,.25);
  }
  @media print {
    body { background: #fff; }
    .hoja { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; }
    .noprint { display: none !important; }
  }

  /* Encabezado */
  .head { display: flex; align-items: flex-start; gap: 4mm; }
  .head img { width: 20mm; height: 20mm; object-fit: contain; }
  .head .tit { flex: 1; }
  .head h1 { margin: 0; font-size: 15pt; }
  .head .sub { font-size: 9pt; margin-top: 1mm; }
  .head .der { text-align: right; font-size: 9pt; white-space: nowrap; }
  .head .der .nro { font-size: 12pt; font-weight: bold; }

  hr.gruesa { border: 0; border-top: .4mm solid #000; margin: 4mm 0 5mm; }
  hr.fina   { border: 0; border-top: .2mm solid #000; margin: 4mm 0; }

  h2 { font-size: 10pt; margin: 0 0 3mm; }

  /* Tres columnas de pares label/valor */
  .cols { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 3mm 4mm; margin-bottom: 3mm; }
  .kv .k { font-size: 7.5pt; font-weight: bold; }
  .kv .v { font-size: 9pt; word-break: break-word; }

  /* Tablas */
  table { width: 100%; border-collapse: collapse; font-size: 8pt; }
  th { background: #373737; color: #fff; text-align: left; padding: 1.5mm; font-weight: bold; }
  td { padding: 1.5mm; border-bottom: .1mm solid #ddd; }
  td.num, th.num { text-align: right; }
  td.centro, th.centro { text-align: center; }
  tfoot td { background: #ebebeb; font-weight: bold; text-align: right; border: 0; }
  .vacio { text-align: center; color: #666; font-style: italic; padding: 3mm; }

  .lab.sep { border-top: .1mm solid #ccc; padding-top: 3mm; margin-top: 3mm; }

  /* Firmas: dos líneas al pie, como en el PDF de APEX. Se evita que queden
     partidas entre dos páginas. */
  .firmas {
    display: grid; grid-template-columns: 1fr 1fr; gap: 20mm;
    margin-top: 18mm; break-inside: avoid;
  }
  .firma { border-top: .3mm solid #000; padding-top: 1.5mm; text-align: center; font-size: 8pt; }

  .pie { margin-top: 8mm; font-size: 7pt; color: #787878; display: flex; justify-content: space-between; }

  /* Barra de acciones — solo en pantalla */
  .barra {
    position: sticky; top: 0; z-index: 10;
    display: flex; gap: 8px; justify-content: center;
    padding: 10px; background: #fff; border-bottom: 1px solid #e5e7eb;
  }
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
</div>

<div class="hoja">
  <div class="head">
    ${logoUrl ? `<img src="${esc(logoUrl)}" alt="">` : ""}
    <div class="tit">
      <h1>JOSIAS MUEBLES</h1>
      <div class="sub">Solicitud de Venta a Crédito</div>
    </div>
    <div class="der">
      <div class="nro">N° ${esc(c.nro_solicitud ?? c.id)}</div>
      <div>Estado: ${esc(c.estado)}</div>
      <div>Fecha: ${esc(fecha(c.fecha_factura))}</div>
    </div>
  </div>

  <hr class="gruesa">

  <h2>Datos del Cliente</h2>
  <div class="cols">
    ${kv("Cliente", c.razon_social ?? c.nombre_fantasia)}
    ${kv("CI / RUC", c.documento)}
    ${kv("Ciudad", c.ciudad)}
  </div>
  <div class="cols">
    ${kv("Vendedor", c.vendedor)}
    ${kv("Teléfono", c.nro_telefono)}
    ${kv("Referencia", c.referencia)}
  </div>

  <hr class="fina">

  <h2>Condiciones de Financiación</h2>
  <div class="cols">
    ${kv("Cant. Cuotas", gs(c.cantidad_cuotas))}
    ${kv("Monto Cuota", gs(c.monto_cuota))}
    ${kv("Entrega Inicial", gs(c.entrega_inicial))}
  </div>
  <div class="cols">
    ${kv("% Interés", `${c.porc_interes ?? ""} %`)}
    ${kv("Vencimiento", fecha(c.fec_vencimiento_inicial))}
    ${kv("TOTAL", gs(c.total))}
  </div>

  <hr class="fina">

  <table>
    <thead>
      <tr>
        <th style="width:22mm">Código</th>
        <th>Artículo</th>
        <th class="num" style="width:18mm">Cant.</th>
        <th class="num" style="width:30mm">Precio Unit.</th>
        <th class="num" style="width:30mm">Subtotal</th>
      </tr>
    </thead>
    <tbody>${filasArticulos}</tbody>
    <tfoot><tr><td colspan="4">TOTAL</td><td>${gs(c.total)}</td></tr></tfoot>
  </table>

  <h2 style="margin-top:6mm">Actividad Laboral</h2>
  ${bloquesLaboral}

  <hr class="fina">

  <table>
    <thead>
      <tr>
        <th>Relación</th>
        <th>Nombre y Apellido</th>
        <th>Teléfono</th>
        <th class="centro" style="width:20mm">Garante</th>
      </tr>
    </thead>
    <tbody>${filasReferencias}</tbody>
  </table>

  <div class="firmas">
    <div class="firma">Firma del Solicitante</div>
    <div class="firma">Firma Autorizada</div>
  </div>

  <div class="pie">
    <span>Generado: ${esc(new Date().toLocaleString("es-PY"))}</span>
  </div>
</div>

</body>
</html>`;
}

// Abre el impreso en una pestaña nueva, como hace la página 57 con
// doc.output("bloburl").
//
// Se usa document.write sobre la pestaña en vez de un blob URL a propósito:
// con blob, el logo (que es una ruta relativa de la app) no resuelve, y
// además Safari en iOS bloquea las blob: en pestaña nueva.
export function imprimirSolicitud(d: DatosSolicitud): void {
  // El logo se resuelve a absoluto contra el origen actual: la pestaña nueva
  // arranca en about:blank y una ruta relativa no tendría contra qué resolver.
  const logoUrl = new URL(`${import.meta.env.BASE_URL}logo.png`, window.location.origin).href;

  const win = window.open("", "_blank");
  if (!win) {
    throw new Error(
      "El navegador bloqueó la ventana emergente. Permitila para este sitio y volvé a intentar.",
    );
  }
  win.document.write(construirHtml(d, logoUrl));
  win.document.close();
}
