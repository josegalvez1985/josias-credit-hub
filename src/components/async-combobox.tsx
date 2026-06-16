import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { LovItem } from "@/lib/api";

type Props = {
  value: number | null;
  label: string | null;
  title?: string;
  placeholder?: string;
  emptyText?: string;
  fetcher: (q?: string) => Promise<LovItem[]>;
  onSelect: (item: LovItem) => void;
  renderItem?: (item: LovItem) => React.ReactNode;
};

export function AsyncCombobox({
  value,
  label,
  title = "Seleccionar",
  placeholder = "Seleccionar...",
  emptyText = "Sin resultados",
  fetcher,
  onSelect,
  renderItem,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<LovItem[]>([]);
  const [loading, setLoading] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      fetcher(query || undefined)
        .then(setItems)
        .catch(() => setItems([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(debounce.current);
  }, [open, query, fetcher]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        role="combobox"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={cn("h-10 w-full justify-between font-normal", !value && "text-muted-foreground")}
      >
        <span className="truncate">{label ?? placeholder}</span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby={undefined} className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="border-b border-border px-4 py-3 text-left">
            <DialogTitle className="text-base">{title}</DialogTitle>
          </DialogHeader>

          <div className="relative px-4 pb-3 pt-3">
            <Search className="absolute left-7 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              placeholder="Buscar..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Buscando...
              </div>
            ) : items.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{emptyText}</p>
            ) : (
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item.value}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(item);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted",
                        value === item.value && "bg-muted",
                      )}
                    >
                      <Check className={cn("mt-0.5 h-4 w-4 shrink-0", value === item.value ? "opacity-100" : "opacity-0")} />
                      <span className="min-w-0 flex-1">{renderItem ? renderItem(item) : item.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
