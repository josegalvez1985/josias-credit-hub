import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { MapPinPlus, Crosshair, Loader2, Check, AlertCircle, ExternalLink } from "lucide-react";
import { guardarUbicacion, type ClienteRecibosLov } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClienteCombobox } from "@/components/cliente-combobox";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/recibos/cargar-ubicacion")({
  head: () => ({
    meta: [
      { title: "Cargar Ubicación — Créditos" },
      { name: "description", content: "Registro de la ubicación del domicilio del cliente." },
    ],
  }),
  component: CargarUbicacion,
});

// Mismo formato que arma la página 6 de APEX a partir del GPS.
// 6 decimales son ~11 cm: de sobra, y evita URLs con 15 dígitos.
function urlMaps(lat: number, lon: number): string {
  return `https://www.google.com/maps?q=${lat.toFixed(6)},${lon.toFixed(6)}`;
}

function CargarUbicacion() {
  const [cliente, setCliente] = useState<ClienteRecibosLov | null>(null);
  const [ubicacion, setUbicacion] = useState("");
  const [precision, setPrecision] = useState<number | null>(null);
  const [ubicando, setUbicando] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const anterior = cliente?.ubicacion?.trim() ?? "";

  function elegirCliente(c: ClienteRecibosLov) {
    setCliente(c);
    setUbicacion("");
    setPrecision(null);
  }

  function obtenerUbicacion() {
    if (!navigator.geolocation) {
      return toast.error("Este dispositivo no permite obtener la ubicación");
    }
    setUbicando(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUbicacion(urlMaps(pos.coords.latitude, pos.coords.longitude));
        setPrecision(pos.coords.accuracy);
        setUbicando(false);
        toast.success("Ubicación obtenida");
      },
      (err) => {
        setUbicando(false);
        const mensajes: Record<number, string> = {
          1: "Permiso denegado. Habilitá la ubicación para este sitio.",
          2: "No se pudo determinar la posición. Probá al aire libre.",
          3: "Tardó demasiado. Volvé a intentar.",
        };
        toast.error(mensajes[err.code] ?? "No se pudo obtener la ubicación");
      },
      // enable_high_accuracy => 'Y' en la acción dinámica de APEX.
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!cliente) return toast.error("Elegí un cliente");
    if (!ubicacion.trim()) return toast.error("Falta la ubicación");

    setGuardando(true);
    try {
      await guardarUbicacion(cliente.value, ubicacion.trim());
      toast.success("Ubicación guardada");
      // Se refleja en la ficha para que el aviso de "ya tenía una" quede al día.
      setCliente({ ...cliente, ubicacion: ubicacion.trim() });
      setUbicacion("");
      setPrecision(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar la ubicación");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary/15 text-secondary">
          <MapPinPlus className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-semibold">Cargar Ubicación</h1>
          <p className="text-sm text-muted-foreground">
            Parado frente al domicilio, tomá la posición y guardala.
          </p>
        </div>
      </header>

      <form onSubmit={onSubmit} className="space-y-6" autoComplete="off">
        <Card className="space-y-5 p-6">
          <div className="space-y-1.5">
            <Label>
              Cliente<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <ClienteCombobox
              fuente="todos"
              value={cliente?.value ?? null}
              label={cliente?.label ?? null}
              onSelect={elegirCliente}
            />
          </div>

          {/* APEX pisaba la ubicación anterior sin avisar. */}
          {cliente && anterior && (
            <div className="flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/10 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
              <div className="min-w-0 text-sm text-warning-foreground">
                <p>Este cliente ya tiene una ubicación cargada. Si guardás, se reemplaza.</p>
                <a
                  href={anterior}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs underline"
                >
                  Ver la actual <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          )}

          {cliente && (
            <>
              <Button
                type="button"
                onClick={obtenerUbicacion}
                disabled={ubicando}
                className="w-full bg-secondary text-secondary-foreground hover:opacity-90"
              >
                {ubicando ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Crosshair className="h-4 w-4" />
                )}
                {ubicando ? "Obteniendo posición..." : "1 · Obtener ubicación"}
              </Button>

              <div className="space-y-1.5">
                <Label>
                  Ubicación<span className="ml-0.5 text-destructive">*</span>
                </Label>
                <Input
                  value={ubicacion}
                  onChange={(e) => setUbicacion(e.target.value)}
                  placeholder="https://www.google.com/maps?q=..."
                  className="font-mono text-xs"
                />
                {precision !== null && (
                  <p className="text-xs text-muted-foreground">
                    Precisión aproximada: {Math.round(precision)} m.
                    {precision > 50 && " Alejate de las paredes y volvé a intentar para mejorarla."}
                  </p>
                )}
              </div>
            </>
          )}
        </Card>

        {cliente && (
          <Button
            type="submit"
            disabled={guardando || !ubicacion.trim()}
            className="w-full bg-primary text-primary-foreground hover:opacity-90"
          >
            {guardando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Check className="h-4 w-4" /> 2 · Guardar
              </>
            )}
          </Button>
        )}
      </form>
    </div>
  );
}
