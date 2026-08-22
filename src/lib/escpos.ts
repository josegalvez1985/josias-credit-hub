// Impresión del recibo térmico por Web Bluetooth (ESC/POS).
//
// Reemplaza al plugin ConectorEscposAndroid que usaba la app APEX contra
// http://localhost:8000 con una licencia y la MAC guardada en USUARIOS_IMPRESORAS.
// Acá el navegador habla directo con la impresora: no hace falta app intermedia,
// ni licencia, ni la tabla.
//
// Solo funciona en Chrome/Edge sobre Android y en contexto seguro (HTTPS o
// localhost). En iOS Safari no existe Web Bluetooth.

// ---------------------------------------------------------------------
// Tipos mínimos de Web Bluetooth, para no depender de @types/web-bluetooth
// ---------------------------------------------------------------------
type BleCharacteristic = {
  properties: { write: boolean; writeWithoutResponse: boolean };
  writeValue(v: BufferSource): Promise<void>;
  writeValueWithoutResponse?(v: BufferSource): Promise<void>;
};
type BleService = { getCharacteristics(): Promise<BleCharacteristic[]> };
type BleServer = { connected: boolean; getPrimaryServices(): Promise<BleService[]> };
type BleDevice = { name?: string; gatt?: { connect(): Promise<BleServer>; connected: boolean } };
type Bluetooth = {
  requestDevice(o: { acceptAllDevices?: boolean; optionalServices?: unknown[] }): Promise<BleDevice>;
};

function bluetooth(): Bluetooth | undefined {
  return (navigator as Navigator & { bluetooth?: Bluetooth }).bluetooth;
}

export function soportaImpresion(): boolean {
  return typeof navigator !== "undefined" && Boolean(bluetooth());
}

// Servicios GATT de las impresoras térmicas más comunes. Web Bluetooth exige
// declararlos de antemano: un servicio que no esté acá es inaccesible aunque la
// impresora lo exponga. Si aparece una que no anda, agregar su UUID.
const SERVICIOS: unknown[] = [
  0x18f0, // Goojprt, MPT-II y la mayoría de las 58 mm
  0xff00, // clones varios
  0xffe0, // módulos HM-10
  "49535343-fe7d-4ae5-8fa9-9fafd205e455", // ISSC / BLE serial (Microchip)
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2", // RN4870
  "000018f0-0000-1000-8000-00805f9b34fb",
];

// ---------------------------------------------------------------------
// Comandos ESC/POS
// ---------------------------------------------------------------------
const ESC = 0x1b;
const GS = 0x1d;

const IZQUIERDA = 0;
const CENTRO = 1;
const DERECHA = 2;

// Ancho del papel en caracteres, a tamaño normal. 58 mm = 32 columnas en la
// fuente A de la GL033 (80 mm serían 48). Es el número con el que se calcula el
// relleno de las filas "etiqueta ....... valor": si se cambia de rollo hay que
// cambiarlo acá y todo el ticket se reacomoda solo.
const COLUMNAS = 32;

// GS ! n — tamaño de caracter. El byte es un par de nibbles: los 4 bits altos
// multiplican el ANCHO y los 4 bajos el ALTO (0 = x1, 1 = x2…).
//
// El doble ALTO es gratis en columnas: sigue entrando lo mismo por línea, solo
// que se lee al doble de tamaño. El doble ANCHO en cambio parte las columnas al
// medio (32 → 16 en 58 mm), por eso se reserva para el TOTAL, que es corto.
const NORMAL = 0x00;
const ALTO = 0x01; // x1 ancho, x2 alto
const GRANDE = 0x11; // x2 ancho, x2 alto

// Las impresoras térmicas baratas no tienen una tabla de códigos confiable: un
// acento sale como basura. El ticket original de APEX ya estaba escrito sin
// acentos ("guaranies", "Capiata", "Recibi"), así que se sigue esa línea y se
// normaliza todo lo que venga de la base (el concepto, sobre todo).
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ñ/g, "n")
    .replace(/Ñ/g, "N")
    .replace(/[^\x20-\x7e\n]/g, "");
}

class Ticket {
  private bytes: number[] = [];

  iniciar() {
    this.bytes.push(ESC, 0x40); // ESC @ — reset
    return this;
  }

  alinear(modo: number) {
    this.bytes.push(ESC, 0x61, modo); // ESC a n
    return this;
  }

  negrita(on: boolean) {
    this.bytes.push(ESC, 0x45, on ? 1 : 0); // ESC E n
    return this;
  }

  // Tamaño de caracter. Ver las constantes NORMAL / ALTO / GRANDE arriba.
  tamano(n: number) {
    this.bytes.push(GS, 0x21, n); // GS ! n
    return this;
  }

  texto(t: string) {
    for (const c of normalizar(t)) this.bytes.push(c.charCodeAt(0) & 0xff);
    return this;
  }

  linea(t = "") {
    return this.texto(t + "\n");
  }

  // Fila "etiqueta ........ valor": la etiqueta pegada a la izquierda, el valor
  // al borde derecho y puntos rellenando el medio. Es lo que hace que el ticket
  // se lea en dos columnas como el visor HTML, en vez de texto corrido.
  //
  // `columnas` NO es siempre COLUMNAS: a doble ancho entran la mitad, así que
  // quien imprime en grande tiene que pasar el número que corresponda.
  //
  // Si etiqueta + valor no entran en una línea, el valor baja a la siguiente
  // alineado a la derecha: cortarlo sería perder un dato del recibo.
  fila(etiqueta: string, valor: string, columnas = COLUMNAS) {
    const e = normalizar(etiqueta);
    const v = normalizar(valor);
    const hueco = columnas - e.length - v.length;

    if (hueco < 1) {
      this.linea(e);
      return this.linea(v.length >= columnas ? v : v.padStart(columnas));
    }
    // Un espacio a cada lado de los puntos, para que no se peguen al texto.
    const puntos = hueco >= 3 ? " " + ".".repeat(hueco - 2) + " " : " ".repeat(hueco);
    return this.linea(e + puntos + v);
  }

  // Separador. Guiones y no el caracter de línea de la tabla de códigos: en las
  // térmicas clonadas esa tabla no es confiable y sale basura (mismo motivo por
  // el que `normalizar()` saca los acentos).
  regla(columnas = COLUMNAS) {
    return this.linea("-".repeat(columnas));
  }

  // Parte un texto largo en líneas de `columnas` sin cortar palabras al medio.
  // El monto en letras ("trescientos cincuenta mil guaranies") no entra en 32
  // caracteres, y sin esto la impresora lo corta donde le toca.
  parrafo(texto: string, columnas = COLUMNAS) {
    let linea = "";
    for (const palabra of normalizar(texto).split(/\s+/).filter(Boolean)) {
      const prueba = linea ? linea + " " + palabra : palabra;
      if (prueba.length > columnas && linea) {
        this.linea(linea);
        linea = palabra;
      } else {
        linea = prueba;
      }
    }
    if (linea) this.linea(linea);
    return this;
  }

  // ⚠ Sin uso: no se logró que moviera el papel de forma reproducible en la
  // GL033 (probado con n = 10, 12 y 22). El avance del pie se hace con
  // `linea()`, que sí funciona (ver `construirRecibo`). Se deja por si otra
  // impresora lo respeta, pero medir antes de confiar.
  avanzar(n: number) {
    this.bytes.push(ESC, 0x64, n); // ESC d n
    return this;
  }

  // ⚠ GS V 1 (corte parcial). La GL033 no tiene cuchilla —se corta a mano
  // contra la barra dentada— y además interpreta este comando como un avance
  // fijo de varios centímetros, o sea papel desperdiciado en cada recibo. Por
  // eso `construirRecibo` NO lo usa.
  cortar() {
    this.bytes.push(GS, 0x56, 0x01);
    return this;
  }

  // Abre el cajón si está conectado. El original hacía Pulso(48, 60, 120).
  pulso() {
    this.bytes.push(ESC, 0x70, 0x00, 60, 120); // ESC p m t1 t2
    return this;
  }

  build(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}

// ---------------------------------------------------------------------
// El recibo
// ---------------------------------------------------------------------
export type DatosTicket = {
  nroRecibo: number | string;
  fecha: string; // ya formateada, dd/mm/aaaa
  monto: string; // ya formateado con separador de miles
  documento: string; // CI o RUC del cliente
  montoLetras: string;
  concepto: string;
  solicitud: number | string;
  cuota: string;
  cobrador: string;
  interes: string;
};

export type TipoRecibo = "ORIGINAL" | "DUPLICADO";

// Mismo contenido y mismo orden que el visor HTML de `recibo-sistema.ts`: los
// dos son EL MISMO recibo por vías distintas, así que se leen igual.
//
// Antes esto era una tirada de `linea()` a tamaño base: letra chica y todo el
// contenido corrido uno bajo otro, sin columnas. Ahora:
//
//   · todo el cuerpo va a doble ALTO (`ALTO`), que no cuesta columnas;
//   · los datos van en filas "etiqueta ..... valor" como en el visor;
//   · el TOTAL va a doble alto Y ancho (`GRANDE`), que es el dato que el
//     cobrador y el cliente miran primero.
//
// ⚠ Ojo con las columnas: a doble ancho entran la MITAD (16 en 58 mm). Por eso
// las filas del TOTAL pasan `COLUMNAS / 2` — si se las deja en 32, el relleno
// de puntos se calcula para una línea que no existe y el valor se va al renglón
// siguiente.
export function construirRecibo(d: DatosTicket, tipo: TipoRecibo): Uint8Array {
  const t = new Ticket();
  const MITAD = COLUMNAS / 2;

  // ---- Cabecera: nombre grande, datos de contacto en chico ----
  t.iniciar().alinear(CENTRO);
  t.tamano(GRANDE).negrita(true).linea("JOSIAS MUEBLES").negrita(false);
  t.tamano(NORMAL);
  t.linea("Todo para el confort del hogar");
  t.linea("RUC: 3829408-7");
  t.linea("Cel.: 0981 460091 / 0982 178465");
  t.linea("Ruta 1 Km 21 Capiata - Paraguay");

  t.tamano(ALTO).negrita(true).linea("RECIBO " + tipo).negrita(false);
  t.tamano(NORMAL).regla();

  // ---- Datos del recibo, en dos columnas ----
  t.alinear(IZQUIERDA).tamano(ALTO);
  t.fila("Recibo N", String(d.nroRecibo));
  t.fila("Fecha", d.fecha);
  if (d.documento) t.fila("CI", d.documento);
  t.fila("Solicitud", String(d.solicitud));
  t.fila("Cuota", d.cuota);
  // El interés solo aparece si existe, igual que en el visor: una fila
  // "Interes .... 0" en todos los recibos es ruido.
  if (d.interes && d.interes !== "0") t.fila("Interes Gs.", d.interes);
  if (d.cobrador) t.fila("Cobrador", d.cobrador);

  t.tamano(NORMAL).regla();

  // ---- TOTAL: lo más grande del ticket ----
  t.tamano(GRANDE).negrita(true);
  t.fila("TOTAL", d.monto, MITAD);
  t.negrita(false).tamano(NORMAL);

  // El monto en letras va a tamaño base: es la línea más larga del recibo y a
  // doble alto ocupaba media hoja para algo que casi nadie lee.
  if (d.montoLetras) {
    t.linea();
    t.parrafo("Son: " + d.montoLetras + " guaranies");
  }

  // ---- Concepto ----
  if (d.concepto) {
    t.regla();
    t.tamano(ALTO).linea("Concepto:").tamano(NORMAL);
    t.parrafo(d.concepto);
  }

  t.regla();

  // La última línea se imprime en el cabezal, que está unos centímetros antes
  // de la barra de corte. Ese tramo hay que empujarlo o el final del recibo
  // queda dentro de la impresora y sale recién con el ticket siguiente,
  // encabezándolo — con el recibo entero desfasado un turno.
  //
  // El avance va con saltos de línea, no con `avanzar()` (`ESC d n`): con este
  // último no se logró mover el papel de forma reproducible en la GL033.
  //
  // Calibrado contra la GL033 con impresiones reales:
  //   8 → el ticket sale entero (valor actual)
  //   5 → el pie queda sobre la barra de corte
  // Ojo al medir: si la impresora viene de una tanda de pruebas fallidas, hay
  // que apagarla y prenderla antes, o el buffer sucio confunde el resultado.
  // Si se cambia de modelo, repetir: subir hasta que el pie salga en el mismo
  // ticket, después bajar hasta que deje de sobrar papel.
  //
  // ⚠ Se avanza a tamaño NORMAL a propósito: con `ALTO` activo cada salto mide
  // el doble y el papel se va al doble de lo calibrado.
  //
  // ⚠ Si el recibo sale cortado, fijarse PRIMERO por qué vía se imprimió. Este
  // ESC/POS y el HTML de recibo-sistema.ts ahora imprimen el MISMO texto
  // ("RECIBO ORIGINAL", "Son: …"), así que ya no se distinguen por el
  // contenido: se distinguen por el botón que se apretó. Si fue «Impresora
  // instalada en Windows», el corte lo causa el @page de recibo-sistema.ts y
  // subir este número no cambia nada.
  for (let i = 0; i < 8; i++) t.linea();

  // Sin `cortar()`: la GL033 no tiene cuchilla y además interpreta GS V como
  // un avance fijo de varios centímetros, que era la mitad del papel que
  // sobraba cuando el ticket sí salía completo.
  t.pulso();
  return t.build();
}

// ---------------------------------------------------------------------
// Transporte
// ---------------------------------------------------------------------
// La impresora elegida se guarda en memoria para no volver a mostrar el
// selector en cada impresión de la sesión.
let dispositivo: BleDevice | null = null;
let canal: BleCharacteristic | null = null;

async function conectar(): Promise<BleCharacteristic> {
  const ble = bluetooth();
  if (!ble) throw new Error("Este navegador no soporta Bluetooth. Usá Chrome en Android.");

  if (canal && dispositivo?.gatt?.connected) return canal;

  if (!dispositivo) {
    dispositivo = await ble.requestDevice({ acceptAllDevices: true, optionalServices: SERVICIOS });
  }
  if (!dispositivo.gatt) throw new Error("El dispositivo no expone GATT");

  const server = await dispositivo.gatt.connect();

  // En vez de asumir un UUID, se recorren los servicios y se toma la primera
  // característica que permita escribir. Es lo que hace que ande con impresoras
  // de marcas distintas sin tener que mantener una lista de modelos.
  for (const servicio of await server.getPrimaryServices()) {
    for (const c of await servicio.getCharacteristics()) {
      if (c.properties.write || c.properties.writeWithoutResponse) {
        canal = c;
        return c;
      }
    }
  }
  throw new Error("No se encontró una impresora compatible en ese dispositivo");
}

export async function imprimir(bytes: Uint8Array): Promise<void> {
  const c = await conectar();

  // BLE manda de a poco: los paquetes grandes se pierden en silencio.
  //
  // El trozo va a 20 bytes porque ese es el payload mínimo garantizado de una
  // notificación BLE (MTU 23 - 3 de cabecera). Muchas térmicas baratas nunca
  // negocian un MTU mayor y descartan sin avisar lo que exceda ese tamaño; el
  // síntoma es que se pierde el final del ticket, que es donde va el corte.
  const TROZO = 20;
  for (let i = 0; i < bytes.length; i += TROZO) {
    const parte = bytes.slice(i, i + TROZO);
    if (c.properties.writeWithoutResponse && c.writeValueWithoutResponse) {
      await c.writeValueWithoutResponse(parte);
    } else {
      await c.writeValue(parte);
    }
    await new Promise((r) => setTimeout(r, 20));
  }

  // writeValueWithoutResponse no espera confirmación: retorna cuando el byte
  // salió del navegador, no cuando la impresora lo imprimió. Sin esta pausa,
  // el cierre del GATT (o una segunda impresión) puede llegar antes de que
  // vacíe el buffer y el ticket queda cortado a la mitad.
  await new Promise((r) => setTimeout(r, 400));
}

// Suelta la impresora guardada para poder elegir otra.
export function olvidarImpresora() {
  dispositivo = null;
  canal = null;
}

export async function imprimirRecibo(d: DatosTicket, tipo: TipoRecibo): Promise<void> {
  await imprimir(construirRecibo(d, tipo));
}
