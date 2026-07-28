import { useState } from "react";
import { Printer, Copy, MessageCircle, Loader2, Send } from "lucide-react";
import { imprimirRecibo, soportaImpresion, type DatosTicket } from "@/lib/escpos";
import type { ReciboDetalle } from "@/lib/api";
import {
  enviarReciboPorWhatsApp,
  enviarSoloTexto,
  normalizarTelefono,
  telefonoValido,
} from "@/lib/recibo-whatsapp";
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

// Las tres acciones de la página 3 de APEX: Original, Duplicado y WhatsApp.
export function ReciboAcciones({
  datos,
  telefono,
}: {
  datos: DatosTicket;
  telefono?: string | null;
}) {
  const [imprimiendo, setImprimiendo] = useState<"ORIGINAL" | "DUPLICADO" | null>(null);
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

  const puedeImprimir = soportaImpresion();

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => imprimir("ORIGINAL")}
          disabled={imprimiendo !== null || !puedeImprimir}
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
          disabled={imprimiendo !== null || !puedeImprimir}
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

      {!puedeImprimir && (
        <p className="text-xs text-muted-foreground">
          La impresión Bluetooth necesita Chrome en Android. En este dispositivo podés enviar el
          recibo por WhatsApp.
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
  // El teléfono viene de la ficha del cliente, ya normalizado. En APEX esto lo
  // resolvía un proceso Ajax (GET_TELEFONO_CLIENTE); acá viaja con el recibo.
  const [numero, setNumero] = useState(() => normalizarTelefono(telefono));
  const [enviando, setEnviando] = useState(false);

  async function enviarConImagen() {
    if (!telefonoValido(numero)) return toast.error("Ingresá un número válido (mínimo 8 dígitos)");
    setEnviando(true);
    try {
      const r = await enviarReciboPorWhatsApp(datos, numero);
      if (r === "compartido") toast.success("Recibo compartido");
      else if (r === "portapapeles") toast.success("Imagen copiada. Pegala en el chat con Ctrl+V.");
      else toast.success("Imagen descargada. Adjuntala en el chat.");
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al enviar";
      if (!/abort|cancel/i.test(msg)) toast.error(msg);
    } finally {
      setEnviando(false);
    }
  }

  function enviarTexto() {
    if (!telefonoValido(numero)) return toast.error("Ingresá un número válido (mínimo 8 dígitos)");
    enviarSoloTexto(datos, numero);
    onClose();
  }

  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={undefined} className="sm:max-w-sm">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display text-lg">Enviar recibo por WhatsApp</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-xl bg-muted px-4 py-3 text-xs text-muted-foreground">
            Recibo <span className="font-medium text-foreground">N° {datos.nroRecibo}</span> ·{" "}
            {datos.fecha} · CI {datos.documento} · Gs. {datos.monto}
          </div>

          <div className="space-y-1.5">
            <Label>Número de WhatsApp</Label>
            <div className="flex items-center gap-0 overflow-hidden rounded-md border border-input focus-within:border-ring">
              <span className="shrink-0 border-r border-input bg-muted px-3 py-2 text-sm font-medium">
                🇵🇾 +595
              </span>
              <Input
                type="tel"
                inputMode="numeric"
                autoFocus
                value={numero}
                onChange={(e) => setNumero(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && enviarConImagen()}
                placeholder="981123456"
                maxLength={12}
                className="border-0 font-mono focus-visible:ring-0"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {telefono
                ? "Cargado desde la ficha del cliente. Podés cambiarlo."
                : "El cliente no tiene teléfono cargado."}
            </p>
          </div>

          <div className="space-y-2">
            <Button
              type="button"
              onClick={enviarConImagen}
              disabled={enviando}
              className="w-full bg-[#25D366] text-white hover:opacity-90"
            >
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar recibo con imagen
            </Button>
            <Button type="button" variant="outline" onClick={enviarTexto} className="w-full">
              Solo texto
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
