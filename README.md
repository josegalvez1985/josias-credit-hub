# Josias Credit Hub

PWA de Josias Muebles construida con TanStack Start (React 19), TanStack Router,
Tailwind CSS v4 y backend ORDS/Oracle. Cubre dos circuitos:

- **Solicitudes** (asesores) — registro y gestión de solicitudes de crédito.
- **Recibos** (cobradores) — emisión, consulta y anulación de recibos de cobranza.
  Se está migrando desde una app Oracle APEX, página por página.

## Documentación

Antes de tocar código, leer la guía que corresponda:

| Archivo | Para qué |
| --- | --- |
| [CLAUDE.md](CLAUDE.md) | Resumen del proyecto + **tabla de errores ya cometidos**. Leer esta primero |
| [GUIA-FRONTEND.md](GUIA-FRONTEND.md) | Sistema de diseño, arquetipos de página, equivalencias APEX → React |
| [GUIA-BACKEND.md](GUIA-BACKEND.md) | Cómo se traduce el PL/SQL de APEX a ORDS y qué información pedir |
| [backend/README.md](backend/README.md) | Convenciones de ORDS/Oracle, despliegue de módulos y errores frecuentes |
| [GUIA-LOGIN.md](GUIA-LOGIN.md) | Autenticación, tokens, cómo proteger un endpoint |
| [src/routes/README.md](src/routes/README.md) | File-based routing de TanStack Start |

## Requisitos

- Node 20+
- npm

## Desarrollo

```bash
npm install
npm run dev
```

App en `http://localhost:8080` (o el siguiente puerto libre).

Sin `VITE_API_URL` configurada, el login usa usuarios mock para desarrollo.

## Variables de entorno

| Variable        | Descripción                                            |
| --------------- | ------------------------------------------------------ |
| `VITE_API_URL`  | Base URL del backend ORDS. Si falta, se usa modo mock. |
| `GITHUB_PAGES`  | `true` en el build para GitHub Pages (ajusta el base). |

## Scripts

| Comando         | Acción                          |
| --------------- | ------------------------------- |
| `npm run dev`   | Servidor de desarrollo          |
| `npm run build` | Build de producción (SPA)       |
| `npm run preview` | Previsualiza el build         |
| `npm run lint`  | ESLint                          |
| `npx tsc --noEmit` | Verificación de tipos        |

> `src/routeTree.gen.ts` es autogenerado. Se regenera solo con `npm run dev` o
> `npx vite build`; no editarlo a mano.

## Despliegue en GitHub Pages

El proyecto está configurado como SPA estática para GitHub Pages.

1. En el repo: **Settings → Pages → Source: GitHub Actions**.
2. Push a `main` dispara el workflow [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml), que:
   - Builda con `GITHUB_PAGES=true` (base path `/josias-credit-hub/`).
   - Copia el shell SPA a `index.html` y `404.html` (fallback para rutas del router).
   - Publica `dist/client`.
3. La app queda en `https://<usuario>.github.io/josias-credit-hub/`.

> El base path está fijado a `/josias-credit-hub/` en [vite.config.ts](vite.config.ts). Si el repo cambia de nombre, actualiza ese valor.

## PWA

Incluye manifest y service worker ([public/sw.js](public/sw.js)) para instalación e funcionamiento offline básico. El botón "Instalar" aparece en el login y en Perfil cuando el navegador lo permite (Chrome/Edge/Android; en iOS Safari se instala vía "Compartir → Agregar a inicio").

> **Si un cambio no aparece en el navegador**, casi siempre es el service worker
> sirviendo la versión cacheada. DevTools → Application → Service Workers →
> *Unregister*, y recargar con Ctrl+Shift+R.

## Backend

API ORDS sobre Oracle. Todo el código de base de datos está en [backend/](backend/),
**un archivo por módulo**, con el esquema, el paquete PL/SQL y los endpoints juntos:

| Módulo | Archivo | Qué resuelve |
| --- | --- | --- |
| `/auth/*` | [backend/auth.sql](backend/auth.sql) | Login y tokens |
| `/solicitudes/*` | [backend/solicitudes.sql](backend/solicitudes.sql) | Cabecera, detalle, referencias, actividad laboral, LOVs, precios |
| `/recibos/*` | [backend/recibos.sql](backend/recibos.sql) | Listado, alta, edición, anulación de recibos y sus LOVs |
| `/consultas/*` | [backend/consultas.sql](backend/consultas.sql) | Ficha de cliente (solo lectura, sin paquete) |
| `/clientes/*` | — | Todavía no versionado (ver `backend/README.md`) |

El cliente HTTP está en [src/lib/api.ts](src/lib/api.ts).

Para desplegar un módulo, seguir *Desplegar un módulo ORDS* en
[backend/README.md](backend/README.md): `ORDS.DEFINE_MODULE` **no** es idempotente
y un despliegue fallido deja el módulo a medias, respondiendo 500 y difícil de borrar.
