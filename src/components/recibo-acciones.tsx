import { useState } from "react";
import { Printer, Copy, MessageCircle, Loader2, Send, Check, Usb, Bluetooth } from "lucide-react";
import { imprimirRecibo, soportaImpresion, type DatosTicket } from "@/lib/escpos";
import { imprimirReciboUsb, olvidarImpresoraUsb, soportaImpresionUsb } from "@/lib/escpos-usb";
import { imprimirReciboSistema } from "@/lib/recibo-sistema";
import type { ReciboDetalle } from "@/lib/api";
import {
  abrirWhatsApp,
  copiarImagen,
  descargarImagen,
  dibujarRecibo,
  normalizarTelefono,
  soportaCopiarImagen,
  telefonoValido,
} from "@/lib/recibo-whatsapp";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

// Arma el ticket para imprimir o mandar por WhatsApp. Los importes van con
// separador de miles y sin símbolo, como en el ticket de APEX ("Gs.: 350.000").
export function ticketDesdeRecibo(d: ReciboDetalle): DatosTicket {
  const fecha = new Date(d.fecha_recibo);
  return {
    nroRecibo: d.nro_recibo,
    fecha: isNaN(fecha.getTime())
      ? d.fecha_recibo
      : fecha.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" }),
    monto: d.monto.toLocaleString("es-PY"),
    documento: d.documento ?? "",
    montoLetras: d.monto_letras ?? "",
    concepto: d.concepto ?? "",
    solicitud: d.nro_solicitud,
    cuota: d.cuota_texto ?? String(d.nro_cuota),
    cobrador: d.nombre_usuario ?? d.cod_usuario ?? "",
    interes: (d.total_interes ?? 0).toLocaleString("es-PY"),
  };
}

// Las tres acciones de la página 3 de APEX: Original, Duplicado y WhatsApp,
// más la impresión por USB (WebUSB), que APEX no tenía.
export function ReciboAcciones({
  datos,
  telefono,
}: {
  datos: DatosTicket;
  telefono?: string | null;
}) {
  const [imprimiendo, setImprimiendo] = useState<"ORIGINAL" | "DUPLICADO" | null>(null);
  const [imprimiendoUsb, setImprimiendoUsb] = useState<"ORIGINAL" | "DUPLICADO" | null>(null);
  const [abierto, setAbierto] = useState(false);

  async function imprimir(tipo: "ORIGINAL" | "DUPLICADO") {
    setImprimiendo(tipo);
    try {
      await imprimirRecibo(datos, tipo);
      toast.success(`${tipo === "ORIGINAL" ? "Original" : "Duplicado"} enviado a la impresora`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al imprimir";
      // Cancelar el selector de dispositivos no es un error que valga avisar.
      if (!/cancel|user gesture|chooser/i.test(msg)) toast.error(msg);
    } finally {
      setImprimiendo(null);
    }
  }

  // Mismo ticket que el Bluetooth (comparten `construirRecibo`), otro cable.
  // `todos` abre el selector sin el filtro de clase 7, para las térmicas
  // clonadas que no la declaran y por eso no aparecen en la lista.
  async function imprimirPorUsb(tipo: "ORIGINAL" | "DUPLICADO", todos = false) {
    setImprimiendoUsb(tipo);
    try {
      await imprimirReciboUsb(datos, tipo, todos);
      toast.success(`${tipo === "ORIGINAL" ? "Original" : "Duplicado"} enviado por USB`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al imprimir";
      if (msg !== "cancelado") toast.error(msg);
    } finally {
      setImprimiendoUsb(null);
    }
  }

  // Imprime por el driver que el sistema ya tiene instalado. Es la vía que no
  // necesita configurar nada: sirve cuando WebUSB falla con "Access denied"
  // porque Windows tiene la impresora tomada con `usbprint.sys`.
  function imprimirPorSistema(tipo: "ORIGINAL" | "DUPLICADO") {
    try {
      imprimirReciboSistema(datos, tipo);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al abrir la impresión");
    }
  }

  const puedeImprimir = soportaImpresion();
  const puedeImprimirUsb = soportaImpresionUsb();
  const ocupado = imprimiendo !== null || imprimiendoUsb !== null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => imprimir("ORIGINAL")}
          disabled={ocupado || !puedeImprimir}
          className="flex-1"
        >
          {imprimiendo === "ORIGINAL" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Printer className="h-4 w-4" />
          )}
          Original
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={() => imprimir("DUPLICADO")}
          disabled={ocupado || !puedeImprimir}
          className="flex-1"
        >
          {imprimiendo === "DUPLICADO" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
          Duplicado
        </Button>

        <Button
          type="button"
          onClick={() => setAbierto(true)}
          className="flex-1 bg-[#25D366] text-white hover:opacity-90"
        >
          <MessageCircle className="h-4 w-4" /> WhatsApp
        </Button>
      </div>

      {/* Impresión por USB. Va en su propia fila, rotulada, para que no se
          confunda con los botones de Bluetooth de arriba: son la misma acción
          por dos cables distintos y el cobrador tiene que saber cuál toca. */}
      {puedeImprimirUsb && (
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Usb className="h-3.5 w-3.5" /> Impresora por cable USB
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => imprimirPorUsb("ORIGINAL")}
              disabled={ocupado}
              className="flex-1"
            >
              {imprimiendoUsb === "ORIGINAL" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Printer className="h-4 w-4" />
              )}
              Original USB
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={() => imprimirPorUsb("DUPLICADO")}
              disabled={ocupado}
              className="flex-1"
            >
              {imprimiendoUsb === "DUPLICADO" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              Duplicado USB
            </Button>
          </div>

          {/* Escape para dos casos que si no dejan al cobrador trabado: la
              impresora clonada que no aparece en el selector, y la impresora
              equivocada ya elegida en esta sesión. */}
          <button
            type="button"
            onClick={async () => {
              await olvidarImpresoraUsb();
              await imprimirPorUsb("ORIGINAL", true);
            }}
            disabled={ocupado}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
          >
            ¿No aparece la impresora? Elegir otra
          </button>
        </div>
      )}

      {/* Impresión por el driver del sistema. Es la salida al error "Windows
          tiene tomada la impresora": usa la impresora tal como está instalada,
          sin Zadig ni permisos de administrador. Se muestra siempre, porque es
          la única vía que funciona en una PC de escritorio sin configurar nada. */}
      <div className="space-y-1.5">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Printer className="h-3.5 w-3.5" /> Impresora instalada en Windows
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => imprimirPorSistema("ORIGINAL")}
            className="flex-1"
          >
            <Printer className="h-4 w-4" /> Original
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => imprimirPorSistema("DUPLICADO")}
            className="flex-1"
          >
            <Copy className="h-4 w-4" /> Duplicado
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Si la impresora USB da error, usá estos botones: no hay que configurar nada.
        </p>
      </div>

      {!puedeImprimir && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Bluetooth className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            La impresión Bluetooth necesita Chrome en Android. En este dispositivo podés
            {puedeImprimirUsb ? " imprimir por USB o " : " "}
            enviar el recibo por WhatsApp.
          </span>
        </p>
      )}

      <WhatsAppDialog
        abierto={abierto}
        onClose={() => setAbierto(false)}
        datos={datos}
        telefono={telefono}
      />
    </>
  );
}

// Réplica del modal jmAbrirModalRecibo de la página 3: mismo flujo (dibujar →
// copiar al portapapeles → abrir WhatsApp), misma barra de progreso con sus
// textos, mismo aviso de "pegá con Ctrl+V" y mismos botones.
function WhatsAppDialog({
  abierto,
  onClose,
  datos,
  telefono,
}: {
  abierto: boolean;
  onClose: () => void;
  datos: DatosTicket;
  telefono?: string | null;
}) {
  // El teléfono viene de la ficha del cliente, ya normalizado. En APEX lo
  // resolvía un proceso Ajax (GET_TELEFONO_CLIENTE); acá viaja con el recibo.
  const [numero, setNumero] = useState(() => normalizarTelefono(telefono));
  const [error, setError] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [progreso, setProgreso] = useState<{ pct: number; texto: string } | null>(null);
  const [aviso, setAviso] = useState<{ titulo: string; cuerpo: string } | null>(null);

  function reiniciar() {
    setError(false);
    setTrabajando(false);
    setCopiado(false);
    setProgreso(null);
    setAviso(null);
  }

  function validar(): boolean {
    if (!telefonoValido(numero)) {
      setError(true);
      return false;
    }
    setError(false);
    return true;
  }

  async function copiarYAbrir() {
    if (!validar() || trabajando) return;
    setTrabajando(true);
    setAviso(null);

    setProgreso({ pct: 20, texto: "Dibujando recibo…" });
    // Un respiro para que el navegador pinte el 20% antes de bloquear con el canvas.
    await new Promise((r) => setTimeout(r, 80));

    const canvas = dibujarRecibo(datos);
    setProgreso({ pct: 55, texto: "Generando imagen…" });

    if (!soportaCopiarImagen()) {
      setProgreso({ pct: 100, texto: "⚠ Descargando imagen PNG (navegador sin soporte de copiar)…" });
      descargarImagen(canvas, datos.nroRecibo);
      setAviso({ titulo: "Imagen descargada", cuerpo: "Adjuntala manualmente en WhatsApp." });
      setTrabajando(false);
      return;
    }

    setProgreso({ pct: 75, texto: "Copiando al portapapeles…" });
    try {
      await copiarImagen(canvas);
    } catch (e) {
      setProgreso({
        pct: 100,
        texto: "⚠ Error al copiar: " + (e instanceof Error ? e.message : "desconocido"),
      });
      setTrabajando(false);
      return;
    }

    setCopiado(true);
    setAviso({
      titulo: "Imagen copiada al portapapeles",
      cuerpo:
        "Abrí el chat en WhatsApp y pegala: en la computadora con Ctrl+V, en el celular tocá el campo de texto → Pegar.",
    });
    setProgreso({ pct: 90, texto: "Abriendo WhatsApp…" });

    setTimeout(() => {
      setProgreso({ pct: 100, texto: "✅ Listo — pegá la imagen en el chat" });
      abrirWhatsApp(datos, numero);
      setTrabajando(false);
    }, 350);
  }

  function soloTexto() {
    if (!validar()) return;
    abrirWhatsApp(datos, numero);
    onClose();
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(o) => {
        if (!o) {
          reiniciar();
          onClose();
        }
      }}
    >
      <DialogContent aria-describedby={undefined} className="sm:max-w-sm">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display text-lg">Enviar recibo por WhatsApp</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-xl bg-muted px-4 py-3 text-xs text-muted-foreground">
            Recibo <span className="font-medium text-foreground">N° {datos.nroRecibo}</span> ·{" "}
            {datos.fecha}
            <br />
            CI {datos.documento} · Gs. {datos.monto}
          </div>

          <div className="space-y-1.5">
            <Label>Número de WhatsApp destino</Label>
            <div className="flex items-center overflow-hidden rounded-md border border-input focus-within:border-ring">
              <span className="shrink-0 border-r border-input bg-muted px-3 py-2 text-sm font-medium">
                🇵🇾 +595
              </span>
              <Input
                type="tel"
                inputMode="numeric"
                autoFocus
                value={numero}
                onChange={(e) => {
                  setNumero(e.target.value.replace(/\D/g, ""));
                  setError(false);
                }}
                onKeyDown={(e) => e.key === "Enter" && copiarYAbrir()}
                placeholder="981123456"
                maxLength={12}
                className="border-0 font-mono focus-visible:ring-0"
              />
            </div>

            {error ? (
              <p className="text-xs text-destructive">
                ⚠ Ingresá un número válido (mínimo 8 dígitos)
              </p>
            ) : telefono ? (
              <p className="text-xs text-success">✅ Teléfono cargado desde la ficha del cliente</p>
            ) : (
              <p className="text-xs text-warning-foreground">
                ⚠ No se encontró teléfono — ingresalo manualmente
              </p>
            )}
          </div>

          {progreso && (
            <div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-success transition-all duration-500"
                  style={{ width: `${progreso.pct}%` }}
                />
              </div>
              <p className="mt-1.5 text-center text-xs text-muted-foreground">{progreso.texto}</p>
            </div>
          )}

          {aviso && (
            <div className="rounded-xl border border-success/40 bg-success/10 p-3 text-xs leading-relaxed">
              <strong className="mb-0.5 block text-sm">📋 {aviso.titulo}</strong>
              {aviso.cuerpo}
            </div>
          )}

          <div className="space-y-2">
            <Button
              type="button"
              onClick={copiarYAbrir}
              disabled={trabajando || copiado}
              className={cn(
                "w-full",
                copiado
                  ? "bg-success text-success-foreground"
                  : "bg-primary text-primary-foreground hover:opacity-90",
              )}
            >
              {trabajando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : copiado ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copiado ? "¡Imagen copiada! Pegala en el chat" : "Copiar imagen y abrir WhatsApp"}
            </Button>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  reiniciar();
                  onClose();
                }}
                disabled={trabajando}
                className="flex-1"
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={soloTexto}
                disabled={trabajando}
                className="flex-[2] bg-[#25D366] text-white hover:opacity-90"
              >
                <Send className="h-4 w-4" /> Solo texto
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
