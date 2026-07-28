import { useCallback } from "react";
import { lovRecibos, type ClienteRecibosLov, type LovItem } from "@/lib/api";
import { AsyncCombobox } from "@/components/async-combobox";

// Selector de cliente del módulo de cobranzas. Solo lista clientes con cuotas
// pendientes, igual que el LOV de las páginas 3 y 4 de APEX.
//
// La búsqueda es server-side y mira todos los campos: nombre, fantasía, CI, RUC,
// teléfono y código. Además compara los números por separado, así "1.712"
// encuentra al CI "1.712.345" esté guardado con puntos o sin ellos.
export function ClienteCombobox({
  value,
  label,
  onSelect,
}: {
  value: number | null;
  label: string | null;
  onSelect: (item: ClienteRecibosLov) => void;
}) {
  const fetcher = useCallback((q?: string) => lovRecibos.clientes(q), []);

  return (
    <AsyncCombobox
      title="Cliente"
      placeholder="Buscar por nombre, CI, RUC o teléfono..."
      value={value}
      label={label}
      fetcher={fetcher}
      onSelect={(it) => onSelect(it as ClienteRecibosLov)}
      renderItem={renderCliente}
    />
  );
}

// Dos líneas: nombre arriba, documento y teléfono abajo. Así se ve por qué
// matcheó la búsqueda cuando se buscó por CI o por teléfono.
function renderCliente(it: LovItem) {
  const c = it as ClienteRecibosLov;
  const abajo = [c.ci ?? c.ruc, c.nro_telefono].filter(Boolean).join(" · ");
  return (
    <div className="flex min-w-0 flex-col">
      <span className="truncate">{it.label}</span>
      {abajo && <span className="truncate text-xs text-muted-foreground">{abajo}</span>}
    </div>
  );
}
