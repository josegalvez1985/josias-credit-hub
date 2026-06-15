import { createFileRoute, useNavigate, Navigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff, Fingerprint, Loader2, Moon, Sun } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  getBiometricSecret,
  hasRegisteredBiometric,
  verifyBiometric,
} from "@/lib/webauthn";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Iniciar sesión — Créditos" },
      { name: "description", content: "Accede a tu cuenta para gestionar solicitudes de crédito." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { user, login } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioLoading, setBioLoading] = useState(false);

  useEffect(() => {
    setBioAvailable(hasRegisteredBiometric());
  }, []);

  if (user) return <Navigate to="/dashboard" />;

  async function onBiometricLogin() {
    setBioLoading(true);
    try {
      await verifyBiometric();
      const secret = getBiometricSecret();
      if (!secret) throw new Error("No hay credenciales guardadas para biometría");
      await login(secret.username, secret.password);
      toast.success("Bienvenido");
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo iniciar con huella");
    } finally {
      setBioLoading(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await login(username.trim(), password);
      toast.success("Bienvenido");
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* Decorative gradient panel */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[55vh] bg-gradient-wood opacity-95" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[55vh] bg-[radial-gradient(circle_at_top_right,oklch(0.72_0.12_55/0.35),transparent_60%)]" />

      <div className="absolute right-4 top-4 z-10">
        <Button variant="ghost" size="icon" onClick={toggleTheme} className="text-primary-foreground/80 hover:bg-white/10 hover:text-primary-foreground">
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-md flex-col px-6 pb-10 pt-16">
        <div className="text-primary-foreground">
          <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-white/95 backdrop-blur-sm ring-1 ring-white/20">
            <img src="/logo.png" alt="Josias Muebles" className="h-full w-full object-contain p-1.5" />
          </div>
          <p className="mt-8 text-[11px] font-medium uppercase tracking-[0.28em] text-primary-foreground/70">
            Josias Muebles
          </p>
          <h1 className="mt-2 font-display text-4xl font-semibold leading-tight">
            Accede a tu cuenta
          </h1>
          <p className="mt-3 max-w-sm text-sm text-primary-foreground/80">
            Bienvenido de nuevo. Inicia sesión para continuar gestionando las solicitudes de tus clientes.
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="mt-10 rounded-3xl border border-border bg-card p-6 shadow-warm sm:p-7"
        >
          <div className="space-y-1.5">
            <Label htmlFor="username">Usuario o correo</Label>
            <Input
              id="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="maria"
              required
              className="h-11"
            />
          </div>

          <div className="mt-4 space-y-1.5">
            <Label htmlFor="password">Contraseña</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="h-11 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="mt-6 h-11 w-full rounded-xl bg-gradient-caramel text-base font-medium text-primary-foreground shadow-elegant hover:opacity-95"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Iniciar sesión"}
          </Button>

          {bioAvailable && (
            <Button
              type="button"
              variant="outline"
              onClick={onBiometricLogin}
              disabled={bioLoading}
              className="mt-3 h-11 w-full rounded-xl"
            >
              {bioLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Fingerprint className="h-4 w-4" />
                  Entrar con huella
                </>
              )}
            </Button>
          )}

          <div className="mt-5 rounded-xl border border-dashed border-border bg-muted/50 px-4 py-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Cuentas de prueba</p>
            <p className="mt-1">
              <span className="font-mono">maria</span> / <span className="font-mono">demo123</span>
            </p>
            <p>
              <span className="font-mono">carlos</span> / <span className="font-mono">demo123</span>
            </p>
          </div>
        </form>

        <p className="mt-auto pt-6 text-center text-[11px] text-muted-foreground">
          © {new Date().getFullYear()} Plataforma interna
        </p>
      </div>
    </div>
  );
}
