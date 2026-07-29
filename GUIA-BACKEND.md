# Guía de Backend — migrar una página de APEX a esta app

Cómo se convierte una página de Oracle APEX (con su PL/SQL) en un endpoint ORDS + una pantalla React.

Las **convenciones de ORDS** (estructura de archivo, contrato de respuesta, auth, paginación) están en
[backend/README.md](backend/README.md) y no se repiten acá. Esta guía cubre solo la traducción
APEX → ORDS y qué información hace falta para hacerla sin adivinar.

---

## 1. Regla de oro

> **No se escribe código contra una tabla que no vimos.**

APEX resuelve muchas cosas de forma implícita: secuencias, triggers, valores por defecto, LOVs,
validaciones, `:APP_USER`. Nada de eso se ve en el PL/SQL de la página. Si falta un dato, **pedirlo**
antes de escribir. Una tabla mal supuesta se paga con datos corruptos en una base que ya está en producción.

---

## 2. Qué necesito por cada página de APEX

Por cada página que pases, pedime lo que falte de esta lista. No hace falta que venga todo junto:
con el bloque A ya se puede empezar a modelar.

### A. Estructura de datos (imprescindible)

```sql
-- DDL de cada tabla que la página lee o escribe
SELECT DBMS_METADATA.GET_DDL('TABLE','RECIBOS') FROM dual;

-- Constraints: dicen qué valores son válidos (los CHECK son documentación pura)
SELECT constraint_name, constraint_type, search_condition
  FROM user_constraints WHERE table_name = 'RECIBOS';

-- Secuencias y triggers: ¿el ID lo genera la base o lo manda el cliente?
SELECT trigger_name, trigger_body FROM user_triggers WHERE table_name = 'RECIBOS';
```

### B. Lógica de la página

- El **PL/SQL de cada proceso** (After Submit, On Load, botones).
- Las **validaciones** de página y de ítem.
- Si llama a un **paquete que ya existe**, la spec de ese paquete (`DBMS_METADATA.GET_DDL('PACKAGE', …)`).
  Si la lógica ya está en un paquete, mejor: la reusamos y el módulo ORDS queda fino.

### C. Consultas

- El **SQL de cada región de reporte**, tal cual, con sus binds.
- La **query de cada LOV**, indicando cuál columna es el *display* y cuál el *return*.

### D. Comportamiento

- Qué ítems son **obligatorios**, sus tipos, máscaras y valores por defecto.
- Qué pasa **después de guardar**: ¿a dónde vuelve? ¿imprime algo?
- Si la página **imprime** (recibo, comprobante): qué reporte usa y qué datos lleva.

Un pantallazo de la página de APEX ayuda a entender el layout, pero no reemplaza el SQL.

---

## 3. Traducción de conceptos

| APEX | ORDS + React |
| --- | --- |
| Proceso PL/SQL After Submit | Procedimiento en el paquete, invocado por un handler `POST`/`PUT` |
| Región de reporte | Handler `GET` con `SELECT` (o una vista) |
| LOV | Handler `GET /lov/<nombre>` que devuelve `{ value, label }` |
| Validación de página | Se hace **dos veces**: en el submit del form y en el paquete |
| `:APP_USER` | El username sale del token (`pkg_auth_token`), **nunca** del body |
| Session state (`:P10_X`) | `useState` en React; al backend viaja en el body del request |
| Tabular form / `apex_application.g_f01` | Array JSON en el body, o un `POST` por fila (como hace `crearSolicitud`) |
| `apex_error.add_error` | `{"success": false, "message": "…"}` con `:status_code` 400 |
| Branch condicional | `navigate()` en el cliente |
| Autorización de página | Validación del `Authorization: Bearer` en el handler |

Dos cosas que en APEX son gratis y acá no:

- **Transaccionalidad.** APEX hace commit al final del submit. En ORDS cada handler es su propia
  transacción: si una operación toca varias tablas, va **entera dentro de un procedimiento del
  paquete**, no repartida en varios handlers. (`crearSolicitud` hace varios POST secuenciales y por
  eso puede dejar datos parciales — no repetir ese patrón en recibos, donde importa la integridad.)
- **Concurrencia.** APEX usa checksums de fila. Si la página tiene bloqueo optimista, hay que decidir
  cómo replicarlo (versión de fila o `SELECT … FOR UPDATE` dentro del paquete).

---

## 4. Flujo de trabajo por página

1. **Jose pasa** el PL/SQL + el DDL de las tablas.
2. **Yo pregunto** lo que falte de la sección 2 y confirmo cómo entendí la lógica.
3. **Backend**: **un solo archivo por módulo**, `backend/<modulo>.sql`, con todo adentro —
   saneamiento del esquema, paquete y módulo ORDS. No se parte en varios archivos ni hay
   carpeta de migraciones: los `ALTER`/`DROP` van comentados en la sección 1, con su rollback.
4. **Cliente HTTP**: tipos y funciones en [src/lib/api.ts](src/lib/api.ts), siguiendo lo que ya hay.
5. **Pantalla**: siguiendo [GUIA-FRONTEND.md](GUIA-FRONTEND.md).
6. **Verificación**: `npx tsc --noEmit` + `npx vite build` + una prueba real contra el endpoint.

> **Al desplegar el módulo ORDS, leer primero *Desplegar un módulo ORDS* en
> [backend/README.md](backend/README.md).** `DEFINE_MODULE` no es idempotente y un
> despliegue fallido deja el módulo a medias, respondiendo 500 y sin poder
> borrarse. Ahí está el procedimiento y cómo destrabarlo.

---

## 5. Recordatorios de ORDS que más muerden

Detalle completo en [backend/README.md](backend/README.md); estos son los que más rompen:

- Los handlers **no hacen DML**: validan el token, llaman al paquete y arman el JSON.
- El cuerpo del handler va dentro de un literal SQL → **cada `'` interno se escribe `''`**.
- ORDS pagina de a **25**. Todo feed nuevo se consume con `limit=500&offset=` recorriendo páginas,
  como hacen las funciones de `api.ts`.
- Un `200` con `{"success": false}` **es un error** para el cliente.
- Un `401`/`403` expulsa al usuario al login. Todo endpoint que no sea `/auth/login` valida el token,
  y para eso hay que declarar el `ORDS.DEFINE_PARAMETER` de tipo `HEADER`.
- Fechas: el front manda `YYYY-MM-DD`; el handler hace `TO_DATE(:campo,'YYYY-MM-DD')`. String vacío → ORA-01841.

---

## 6. Estado actual del módulo Recibos

| Pieza | Estado |
| --- | --- |
| Ruta `/recibos` + menú | ✅ hecho — [src/routes/\_app.recibos.tsx](src/routes/_app.recibos.tsx), esqueleto vacío |
| DDL de las tablas | ✅ recibido — `CUOTAS_COBRADAS`, `VENTAS_CABECERA`, `VENTAS_CUOTAS`, `CLIENTES` |
| `backend/recibos.sql` | ✅ **desplegado y funcionando** — saneamiento + `pkg_recibos` + módulo ORDS `recibos` |
| `V_SALDOS` y funciones | ⚠️ se invocan pero no vimos su DDL (`RETORNA_ARTICULOS`, `FN_CUOTAS`, `FN_USUARIO`, `NUM_LETRAS`) |
| Cliente HTTP en `api.ts` | ✅ hecho — tipos `Recibo`/`ReciboDetalle`, listado, alta, edición, anulación, LOVs |
| Pantalla de listado | ✅ hecha — [\_app.recibos.index.tsx](src/routes/_app.recibos.index.tsx), tabla en escritorio y tarjetas en celular |
| Menú de secciones | ✅ hecho — [recibos-tabs.tsx](src/components/recibos-tabs.tsx), las 6 del menú de APEX |
| Pantalla de emisión (pág. 3) | ✅ hecha — [\_app.recibos.nuevo.tsx](src/routes/_app.recibos.nuevo.tsx), cascada cliente → solicitud → cuota |
| Impresión térmica | ✅ hecha — [src/lib/escpos.ts](src/lib/escpos.ts), Web Bluetooth sin dependencias |
| Envío por WhatsApp | ✅ hecho — [src/lib/recibo-whatsapp.ts](src/lib/recibo-whatsapp.ts), imagen PNG + texto |
| Derivaciones (pág. 4) | ✅ hecha — [\_app.recibos.derivaciones.tsx](src/routes/_app.recibos.derivaciones.tsx) + `POST /recibos/derivar` |
| Ubicaciones (pág. 5) | ✅ hecha — [\_app.recibos.ubicaciones.tsx](src/routes/_app.recibos.ubicaciones.tsx) + `GET /recibos/lov/clientes-todos` |
| Cargar Ubicación (pág. 6) | ✅ hecha — [\_app.recibos.cargar-ubicacion.tsx](src/routes/_app.recibos.cargar-ubicacion.tsx) + `POST /recibos/ubicacion` |
| Precios de Artículos (pág. 7) | ✅ hecha — comparte [precios-view.tsx](src/components/precios-view.tsx) con `/precios`. **Sin backend nuevo**: ya existía `GET /solicitudes/precios` |
| Consultar Datos de Clientes (pág. 10) | ✅ hecha — [\_app.recibos.clientes.tsx](src/routes/_app.recibos.clientes.tsx) + `GET /consultas/cliente/:cod_cliente` ([backend/consultas.sql](backend/consultas.sql), módulo aparte) |

**El módulo de Recibos quedó completo**: las 6 secciones del menú de la app APEX
"Josias Muebles Cobradores" están migradas.

Ojo con una excepción: la ficha de cliente de la pág. 10 **no vive en el módulo
`recibos`** sino en [backend/consultas.sql](backend/consultas.sql)
(`GET /consultas/cliente/:cod_cliente`). El handler original estaba en `recibos`
y desde el navegador daba *"No 'Access-Control-Allow-Origin' header"*; se publicó
el mismo SELECT en un módulo aparte para no tener que redefinir los otros catorce
handlers. La sección 3.d de ese archivo tiene los `curl` que confirman si el
`recibos` viejo quedó dañado — **si es que sí, hay que redesplegarlo entero**.

`CLIENTES.UBICACION` (VARCHAR2 1000) guarda un link
`https://www.google.com/maps?q=<lat>,<lon>` armado desde el GPS del celular.
La geolocalización, igual que Web Bluetooth, **exige contexto seguro**: funciona
en HTTPS o `localhost`, no en `http://<ip-de-la-lan>:8080`.

`V_SALDOS` y las funciones `RETORNA_ARTICULOS`, `FN_CUOTAS`, `FN_USUARIO` y
`NUM_LETRAS` **existen y tienen la forma esperada**: quedó confirmado cuando
`pkg_recibos` compiló sin errores.

### Lo que hacen los triggers de recibos (no replicar en código)

`CUOTAS_COBRADAS` tiene la lógica de negocio en triggers. El paquete **no debe**
tocar `VENTAS_CUOTAS` ni calcular el número de recibo:

| Trigger | Qué hace |
| --- | --- |
| `TRG_ACTUALIZA_CUOTA` | Descuenta/devuelve `VENTAS_CUOTAS.SALDO_CUOTA` al insertar, editar o borrar el monto |
| `TRG_ANULA_CUOTA` | Al pasar `ANULADO` a `'S'` devuelve el saldo; al volver a `'N'` lo descuenta otra vez |
| `TRG_NRO_RECIBO` | Asigna `NRO_RECIBO` si viene NULL (primer hueco ≥ 100000) |
| `TRG_CTRL_CUOTA` | En `VENTAS_CUOTAS`: ORA-20101 si el saldo queda negativo, ORA-20102 si supera la cuota |

Por eso el `INSERT` va con `NRO_RECIBO` en NULL y se recupera con `RETURNING`.

Se irá actualizando esta tabla a medida que avance la migración.
