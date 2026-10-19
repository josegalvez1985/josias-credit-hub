// Reporte "Cheques a Vencer": los cheques entregados a proveedores, agrupados
// por fecha de vencimiento, para saber cuánto se puede debitar de la cuenta
// cada día. La mayoría son diferidos. Hoja A4 vertical, misma cara y
// mecanismo que los otros reportes (reporte-a4.ts).
//
// Datos: GET /proveedores/cheques (backend/proveedores.sql), filtrado por
// vencimiento en el servidor y por proveedor acá (decisiones de Jose,
// 2026-10-19).
//
// La base no registra si un cheque ya se cobró: un vencimiento anterior a hoy
// sale como "Vencido" (ya se pudo cobrar), no como "Cobrado".
//
// filtrarCheques, agruparPorVencimiento, totalesCheques y estadoCheque se
// exportan para la vista previa de la pantalla, que muestra lo mismo que el PDF.

import { listarChequesProveedor, type ChequeProveedor } from "./api";
import { abrirReporteA4, documentoA4, esc, fecha, filaMargen, gs, kv } from "./reporte-a4";
import { fechaLocal, hoyISO } from "./utils";

export type OpcionesCheques = {
  desde: string; // YYYY-MM-DD, sobre la fecha de vencimiento
  hasta: string; // YYYY-MM-DD
  proveedor?: { value: number; label: string } | null; // null = todos
};

export function filtrarCheques(cs: ChequeProveedor[], op: OpcionesCheques): ChequeProveedor[] {
  return cs.filter((c) => !op.proveedor || c.cod_proveedor === op.proveedor.value);
}

// Días de hoy al vencimiento: negativo si ya venció. Con fechas locales a
// medianoche y Math.round, para no depender de la hora ni de UTC.
export function diasParaVencer(vencimiento: string, hoy = hoyISO()): number {
  const v = fechaLocal(vencimiento);
  const h = fechaLocal(hoy);
  if (!v || !h) return 0;
  return Math.round((v.getTime() - h.getTime()) / 86_400_000);
}

export type EstadoCheque = "vencido" | "hoy" | "a_vencer";

export function estadoCheque(vencimiento: string, hoy = hoyISO()): EstadoCheque {
  const d = diasParaVencer(vencimiento, hoy);
  return d < 0 ? "vencido" : d === 0 ? "hoy" : "a_vencer";
}

// "Vencido hace 3 días" · "Vence hoy" · "Vence mañana" · "En 12 días".
export function textoVencimiento(vencimiento: string, hoy = hoyISO()): string {
  const d = diasParaVencer(vencimiento, hoy);
  if (d === 0) return "Vence hoy";
  if (d === 1) return "Vence mañana";
  if (d === -1) return "Venció ayer";
  if (d < 0) return `Vencido hace ${-d} días`;
  return `En ${d} días`;
}

// "lunes 20/10/2026", para el encabezado de cada día.
export function diaVencimiento(vencimiento: string): string {
  const d = fechaLocal(vencimiento);
  const dia = d ? d.toLocaleDateString("es-PY", { weekday: "long" }) : "";
  return `${dia} ${fecha(vencimiento)}`.trim();
}

export type GrupoVencimiento = {
  fecha: string; // YYYY-MM-DD
  cheques: ChequeProveedor[];
  total: number;
};

// Un grupo por día de vencimiento, en orden; adentro, por proveedor.
export function agruparPorVencimiento(cs: ChequeProveedor[]): GrupoVencimiento[] {
  const porDia = new Map<string, ChequeProveedor[]>();
  for (const c of cs) {
    const lista = porDia.get(c.fecha_vencimiento);
    if (lista) lista.push(c);
    else porDia.set(c.fecha_vencimiento, [c]);
  }
  return [...porDia.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([f, cheques]) => ({
      fecha: f,
      cheques: [...cheques].sort(
        (a, b) => (a.proveedor ?? "").localeCompare(b.proveedor ?? "") || a.id_pago - b.id_pago,
      ),
      total: cheques.reduce((s, c) => s + c.monto, 0),
    }));
}

export type TotalesCheques = {
  vencidos: { cant: number; total: number }; // vencimiento anterior a hoy
  aVencer: { cant: number; total: number }; // de hoy en adelante
  cant: number;
  total: number;
};

export function totalesCheques(cs: ChequeProveedor[], hoy = hoyISO()): TotalesCheques {
  const t: TotalesCheques = {
    vencidos: { cant: 0, total: 0 },
    aVencer: { cant: 0, total: 0 },
    cant: cs.length,
    total: 0,
  };
  for (const c of cs) {
    t.total += c.monto;
    const lado = estadoCheque(c.fecha_vencimiento, hoy) === "vencido" ? t.vencidos : t.aVencer;
    lado.cant++;
    lado.total += c.monto;
  }
  return t;
}

const nCheques = (c: number) => `${c} ${c === 1 ? "cheque" : "cheques"}`;

function tabla(grupos: GrupoVencimiento[], hoy: string): string {
  const cuerpo = grupos
    .map((g) => {
      const filas = g.cheques
        .map(
          (c) => `<tr>
            <td>${esc(c.nro_documento || "—")}</td>
            <td>${esc(c.banco || "—")}</td>
            <td>${esc(c.proveedor || "Sin proveedor")}${
              c.documento ? `<div class="doc">${esc(c.documento)}</div>` : ""
            }</td>
            <td>${esc(c.nro_recibo)}${
              c.facturas ? `<div class="doc">Fact. ${esc(c.facturas)}</div>` : ""
            }</td>
            <td>${esc(fecha(c.fecha_emision))}</td>
            <td class="num">${gs(c.monto)}</td>
          </tr>`,
        )
        .join("");
      const vencido = estadoCheque(g.fecha, hoy) === "vencido";
      return `<tbody>
        <tr class="grupo${vencido ? " vencido" : ""}"><td colspan="6">${esc(diaVencimiento(g.fecha))}<span class="doc">${esc(
          textoVencimiento(g.fecha, hoy),
        )}</span></td></tr>
        ${filas}
        <tr class="subtotal">
          <td colspan="5">Subtotal del día · ${nCheques(g.cheques.length)}</td>
          <td class="num">${gs(g.total)}</td>
        </tr>
      </tbody>`;
    })
    .join("");

  return `<table class="datos">
    <thead>
      ${filaMargen(6)}
      <tr>
        <th style="width:24mm">Nro. Cheque</th>
        <th style="width:30mm">Banco</th>
        <th>Proveedor</th>
        <th style="width:34mm">Recibo</th>
        <th style="width:19mm">Emisión</th>
        <th class="num" style="width:26mm">Monto Gs.</th>
      </tr>
    </thead>
    <tfoot>${filaMargen(6)}</tfoot>
    ${cuerpo}
  </table>`;
}

function construirHtml(todos: ChequeProveedor[], op: OpcionesCheques, logoUrl: string): string {
  const hoy = hoyISO();
  const cs = filtrarCheques(todos, op);
  const t = totalesCheques(cs, hoy);

  const cuerpo =
    cs.length === 0
      ? `<div class="vacio">No hay cheques que venzan en el período${
          op.proveedor ? " para este proveedor" : ""
        }.</div>`
      : `${tabla(agruparPorVencimiento(cs), hoy)}
         <div class="tot">
           <span class="rot">TOTAL · ${esc(nCheques(t.cant)).toUpperCase()}</span>
           <span class="imp">Gs. ${gs(t.total)}</span>
         </div>`;

  const nota = [
    "Cheques entregados a proveedores en Recibos de Proveedores, por fecha de vencimiento.",
    "La base no registra si un cheque ya se cobró: «Vencido» quiere decir que el proveedor ya lo pudo cobrar.",
    "Si un recibo se pagó con varias formas, el cheque cubre solo una parte de sus facturas.",
  ].join(" ");

  return documentoA4({
    titulo: `Cheques ${fecha(op.desde).replace(/\//g, "-")} al ${fecha(op.hasta).replace(/\//g, "-")}`,
    reporte: "Cheques a Vencer",
    destacado: `Del ${fecha(op.desde)} al ${fecha(op.hasta)}`,
    detalles: [
      op.proveedor ? op.proveedor.label : "Todos los proveedores",
      "Por fecha de vencimiento",
      `Al ${fecha(hoy)}`,
    ],
    resumen:
      kv(`Vencidos · ${nCheques(t.vencidos.cant)}`, `Gs. ${gs(t.vencidos.total)}`) +
      kv(`A vencer · ${nCheques(t.aVencer.cant)}`, `Gs. ${gs(t.aVencer.total)}`) +
      kv("Total del período", `Gs. ${gs(t.total)}`),
    cuerpo,
    nota,
    estilo: `
      td .doc { font-size: 7pt; color: #555; margin-top: .3mm; }
      .grupo td { text-transform: capitalize; }
      .grupo .doc { text-transform: none; }
      .grupo.vencido td { color: #555; }
    `,
    logoUrl,
  });
}

// Abre el reporte en una pestaña nueva. Sin await antes de llamarla: la
// pestaña se abre dentro del click (ver abrirReporteA4). Vuelve a consultar,
// así el PDF sale con los datos del momento.
export function abrirReporteCheques(op: OpcionesCheques): Promise<void> {
  return abrirReporteA4("Generando el reporte de cheques...", async (logoUrl) => {
    const cs = await listarChequesProveedor({
      desde: op.desde,
      hasta: op.hasta,
      codProveedor: op.proveedor?.value,
    });
    return construirHtml(cs, op, logoUrl);
  });
}
