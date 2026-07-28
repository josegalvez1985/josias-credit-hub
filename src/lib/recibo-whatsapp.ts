// Envío del recibo por WhatsApp: imagen PNG + mensaje de texto.
//
// Portado de las funciones jm* de la página 3 de APEX. Se mantiene el mismo
// diseño de imagen y el mismo texto, porque es el comprobante que los clientes
// ya reciben hoy.
//
// La diferencia con APEX: allá el único camino era copiar la imagen al
// portapapeles y pedirle al usuario que hiciera Ctrl+V en WhatsApp Web. Acá se
// intenta primero la Web Share API, que en Android adjunta la imagen sola.

import type { DatosTicket } from "./escpos";

// ---------------------------------------------------------------------
// Teléfono
// ---------------------------------------------------------------------
// Acepta 0978563254 / 78563254 / 595978563254 / +595978563254 y devuelve
// siempre sin prefijo: 978563254. Igual que jmNormalizarTel.
export function normalizarTelefono(raw?: string | null): string {
  if (!raw) return "";
  let n = raw.replace(/\D/g, "");
  if (!n) return "";
  if (n.startsWith("595") && n.length >= 11) n = n.slice(3);
  if (n.startsWith("0") && n.length >= 9) n = n.slice(1);
  return n;
}

export function telefonoValido(n: string): boolean {
  return n.replace(/\D/g, "").length >= 8;
}

// ---------------------------------------------------------------------
// Mensaje de texto (jmMensajeWa)
// ---------------------------------------------------------------------
export function mensajeWhatsApp(d: DatosTicket): string {
  const lineas = [
    "🧾 *RECIBO DE PAGO — Josias Muebles*",
    "",
    "▸ Recibo N°:   " + d.nroRecibo,
    "▸ Fecha:        " + d.fecha,
    "▸ CI Cliente:   " + d.documento,
    "▸ Solicitud:    " + d.solicitud,
    "▸ Cuota:        " + d.cuota,
    "▸ Monto:        Gs. " + d.monto,
    d.interes && d.interes !== "0" ? "▸ Intereses:    Gs. " + d.interes : null,
    "▸ Cobrador:     " + d.cobrador,
    "",
    "📝 _" + (d.concepto || "") + "_",
    "",
    "_Josias Muebles · RUC: 3829408-7_",
    "_Ruta 1 Km 21 Capiata · (0981) 460 091_",
  ];
  return lineas.filter((l) => l !== null).join("\n");
}

export function urlWhatsApp(telefono: string, texto: string): string {
  return `https://wa.me/595${normalizarTelefono(telefono)}?text=${encodeURIComponent(texto)}`;
}

// ---------------------------------------------------------------------
// Imagen (jmDibujarCanvas)
// ---------------------------------------------------------------------
// Mismo diseño que la app APEX: A4 vertical a 150 dpi, cabecera verde,
// tabla de datos, concepto, monto en letras y firmas.
const W = 1240;
const H = 1754;
const PAD = 55;

function rectRedondeado(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  relleno: boolean,
  borde: boolean,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  if (relleno) ctx.fill();
  if (borde) ctx.stroke();
}

function textoEnvuelto(
  ctx: CanvasRenderingContext2D,
  texto: string,
  x: number,
  y: number,
  anchoMax: number,
  alto: number,
) {
  let linea = "";
  let ly = y;
  for (const palabra of texto.split(" ")) {
    const prueba = linea ? linea + " " + palabra : palabra;
    if (ctx.measureText(prueba).width > anchoMax && linea) {
      ctx.fillText(linea, x, ly);
      linea = palabra;
      ly += alto;
    } else {
      linea = prueba;
    }
  }
  if (linea) ctx.fillText(linea, x, ly);
  return ly;
}

export function dibujarRecibo(d: DatosTicket): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const tblW = W - PAD * 2;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // Cabecera
  ctx.fillStyle = "#064e3b";
  ctx.fillRect(0, 0, W, 148);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 56px Arial";
  ctx.fillText("JOSIAS MUEBLES", PAD, 60);
  ctx.fillStyle = "#a7f3d0";
  ctx.font = "25px Arial";
  ctx.fillText("Todo Para el Confort del Hogar  ·  RUC: 3829408-7", PAD, 93);
  ctx.fillText(
    "Cel.: (0981) 460 091  ·  (0982) 178 465  ·  Ruta 1 Km 21 Capiata - Paraguay",
    PAD,
    120,
  );
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 32px Arial";
  ctx.fillText("RECIBO DE DINERO", PAD, 143);

  // Tabla de datos
  const filas: [string, string][] = [
    ["Nro. de Recibo", String(d.nroRecibo || "—")],
    ["Fecha", d.fecha || "—"],
    ["CI Cliente", d.documento || "—"],
    ["Nro. Solicitud", String(d.solicitud || "—")],
    ["Cuota Nro.", d.cuota || "—"],
    ["Monto Gs.", d.monto || "—"],
    ["Intereses Gs.", d.interes || "0"],
    ["Cobrador", d.cobrador || "—"],
  ];

  const rowH = 62;
  const colW = 390;
  let y = 178;
  filas.forEach(([etiqueta, valor], i) => {
    ctx.fillStyle = i % 2 === 0 ? "#f8fffe" : "#ffffff";
    ctx.fillRect(PAD, y, tblW, rowH);
    ctx.fillStyle = "#f0fdf4";
    ctx.fillRect(PAD, y, colW, rowH);
    ctx.strokeStyle = "#d1fae5";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(PAD, y, tblW, rowH);
    ctx.strokeRect(PAD, y, colW, rowH);
    ctx.fillStyle = "#064e3b";
    ctx.font = "bold 27px Arial";
    ctx.fillText(etiqueta, PAD + 16, y + 40);
    ctx.fillStyle = "#1e293b";
    ctx.font = "27px Arial";
    ctx.fillText(valor, PAD + colW + 16, y + 40);
    y += rowH;
  });

  y += 26;

  // Concepto
  const altoConcepto = 115;
  ctx.fillStyle = "#f0fdf4";
  ctx.strokeStyle = "#064e3b";
  ctx.lineWidth = 2;
  rectRedondeado(ctx, PAD, y, tblW, altoConcepto, 10, true, true);
  ctx.fillStyle = "#064e3b";
  ctx.font = "bold 21px Arial";
  ctx.fillText("CONCEPTO / DETALLE", PAD + 18, y + 28);
  ctx.fillStyle = "#1e293b";
  ctx.font = "26px Arial";
  textoEnvuelto(ctx, d.concepto || "—", PAD + 18, y + 60, tblW - 36, 34);

  y += altoConcepto + 20;

  // Monto en letras
  const altoLetras = 92;
  ctx.fillStyle = "#064e3b";
  rectRedondeado(ctx, PAD, y, tblW, altoLetras, 10, true, false);
  ctx.fillStyle = "#a7f3d0";
  ctx.font = "bold 21px Arial";
  ctx.fillText("SON: (GUARANÍES)", PAD + 18, y + 26);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 27px Arial";
  textoEnvuelto(ctx, d.montoLetras || "—", PAD + 18, y + 60, tblW - 36, 32);

  y += altoLetras + 48;

  // Firmas
  ctx.strokeStyle = "#94a3b8";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(PAD, y + 58);
  ctx.lineTo(PAD + 340, y + 58);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(W - PAD - 340, y + 58);
  ctx.lineTo(W - PAD, y + 58);
  ctx.stroke();
  ctx.fillStyle = "#64748b";
  ctx.font = "23px Arial";
  ctx.fillText("Firma del Cliente", PAD, y + 82);
  ctx.fillText("Firma del Cobrador", W - PAD - 340, y + 82);

  // Pie
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(PAD, H - 55);
  ctx.lineTo(W - PAD, H - 55);
  ctx.stroke();
  ctx.fillStyle = "#94a3b8";
  ctx.font = "21px Arial";
  ctx.fillText("Josias Muebles — Sistema de Cobradores  ·  ORIGINAL", PAD, H - 32);
  ctx.textAlign = "right";
  ctx.fillText("Recibo N° " + d.nroRecibo, W - PAD, H - 32);
  ctx.textAlign = "left";

  return c;
}

function aBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo generar la imagen"))), "image/png"),
  );
}

// ---------------------------------------------------------------------
// Envío
// ---------------------------------------------------------------------
export type ResultadoEnvio = "compartido" | "portapapeles" | "descargado";

type NavegadorConShare = Navigator & {
  share?: (data: { files?: File[]; text?: string; title?: string }) => Promise<void>;
  canShare?: (data: { files?: File[] }) => boolean;
};

// Devuelve cómo terminó, para poder explicarle al usuario qué hacer después.
//
//  - "compartido"    -> Web Share API: Android adjunta la imagen solo. Es el
//                       camino bueno y el que no existía en APEX.
//  - "portapapeles"  -> el camino de APEX: se copia el PNG y se abre WhatsApp
//                       para que el usuario pegue con Ctrl+V.
//  - "descargado"    -> ni share ni clipboard; queda el archivo para adjuntar.
export async function enviarReciboPorWhatsApp(
  d: DatosTicket,
  telefono: string,
): Promise<ResultadoEnvio> {
  const canvas = dibujarRecibo(d);
  const blob = await aBlob(canvas);
  const archivo = new File([blob], `Recibo_${d.nroRecibo}.png`, { type: "image/png" });
  const texto = mensajeWhatsApp(d);
  const nav = navigator as NavegadorConShare;

  if (nav.share && nav.canShare?.({ files: [archivo] })) {
    await nav.share({ files: [archivo], text: texto, title: `Recibo ${d.nroRecibo}` });
    return "compartido";
  }

  if (navigator.clipboard && "write" in navigator.clipboard) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      window.open(urlWhatsApp(telefono, texto), "_blank");
      return "portapapeles";
    } catch {
      /* algunos navegadores lo bloquean fuera de un gesto directo */
    }
  }

  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = `Recibo_${d.nroRecibo}.png`;
  a.click();
  window.open(urlWhatsApp(telefono, texto), "_blank");
  return "descargado";
}

export function enviarSoloTexto(d: DatosTicket, telefono: string) {
  window.open(urlWhatsApp(telefono, mensajeWhatsApp(d)), "_blank");
}
