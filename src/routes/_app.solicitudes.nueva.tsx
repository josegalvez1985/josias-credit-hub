import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useApplications, formatCurrency } from "@/lib/credit-applications";
import { useAuth } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/solicitudes/nueva")({
  head: () => ({
    meta: [
      { title: "Nueva solicitud — Josias Muebles" },
      { name: "description", content: "Registra una nueva solicitud de crédito." },
    ],
  }),
  component: NewApplication,
});

function NewApplication() {
  const { addApplication } = useApplications();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    clientName: "",
    clientId: "",
    phone: "",
    email: "",
    product: "",
    amount: "",
    termMonths: "12",
    monthlyIncome: "",
    notes: "",
  });

  const update = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const amount = Number(form.amount) || 0;
  const term = Number(form.termMonths) || 1;
  const estimatedMonthly = amount > 0 ? Math.round((amount * 1.18) / term) : 0;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    await new Promise((r) => setTimeout(r, 600));
    const created = addApplication(
      {
        clientName: form.clientName.trim(),
        clientId: form.clientId.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
        product: form.product.trim(),
        amount,
        termMonths: term,
        monthlyIncome: Number(form.monthlyIncome) || 0,
        notes: form.notes.trim() || undefined,
      },
      user.name,
    );
    setLoading(false);
    toast.success(`Solicitud ${created.id} registrada`);
    navigate({ to: "/solicitudes" });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link to="/solicitudes" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Volver
      </Link>

      <header>
        <h1 className="font-display text-3xl font-semibold">Nueva solicitud</h1>
        <p className="text-sm text-muted-foreground">
          Completa los datos del cliente y el mueble a financiar.
        </p>
      </header>

      <form onSubmit={onSubmit} className="space-y-6">
        <Card className="space-y-5 p-6">
          <h2 className="font-display text-lg font-semibold">Datos del cliente</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre completo" id="clientName" required>
              <Input id="clientName" value={form.clientName} onChange={(e) => update("clientName", e.target.value)} required />
            </Field>
            <Field label="Cédula / Identificación" id="clientId" required>
              <Input id="clientId" value={form.clientId} onChange={(e) => update("clientId", e.target.value)} required inputMode="numeric" />
            </Field>
            <Field label="Teléfono" id="phone" required>
              <Input id="phone" type="tel" value={form.phone} onChange={(e) => update("phone", e.target.value)} required />
            </Field>
            <Field label="Correo (opcional)" id="email">
              <Input id="email" type="email" value={form.email} onChange={(e) => update("email", e.target.value)} />
            </Field>
          </div>
        </Card>

        <Card className="space-y-5 p-6">
          <h2 className="font-display text-lg font-semibold">Detalles del crédito</h2>
          <Field label="Producto / Mueble" id="product" required>
            <Input id="product" value={form.product} onChange={(e) => update("product", e.target.value)} required placeholder="Ej: Sala modular Toscana" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Monto solicitado (COP)" id="amount" required>
              <Input id="amount" type="number" inputMode="numeric" min={0} value={form.amount} onChange={(e) => update("amount", e.target.value)} required />
            </Field>
            <Field label="Plazo (meses)" id="termMonths" required>
              <select
                id="termMonths"
                value={form.termMonths}
                onChange={(e) => update("termMonths", e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
              >
                {[6, 12, 18, 24, 36].map((m) => (
                  <option key={m} value={m}>{m} meses</option>
                ))}
              </select>
            </Field>
            <Field label="Ingresos mensuales (COP)" id="monthlyIncome" required>
              <Input id="monthlyIncome" type="number" inputMode="numeric" min={0} value={form.monthlyIncome} onChange={(e) => update("monthlyIncome", e.target.value)} required />
            </Field>
          </div>
          <Field label="Notas (opcional)" id="notes">
            <Textarea id="notes" value={form.notes} onChange={(e) => update("notes", e.target.value)} rows={3} />
          </Field>
        </Card>

        {amount > 0 && (
          <Card className="bg-gradient-caramel p-5 text-primary-foreground shadow-elegant">
            <p className="text-xs uppercase tracking-wider opacity-80">Cuota estimada</p>
            <p className="mt-1 font-display text-3xl font-semibold">{formatCurrency(estimatedMonthly)} <span className="text-base font-normal opacity-80">/ mes</span></p>
            <p className="mt-1 text-xs opacity-80">Cálculo referencial — sujeto a aprobación.</p>
          </Card>
        )}

        <div className="flex gap-3 pt-2">
          <Button type="button" variant="outline" onClick={() => navigate({ to: "/solicitudes" })} className="flex-1">
            Cancelar
          </Button>
          <Button type="submit" disabled={loading} className="flex-1 bg-primary text-primary-foreground hover:opacity-90">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Registrar solicitud"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, id, required, children }: { label: string; id: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
    </div>
  );
}
