// Cliente HTTP para el backend ORDS (modulo "solicitudes").
import { getStoredToken, getStoredUsername } from "./auth";

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

function authHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// El AuthProvider registra aquí cómo cerrar sesión; así api.ts (que no es React)
// puede expulsar al usuario cuando el token expira sin importar el componente.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

function handleUnauthorized() {
  if (onUnauthorized) onUnauthorized();
  else if (typeof window !== "undefined") {
    window.location.href = `${import.meta.env.BASE_URL}login`;
  }
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

  if (res.status === 401 || res.status === 403) {
    handleUnauthorized();
    throw new Error("Sesión expirada. Vuelve a iniciar sesión.");
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

// Trae TODAS las páginas de un feed ORDS (pagina de 25 por defecto).
async function feed<T>(path: string, q?: string): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  for (;;) {
    const sep = path.includes("?") ? "&" : "?";
    const qParam = q ? `&q=${encodeURIComponent(q)}` : "";
    const f = await request<OrdsFeed<T> & { hasMore?: boolean }>(
      `${path}${sep}limit=500&offset=${offset}${qParam}`,
    );
    const items = f.items ?? [];
    out.push(...items);
    if (!f.hasMore || items.length === 0) break;
    offset += items.length;
  }
  return out;
}

type ClienteLov = LovItem & { nombre_fantasia?: string; ci?: string; ruc?: string };

// Trae TODOS los clientes del LOV recorriendo las páginas de ORDS (25 por defecto).
async function todosClientesLov(): Promise<ClienteLov[]> {
  const out: ClienteLov[] = [];
  let offset = 0;
  for (;;) {
    const f = await request<OrdsFeed<ClienteLov> & { hasMore?: boolean }>(
      `/solicitudes/lov/clientes?limit=500&offset=${offset}`,
    );
    const items = f.items ?? [];
    out.push(...items);
    if (!f.hasMore || items.length === 0) break;
    offset += items.length;
  }
  return out;
}

// Busca clientes por cualquier campo del LOV. Para números (CI/RUC) compara solo
// dígitos en ambos lados, así "4169298" encuentra a "4.169.298" y viceversa.
async function buscarClientesLov(q?: string): Promise<ClienteLov[]> {
  const all = await todosClientesLov();
  const term = (q ?? "").trim();
  if (!term) return all;
  const digits = term.replace(/\D/g, "");
  const lower = term.toLowerCase();
  return all.filter((c) => {
    const texto = Object.values(c)
      .map((v) => String(v ?? ""))
      .join(" ")
      .toLowerCase();
    if (texto.includes(lower)) return true;
    if (!digits) return false;
    const soloDigitos = texto.replace(/\D/g, "");
    return soloDigitos.includes(digits);
  });
}

export const lov = {
  clientes: buscarClientesLov,
  ciudades: (q?: string) => feed<LovItem>("/solicitudes/lov/ciudades", q),
  vendedores: (q?: string) => feed<LovItem>("/solicitudes/lov/vendedores", q),
  articulos: (q?: string) => feed<LovItem & { cod_unidad_medida?: number }>("/solicitudes/lov/articulos", q),
  profesiones: (q?: string) => feed<LovItem>("/solicitudes/lov/profesiones", q),
  relaciones: (q?: string) => feed<LovItem>("/solicitudes/lov/relaciones", q),
};

// Resuelve descripciones de un LOV por código, cacheando la lista completa.
const lovCache: Record<string, Map<number, string>> = {};

export async function lovLabels(
  tipo: "articulos" | "ciudades" | "vendedores" | "profesiones" | "relaciones",
): Promise<Map<number, string>> {
  if (!lovCache[tipo]) {
    const items = await lov[tipo]();
    lovCache[tipo] = new Map(items.map((i) => [i.value, i.label]));
  }
  return lovCache[tipo];
}

// ----- Solicitud (cabecera + hijos) -----
export type CabeceraInput = {
  nro_solicitud: null;
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
  cod_usuario?: string; // username logueado; el handler ORDS lo inserta y lo retorna
};

export type DetalleInput = {
  cod_articulo: number;
  cantidad: number;
  precio_unitario: number;
};

export type ReferenciaInput = {
  relacion: number; // cod_relacion; el handler ORDS bindea :relacion
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
  actividades: ActividadInput[];
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
// ORDS pagina (25 por defecto); recorremos todas las páginas para no pasar por alto un CI.
export async function ciExiste(ci: string): Promise<boolean> {
  const norm = (v: string) => v.replace(/\D/g, "");
  const target = norm(ci);
  let offset = 0;
  for (;;) {
    const feed = await request<OrdsFeed<Cliente> & { hasMore?: boolean; limit?: number }>(
      `/clientes/?limit=500&offset=${offset}`,
    );
    const items = feed.items ?? [];
    if (items.some((c) => norm(c.ci ?? "") === target)) return true;
    if (!feed.hasMore || items.length === 0) return false;
    offset += items.length;
  }
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

export type Cabecera = CabeceraInput & { id: number; estado?: string; cod_usuario?: string };

// Solo devuelve las cabeceras del usuario logueado. Filtro client-side por
// cod_usuario: el feed ORDS retorna esa columna y el login solo expone el username.
export async function listarCabeceras() {
  const { items = [] } = await request<OrdsFeed<Cabecera>>("/solicitudes/cabecera");
  const me = getStoredUsername();
  if (!me) return items;
  return items.filter((c) => (c.cod_usuario ?? "").toUpperCase() === me.toUpperCase());
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
    // ORDS pagina (25 por defecto); recorremos todas las páginas para no perder ningún cliente.
    let offset = 0;
    for (;;) {
      const feed = await request<OrdsFeed<Cliente> & { hasMore?: boolean }>(
        `/clientes/?limit=500&offset=${offset}`,
      );
      const items = feed.items ?? [];
      for (const c of items) clienteCache.set(c.cod_cliente, c.razon_social);
      if (!feed.hasMore || items.length === 0) break;
      offset += items.length;
    }
  }
  const out = new Map<number, string>();
  for (const c of codigos) out.set(c, clienteCache.get(c) ?? `Cliente ${c}`);
  return out;
}

// ----- Precios de venta (vista V_PRECIOS_VENTAS) -----
export type PrecioVenta = {
  cod_articulo: number;
  nombre_articulo: string;
  precio_unitario: number;
  id_lista_precio: number;
  lista_precio: string;
  cantidad_cuotas: number;
  porcentaje: number;
  precio_con_recargo: number;
  valor_cuota: number | null;
};

// Trae todas las filas de precios paginando (ORDS pagina de 25 por defecto).
export async function listarPrecios(): Promise<PrecioVenta[]> {
  const out: PrecioVenta[] = [];
  let offset = 0;
  for (;;) {
    const feed = await request<OrdsFeed<PrecioVenta> & { hasMore?: boolean }>(
      `/solicitudes/precios?limit=500&offset=${offset}`,
    );
    const items = feed.items ?? [];
    out.push(...items);
    if (!feed.hasMore || items.length === 0) break;
    offset += items.length;
  }
  return out;
}

// Crea la solicitud completa de forma secuencial: cabecera -> hijos.
// Si falla a mitad, lanza error indicando el paso (puede quedar data parcial).
export async function crearSolicitud(s: SolicitudCompleta): Promise<{ id: number }> {
  const cab = await request<{ id: number }>("/solicitudes/cabecera", {
    method: "POST",
    body: JSON.stringify({ ...s.cabecera, cod_usuario: getStoredUsername() }),
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

  for (const a of s.actividades) {
    await request(`/solicitudes/actividad/${id}`, { method: "POST", body: JSON.stringify(a) }).catch((e) => {
      throw new Error(`Solicitud ${id} creada pero falló la actividad laboral: ${e.message}`);
    });
  }

  return { id };
}
