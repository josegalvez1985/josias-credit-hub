-- =====================================================================
-- ENDPOINT: /margen-articulos  —  reporte "Margen de Ventas por Artículos"
-- Contiene: solo el módulo ORDS `margen-articulos`. Sin paquete y sin DDL:
-- es de lectura pura. Correr como WKSP_JOSIASMUEBLES.
--
-- Migra la página 61 de la app APEX 70967. Lo usa Administración → Reportes →
-- Margen de Ventas por Artículos (/admin/reportes/margen-articulos).
--
-- UN ARCHIVO Y UN MÓDULO POR REPORTE (decisión de Jose, 2026-10-20): el
-- archivo se llama como la ruta del reporte en el menú, y el módulo igual.
-- No se juntan varios reportes en un módulo `reportes`: cada archivo arranca
-- con ORDS.DELETE_MODULE, y si dos archivos definieran el mismo módulo,
-- desplegar uno borraría los handlers del otro. (Saldos, Compras y Cheques
-- quedaron dentro de `proveedores` porque nacieron antes de esta regla.)
--
-- Handlers:
--   GET ventas   las ventas del período por artículo y plan, con su costo
--
-- Sin paquete a propósito: un GET que invoca un paquete devuelve 500 apenas
-- ese paquete queda INVALID (backend/README.md → "Los GET no llaman a
-- paquetes"). Solo llama a pkg_auth_token, como todos los del módulo
-- administrativo.
--
-- PERMISOS
-- ---------------------------------------------------------------------
-- Costos y márgenes son información sensible: cada handler valida el token Y
-- la lista de usuarios del módulo administrativo, igual que `proveedores`.
-- La lista está repetida y tiene que ser la misma en todos lados:
--   · l_admins de la sección 2.b de este archivo
--   · backend/proveedores.sql (pkg_recibos_compra.es_admin y l_admins)
--   · backend/definiciones.sql (pkg_definiciones.es_admin y l_admins)
--   · USUARIOS_ADMIN de src/lib/permisos.ts (lo que se dibuja en pantalla)
--
-- "No tenés permiso" responde 400 y NO 403: src/lib/api.ts trata 401/403 como
-- sesión vencida y manda al login.
-- =====================================================================


-- =====================================================================
-- 1. SANEAMIENTO
-- =====================================================================
-- El módulo no crea ni altera objetos. Queda el DDL que se leyó, resumido
-- (recibido de Jose el 2026-10-20):
--
--   ARTICULOS
--     COD_ARTICULO             NUMBER        PK
--     DESCRIPCION              VARCHAR2(200)
--     COD_UNIDAD_MEDIDA        VARCHAR2(5)   FK UNIDADES_MEDIDA
--     ESTADO                   VARCHAR2(1)
--     FECHA_ULTIMO_INVENTARIO  DATE
--
--   SOLICITUD_VENTAS_DETALLE
--     ID                NUMBER            FK SOLICITUD_VENTAS_CABECERA
--     ID_DETALLE        NUMBER identity   PK
--     COD_ARTICULO      NUMBER            ⚠ SIN FK a ARTICULOS
--     CANTIDAD          NUMBER
--     PRECIO_UNITARIO   NUMBER            precio a crédito: total de la
--                                         línea / cantidad (lo arma el alta
--                                         de solicitudes, con el interés)
--     UK (ID, ID_DETALLE, COD_ARTICULO)
--
--   SOLICITUD_VENTAS_CABECERA.FECHA_FACTURA  DATE
--
--   COMPRAS_DETALLE
--     ID_DETALLE        NUMBER identity   PK
--     ID_CABECERA       NUMBER            FK COMPRAS_CABECERA ON DELETE CASCADE
--     COD_ARTICULO      NUMBER            FK ARTICULOS
--     CANTIDAD          NUMBER
--     PRECIO_UNITARIO   NUMBER
--     FEC_ESTADO        DATE
--     UK (ID_CABECERA, COD_ARTICULO)
--
--   COMPRAS_CABECERA: FECHA (DATE), TIPO ('C' compra · 'S' inventario),
--   MOTIVO ('C' compra · 'E' entrada). Ver backend/proveedores.sql.


-- =====================================================================
-- 2. MÓDULO ORDS
-- =====================================================================
-- Sin paquete, así que son DOS ejecuciones separadas, nunca el archivo
-- entero de una (ORA-00060 reproducible): (1) el bloque 2.a solo · (2) el
-- 2.b solo. Detalle en backend/README.md → "Desplegar un módulo ORDS".
--
-- ⚠ ANTES DEL PRIMER DESPLIEGUE: 2.a borra cualquier módulo que se llame
-- 'margen-articulos'. Confirmar que no exista uno que no sea este:
--
--   SELECT name, uri_prefix FROM user_ords_modules ORDER BY name;
--
-- Si aparece 'margen-articulos' o un uri_prefix '/margen-articulos/' que no salió de este
-- archivo, NO correr 2.a: hay que elegir otro nombre.

-- ---------------------------------------------------------------------
-- 2.a  Borrado previo — ejecución 1 de 2. CORRER SOLO ESTO Y ESPERAR
-- ---------------------------------------------------------------------
-- Sin EXCEPTION a propósito: si el borrado falla hay que verlo.
DECLARE
  l_existe NUMBER;
BEGIN
  SELECT COUNT(*) INTO l_existe FROM user_ords_modules WHERE name = 'margen-articulos';
  IF l_existe > 0 THEN
    ORDS.DELETE_MODULE(p_module_name => 'margen-articulos');
    COMMIT;
  END IF;
END;
/

-- Tiene que dar 0 ANTES de seguir con 2.b:
--   SELECT COUNT(*) FROM user_ords_modules WHERE name = 'margen-articulos';
-- Si el bloque de arriba tardó ~13 segundos, estaba esperando un lock: ver
-- backend/README.md antes de insistir.


-- ---------------------------------------------------------------------
-- 2.b  Definición del módulo — ejecución 2 de 2. CORRER SOLO ESTO
-- ---------------------------------------------------------------------
-- El handler es plsql/block: es el único tipo que puede validar el token.
-- Arman el JSON a mano y devuelven TODAS las filas, sin paginar — no aceptan
-- ?limit/?offset ni ?page. El cliente agrupa, ordena y busca en memoria.
DECLARE

  -- Usuarios habilitados, ya escritos como lista de un IN (...). Es la misma
  -- lista que la de proveedores.sql, definiciones.sql y src/lib/permisos.ts.
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
      p_module_name    => 'margen-articulos',
      p_base_path      => '/margen-articulos/',
      p_items_per_page => 25,
      p_status         => 'PUBLISHED',
      p_comments       => NULL);


  -- ==================================================================
  -- VENTAS DEL PERÍODO   GET /margen-articulos/ventas?desde=&hasta=
  -- ==================================================================
  -- Migra la página 61 de la app APEX 70967. desde y hasta son YYYY-MM-DD,
  -- los dos incluidos y obligatorios.
  --
  -- QUÉ DEVUELVE: una fila por ARTÍCULO Y PLAN DE CUOTAS (cantidad de
  -- cuotas, monto de la cuota y entrega inicial de la solicitud), con las
  -- unidades y el total vendido en ese plan, y el costo del artículo. La
  -- pantalla junta las filas de un mismo artículo en una sola y deja los
  -- planes en el detalle desplegable. El plan es el de la SOLICITUD entera,
  -- no el del artículo: si la solicitud llevaba tres artículos, la cuota es
  -- la de los tres juntos.
  --
  -- Ganancia y porcentajes los calcula el cliente (src/lib/reporte-margen.ts)
  -- a partir de total_venta, cantidad y costo, así la pantalla y el PDF usan
  -- una sola fórmula.
  --
  -- DECISIONES DE JOSE (2026-10-20) — diferencias con APEX a propósito:
  --
  --   · Ventas: igual que APEX, SOLICITUD_VENTAS_* con ESTADO = 'APROBADA',
  --     por FECHA_FACTURA de la solicitud (no VENTAS_*).
  --
  --   · Costo: el PRECIO_UNITARIO de la ÚLTIMA COMPRA REAL del artículo
  --     (COMPRAS_CABECERA.TIPO = 'C', motivo 'C' o 'E') con fecha hasta el
  --     `hasta` del período; si hay dos el mismo día, la de ID_DETALLE mayor.
  --     APEX tomaba la última fila de COMPRAS_DETALLE de cualquier tipo y
  --     cualquier fecha: un movimiento de inventario (TIPO 'S') o una compra
  --     posterior al período cambiaban el margen de ventas ya hechas.
  --     Se descartan las filas con precio NULL o 0: no son un costo (una
  --     factura con artículos sin precio sale "Sin monto" en Recibos de
  --     Proveedores).
  --
  --   · Sin compra que cumpla eso, costo = NULL (no 0). APEX lo ponía en 0 y
  --     el artículo salía con ganancia igual a todo lo vendido. La pantalla lo
  --     marca "Sin costo" y lo deja fuera de la ganancia y del margen.
  --
  --   · El artículo 217 queda afuera, como en APEX.
  --
  --   · COD_ARTICULO del detalle no tiene FK: un código que no está en
  --     ARTICULOS sale igual (articulo NULL, el cliente pone "Artículo N").
  --     APEX lo perdía en el INNER JOIN y esa venta no se veía.
  --
  -- La fecha se compara con < hasta + 1 y no con BETWEEN: FECHA_FACTURA es
  -- DATE y puede traer hora; con BETWEEN se perdían las del último día
  -- cargadas después de la medianoche.
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'margen-articulos',
      p_pattern        => 'ventas',
      p_priority       => 0,
      p_etag_type      => 'NONE',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'margen-articulos',
      p_pattern        => 'ventas',
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

        apex_json.open_object;
        apex_json.write(''success'', TRUE);
        apex_json.open_array(''items'');

        FOR r IN (
          WITH lineas AS (
            SELECT svd.cod_articulo,
                   svc.id,
                   svc.cantidad_cuotas,
                   svc.monto_cuota,
                   svc.entrega_inicial,
                   NVL(svd.cantidad, 0)                               AS cantidad,
                   NVL(svd.cantidad, 0) * NVL(svd.precio_unitario, 0) AS total_venta
              FROM solicitud_ventas_cabecera svc
              JOIN solicitud_ventas_detalle  svd ON svd.id = svc.id
             WHERE svc.estado = ''APROBADA''
               AND svc.fecha_factura >= l_desde
               AND svc.fecha_factura <  l_hasta + 1
               AND svd.cod_articulo <> 217
          ),
          -- COSTO: última compra real hasta el fin del período (ver arriba).
          costo AS (
            SELECT cod_articulo, precio_unitario AS costo, fecha AS fecha_costo
              FROM ( SELECT d.cod_articulo, d.precio_unitario, c.fecha,
                            ROW_NUMBER() OVER (PARTITION BY d.cod_articulo
                                               ORDER BY c.fecha DESC, d.id_detalle DESC) AS rn
                       FROM compras_detalle  d
                       JOIN compras_cabecera c ON c.id_cabecera = d.id_cabecera
                      WHERE c.tipo = ''C''
                        AND c.fecha < l_hasta + 1
                        AND NVL(d.precio_unitario, 0) > 0
                        AND d.cod_articulo IN (SELECT cod_articulo FROM lineas) )
             WHERE rn = 1
          )
          SELECT l.cod_articulo,
                 a.descripcion            AS articulo,
                 l.cantidad_cuotas,
                 l.monto_cuota,
                 l.entrega_inicial,
                 COUNT(DISTINCT l.id)     AS solicitudes,
                 SUM(l.cantidad)          AS cantidad,
                 SUM(l.total_venta)       AS total_venta,
                 k.costo,
                 k.fecha_costo
            FROM lineas l
            LEFT JOIN articulos a ON a.cod_articulo = l.cod_articulo
            LEFT JOIN costo     k ON k.cod_articulo = l.cod_articulo
           GROUP BY l.cod_articulo, a.descripcion, l.cantidad_cuotas, l.monto_cuota,
                    l.entrega_inicial, k.costo, k.fecha_costo
           ORDER BY a.descripcion, l.cod_articulo, l.cantidad_cuotas, l.monto_cuota
        ) LOOP
          apex_json.open_object;
          apex_json.write(''cod_articulo'',    r.cod_articulo);
          apex_json.write(''articulo'',        r.articulo);
          apex_json.write(''cantidad_cuotas'', r.cantidad_cuotas);
          apex_json.write(''monto_cuota'',     r.monto_cuota);
          apex_json.write(''entrega_inicial'', r.entrega_inicial);
          apex_json.write(''solicitudes'',     r.solicitudes);
          apex_json.write(''cantidad'',        r.cantidad);
          apex_json.write(''total_venta'',     r.total_venta);
          -- p_write_null: sin compra, "costo": null y no la clave ausente.
          apex_json.write(''costo'',           r.costo, p_write_null => TRUE);
          apex_json.write(''fecha_costo'',     TO_CHAR(r.fecha_costo, ''YYYY-MM-DD''), p_write_null => TRUE);
          apex_json.close_object;
        END LOOP;

        apex_json.close_array;
        apex_json.close_object;
      EXCEPTION WHEN OTHERS THEN
        :status_code := 500;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_PARAMETER(p_module_name => 'margen-articulos', p_pattern => 'ventas', p_method => 'GET',
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
--    WHERE p.name = 'margen-articulos'
--    ORDER BY t.uri_template, h.method;
--
--   ventas   GET   plsql/block

-- 3.b  ¿El SELECT corre? Mismo SQL que el handler, con fechas fijas:
--
--   WITH lineas AS (
--     SELECT svd.cod_articulo, svc.id, NVL(svd.cantidad,0) cantidad,
--            NVL(svd.cantidad,0) * NVL(svd.precio_unitario,0) total_venta
--       FROM solicitud_ventas_cabecera svc
--       JOIN solicitud_ventas_detalle  svd ON svd.id = svc.id
--      WHERE svc.estado = 'APROBADA'
--        AND svc.fecha_factura >= DATE '2026-10-01'
--        AND svc.fecha_factura <  DATE '2026-10-31' + 1
--        AND svd.cod_articulo <> 217 )
--   SELECT COUNT(*), SUM(cantidad), SUM(total_venta) FROM lineas;
--
--   -> el total vendido tiene que coincidir con el "Total vendido" de la
--      pantalla para el mismo período.

-- 3.c  ¿El costo es el esperado? Para un artículo cualquiera, sus compras
--      reales de la más nueva a la más vieja; la primera es la que usa:
--
--   SELECT c.fecha, c.tipo, c.motivo, d.id_detalle, d.precio_unitario
--     FROM compras_detalle d JOIN compras_cabecera c ON c.id_cabecera = d.id_cabecera
--    WHERE d.cod_articulo = <COD> AND c.tipo = 'C' AND NVL(d.precio_unitario,0) > 0
--    ORDER BY c.fecha DESC, d.id_detalle DESC;

-- 3.d  Desde afuera, con curl (NUNCA desde el navegador: un 500 llega como
--      "error de CORS" y esconde el ORA- real):
--
--   curl -s -X POST "https://oracleapex.com/ords/josiasmuebles/auth/login" \
--        -H "Content-Type: application/json" \
--        -d '{"username":"JOSEG","password":"..."}'
--   -> copiar el "token" de la respuesta en TOKEN.
--
--   B="https://oracleapex.com/ords/josiasmuebles/margen-articulos"
--   curl -i "$B/ventas?desde=2026-10-01&hasta=2026-10-31" -H "Authorization: Bearer $TOKEN"
--     -> 200 {"success":true,"items":[...]}; un artículo sin compras trae "costo":null.
--   Sin fechas, o desde > hasta -> 400 con mensaje. Sin el header -> 401.
--   Con un usuario fuera de la lista -> 400 "no tiene habilitado el modulo administrativo".


-- =====================================================================
-- 4. ROLLBACK
-- =====================================================================
-- No toca esquema ni datos. Se deshace borrando el módulo:
--
--   BEGIN
--     ORDS.DELETE_MODULE(p_module_name => 'margen-articulos');
--     COMMIT;
--   END;
--   /
