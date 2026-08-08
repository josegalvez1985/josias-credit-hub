// Impresión del recibo térmico por WebUSB (ESC/POS).
//
// Es el gemelo de `escpos.ts` (Bluetooth): mismo ticket, distinto transporte.
// El formato NO se duplica — se importa `construirRecibo` de ahí, así que si el
// ticket cambia, cambia en los dos a la vez. Este archivo es solo el cable.
//
// ⚠ Windows: cuando se conecta una térmica USB, Windows la reclama con su
// driver de impresión (`usbprint.sys`) y Chrome no puede tomar una interfaz que
// otro driver ya reclamó — `claimInterface()` falla con "Access denied".
//
// Hay dos salidas, y la primera es la que conviene:
//
//   1. `recibo-sistema.ts` — imprime por el driver que Windows YA tiene, con el
//      diálogo de impresión. No hay que configurar nada. Es lo que ofrece el
//      mensaje de error de `traducirError()`.
//   2. Reemplazar el driver por WinUSB con Zadig (https://zadig.akeo.ie/), que
//      habilita este archivo pero deja la impresora inutilizable para el resto
//      del sistema y pide permisos de administrador.
//
// En Android/Linux normalmente anda sin tocar nada.
// El detalle completo está en GUIA-IMPRESION-USB.md.
//
// Como Web Bluetooth, WebUSB exige contexto seguro (HTTPS o localhost) y un
// gesto del usuario para abrir el selector de dispositivos. En iOS no existe.

import { construirRecibo, type DatosTicket, type TipoRecibo } from "./escpos";

// ---------------------------------------------------------------------
// Tipos mínimos de WebUSB, para no depender de @types/w3c-web-usb
// ---------------------------------------------------------------------
type UsbEndpoint = {
  endpointNumber: number;
  direction: "in" | "out";
  packetSize?: number;
};
type UsbAlternate = { interfaceClass: number; endpoints: UsbEndpoint[] };
type UsbInterface = { interfaceNumber: number; claimed: boolean; alternate: UsbAlternate };
type UsbConfiguration = { interfaces: UsbInterface[] };
type UsbDevice = {
  opened: boolean;
  productName?: string;
  manufacturerName?: string;
  configuration: UsbConfiguration | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(n: number): Promise<void>;
  claimInterface(n: number): Promise<void>;
  releaseInterface(n: number): Promise<void>;
  transferOut(endpoint: number, data: BufferSource): Promise<{ status: string; bytesWritten: number }>;
};
type Usb = {
  requestDevice(o: { filters: Array<{ vendorId?: number; productId?: number; classCode?: number }> }): Promise<UsbDevice>;
  getDevices(): Promise<UsbDevice[]>;
};

function usb(): Usb | undefined {
  return (navigator as Navigator & { usb?: Usb }).usb;
}

export function soportaImpresionUsb(): boolean {
  return typeof navigator !== "undefined" && Boolean(usb());
}

// Clase 7 = Printer en la especificación USB. Es el filtro que deja en el
// selector solo lo que puede imprimir; si una impresora no la declara (pasa con
// clones), el usuario no la ve y hay que abrir el selector sin filtros.
const CLASE_IMPRESORA = 7;

// ---------------------------------------------------------------------
// Transporte
// ---------------------------------------------------------------------
// La impresora elegida se guarda en memoria para no volver a mostrar el
// selector en cada impresión de la sesión (igual que en escpos.ts).
let dispositivo: UsbDevice | null = null;
let interfaz: UsbInterface | null = null;
let salida: UsbEndpoint | null = null;

// Traduce los errores de WebUSB a algo que un cobrador pueda accionar. El
// mensaje crudo del navegador ("Access denied.") no dice qué hacer.
function traducirError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);

  if (/access denied|unable to claim/i.test(msg)) {
    // Este es EL error de Windows con las térmicas USB. Antes el mensaje
    // mandaba a cambiar el driver con Zadig, que pide administrador y deja la
    // impresora inservible para el resto del sistema. Ahora se ofrece la vía
    // que no configura nada: imprimir por el driver que Windows ya tiene
    // instalado (botón "Imprimir por Windows" → recibo-sistema.ts).
    return new Error(
      "Windows tiene tomada la impresora con su propio driver. Usá el botón «Imprimir por Windows», que la usa tal cual está.",
    );
  }
  if (/no device selected|cancel/i.test(msg)) {
    // El usuario cerró el selector: no es un error que valga avisar.
    return new Error("cancelado");
  }
  if (/must be handling a user gesture/i.test(msg)) {
    return new Error("Tocá el botón de nuevo para elegir la impresora.");
  }
  return e instanceof Error ? e : new Error(msg);
}

// Abre el selector del navegador. Requiere un gesto del usuario (click): no se
// puede llamar desde un efecto ni al cargar la página.
async function elegirDispositivo(todos: boolean): Promise<UsbDevice> {
  const u = usb();
  if (!u) throw new Error("Este navegador no soporta WebUSB. Usá Chrome o Edge.");

  // Primero se prueba con las que ya dieron permiso en esta sesión/origen: así
  // el cobrador no elige la impresora cada vez que abre la app.
  if (!todos) {
    const conocidos = await u.getDevices().catch(() => [] as UsbDevice[]);
    const previa = conocidos.find((d) =>
      d.configuration?.interfaces.some((i) => i.alternate.interfaceClass === CLASE_IMPRESORA),
    );
    if (previa) return previa;
  }

  // `todos` abre el selector sin filtrar: las térmicas clonadas a veces no
  // declaran la clase 7 y no aparecerían en la lista filtrada.
  return u.requestDevice({ filters: todos ? [] : [{ classCode: CLASE_IMPRESORA }] });
}

async function conectar(todos = false): Promise<{ dev: UsbDevice; ep: UsbEndpoint }> {
  if (dispositivo?.opened && salida) return { dev: dispositivo, ep: salida };

  const dev = dispositivo ?? (await elegirDispositivo(todos));

  if (!dev.opened) await dev.open();
  if (dev.configuration === null) await dev.selectConfiguration(1);

  const conf = dev.configuration;
  if (!conf) throw new Error("La impresora no expone una configuración USB");

  // Se busca la interfaz de impresora; si no la declara, se cae a la primera
  // que tenga un endpoint de salida.
  const iface =
    conf.interfaces.find((i) => i.alternate.interfaceClass === CLASE_IMPRESORA) ??
    conf.interfaces.find((i) => i.alternate.endpoints.some((e) => e.direction === "out"));
  if (!iface) throw new Error("Ese dispositivo no parece una impresora (no tiene salida de datos)");

  if (!iface.claimed) await dev.claimInterface(iface.interfaceNumber);

  const ep = iface.alternate.endpoints.find((e) => e.direction === "out");
  if (!ep) throw new Error("La impresora no expone un endpoint de salida");

  dispositivo = dev;
  interfaz = iface;
  salida = ep;
  return { dev, ep };
}

export async function imprimirUsb(bytes: Uint8Array, todos = false): Promise<void> {
  let dev: UsbDevice;
  let ep: UsbEndpoint;
  try {
    ({ dev, ep } = await conectar(todos));
  } catch (e) {
    // Un fallo al conectar deja el estado a medias: si no se limpia, el próximo
    // intento reusa un dispositivo cerrado y falla por una razón distinta a la real.
    await olvidarImpresoraUsb();
    throw traducirError(e);
  }

  // USB no tiene el problema de MTU del BLE (allá el trozo es de 20 bytes),
  // pero el endpoint sí declara su packetSize y algunas térmicas se atragantan
  // con transferencias grandes de una vez. 4 KB va holgado para un ticket y no
  // requiere pausas entre trozos.
  const TROZO = Math.max(ep.packetSize ?? 64, 64) * 64;
  try {
    for (let i = 0; i < bytes.length; i += TROZO) {
      const r = await dev.transferOut(ep.endpointNumber, bytes.slice(i, i + TROZO));
      if (r.status !== "ok") throw new Error(`La impresora rechazó los datos (${r.status})`);
    }
  } catch (e) {
    throw traducirError(e);
  }
}

// Suelta la impresora guardada para poder elegir otra. Libera la interfaz antes
// de cerrar: si no, Chrome la deja tomada hasta que se recarga la pestaña.
export async function olvidarImpresoraUsb(): Promise<void> {
  const dev = dispositivo;
  const iface = interfaz;
  dispositivo = null;
  interfaz = null;
  salida = null;
  if (!dev) return;
  try {
    if (iface?.claimed) await dev.releaseInterface(iface.interfaceNumber);
    if (dev.opened) await dev.close();
  } catch {
    // Si el dispositivo ya se desconectó, cerrar tira error y no importa: el
    // objetivo era soltar la referencia, y eso ya pasó arriba.
  }
}

// `todos = true` abre el selector sin el filtro de clase 7, para las térmicas
// clonadas que no la declaran y por eso no aparecen en la lista.
export async function imprimirReciboUsb(
  d: DatosTicket,
  tipo: TipoRecibo,
  todos = false,
): Promise<void> {
  await imprimirUsb(construirRecibo(d, tipo), todos);
}
