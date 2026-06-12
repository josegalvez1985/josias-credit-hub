import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, FilePlus, FileText, Sparkles, TrendingUp, Clock3, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useApplications, formatCurrency } from "@/lib/credit-applications";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({
    meta: [
      { title: "Inicio — Josias Muebles" },
      { name: "description", content: "Resumen y accesos rápidos para gestionar solicitudes." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { user } = useAuth();
  const { applications } = useApplications();

  const pending = applications.filter((a) => a.status === "pendiente").length;
  const approved = applications.filter((a) => a.status === "aprobada").length;
  const totalAmount = applications.reduce((s, a) => s + a.amount, 0);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches";

  return (
    <div className="space-y-8">
      {/* Hero greeting */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-wood p-7 text-primary-foreground shadow-warm sm:p-9">
        <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-secondary/30 blur-3xl" />
        <div className="relative">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wider ring-1 ring-white/20">
            <Sparkles className="h-3 w-3" />
            Panel del asesor
          </div>
          <h1 className="mt-4 font-display text-3xl font-semibold sm:text-4xl">
            {greeting}, {user?.name.split(" ")[0]}.
          </h1>
          <p className="mt-2 max-w-md text-sm text-primary-foreground/80">
            Estas son tus solicitudes y movimientos recientes de Josias Muebles.
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              to="/solicitudes/nueva"
              className="inline-flex items-center gap-2 rounded-full bg-gradient-caramel px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-elegant transition-transform hover:scale-[1.02]"
            >
              <FilePlus className="h-4 w-4" />
              Nueva solicitud
            </Link>
            <Link
              to="/solicitudes"
              className="inline-flex items-center gap-2 rounded-full bg-white/10 px-5 py-2.5 text-sm font-medium text-primary-foreground ring-1 ring-white/20 backdrop-blur transition-colors hover:bg-white/15"
            >
              Ver todas <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Stat cards */}
      <section className="grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={<Clock3 className="h-4 w-4" />}
          label="Pendientes"
          value={pending}
          tone="warning"
        />
        <StatCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Aprobadas"
          value={approved}
          tone="success"
        />
        <StatCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Monto total"
          value={formatCurrency(totalAmount)}
          tone="primary"
        />
      </section>

      {/* Recent */}
      <section>
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="font-display text-xl font-semibold">Recientes</h2>
            <p className="text-sm text-muted-foreground">Las últimas solicitudes registradas.</p>
          </div>
          <Link to="/solicitudes" className="text-sm font-medium text-secondary hover:underline">
            Ver todas
          </Link>
        </div>

        <div className="space-y-3">
          {applications.slice(0, 4).map((a) => (
            <Link
              key={a.id}
              to="/solicitudes"
              className="block"
            >
              <Card className="flex items-center gap-4 p-4 transition-all hover:-translate-y-0.5 hover:shadow-elegant">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-secondary/15 text-secondary">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{a.clientName}</p>
                    <span className="font-mono text-[10px] text-muted-foreground">{a.id}</span>
                  </div>
                  <p className="truncate text-sm text-muted-foreground">{a.product}</p>
                </div>
                <div className="text-right">
                  <p className="font-display text-base font-semibold">{formatCurrency(a.amount)}</p>
                  <p className="text-xs text-muted-foreground">{a.termMonths} meses</p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  tone: "warning" | "success" | "primary";
}) {
  const toneClasses = {
    warning: "bg-warning/15 text-warning-foreground",
    success: "bg-success/15 text-success",
    primary: "bg-secondary/15 text-secondary",
  }[tone];

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${toneClasses}`}>
          {icon}
        </span>
      </div>
      <p className="mt-3 font-display text-2xl font-semibold tracking-tight">{value}</p>
    </Card>
  );
}
