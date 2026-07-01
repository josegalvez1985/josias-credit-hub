import { useEffect, useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
] as const;

// Edad mínima para registrar un cliente (crédito).
const EDAD_MINIMA = 18;
// Rango de años hacia atrás desde el año más reciente permitido.
const RANGO_ANIOS = 100;

// Días reales de un mes (mes 1-12), contemplando bisiestos.
function diasEnMes(anio: number, mes: number): number {
  return new Date(anio, mes, 0).getDate();
}

// Calcula la edad cumplida a partir de una fecha de nacimiento.
function calcularEdad(anio: number, mes: number, dia: number): number {
  const hoy = new Date();
  let edad = hoy.getFullYear() - anio;
  const cumpleEsteAnio = hoy.getMonth() + 1 > mes || (hoy.getMonth() + 1 === mes && hoy.getDate() >= dia);
  if (!cumpleEsteAnio) edad -= 1;
  return edad;
}

type Props = {
  // Fecha en formato YYYY-MM-DD (o "" si no hay selección completa).
  value: string;
  onChange: (value: string) => void;
  className?: string;
};

// Selector de fecha de nacimiento en cascada: Año → Mes → Día.
// Pensado para fechas lejanas (evita el date-picker nativo que abre en el mes actual).
export function BirthdatePicker({ value, onChange, className }: Props) {
  // Estado interno: permite selecciones PARCIALES (solo año, o año+mes) que el
  // string YYYY-MM-DD no puede representar. Se emite hacia fuera solo cuando la
  // fecha está completa.
  const [anio, setAnio] = useState<number | null>(null);
  const [mes, setMes] = useState<number | null>(null);
  const [dia, setDia] = useState<number | null>(null);

  // Sincroniza desde el value externo (ej. reset del formulario o valor inicial).
  useEffect(() => {
    if (!value) return;
    const [a, m, d] = value.split("-").map(Number);
    if (a && a !== anio) setAnio(a);
    if (m && m !== mes) setMes(m);
    if (d && d !== dia) setDia(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const anioMax = new Date().getFullYear() - EDAD_MINIMA;
  const anios = useMemo(
    () => Array.from({ length: RANGO_ANIOS + 1 }, (_, i) => anioMax - i),
    [anioMax],
  );

  const diasDelMes = anio && mes ? diasEnMes(anio, mes) : 31;
  const dias = useMemo(
    () => Array.from({ length: diasDelMes }, (_, i) => i + 1),
    [diasDelMes],
  );

  // Emite YYYY-MM-DD solo si la fecha está completa; "" en caso contrario.
  const emitir = (a: number | null, m: number | null, d: number | null) => {
    if (a && m && d) {
      onChange(`${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    } else {
      onChange("");
    }
  };

  const onAnio = (v: string) => {
    const a = Number(v);
    setAnio(a);
    // Reajusta el día si el nuevo año deja febrero fuera de rango (bisiesto).
    const d = mes && dia ? Math.min(dia, diasEnMes(a, mes)) : dia;
    setDia(d);
    emitir(a, mes, d);
  };

  const onMes = (v: string) => {
    const m = Number(v);
    setMes(m);
    // Reajusta el día si el nuevo mes tiene menos días que el elegido.
    const d = anio && dia ? Math.min(dia, diasEnMes(anio, m)) : dia;
    setDia(d);
    emitir(anio, m, d);
  };

  const onDia = (v: string) => {
    const d = Number(v);
    setDia(d);
    emitir(anio, mes, d);
  };

  const edad = anio && mes && dia ? calcularEdad(anio, mes, dia) : null;

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="grid grid-cols-3 gap-2">
        {/* Año */}
        <Select value={anio ? String(anio) : ""} onValueChange={onAnio}>
          <SelectTrigger className="h-10">
            <SelectValue placeholder="Año" />
          </SelectTrigger>
          <SelectContent className="max-h-64">
            {anios.map((a) => (
              <SelectItem key={a} value={String(a)}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Mes — habilitado tras elegir año */}
        <Select value={mes ? String(mes) : ""} onValueChange={onMes} disabled={!anio}>
          <SelectTrigger className="h-10">
            <SelectValue placeholder="Mes" />
          </SelectTrigger>
          <SelectContent className="max-h-64">
            {MESES.map((nombre, i) => (
              <SelectItem key={nombre} value={String(i + 1)}>
                {nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Día — habilitado tras elegir mes */}
        <Select value={dia ? String(dia) : ""} onValueChange={onDia} disabled={!anio || !mes}>
          <SelectTrigger className="h-10">
            <SelectValue placeholder="Día" />
          </SelectTrigger>
          <SelectContent className="max-h-64">
            {dias.map((d) => (
              <SelectItem key={d} value={String(d)}>
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Resumen legible + edad */}
      {anio && mes && dia && (
        <p className="text-xs text-muted-foreground">
          {dia} de {MESES[mes - 1].toLowerCase()} de {anio}
          {edad !== null && ` · ${edad} años`}
        </p>
      )}
    </div>
  );
}
