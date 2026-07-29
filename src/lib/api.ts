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

// Trae TODAS las páginas de un feed ORDS (pagina de 25 por defecto) y filtra el
// término localmente, sin distinguir mayúsculas/minúsculas ni depender del backend.
async function feed<T extends LovItem>(path: string, q?: string): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  for (;;) {
    const sep = path.includes("?") ? "&" : "?";
    const f = await request<OrdsFeed<T> & { hasMore?: boolean }>(
      `${path}${sep}limit=500&offset=${offset}`,
    );
    const items = f.items ?? [];
    out.push(...items);
    if (!f.hasMore || items.length === 0) break;
    offset += items.length;
  }
  const term = (q ?? "").trim();
  if (!term) return out;
  const lower = term.toLowerCase();
  const digits = term.replace(/\D/g, "");
  return out.filter((i) => {
    const texto = Object.values(i)
      .map((v) => String(v ?? ""))
      .join(" ")
      .toLowerCase();
    if (texto.includes(lower)) return true;
    if (!digits) return false;
    return texto.replace(/\D/g, "").includes(digits);
  });
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

// Resuelve descripciones de un LOV por código. Siempre consulta la API (sin cache).
export async function lovLabels(
  tipo: "articulos" | "ciudades" | "vendedores" | "profesiones" | "relaciones",
): Promise<Map<number, string>> {
  const items = await lov[tipo]();
  return new Map(items.map((i) => [i.value, i.label]));
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
  ind_garante: string; // 'S' | 'N' — CHK_VENTAS_REF_GARANTE_SOL solo acepta esos valores
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

// Resuelve nombres de cliente por código. Siempre consulta la API (sin cache).
export async function nombresClientes(codigos: number[]): Promise<Map<number, string>> {
  const nombres = new Map<number, string>();
  // ORDS pagina (25 por defecto); recorremos todas las páginas para no perder ningún cliente.
  let offset = 0;
  for (;;) {
    const feed = await request<OrdsFeed<Cliente> & { hasMore?: boolean }>(
      `/clientes/?limit=500&offset=${offset}`,
    );
    const items = feed.items ?? [];
    for (const c of items) nombres.set(c.cod_cliente, c.razon_social);
    if (!feed.hasMore || items.length === 0) break;
    offset += items.length;
  }
  const out = new Map<number, string>();
  for (const c of codigos) out.set(c, nombres.get(c) ?? `Cliente ${c}`);
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

// ----- Recibos (modulo ORDS "recibos") -----
export type Recibo = {
  nro_recibo: number;
  fecha_recibo: string; // YYYY-MM-DD
  cod_cliente: number;
  nombre: string;
  nro_telefono?: string;
  concepto?: string;
  nro_solicitud: number;
  nro_cuota: number;
  monto: number;
  total_interes?: number;
  id_solicitud: number;
  id_cuota: number;
  anulado: string; // 'S' | 'N'
  cod_usuario?: string;
};

export type ReciboDetalle = Recibo & {
  documento?: string;
  razon_social?: string;
  monto_cuota?: number;
  saldo_cuota?: number;
  fec_vencimiento?: string;
  cuota_texto?: string;
  nombre_usuario?: string;
  monto_letras?: string;
};

export type FiltroRecibos = {
  q?: string;
  desde?: string; // YYYY-MM-DD
  hasta?: string; // YYYY-MM-DD
  anulados?: "S" | "N" | "T"; // T = todos
  limit?: number;
  offset?: number;
};

// A diferencia del resto de la app, recibos NO se trae entero: son 130.000+ filas.
// El servidor pagina y busca; acá solo se arman los query params.
export async function listarRecibos(f: FiltroRecibos = {}) {
  const qs = new URLSearchParams();
  if (f.q?.trim()) qs.set("q", f.q.trim());
  if (f.desde) qs.set("desde", f.desde);
  if (f.hasta) qs.set("hasta", f.hasta);
  if (f.anulados) qs.set("anulados", f.anulados);
  qs.set("limit", String(f.limit ?? 50));
  qs.set("offset", String(f.offset ?? 0));
  const r = await request<{ items: Recibo[]; hasMore?: boolean }>(`/recibos/?${qs}`);
  return { items: r.items ?? [], hasMore: Boolean(r.hasMore) };
}

// La PK es (nro_recibo, id_solicitud, id_cuota), asi que el backend devuelve una
// lista. En la practica es una sola fila.
export async function obtenerRecibo(nroRecibo: number) {
  const r = await request<{ items: ReciboDetalle[] }>(`/recibos/${nroRecibo}`);
  return r.items?.[0] ?? null;
}

export type ReciboInput = {
  cod_cliente: number;
  id_solicitud: number;
  id_cuota: number;
  monto: number;
  fecha_recibo?: string; // YYYY-MM-DD; si falta, el backend usa SYSDATE
  concepto?: string;
};

// cod_usuario lo pone el backend desde el token, no se manda.
export function crearRecibo(r: ReciboInput) {
  return request<{ nro_recibo: number }>("/recibos/", {
    method: "POST",
    body: JSON.stringify(r),
  });
}

export type ReciboPk = { nro_recibo: number; id_solicitud: number; id_cuota: number };

export function actualizarRecibo(pk: ReciboPk, cambios: { monto: number; concepto?: string; fecha_recibo?: string }) {
  return request("/recibos/", { method: "PUT", body: JSON.stringify({ ...pk, ...cambios }) });
}

// anulado 'S' anula y devuelve el saldo a la cuota; 'N' reactiva el recibo.
export function anularRecibo(pk: ReciboPk, anulado: "S" | "N" = "S") {
  return request("/recibos/anular", { method: "POST", body: JSON.stringify({ ...pk, anulado }) });
}

// LOVs en cascada del alta: cliente -> solicitud -> cuota.
export const lovRecibos = {
  clientes: buscarClientesRecibos,
  // Todos los clientes, sin filtro de deuda. Es el LOV de ubicaciones (pág. 5).
  clientesTodos: (q?: string) =>
    todosLosClientes("/recibos/lov/clientes-todos").then((all) => filtrarLov(all, q)),
  solicitudes: (codCliente: number) =>
    request<OrdsFeed<LovItem & { nro_solicitud: number; saldo_total: number }>>(
      `/recibos/lov/solicitudes/${codCliente}?limit=500`,
    ).then((r) => r.items ?? []),
  // conSaldo deja solo las cuotas con saldo pendiente: así lo hace el LOV de
  // derivaciones (página 4). El de recibos (página 3) las trae todas.
  cuotas: (idSolicitud: number, conSaldo = false) =>
    request<OrdsFeed<CuotaLov>>(
      `/recibos/lov/cuotas/${idSolicitud}?limit=500${conSaldo ? "&con_saldo=S" : ""}`,
    ).then((r) => r.items ?? []),
};

export type ClienteRecibosLov = LovItem & {
  ci?: string;
  ruc?: string;
  nro_telefono?: string;
  nombre_fantasia?: string;
  ubicacion?: string; // solo lo trae lov/clientes-todos
};

// Filtra un LOV por cualquiera de sus campos, sin distinguir mayúsculas.
// Para números compara solo dígitos de los dos lados, así "1.554" encuentra al
// CI "1.554.321" esté guardado con puntos o sin ellos.
//
// Va del lado del cliente a propósito: `q` es un parámetro RESERVADO de ORDS
// (lo usa para su filtro JSON `?q={"col":"valor"}`), así que mandarlo como
// query param no llega nunca al bind del handler. Es el mismo patrón que usan
// `feed()` y `buscarClientesLov` para los LOVs de solicitudes.
export function filtrarLov<T extends LovItem>(items: T[], q?: string): T[] {
  const term = (q ?? "").trim().toLowerCase();
  if (!term) return items;
  const digits = term.replace(/\D/g, "");
  return items.filter((i) => {
    const texto = Object.values(i)
      .map((v) => String(v ?? ""))
      .join(" ")
      .toLowerCase();
    if (texto.includes(term)) return true;
    return digits ? texto.replace(/\D/g, "").includes(digits) : false;
  });
}

// Recorre las páginas de ORDS de un LOV de clientes y devuelve la lista entera.
async function todosLosClientes(path: string): Promise<ClienteRecibosLov[]> {
  const out: ClienteRecibosLov[] = [];
  let offset = 0;
  for (;;) {
    const f = await request<OrdsFeed<ClienteRecibosLov> & { hasMore?: boolean }>(
      `${path}?limit=500&offset=${offset}`,
    );
    const items = f.items ?? [];
    out.push(...items);
    if (!f.hasMore || items.length === 0) break;
    offset += items.length;
  }
  return out;
}

async function buscarClientesRecibos(q?: string): Promise<ClienteRecibosLov[]> {
  return filtrarLov(await todosLosClientes("/recibos/lov/clientes"), q);
}

export type CuotaLov = LovItem & {
  nro_cuota: number;
  monto_cuota: number;
  saldo_cuota: number;
  fec_vencimiento?: string;
  fec_derivacion?: string;
};

// Ficha del cliente para la pantalla de consulta (página 10 de APEX).
export type FichaCliente = {
  cod_cliente: number;
  razon_social?: string;
  documento?: string;
  nro_telefono?: string;
  ciudad?: string;
  direccion?: string;
  nro_casa?: number;
  ubicacion?: string;
};

// Vive en el módulo ORDS `consultas` (backend/consultas.sql), no en `recibos`:
// el handler viejo `/recibos/cliente/:cod_cliente` respondía sin cabeceras y el
// navegador lo reportaba como error de CORS. Mismo SELECT, módulo independiente.
export function fichaCliente(codCliente: number) {
  return request<FichaCliente>(`/consultas/cliente/${codCliente}`);
}

// Guarda el link de Google Maps del domicilio del cliente (CLIENTES.UBICACION).
export function guardarUbicacion(codCliente: number, ubicacion: string) {
  return request("/recibos/ubicacion", {
    method: "POST",
    body: JSON.stringify({ cod_cliente: codCliente, ubicacion }),
  });
}

// Marca la fecha en que la cuota pasó a gestión de cobranza (VENTAS_CUOTAS.FEC_DERIVACION).
export function derivarCuota(idSolicitud: number, idCuota: number, fechaDerivacion: string) {
  return request("/recibos/derivar", {
    method: "POST",
    body: JSON.stringify({
      id_solicitud: idSolicitud,
      id_cuota: idCuota,
      fecha_derivacion: fechaDerivacion,
    }),
  });
}

// Saldo, interes, vencimiento y concepto sugerido de una cuota.
// Equivale a la accion dinamica CALCULOS de la pagina 3 de APEX.
export type DatosCuota = {
  saldo_cuota: number;
  total_interes: number;
  fec_vencimiento?: string;
  concepto?: string;
  cuota_texto?: string;
};

export function datosCuota(codCliente: number, idSolicitud: number, idCuota: number) {
  return request<DatosCuota>(`/recibos/cuota/${codCliente}/${idSolicitud}/${idCuota}`);
}

// NUM_LETRAS vive en Oracle; no se reimplementa en JS para que el recibo impreso
// diga exactamente lo mismo que el de la app vieja.
export function montoEnLetras(monto: number) {
  return request<{ monto_letras: string }>(`/recibos/letras/${monto}`).then((r) => r.monto_letras);
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
