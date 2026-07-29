import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { MapPin, MapPinOff, Navigation, Copy } from "lucide-react";
import type { ClienteRecibosLov } from "@/lib/api";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClienteCombobox } from "@/components/cliente-combobox";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/recibos/ubicaciones")({
  head: () => ({
    meta: [
      { title: "Ubicaciones — Créditos" },
      { name: "description", content: "Ubicación del domicilio del cliente." },
    ],
  }),
  component: Ubicaciones,
});

// El campo CLIENTES.UBICACION guarda normalmente un link de Google Maps, pero
// hay registros con coordenadas sueltas ("-25.35,-57.52"). APEX hacía
// window.open() a secas, así que con coordenadas no abría nada. Acá se arma la
// búsqueda de Maps cuando el valor no es una URL.
function urlDeUbicacion(valor: string): string {
  const v = valor.trim();
  if (/^https?:\/\//i.test(v)) return v;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v)}`;
}

function Ubicaciones() {
  const [cliente, setCliente] = useState<ClienteRecibosLov | null>(null);

  const ubicacion = cliente?.ubicacion?.trim() ?? "";
  const tieneUbicacion = ubicacion.length > 0;

  function abrir() {
    if (!tieneUbicacion) return;
    window.open(urlDeUbicacion(ubicacion), "_blank", "noopener,noreferrer");
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(ubicacion);
      toast.success("Ubicación copiada");
    } catch {
      toast.error("No se pudo copiar");
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary/15 text-secondary">
          <MapPin className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-semibold">Ubicaciones</h1>
          <p className="text-sm text-muted-foreground">
            Consultá dónde vive el cliente y abrí el mapa.
          </p>
        </div>
      </header>

      <Card className="space-y-5 p-6">
        <div className="space-y-1.5">
          <Label>Cliente</Label>
          <ClienteCombobox
            fuente="todos"
            value={cliente?.value ?? null}
            label={cliente?.label ?? null}
            onSelect={setCliente}
          />
        </div>

        {cliente && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Ubicación</Label>
              {tieneUbicacion ? (
                <p className="break-all rounded-md border border-input bg-muted px-3 py-2 font-mono text-xs">
                  {ubicacion}
                </p>
              ) : (
                <div className="flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/10 p-3">
                  <MapPinOff className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
                  <p className="text-sm text-warning-foreground">
                    El cliente no posee una ubicación cargada.
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={abrir}
                disabled={!tieneUbicacion}
                className="flex-1 bg-primary text-primary-foreground hover:opacity-90"
              >
                <Navigation className="h-4 w-4" /> Ir
              </Button>
              {tieneUbicacion && (
                <Button type="button" variant="outline" onClick={copiar}>
                  <Copy className="h-4 w-4" /> Copiar
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
