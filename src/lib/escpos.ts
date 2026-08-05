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

  texto(t: string) {
    for (const c of normalizar(t)) this.bytes.push(c.charCodeAt(0) & 0xff);
    return this;
  }

  linea(t = "") {
    return this.texto(t + "\n");
  }

  avanzar(n: number) {
    this.bytes.push(ESC, 0x64, n); // ESC d n
    return this;
  }

  // GS V 1 (corte parcial). La GO LINK GL033 que se usa en cobranzas no tiene
  // cuchilla —se corta a mano contra la barra dentada— y este comando le pasa
  // de largo. Se deja porque no molesta y otras impresoras sí lo usan, pero el
  // papel que hace falta para llegar a la barra lo tiene que dar `avanzar`.
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

// Mismo contenido y mismo orden que el ticket de la app APEX (página 3,
// acciones IMPRMIR y DUPLICADO).
export function construirRecibo(d: DatosTicket, tipo: TipoRecibo): Uint8Array {
  const t = new Ticket();

  t.iniciar().alinear(CENTRO);
  t.linea("Recibo de dinero");
  t.linea("Josias Muebles");
  t.linea("Todo para el confort del hogar");
  t.linea("RUC:3829408-7");
  t.linea("Cel.: 0981 460091");
  t.linea("0982 178465");
  t.linea("Ruta1 Km 21 Capiata - Paraguay");

  t.alinear(IZQUIERDA);
  t.linea("Nro. de Recibo: " + d.nroRecibo);
  t.linea("Fecha: " + d.fecha);
  t.linea("Gs.: " + d.monto);
  t.linea("Solicitud: " + d.solicitud);
  t.linea("Cobrador: " + d.cobrador);
  t.linea("Cuota: " + d.cuota);
  t.linea("Intereses Gs.: " + d.interes);
  t.linea(
    "Recibi de CI Nro." +
      d.documento +
      ", la suma de guaranies " +
      d.montoLetras +
      ", en concepto de pago de " +
      d.concepto,
  );

  // ORIGINAL / DUPLICADO va centrado y no a la derecha: alineado a la derecha
  // en 58 mm quedaba pegado al borde y era lo primero que se perdía.
  t.linea();
  t.alinear(CENTRO).negrita(true).linea(tipo).negrita(false);
  t.alinear(IZQUIERDA);

  // Entre el cabezal y la barra de corte de la GL033 hay ~3 cm de papel: lo
  // que se imprima en ese tramo queda adentro de la impresora hasta que el
  // siguiente ticket lo empuja, y el pie del recibo termina encabezando el que
  // viene. Estas líneas son las que empujan el pie hasta la barra.
  //
  // Calibrado contra la GL033: con 12 no salía el ORIGINAL, con 24 salía pero
  // sobraban ~8 cm de rollo por recibo. 10 deja el pie justo arriba de la
  // barra, que es donde se corta a mano.
  t.avanzar(10).cortar().pulso();
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
