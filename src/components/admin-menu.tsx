import { Link, useRouterState } from "@tanstack/react-router";
import { FileSpreadsheet, LayoutGrid, Receipt, type LucideIcon } from "lucide-react";
import { useAdmin } from "@/lib/permisos";
import { cn } from "@/lib/utils";

// Registro del módulo administrativo (ERP).
//
// ═══ ACÁ SE AGREGA TODO ═══
// Una entrada nueva se declara una sola vez en GRUPOS_ADMIN y aparece sola en
// la barra lateral y en el índice de /admin. Después solo falta crear su ruta
// en src/routes/_app.admin.<seccion>.tsx.
//
// Si el grupo no existe todavía, se agrega un objeto más al array: el orden
// del array es el orden en que se muestran.

export type SeccionAdmin = {
  to: string;
  label: string;
  descripcion: string;
  icon: LucideIcon;
};

export type GrupoAdmin = {
  id: string;
  label: string;
  icon: LucideIcon;
  secciones: SeccionAdmin[];
};

export const GRUPOS_ADMIN: GrupoAdmin[] = [
  {
    id: "operaciones",
    label: "Operaciones",
    icon: Receipt,
    secciones: [
      {
        to: "/admin/creditos",
        label: "Solicitud de Créditos",
        descripcion: "Consulta e impresión de créditos otorgados",
        icon: FileSpreadsheet,
      },
    ],
  },
];

// Todas las secciones aplanadas, para el índice de /admin y para resolver la
// ruta activa sin recorrer los grupos a mano.
export const SECCIONES_ADMIN: SeccionAdmin[] = GRUPOS_ADMIN.flatMap((g) => g.secciones);

// Devuelve el grupo al que pertenece una ruta, o undefined si no es de admin.
export function grupoDeRuta(pathname: string): GrupoAdmin | undefined {
  return GRUPOS_ADMIN.find((g) => g.secciones.some((s) => pathname.startsWith(s.to)));
}

// Entrada al módulo administrativo en el header de escritorio.
//
// Solo se dibuja si `useAdmin()` da true: usuario habilitado + pantalla grande.
// En el celular no aparece, ni siquiera para esos usuarios, así que la barra
// inferior (`bottom-nav.tsx`) queda intacta.
export function AdminMenu() {
  const admin = useAdmin();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (!admin) return null;

  const active = pathname.startsWith("/admin");

  return (
    <Link
      to="/admin"
      className={cn(
        "flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-2 text-sm transition-colors",
        active
          ? "bg-secondary/15 text-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <LayoutGrid className="h-4 w-4" />
      Administración
    </Link>
  );
}
