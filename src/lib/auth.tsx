import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type User = {
  id: string;
  name: string;
  email: string;
  username: string;
  role: "asesor" | "supervisor";
  avatar?: string;
  biometricEnabled?: boolean;
};

// Mock users database
export const MOCK_USERS: Array<User & { password: string }> = [
  {
    id: "1",
    name: "María González",
    email: "maria@josiasmuebles.com",
    username: "maria",
    password: "demo123",
    role: "asesor",
  },
  {
    id: "2",
    name: "Carlos Ramírez",
    email: "carlos@josiasmuebles.com",
    username: "carlos",
    password: "demo123",
    role: "supervisor",
  },
];

type AuthCtx = {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  updateUser: (patch: Partial<User>) => void;
  changePassword: (current: string, next: string) => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

const STORAGE_KEY = "jm-auth-user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setUser(JSON.parse(raw));
    } catch {}
    setLoading(false);
  }, []);

  const persist = (u: User | null) => {
    setUser(u);
    if (u) localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    else localStorage.removeItem(STORAGE_KEY);
  };

  const login = async (username: string, password: string) => {
    await new Promise((r) => setTimeout(r, 600));
    const found = MOCK_USERS.find(
      (u) => (u.username === username || u.email === username) && u.password === password,
    );
    if (!found) throw new Error("Usuario o contraseña incorrectos");
    const { password: _p, ...safe } = found;
    persist(safe);
  };

  const logout = () => persist(null);

  const updateUser = (patch: Partial<User>) => {
    if (!user) return;
    persist({ ...user, ...patch });
  };

  const changePassword = async (current: string, next: string) => {
    await new Promise((r) => setTimeout(r, 400));
    if (!user) throw new Error("No hay sesión");
    const found = MOCK_USERS.find((u) => u.id === user.id);
    if (!found || found.password !== current) throw new Error("Contraseña actual incorrecta");
    found.password = next;
  };

  return (
    <Ctx.Provider value={{ user, loading, login, logout, updateUser, changePassword }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
