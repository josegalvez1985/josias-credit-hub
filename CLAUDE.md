# Josias Credit Hub

PWA para asesores de Josias Muebles (mueblería paraguaya): solicitudes de crédito de muebles.
TanStack Start (React 19) + Tailwind v4 + shadcn/ui, contra un backend **Oracle + ORDS que ya está
en producción**. Se trabaja en español.

## Trabajo en curso: migrar Recibos desde Oracle APEX

Se está modernizando el módulo de Recibos de una app APEX hacia esta app. Jose va pasando **una
página de APEX por vez** con su PL/SQL, y de cada una sale un endpoint ORDS + una pantalla React.

**Regla explícita de Jose: no crear nada sin conocer la estructura.** Si falta el DDL de una tabla,
la query de un LOV, un trigger o una validación, **hay que pedirlo antes de escribir código** —
no inventar ni asumir. La lista de qué pedir está en `GUIA-BACKEND.md` §2.

## Guías (leer la que corresponda antes de tocar código)

| Archivo | Para qué |
| --- | --- |
| [GUIA-FRONTEND.md](GUIA-FRONTEND.md) | Sistema de diseño, arquetipos de página, equivalencias APEX → React |
| [GUIA-BACKEND.md](GUIA-BACKEND.md) | Cómo se traduce el PL/SQL de APEX a ORDS y qué información pedir |
| [backend/README.md](backend/README.md) | Convenciones de ORDS/Oracle y checklist para agregar un campo |
| [GUIA-LOGIN.md](GUIA-LOGIN.md) | Autenticación, tokens, cómo proteger un endpoint |
| [src/routes/README.md](src/routes/README.md) | File-based routing de TanStack Start |

## Cosas que se olvidan y rompen

- ⚠️ Las utilidades de color se llaman `wood` / `caramel` / `ivory` pero **la paleta es azul**.
  Nunca hardcodear un color: usar los tokens (`primary`, `secondary`, `muted`…) o se rompe el modo oscuro.
- **Desbordes horizontales**: flex items y grid tracks tienen `min-width: auto`. Usar
  `grid-cols-1` (no `grid` a secas) y `min-w-0` donde se trunca. Ver `GUIA-FRONTEND.md` §9.
- **`ORDS.DEFINE_MODULE` no es idempotente**: la sección 3 de cada `.sql` borra el módulo
  primero. Si el despliegue falla a mitad, el módulo queda a medias devolviendo 500 —
  ver `backend/README.md`.
- **Un error de CORS en el navegador casi siempre es un 500 disfrazado.** Ningún módulo
  define `origins_allowed`. Diagnosticar con `curl -i`, no desde el browser.
- Si un cambio no se ve en el navegador, es el **service worker**: Application →
  Service Workers → Unregister → Ctrl+Shift+R.
- **Un solo archivo SQL por módulo** (`backend/<modulo>.sql`): saneamiento del esquema, paquete y
  módulo ORDS, todo junto. No hay carpeta `migrations/`. La base **está en producción**, así que
  los `ALTER`/`DROP` van comentados en la sección 1 y se aplican a mano.
- Booleanos en la base son `'S'` / `'N'`. Fechas viajan como string `YYYY-MM-DD`; vacío → ORA-01841.
- Montos en guaraníes, sin decimales, y en créditos se redondean hacia arriba a múltiplos de 10.000.
- ORDS pagina de a 25: todo feed se recorre con `limit=500&offset=`.
- Un `200` con `{"success": false}` es un error.
- Al agregar una ruta al menú hay que tocar **`app-header.tsx` y `bottom-nav.tsx`**.
- `src/routeTree.gen.ts` es autogenerado (`npx vite build` lo regenera). No editarlo a mano.

## Comandos

```bash
npm run dev          # servidor de desarrollo (puerto 8080)
npx vite build       # build + regenera routeTree.gen.ts
npx tsc --noEmit     # verificación de tipos
npm run lint         # ESLint
```

Sin `VITE_API_URL` la app corre en modo mock (usuarios demo en `src/lib/auth.tsx`).
