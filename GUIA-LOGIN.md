# Guía: implementar el login (ORDS + APEX + React)

Guía para replicar el sistema de autenticación de Josias Credit Hub en otro proyecto.

**Arquitectura en una línea:** el frontend hace `POST /auth/login` a ORDS → ORDS valida las credenciales **contra los usuarios de APEX** (`apex_util.is_login_password_valid`) → genera un token propio con `pkg_auth_token` → el frontend lo guarda en `localStorage` y lo manda como `Authorization: Bearer` en cada request.

Lo importante: **no administrás usuarios ni contraseñas.** Eso lo hace APEX. Vos solo emitís y validás tokens.

```
┌──────────────┐   POST /auth/login    ┌─────────────────┐
│   React SPA  │ ────────────────────► │  ORDS /auth/    │
│              │  {username, password} │                 │
│              │                       │  apex_util.     │
│  localStorage│ ◄──────────────────── │  is_login_      │
│  {token,user}│  {success,token,user} │  password_valid │
└──────┬───────┘                       └────────┬────────┘
       │                                        │
       │  Authorization: Bearer <token>         ▼
       └──────────────────────────────► pkg_auth_token
                                        (tabla de tokens)
```

---

## Parte 1 — Backend (ORDS + APEX)

### 1.1 Prerrequisito: el workspace de APEX

Este diseño **no tiene tabla propia de usuarios**. Las credenciales viven en los usuarios del workspace APEX. Necesitás:

- Un workspace APEX (en este caso `JOSIASMUEBLES`)
- Usuarios creados ahí (Administration → Manage Users and Groups)
- El schema REST-enabled con un base path

```sql
BEGIN
  ORDS.ENABLE_SCHEMA(
      p_enabled             => TRUE,
      p_url_mapping_type    => 'BASE_PATH',
      p_url_mapping_pattern => 'josiasmuebles',   -- cambialo por el tuyo
      p_auto_rest_auth      => FALSE);
  COMMIT;
END;
/
```

La URL base queda: `https://<host>/ords/<workspace_schema>/`

Para crear usuarios por código:

```sql
BEGIN
  apex_util.set_workspace(p_workspace => 'TU_WORKSPACE');
  apex_util.create_user(
    p_user_name                    => 'JPEREZ',
    p_email_address                => 'jperez@empresa.com',
    p_web_password                 => 'ClaveInicial123',
    p_developer_privs              => NULL,          -- usuario final, sin privilegios de dev
    p_change_password_on_first_use => 'N');
  COMMIT;
END;
/
```

### 1.2 Paquete de tokens — `pkg_auth_token`

> ⚠️ Este paquete **no viene en el export del módulo REST** (el export solo trae la definición ORDS). Lo de abajo es una implementación de referencia compatible con la llamada `pkg_auth_token.generar_token(l_username, 8)` que hace el handler. Si ya lo tenés en la base, exportalo con `DBMS_METADATA.GET_DDL('PACKAGE_BODY','PKG_AUTH_TOKEN')` y usá ese en lugar de este.

Tabla de soporte:

```sql
CREATE TABLE auth_tokens (
  token         VARCHAR2(64) PRIMARY KEY,
  username      VARCHAR2(255) NOT NULL,
  fecha_emision DATE DEFAULT SYSDATE NOT NULL,
  fecha_expira  DATE NOT NULL
);

CREATE INDEX ix_auth_tokens_user ON auth_tokens(username);
```

Especificación:

```sql
CREATE OR REPLACE PACKAGE pkg_auth_token AS

  -- Emite un token para el usuario y lo guarda con vencimiento en p_horas.
  FUNCTION generar_token(p_username VARCHAR2, p_horas NUMBER DEFAULT 8) RETURN VARCHAR2;

  -- Devuelve el username si el token es válido y no expiró; NULL en caso contrario.
  FUNCTION validar_token(p_token VARCHAR2) RETURN VARCHAR2;

  -- Extrae el token del header "Bearer xxx" y lo valida. NULL si no sirve.
  FUNCTION usuario_de_header(p_authorization VARCHAR2) RETURN VARCHAR2;

  PROCEDURE revocar_token(p_token VARCHAR2);
  PROCEDURE purgar_expirados;

END pkg_auth_token;
/
```

Cuerpo:

```sql
CREATE OR REPLACE PACKAGE BODY pkg_auth_token AS

  FUNCTION generar_token(p_username VARCHAR2, p_horas NUMBER DEFAULT 8) RETURN VARCHAR2 IS
    PRAGMA AUTONOMOUS_TRANSACTION;
    l_token VARCHAR2(64);
  BEGIN
    -- 32 bytes aleatorios en hex = 64 caracteres.
    l_token := RAWTOHEX(DBMS_CRYPTO.RANDOMBYTES(32));

    -- Una sesión activa por usuario: al loguearse de nuevo, las anteriores caen.
    -- Si querés permitir varios dispositivos a la vez, borrá este DELETE.
    DELETE FROM auth_tokens WHERE UPPER(username) = UPPER(p_username);

    INSERT INTO auth_tokens (token, username, fecha_expira)
    VALUES (l_token, UPPER(p_username), SYSDATE + p_horas/24);

    COMMIT;
    RETURN l_token;
  END generar_token;

  FUNCTION validar_token(p_token VARCHAR2) RETURN VARCHAR2 IS
    l_username VARCHAR2(255);
  BEGIN
    IF p_token IS NULL THEN
      RETURN NULL;
    END IF;

    SELECT username INTO l_username
      FROM auth_tokens
     WHERE token = p_token
       AND fecha_expira > SYSDATE;

    RETURN l_username;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RETURN NULL;
  END validar_token;

  FUNCTION usuario_de_header(p_authorization VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    IF p_authorization IS NULL THEN
      RETURN NULL;
    END IF;
    RETURN validar_token(TRIM(REPLACE(p_authorization, 'Bearer ', '')));
  END usuario_de_header;

  PROCEDURE revocar_token(p_token VARCHAR2) IS
    PRAGMA AUTONOMOUS_TRANSACTION;
  BEGIN
    DELETE FROM auth_tokens WHERE token = p_token;
    COMMIT;
  END revocar_token;

  PROCEDURE purgar_expirados IS
    PRAGMA AUTONOMOUS_TRANSACTION;
  BEGIN
    DELETE FROM auth_tokens WHERE fecha_expira <= SYSDATE;
    COMMIT;
  END purgar_expirados;

END pkg_auth_token;
/
```

Permiso necesario:

```sql
GRANT EXECUTE ON DBMS_CRYPTO TO <tu_schema>;
```

Job opcional de limpieza:

```sql
BEGIN
  DBMS_SCHEDULER.CREATE_JOB(
    job_name        => 'JOB_PURGAR_TOKENS',
    job_type        => 'PLSQL_BLOCK',
    job_action      => 'BEGIN pkg_auth_token.purgar_expirados; END;',
    repeat_interval => 'FREQ=DAILY; BYHOUR=3',
    enabled         => TRUE);
END;
/
```

### 1.3 Módulo REST `auth` — el handler real

Este es el export real del proyecto, listo para correr (cambiá el workspace y el base path):

```sql
DECLARE
  l_roles     OWA.VC_ARR;
  l_modules   OWA.VC_ARR;
  l_patterns  OWA.VC_ARR;
BEGIN
  ORDS.ENABLE_SCHEMA(
      p_enabled             => TRUE,
      p_url_mapping_type    => 'BASE_PATH',
      p_url_mapping_pattern => 'josiasmuebles',
      p_auto_rest_auth      => FALSE);

  ORDS.DEFINE_MODULE(
      p_module_name    => 'auth',
      p_base_path      => '/auth/',
      p_items_per_page => 25,
      p_status         => 'PUBLISHED',
      p_comments       => NULL);

  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'auth',
      p_pattern        => 'login',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'auth',
      p_pattern        => 'login',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      DECLARE
        l_username  VARCHAR2(255) := :username;
        l_password  VARCHAR2(255) := :password;
        l_token     VARCHAR2(64);
      BEGIN
        apex_util.set_workspace(p_workspace => ''JOSIASMUEBLES'');

        IF apex_util.is_login_password_valid(l_username, l_password) THEN
          l_token := pkg_auth_token.generar_token(l_username, 8);
          :status_code := 200;
          apex_json.open_object;
          apex_json.write(''success'', TRUE);
          apex_json.write(''token'', l_token);
          apex_json.write(''username'', l_username);
          apex_json.close_object;
        ELSE
          :status_code := 401;
          apex_json.open_object;
          apex_json.write(''success'', FALSE);
          apex_json.write(''message'', ''Credenciales invalidas'');
          apex_json.close_object;
        END IF;
      EXCEPTION
        WHEN OTHERS THEN
          :status_code := 500;
          apex_json.open_object;
          apex_json.write(''success'', FALSE);
          apex_json.write(''message'', SQLERRM);
          apex_json.close_object;
      END;
    ');

  COMMIT;
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    RAISE;
END;
/
```

**Notas sobre este handler:**

- `apex_util.set_workspace` es **obligatorio** antes de `is_login_password_valid`. Sin él, la validación falla siempre.
- Los binds `:username` y `:password` los llena ORDS automáticamente desde el JSON del body.
- `:status_code` controla el HTTP de salida.
- El `WHEN OTHERS` devuelve `SQLERRM` al cliente. Práctico para depurar, pero **filtra detalles internos de la base**. Para producción, ver §1.6.
- El `8` en `generar_token(l_username, 8)` son las horas de vigencia del token.

### 1.4 Contrato de la API

El frontend depende de esta forma exacta. Si la cambiás, hay que tocar `auth.tsx`.

| Caso | HTTP | Body |
| --- | --- | --- |
| Login OK | 200 | `{"success": true, "token": "A3F...", "username": "JPEREZ"}` |
| Credenciales inválidas | 401 | `{"success": false, "message": "Credenciales invalidas"}` |
| Error interno | 500 | `{"success": false, "message": "ORA-..."}` |
| Token vencido (otros endpoints) | 401 / 403 | cualquier body |

Prueba rápida:

```bash
curl -X POST https://tu-host/ords/josiasmuebles/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"JPEREZ","password":"ClaveInicial123"}'
```

### 1.5 Proteger el resto de los endpoints

El módulo `auth` es público (tiene que serlo). Los **demás** módulos validan el token. Patrón para cada handler:

```sql
DECLARE
  l_usuario VARCHAR2(255);
BEGIN
  -- ORDS expone los headers como binds: X-APEX-... o :authorization según versión.
  l_usuario := pkg_auth_token.usuario_de_header(:authorization);

  IF l_usuario IS NULL THEN
    :status_code := 401;
    apex_json.open_object;
    apex_json.write('success', FALSE);
    apex_json.write('message', 'Sesion expirada');
    apex_json.close_object;
    RETURN;
  END IF;

  -- A partir de acá l_usuario es el dueño de la sesión.
  -- Usalo para filtrar en el servidor, no confíes en filtros del cliente:
  apex_json.open_object;
  apex_json.write('items');
  apex_json.open_array;
  FOR r IN (SELECT * FROM solicitudes_cabecera WHERE UPPER(cod_usuario) = l_usuario) LOOP
    apex_json.open_object;
    apex_json.write('id', r.id);
    apex_json.write('total', r.total);
    apex_json.close_object;
  END LOOP;
  apex_json.close_array;
  apex_json.close_object;
END;
```

> Si el bind `:authorization` no llega, revisá que ORDS esté pasando el header. En algunas versiones hay que declararlo explícitamente o leerlo con `OWA_UTIL.GET_CGI_ENV('HTTP_AUTHORIZATION')`.

### 1.6 Endurecer para producción

El handler tal como está funciona, pero conviene ajustar tres cosas:

**a) No filtrar `SQLERRM` al cliente**

```sql
EXCEPTION
  WHEN OTHERS THEN
    -- Log interno con el detalle...
    INSERT INTO app_errores (fecha, origen, mensaje)
    VALUES (SYSDATE, 'auth/login', SQLERRM);
    COMMIT;
    -- ...y mensaje genérico hacia afuera.
    :status_code := 500;
    apex_json.open_object;
    apex_json.write('success', FALSE);
    apex_json.write('message', 'Error interno');
    apex_json.close_object;
```

**b) Rate limiting** — sin esto, `/auth/login` acepta intentos ilimitados:

```sql
CREATE TABLE auth_intentos (
  username      VARCHAR2(255) PRIMARY KEY,
  intentos      NUMBER DEFAULT 0 NOT NULL,
  ultimo_fallo  DATE,
  bloqueado_hasta DATE
);
```

Antes de validar: si `bloqueado_hasta > SYSDATE` → 429. Tras 5 fallos → bloquear 15 minutos. Al login exitoso → resetear el contador.

**c) CORS** — necesario si el frontend vive en otro dominio (GitHub Pages, `localhost:8080`):

```sql
BEGIN
  ORDS.SET_MODULE_ORIGINS_ALLOWED(
    p_module_name     => 'auth',
    p_origins_allowed => 'https://tu-usuario.github.io,http://localhost:8080');
  COMMIT;
END;
/
```

El preflight `OPTIONS` debe responder con `Access-Control-Allow-Headers: Content-Type, Authorization`.

---

## Parte 2 — Frontend (React + TanStack Router)

### 2.1 Variable de entorno

`.env`:

```
# URL base del ORDS (sin slash final). El login hace POST a ${VITE_API_URL}/auth/login
VITE_API_URL=https://tu-servidor/ords/josiasmuebles
```

Sin esta variable, el login cae en **modo mock** para desarrollar sin backend. Agregá también un `.env.example` sin credenciales, y `.env` al `.gitignore`.

### 2.2 `src/lib/auth.tsx` — contexto de sesión

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { setUnauthorizedHandler } from "./api";

export type User = {
  id: string;
  name: string;
  email: string;
  username: string;
  role: "asesor" | "supervisor";
  token?: string;
};

const API_URL = import.meta.env.VITE_API_URL as string | undefined;
const STORAGE_KEY = "app-auth-user";

// Usuarios de desarrollo cuando no hay API configurada.
export const MOCK_USERS: Array<User & { password: string }> = [
  { id: "1", name: "María González", email: "maria@example.com",
    username: "maria", password: "demo123", role: "asesor" },
];

// Getters sueltos: api.ts no es React y necesita leer la sesión sin hooks.
export function getStoredToken(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as User).token ?? null : null;
  } catch { return null; }
}

export function getStoredUsername(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as User).username ?? null : null;
  } catch { return null; }
}

type AuthCtx = {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  updateUser: (patch: Partial<User>) => void;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Rehidrata la sesión al arrancar. `loading` evita el parpadeo hacia /login.
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

  // Cuando api.ts recibe 401/403 limpia la sesión; el layout redirige solo.
  useEffect(() => {
    setUnauthorizedHandler(() => persist(null));
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = async (username: string, password: string) => {
    // --- Modo mock (sin backend) ---
    if (!API_URL) {
      await new Promise((r) => setTimeout(r, 600));
      const found = MOCK_USERS.find(
        (u) => (u.username === username || u.email === username) && u.password === password,
      );
      if (!found) throw new Error("Usuario o contraseña incorrectos");
      const { password: _p, ...safe } = found;
      persist(safe);
      return;
    }

    // --- Modo real (ORDS + APEX) ---
    // APEX guarda los usuarios en MAYÚSCULAS: normalizamos antes de enviar.
    const normalizedUsername = username.trim().toUpperCase();

    let res: Response;
    try {
      res = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: normalizedUsername, password }),
      });
    } catch {
      throw new Error("No se pudo conectar con el servidor");
    }

    let data: { success?: boolean; token?: string; username?: string; message?: string } = {};
    try { data = await res.json(); } catch {}

    // El handler devuelve 401 + success:false para credenciales malas.
    if (res.status === 401 || data.success === false) {
      throw new Error(data.message || "Usuario o contraseña incorrectos");
    }
    if (!res.ok || !data.token) {
      throw new Error(data.message || "Error al iniciar sesión");
    }

    const name = data.username ?? normalizedUsername;
    persist({ id: name, name, email: "", username: name, role: "asesor", token: data.token });
  };

  const logout = () => persist(null);
  const updateUser = (patch: Partial<User>) => { if (user) persist({ ...user, ...patch }); };

  return (
    <Ctx.Provider value={{ user, loading, login, logout, updateUser }}>{children}</Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return ctx;
}
```

**Tres detalles que importan:**

1. `.toUpperCase()` sobre el username — APEX es case-sensitive del lado del token y guarda en mayúsculas.
2. `getStoredToken` lee `localStorage` directo en lugar de pasar por el contexto: eso desacopla el cliente HTTP de React.
3. `loading` arranca en `true` — sin eso, el primer render manda a `/login` a un usuario con sesión válida.

### 2.3 `src/lib/api.ts` — token automático y expulsión al 401

```ts
import { getStoredToken } from "./auth";

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

function authHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// El AuthProvider registra aquí cómo cerrar sesión, así api.ts (que no es React)
// puede expulsar al usuario cuando el token expira, sea cual sea el componente activo.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

function handleUnauthorized() {
  if (onUnauthorized) onUnauthorized();
  else if (typeof window !== "undefined") {
    window.location.href = `${import.meta.env.BASE_URL}login`;
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_URL) throw new Error("VITE_API_URL no configurada");

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...authHeaders(), ...init?.headers },
    });
  } catch {
    throw new Error("No se pudo conectar con el servidor");
  }

  // ORDS a veces responde texto plano en los errores: parseamos defensivamente.
  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }

  if (res.status === 401 || res.status === 403) {
    handleUnauthorized();
    throw new Error("Sesión expirada. Vuelve a iniciar sesión.");
  }

  // ORDS puede devolver 200 con {success:false}: también es error.
  const failed = data && typeof data === "object" &&
    (data as { success?: boolean }).success === false;

  if (!res.ok || failed) {
    const msg =
      (data && typeof data === "object" &&
        ((data as { message?: string }).message ||
         (data as { error?: string }).error ||
         (data as { detail?: string }).detail)) ||
      (typeof data === "string" && data) ||
      `Error ${res.status}`;
    throw new Error(String(msg));
  }

  return data as T;
}
```

### 2.4 Montar el provider en la raíz

`src/routes/__root.tsx`:

```tsx
<QueryClientProvider client={queryClient}>
  <ThemeProvider>
    <AuthProvider>
      <Outlet />
      <Toaster />
    </AuthProvider>
  </ThemeProvider>
</QueryClientProvider>
```

### 2.5 Layout protegido — `src/routes/_app.tsx`

Todo lo que cuelgue de `_app` queda detrás del login por herencia de layout.

```tsx
import { createFileRoute, Outlet, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_app")({ component: AppLayout });

function AppLayout() {
  const { user, loading } = useAuth();

  // Sin este guard, el primer render (antes de rehidratar localStorage)
  // manda a /login a un usuario que sí tiene sesión.
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-secondary border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" />;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AppHeader />
      <main className="flex-1"><Outlet /></main>
    </div>
  );
}
```

Nombrá las rutas `_app.dashboard.tsx`, `_app.solicitudes.index.tsx`, etc. y quedan protegidas automáticamente.

### 2.6 Página de login — `src/routes/login.tsx`

```tsx
import { createFileRoute, useNavigate, Navigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // Ya logueado → fuera del login.
  if (user) return <Navigate to="/dashboard" />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await login(username.trim(), password);
      toast.success("Bienvenido");
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto mt-20 w-full max-w-md space-y-4 p-6">
      <div className="space-y-1.5">
        <Label htmlFor="username">Usuario</Label>
        <Input id="username" autoComplete="username" required
               value={username} onChange={(e) => setUsername(e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Contraseña</Label>
        <div className="relative">
          <Input id="password" type={showPassword ? "text" : "password"}
                 autoComplete="current-password" required className="pr-10"
                 value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="button" onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5"
                  aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Iniciar sesión"}
      </Button>
    </form>
  );
}
```

### 2.7 Logout

En el header, `logout()` limpia `localStorage` y el layout `_app` redirige solo:

```tsx
const { user, logout } = useAuth();

<Button variant="ghost" size="icon" onClick={logout} aria-label="Cerrar sesión">
  <LogOut className="h-4 w-4" />
</Button>
```

> Mejora opcional: agregá un `POST /auth/logout` que llame a `pkg_auth_token.revocar_token`. Hoy el token sigue siendo válido en la base hasta que expira, aunque el cliente lo haya descartado.

---

## Parte 3 — Extras opcionales

### 3.1 "Recordar contraseña"

```tsx
const REMEMBER_KEY = "app-remember-credentials";

// Al hacer login OK:
if (remember) {
  localStorage.setItem(REMEMBER_KEY, JSON.stringify({ username, password }));
} else {
  localStorage.removeItem(REMEMBER_KEY);
}
```

⚠️ Guarda la contraseña **en texto plano**. Solo para dispositivos personales; nunca en equipos compartidos.

### 3.2 Login biométrico (WebAuthn)

Implementación **frontend-only**: WebAuthn es un candado local sobre credenciales guardadas, no reemplaza la validación del servidor. El flujo es: verificar huella → leer credenciales guardadas → llamar al `login()` normal.

```ts
const CRED_KEY = "app-biometric-credential";
const SECRET_KEY = "app-biometric-secret";

// Ofuscación con base64, NO cifrado. La protección real es la verificación
// biométrica del dispositivo antes de leer esto.
export function storeBiometricSecret(username: string, password: string) {
  localStorage.setItem(SECRET_KEY, btoa(unescape(encodeURIComponent(
    JSON.stringify({ username, password })
  ))));
}

export function getBiometricSecret(): { username: string; password: string } | null {
  const raw = localStorage.getItem(SECRET_KEY);
  if (!raw) return null;
  try { return JSON.parse(decodeURIComponent(escape(atob(raw)))); } catch { return null; }
}

export async function isPlatformAuthenticatorAvailable() {
  if (typeof window === "undefined" || !window.PublicKeyCredential) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}

export async function registerBiometric(userId: string, userName: string) {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "Tu App" },
      user: {
        id: new TextEncoder().encode(userId),
        name: userName,
        displayName: userName,
      },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      timeout: 60000,
      attestation: "none",
    },
  }) as PublicKeyCredential | null;

  if (!cred) throw new Error("No se pudo registrar la biometría");
  localStorage.setItem(CRED_KEY, cred.id);
  return cred.id;
}

export function hasRegisteredBiometric() {
  return !!localStorage.getItem(CRED_KEY);
}

export async function verifyBiometric() {
  const id = localStorage.getItem(CRED_KEY);
  if (!id) throw new Error("No hay biometría registrada");

  // El id viene en base64url: hay que convertirlo a bytes.
  const b64 = id.replace(/-/g, "+").replace(/_/g, "/")
                .padEnd(id.length + ((4 - (id.length % 4)) % 4), "=");

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      timeout: 60000,
      userVerification: "required",
      allowCredentials: [{
        id: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
        type: "public-key",
      }],
    },
  });

  if (!assertion) throw new Error("Verificación cancelada");
  return true;
}
```

Uso en el login:

```tsx
async function onBiometricLogin() {
  await verifyBiometric();
  const secret = getBiometricSecret();
  if (!secret) throw new Error("No hay credenciales guardadas");
  await login(secret.username, secret.password);
  navigate({ to: "/dashboard" });
}
```

Requiere **HTTPS** (o `localhost`) y un autenticador de plataforma: Touch ID, Windows Hello o huella en Android.

### 3.3 Filtrar datos por usuario

Si el backend todavía no filtra por sesión, el frontend puede hacerlo:

```ts
export async function listarRegistros() {
  const { items = [] } = await request<{ items: Registro[] }>("/registros");
  const me = getStoredUsername();
  if (!me) return items;
  return items.filter((r) => (r.cod_usuario ?? "").toUpperCase() === me.toUpperCase());
}
```

> Esto es **conveniencia de UI, no seguridad**: los datos de los demás usuarios igual viajaron al navegador. El filtro real va en el handler ORDS con `pkg_auth_token.usuario_de_header` (§1.5).

---

## Checklist

**Backend**
- [ ] Workspace APEX con usuarios creados
- [ ] `ORDS.ENABLE_SCHEMA` con el base path
- [ ] `GRANT EXECUTE ON DBMS_CRYPTO`
- [ ] Tabla `auth_tokens`
- [ ] Paquete `pkg_auth_token` (generar / validar / revocar)
- [ ] Módulo `auth` con `POST /auth/login`
- [ ] Workspace correcto en `apex_util.set_workspace`
- [ ] Validación de token en los demás módulos
- [ ] CORS con los orígenes reales
- [ ] Probado con `curl` (200 y 401)

**Frontend**
- [ ] `VITE_API_URL` en `.env`, y `.env` en `.gitignore`
- [ ] `auth.tsx`: provider, `useAuth`, `getStoredToken`, `getStoredUsername`
- [ ] `api.ts`: `authHeaders`, `setUnauthorizedHandler`, manejo de 401/403
- [ ] `AuthProvider` montado en `__root.tsx`
- [ ] `_app.tsx` con guard de `loading` + redirect
- [ ] `login.tsx` con redirect si ya hay sesión
- [ ] Botón de logout

---

## Errores comunes

| Síntoma | Causa probable |
| --- | --- |
| Login siempre 401 con credenciales correctas | Falta `apex_util.set_workspace` o el nombre del workspace está mal |
| 500 con `ORA-00904` | `pkg_auth_token` no existe o no compila |
| CORS bloqueado en el navegador | Falta `ORDS.SET_MODULE_ORIGINS_ALLOWED` o el preflight `OPTIONS` |
| Token válido pero endpoints dan 401 | El bind `:authorization` no llega; probá `OWA_UTIL.GET_CGI_ENV('HTTP_AUTHORIZATION')` |
| Parpadeo a `/login` al recargar | Falta el guard de `loading` en `_app.tsx` |
| Login OK pero se cierra sesión sola | Otro dispositivo se logueó: `generar_token` borra los tokens previos del usuario |
| `VITE_API_URL no configurada` | Falta el `.env`, o no reiniciaste el dev server tras crearlo |

---

## Notas de seguridad

Limitaciones conocidas de este diseño:

1. **Token en `localStorage`** — vulnerable a XSS. Alternativa más segura: cookie `httpOnly` + `SameSite=Strict` (requiere que backend y frontend compartan dominio).
2. **`SQLERRM` expuesto al cliente** en el `WHEN OTHERS` del handler — filtra estructura interna de la base. Ver §1.6a.
3. **Sin rate limiting** en `/auth/login` — permite fuerza bruta. Ver §1.6b.
4. **"Recordar contraseña"** guarda la clave en texto plano.
5. **Secreto biométrico en base64** — es codificación, no cifrado.
6. **Sin refresh token** — al expirar (8 h) hay que loguearse de nuevo.
7. **Logout solo del lado del cliente** — el token sigue vivo en la base hasta expirar.
8. **El filtrado por usuario en el cliente es cosmético** — la autorización real va en el handler.
