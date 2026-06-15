import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Download, Fingerprint, LogOut, Moon, Shield, Sun, Loader2, Mail, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { usePwaInstall } from "@/lib/pwa";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  clearBiometric,
  hasRegisteredBiometric,
  isPlatformAuthenticatorAvailable,
  registerBiometric,
  storeBiometricSecret,
} from "@/lib/webauthn";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/perfil")({
  head: () => ({
    meta: [
      { title: "Perfil — Créditos" },
      { name: "description", content: "Configura tu cuenta, contraseña y biometría." },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user, logout, changePassword, updateUser } = useAuth();
  const { theme, setTheme } = useTheme();
  const { canInstall, installed, iosInstall, promptInstall } = usePwaInstall();
  const navigate = useNavigate();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwLoading, setPwLoading] = useState(false);

  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [bioLoading, setBioLoading] = useState(false);
  const [bioPassword, setBioPassword] = useState("");
  const [bioPromptOpen, setBioPromptOpen] = useState(false);

  useEffect(() => {
    isPlatformAuthenticatorAvailable().then(setBioAvailable);
    setBioEnabled(hasRegisteredBiometric());
  }, []);

  async function onChangePassword(e: FormEvent) {
    e.preventDefault();
    if (next.length < 6) {
      toast.error("La nueva contraseña debe tener al menos 6 caracteres");
      return;
    }
    if (next !== confirm) {
      toast.error("Las contraseñas no coinciden");
      return;
    }
    setPwLoading(true);
    try {
      await changePassword(current, next);
      toast.success("Contraseña actualizada");
      setCurrent(""); setNext(""); setConfirm("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setPwLoading(false);
    }
  }

  function onToggleBiometric(enabled: boolean) {
    if (!user) return;
    if (enabled) {
      // Necesitamos la contraseña para reusarla al iniciar sesión con huella
      setBioPassword("");
      setBioPromptOpen(true);
      return;
    }
    clearBiometric();
    setBioEnabled(false);
    updateUser({ biometricEnabled: false });
    toast.success("Biometría deshabilitada");
  }

  async function onConfirmBiometric(e: FormEvent) {
    e.preventDefault();
    if (!user || !bioPassword) return;
    setBioLoading(true);
    try {
      await registerBiometric(user.username, user.name);
      storeBiometricSecret(user.username, bioPassword);
      setBioEnabled(true);
      updateUser({ biometricEnabled: true });
      setBioPromptOpen(false);
      setBioPassword("");
      toast.success("Biometría habilitada en este dispositivo");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo configurar la biometría");
    } finally {
      setBioLoading(false);
    }
  }

  function onLogout() {
    logout();
    navigate({ to: "/login" });
  }

  if (!user) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header card */}
      <Card className="relative overflow-hidden p-6">
        <div className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-secondary/20 blur-3xl" />
        <div className="relative flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-wood text-primary-foreground shadow-elegant">
            <span className="font-display text-2xl font-semibold">{user.name.charAt(0)}</span>
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-display text-2xl font-semibold">{user.name}</h1>
            <p className="flex items-center gap-1.5 truncate text-sm text-muted-foreground">
              <Mail className="h-3.5 w-3.5" /> {user.email}
            </p>
            <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-secondary/15 px-2.5 py-0.5 text-[11px] font-medium capitalize text-secondary">
              {user.role}
            </span>
          </div>
        </div>
      </Card>

      {/* Apariencia */}
      <Card className="p-6">
        <h2 className="font-display text-lg font-semibold">Apariencia</h2>
        <p className="mt-1 text-sm text-muted-foreground">Elige cómo se ve la aplicación.</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <ThemeOption
            active={theme === "light"}
            onClick={() => setTheme("light")}
            icon={<Sun className="h-4 w-4" />}
            label="Claro"
          />
          <ThemeOption
            active={theme === "dark"}
            onClick={() => setTheme("dark")}
            icon={<Moon className="h-4 w-4" />}
            label="Oscuro"
          />
        </div>
      </Card>

      {/* Biometría */}
      <Card className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary/15 text-secondary">
              <Fingerprint className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-lg font-semibold">Biometría</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Usa tu huella o Face ID para acceder más rápido en este dispositivo.
              </p>
              {!bioAvailable && (
                <p className="mt-2 text-xs text-warning-foreground">
                  Tu dispositivo o navegador no soporta autenticación biométrica.
                </p>
              )}
              {bioEnabled && (
                <p className="mt-2 inline-flex items-center gap-1 text-xs text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Habilitada en este dispositivo
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center">
            {bioLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <Switch
                checked={bioEnabled}
                disabled={!bioAvailable}
                onCheckedChange={onToggleBiometric}
                aria-label="Habilitar biometría"
              />
            )}
          </div>
        </div>

        {bioPromptOpen && (
          <form onSubmit={onConfirmBiometric} className="mt-5 border-t border-border pt-5">
            <Label htmlFor="bioPassword">Confirma tu contraseña para activar</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Se guardará de forma segura en este dispositivo para iniciar sesión con tu huella.
            </p>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <Input
                id="bioPassword"
                type="password"
                value={bioPassword}
                onChange={(e) => setBioPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Contraseña actual"
                required
                className="flex-1"
              />
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setBioPromptOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={bioLoading || !bioPassword} className="bg-primary text-primary-foreground hover:opacity-90">
                  {bioLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Activar"}
                </Button>
              </div>
            </div>
          </form>
        )}
      </Card>

      {/* Cambio de contraseña */}
      <Card className="p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary/15 text-secondary">
            <Shield className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h2 className="font-display text-lg font-semibold">Cambiar contraseña</h2>
            <p className="mt-1 text-sm text-muted-foreground">Mínimo 6 caracteres.</p>
          </div>
        </div>

        <form onSubmit={onChangePassword} className="mt-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="current">Contraseña actual</Label>
            <Input id="current" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="new">Nueva contraseña</Label>
              <Input id="new" type="password" value={next} onChange={(e) => setNext(e.target.value)} required autoComplete="new-password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirmar</Label>
              <Input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
            </div>
          </div>
          <Button type="submit" disabled={pwLoading} className="w-full bg-primary text-primary-foreground hover:opacity-90 sm:w-auto">
            {pwLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Actualizar contraseña"}
          </Button>
        </form>
      </Card>

      {(canInstall || installed || iosInstall) && (
        <Card className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary/15 text-secondary">
                <Download className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-display text-lg font-semibold">Instalar app</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {installed
                    ? "La app ya está instalada en este dispositivo."
                    : iosInstall
                      ? "Toca el botón Compartir de Safari y luego “Agregar a inicio”."
                      : "Agrégala a tu pantalla de inicio para abrirla como una app."}
                </p>
              </div>
            </div>
            {canInstall && (
              <Button onClick={promptInstall} className="bg-primary text-primary-foreground hover:opacity-90">
                Instalar
              </Button>
            )}
          </div>
        </Card>
      )}

      <Button
        variant="outline"
        onClick={onLogout}
        className="w-full border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <LogOut className="h-4 w-4" />
        Cerrar sesión
      </Button>
    </div>
  );
}

function ThemeOption({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2.5 rounded-xl border-2 px-4 py-3 text-sm font-medium transition-all ${
        active
          ? "border-secondary bg-secondary/10 text-foreground"
          : "border-border bg-card text-muted-foreground hover:border-secondary/40"
      }`}
    >
      <span className={`flex h-7 w-7 items-center justify-center rounded-full ${active ? "bg-secondary/20 text-secondary" : "bg-muted"}`}>
        {icon}
      </span>
      {label}
    </button>
  );
}
