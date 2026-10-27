-- =====================================================================
-- ENDPOINT: /ventas-pagos  —  reporte "Ventas vs Pagos"
-- Contiene: solo el módulo ORDS `ventas-pagos`. Sin paquete y sin DDL: es
-- de lectura pura. Correr como WKSP_JOSIASMUEBLES.
--
-- No migra una página de APEX: es un reporte nuevo (2026-10-27). Lo usa
-- Administración → Reportes → Ventas vs Pagos (/admin/reportes/ventas-pagos).
--
-- Un archivo y un módulo por reporte, con el nombre de su ruta (ver
-- backend/README.md). No va dentro de `proveedores` ni de un módulo
-- `reportes` compartido.
--
-- Handlers:
--   GET resumen   totales del período: lo vendido contra lo pagado a proveedores
--
-- Sin paquete a propósito: un GET que invoca un paquete devuelve 500 apenas
-- ese paquete queda INVALID (backend/README.md → "Los GET no llaman a
-- paquetes"). Por lo mismo no depende de pkg_recibos_compra: este reporte
-- sigue andando aunque `proveedores` esté caído.
--
-- QUÉ SUMA CADA LADO — decisiones de Jose (2026-10-27)
-- ---------------------------------------------------------------------
--   · VENTAS: los créditos otorgados (VENTAS_CABECERA) con FECHA_FACTURA en
--     el período. Monto = TOTAL, que es el precio a crédito: incluye el
--     interés de financiación y la entrega inicial (el alta de solicitudes
--     valida TOTAL = MONTO_CUOTA × CANTIDAD_CUOTAS + ENTREGA_INICIAL, y
--     TRG_APROBAR_SOLICITUD lo copia tal cual). La tabla no tiene estado ni
--     anulación: entran todas las filas.
--
--   · PAGOS A PROVEEDORES, dos partes:
--       1. Recibos de proveedores (RECIBOS_COMPRA_CABECERA) con FECHA en el
--          período, por su MONTO_TOTAL. TODO el recibo cuenta en la fecha
--          del recibo, también los cheques diferidos (no en su vencimiento).
--          El desglose por forma sale de RECIBOS_COMPRA_PAGOS.
--       2. Compras al contado: no pasan por recibos, se pagan en el
--          momento. Mismo criterio que GET /proveedores/compras (Compras por
--          Período), para que los dos reportes cuadren: TIPO = 'C', MOTIVO
--          'C' o 'E', y CONDICION_COMPRA distinta de 2 (crédito). Monto =
--          ROUND(SUM(cantidad × precio_unitario)) de COMPRAS_DETALLE ("TOTAL
--          DE FACTURA", ver backend/proveedores.sql).
--
--   · Solo totales del período, sin detalle por día ni por proveedor.
--
-- Los recibos anteriores al 2026-10-19 pueden no tener filas en
-- RECIBOS_COMPRA_PAGOS (se cargan con la 1.b de proveedores.sql). Por eso el
-- desglose por forma puede sumar menos que el total de recibos: el cliente
-- muestra esa diferencia como "Sin registrar", no la esconde.
--
-- PERMISOS
-- ---------------------------------------------------------------------
-- Igual que margen-articulos: token válido Y usuario en la lista del módulo
-- administrativo. La lista está repetida y tiene que ser la misma en todos lados:
--   · l_admins de la sección 2.b de este archivo
--   · backend/proveedores.sql (pkg_recibos_compra.es_admin y l_admins)
--   · backend/definiciones.sql (pkg_definiciones.es_admin y l_admins)
--   · backend/margen-articulos.sql (l_admins)
--   · USUARIOS_ADMIN de src/lib/permisos.ts (lo que se dibuja en pantalla)
--
-- "No tenés permiso" responde 400 y NO 403: src/lib/api.ts trata 401/403 como
-- sesión vencida y manda al login.
-- =====================================================================


-- =====================================================================
-- 1. SANEAMIENTO
-- =====================================================================
-- El módulo no crea ni altera objetos. Queda el DDL que se leyó, resumido:
--
--   VENTAS_CABECERA (recibido de Jose el 2026-10-27)
--     ID                       NUMBER        PK
--     NRO_SOLICITUD            NUMBER        NOT NULL, UK
--     FECHA_FACTURA            DATE
--     REFERENCIA               VARCHAR2(50)
--     COD_CLIENTE              NUMBER        FK CLIENTES
--     CANTIDAD_CUOTAS          NUMBER
--     TOTAL                    NUMBER
--     MONTO_CUOTA              NUMBER
--     COD_CIUDAD               NUMBER
--     COD_VENDEDOR             NUMBER
--     FEC_VENCIMIENTO_INICIAL  DATE
--     ENTREGA_INICIAL          NUMBER
--     PORC_INTERES             NUMBER
--     ID_SOLICITUD             NUMBER
--     UK (ID, COD_CLIENTE) · sin CHECK, sin columna de estado
--
--   RECIBOS_COMPRA_CABECERA / RECIBOS_COMPRA_PAGOS, COMPRAS_CABECERA /
--   COMPRAS_DETALLE: ver la sección 1 de backend/proveedores.sql.


-- =====================================================================
-- 2. MÓDULO ORDS
-- =====================================================================
-- Sin paquete, así que son DOS ejecuciones separadas, nunca el archivo
-- entero de una (ORA-00060 reproducible): (1) el bloque 2.a solo · (2) el
-- 2.b solo. Detalle en backend/README.md → "Desplegar un módulo ORDS".
--
-- ⚠ ANTES DEL PRIMER DESPLIEGUE: 2.a borra cualquier módulo que se llame
-- 'ventas-pagos'. Confirmar que no exista uno que no sea este:
--
--   SELECT name, uri_prefix FROM user_ords_modules ORDER BY name;
--
-- Si aparece 'ventas-pagos' o un uri_prefix '/ventas-pagos/' que no salió de
-- este archivo, NO correr 2.a: hay que elegir otro nombre.

-- ---------------------------------------------------------------------
-- 2.a  Borrado previo — ejecución 1 de 2. CORRER SOLO ESTO Y ESPERAR
-- ---------------------------------------------------------------------
-- Sin EXCEPTION a propósito: si el borrado falla hay que verlo.
DECLARE
  l_existe NUMBER;
BEGIN
  SELECT COUNT(*) INTO l_existe FROM user_ords_modules WHERE name = 'ventas-pagos';
  IF l_existe > 0 THEN
    ORDS.DELETE_MODULE(p_module_name => 'ventas-pagos');
    COMMIT;
  END IF;
END;
/

-- Tiene que dar 0 ANTES de seguir con 2.b:
--   SELECT COUNT(*) FROM user_ords_modules WHERE name = 'ventas-pagos';
-- Si el bloque de arriba tardó ~13 segundos, estaba esperando un lock: ver
-- backend/README.md antes de insistir.


-- ---------------------------------------------------------------------
-- 2.b  Definición del módulo — ejecución 2 de 2. CORRER SOLO ESTO
-- ---------------------------------------------------------------------
-- El handler es plsql/block: es el único tipo que puede validar el token.
DECLARE

  -- Usuarios habilitados, ya escritos como lista de un IN (...). Es la misma
  -- lista que la de proveedores.sql, definiciones.sql, margen-articulos.sql y
  -- src/lib/permisos.ts.
  l_admins  CONSTANT VARCHAR2(200) := '''AAQUINO'', ''AGONZALEZ'', ''JOSEG''';

  -- Arranque común de TODOS los handlers: token válido y usuario habilitado.
  -- Igual que en proveedores.sql. Cada handler tiene que declarar l_user.
  l_guardia CONSTANT VARCHAR2(2000) := '
        l_user := pkg_auth_token.validar_token(REPLACE(:authorization, ''Bearer '', ''''));
        IF l_user IS NULL THEN
          :status_code := 401;
          htp.p(''{"success": false, "message": "Token invalido o expirado"}'');
          RETURN;
        END IF;
        -- 400 y no 403: api.ts toma 403 como sesion vencida y expulsa al login.
        IF UPPER(TRIM(l_user)) NOT IN (' || l_admins || ') THEN
          :status_code := 400;
          htp.p(''{"success": false, "message": "Tu usuario no tiene habilitado el modulo administrativo"}'');
          RETURN;
        END IF;
';

BEGIN
  ORDS.ENABLE_SCHEMA(
      p_enabled             => TRUE,
      p_url_mapping_type    => 'BASE_PATH',
      p_url_mapping_pattern => 'josiasmuebles',
      p_auto_rest_auth      => FALSE);

  ORDS.DEFINE_MODULE(
      p_module_name    => 'ventas-pagos',
      p_base_path      => '/ventas-pagos/',
      p_items_per_page => 25,
      p_status         => 'PUBLISHED',
      p_comments       => NULL);


  -- ==================================================================
  -- RESUMEN DEL PERÍODO   GET /ventas-pagos/resumen?desde=&hasta=
  -- ==================================================================
  -- desde y hasta son YYYY-MM-DD, los dos incluidos y obligatorios. Devuelve
  -- UN objeto, no un array de items:
  --
  --   { "success": true,
  --     "ventas":  { "cantidad", "total", "entrega_inicial" },
  --     "recibos": { "cantidad", "total", "efectivo", "transferencia", "cheque" },
  --     "contado": { "cantidad", "total" } }
  --
  -- El total pagado, la parte "sin registrar" de los recibos y la diferencia
  -- los calcula el cliente (src/lib/reporte-ventas-pagos.ts), así la pantalla
  -- y el PDF usan una sola fórmula.
  --
  -- Cada parte es un agregado sin GROUP BY: siempre da exactamente una fila,
  -- con ceros si el período está vacío.
  --
  -- Las fechas se comparan con < hasta + 1 y no con BETWEEN: las tres son
  -- DATE y pueden traer hora.
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'ventas-pagos',
      p_pattern        => 'resumen',
      p_priority       => 0,
      p_etag_type      => 'NONE',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'ventas-pagos',
      p_pattern        => 'resumen',
      p_method         => 'GET',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      DECLARE
        l_user  VARCHAR2(255);
        l_desde DATE;
        l_hasta DATE;
      BEGIN' || l_guardia || '
        BEGIN
          l_desde := TO_DATE(:desde, ''YYYY-MM-DD'');
          l_hasta := TO_DATE(:hasta, ''YYYY-MM-DD'');
        EXCEPTION WHEN OTHERS THEN
          l_desde := NULL;
        END;
        IF l_desde IS NULL OR l_hasta IS NULL THEN
          :status_code := 400;
          htp.p(''{"success": false, "message": "Faltan las fechas desde y hasta (AAAA-MM-DD)"}'');
          RETURN;
        END IF;
        IF l_desde > l_hasta THEN
          :status_code := 400;
          htp.p(''{"success": false, "message": "La fecha desde no puede ser posterior a la fecha hasta"}'');
          RETURN;
        END IF;

        FOR r IN (
          SELECT v.cantidad       AS v_cantidad,
                 v.total          AS v_total,
                 v.entrega        AS v_entrega,
                 rc.cantidad      AS r_cantidad,
                 rc.total         AS r_total,
                 pg.efectivo      AS r_efectivo,
                 pg.transferencia AS r_transferencia,
                 pg.cheque        AS r_cheque,
                 co.cantidad      AS c_cantidad,
                 co.total         AS c_total
            -- VENTAS: créditos otorgados en el período
            FROM ( SELECT COUNT(*)                       AS cantidad,
                          NVL(SUM(total), 0)             AS total,
                          NVL(SUM(entrega_inicial), 0)   AS entrega
                     FROM ventas_cabecera
                    WHERE fecha_factura >= l_desde
                      AND fecha_factura <  l_hasta + 1 ) v
            -- RECIBOS A PROVEEDORES: todo en la fecha del recibo
           CROSS JOIN
                 ( SELECT COUNT(*)                       AS cantidad,
                          NVL(SUM(monto_total), 0)       AS total
                     FROM recibos_compra_cabecera
                    WHERE fecha >= l_desde
                      AND fecha <  l_hasta + 1 ) rc
            -- ...y su desglose por forma de pago
           CROSS JOIN
                 ( SELECT NVL(SUM(CASE WHEN p.forma_pago = ''EFECTIVO''      THEN p.monto END), 0) AS efectivo,
                          NVL(SUM(CASE WHEN p.forma_pago = ''TRANSFERENCIA'' THEN p.monto END), 0) AS transferencia,
                          NVL(SUM(CASE WHEN p.forma_pago = ''CHEQUE''        THEN p.monto END), 0) AS cheque
                     FROM recibos_compra_pagos    p
                     JOIN recibos_compra_cabecera c ON c.id_recibo = p.id_recibo
                    WHERE c.fecha >= l_desde
                      AND c.fecha <  l_hasta + 1 ) pg
            -- COMPRAS AL CONTADO: mismo filtro que GET /proveedores/compras
           CROSS JOIN
                 ( SELECT COUNT(*)                       AS cantidad,
                          NVL(SUM(t.total), 0)           AS total
                     FROM compras_cabecera c
                     -- TOTAL DE FACTURA (ver backend/proveedores.sql)
                     LEFT JOIN ( SELECT id_cabecera,
                                        ROUND(SUM(NVL(cantidad, 0) * NVL(precio_unitario, 0))) AS total
                                   FROM compras_detalle
                                  GROUP BY id_cabecera ) t ON t.id_cabecera = c.id_cabecera
                    WHERE c.tipo   = ''C''
                      AND c.motivo IN (''C'', ''E'')
                      AND NVL(c.condicion_compra, 0) <> 2
                      AND c.fecha >= l_desde
                      AND c.fecha <  l_hasta + 1 ) co
        ) LOOP
          apex_json.open_object;
          apex_json.write(''success'', TRUE);

          apex_json.open_object(''ventas'');
          apex_json.write(''cantidad'',        r.v_cantidad);
          apex_json.write(''total'',           r.v_total);
          apex_json.write(''entrega_inicial'', r.v_entrega);
          apex_json.close_object;

          apex_json.open_object(''recibos'');
          apex_json.write(''cantidad'',      r.r_cantidad);
          apex_json.write(''total'',         r.r_total);
          apex_json.write(''efectivo'',      r.r_efectivo);
          apex_json.write(''transferencia'', r.r_transferencia);
          apex_json.write(''cheque'',        r.r_cheque);
          apex_json.close_object;

          apex_json.open_object(''contado'');
          apex_json.write(''cantidad'', r.c_cantidad);
          apex_json.write(''total'',    r.c_total);
          apex_json.close_object;

          apex_json.close_object;
        END LOOP;
      EXCEPTION WHEN OTHERS THEN
        :status_code := 500;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_PARAMETER(p_module_name => 'ventas-pagos', p_pattern => 'resumen', p_method => 'GET',
      p_name => 'authorization', p_bind_variable_name => 'authorization',
      p_source_type => 'HEADER', p_param_type => 'STRING', p_access_method => 'IN', p_comments => NULL);

COMMIT;
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    RAISE;

END;
/


-- =====================================================================
-- 3. VERIFICACIÓN (correr a mano, no es parte del despliegue)
-- =====================================================================

-- 3.a  ¿Quedó el handler?
--
--   SELECT t.uri_template, h.method, h.source_type
--     FROM user_ords_modules p
--     JOIN user_ords_templates t ON t.module_id = p.id
--     JOIN user_ords_handlers  h ON h.template_id = t.id
--    WHERE p.name = 'ventas-pagos'
--    ORDER BY t.uri_template, h.method;
--
--   resumen   GET   plsql/block

-- 3.b  ¿Los números son los esperados? Cada parte por separado, con fechas
--      fijas; tienen que coincidir con la pantalla para el mismo período.
--
--   SELECT COUNT(*), SUM(total), SUM(entrega_inicial)
--     FROM ventas_cabecera
--    WHERE fecha_factura >= DATE '2026-10-01' AND fecha_factura < DATE '2026-10-31' + 1;
--
--   SELECT COUNT(*), SUM(monto_total)
--     FROM recibos_compra_cabecera
--    WHERE fecha >= DATE '2026-10-01' AND fecha < DATE '2026-10-31' + 1;
--
--   SELECT p.forma_pago, SUM(p.monto)
--     FROM recibos_compra_pagos p
--     JOIN recibos_compra_cabecera c ON c.id_recibo = p.id_recibo
--    WHERE c.fecha >= DATE '2026-10-01' AND c.fecha < DATE '2026-10-31' + 1
--    GROUP BY p.forma_pago;
--
--   -> el total de contado tiene que coincidir con la suma de las facturas
--      "Contado" del reporte Compras por Período para el mismo período.

-- 3.c  Desde afuera, con curl (NUNCA desde el navegador: un 500 llega como
--      "error de CORS" y esconde el ORA- real):
--
--   curl -s -X POST "https://oracleapex.com/ords/josiasmuebles/auth/login" \
--        -H "Content-Type: application/json" \
--        -d '{"username":"JOSEG","password":"..."}'
--   -> copiar el "token" de la respuesta en TOKEN.
--
--   B="https://oracleapex.com/ords/josiasmuebles/ventas-pagos"
--   curl -i "$B/resumen?desde=2026-10-01&hasta=2026-10-31" -H "Authorization: Bearer $TOKEN"
--     -> 200 {"success":true,"ventas":{...},"recibos":{...},"contado":{...}}
--   Sin fechas, o desde > hasta -> 400 con mensaje. Sin el header -> 401.
--   Con un usuario fuera de la lista -> 400 "no tiene habilitado el modulo administrativo".


-- =====================================================================
-- 4. ROLLBACK
-- =====================================================================
-- No toca esquema ni datos. Se deshace borrando el módulo:
--
--   BEGIN
--     ORDS.DELETE_MODULE(p_module_name => 'ventas-pagos');
--     COMMIT;
--   END;
--   /
