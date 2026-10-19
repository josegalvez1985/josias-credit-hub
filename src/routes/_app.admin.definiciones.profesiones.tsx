import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Briefcase, Loader2, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  actualizarProfesion,
  crearProfesion,
  eliminarProfesion,
  listarProfesiones,
  type Profesion,
} from "@/lib/api";
import { AdminHeader } from "./_app.admin";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

export const Route = createFileRoute("/_app/admin/definiciones/profesiones")({
  head: () => ({
    meta: [
      { title: "Profesiones — Administración" },
      { name: "description", content: "Definición de profesiones." },
    ],
  }),
  component: ProfesionesPage,
});

// La misma limpieza que hace pkg_definiciones antes de grabar: sin espacios al
// borde ni repetidos, con las mayúsculas como se escribieron.
function limpiar(texto: string) {
  return texto.trim().replace(/\s+/g, " ");
}

function ordenar(items: Profesion[]) {
  return [...items].sort((a, b) =>
    a.descripcion.localeCompare(b.descripcion, "es", { sensitivity: "base" }),
  );
}

// ABM de PROFESIONES (backend/definiciones.sql). Son pocas filas —17 al
// 2026-10-19—, así que se traen enteras y se busca en memoria.
//
// La tabla la lee también el LOV del asesor (wizard de solicitud): lo que se
// cambie acá se ve allá al instante.
function ProfesionesPage() {
  const [items, setItems] = useState<Profesion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // "nueva" abre el diálogo vacío; una profesión lo abre para editarla.
  const [editando, setEditando] = useState<Profesion | "nueva" | null>(null);
  const [borrando, setBorrando] = useState<Profesion | null>(null);

  const load = useCallback(() => {
    if (!API_URL) {
      setError("Configura VITE_API_URL para ver las profesiones.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    listarProfesiones()
      .then((r) => setItems(ordenar(r)))
      .catch((e) => setError(e instanceof Error ? e.message : "Error al cargar"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const visibles = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return items;
    return items.filter(
      (p) => p.descripcion.toLowerCase().includes(term) || String(p.cod_profesion) === term,
    );
  }, [items, query]);

  // Después de grabar se actualiza la lista local en vez de volver a pedirla:
  // evita el parpadeo del "Cargando..." y la respuesta ya dice todo lo que
  // cambió.
  function guardada(p: Profesion) {
    setItems((prev) => ordenar([...prev.filter((x) => x.cod_profesion !== p.cod_profesion), p]));
  }

  async function eliminar() {
    if (!borrando) return;
    const p = borrando;
    try {
      await eliminarProfesion(p.cod_profesion);
      setItems((prev) => prev.filter((x) => x.cod_profesion !== p.cod_profesion));
      toast.success(`Profesión ${p.descripcion} eliminada`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo eliminar la profesión");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <AdminHeader
          titulo="Profesiones"
          descripcion={loading ? "Cargando..." : `${items.length} profesiones definidas`}
        />
        <div className="flex items-center gap-2">
          {!loading && API_URL && (
            <Button
              variant="outline"
              size="icon"
              onClick={load}
              aria-label="Recargar"
              className="rounded-full"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
          <Button
            onClick={() => setEditando("nueva")}
            disabled={loading || !!error}
            className="rounded-full bg-primary text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Nueva profesión
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">Cargando profesiones...</p>
        </div>
      ) : error ? (
        <Card className="flex flex-col items-center justify-center gap-3 p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertCircle className="h-5 w-5" />
          </div>
          <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
          {API_URL && (
            <Button variant="outline" onClick={load} className="mt-1">
              <RefreshCw className="h-4 w-4" /> Reintentar
            </Button>
          )}
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por descripción o código..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-11 rounded-full bg-card pl-10"
            />
          </div>

          {visibles.length === 0 ? (
            <Card className="flex flex-col items-center justify-center gap-3 p-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Briefcase className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                {query
                  ? "No hay profesiones que coincidan."
                  : "Todavía no hay profesiones definidas."}
              </p>
            </Card>
          ) : (
            <Card className="max-w-4xl overflow-hidden p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/60 hover:bg-muted/60">
                      <TableHead className="w-24">Código</TableHead>
                      <TableHead>Descripción</TableHead>
                      <TableHead className="text-right">Solicitudes</TableHead>
                      <TableHead className="text-right">Créditos</TableHead>
                      <TableHead className="w-28" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibles.map((p) => {
                      const enUso = p.usos_solicitudes + p.usos_creditos > 0;
                      return (
                        <TableRow key={p.cod_profesion}>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {p.cod_profesion}
                          </TableCell>
                          <TableCell className="max-w-[28rem]">
                            <p className="truncate font-medium" title={p.descripcion}>
                              {p.descripcion}
                            </p>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {p.usos_solicitudes || <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {p.usos_creditos || <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => setEditando(p)}
                                aria-label={`Editar ${p.descripcion}`}
                                title="Editar"
                                className="inline-flex rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary/15 hover:text-secondary"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              {/* En uso no se puede borrar (lo frena también
                                  Oracle). El title explica por qué. */}
                              <button
                                type="button"
                                onClick={() => setBorrando(p)}
                                disabled={enUso}
                                aria-label={`Eliminar ${p.descripcion}`}
                                title={
                                  enUso
                                    ? "Está en uso: no se puede eliminar. Si el nombre está mal, editala."
                                    : "Eliminar"
                                }
                                className="inline-flex rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}
        </div>
      )}

      <ProfesionDialog
        profesion={editando}
        existentes={items}
        onClose={() => setEditando(null)}
        onGuardada={guardada}
      />

      <AlertDialog open={borrando !== null} onOpenChange={(o) => !o && setBorrando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar la profesión {borrando?.descripcion}?</AlertDialogTitle>
            <AlertDialogDescription>
              Deja de aparecer en el formulario de solicitud del asesor. No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={eliminar}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Alta y edición en el mismo diálogo: es un solo campo, no justifica una
// página aparte.
function ProfesionDialog({
  profesion,
  existentes,
  onClose,
  onGuardada,
}: {
  profesion: Profesion | "nueva" | null;
  existentes: Profesion[];
  onClose: () => void;
  onGuardada: (p: Profesion) => void;
}) {
  const editando = profesion !== null && profesion !== "nueva" ? profesion : null;
  const [descripcion, setDescripcion] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (profesion !== null) setDescripcion(editando?.descripcion ?? "");
  }, [profesion, editando]);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const desc = limpiar(descripcion);
    if (!desc) return toast.error("Completá: Descripción");

    // Oracle lo valida igual; acá es para no esperar el viaje.
    const repetida = existentes.find(
      (p) =>
        p.cod_profesion !== editando?.cod_profesion &&
        limpiar(p.descripcion).toLowerCase() === desc.toLowerCase(),
    );
    if (repetida) {
      return toast.error(`Ya existe la profesión ${repetida.descripcion} (código ${repetida.cod_profesion})`);
    }

    setGuardando(true);
    try {
      if (editando) {
        await actualizarProfesion(editando.cod_profesion, desc);
        onGuardada({ ...editando, descripcion: desc });
        toast.success("Profesión actualizada");
      } else {
        const r = await crearProfesion(desc);
        onGuardada({
          cod_profesion: r.cod_profesion,
          descripcion: desc,
          usos_solicitudes: 0,
          usos_creditos: 0,
        });
        toast.success(`Profesión ${desc} creada`);
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar la profesión");
    } finally {
      setGuardando(false);
    }
  }

  const usos = editando ? editando.usos_solicitudes + editando.usos_creditos : 0;

  return (
    <Dialog open={profesion !== null} onOpenChange={(o) => !o && !guardando && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={guardar} className="space-y-5">
          <DialogHeader className="text-left">
            <DialogTitle className="font-display text-xl">
              {editando ? "Editar profesión" : "Nueva profesión"}
            </DialogTitle>
            <DialogDescription>
              {editando
                ? usos > 0
                  ? `Código ${editando.cod_profesion}. El cambio se ve en las ${usos} solicitudes y créditos que la usan.`
                  : `Código ${editando.cod_profesion}.`
                : "El código lo asigna el sistema."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label htmlFor="descripcion" className="text-sm font-medium">
              Descripción <span className="text-destructive">*</span>
            </label>
            <Input
              id="descripcion"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              maxLength={200}
              autoFocus
              autoComplete="off"
              className="h-11 rounded-xl"
            />
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={guardando}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={guardando}
              className="bg-primary text-primary-foreground hover:opacity-90"
            >
              {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
