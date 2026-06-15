import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type ApplicationStatus = "pendiente" | "aprobada" | "rechazada" | "revision";

export type CreditApplication = {
  id: string;
  clientName: string;
  clientId: string; // cédula / id
  phone: string;
  email?: string;
  product: string;
  amount: number;
  termMonths: number;
  monthlyIncome: number;
  notes?: string;
  status: ApplicationStatus;
  createdAt: string;
  createdBy: string;
};

const STORAGE_KEY = "jm-credit-applications";

const SEED: CreditApplication[] = [
  {
    id: "SOL-00124",
    clientName: "Ana Lucía Pérez",
    clientId: "1004567890",
    phone: "+57 300 123 4567",
    email: "ana.perez@example.com",
    product: "Sala modular Toscana",
    amount: 2850000,
    termMonths: 18,
    monthlyIncome: 2500000,
    status: "pendiente",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
    createdBy: "María González",
  },
  {
    id: "SOL-00123",
    clientName: "Jorge Méndez",
    clientId: "98765432",
    phone: "+57 311 987 6543",
    product: "Comedor Roble 6 puestos",
    amount: 1950000,
    termMonths: 12,
    monthlyIncome: 3200000,
    status: "aprobada",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
    createdBy: "Carlos Ramírez",
  },
  {
    id: "SOL-00122",
    clientName: "Sofía Cárdenas",
    clientId: "1023456789",
    phone: "+57 320 444 1122",
    product: "Cama King Premium",
    amount: 3450000,
    termMonths: 24,
    monthlyIncome: 1800000,
    status: "revision",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
    createdBy: "María González",
  },
  {
    id: "SOL-00121",
    clientName: "Roberto Silva",
    clientId: "80123456",
    phone: "+57 315 222 9988",
    product: "Escritorio ejecutivo",
    amount: 1200000,
    termMonths: 6,
    monthlyIncome: 2900000,
    status: "rechazada",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(),
    createdBy: "Carlos Ramírez",
  },
];

type Ctx = {
  applications: CreditApplication[];
  addApplication: (data: Omit<CreditApplication, "id" | "status" | "createdAt" | "createdBy">, createdBy: string) => CreditApplication;
};

const ApplicationsCtx = createContext<Ctx | null>(null);

export function ApplicationsProvider({ children }: { children: ReactNode }) {
  const [applications, setApplications] = useState<CreditApplication[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        setApplications(JSON.parse(raw));
        return;
      }
    } catch {}
    setApplications(SEED);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED));
  }, []);

  const persist = (list: CreditApplication[]) => {
    setApplications(list);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  };

  const addApplication: Ctx["addApplication"] = (data, createdBy) => {
    const next: CreditApplication = {
      ...data,
      id: `SOL-${String(125 + applications.length).padStart(5, "0")}`,
      status: "pendiente",
      createdAt: new Date().toISOString(),
      createdBy,
    };
    persist([next, ...applications]);
    return next;
  };

  return (
    <ApplicationsCtx.Provider value={{ applications, addApplication }}>{children}</ApplicationsCtx.Provider>
  );
}

export function useApplications() {
  const ctx = useContext(ApplicationsCtx);
  if (!ctx) throw new Error("useApplications must be used within ApplicationsProvider");
  return ctx;
}

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  pendiente: "Pendiente",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
  revision: "En revisión",
};

export function formatCurrency(n: number) {
  return new Intl.NumberFormat("es-PY", { style: "currency", currency: "PYG", maximumFractionDigits: 0 }).format(n);
}
