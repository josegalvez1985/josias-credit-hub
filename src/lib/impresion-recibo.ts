// Impreso "Recibo de Dinero" en hoja completa.
//
// Es la cuarta vía de impresión del recibo, y la única que NO es un ticket
// térmico. Las otras tres imprimen la tira de 58mm:
//
//   escpos.ts          Bluetooth → bytes ESC/POS
//   escpos-usb.ts      WebUSB    → los mismos bytes, otro cable
//   recibo-sistema.ts  HTML 58mm → el driver de Windows, tira térmica
//   impresion-recibo.ts (este)   → HOJA completa, formato documento
//
// El problema que resuelve: en 58mm no hay lugar para un formato. Entran ~18
// caracteres por línea, así que por más que se suba el cuerpo el recibo se lee
// como texto corrido, una línea abajo de la otra. Acá se va a hoja entera y se
// usa el MISMO sistema de layout que la solicitud y el pagaré —recuadros,
// tabla con encabezado oscuro, pares label/valor en columnas y firmas—, que es
// lo que hace que se vea como un documento y no como un ticket.
//
// El layout replica el de `impresion-solicitud.ts` a propósito: los tres
// impresos de la app tienen que salir con la misma cara. Si allá cambia la
// configuración de impresión, cambiarla acá también.
//
//   Hoja      216 × 330 mm  (OFICIO, igual que la solicitud y el pagaré)
//   Márgenes  10 mm — @page en margen CERO y el margen dibujado por el padding
//             de .hoja, para imprimir sin tocar el diálogo.
//   Tipos     Helvetica; labels 7.5pt bold, valores 9pt

import type { ReciboDetalle } from "./api";
import type { TipoRecibo } from "./escpos";

// Escapa el texto que va al HTML. Todo lo que viene de la base pasa por acá:
// el concepto y los nombres son texto libre cargado a mano.
function esc(v: unknown): string {
  if (v == null) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Separador de miles sin decimales, como el gs() de la solicitud.
function gs(n: unknown): string {
  if (n == null || n === "") return "0";
  const num = Number(n);
  if (isNaN(num)) return "0";
  return new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(num);
}

// Las fechas llegan como YYYY-MM-DD desde ORDS; el impreso las muestra
// DD/MM/YYYY.
function fecha(d?: string): string {
  if (!d) return "";
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}

// Un par label/valor de los que van en columnas.
function kv(label: string, valor: unknown): string {
  return `<div class="kv"><div class="k">${esc(label)}</div><div class="v">${esc(valor) || "—"}</div></div>`;
}

function construirHtml(d: ReciboDetalle, tipo: TipoRecibo, logoUrl: string): string {
  const cliente = d.razon_social ?? d.nombre ?? "";
  const cuota = d.cuota_texto ?? String(d.nro_cuota);
  const interes = d.total_interes ?? 0;

  // El recibo cobra la cuota más, si lo hubiera, el interés por mora. Se
  // muestran como dos renglones y un total, que es lo que permite al cliente
  // ver por qué pagó más que el monto de la cuota.
  const filas: Array<[string, number]> = [[`Cuota ${cuota}`, d.monto - interes]];
  if (interes > 0) filas.push(["Intereses por mora", interes]);

  const filasHtml = filas
    .map(
      ([concepto, importe]) =>
        `<tr><td>${esc(concepto)}</td><td class="num">${gs(importe)}</td></tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Recibo ${esc(d.nro_recibo)}</title>
<style>
  /* Hoja oficio (216 x 330 mm), MISMA configuración de impresión que la
     solicitud y el pagaré. El margen va en CERO a propósito: si se le da un
     valor, el navegador suma encima su propio margen configurable y el usuario
     tiene que corregirlo a mano en el diálogo. Con margin:0 el margen del papel
     lo dibuja el padding de .hoja, que es contenido y el navegador no toca. */
  @page { size: 216mm 330mm; margin: 0; }

  /* Imprescindible: hace que el padding de 10mm quede DENTRO de los 216x330mm
     de .hoja, en vez de sumarse al alto y desbordar a una hoja de más. */
  *, *::before, *::after { box-sizing: border-box; }

  body {
    margin: 0;
    background: #f3f4f6;
    font-family: Helvetica, Arial, sans-serif;
    font-size: 9pt;
    color: #000;
  }
  .hoja {
    width: 216mm;              /* la hoja entera; el padding hace de margen */
    min-height: 330mm;
    margin: 8mm auto;
    padding: 10mm;
    background: #fff;
    box-shadow: 0 1px 6px rgba(0,0,0,.25);
  }
  @media print {
    body { background: #fff; }
    /* Se CONSERVA el padding de 10mm: con @page en margen cero, ese padding es
       el único margen del impreso. Solo se saca lo que es de pantalla. */
    .hoja { margin: 0; box-shadow: none; }
    .noprint { display: none !important; }
    tr    { break-inside: avoid; }
    thead { display: table-header-group; }
    h2 { break-after: avoid; }
    /* Los fondos (encabezado de tabla, recuadro del total, sello de ANULADO)
       son parte del diseño: sin esto el navegador los descarta al imprimir. */
    .tot, th, .anulado { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }

  /* Encabezado */
  .head { display: flex; align-items: flex-start; gap: 4mm; }
  /* El hueco del logo se reserva con el contenedor y no con el <img>, así el
     encabezado mide lo mismo esté la imagen cargada o no. */
  .head .logo { width: 20mm; height: 20mm; flex: 0 0 20mm; }
  .head img { width: 100%; height: 100%; object-fit: contain; }
  .head .tit { flex: 1; }
  .head h1 { margin: 0; font-size: 15pt; }
  .head .sub { font-size: 9pt; margin-top: 1mm; }
  .head .der { text-align: right; font-size: 9pt; white-space: nowrap; }
  .head .der .nro { font-size: 12pt; font-weight: bold; }
  /* ORIGINAL / DUPLICADO: es el dato que dice si este papel vale como
     comprobante, así que va arriba a la derecha y recuadrado. */
  .head .der .tipo {
    display: inline-block; margin-top: 1.5mm; padding: .8mm 2.5mm;
    border: .3mm solid #000; font-size: 8pt; font-weight: bold; letter-spacing: .5px;
  }

  hr.gruesa { border: 0; border-top: .4mm solid #000; margin: 4mm 0 5mm; }
  hr.fina   { border: 0; border-top: .2mm solid #000; margin: 4mm 0; }

  h2 { font-size: 10pt; margin: 0 0 3mm; }

  /* Pares label/valor en columnas */
  .cols { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 3mm 4mm; margin-bottom: 3mm; }
  .cols.dos { grid-template-columns: 1fr 1fr; }
  .kv .k { font-size: 7.5pt; font-weight: bold; }
  .kv .v { font-size: 9pt; word-break: break-word; }

  /* Tabla del detalle */
  table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  th { background: #373737; color: #fff; text-align: left; padding: 2mm; font-weight: bold; }
  td { padding: 2mm; border-bottom: .1mm solid #ddd; }
  td.num, th.num { text-align: right; }

  /* El TOTAL, que es lo que se mira primero. Va en su propio recuadro y no
     como una fila más de la tabla, para que se despegue del detalle. */
  .tot {
    display: flex; justify-content: space-between; align-items: baseline;
    margin-top: 4mm; padding: 3mm 4mm; background: #ebebeb; border: .3mm solid #000;
  }
  .tot .rot { font-size: 10pt; font-weight: bold; letter-spacing: 1px; }
  .tot .imp { font-size: 16pt; font-weight: bold; }

  .letras { margin-top: 3mm; font-size: 9pt; }
  .letras .k { font-size: 7.5pt; font-weight: bold; }

  .concepto { margin-top: 4mm; }
  .concepto .caja {
    margin-top: 1.5mm; padding: 3mm; border: .2mm solid #999; min-height: 14mm;
    font-size: 9pt; word-break: break-word;
  }

  /* Sello de anulado: el recibo anulado NO puede confundirse con uno válido. */
  .anulado {
    margin: 4mm 0; padding: 2.5mm; border: .5mm solid #b91c1c; color: #b91c1c;
    text-align: center; font-size: 13pt; font-weight: bold; letter-spacing: 2px;
  }

  /* Firmas: dos líneas al pie, como en la solicitud. */
  .firmas {
    display: grid; grid-template-columns: 1fr 1fr; gap: 20mm;
    margin-top: 22mm; break-inside: avoid;
  }
  .firma { border-top: .3mm solid #000; padding-top: 1.5mm; text-align: center; font-size: 8pt; }

  .pie { margin-top: 8mm; font-size: 7pt; color: #787878; display: flex; justify-content: space-between; }

  /* Barra de acciones — solo en pantalla */
  .barra {
    position: sticky; top: 0; z-index: 10;
    display: flex; gap: 8px; justify-content: center; align-items: center;
    flex-wrap: wrap;
    padding: 10px; background: #fff; border-bottom: 1px solid #e5e7eb;
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
  <span class="barra-nota">
    Hoja oficio (216 × 330 mm). Imprimí directamente, sin cambiar nada.
  </span>
</div>

<div class="hoja">
  <div class="head">
    <div class="logo">${logoUrl ? `<img src="${esc(logoUrl)}" alt="">` : ""}</div>
    <div class="tit">
      <h1>JOSIAS MUEBLES</h1>
      <div class="sub">Recibo de Dinero</div>
      <div class="sub">RUC: 3829408-7 · Ruta 1 Km 21 Capiatá · Cel.: (0981) 460 091</div>
    </div>
    <div class="der">
      <div class="nro">N° ${esc(d.nro_recibo)}</div>
      <div>Fecha: ${esc(fecha(d.fecha_recibo))}</div>
      <div class="tipo">${esc(tipo)}</div>
    </div>
  </div>

  <hr class="gruesa">

  ${d.anulado === "S" ? `<div class="anulado">RECIBO ANULADO</div>` : ""}

  <h2>Datos del Cliente</h2>
  <div class="cols">
    ${kv("Cliente", cliente)}
    ${kv("CI / RUC", d.documento)}
    ${kv("Teléfono", d.nro_telefono)}
  </div>

  <hr class="fina">

  <h2>Datos del Crédito</h2>
  <div class="cols">
    ${kv("N° Solicitud", d.nro_solicitud)}
    ${kv("Cuota", cuota)}
    ${kv("Vencimiento", fecha(d.fec_vencimiento))}
  </div>
  <div class="cols">
    ${kv("Monto de la cuota", gs(d.monto_cuota))}
    ${kv("Saldo previo", gs(d.saldo_cuota))}
    ${kv("Cobrador", d.nombre_usuario ?? d.cod_usuario)}
  </div>

  <hr class="fina">

  <h2>Detalle del Pago</h2>
  <table>
    <thead>
      <tr>
        <th>Concepto</th>
        <th class="num" style="width:40mm">Importe Gs.</th>
      </tr>
    </thead>
    <tbody>${filasHtml}</tbody>
  </table>

  <div class="tot">
    <span class="rot">TOTAL RECIBIDO</span>
    <span class="imp">Gs. ${gs(d.monto)}</span>
  </div>

  ${
    d.monto_letras
      ? `<div class="letras"><div class="k">SON (GUARANÍES)</div>${esc(d.monto_letras)}</div>`
      : ""
  }

  <div class="concepto">
    <div class="k" style="font-size:7.5pt;font-weight:bold">CONCEPTO / OBSERVACIONES</div>
    <div class="caja">${esc(d.concepto)}</div>
  </div>

  <div class="firmas">
    <div class="firma">Firma del Cliente</div>
    <div class="firma">Firma del Cobrador</div>
  </div>

  <div class="pie">
    <span>Generado: ${esc(new Date().toLocaleString("es-PY"))}</span>
    <span>Recibo N° ${esc(d.nro_recibo)} · ${esc(tipo)}</span>
  </div>
</div>

</body>
</html>`;
}

// Abre el impreso en una pestaña nueva y dispara el diálogo, igual que la
// solicitud y el pagaré.
//
// Se usa document.write sobre la pestaña en vez de un blob URL a propósito:
// con blob, el logo (que es una ruta relativa de la app) no resuelve, y además
// Safari en iOS bloquea las blob: en pestaña nueva.
export function imprimirReciboDocumento(d: ReciboDetalle, tipo: TipoRecibo): void {
  // El logo se resuelve a absoluto contra el origen actual: la pestaña nueva
  // arranca en about:blank y una ruta relativa no tendría contra qué resolver.
  const logoUrl = new URL(`${import.meta.env.BASE_URL}logo.png`, window.location.origin).href;

  const win = window.open("", "_blank");
  if (!win) {
    throw new Error(
      "El navegador bloqueó la ventana emergente. Permitila para este sitio y volvé a intentar.",
    );
  }
  win.document.write(construirHtml(d, tipo, logoUrl));
  win.document.close();

  autoImprimir(win);
}

// Dispara el diálogo de impresión una sola vez, cuando la pestaña terminó de
// cargar (incluidas las imágenes: este impreso trae el logo por red y sin la
// espera la hoja sale con el hueco en blanco).
//
// El `load` puede haber pasado ya —document.write sobre una pestaña en blanco
// a veces resuelve antes de que se enganche el listener—, así que se mira
// primero el readyState. La bandera evita que salgan dos diálogos.
function autoImprimir(win: Window): void {
  let disparado = false;
  const imprimir = () => {
    if (disparado) return;
    disparado = true;
    win.focus();
    win.print();
  };

  if (win.document.readyState === "complete") imprimir();
  else win.addEventListener("load", imprimir, { once: true });
}
