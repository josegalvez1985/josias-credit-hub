// Reporte "Margen de Ventas por Artículos" — la página 61 de APEX. Hoja A4
// vertical, misma cara y mecanismo que los otros reportes (reporte-a4.ts).
//
// Datos: GET /margen-articulos/ventas (backend/margen-articulos.sql). Llega una fila
// por artículo y plan de cuotas; acá se juntan en una por artículo y se
// calculan ganancia y márgenes, así la pantalla y el PDF usan las mismas
// fórmulas. Decisiones de Jose (2026-10-20), detalladas en el .sql:
//
//   · Ventas: solicitudes APROBADAS por FECHA_FACTURA, sin el artículo 217.
//   · Precio de venta: el de la solicitud, a crédito y con el interés.
//   · Costo: la última compra real (TIPO 'C', precio > 0) hasta el fin del
//     período. Sin compra, el artículo sale "Sin costo" y NO entra en la
//     ganancia ni en el margen (APEX lo contaba con costo 0).
//   · Margen principal sobre el COSTO, como APEX: (venta − costo) / costo.
//     El margen sobre la venta va de dato secundario.

import { listarMargenArticulos, type MargenPlan } from "./api";
import { abrirReporteA4, documentoA4, esc, fecha, filaMargen, gs, kv } from "./reporte-a4";

export type MargenArticulo = {
  cod: number;
  nombre: string;
  cantidad: number;
  total_venta: number;
  solicitudes: number;
  precio_prom: number | null; // total_venta / cantidad
  costo: number | null; // unitario; null = sin compra
  fecha_costo: string | null;
  total_costo: number | null;
  ganancia: number | null;
  margen_costo: number | null; // %; null sin costo
  margen_venta: number | null; // %
  planes: MargenPlan[]; // de más a menos unidades
};

export function nombreArticulo(cod: number, articulo?: string | null): string {
  return articulo?.trim() || `Artículo ${cod}`;
}

// (venta − costo) / costo y (venta − costo) / venta, en %. null si no se
// puede calcular (sin costo, o división por cero).
function margenes(venta: number, costo: number | null) {
  if (costo == null) return { ganancia: null, margen_costo: null, margen_venta: null };
  const ganancia = venta - costo;
  return {
    ganancia,
    margen_costo: costo > 0 ? (ganancia / costo) * 100 : null,
    margen_venta: venta > 0 ? (ganancia / venta) * 100 : null,
  };
}

export function agruparMargen(filas: MargenPlan[]): MargenArticulo[] {
  const porCod = new Map<number, MargenPlan[]>();
  for (const f of filas) {
    const lista = porCod.get(f.cod_articulo);
    if (lista) lista.push(f);
    else porCod.set(f.cod_articulo, [f]);
  }

  return [...porCod.entries()].map(([cod, planes]) => {
    const cantidad = planes.reduce((s, p) => s + (p.cantidad ?? 0), 0);
    const total_venta = planes.reduce((s, p) => s + (p.total_venta ?? 0), 0);
    // El costo es del artículo: es el mismo en todas sus filas.
    const costo = planes[0].costo ?? null;
    const total_costo = costo == null ? null : cantidad * costo;
    return {
      cod,
      nombre: nombreArticulo(cod, planes[0].articulo),
      cantidad,
      total_venta,
      solicitudes: planes.reduce((s, p) => s + (p.solicitudes ?? 0), 0),
      precio_prom: cantidad > 0 ? total_venta / cantidad : null,
      costo,
      fecha_costo: planes[0].fecha_costo ?? null,
      total_costo,
      ...margenes(total_venta, total_costo),
      planes: [...planes].sort((a, b) => b.cantidad - a.cantidad),
    };
  });
}

export type TotalesMargen = {
  articulos: number;
  unidades: number;
  total_venta: number;
  // Solo los artículos con costo: los demás no tienen ganancia calculable.
  conCosto: {
    venta: number;
    costo: number;
    ganancia: number;
    margen_costo: number | null;
    margen_venta: number | null;
  };
  sinCosto: { articulos: number; unidades: number; venta: number };
};

export function totalesMargen(arts: MargenArticulo[]): TotalesMargen {
  let venta = 0;
  let costo = 0;
  const sinCosto = { articulos: 0, unidades: 0, venta: 0 };
  for (const a of arts) {
    if (a.total_costo == null) {
      sinCosto.articulos++;
      sinCosto.unidades += a.cantidad;
      sinCosto.venta += a.total_venta;
    } else {
      venta += a.total_venta;
      costo += a.total_costo;
    }
  }
  const m = margenes(venta, costo);
  return {
    articulos: arts.length,
    unidades: arts.reduce((s, a) => s + a.cantidad, 0),
    total_venta: arts.reduce((s, a) => s + a.total_venta, 0),
    conCosto: {
      venta,
      costo,
      ganancia: m.ganancia ?? 0,
      margen_costo: m.margen_costo,
      margen_venta: m.margen_venta,
    },
    sinCosto,
  };
}

export type OrdenMargen = "articulo" | "unidades" | "venta" | "ganancia" | "margen";

export const ORDEN_MARGEN: Record<OrdenMargen, string> = {
  articulo: "Artículo",
  unidades: "Unidades",
  venta: "Total vendido",
  ganancia: "Ganancia",
  margen: "Margen",
};

// Los "Sin costo" van siempre al final, sea cual sea la dirección: no tienen
// ganancia ni margen con qué compararse.
export function ordenarMargen(
  arts: MargenArticulo[],
  orden: OrdenMargen,
  asc: boolean,
): MargenArticulo[] {
  const valor = (a: MargenArticulo): number | null =>
    orden === "unidades"
      ? a.cantidad
      : orden === "venta"
        ? a.total_venta
        : orden === "ganancia"
          ? a.ganancia
          : orden === "margen"
            ? a.margen_costo
            : null;
  return [...arts].sort((a, b) => {
    if (orden === "articulo") {
      const c = a.nombre.localeCompare(b.nombre, "es");
      return asc ? c : -c;
    }
    const va = valor(a);
    const vb = valor(b);
    if (va == null && vb == null) return a.nombre.localeCompare(b.nombre, "es");
    if (va == null) return 1;
    if (vb == null) return -1;
    return asc ? va - vb : vb - va;
  });
}

// "34,5 %". Un decimal: APEX mostraba dos, pero en un reporte de gestión el
// segundo no cambia ninguna decisión.
export function pct(n: number | null): string {
  if (n == null) return "—";
  return `${n.toLocaleString("es-PY", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

// "12 cuotas de Gs. 210.000 · entrega Gs. 200.000". Es el plan de la
// solicitud entera, no del artículo solo.
export function textoPlan(p: MargenPlan): string {
  const n = p.cantidad_cuotas ?? 0;
  const cuotas = n > 0 ? `${n} ${n === 1 ? "cuota" : "cuotas"} de Gs. ${gs(p.monto_cuota)}` : "Sin cuotas";
  const entrega = p.entrega_inicial ? `entrega Gs. ${gs(p.entrega_inicial)}` : "sin entrega";
  return `${cuotas} · ${entrega}`;
}

export type OpcionesMargen = {
  desde: string; // YYYY-MM-DD
  hasta: string; // YYYY-MM-DD
  orden: OrdenMargen;
  asc: boolean;
  planes: boolean; // detallar los planes de cuotas debajo de cada artículo
};

function tabla(arts: MargenArticulo[], t: TotalesMargen, conPlanes: boolean): string {
  const filas = arts
    .map((a) => {
      const sinCosto = a.costo == null;
      const fila = `<tr class="${sinCosto ? "sincosto" : a.ganancia != null && a.ganancia < 0 ? "negativo" : ""}">
        <td>${esc(a.nombre)}</td>
        <td class="num">${gs(a.cantidad)}</td>
        <td class="num">${a.precio_prom == null ? "—" : gs(a.precio_prom)}</td>
        <td class="num">${sinCosto ? "Sin costo" : gs(a.costo)}</td>
        <td class="num">${gs(a.total_venta)}</td>
        <td class="num">${a.total_costo == null ? "—" : gs(a.total_costo)}</td>
        <td class="num">${a.ganancia == null ? "—" : gs(a.ganancia)}</td>
        <td class="num">${esc(pct(a.margen_costo))}</td>
      </tr>`;
      if (!conPlanes) return fila;
      const planes = a.planes
        .map(
          (p) => `<tr class="plan">
            <td colspan="4">${esc(textoPlan(p))}</td>
            <td class="num">${gs(p.cantidad)} u. · ${gs(p.total_venta)}</td>
            <td colspan="3"></td>
          </tr>`,
        )
        .join("");
      return `<tbody class="art">${fila}${planes}</tbody>`;
    })
    .join("");

  const c = t.conCosto;
  return `<table class="datos">
    <thead>
      ${filaMargen(8)}
      <tr>
        <th>Artículo</th>
        <th class="num" style="width:11mm">Unid.</th>
        <th class="num" style="width:19mm">P. venta</th>
        <th class="num" style="width:19mm">Costo</th>
        <th class="num" style="width:23mm">Total venta</th>
        <th class="num" style="width:23mm">Total costo</th>
        <th class="num" style="width:23mm">Ganancia</th>
        <th class="num" style="width:15mm">Margen</th>
      </tr>
    </thead>
    <tfoot>${filaMargen(8)}</tfoot>
    ${conPlanes ? filas : `<tbody>${filas}</tbody>`}
    <tbody>
      <tr class="subtotal">
        <td>Totales · ${t.articulos} ${t.articulos === 1 ? "artículo" : "artículos"}</td>
        <td class="num">${gs(t.unidades)}</td>
        <td colspan="2"></td>
        <td class="num">${gs(t.total_venta)}</td>
        <td class="num">${gs(c.costo)}</td>
        <td class="num">${gs(c.ganancia)}</td>
        <td class="num">${esc(pct(c.margen_costo))}</td>
      </tr>
    </tbody>
  </table>`;
}

function construirHtml(filas: MargenPlan[], op: OpcionesMargen, logoUrl: string): string {
  const arts = ordenarMargen(agruparMargen(filas), op.orden, op.asc);
  const t = totalesMargen(arts);
  const c = t.conCosto;
  const periodo = `Del ${fecha(op.desde)} al ${fecha(op.hasta)}`;

  const cuerpo =
    arts.length === 0
      ? `<div class="vacio">No hay ventas aprobadas en el período.</div>`
      : `${tabla(arts, t, op.planes)}
         <div class="tot">
           <span class="rot">GANANCIA DEL PERÍODO · MARGEN ${esc(pct(c.margen_costo))}</span>
           <span class="imp">Gs. ${gs(c.ganancia)}</span>
         </div>`;

  const nota = [
    "Ventas de solicitudes de crédito aprobadas con fecha de factura dentro del período.",
    "Precio de venta = precio a crédito de la solicitud, con el interés incluido.",
    "Costo = última compra del artículo hasta el fin del período.",
    "Margen = ganancia sobre el costo.",
    t.sinCosto.articulos > 0
      ? `${t.sinCosto.articulos} ${t.sinCosto.articulos === 1 ? "artículo no tiene" : "artículos no tienen"} compra registrada (Gs. ${gs(t.sinCosto.venta)} vendidos): no entran en el costo, la ganancia ni el margen.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return documentoA4({
    titulo: `Margen por articulo ${fecha(op.desde).replace(/\//g, "-")} al ${fecha(op.hasta).replace(/\//g, "-")}`,
    reporte: "Margen de Ventas por Artículos",
    destacado: periodo,
    detalles: [
      `Ordenado por ${ORDEN_MARGEN[op.orden].toLowerCase()}`,
      op.planes ? "Con planes de cuotas" : "",
    ].filter(Boolean),
    resumen:
      kv("Total vendido", `Gs. ${gs(t.total_venta)}`) +
      kv(`Ganancia · margen ${pct(c.margen_costo)}`, `Gs. ${gs(c.ganancia)}`) +
      kv("Unidades vendidas", `${gs(t.unidades)} · ${t.articulos} ${t.articulos === 1 ? "artículo" : "artículos"}`),
    cuerpo,
    nota,
    // Ocho columnas en 186 mm: un punto menos que los otros reportes.
    estilo: `
      table.datos { font-size: 7.5pt; }
      tbody.art { break-inside: avoid; }
      .plan td { font-size: 7pt; color: #555; padding-top: .5mm; padding-bottom: .5mm; border-bottom: 0; }
      .plan td:first-child { padding-left: 6mm; }
      .sincosto td { color: #666; }
      .negativo td { font-weight: bold; }
    `,
    logoUrl,
  });
}

// Abre el reporte en una pestaña nueva. Sin await antes de llamarla: la
// pestaña se abre dentro del click (ver abrirReporteA4). Vuelve a consultar,
// así el PDF sale con los datos del momento.
export function abrirReporteMargen(op: OpcionesMargen): Promise<void> {
  return abrirReporteA4("Generando el reporte de margen por artículo...", async (logoUrl) => {
    const filas = await listarMargenArticulos({ desde: op.desde, hasta: op.hasta });
    return construirHtml(filas, op, logoUrl);
  });
}
