import { Link, useRouterState } from "@tanstack/react-router";
import {
  BookMarked,
  Briefcase,
  CalendarClock,
  ChartColumn,
  FileChartColumn,
  FileSpreadsheet,
  HandCoins,
  LayoutGrid,
  Receipt,
  ShoppingCart,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
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
    // Tablas maestras (backend/definiciones.sql). Las próximas (ciudades,
    // vendedores...) se suman como secciones de este grupo.
    id: "definiciones",
    label: "Definiciones",
    icon: BookMarked,
    secciones: [
      {
        to: "/admin/definiciones/profesiones",
        label: "Profesiones",
        descripcion: "Profesiones de la actividad laboral del cliente",
        icon: Briefcase,
      },
    ],
  },
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
      {
        to: "/admin/recibos-proveedores",
        label: "Recibos de Proveedores",
        descripcion: "Pagos de facturas de compra a crédito",
        icon: HandCoins,
      },
    ],
  },
  {
    id: "reportes",
    label: "Reportes",
    icon: ChartColumn,
    secciones: [
      {
        to: "/admin/reportes/saldos-proveedores",
        label: "Saldos de Proveedores",
        descripcion: "PDF de lo que se le debe a cada proveedor",
        icon: FileChartColumn,
      },
      {
        to: "/admin/reportes/compras",
        label: "Compras por Período",
        descripcion: "PDF de las facturas de compra, contado y crédito, entre dos fechas",
        icon: ShoppingCart,
      },
      {
        to: "/admin/reportes/cheques",
        label: "Cheques a Vencer",
        descripcion: "PDF de los cheques a proveedores por fecha de vencimiento",
        icon: CalendarClock,
      },
      {
        to: "/admin/reportes/margen-articulos",
        label: "Margen de Ventas por Artículos",
        descripcion: "Ganancia y margen de cada artículo vendido a crédito, entre dos fechas",
        icon: TrendingUp,
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
