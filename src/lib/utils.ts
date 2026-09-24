import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// "2026-09-22" -> "22/09/2026", sin pasar por Date. `new Date("2026-09-22")`
// se interpreta como medianoche UTC, y en Paraguay (UTC-3) toLocaleDateString
// lo muestra como el 21/09.
export function fechaPy(iso?: string | null): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

// Hoy en la hora local como YYYY-MM-DD. `toISOString()` da la fecha UTC, que
// después de las 21:00 en Paraguay ya es la de mañana.
export function hoyISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
