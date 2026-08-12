// Impresión del recibo por el diálogo de impresión del sistema.
//
// Es la tercera vía, y la que NO necesita configurar nada:
//
//   escpos.ts       Bluetooth  → bytes ESC/POS directos a la impresora
//   escpos-usb.ts   WebUSB     → bytes ESC/POS, pero exige WinUSB/Zadig en Windows
//   recibo-sistema.ts (este)   → HTML + window.print(), habla con el driver normal
//
// El problema que resuelve: en Windows la térmica USB la reclama `usbprint.sys`
// y WebUSB no puede tomar la interfaz ("Access denied"). La salida clásica es
// reemplazar el driver con Zadig, pero eso deja la impresora inutilizable para
// el resto del sistema y pide permisos de administrador.
//
// Acá se va por el otro lado: si Windows ya tiene la impresora instalada y
// funcionando, se la usa TAL CUAL, mandándole una página de impresión normal.
// El driver se encarga del ESC/POS. Sin Zadig, sin drivers, sin administrador.
//
// A cambio se pierde el control fino del ESC/POS (el corte de papel y el avance
// los maneja el driver) y aparece el diálogo de impresión. Por eso no reemplaza
// al Bluetooth: es el plan B para el puesto fijo con impresora por cable.

import type { DatosTicket, TipoRecibo } from "./escpos";

// Ancho del papel térmico. 58mm es el rollo más común en la calle; 80mm el de
// mostrador. El contenido usa todo el ancho menos un margen mínimo, porque el
// área imprimible real siempre es un poco menor que el papel.
export type AnchoPapel = 58 | 80;

// Alto de la hoja, en mm. Ver el comentario del @page: con alto "auto" el
// driver térmico corta el ticket a mitad de camino, así que se declara fijo.
// 150mm entra un recibo completo con aire de sobra (el de la foto medía ~85mm
// hasta la firma). Al ser rollo continuo, pasarse solo gasta papel en blanco;
// quedarse corto vuelve a cortar el contenido, que es el error caro.
const ALTO_HOJA = 150;

function esc(v: unknown): string {
  if (v == null) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Una fila "etiqueta: valor" del cuerpo del ticket.
function fila(label: string, valor: unknown): string {
  if (valor == null || valor === "") return "";
  return `<div class="f"><span class="l">${esc(label)}</span><span class="v">${esc(valor)}</span></div>`;
}

function construirHtml(d: DatosTicket, tipo: TipoRecibo, ancho: AnchoPapel): string {
  // 4mm de margen a cada lado: por debajo de eso muchas térmicas cortan el
  // borde, porque el área imprimible es menor que el papel.
  const margen = 4;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Recibo ${esc(d.nroRecibo)}</title>
<style>
  /* Alto FIJO, no "auto".
     Con "size: ${ancho}mm auto" el driver de la térmica no sabe dónde termina
     la página: asume un alto propio, imprime hasta ahí y descarta el resto. El
     síntoma era un ticket que se cortaba después de "Son: ..." —sin el
     cobrador ni la firma— y que además amontonaba las primeras líneas. Subir
     el margen inferior no lo arreglaba, porque lo que faltaba nunca llegaba a
     salir del navegador.
     Por eso la hoja se declara con una altura concreta y holgada: el rollo es
     continuo, así que lo que sobra es papel en blanco, no una hoja extra.
     Margen CERO por el mismo motivo que los otros impresos: si @page declara
     un margen, el navegador lo recalcula y el usuario tiene que corregirlo. */
  @page { size: ${ancho}mm ${ALTO_HOJA}mm; margin: 0; }

  *, *::before, *::after { box-sizing: border-box; }

  body {
    margin: 0;
    padding: ${margen}mm;
    width: ${ancho}mm;
    background: #fff;
    color: #000;
    /* Monoespaciada: el ticket térmico se lee en columnas y así los importes
       quedan alineados, como en el ESC/POS. */
    font-family: "Courier New", monospace;
    font-size: 9pt;
    line-height: 1.25;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .c { text-align: center; }
  .b { font-weight: bold; }
  .g { font-size: 12pt; font-weight: bold; }

  .emp { font-size: 11pt; font-weight: bold; letter-spacing: .5px; }
  .tipo { margin-top: 1mm; font-size: 10pt; font-weight: bold; }

  hr { border: 0; border-top: 1px dashed #000; margin: 2mm 0; }

  /* Etiqueta a la izquierda, valor a la derecha, con el valor cortando si es
     largo (los nombres vienen como "CI + razón social" y desbordan). */
  .f { display: flex; gap: 2mm; margin-bottom: .8mm; }
  .f .l { flex: 0 0 auto; }
  .f .v { flex: 1 1 auto; min-width: 0; text-align: right; word-break: break-word; }

  .letras { margin-top: 1.5mm; font-size: 8pt; word-break: break-word; }

  /* Que ninguna sección se parta al medio si el driver decide cortar antes de
     tiempo. No arregla el corte —para eso está .fin— pero decide DÓNDE cae:
     mejor que se vaya un bloque entero al papel siguiente y no media línea. */
  .f, .letras { break-inside: avoid; page-break-inside: avoid; }

  /* Espacio en blanco al pie, para cortar el papel sin comerse las últimas
     líneas. Antes acá iba la firma del cobrador; al sacarla, este colchón toma
     su lugar y queda todo el tramo libre para el tirón contra la barra.

     Va con min-height (no height) y con líneas en blanco reales adentro: un
     div vacío al final del body lo puede colapsar el navegador al paginar,
     y entonces el espacio no se reserva y el corte vuelve a comerse texto.
     Con contenido adentro, el tramo existe sí o sí.

     40mm ≈ 4cm de rollo. Es a propósito más de lo que hay entre el cabezal y
     la barra dentada: papel en blanco de sobra es barato, un recibo cortado
     hay que reimprimirlo. */
  .fin { min-height: 40mm; break-inside: avoid; page-break-inside: avoid; }

  /* Barra de acciones — nunca sale en el papel. */
  .barra {
    display: flex; gap: 8px; justify-content: center; align-items: center;
    flex-wrap: wrap; padding: 10px;
    background: #fff; border-bottom: 1px solid #e5e7eb;
    font-family: system-ui, sans-serif;
  }
  .barra button {
    font: inherit; font-size: 13px; padding: 8px 16px; border-radius: 999px;
    border: 1px solid #d1d5db; background: #fff; cursor: pointer;
  }
  .barra button.primario { background: #1e3a8a; border-color: #1e3a8a; color: #fff; }
  .barra .nota { font-size: 12px; color: #57534e; }
  @media print { .barra { display: none !important; } }
</style>
</head>
<body>

<div class="barra">
  <button class="primario" onclick="window.print()">Imprimir</button>
  <button onclick="window.close()">Cerrar</button>
  <span class="nota">Papel ${ancho} mm. Imprimí directamente, sin cambiar nada.</span>
</div>

<div class="c emp">JOSIAS MUEBLES</div>
<div class="c tipo">RECIBO ${esc(tipo)}</div>

<hr>

${fila("Recibo N°", d.nroRecibo)}
${fila("Fecha", d.fecha)}
${fila("CI", d.documento)}
${fila("Solicitud", d.solicitud)}
${fila("Cuota", d.cuota)}
${d.concepto ? fila("Concepto", d.concepto) : ""}
${d.interes && d.interes !== "0" ? fila("Interés", "Gs.: " + d.interes) : ""}

<hr>

<div class="f g"><span class="l">TOTAL</span><span class="v">Gs.: ${esc(d.monto)}</span></div>
${d.montoLetras ? `<div class="letras">Son: ${esc(d.montoLetras)}</div>` : ""}

<hr>

${fila("Cobrador", d.cobrador)}

<!-- Colchón de corte. Los &nbsp; no son decorativos: obligan al navegador a
     reservar el alto aunque el bloque quede último en la página. -->
<div class="fin">&nbsp;<br>&nbsp;<br>&nbsp;<br>&nbsp;<br>&nbsp;<br>&nbsp;</div>

</body>
</html>`;
}

// Abre el recibo en una pestaña nueva y dispara el diálogo de impresión.
// `imprimirSolo` deja la ventana abierta para que el usuario elija la impresora
// una vez; el navegador recuerda la elección para las siguientes.
export function imprimirReciboSistema(
  d: DatosTicket,
  tipo: TipoRecibo,
  ancho: AnchoPapel = 58,
): void {
  const win = window.open("", "_blank");
  if (!win) {
    throw new Error(
      "El navegador bloqueó la ventana emergente. Permitila para este sitio y volvé a intentar.",
    );
  }
  win.document.write(construirHtml(d, tipo, ancho));
  win.document.close();

  // Se dispara el diálogo solo, para que sea un click y listo. Va tras el load
  // porque en Chrome imprimir antes de que la página termine de renderizar
  // manda una hoja en blanco.
  win.addEventListener("load", () => win.print(), { once: true });
}
