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
// Al ser rollo continuo, pasarse solo gasta papel en blanco; quedarse corto
// vuelve a cortar el contenido, que es el error caro.
//
// Estaba en 150mm cuando el cuerpo era de 9pt (el recibo medía ~85mm). Al subir
// la letra a 13pt el texto creció ~45%, y con el colchón de 40mm del pie el
// ticket quedaba rozando el límite: ahí el driver descarta lo que no entra y
// vuelve el recibo cortado. 220mm deja el mismo aire proporcional que había.
//
// ⚠ Si se vuelve a tocar `font-size`, revisar este número.
const ALTO_HOJA = 220;

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

  // Cuerpo del importe del TOTAL, calculado para que SIEMPRE entre en un solo
  // renglón. No es cosmético: con un cuerpo fijo, "Gs.: 370.000" ya desbordaba
  // en 58mm y el importe se partía en dos líneas.
  //
  // La cuenta: Courier avanza 0.6em por caracter, así que el cuerpo máximo en
  // puntos es (ancho útil en mm) / (caracteres * 0.6 * 0.3528). Se le deja un
  // 4% de colchón porque el avance real del driver no es exactamente 0.6em, y
  // se topea a 19pt para que un importe corto no salga descomunal.
  const importe = "Gs.: " + d.monto;
  const utilMm = ancho - margen * 2;
  const cuerpoTotal = Math.min(19, (utilMm * 0.96) / (importe.length * 0.6 * 0.3528));

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
    /* 13pt, no 9pt. A 9pt el recibo salía legible pero chico, y el cobrador lo
       lee de pie y a veces con poca luz.
       El tope lo pone el ancho del papel, y es más ajustado de lo que parece:
       Courier avanza 0.6em por caracter, así que en los 50mm útiles (58 menos
       8 de margen) entran ~18 caracteres a 13pt. NO son las 32 columnas del
       ESC/POS: la fuente interna de la térmica es mucho más angosta que la
       Courier del navegador, y por eso los dos recibos se ven parecidos pero
       no idénticos. La fila más larga ("Interes / Gs.: 6.600") mide 18: subir
       de 13pt parte las filas "etiqueta / valor" en dos renglones. */
    font-size: 13pt;
    line-height: 1.3;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .c { text-align: center; }
  .b { font-weight: bold; }

  /* El TOTAL es lo que miran primero el cobrador y el cliente, así que va lo
     más grande del ticket.
     NO va como fila "etiqueta / valor" como el resto: a 19pt entran ~12
     caracteres por línea y "TOTAL" + "Gs.: 220.000" son 17, así que la etiqueta
     y el importe caían en renglones distintos y quedaba roto. Por eso se apila
     a propósito: el rótulo chico arriba y el importe grande y centrado abajo,
     que además es como se lee de un vistazo. */
  .total { margin: 1mm 0; text-align: center; }
  .total .rot { font-size: 10pt; letter-spacing: 1px; }
  /* El cuerpo lo calcula cuerpoTotal (arriba) según lo largo que sea el
     importe. El nowrap es el cinturón de seguridad: aunque la cuenta se quede
     corta en una impresora rara, el importe NO se parte en dos renglones.
     ⚠ Ojo: este bloque vive dentro de un template literal — nada de backticks
     acá adentro o se corta la cadena. */
  .total .imp {
    font-size: ${cuerpoTotal.toFixed(1)}pt;
    font-weight: bold;
    line-height: 1.15;
    white-space: nowrap;
  }

  .emp { font-size: 17pt; font-weight: bold; letter-spacing: .5px; }
  .tipo { margin-top: 1mm; font-size: 15pt; font-weight: bold; }

  hr { border: 0; border-top: 1px dashed #000; margin: 2mm 0; }

  /* Etiqueta a la izquierda, valor a la derecha, con el valor cortando si es
     largo (los nombres vienen como "CI + razón social" y desbordan). */
  .f { display: flex; gap: 2mm; margin-bottom: .8mm; }
  .f .l { flex: 0 0 auto; }
  .f .v { flex: 1 1 auto; min-width: 0; text-align: right; word-break: break-word; }

  /* El monto en letras es la línea más larga del recibo y casi nadie la lee en
     detalle: queda por debajo del cuerpo para no estirar el ticket, pero sube
     de 8pt a 11pt para seguir siendo legible. */
  .letras { margin-top: 1.5mm; font-size: 11pt; word-break: break-word; }

  /* Que ninguna sección se parta al medio si el driver decide cortar antes de
     tiempo. No arregla el corte —para eso está .fin— pero decide DÓNDE cae:
     mejor que se vaya un bloque entero al papel siguiente y no media línea. */
  .f, .letras, .total { break-inside: avoid; page-break-inside: avoid; }

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

<div class="total"><div class="rot">TOTAL</div><div class="imp">${esc(importe)}</div></div>
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
