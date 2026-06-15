# Josias Credit Hub

PWA para asesores: registro y gestión de solicitudes de crédito de Josias Muebles. Construida con TanStack Start (React 19), TanStack Router, Tailwind CSS v4 y backend ORDS/Oracle.

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

## Backend

API ORDS sobre Oracle (módulo `solicitudes`): cabecera, detalle, referencias, actividad laboral y LOVs. El cliente HTTP está en [src/lib/api.ts](src/lib/api.ts).
