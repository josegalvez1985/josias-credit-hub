// Cliente HTTP para el backend ORDS (modulo "solicitudes").
import { getStoredToken } from "./auth";

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

function authHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_URL) throw new Error("VITE_API_URL no configurada");
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
        ...init?.headers,
      },
    });
  } catch {
    throw new Error("No se pudo conectar con el servidor");
  }

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok || (data && typeof data === "object" && (data as { success?: boolean }).success === false)) {
    const msg =
      (data && typeof data === "object" &&
        ((data as { message?: string }).message ||
          (data as { error?: string }).error ||
          (data as { detail?: string }).detail)) ||
      (typeof data === "string" && data) ||
      `Error ${res.status}`;
    throw new Error(String(msg));
  }
  return data as T;
}

// ----- LOVs -----
export type LovItem = { value: number; label: string; [k: string]: unknown };
type OrdsFeed<T> = { items: T[] };

function feed<T>(path: string, q?: string) {
  const qs = q ? `?q=${encodeURIComponent(q)}` : "";
  return request<OrdsFeed<T>>(`${path}${qs}`).then((r) => r.items ?? []);
}

export const lov = {
  clientes: (q?: string) => feed<LovItem & { nombre_fantasia?: string; ci?: string; ruc?: string }>("/solicitudes/lov/clientes", q),
  ciudades: (q?: string) => feed<LovItem>("/solicitudes/lov/ciudades", q),
  vendedores: (q?: string) => feed<LovItem>("/solicitudes/lov/vendedores", q),
  articulos: (q?: string) => feed<LovItem & { cod_unidad_medida?: number }>("/solicitudes/lov/articulos", q),
  profesiones: (q?: string) => feed<LovItem>("/solicitudes/lov/profesiones", q),
};

// Resuelve descripciones de un LOV por código, cacheando la lista completa.
const lovCache: Record<string, Map<number, string>> = {};

export async function lovLabels(
  tipo: "articulos" | "ciudades" | "vendedores" | "profesiones",
): Promise<Map<number, string>> {
  if (!lovCache[tipo]) {
    const items = await lov[tipo]();
    lovCache[tipo] = new Map(items.map((i) => [i.value, i.label]));
  }
  return lovCache[tipo];
}

// ----- Solicitud (cabecera + hijos) -----
export type CabeceraInput = {
  nro_solicitud: number;
  fecha_factura: string; // YYYY-MM-DD
  referencia: string;
  cod_cliente: number;
  cantidad_cuotas: number;
  total: number;
  monto_cuota: number;
  cod_ciudad: number;
  cod_vendedor: number;
  fec_vencimiento_inicial: string; // YYYY-MM-DD
  entrega_inicial: number;
  porc_interes: number;
};

export type DetalleInput = {
  cod_articulo: number;
  cantidad: number;
  precio_unitario: number;
};

export type ReferenciaInput = {
  relacion: string;
  telefono: string;
  nombre_apellido: string;
};

export type ActividadInput = {
  es_empleado: string; // 'S' | 'N'
  nombre_empresa: string;
  direccion: string;
  puesto_ocupado: string;
  ingresos_mensuales: number;
  otros_ingresos: number;
  antiguedad: string;
  telefono: string;
  cod_profesion: number;
  cod_ciudad: number;
  aporta_ips: string; // 'S' | 'N'
};

export type SolicitudCompleta = {
  cabecera: CabeceraInput;
  detalles: DetalleInput[];
  referencias: ReferenciaInput[];
  actividad?: ActividadInput;
};

// ----- Clientes -----
export type Cliente = {
  cod_cliente: number;
  razon_social: string;
  nombre_fantasia?: string;
  sexo?: string;
  ruc?: string;
  ci?: string;
  nro_telefono?: string;
  cod_pais?: number;
  cod_departamento?: number;
  cod_ciudad?: number;
  direccion?: string;
  nro_casa?: string;
  estado?: string;
  estado_civil?: string;
  fecha_nacimiento?: string;
  vivienda?: string;
  ubicacion?: string;
};

export type ClienteInput = Omit<Cliente, "cod_cliente">;

export function listarClientes(q?: string) {
  const qs = q ? `?q=${encodeURIComponent(q)}` : "";
  return request<OrdsFeed<Cliente>>(`/clientes/${qs}`).then((r) => r.items ?? []);
}

// Devuelve true si ya existe un cliente con ese CI.
// El GET con ?q= devuelve 400 en este backend, así que traemos todo y filtramos local.
// Algunos CI guardados tienen puntos (4.169.298) y otros no: normalizamos para comparar.
export async function ciExiste(ci: string): Promise<boolean> {
  const norm = (v: string) => v.replace(/\D/g, "");
  const target = norm(ci);
  const list = await listarClientes();
  return list.some((c) => norm(c.ci ?? "") === target);
}

export function crearCliente(c: ClienteInput) {
  // El handler ORDS bindea las 16 columnas; si falta un bind en el JSON da 400.
  // Enviamos todas las claves, con null donde no hay valor.
  const num = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));
  const str = (v: unknown) => (v === undefined || v === null || v === "" ? null : v);
  const body = {
    razon_social: c.razon_social,
    nombre_fantasia: str(c.nombre_fantasia),
    sexo: str(c.sexo),
    ruc: str(c.ruc),
    ci: str(c.ci),
    nro_telefono: str(c.nro_telefono),
    cod_pais: num(c.cod_pais),
    cod_departamento: num(c.cod_departamento),
    cod_ciudad: num(c.cod_ciudad),
    direccion: str(c.direccion),
    nro_casa: num(c.nro_casa),
    estado: c.estado ?? "A",
    estado_civil: str(c.estado_civil),
    // ORDS hace TO_DATE(:fecha_nacimiento,'YYYY-MM-DD'); "" lanza ORA-01841 -> 400.
    fecha_nacimiento: str(c.fecha_nacimiento),
    vivienda: str(c.vivienda),
    ubicacion: str(c.ubicacion),
  };
  return request<{ cod_cliente: number }>("/clientes/", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function obtenerCliente(cod: number) {
  return request<Cliente>(`/clientes/${cod}`);
}

export type Cabecera = CabeceraInput & { id: number; estado?: string };

export function listarCabeceras() {
  return request<OrdsFeed<Cabecera>>("/solicitudes/cabecera").then((r) => r.items ?? []);
}

export function obtenerCabecera(id: number) {
  return request<Cabecera>(`/solicitudes/cabecera/${id}`);
}

export type DetalleRow = DetalleInput & { id_detalle: number; id: number };
export type ReferenciaRow = ReferenciaInput & { id_detalle: number; id: number };
export type ActividadRow = ActividadInput & { id_detalle: number; id: number };

export function listarDetalles(id: number) {
  return request<OrdsFeed<DetalleRow>>(`/solicitudes/detalle/${id}`).then((r) => r.items ?? []);
}
export function listarReferencias(id: number) {
  return request<OrdsFeed<ReferenciaRow>>(`/solicitudes/referencias/${id}`).then((r) => r.items ?? []);
}
export function listarActividad(id: number) {
  return request<OrdsFeed<ActividadRow>>(`/solicitudes/actividad/${id}`).then((r) => r.items ?? []);
}

// Cache simple de nombres de cliente por código (evita refetch en la lista).
const clienteCache = new Map<number, string>();

export async function nombresClientes(codigos: number[]): Promise<Map<number, string>> {
  const faltantes = [...new Set(codigos)].filter((c) => !clienteCache.has(c));
  if (faltantes.length > 0) {
    const todos = await listarClientes();
    for (const c of todos) clienteCache.set(c.cod_cliente, c.razon_social);
  }
  const out = new Map<number, string>();
  for (const c of codigos) out.set(c, clienteCache.get(c) ?? `Cliente ${c}`);
  return out;
}

// Crea la solicitud completa de forma secuencial: cabecera -> hijos.
// Si falla a mitad, lanza error indicando el paso (puede quedar data parcial).
export async function crearSolicitud(s: SolicitudCompleta): Promise<{ id: number }> {
  const cab = await request<{ id: number }>("/solicitudes/cabecera", {
    method: "POST",
    body: JSON.stringify(s.cabecera),
  });
  const id = cab.id;

  for (const d of s.detalles) {
    await request(`/solicitudes/detalle/${id}`, { method: "POST", body: JSON.stringify(d) }).catch((e) => {
      throw new Error(`Cabecera creada (id ${id}) pero falló un artículo: ${e.message}`);
    });
  }

  for (const r of s.referencias) {
    await request(`/solicitudes/referencias/${id}`, { method: "POST", body: JSON.stringify(r) }).catch((e) => {
      throw new Error(`Solicitud ${id} creada pero falló una referencia: ${e.message}`);
    });
  }

  if (s.actividad) {
    await request(`/solicitudes/actividad/${id}`, { method: "POST", body: JSON.stringify(s.actividad) }).catch((e) => {
      throw new Error(`Solicitud ${id} creada pero falló la actividad laboral: ${e.message}`);
    });
  }

  return { id };
}
