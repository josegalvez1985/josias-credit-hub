import { Link, useRouterState } from "@tanstack/react-router";
import { Home, FilePlus, FileText, User } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/dashboard", label: "Inicio", icon: Home },
  { to: "/solicitudes", label: "Solicitudes", icon: FileText },
  { to: "/solicitudes/nueva", label: "Nueva", icon: FilePlus, highlight: true },
  { to: "/perfil", label: "Perfil", icon: User },
] as const;

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav
      className="sticky bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-2xl items-stretch justify-around">
        {items.map((it) => {
          const Icon = it.icon;
          const active = pathname === it.to || (it.to !== "/dashboard" && pathname.startsWith(it.to));
          if (it.highlight) {
            return (
              <li key={it.to} className="flex items-center justify-center px-2">
                <Link
                  to={it.to}
                  className="-mt-6 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-caramel text-primary-foreground shadow-warm transition-transform active:scale-95"
                  aria-label={it.label}
                >
                  <Icon className="h-6 w-6" strokeWidth={2.4} />
                </Link>
              </li>
            );
          }
          return (
            <li key={it.to} className="flex-1">
              <Link
                to={it.to}
                className={cn(
                  "flex flex-col items-center gap-1 py-3 text-xs transition-colors",
                  active ? "text-secondary" : "text-muted-foreground",
                )}
              >
                <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 1.8} />
                <span className={cn(active && "font-medium")}>{it.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
