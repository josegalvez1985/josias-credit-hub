import { createFileRoute, useNavigate, Navigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Download, Eye, EyeOff, Fingerprint, Loader2, Moon, Sun } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { usePwaInstall } from "@/lib/pwa";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  getBiometricSecret,
  hasRegisteredBiometric,
  verifyBiometric,
} from "@/lib/webauthn";
import { toast } from "sonner";

const REMEMBER_KEY = "jm-remember-credentials";

function loadRemembered(): { username: string; password: string } | null {
  try {
    const raw = localStorage.getItem(REMEMBER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

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
  const { canInstall, iosInstall, promptInstall } = usePwaInstall();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioLoading, setBioLoading] = useState(false);
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    setBioAvailable(hasRegisteredBiometric());
    const saved = loadRemembered();
    if (saved) {
      setUsername(saved.username);
      setPassword(saved.password);
      setRemember(true);
    }
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
      if (remember) {
        localStorage.setItem(REMEMBER_KEY, JSON.stringify({ username: username.trim(), password }));
      } else {
        localStorage.removeItem(REMEMBER_KEY);
      }
      toast.success("Bienvenido");
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background lg:grid lg:grid-cols-2">
      {/* Decorative gradient panel — top band on mobile, full left column on desktop */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[55vh] bg-gradient-wood opacity-95 lg:inset-0 lg:right-auto lg:h-full lg:w-1/2" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[55vh] bg-[radial-gradient(circle_at_top_right,oklch(0.72_0.12_55/0.35),transparent_60%)] lg:inset-0 lg:right-auto lg:h-full lg:w-1/2" />

      <div className="absolute right-4 top-4 z-10">
        <Button variant="ghost" size="icon" onClick={toggleTheme} className="text-primary-foreground/80 hover:bg-white/10 hover:text-primary-foreground lg:text-foreground/60 lg:hover:bg-muted lg:hover:text-foreground">
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </div>

      {/* Brand column */}
      <div className="relative z-10 flex flex-col px-6 pt-16 text-primary-foreground lg:justify-center lg:px-16 lg:pt-0">
        <div className="mx-auto w-full max-w-md lg:mx-0 lg:max-w-lg">
          <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-white/95 backdrop-blur-sm ring-1 ring-white/20 lg:h-16 lg:w-16">
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="Josias Muebles" className="h-full w-full object-contain p-1.5" />
          </div>
          <p className="mt-8 text-[11px] font-medium uppercase tracking-[0.28em] text-primary-foreground/70">
            Josias Muebles
          </p>
          <h1 className="mt-2 font-display text-4xl font-semibold leading-tight lg:text-5xl">
            Accede a tu cuenta
          </h1>
          <p className="mt-3 max-w-sm text-sm text-primary-foreground/80 lg:text-base">
            Bienvenido de nuevo. Inicia sesión para continuar gestionando las solicitudes de tus clientes.
          </p>
        </div>
      </div>

      {/* Form column */}
      <div className="relative z-10 flex flex-col px-6 pb-10 lg:justify-center lg:px-16 lg:pb-0 lg:pt-0">
        <form
          onSubmit={onSubmit}
          className="mx-auto mt-10 w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-warm sm:p-7 lg:mt-0"
        >
          <div className="space-y-1.5">
            <Label htmlFor="username">Usuario o correo</Label>
            <Input
              id="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="jessicag"
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

          <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-secondary"
            />
            Recordar mi contraseña
          </label>

          <Button
            type="submit"
            disabled={loading}
            className="mt-4 h-11 w-full rounded-xl bg-gradient-caramel text-base font-medium text-primary-foreground shadow-elegant hover:opacity-95"
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

          {canInstall && (
            <Button
              type="button"
              variant="ghost"
              onClick={promptInstall}
              className="mt-3 h-11 w-full rounded-xl text-secondary hover:bg-secondary/10"
            >
              <Download className="h-4 w-4" />
              Instalar app en este dispositivo
            </Button>
          )}

          {iosInstall && (
            <p className="mt-3 flex items-center justify-center gap-1.5 rounded-xl bg-secondary/10 px-3 py-2.5 text-center text-xs text-muted-foreground">
              <Download className="h-3.5 w-3.5 shrink-0 text-secondary" />
              Para instalar: toca Compartir y luego “Agregar a inicio”.
            </p>
          )}
        </form>

        <p className="mx-auto w-full max-w-md pt-6 text-center text-[11px] text-muted-foreground lg:absolute lg:bottom-6 lg:left-1/2 lg:-translate-x-1/2">
          © {new Date().getFullYear()} Plataforma interna
        </p>
      </div>
    </div>
  );
}
