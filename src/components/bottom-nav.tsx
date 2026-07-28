import { Link, useRouterState } from "@tanstack/react-router";
import { Home, FilePlus, FileText, Receipt, Tag, User } from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  to: "/dashboard" | "/solicitudes" | "/solicitudes/nueva" | "/recibos" | "/precios" | "/perfil";
  label: string;
  icon: typeof Home;
  highlight?: boolean;
};

const items: NavItem[] = [
  { to: "/dashboard", label: "Inicio", icon: Home },
  { to: "/solicitudes", label: "Solicitudes", icon: FileText },
  { to: "/solicitudes/nueva", label: "Nueva", icon: FilePlus, highlight: true },
  { to: "/recibos", label: "Recibos", icon: Receipt },
  { to: "/precios", label: "Precios", icon: Tag },
  { to: "/perfil", label: "Perfil", icon: User },
];

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav
      className="sticky bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur lg:hidden"
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
            <li key={it.to} className="min-w-0 flex-1">
              <Link
                to={it.to}
                className={cn(
                  // Con 6 ítems quedan ~55px por ítem en pantallas de 360px: el label
                  // va a 10px y truncado para que "Solicitudes" no desborde.
                  "flex flex-col items-center gap-1 px-0.5 py-3 text-[10px] transition-colors sm:text-xs",
                  active ? "text-secondary" : "text-muted-foreground",
                )}
              >
                <Icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2.4 : 1.8} />
                <span className={cn("w-full truncate text-center", active && "font-medium")}>
                  {it.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
