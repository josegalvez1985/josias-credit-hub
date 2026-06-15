import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { ArrowLeft, Loader2, UserPlus } from "lucide-react";
import { ciExiste, crearCliente, lov } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AsyncCombobox } from "@/components/async-combobox";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/clientes/nuevo")({
  head: () => ({
    meta: [
      { title: "Nuevo cliente — Créditos" },
      { name: "description", content: "Registra un nuevo cliente." },
    ],
  }),
  component: NewClient,
});

function NewClient() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [ciudad, setCiudad] = useState<{ value: number; label: string } | null>(null);

  const [form, setForm] = useState({
    razon_social: "",
    nombre_fantasia: "",
    sexo: "M",
    ci: "",
    ruc: "",
    nro_telefono: "",
    direccion: "",
    nro_casa: "",
    estado_civil: "",
    fecha_nacimiento: "",
    vivienda: "",
  });
  const update = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.razon_social.trim() || !form.ci.trim()) {
      return toast.error("Nombre y CI son obligatorios");
    }
    setLoading(true);
    try {
      // Validar que el CI no exista ya
      if (await ciExiste(form.ci)) {
        toast.error("Ya existe un cliente con esa cédula (CI)");
        return;
      }
      const { cod_cliente } = await crearCliente({
        ...form,
        cod_ciudad: ciudad?.value,
        estado: "A",
      });
      toast.success(`Cliente #${cod_cliente} registrado`);
      navigate({ to: "/solicitudes/nueva" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al registrar cliente");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link to="/solicitudes/nueva" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Volver
      </Link>

      <header className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary/15 text-secondary">
          <UserPlus className="h-5 w-5" />
        </span>
        <div>
          <h1 className="font-display text-3xl font-semibold">Nuevo cliente</h1>
          <p className="text-sm text-muted-foreground">Registra los datos del cliente.</p>
        </div>
      </header>

      <form onSubmit={onSubmit} className="space-y-6">
        <Card className="space-y-5 p-6">
          <h2 className="font-display text-lg font-semibold">Datos personales</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre / Razón social" required>
              <Input value={form.razon_social} onChange={(e) => update("razon_social", e.target.value)} required />
            </Field>
            <Field label="Nombre de fantasía">
              <Input value={form.nombre_fantasia} onChange={(e) => update("nombre_fantasia", e.target.value)} />
            </Field>
            <Field label="Cédula (CI)" required>
              <Input value={form.ci} onChange={(e) => update("ci", e.target.value)} required inputMode="numeric" />
            </Field>
            <Field label="RUC">
              <Input value={form.ruc} onChange={(e) => update("ruc", e.target.value)} />
            </Field>
            <Field label="Teléfono">
              <Input type="tel" value={form.nro_telefono} onChange={(e) => update("nro_telefono", e.target.value)} />
            </Field>
            <Field label="Fecha de nacimiento">
              <Input type="date" value={form.fecha_nacimiento} onChange={(e) => update("fecha_nacimiento", e.target.value)} />
            </Field>
            <Field label="Sexo">
              <div className="flex gap-2">
                {(["M", "F"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => update("sexo", v)}
                    className={cn(
                      "flex-1 rounded-md border px-4 py-2 text-sm transition-colors",
                      form.sexo === v ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground",
                    )}
                  >
                    {v === "M" ? "Masculino" : "Femenino"}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Estado civil">
              <div className="flex flex-wrap gap-2">
                {["Soltero", "Casado", "Divorciado", "Viudo", "Unión libre"].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => update("estado_civil", v)}
                    className={cn(
                      "rounded-md border px-3 py-2 text-sm transition-colors",
                      form.estado_civil === v ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground",
                    )}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        </Card>

        <Card className="space-y-5 p-6">
          <h2 className="font-display text-lg font-semibold">Domicilio</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Ciudad">
              <AsyncCombobox
                value={ciudad?.value ?? null}
                label={ciudad?.label ?? null}
                fetcher={lov.ciudades}
                onSelect={(it) => setCiudad({ value: it.value, label: it.label })}
              />
            </Field>
            <Field label="N° de casa">
              <Input value={form.nro_casa} onChange={(e) => update("nro_casa", e.target.value)} />
            </Field>
            <Field label="Dirección">
              <Input value={form.direccion} onChange={(e) => update("direccion", e.target.value)} />
            </Field>
            <Field label="Vivienda">
              <Input value={form.vivienda} onChange={(e) => update("vivienda", e.target.value)} placeholder="Ej: Propia, Alquilada" />
            </Field>
          </div>
        </Card>

        <div className="flex gap-3">
          <Button type="button" variant="outline" onClick={() => navigate({ to: "/solicitudes/nueva" })} className="flex-1">
            Cancelar
          </Button>
          <Button type="submit" disabled={loading} className="flex-1 bg-primary text-primary-foreground hover:opacity-90">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Registrar cliente"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
    </div>
  );
}
