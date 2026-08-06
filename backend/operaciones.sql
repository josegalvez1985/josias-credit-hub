-- =====================================================================
-- ENDPOINT: /operaciones  —  "Solicitud de Créditos" (Créditos Otorgados)
-- Contiene: solo el módulo ORDS. Sin paquete y sin DDL: es de lectura pura.
-- Correr como WKSP_JOSIASMUEBLES.
--
-- Migra la página 18 de la app APEX 70967 ("Facturas" / Créditos Otorgados),
-- que es un maestro-detalle de cuatro Interactive Grids:
--
--   VENTAS_CABECERA           (maestro)
--   VENTAS_DETALLE            artículos          FK ID -> cabecera
--   VENTAS_ACTIVIDAD_LABORAL  actividad laboral  FK ID -> cabecera
--   VENTAS_REFERENCIAS        referencias        FK ID -> cabecera
--
-- Tablas de apoyo (solo lectura): CLIENTES, CIUDADES, VENDEDORES, ARTICULOS,
-- PROFESIONES, RELACIONES_PERSONALES.
--
-- ⚠ SOLO LECTURA — Y NO ES UNA LIMITACIÓN TEMPORAL, ES EL PUNTO
-- ---------------------------------------------------------------
-- En APEX los cuatro grids son editables (i:u:d), pero acá se migra solo la
-- consulta y los dos impresos. Es deliberado: sobre VENTAS_CABECERA hay cinco
-- triggers que mueven el plan de cuotas entero, y VENTAS_CUOTAS es de donde
-- cuelgan los saldos y los recibos ya cobrados.
--
--   BI_VENTAS_CABECERA    ID desde VENTAS_CABECERA_SEQ
--   TRG_CUOTAS            AFTER INSERT: crea las cuotas 1..N con ADD_MONTHS
--   TRG_CUOTA_INICIAL     crea/borra la cuota 0 según ENTREGA_INICIAL
--   TRG_RECALCULA_CUOTA   AFTER UPDATE: BORRA Y REGENERA todo el plan
--   TRG_VERIFICA_FECHA    FECHA_FACTURA > SYSDATE -> ORA-20001
--
-- Si algún día se agrega escritura, la regla es la misma que en recibos: el
-- código NO toca VENTAS_CUOTAS ni calcula vencimientos — los triggers ya lo
-- hacen y duplicarlo genera cuotas de más.
--
-- Vale saber que la base ya se defiende sola: TRG_RECALCULA_CUOTA compara
-- SUM(monto_cuota) contra SUM(saldo_cuota) y aborta con "No puede modificar
-- esta operación posee recibos cargados" si el crédito ya empezó a cobrarse.
--
-- Sin paquete a propósito: un GET que invoca un paquete devuelve 500 apenas
-- ese paquete queda INVALID (backend/README.md → "Los GET no llaman a
-- paquetes"). SQL puro, como `consultas` y los GET de `solicitudes`.
-- =====================================================================


-- =====================================================================
-- 1. SANEAMIENTO
-- =====================================================================
-- Nada que sanear: este módulo no crea ni altera objetos. Todas las tablas
-- que lee ya existen en producción y no se tocan.
--
-- Las tablas VENTAS_* todavía no están versionadas en este repo (igual que
-- CLIENTES, ARTICULOS y las demás; ver backend/README.md → "Pendiente de
-- versionar"). El DDL de las cuatro se recibió el 2026-08-06 y está resumido
-- en la cabecera de este archivo y en GUIA-BACKEND.md §7.


-- =====================================================================
-- 2. MÓDULO ORDS
-- =====================================================================
-- Van DOS ejecuciones separadas, no las dos juntas (ORA-00060 reproducible):
--   (2.a) el DELETE_MODULE solo, y verificar que el conteo dé 0
--   (2.b) el DECLARE ... END; que define el módulo
-- Detalle en backend/README.md → "Desplegar un módulo ORDS".

-- ---------------------------------------------------------------------
-- 2.a  Borrado previo — CORRER SOLO ESTO Y ESPERAR
-- ---------------------------------------------------------------------
-- La primera vez no encuentra nada y no hace nada; está para poder volver a
-- correr el archivo. Sin EXCEPTION a propósito: si el borrado falla hay que
-- verlo, no taparlo (un WHEN OTHERS THEN NULL hace creer que borró y después
-- el DEFINE choca con ORA-00001 sin explicación).
DECLARE
  l_existe NUMBER;
BEGIN
  SELECT COUNT(*) INTO l_existe FROM user_ords_modules WHERE name = 'operaciones';
  IF l_existe > 0 THEN
    ORDS.DELETE_MODULE(p_module_name => 'operaciones');
    COMMIT;
  END IF;
END;
/

-- Verificar que dé 0 ANTES de seguir con 2.b:
--   SELECT COUNT(*) FROM user_ords_modules WHERE name = 'operaciones';
-- Si el bloque de arriba tardó ~13 segundos, no estaba trabajando: estaba
-- esperando un lock. Ver backend/README.md antes de insistir.


-- ---------------------------------------------------------------------
-- 2.b  Definición del módulo — CORRER SOLO ESTO
-- ---------------------------------------------------------------------
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

  -- p_items_per_page = 30: es el tamaño de página de los handlers json/query
  -- de este módulo, o sea lo que trae el listado en la primera carga y en cada
  -- "Mostrar más". El SQL no lleva ROWNUM ni FETCH FIRST — el corte lo hace
  -- ORDS, y así el botón puede seguir pidiendo páginas hasta agotar la tabla.
  ORDS.DEFINE_MODULE(
      p_module_name    => 'operaciones',
      p_base_path      => '/operaciones/',
      p_items_per_page => 30,
      p_status         => 'PUBLISHED',
      p_comments       => NULL);


  -- ==================================================================
  -- LISTADO   GET /operaciones/creditos
  -- ==================================================================
  -- El IG maestro de la página 18, ordenado igual: FECHA_FACTURA DESC y
  -- después NRO_SOLICITUD DESC (p_sort_order 1 y 2 del export).
  --
  -- Paginación y búsqueda SERVER-SIDE, como en recibos: son muchas filas y
  -- traerlas todas para filtrar en el cliente no escala. El resto de la app
  -- usa el patrón "traer-todo-y-filtrar-local", pero acá no aplica.
  --
  -- El parámetro de búsqueda se llama `buscar`, NO `q`: `q` es un parámetro
  -- RESERVADO de ORDS (lo usa para su filtro JSON ?q={"col":"valor"}) y un
  -- bind :q nunca recibe el valor. Es el error documentado en CLAUDE.md.
  -- Por eso además va declarado con DEFINE_PARAMETER más abajo.
  --
  -- Busca por nro. de solicitud, nro. de factura, CI/RUC o nombre del cliente.
  -- Para los números se comparan solo dígitos de los dos lados, así "1.554"
  -- encuentra al CI "1.554.321" esté guardado con puntos o sin ellos — el
  -- mismo criterio que filtrarLov() aplica en el cliente.
  --
  -- El término se normaliza UNA vez en un subquery escalar (`b`) en vez de
  -- repetir UPPER()/REGEXP_REPLACE() sobre el bind en cada rama del OR. Es
  -- más legible y evita que Oracle evalúe la misma expresión cinco veces.
  --
  -- ⚠ ESTE HANDLER ES json/query, ASÍ QUE PAGINA ORDS, NO EL SQL.
  -- La paginación va por `?page=N` de a p_items_per_page filas (25). NO
  -- acepta `?limit=` ni `?offset=`: esos son parámetros de los handlers
  -- plsql/block como el listado de `recibos`, que los declara y bindea a
  -- mano. Mandarle `?limit=3` a este endpoint devuelve items:[] sin ningún
  -- error — el cliente HTTP (listarCreditos en src/lib/api.ts) usa `page`
  -- justamente por esto.
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'operaciones',
      p_pattern        => 'creditos',
      p_priority       => 0,
      p_etag_type      => 'NONE',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'operaciones',
      p_pattern        => 'creditos',
      p_method         => 'GET',
      p_source_type    => 'json/query',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'      SELECT vc.id,
             vc.nro_solicitud,
             TO_CHAR(vc.fecha_factura, ''YYYY-MM-DD'')            AS fecha_factura,
             vc.referencia,
             vc.cod_cliente,
             cl.razon_social,
             NVL(cl.ci, cl.ruc)                                   AS documento,
             cl.nro_telefono,
             vc.cantidad_cuotas,
             vc.total,
             vc.monto_cuota,
             vc.entrega_inicial,
             vc.porc_interes,
             TO_CHAR(vc.fec_vencimiento_inicial, ''YYYY-MM-DD'')  AS fec_vencimiento_inicial,
             vc.cod_ciudad,
             ci.descripcion                                       AS ciudad,
             vc.cod_vendedor,
             ve.nombre                                            AS vendedor,
             vc.id_solicitud
      FROM   ventas_cabecera vc
      CROSS  JOIN ( SELECT UPPER(TRIM(:buscar))                         AS txt,
                           REGEXP_REPLACE(TRIM(:buscar), ''[^0-9]'', '''') AS num
                      FROM dual ) b
      LEFT   JOIN clientes   cl ON cl.cod_cliente  = vc.cod_cliente
      LEFT   JOIN ciudades   ci ON ci.cod_ciudad   = vc.cod_ciudad
      LEFT   JOIN vendedores ve ON ve.cod_vendedor = vc.cod_vendedor
      WHERE  ( b.txt IS NULL
               OR UPPER(cl.razon_social) LIKE ''%'' || b.txt || ''%''
               OR UPPER(vc.referencia)   LIKE ''%'' || b.txt || ''%''
               OR ( b.num IS NOT NULL
                    AND (   TO_CHAR(vc.nro_solicitud) = b.num
                         OR REGEXP_REPLACE(NVL(cl.ci, cl.ruc), ''[^0-9]'', '''')
                              LIKE ''%'' || b.num || ''%'' ) ) )
      ORDER  BY vc.fecha_factura DESC NULLS LAST, vc.nro_solicitud DESC
    ');

  -- `buscar` es opcional: si no viene, el bind llega NULL y el WHERE no filtra.
  ORDS.DEFINE_PARAMETER(
      p_module_name        => 'operaciones',
      p_pattern            => 'creditos',
      p_method             => 'GET',
      p_name               => 'buscar',
      p_bind_variable_name => 'buscar',
      p_source_type        => 'URI',
      p_param_type         => 'STRING',
      p_access_method      => 'IN',
      p_comments           => NULL);


  -- ==================================================================
  -- CABECERA   GET /operaciones/credito/:id
  -- ==================================================================
  -- La fila del maestro con todo resuelto para la pantalla de detalle y para
  -- los dos impresos (solicitud y pagaré). Trae de CLIENTES bastante más que
  -- el listado porque el impreso lo necesita (dirección, ciudad, nacimiento).
  --
  -- `estado` sale de SOLICITUD_VENTAS_CABECERA a través de ID_SOLICITUD, tal
  -- como lo hace el proceso GET_SOLICITUD_PDF de la página 57 de APEX. Ese
  -- JOIN es además la confirmación de para qué sirve VENTAS_CABECERA.ID_SOLICITUD:
  -- es el puente al módulo `solicitudes` (la solicitud que cargó el asesor).
  -- Va con LEFT JOIN porque hay créditos viejos con ID_SOLICITUD en NULL —se
  -- ven en los datos de producción—, y ahí el estado simplemente viene vacío.
  --
  -- json/query;type=single devuelve el objeto suelto, no un feed {items:[…]}.
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'operaciones',
      p_pattern        => 'credito/:id',
      p_priority       => 0,
      p_etag_type      => 'NONE',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'operaciones',
      p_pattern        => 'credito/:id',
      p_method         => 'GET',
      p_source_type    => 'json/query;type=single',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'      SELECT vc.id,
             vc.nro_solicitud,
             TO_CHAR(vc.fecha_factura, ''YYYY-MM-DD'')            AS fecha_factura,
             vc.referencia,
             vc.cantidad_cuotas,
             vc.total,
             vc.monto_cuota,
             vc.entrega_inicial,
             vc.porc_interes,
             TO_CHAR(vc.fec_vencimiento_inicial, ''YYYY-MM-DD'')  AS fec_vencimiento_inicial,
             vc.id_solicitud,
             so.estado,
             -- Monto en letras para el pagaré. Se usa la MISMA función que el
             -- recibo térmico (GET /recibos/letras/:monto), no una versión en
             -- JS: el papel que se firma tiene que decir exactamente lo mismo
             -- que viene diciendo el sistema viejo.
             NUM_LETRAS(vc.total)                                 AS total_letras,
             vc.cod_cliente,
             cl.razon_social,
             cl.nombre_fantasia,
             NVL(cl.ci, cl.ruc)                                   AS documento,
             cl.ci,
             cl.ruc,
             cl.nro_telefono,
             cl.direccion,
             cl.nro_casa,
             cl.estado_civil,
             TO_CHAR(cl.fecha_nacimiento, ''YYYY-MM-DD'')         AS fecha_nacimiento,
             cc.descripcion                                       AS ciudad_cliente,
             vc.cod_ciudad,
             ci.descripcion                                       AS ciudad,
             vc.cod_vendedor,
             ve.nombre                                            AS vendedor
      FROM   ventas_cabecera vc
      LEFT   JOIN solicitud_ventas_cabecera so ON so.id = vc.id_solicitud
      LEFT   JOIN clientes   cl ON cl.cod_cliente  = vc.cod_cliente
      LEFT   JOIN ciudades   cc ON cc.cod_ciudad   = cl.cod_ciudad
      LEFT   JOIN ciudades   ci ON ci.cod_ciudad   = vc.cod_ciudad
      LEFT   JOIN vendedores ve ON ve.cod_vendedor = vc.cod_vendedor
      WHERE  vc.id = :id
    ');


  -- ==================================================================
  -- ARTÍCULOS   GET /operaciones/credito/:id/articulos
  -- ==================================================================
  -- El IG "Articulos" (VENTAS_DETALLE). `subtotal` se calcula en Oracle para
  -- que el impreso y la pantalla no puedan discrepar por un redondeo distinto.
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'operaciones',
      p_pattern        => 'credito/:id/articulos',
      p_priority       => 0,
      p_etag_type      => 'NONE',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'operaciones',
      p_pattern        => 'credito/:id/articulos',
      p_method         => 'GET',
      p_source_type    => 'json/query',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'      SELECT vd.id_detalle,
             vd.id,
             vd.cod_articulo,
             ar.descripcion       AS articulo,
             vd.cantidad,
             vd.precio_unitario,
             NVL(vd.cantidad, 0) * NVL(vd.precio_unitario, 0) AS subtotal
      FROM   ventas_detalle vd
      LEFT   JOIN articulos ar ON ar.cod_articulo = vd.cod_articulo
      WHERE  vd.id = :id
      ORDER  BY vd.id_detalle
    ');


  -- ==================================================================
  -- ACTIVIDAD LABORAL   GET /operaciones/credito/:id/actividad
  -- ==================================================================
  -- El IG "Actividad laboral" (VENTAS_ACTIVIDAD_LABORAL).
  -- ES_EMPLEADO y APORTA_IPS son ''S''/''N'' en la base (LOV STATIC:Si;S,No;N
  -- en APEX); se devuelven crudos y los traduce el frontend, igual que el
  -- resto de la app.
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'operaciones',
      p_pattern        => 'credito/:id/actividad',
      p_priority       => 0,
      p_etag_type      => 'NONE',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'operaciones',
      p_pattern        => 'credito/:id/actividad',
      p_method         => 'GET',
      p_source_type    => 'json/query',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'      SELECT al.id_detalle,
             al.id,
             al.es_empleado,
             al.nombre_empresa,
             al.direccion,
             al.puesto_ocupado,
             al.ingresos_mensuales,
             al.otros_ingresos,
             al.antiguedad,
             al.telefono,
             al.cod_profesion,
             pr.descripcion   AS profesion,
             al.cod_ciudad,
             ci.descripcion   AS ciudad,
             al.aporta_ips
      FROM   ventas_actividad_laboral al
      LEFT   JOIN profesiones pr ON pr.cod_profesion = al.cod_profesion
      LEFT   JOIN ciudades    ci ON ci.cod_ciudad    = al.cod_ciudad
      WHERE  al.id = :id
      ORDER  BY al.id_detalle
    ');


  -- ==================================================================
  -- REFERENCIAS   GET /operaciones/credito/:id/referencias
  -- ==================================================================
  -- El IG "Referencias personales" (VENTAS_REFERENCIAS).
  --
  -- ⚠ RELACION es VARCHAR2(200) SIN FK, pero su LOV en APEX devuelve
  -- COD_RELACION (numérico): o sea, guarda el código como texto. Para mostrar
  -- "Hermano" en vez de "3" hay que joinear por TO_CHAR — y como la columna
  -- admite cualquier cosa, se hace con cuidado:
  --
  --   - El JOIN compara TRIM(rp.relacion) contra TO_CHAR(cod_relacion).
  --   - relacion_desc cae a la columna cruda si no matchea, así una fila con
  --     texto libre (o un código viejo que ya no existe) se muestra igual en
  --     vez de aparecer vacía.
  --
  -- Se replica tal cual está en producción; no se corrige el modelo desde acá.
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'operaciones',
      p_pattern        => 'credito/:id/referencias',
      p_priority       => 0,
      p_etag_type      => 'NONE',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'operaciones',
      p_pattern        => 'credito/:id/referencias',
      p_method         => 'GET',
      p_source_type    => 'json/query',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'      SELECT vr.id_detalle,
             vr.id,
             vr.relacion,
             NVL(rp.descripcion, vr.relacion) AS relacion_desc,
             vr.telefono,
             vr.nombre_apellido,
             vr.ind_garante
      FROM   ventas_referencias vr
      LEFT   JOIN relaciones_personales rp
             ON  TO_CHAR(rp.cod_relacion) = TRIM(vr.relacion)
      WHERE  vr.id = :id
      ORDER  BY vr.ind_garante DESC, vr.id_detalle
    ');


  -- ==================================================================
  -- CUOTAS   GET /operaciones/credito/:id/cuotas
  -- ==================================================================
  -- El plan de cuotas que generaron los triggers. No está en la página 18,
  -- pero el pagaré se imprime contra las cuotas y la pantalla de detalle gana
  -- mucho mostrando cuánto se cobró y cuánto falta.
  --
  -- La cuota 0 es la entrega inicial (la crea TRG_CUOTA_INICIAL), por eso el
  -- ORDER BY la deja primera y el frontend la rotula distinto.
  --
  -- `cobrado` sale de MONTO_CUOTA - SALDO_CUOTA: así lo mantienen los triggers
  -- de CUOTAS_COBRADAS (TRG_ACTUALIZA_CUOTA / TRG_ANULA_CUOTA), que descuentan
  -- y devuelven el saldo. No se consulta CUOTAS_COBRADAS acá: el saldo ya es
  -- la fuente de verdad y sumar recibos por afuera podría contradecirlo.
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'operaciones',
      p_pattern        => 'credito/:id/cuotas',
      p_priority       => 0,
      p_etag_type      => 'NONE',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'operaciones',
      p_pattern        => 'credito/:id/cuotas',
      p_method         => 'GET',
      p_source_type    => 'json/query',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'      SELECT cu.id,
             cu.nro_cuota,
             TO_CHAR(cu.fec_vencimiento, ''YYYY-MM-DD'')  AS fec_vencimiento,
             cu.monto_cuota,
             cu.saldo_cuota,
             NVL(cu.monto_cuota, 0) - NVL(cu.saldo_cuota, 0) AS cobrado,
             TO_CHAR(cu.fec_derivacion, ''YYYY-MM-DD'')   AS fec_derivacion
      FROM   ventas_cuotas cu
      WHERE  cu.id = :id
      ORDER  BY cu.nro_cuota
    ');

COMMIT;
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    RAISE;

END;
/


-- =====================================================================
-- 3. VERIFICACIÓN
-- =====================================================================
-- No forma parte del despliegue; son consultas sueltas.

-- 3.a  ¿Quedaron los seis handlers publicados?
--
--   SELECT t.uri_template, h.method, h.source_type
--     FROM user_ords_modules p
--     JOIN user_ords_templates t ON t.module_id = p.id
--     JOIN user_ords_handlers  h ON h.template_id = t.id
--    WHERE p.name = 'operaciones'
--    ORDER BY t.uri_template, h.method;
--
-- Tiene que devolver exactamente cinco filas:
--   credito/:id                  GET  json/query;type=single
--   credito/:id/actividad        GET  json/query
--   credito/:id/articulos        GET  json/query
--   credito/:id/cuotas           GET  json/query
--   credito/:id/referencias      GET  json/query
--   creditos                     GET  json/query

-- 3.b  ¿Los SELECT corren de verdad? Tomar un ID que exista:
--
--   SELECT id, nro_solicitud FROM ventas_cabecera
--    WHERE ROWNUM <= 5 ORDER BY fecha_factura DESC;
--
--   -- y con ese ID, probar los cuatro hijos a mano.

-- 3.c  Desde afuera, con curl (NUNCA desde el navegador: si algo falla, el
--      browser lo reporta como error de CORS y esconde el motivo real).
--
--   curl -i "https://oracleapex.com/ords/josiasmuebles/operaciones/creditos?limit=5"
--   curl -i "https://oracleapex.com/ords/josiasmuebles/operaciones/creditos?buscar=8179&limit=5"
--   curl -i "https://oracleapex.com/ords/josiasmuebles/operaciones/credito/<ID>"
--   curl -i "https://oracleapex.com/ords/josiasmuebles/operaciones/credito/<ID>/articulos"
--   curl -i "https://oracleapex.com/ords/josiasmuebles/operaciones/credito/<ID>/cuotas"
--
--   200 + JSON  -> anda.
--   404         -> el módulo anda; ese ID no existe. Probar con otro.
--   500         -> mirar el CUERPO de la respuesta, ahí viene el ORA-.
--
-- 3.d  SI EL LISTADO DEVUELVE 200 CON items:[] PERO LA TABLA TIENE DATOS
--      Pasó el 2026-08-06 y el motivo NO estaba en el SQL: el cliente le
--      mandaba `?limit=3`.
--
--      Este handler es json/query, o sea que la paginación la maneja ORDS con
--      `?page=N`. `limit` y `offset` NO existen acá — son parámetros de los
--      handlers plsql/block (el listado de `recibos` los declara y bindea a
--      mano). Al mandarlos, ORDS devuelve la lista vacía sin ningún error.
--
--      Cómo confirmarlo en diez segundos, sin tocar la base:
--
--        curl -i ".../operaciones/creditos"          -> trae 25 filas
--        curl -i ".../operaciones/creditos?limit=3"  -> items:[]   ← el síntoma
--        curl -i ".../operaciones/creditos?page=1"   -> la 2da página
--
--      La moraleja para el próximo endpoint: antes de copiar el patrón de
--      consumo de otro módulo, mirar de qué TIPO es su handler. json/query y
--      plsql/block se paginan distinto y el error no avisa.

-- 3.e  Si `buscar` parece no filtrar: verificar que el DEFINE_PARAMETER quedó.
--      Sin él, ORDS ignora el query param y el bind llega NULL siempre.
--
--   SELECT t.uri_template, p.name, p.bind_variable_name, p.source_type
--     FROM user_ords_modules m
--     JOIN user_ords_templates  t ON t.module_id   = m.id
--     JOIN user_ords_handlers   h ON h.template_id = t.id
--     JOIN user_ords_parameters p ON p.handler_id  = h.id
--    WHERE m.name = 'operaciones';
--
--   Tiene que aparecer `buscar` / `buscar` / URI.
--   Y recordar: NUNCA renombrarlo a `q` — es un parámetro reservado de ORDS.


-- =====================================================================
-- 4. ROLLBACK
-- =====================================================================
-- Este módulo no crea objetos, no altera esquema y no escribe una sola fila:
-- se deshace borrándolo y no deja rastro.
--
--   BEGIN
--     ORDS.DELETE_MODULE(p_module_name => 'operaciones');
--     COMMIT;
--   END;
--   /
