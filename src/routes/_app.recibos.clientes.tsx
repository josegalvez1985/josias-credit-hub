import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Users, Phone, MapPin, Home, Loader2, Navigation, MessageCircle } from "lucide-react";
import { fichaCliente, type ClienteRecibosLov, type FichaCliente } from "@/lib/api";
import { normalizarTelefono } from "@/lib/recibo-whatsapp";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ClienteCombobox } from "@/components/cliente-combobox";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/recibos/clientes")({
  head: () => ({
    meta: [
      { title: "Consultar Datos de Clientes — Créditos" },
      { name: "description", content: "Teléfono, ciudad y dirección del cliente." },
    ],
  }),
  component: ConsultaClientes,
});

// Mismo formato que formatTelefono() de la página 10: agrupa los últimos seis
// dígitos de a tres. 0981460091 -> 0981.460.091
function formatTelefono(tel?: string): string {
  if (!tel) return "—";
  return String(tel)
    .replace(/\D/g, "")
    .replace(/(\d+)(\d{3})(\d{3})$/, "$1.$2.$3");
}

function ConsultaClientes() {
  const [cliente, setCliente] = useState<ClienteRecibosLov | null>(null);
  const [ficha, setFicha] = useState<FichaCliente | null>(null);
  const [cargando, setCargando] = useState(false);

  // APEX pedía tocar "Ver" después de elegir. Acá se carga al seleccionar:
  // es el mismo dato y una pulsación menos para el cobrador.
  useEffect(() => {
    if (!cliente) {
      setFicha(null);
      return;
    }
    setCargando(true);
    fichaCliente(cliente.value)
      .then(setFicha)
      .catch((e) => {
        setFicha(null);
        toast.error(e instanceof Error ? e.message : "No se pudieron cargar los datos");
      })
      .finally(() => setCargando(false));
  }, [cliente]);

  const telefono = ficha?.nro_telefono?.trim() ?? "";
  const direccion = [ficha?.direccion, ficha?.nro_casa].filter(Boolean).join(" ");
  const ubicacion = ficha?.ubicacion?.trim() ?? "";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary/15 text-secondary">
          <Users className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-semibold">Datos del cliente</h1>
          <p className="text-sm text-muted-foreground">Teléfono, ciudad y dirección.</p>
        </div>
      </header>

      <Card className="space-y-1.5 p-6">
        <Label>Cliente</Label>
        <ClienteCombobox
          value={cliente?.value ?? null}
          label={cliente?.label ?? null}
          onSelect={setCliente}
        />
      </Card>

      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Cargando datos...
        </div>
      ) : ficha ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DatoCard icon={Phone} etiqueta="Teléfono" valor={formatTelefono(telefono)} />
            <DatoCard icon={MapPin} etiqueta="Ciudad" valor={ficha.ciudad || "—"} />
          </div>
          <DatoCard icon={Home} etiqueta="Dirección" valor={direccion || "—"} />

          {/* Atajos que en APEX no había: el cobrador está en la calle. */}
          {(telefono || ubicacion) && (
            <div className="flex flex-wrap gap-2">
              {telefono && (
                <Button asChild variant="outline" className="flex-1">
                  <a href={`tel:${telefono.replace(/\D/g, "")}`}>
                    <Phone className="h-4 w-4" /> Llamar
                  </a>
                </Button>
              )}
              {telefono && (
                <Button asChild className="flex-1 bg-[#25D366] text-white hover:opacity-90">
                  <a
                    href={`https://wa.me/595${normalizarTelefono(telefono)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MessageCircle className="h-4 w-4" /> WhatsApp
                  </a>
                </Button>
              )}
              {ubicacion && (
                <Button asChild variant="outline" className="flex-1">
                  <a href={ubicacion} target="_blank" rel="noopener noreferrer">
                    <Navigation className="h-4 w-4" /> Ir
                  </a>
                </Button>
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function DatoCard({
  icon: Icon,
  etiqueta,
  valor,
}: {
  icon: typeof Phone;
  etiqueta: string;
  valor: string;
}) {
  return (
    <Card className="min-w-0 p-5">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {etiqueta}
      </div>
      <p className="mt-2 break-words font-display text-lg font-semibold text-secondary">{valor}</p>
    </Card>
  );
}
