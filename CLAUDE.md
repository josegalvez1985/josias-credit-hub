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

El módulo de Recibos ya está completo (las 6 secciones del menú de APEX). La línea de trabajo
abierta es el **módulo administrativo** (`/admin/*`, ERP), de escritorio:

- **Créditos otorgados**: **solo lectura** — `VENTAS_CABECERA` tiene cinco triggers que
  regeneran el plan de cuotas.
- **Recibos de Proveedores**: el primero **con escritura** (`backend/proveedores.sql`). Valida
  token y lista de usuarios en Oracle en cada handler.
- **Reportes**: Saldos de Proveedores, PDF A4, con tres alcances (solo saldo / con recibos /
  todos). Sin módulo propio: usa los GET de `proveedores` (`facturas` y `pagos`).
  Ver `GUIA-FRONTEND.md` §10.

Ver `GUIA-BACKEND.md` §7.

## Guías (leer la que corresponda antes de tocar código)

| Archivo | Para qué |
| --- | --- |
| [GUIA-FRONTEND.md](GUIA-FRONTEND.md) | Sistema de diseño, arquetipos de página, equivalencias APEX → React |
| [GUIA-BACKEND.md](GUIA-BACKEND.md) | Cómo se traduce el PL/SQL de APEX a ORDS y qué información pedir |
| [backend/README.md](backend/README.md) | Convenciones de ORDS/Oracle, despliegue de módulos y errores frecuentes |
| [GUIA-LOGIN.md](GUIA-LOGIN.md) | Autenticación, tokens, cómo proteger un endpoint |
| [src/routes/README.md](src/routes/README.md) | File-based routing de TanStack Start |

## ⚠️ Errores ya cometidos — NO repetir

Cada uno de estos costó una ronda entera de ida y vuelta. **Antes de escribir un endpoint, un LOV
o un listado, releer esta tabla.** El síntoma casi nunca apunta a la causa.

| Síntoma | Causa real | Qué hacer |
| --- | --- | --- |
| El buscador de un LOV no filtra nada | **`q` es un parámetro reservado de ORDS** (filtro JSON `?q={...}`). Un bind `:q` nunca recibe el valor | Los LOV **no filtran en Oracle**: devuelven todo y el cliente busca con `filtrarLov()` de `src/lib/api.ts` |
| *"No 'Access-Control-Allow-Origin' header"* | **Es un 500 disfrazado.** ORDS no manda cabeceras CORS cuando el handler explota. Ningún módulo define `origins_allowed` y todos funcionan | Diagnosticar con `curl -i`, nunca desde el navegador |
| Un handler suelto responde sin cabeceras y el módulo no se puede redesplegar | El módulo quedó **trabado o a medias** de un `DEFINE_MODULE` fallido | Publicar **solo ese handler en un módulo nuevo** (`backend/<modulo>.sql`) y apuntar la ruta en `api.ts`. No hace falta redefinir los otros handlers. Ejemplo: `consultas.sql` |
| `ORA-00001` sobre `ORDS_MODULES_UNIQUE1` | **`ORDS.DEFINE_MODULE` no es idempotente** | La sección 3 borra el módulo primero. Ver `backend/README.md` → *Desplegar un módulo ORDS* |
| `ORA-00060` al desplegar, ~12 s de espera | **Se corrió el `.sql` entero de una vez.** Pasa siempre | Tres ejecuciones separadas: paquete → `DELETE_MODULE` solo (verificar conteo 0) → `DEFINE_MODULE`. Ver `backend/README.md` |
| Un `DELETE_MODULE` "funciona" pero no borra | Un `EXCEPTION WHEN OTHERS THEN NULL` se tragó el error | **Nunca tapar errores.** Preguntar si existe, no atrapar excepciones |
| Las tarjetas se salen de la pantalla | Flex items y grid tracks tienen **`min-width: auto`** | `grid-cols-1` (no `grid` pelado) + `min-w-0` donde se trunca. `GUIA-FRONTEND.md` §9 |
| Un cambio no aparece en el navegador | **Service worker** sirviendo la versión cacheada | Application → Service Workers → Unregister → Ctrl+Shift+R |
| El endpoint devuelve 500 pero el SQL está bien | Un **GET que llama a un paquete `INVALID`** | Los handlers de lectura van con SQL puro, sin paquetes |
| *"Expected one of: <<{,[,",number,true,false,null>> but got: <<EOF>>"* en un `DELETE` | `request()` manda siempre `Content-Type: application/json` y **ORDS parsea el cuerpo antes del handler**. En un `DELETE` el cuerpo no le llega (mandar `"{}"` **no** lo arregla) y falla sin ejecutar nada | El `DELETE` va con `Content-Type: text/plain` y sin cuerpo. Ver `eliminarReciboProveedor` en `api.ts` |
| Una fecha se ve **un día antes** (29 en vez de 30), o "hoy" da mañana después de las 21:00 | `new Date("YYYY-MM-DD")` es medianoche **UTC** (en Paraguay, 21:00 del día anterior) y `toISOString()` da la fecha UTC. Pasó en 7 pantallas a la vez | Siempre `fechaPy()` / `fechaLocal()` / `hoyISO()` de `src/lib/utils.ts`. **Nunca** un `formatDate` local por pantalla |
| Un feed devuelve `items: []` sin ningún error | Se mandó `limit`/`offset` a un handler **`json/query`**, donde esos parámetros no existen. Solo los `plsql/block` los declaran como binds propios | `json/query` pagina con **`?page=N`** y avisa que hay más con un link `next` (no con `hasMore`). Ver `listarCreditos` en `api.ts` |

**Y la regla que las engloba a todas:** cuando algo falla, **mirar cómo lo resuelve el código que ya
funciona** (`solicitudes`, `clientes`) antes de inventar una solución nueva. Casi todos estos errores
salieron de no hacerlo.

## Cosas que se olvidan y rompen

- ⚠️ Las utilidades de color se llaman `wood` / `caramel` / `ivory` pero **la paleta es azul**.
  Nunca hardcodear un color: usar los tokens (`primary`, `secondary`, `muted`…) o se rompe el modo oscuro.
- **Un solo archivo SQL por módulo** (`backend/<modulo>.sql`): saneamiento del esquema, paquete y
  módulo ORDS, todo junto. No hay carpeta `migrations/`. La base **está en producción**, así que
  los `ALTER`/`DROP` van comentados en la sección 1 y se aplican a mano.
- Booleanos en la base son `'S'` / `'N'`. Fechas viajan como string `YYYY-MM-DD`; vacío → ORA-01841.
- Fechas en pantalla con `fechaPy()` y "hoy" con `hoyISO()` (`src/lib/utils.ts`), **nunca**
  `new Date("YYYY-MM-DD")`: es UTC y en Paraguay muestra el día anterior.
- Un 401/403 **expulsa al login** (`api.ts`). "No tenés permiso" responde 400 con mensaje.
- Montos en guaraníes, sin decimales, y en créditos se redondean hacia arriba a múltiplos de 10.000.
- ORDS pagina de a 25: todo feed se recorre con `limit=500&offset=`.
- Un `200` con `{"success": false}` es un error.
- Al agregar una ruta al menú hay que tocar **`app-header.tsx` y `bottom-nav.tsx`**.
- `src/routeTree.gen.ts` es autogenerado (`npx vite build` lo regenera). No editarlo a mano.
- `npm run lint` falla con ~8900 errores de CRLF en todo el repo. Es **previo** a este trabajo;
  no es señal de que algo se rompió. Verificar con `npx tsc --noEmit`, que sí tiene que estar limpio.

## Comandos

```bash
npm run dev          # servidor de desarrollo (puerto 8080)
npx vite build       # build + regenera routeTree.gen.ts
npx tsc --noEmit     # verificación de tipos
npm run lint         # ESLint
```

Sin `VITE_API_URL` la app corre en modo mock (usuarios demo en `src/lib/auth.tsx`).
