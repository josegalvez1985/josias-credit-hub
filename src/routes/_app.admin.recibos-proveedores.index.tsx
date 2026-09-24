import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Eye,
  HandCoins,
  Loader2,
  Plus,
  Receipt,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  estadoFactura,
  FORMAS_PAGO,
  listarFacturasCompra,
  listarRecibosProveedor,
  type FacturaCompra,
  type ReciboProveedor,
} from "@/lib/api";
import { formatCurrency } from "@/lib/credit-applications";
import { cn, fechaPy } from "@/lib/utils";
import { AdminHeader } from "./_app.admin";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

export const Route = createFileRoute("/_app/admin/recibos-proveedores/")({
  // La pestaña va en la URL para que "Volver" desde el detalle de un recibo
  // caiga en la lista de recibos y no en la de facturas.
  validateSearch: (s: Record<string, unknown>): { tab?: "recibos" } =>
    s.tab === "recibos" ? { tab: "recibos" } : {},
  head: () => ({
    meta: [
      { title: "Recibos de Proveedores — Administración" },
      { name: "description", content: "Pagos de facturas de compra a crédito." },
    ],
  }),
  component: RecibosProveedoresPage,
});

// Facturas de compra a crédito y los recibos con que se pagan
// (backend/proveedores.sql). Las dos listas son chicas —117 facturas al
// 2026-09-24—, así que se traen enteras y se filtran acá: el backend no pagina.
function RecibosProveedoresPage() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const [facturas, setFacturas] = useState<FacturaCompra[]>([]);
  const [recibos, setRecibos] = useState<ReciboProveedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!API_URL) {
      setError("Configura VITE_API_URL para ver los recibos de proveedores.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    Promise.all([listarFacturasCompra(), listarRecibosProveedor()])
      .then(([f, r]) => {
        setFacturas(f);
        setRecibos(r);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error al cargar"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const pendientes = useMemo(() => facturas.filter((f) => f.saldo > 0), [facturas]);
  const saldoTotal = useMemo(() => pendientes.reduce((s, f) => s + f.saldo, 0), [pendientes]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <AdminHeader
          titulo="Recibos de Proveedores"
          descripcion={
            loading
              ? "Cargando..."
              : `${pendientes.length} facturas a crédito con saldo · ${formatCurrency(saldoTotal)} pendiente`
          }
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
            asChild
            className="rounded-full bg-primary text-primary-foreground hover:opacity-90"
          >
            <Link to="/admin/recibos-proveedores/nuevo">
              <Plus className="h-4 w-4" /> Nuevo recibo
            </Link>
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">Cargando facturas y recibos...</p>
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
        <Tabs
          value={tab ?? "facturas"}
          onValueChange={(v) =>
            navigate({ search: v === "recibos" ? { tab: "recibos" } : {}, replace: true })
          }
          className="space-y-4"
        >
          <TabsList>
            <TabsTrigger value="facturas">Facturas a crédito</TabsTrigger>
            <TabsTrigger value="recibos">Recibos ({recibos.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="facturas">
            <TablaFacturas facturas={facturas} />
          </TabsContent>
          <TabsContent value="recibos">
            <TablaRecibos recibos={recibos} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function TablaFacturas({ facturas }: { facturas: FacturaCompra[] }) {
  const [soloPendientes, setSoloPendientes] = useState(true);
  const [query, setQuery] = useState("");

  const visibles = useMemo(
    () =>
      facturas.filter(
        (f) =>
          (!soloPendientes || f.saldo > 0) &&
          coincide(query, f.proveedor, f.documento, f.referencia),
      ),
    [facturas, soloPendientes, query],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por proveedor, RUC o nro. de factura..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 rounded-full bg-card pl-10"
          />
        </div>
        <div className="flex gap-1 rounded-full border border-border bg-card p-1">
          {[
            { v: true, label: "Con saldo" },
            { v: false, label: "Todas" },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              onClick={() => setSoloPendientes(o.v)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm transition-colors",
                soloPendientes === o.v
                  ? "bg-primary/10 font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {visibles.length === 0 ? (
        <Vacio
          icon={<HandCoins className="h-5 w-5 text-muted-foreground" />}
          texto={
            query
              ? "No hay facturas que coincidan."
              : soloPendientes
                ? "No hay facturas a crédito con saldo pendiente."
                : "No hay facturas de compra a crédito."
          }
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/60 hover:bg-muted/60">
                  <TableHead>Fecha</TableHead>
                  <TableHead>Nro. Factura</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Pagado</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibles.map((f) => (
                  <TableRow key={f.id_cabecera}>
                    <TableCell className="whitespace-nowrap">{fechaPy(f.fecha)}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {f.referencia || (
                        <span className="text-muted-foreground">ID {f.id_cabecera}</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[20rem]">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{f.proveedor || "Sin proveedor"}</p>
                        {f.documento && (
                          <p className="truncate text-xs text-muted-foreground">{f.documento}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(f.total)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatCurrency(f.pagado)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-display font-semibold",
                        f.saldo < 0 && "text-destructive",
                      )}
                    >
                      {formatCurrency(f.saldo)}
                    </TableCell>
                    <TableCell>
                      <EstadoFactura f={f} />
                    </TableCell>
                    <TableCell className="text-right">
                      {/* Sin proveedor no se puede pagar: el recibo exige uno
                          y todas sus facturas tienen que ser de él. */}
                      {f.saldo > 0 && f.cod_proveedor ? (
                        <Button asChild variant="outline" size="sm" className="rounded-full">
                          <Link
                            to="/admin/recibos-proveedores/nuevo"
                            search={{ proveedor: f.cod_proveedor, factura: f.id_cabecera }}
                          >
                            Pagar
                          </Link>
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}

function TablaRecibos({ recibos }: { recibos: ReciboProveedor[] }) {
  const [query, setQuery] = useState("");

  const visibles = useMemo(
    () =>
      recibos.filter((r) =>
        coincide(query, r.proveedor, r.documento, r.nro_recibo, r.nro_comprobante, r.facturas),
      ),
    [recibos, query],
  );

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por proveedor, RUC, nro. de recibo, comprobante o factura..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-11 rounded-full bg-card pl-10"
        />
      </div>

      {visibles.length === 0 ? (
        <Vacio
          icon={<Receipt className="h-5 w-5 text-muted-foreground" />}
          texto={
            query
              ? "No hay recibos que coincidan."
              : "Todavía no se cargó ningún recibo de proveedor."
          }
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/60 hover:bg-muted/60">
                  <TableHead className="w-14">Ver</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Nro. Recibo</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead>Forma de pago</TableHead>
                  <TableHead>Facturas</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibles.map((r) => (
                  <TableRow key={r.id_recibo}>
                    <TableCell>
                      <Link
                        to="/admin/recibos-proveedores/$id"
                        params={{ id: String(r.id_recibo) }}
                        aria-label={`Ver recibo ${r.nro_recibo}`}
                        className="inline-flex rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary/15 hover:text-secondary"
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{fechaPy(r.fecha)}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {r.nro_recibo}
                    </TableCell>
                    <TableCell className="max-w-[20rem]">
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {r.proveedor || `Proveedor ${r.cod_proveedor}`}
                        </p>
                        {r.documento && (
                          <p className="truncate text-xs text-muted-foreground">{r.documento}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[12rem]">
                      <div className="min-w-0">
                        <p className="truncate">{r.forma_pago ? FORMAS_PAGO[r.forma_pago] : "—"}</p>
                        {r.nro_comprobante && (
                          <p className="truncate text-xs text-muted-foreground">
                            {r.nro_comprobante}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[16rem]">
                      <p className="truncate font-mono text-xs" title={r.facturas}>
                        {r.facturas || "—"}
                      </p>
                      {r.cant_facturas > 1 && (
                        <p className="text-xs text-muted-foreground">{r.cant_facturas} facturas</p>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-display font-semibold">
                      {formatCurrency(r.monto_total)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}

function EstadoFactura({ f }: { f: FacturaCompra }) {
  const base = "rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap";
  switch (estadoFactura(f)) {
    case "sin_monto":
      return (
        <span
          className={cn(base, "bg-muted text-muted-foreground")}
          title="La factura no tiene artículos con precio cargados: el total calculado es 0."
        >
          Sin monto
        </span>
      );
    case "pagada":
      return <span className={cn(base, "bg-success/15 text-success")}>Pagada</span>;
    case "parcial":
      return (
        <span className={cn(base, "bg-warning/20 text-warning-foreground")}>Pago parcial</span>
      );
    case "pendiente":
      return <span className={cn(base, "bg-secondary/15 text-secondary")}>Pendiente</span>;
  }
}

function Vacio({ icon, texto }: { icon: React.ReactNode; texto: string }) {
  return (
    <Card className="flex flex-col items-center justify-center gap-3 p-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">{icon}</div>
      <p className="text-sm text-muted-foreground">{texto}</p>
    </Card>
  );
}

// Busca en los campos indicados, sin distinguir mayúsculas. Para números
// compara solo dígitos y campo por campo, así "1521" encuentra la factura
// "001-001-0001521" y "80012345" el RUC "80012345-6". Es el criterio de
// filtrarLov, pero sin mirar los montos: buscar "1000" no tiene que traer
// todas las facturas cuyo total contiene esos dígitos.
function coincide(q: string, ...campos: (string | null | undefined)[]) {
  const term = q.trim().toLowerCase();
  if (!term) return true;
  if (campos.some((c) => (c ?? "").toLowerCase().includes(term))) return true;
  const digits = term.replace(/\D/g, "");
  return digits.length > 0 && campos.some((c) => (c ?? "").replace(/\D/g, "").includes(digits));
}
