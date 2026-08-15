// Impreso "Autorización de morosidad + Pagaré a la orden".
//
// Réplica del formulario preimpreso que hoy se llena a mano en Josias Muebles.
// Son DOS bloques en UNA hoja, en este orden:
//
//   1. AUTORIZACIÓN DE INCLUSIÓN DE MOROSIDAD  — texto legal (Ley 6534/20)
//      + dos pares de firmas (deudor y codeudor)
//   2. PAGARÉ A LA ORDEN                        — monto, vencimiento, texto
//      legal + otros dos pares de firmas
//
// Decisiones tomadas con Jose (2026-08-06):
//   - UN solo pagaré por crédito, por el TOTAL (no uno por cuota).
//   - El N° del pagaré es el NRO_SOLICITUD.
//   - El % de interés sale de PORC_INTERES; el moratorio y la comisión quedan
//     en blanco para completar a mano (no están en la base).
//   - (2026-08-15) Si PORC_INTERES es 0 o NULL, el % de interés también sale en
//     blanco: un "0%" impreso diría que no se devenga interés durante la mora.
//   - El monto en letras sale de NUM_LETRAS en Oracle, la misma función que
//     usa el recibo térmico.
//   - Los datos del codeudor (nombre, domicilio, cédula) van SIEMPRE EN BLANCO:
//     VENTAS_REFERENCIAS no guarda domicilio ni cédula del garante.
//   - (2026-08-08) El bloque del pagaré se llena A MANO al firmarlo: salen en
//     blanco "Vencimiento:", "El día __ de ______", "Pagaré a: ______" y la
//     fecha de emisión de "Capiatá __ de ______ de 20__". Del crédito solo se
//     imprimen el monto, el N° y el % de interés.
//
// Igual que el impreso de la solicitud: HTML + window.print() en pestaña
// nueva, sin dependencias. Ver src/lib/impresion-solicitud.ts.

import type { CreditoCabecera } from "./api";

// Datos fijos de la empresa. Están acá y no en la base porque el formulario
// preimpreso los tiene fijos; si cambian, se cambian una sola vez.
const CIUDAD_EMISION = "Capiatá";
const EMPRESA = "JOSIAS MUEBLES";

function esc(v: unknown): string {
  if (v == null) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function gs(n: unknown): string {
  if (n == null || n === "") return "";
  const num = Number(n);
  if (isNaN(num)) return "";
  return new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(num);
}

// Un campo con línea de puntos. `valor` vacío deja la línea para llenar a mano.
function campo(label: string, valor: unknown, ancho = "auto"): string {
  return `<span class="campo" style="--w:${ancho}">
    <span class="lbl">${esc(label)}</span><span class="lin">${esc(valor)}</span>
  </span>`;
}

// El par de firmas al pie de cada bloque. Va dos veces por bloque: izquierda
// el deudor, derecha el codeudor.
//
// Los datos del codeudor van vacíos a propósito (ver cabecera del archivo).
function firmas(nombre = "", domicilio = "", cedula = ""): string {
  const col = (n: string, dom: string, ced: string) => `
    <div class="fcol">
      <div class="flinea"></div>
      <div class="fcap">FIRMA</div>
      <div class="fdato"><span>Nombre:</span><span class="lin">${esc(n)}</span></div>
      <div class="fdato"><span>Domicilio:</span><span class="lin">${esc(dom)}</span></div>
      <div class="fdato"><span>Cedula de Identidad N°:</span><span class="lin">${esc(ced)}</span></div>
    </div>`;
  // Izquierda el titular con sus datos, derecha el codeudor en blanco.
  return `<div class="firmas">${col(nombre, domicilio, cedula)}${col("", "", "")}</div>`;
}

function construirHtml(c: CreditoCabecera): string {
  // Domicilio del titular: dirección + nro de casa + ciudad, lo que haya.
  const domicilio = [c.direccion, c.nro_casa ? `N° ${c.nro_casa}` : null, c.ciudad_cliente]
    .filter(Boolean)
    .join(", ");

  const titular = c.razon_social ?? c.nombre_fantasia ?? "";
  // Un 0 se trata igual que un NULL: la línea sale en blanco para completar a
  // mano, como el moratorio y la comisión. Imprimir "0%" en un pagaré firmaría
  // que no se devenga interés durante la mora, que no es lo que se quiere decir.
  const interes = c.porc_interes ? String(c.porc_interes) : "";

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Pagaré ${esc(c.nro_solicitud ?? c.id)}</title>
<style>
  /* Hoja oficio (216 x 330 mm), igual que el impreso de la solicitud. Los dos
     bloques (morosidad + pagaré) entran en UNA sola página.

     El margen va en CERO a propósito. Si se le da un valor, el navegador suma
     encima su propio margen configurable y el usuario tiene que corregirlo a
     mano en el diálogo. Con margin:0 no queda nada que ajustar: el margen del
     papel lo dibuja el padding de .hoja, que es contenido y el navegador no
     toca. Así se imprime sin configurar nada. */
  @page { size: 216mm 330mm; margin: 0; }

  /* Imprescindible: hace que el padding de 10mm quede DENTRO de los 216x330mm
     de .hoja. Sin esto se sumaría al alto (330 + 10 + 10 = 350mm de caja
     contra 330mm de papel) y el sobrante caería en una segunda hoja. */
  *, *::before, *::after { box-sizing: border-box; }

  body {
    margin: 0; background: #f3f4f6;
    font-family: Helvetica, Arial, sans-serif;
    font-size: 8.5pt; color: #000; line-height: 1.35;
  }
  /* En pantalla se simula la hoja completa: 330mm de alto con sus márgenes
     dibujados por el padding, para ver en la web lo mismo que sale en papel. */
  .hoja {
    width: 216mm; min-height: 330mm;
    margin: 8mm auto; padding: 10mm;
    background: #fff; box-shadow: 0 1px 6px rgba(0,0,0,.25);
  }
  @media print {
    body { background: #fff; }
    /* Se CONSERVA el padding de 10mm: con @page en margen cero, ese padding es
       el único margen del impreso. Solo se saca lo que es de pantalla (el
       margen exterior gris y la sombra). */
    .hoja { margin: 0; box-shadow: none; }
    .noprint { display: none !important; }
  }

  h1 {
    font-size: 11pt; text-align: center; text-decoration: underline;
    margin: 0 0 3mm; letter-spacing: .2px;
  }
  h2 {
    font-size: 11pt; text-align: center; text-decoration: underline;
    margin: 0; display: inline-block;
  }

  /* El texto legal va justificado y chico, como en el formulario. */
  .legal { text-align: justify; font-size: 7.2pt; line-height: 1.3; }

  /* Líneas para completar a mano: el valor va sobre la línea. */
  .lin {
    display: inline-block; border-bottom: .2mm solid #000;
    min-width: 30mm; padding: 0 1mm;
  }
  .campo { display: inline-block; white-space: nowrap; margin-right: 4mm; }
  .campo .lbl { margin-right: 1mm; }

  /* Firmas: dos columnas, como en las dos fotos del formulario. */
  .firmas {
    display: grid; grid-template-columns: 1fr 1fr; gap: 14mm;
    margin-top: 12mm; break-inside: avoid;
  }
  .fcol .flinea { border-top: .3mm solid #000; width: 60mm; margin: 0 auto; }
  .fcol .fcap { text-align: center; font-size: 7.5pt; margin: 1mm 0 5mm; width: 60mm; margin-left: auto; margin-right: auto; }
  .fcol .fdato { margin-bottom: 4mm; font-size: 8.5pt; white-space: nowrap; }
  .fcol .fdato .lin { min-width: 42mm; }

  /* Recuadro del monto, como el cuadro sombreado del formulario. */
  .monto {
    display: inline-block; border: .3mm solid #000;
    padding: 1mm 3mm; min-width: 45mm; font-weight: bold; font-size: 10pt;
  }
  .letras {
    border-bottom: .2mm solid #000; min-height: 5mm;
    padding: 1mm 0; margin-bottom: 2mm; font-size: 9pt;
  }

  /* La autorización de morosidad va PRIMERO y el pagaré debajo. Se ordena con
     flex en vez de reacomodar el HTML para que cada bloque siga junto a su
     comentario y sea fácil compararlo con las fotos del formulario. */
  .hoja { display: flex; flex-direction: column; }
  #bloque-morosidad { order: 1; }
  /* Separación entre los dos bloques: da aire para doblar o cortar la hoja
     entre la autorización y el pagaré. */
  #bloque-pagare    { order: 2; margin-top: 20mm; }

  /* Ningún bloque puede partirse al medio: si algún día el texto crece y ya no
     entra, que pase entero a la hoja siguiente en vez de cortar las firmas. */
  .bloque { break-inside: avoid; }
  .fila { margin-bottom: 3.5mm; }
  .derecha { text-align: right; }

  .barra {
    position: sticky; top: 0; z-index: 10;
    display: flex; gap: 8px; justify-content: center; align-items: center;
    flex-wrap: wrap;
    padding: 10px; background: #fff; border-bottom: 1px solid #e5e7eb;
  }
  /* Recordatorio de la configuración del diálogo de impresión: el navegador
     no aplica el tamaño oficio solo, hay que elegirlo ahí. */
  .barra-nota { font-size: 12px; color: #57534e; }
  .barra button {
    font: inherit; font-size: 13px; padding: 8px 16px; border-radius: 999px;
    border: 1px solid #d1d5db; background: #fff; cursor: pointer;
  }
  .barra button.primario { background: #1e3a8a; border-color: #1e3a8a; color: #fff; }

  /* Aviso de dato faltante. Solo en pantalla: nunca sale en el papel. */
  .aviso {
    max-width: 196mm; margin: 6mm auto 0; padding: 10px 14px;
    background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px;
    font-size: 12px; line-height: 1.5;
  }
  .aviso code { background: #fde68a; padding: 1px 4px; border-radius: 3px; }
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

${
  c.total_letras
    ? ""
    : `<div class="aviso noprint">
         <strong>Falta el monto en letras.</strong> El endpoint todavía no devuelve
         <code>total_letras</code>: hay que redesplegar el módulo ORDS
         <code>operaciones</code> para que incluya <code>NUM_LETRAS(vc.total)</code>.
         Mientras tanto la línea sale en blanco y hay que completarla a mano.
       </div>`
}

<div class="hoja">

  <!-- ============ BLOQUE 1: AUTORIZACIÓN DE MOROSIDAD ============ -->
  <div class="bloque" id="bloque-morosidad">
    <h1>AUTORIZACIÓN DE INCLUSIÓN DE MOROSIDAD</h1>

    <p class="legal">
      Autorizo a la Empresa a tratar mis datos personales, en particular los datos crediticios que
      surjan de la presente relación comercial, de conformidad a la Ley N°6534/20 de "Protección de
      Datos Personales Crediticios". El tratamiento incluye la posibilidad de ceder estos datos a
      ${esc(EMPRESA)} u otras empresas especializadas tanto dentro o fuera del País, en cuyo caso se
      tomarán medidas necesarias para garantizar que sean tratados con niveles adecuados de
      protección. Los datos crediticios incluyen: a) la identificación de la persona o razón social,
      (nombres, cedula de identidad, RUC, fecha de nacimiento o constitución, etc); b) los datos del
      crédito otorgado y la forma de cumplimiento, es decir tanto la información positiva como la
      negativa (monto, cuotas, saldo, vencimiento, fecha de pago o días de mora, etc); c) otros tipos
      de datos que sean relevantes de carácter comercial, crediticia o patrimonial (domicilio,
      teléfono, celular, correo electrónico). La presente autorización incluye ademas la posibilidad
      de consultar o verificar la información a través de la Sociedad de Información crediticia, la
      consulta por parte de otros Usuarios de la información aquí provista, así como para cualquier
      otro fin permitido incluyendo la prospección digital, servicios de marketing, análisis de
      riesgo, segmentación de mercado. El cliente a sido informado sobre todos los derechos que se
      asisten y que incluyen el acceso, autorización y rectificación de su información personal
      crediticia
    </p>

    ${firmas(titular, domicilio, c.documento ?? "")}
  </div>

  <!-- ============ BLOQUE 2: PAGARÉ A LA ORDEN ============ -->
  <div class="bloque" id="bloque-pagare">
    <div class="fila" style="text-align:center">
      <h2>PAGARÉ A LA ORDEN</h2>
      <span style="margin-left:8mm; font-weight:bold; font-size:10pt">Gs:</span>
      <span class="monto">${gs(c.total)}</span>
    </div>

    <div class="fila">
      ${campo("N°", c.nro_solicitud ?? c.id)}
    </div>

    <div class="fila">
      <span class="campo">
        <span class="lbl">Vencimiento:</span>
        <span class="lin" style="min-width:12mm"></span>/<span
          class="lin" style="min-width:12mm"></span>/<span
          class="lin" style="min-width:18mm"></span>
      </span>
      <span style="float:right">
        ${esc(CIUDAD_EMISION)}
        <span class="lin" style="min-width:16mm"></span> de
        <span class="lin" style="min-width:28mm"></span> de 20<span
          class="lin" style="min-width:12mm"></span>
      </span>
    </div>

    <div class="fila" style="clear:both">
      El día <span class="lin" style="min-width:16mm"></span>
      de <span class="lin" style="min-width:60mm"></span>
    </div>

    <div class="fila">
      Pagaré a: <span class="lin" style="min-width:130mm"></span>
      o a su orden la cantidad
    </div>

    <div class="fila">
      de Guaraníes:
      <div class="letras">${esc(c.total_letras ?? "")}</div>
      <div class="letras"></div>
    </div>

    <p class="legal">
      Por igual valor recibido en <span class="lin" style="min-width:20mm"></span> a mi (nuestra)
      entera satisfacción. Queda expresamente convenido que la falta de pago de este pagaré me (nos)
      constituirá en mora automática, sin necesidad de interpelación judicial o extrajudicial alguna
      devengando durante el tiempo de l a mora un interés del <span class="lin" style="min-width:10mm">${esc(interes)}</span>%,
      un interes moratorio del <span class="lin" style="min-width:10mm"></span>% y una comisión del
      <span class="lin" style="min-width:10mm"></span>% por el simple retardo sin que esto implique
      prórroga del plazo de la obligación. Así mismo, me(nos) obligamos a pagar cualquier gasto en
      que incurra el acreedor con relación a esta préstamo, en caso de que el mismo sea reclamado por
      la vía judicial o extrajudicial. El Cliente autoriza a la empresa a tratar sus datos
      personales, en particular los datos crediticios que surjan de la presente relación comercial,
      de conformidad a la Ley N° 6534/20 de "Protección de Datos Personales Crediticios". El
      tratamiento incluye la posibilidad de ceder estos datos a Josias Muebles u otras empresas
      especializadas tanto dentro como fuera del país, en cuyo caso se tomaran las medidas necesarias
      para garantizar que sean tratados con niveles adecuados de protección. Los datos crediticios
      incluyen: a) la identificación de la persona o razón social, (nombres, cedula de identidad,
      RUC, fecha de nacimiento o constitución, etc); b) los datos del crédito otorgado y la forma de
      cumplimiento, es decir tanto la información positiva como la negativa (monto, cuotas, saldo,
      vencimiento, fecha de pago o días de mora, etc); c) otros tipos de datos que sean relevantes de
      carácter comercial, crediticia o patrimonial (domicilio, teléfono, celular, correo
      electrónico). La presente autorización incluye ademas la posibilidad de consultar o verificar
      la información a través de la Sociedad de Información crediticia, la consulta por parte de
      otros Usuarios de la información aquí provista, así como para cualquier otro fin permitido
      incluyendo la prospección digital, servicios de marketing, análisis de riesgo, segmentación de
      mercado. El cliente ha sido informado sobre todos los derechos que se asisten y que incluyen el
      acceso, autorización y rectificación de su información personal crediticia. A los Efectos
      Legales y Procesales nos sometemos a la Jurisdicción de los Tribunales de Asunción y
      renunciando a cualquier otra que pudiera corresponder. Las partes constituyen domicilio
      especial en los lugares indicados en el presente documento.
    </p>

    ${firmas(titular, domicilio, c.documento ?? "")}
  </div>

</div>

</body>
</html>`;
}

// Abre el pagaré en una pestaña nueva, igual que el impreso de la solicitud.
export function imprimirPagare(c: CreditoCabecera): void {
  const win = window.open("", "_blank");
  if (!win) {
    throw new Error(
      "El navegador bloqueó la ventana emergente. Permitila para este sitio y volvé a intentar.",
    );
  }
  win.document.write(construirHtml(c));
  win.document.close();

  // Igual que la solicitud: el diálogo se abre solo y al usuario solo le queda
  // confirmar. Este impreso no carga imágenes, así que el `load` resuelve
  // enseguida. Ver `autoImprimir` en src/lib/impresion-solicitud.ts.
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
