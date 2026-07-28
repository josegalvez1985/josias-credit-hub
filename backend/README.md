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
| `recibos.sql` | `/recibos/*` | `pkg_recibos` + módulo ORDS `recibos` (listado, alta, edición, anulación, LOVs) |

**Todo lo de un módulo va en su archivo**, incluidos los cambios de esquema.
No hay carpeta `migrations/`: los `ALTER`/`DROP` van en una sección de saneamiento
al principio del mismo archivo, comentados y con su rollback (ver `recibos.sql` §1).

Secciones de un archivo de endpoint:

1. **Tablas / saneamiento** — DDL para base nueva, o los cambios incrementales
   sobre producción. Es la única sección que **no** es idempotente: se corre a mano.
2. **Paquete** — `CREATE OR REPLACE`, se puede volver a correr siempre.
3. **Módulo ORDS** — arranca con `ORDS.DELETE_MODULE` y después redefine todo
   (ver *Desplegar un módulo* más abajo).
4. **Verificación** — consultas sueltas, no forman parte del despliegue.

> El paquete es compartido por todos los paths del módulo (`cabecera`, `detalle`,
> `referencias`…), por eso la unidad de archivo es el módulo REST y no cada path
> suelto: un package body no se puede partir en varios archivos.

## Despliegue

Conectado como `WKSP_JOSIASMUEBLES`, en SQL Developer / SQLcl:

```
-- base nueva: el archivo entero, de arriba a abajo
@auth.sql
@solicitudes.sql
@recibos.sql

-- base ya desplegada: correr solo las secciones 2 y 3 del endpoint tocado.
-- La sección 1 (saneamiento) se lee y se aplica a mano, paso por paso.
```

### Desplegar un módulo ORDS

`ORDS.DEFINE_MODULE` **no es idempotente**: si el módulo ya existe falla con
`ORA-00001` sobre `ORDS_MODULES_UNIQUE1`. Por eso la sección 3 arranca borrando.

```sql
DECLARE
  l_existe NUMBER;
BEGIN
  SELECT COUNT(*) INTO l_existe FROM user_ords_modules WHERE name = '<modulo>';
  IF l_existe > 0 THEN
    ORDS.DELETE_MODULE(p_module_name => '<modulo>');
    COMMIT;
  END IF;
END;
/
```

Tres reglas que costaron una tarde entera el 2026-07-28:

1. **Nunca `EXCEPTION WHEN OTHERS THEN NULL` en el borrado.** Si el `DELETE_MODULE`
   falla, SQL Developer reporta *"Sentencia procesada"* igual y después el
   `DEFINE_MODULE` choca con `ORA-00001` sin que se entienda por qué. Que falle
   fuerte. Por eso el bloque de arriba pregunta si existe en vez de atrapar errores.
2. **Correr la sección 3 sola**, no pegada al resto, y mirar el tiempo. Si el
   bloque tarda **~13 segundos**, no está trabajando: está esperando un lock hasta
   que Oracle declara el interbloqueo.
3. **Verificar antes de seguir.** `SELECT COUNT(*) ... WHERE name = '<modulo>'`
   tiene que dar `0` antes de redefinir.

Al terminar, comprobar que estén todos los handlers:

```sql
SELECT t.uri_template, h.method
  FROM user_ords_modules p
  JOIN user_ords_templates t ON t.module_id = p.id
  JOIN user_ords_handlers  h ON h.template_id = t.id
 WHERE p.name = '<modulo>'
 ORDER BY t.uri_template, h.method;
```

### Si el despliegue deja el módulo trabado (ORA-00060)

Cuando un `DEFINE_MODULE` falla a mitad de camino, deja el módulo **a medias**:
la fila existe en `ORDS_METADATA.ORDS_MODULES`, responde `500` a todo, y el
`DELETE_MODULE` empieza a dar `ORA-00060` (deadlock en la metadata de ORDS).

En orden, hasta que uno funcione:

1. **`ROLLBACK`, cerrar todas las pestañas** de SQL Developer Web / APEX, esperar
   1-2 minutos y volver a entrar en una sola. La sesión huérfana del intento
   fallido es la que retiene el lock.
2. **Correr el `DELETE_MODULE` solo**, sin nada más en el script:
   ```sql
   BEGIN
     ORDS.DELETE_MODULE(p_module_name => '<modulo>');
     COMMIT;
   END;
   /
   ```
   Repetir unas cuantas veces si hace falta — el lock termina soltándose.
3. **Borrarlo desde la interfaz**: SQL Developer Web → REST → Modules → módulo →
   *Delete*. ORDS maneja la transacción por dentro.
4. **Último recurso: renombrar el módulo** (`recibos` → `cobranzas`, con su base
   path) y ajustar las rutas en `src/lib/api.ts`. La fila trabada queda muerta y se
   borra otro día. Es feo pero destraba en dos minutos.

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
- **Un error de CORS suele ser un 500 disfrazado.** Ningún módulo de este schema
  define `origins_allowed` y todos funcionan, así que si el navegador dice
  *"No 'Access-Control-Allow-Origin' header is present"*, lo que pasó es que el
  handler explotó: ORDS devuelve el 500 sin cabeceras CORS y el browser tapa el
  mensaje real. Diagnóstico: `curl -i` contra el endpoint para ver el cuerpo, y
  `SELECT object_name, status FROM user_objects` para ver si el paquete quedó
  `INVALID`.
- **Los GET no llaman a paquetes.** Si un `SELECT` invoca una función de un
  paquete inválido, todo el endpoint devuelve 500. Los handlers de lectura de
  `clientes` y `solicitudes` son SQL puro; conviene mantener esa línea.

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
