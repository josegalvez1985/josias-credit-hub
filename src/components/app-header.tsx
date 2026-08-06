import { Link, useRouterState } from "@tanstack/react-router";
import { Home, FileText, FilePlus, Receipt, Tag, User, Moon, Sun, LogOut } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { AdminMenu } from "@/components/admin-menu";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const items = [
  { to: "/dashboard", label: "Inicio", icon: Home },
  { to: "/solicitudes", label: "Solicitudes", icon: FileText },
  { to: "/solicitudes/nueva", label: "Nueva solicitud", icon: FilePlus },
  { to: "/recibos", label: "Recibos", icon: Receipt },
  { to: "/precios", label: "Precios", icon: Tag },
  { to: "/perfil", label: "Perfil", icon: User },
] as const;

export function AppHeader() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link to="/dashboard" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="Josias Muebles" className="h-9 w-9 rounded-lg bg-white object-contain p-0.5 ring-1 ring-border" />
          Créditos
        </Link>

        {/* A partir de 6 ítems los labels no entran a 768px, por eso el nav
            horizontal recién aparece en lg; hasta ahí manda la barra inferior. */}
        <nav className="hidden items-center gap-0.5 lg:flex">
          {items.map((it) => {
            const Icon = it.icon;
            const active = pathname === it.to || (it.to !== "/dashboard" && pathname.startsWith(it.to));
            return (
              <Link
                key={it.to}
                to={it.to}
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-secondary/15 text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {it.label}
              </Link>
            );
          })}

          {/* Módulo administrativo (ERP). Se dibuja solo para los usuarios
              habilitados y en pantalla grande; en el celular no aparece, por eso
              no tiene equivalente en bottom-nav.tsx. Ver src/lib/permisos.ts. */}
          <AdminMenu />
        </nav>

        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label="Cambiar tema"
            className="rounded-full"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <div className="hidden h-9 w-9 items-center justify-center rounded-full bg-secondary/20 text-sm font-semibold text-foreground sm:flex">
            {user?.name.charAt(0) ?? "U"}
          </div>
          <Button variant="ghost" size="icon" onClick={logout} aria-label="Cerrar sesión" className="rounded-full">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
