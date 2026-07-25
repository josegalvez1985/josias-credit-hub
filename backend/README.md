# Backend — Oracle + ORDS

Código de base de datos de Josias Credit Hub. La app (`src/`) no habla con Oracle
directamente: todo pasa por los módulos REST de ORDS que se definen acá.

Base URL en producción: `https://<host>/ords/josiasmuebles/`
(el frontend la toma de `VITE_API_URL`).

## Estructura

**Un archivo por endpoint**, autocontenido: tablas + paquete + módulo ORDS.
Todo lo que necesita ese endpoint está en su archivo, no hay que saltar entre carpetas.

| Archivo | Endpoint | Contiene |
| --- | --- | --- |
| `auth.sql` | `/auth/login` | `auth_tokens` + `pkg_auth_token` + módulo ORDS `auth` |
| `solicitudes.sql` | `/solicitudes/*` | `solicitud_ventas_referencias` + `pkg_solicitud_ventas` + módulo ORDS `solicitudes` (cabecera, detalle, referencias, actividad, LOVs, precios) |
| `migrations/*.sql` | — | Cambios incrementales sobre una base que **ya está en producción**. Nombre: `YYYY-MM-DD_descripcion.sql`. |

Cada archivo de endpoint tiene tres secciones numeradas:

1. **Tablas** — solo para base nueva. En una base ya desplegada, saltear y usar `migrations/`.
2. **Paquete** — `CREATE OR REPLACE`, se puede volver a correr siempre.
3. **Módulo ORDS** — idempotente, redefine el módulo completo.

> El paquete es compartido por todos los paths del módulo (`cabecera`, `detalle`,
> `referencias`…), por eso la unidad de archivo es el módulo REST y no cada path
> suelto: un package body no se puede partir en varios archivos.

## Despliegue

Conectado como `WKSP_JOSIASMUEBLES`, en SQL Developer / SQLcl:

```
-- base nueva: el archivo entero, de arriba a abajo
@auth.sql
@solicitudes.sql

-- base ya desplegada: solo la migración + secciones 2 y 3 del endpoint tocado
@migrations/2026-07-24_referencias_ind_garante.sql
```

## Convenciones

- **Los handlers no hacen DML.** Un handler valida el token, llama al paquete y
  arma el JSON. Si necesitás lógica, va al paquete.
- **Contrato de respuesta**: `{"success": true, ...}` con `201` al crear, `200` al
  actualizar, y `{"success": false, "message": "..."}` con `400`/`401`/`500` al
  fallar. `src/lib/api.ts` trata `success: false` como error aunque el HTTP sea 200.
- **`:status_code`** controla el HTTP de salida del handler.
- **Auth**: todo endpoint que no sea `/auth/login` debería validar el header
  `Authorization: Bearer <token>` con `pkg_auth_token`. Requiere declarar el
  `ORDS.DEFINE_PARAMETER` de tipo `HEADER` (ver `precios` y `lov/relaciones`).
  Un `401`/`403` hace que el frontend expulse al usuario al login.
- **Fechas**: el frontend manda `YYYY-MM-DD` como string; el handler hace
  `TO_DATE(:campo,'YYYY-MM-DD')`. Un string vacío tira ORA-01841 → 400.
- **Paginación**: ORDS pagina de a 25 (`p_items_per_page`). El cliente recorre
  todas las páginas con `limit=500&offset=`; si agregás un feed nuevo, seguí ese patrón.
- **Comillas**: el cuerpo de un handler va dentro de un literal SQL, así que cada
  `'` interno se escribe `''`.

## Cómo agregar un campo nuevo (checklist)

Ejemplo real: `IND_GARANTE` en referencias (`migrations/2026-07-24_referencias_ind_garante.sql`).

1. **Migración**: `ALTER TABLE ... ADD` en un archivo nuevo de `migrations/`, y
   actualizar también el `CREATE TABLE` de la sección 1 del endpoint para que una
   base nueva quede igual.
2. **Paquete** (sección 2): agregar el parámetro a la spec y al body (`INSERT` y
   `UPDATE`). Ponerle `DEFAULT` para no romper llamadas que todavía no mandan el
   campo. Si la columna tiene `NOT NULL` o un `CHECK`, normalizar el valor en el
   paquete (ver `norm_garante`) en vez de confiar en lo que llega del cliente.
3. **ORDS** (sección 3): pasar el bind nuevo en el `POST` y el `PUT`, y volver a
   correr esa sección. Los `GET` que son `SELECT *` ya lo devuelven solos.
4. **Frontend**: agregar el campo al tipo en `src/lib/api.ts` (`crearSolicitud`
   serializa la fila entera, así que con eso ya viaja en el body), y después el
   input en el wizard y la vista de detalle.
5. **Verificar**: `npx tsc --noEmit` y un POST real contra el endpoint.

## Pendiente de versionar

Estas piezas están en la base pero todavía no en este repo:

- Tablas `SOLICITUD_VENTAS_CABECERA`, `SOLICITUD_VENTAS_DETALLE`,
  `SOLICITUD_VENTAS_ACTIVIDAD_LABORAL`, `CLIENTES`, `ARTICULOS`, `CIUDADES`,
  `VENDEDORES`, `PROFESIONES`, `RELACIONES_PERSONALES`.
- La vista `V_PRECIOS_VENTAS` (la consume `GET /solicitudes/precios`).
- El endpoint `/clientes/` que usa el frontend (`GET`, `POST`, `GET /:cod`).
  No está en el módulo `solicitudes`: o es AutoREST sobre la tabla `CLIENTES` o es
  un módulo aparte. Cuando se exporte, va en `clientes.sql` con la misma estructura
  de tres secciones.

Para sacarlas de la base:

```sql
SELECT DBMS_METADATA.GET_DDL('TABLE','SOLICITUD_VENTAS_CABECERA') FROM dual;
SELECT DBMS_METADATA.GET_DDL('VIEW','V_PRECIOS_VENTAS') FROM dual;
```

Los módulos ORDS se exportan desde SQL Developer Web → REST → módulo → *Export*.

## Ver también

- [GUIA-LOGIN.md](../GUIA-LOGIN.md) — el flujo de login completo (APEX, tokens,
  cómo proteger endpoints y errores comunes).
- [src/lib/api.ts](../src/lib/api.ts) — el cliente HTTP; sus comentarios documentan
  varios quirks del backend (el `?q=` que devuelve 400, los binds obligatorios
  en `POST /clientes/`, etc.).
