// Quién ve el módulo administrativo (ERP).
//
// La app nació como herramienta de cobradores en el celular. El módulo
// administrativo que empieza acá es lo contrario: se usa sentado frente a una
// PC, con pantalla grande, y solo por unas pocas personas. De ahí las dos
// condiciones que se combinan en `useAdmin()`:
//
//   1. El usuario está en la lista blanca de abajo.
//   2. La pantalla es de escritorio/notebook (>= 1024 px).
//
// La condición 2 vale también con la PWA instalada en una notebook: lo que
// manda es el ancho de la ventana, no cómo se abrió la app. En un celular el
// menú no aparece aunque el usuario esté habilitado.

import { useEffect, useState } from "react";
import { useAuth } from "./auth";

// Usuarios habilitados, en MAYÚSCULAS: así los devuelve el login contra ORDS
// (`auth.tsx` normaliza el username con toUpperCase antes de mandarlo).
//
// ⚠ Esto es una restricción de INTERFAZ, no de seguridad: cualquiera que edite
// el bundle puede hacer aparecer el menú. Cuando el módulo administrativo tenga
// endpoints propios, cada uno tiene que validar el permiso del lado de Oracle
// contra el token — la lista de acá solo decide qué se dibuja.
const USUARIOS_ADMIN = ["AAQUINO", "AGONZALEZ", "JOSEG"] as const;

export function esUsuarioAdmin(username?: string | null): boolean {
  if (!username) return false;
  return USUARIOS_ADMIN.includes(username.trim().toUpperCase() as (typeof USUARIOS_ADMIN)[number]);
}

// El breakpoint `lg` de Tailwind, que es donde el header ya cambia de la barra
// inferior al nav horizontal. Se reusa el mismo número para que el menú
// administrativo aparezca exactamente cuando aparece el nav de escritorio.
const ESCRITORIO = "(min-width: 1024px)";

// Se escucha el cambio de tamaño en vez de leerlo una sola vez: si se rota la
// tablet o se achica la ventana, el menú aparece y desaparece con ella.
export function useEsEscritorio(): boolean {
  // Arranca en false: durante el prerender (SSR a estático) no hay window, y
  // asumir "escritorio" haría parpadear el menú en el celular al hidratar.
  const [esEscritorio, setEsEscritorio] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(ESCRITORIO);
    const aplicar = () => setEsEscritorio(mq.matches);
    aplicar();
    mq.addEventListener("change", aplicar);
    return () => mq.removeEventListener("change", aplicar);
  }, []);

  return esEscritorio;
}

// true solo si el usuario está habilitado Y está en una pantalla grande.
export function useAdmin(): boolean {
  const { user } = useAuth();
  const esEscritorio = useEsEscritorio();
  return esUsuarioAdmin(user?.username) && esEscritorio;
}
