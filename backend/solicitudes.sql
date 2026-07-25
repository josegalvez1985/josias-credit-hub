-- =====================================================================
-- ENDPOINT: /solicitudes  —  cabecera, detalle, referencias, actividad,
--                            LOVs y precios.
-- Contiene: paquete + módulo ORDS. Sin DDL (las tablas se crean aparte).
-- Correr como WKSP_JOSIASMUEBLES. Es idempotente: se puede volver a correr.
--
-- Base: export de ORDS 26.2.0 del 2026-07-24, con estos cambios:
--   * POST/PUT de referencias mandan :ind_garante.
--   * Se unieron los literales que el exportador partía en dos
--     (':s' || 'tatus_code'); es texto equivalente.
--
-- Tablas que usa: SOLICITUD_VENTAS_CABECERA, _DETALLE, _REFERENCIAS,
-- _ACTIVIDAD_LABORAL, CLIENTES, ARTICULOS, CIUDADES, VENDEDORES,
-- PROFESIONES, RELACIONES_PERSONALES y la vista V_PRECIOS_VENTAS.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. PAQUETE
-- ---------------------------------------------------------------------

CREATE OR REPLACE PACKAGE pkg_solicitud_ventas AS

  --------------------------------------------------------------- CABECERA
  FUNCTION ins_cabecera(
    p_nro_solicitud           NUMBER,
    p_fecha_factura           DATE,
    p_referencia              VARCHAR2,
    p_cod_cliente             NUMBER,
    p_cantidad_cuotas         NUMBER,
    p_total                   NUMBER,
    p_monto_cuota             NUMBER,
    p_cod_ciudad              NUMBER,
    p_cod_vendedor            NUMBER,
    p_fec_vencimiento_inicial DATE,
    p_entrega_inicial         NUMBER,
    p_porc_interes            NUMBER,
    p_estado                  VARCHAR2,
    p_cod_usuario             VARCHAR2
  ) RETURN NUMBER;

  PROCEDURE upd_cabecera(
    p_id                      NUMBER,
    p_nro_solicitud           NUMBER,
    p_fecha_factura           DATE,
    p_referencia              VARCHAR2,
    p_cod_cliente             NUMBER,
    p_cantidad_cuotas         NUMBER,
    p_total                   NUMBER,
    p_monto_cuota             NUMBER,
    p_cod_ciudad              NUMBER,
    p_cod_vendedor            NUMBER,
    p_fec_vencimiento_inicial DATE,
    p_entrega_inicial         NUMBER,
    p_porc_interes            NUMBER,
    p_estado                  VARCHAR2,
    p_cod_usuario             VARCHAR2
  );

  -- Borra la solicitud y todos sus hijos (detalle, referencias, actividad).
  PROCEDURE del_cabecera(p_id NUMBER);

  --------------------------------------------------------------- DETALLE
  FUNCTION ins_detalle(
    p_id              NUMBER,
    p_cod_articulo    NUMBER,
    p_cantidad        NUMBER,
    p_precio_unitario NUMBER
  ) RETURN NUMBER;

  PROCEDURE upd_detalle(
    p_id_detalle      NUMBER,
    p_cod_articulo    NUMBER,
    p_cantidad        NUMBER,
    p_precio_unitario NUMBER
  );

  PROCEDURE del_detalle(p_id_detalle NUMBER);

  --------------------------------------------------------------- REFERENCIAS
  -- p_ind_garante: 'S' si la referencia además es garante. Default 'N' para no
  -- romper llamadas viejas que no mandan el campo.
  FUNCTION ins_referencia(
    p_id              NUMBER,
    p_relacion        VARCHAR2,
    p_telefono        VARCHAR2,
    p_nombre_apellido VARCHAR2,
    p_ind_garante     VARCHAR2 DEFAULT 'N'
  ) RETURN NUMBER;

  PROCEDURE upd_referencia(
    p_id_detalle      NUMBER,
    p_relacion        VARCHAR2,
    p_telefono        VARCHAR2,
    p_nombre_apellido VARCHAR2,
    p_ind_garante     VARCHAR2 DEFAULT 'N'
  );

  PROCEDURE del_referencia(p_id_detalle NUMBER);

  --------------------------------------------------------------- ACTIVIDAD LABORAL
  FUNCTION ins_actividad(
    p_id                 NUMBER,
    p_es_empleado        VARCHAR2,
    p_nombre_empresa     VARCHAR2,
    p_direccion          VARCHAR2,
    p_puesto_ocupado     VARCHAR2,
    p_ingresos_mensuales NUMBER,
    p_otros_ingresos     NUMBER,
    p_antiguedad         VARCHAR2,
    p_telefono           VARCHAR2,
    p_cod_profesion      NUMBER,
    p_cod_ciudad         NUMBER,
    p_aporta_ips         VARCHAR2
  ) RETURN NUMBER;

  PROCEDURE upd_actividad(
    p_id_detalle         NUMBER,
    p_es_empleado        VARCHAR2,
    p_nombre_empresa     VARCHAR2,
    p_direccion          VARCHAR2,
    p_puesto_ocupado     VARCHAR2,
    p_ingresos_mensuales NUMBER,
    p_otros_ingresos     NUMBER,
    p_antiguedad         VARCHAR2,
    p_telefono           VARCHAR2,
    p_cod_profesion      NUMBER,
    p_cod_ciudad         NUMBER,
    p_aporta_ips         VARCHAR2
  );

  PROCEDURE del_actividad(p_id_detalle NUMBER);

END pkg_solicitud_ventas;
/

CREATE OR REPLACE PACKAGE BODY pkg_solicitud_ventas AS

  --------------------------------------------------------------- CABECERA
  FUNCTION ins_cabecera(
    p_nro_solicitud           NUMBER,
    p_fecha_factura           DATE,
    p_referencia              VARCHAR2,
    p_cod_cliente             NUMBER,
    p_cantidad_cuotas         NUMBER,
    p_total                   NUMBER,
    p_monto_cuota             NUMBER,
    p_cod_ciudad              NUMBER,
    p_cod_vendedor            NUMBER,
    p_fec_vencimiento_inicial DATE,
    p_entrega_inicial         NUMBER,
    p_porc_interes            NUMBER,
    p_estado                  VARCHAR2,
    p_cod_usuario             VARCHAR2
  ) RETURN NUMBER IS
    l_id NUMBER;
  BEGIN
    INSERT INTO solicitud_ventas_cabecera (
      nro_solicitud, fecha_factura, referencia, cod_cliente, cantidad_cuotas,
      total, monto_cuota, cod_ciudad, cod_vendedor, fec_vencimiento_inicial,
      entrega_inicial, porc_interes, estado, cod_usuario
    ) VALUES (
      p_nro_solicitud, p_fecha_factura, p_referencia, p_cod_cliente, p_cantidad_cuotas,
      p_total, p_monto_cuota, p_cod_ciudad, p_cod_vendedor, p_fec_vencimiento_inicial,
      p_entrega_inicial, p_porc_interes, p_estado, p_cod_usuario
    ) RETURNING id INTO l_id;
    COMMIT;
    RETURN l_id;
  END ins_cabecera;

  PROCEDURE upd_cabecera(
    p_id                      NUMBER,
    p_nro_solicitud           NUMBER,
    p_fecha_factura           DATE,
    p_referencia              VARCHAR2,
    p_cod_cliente             NUMBER,
    p_cantidad_cuotas         NUMBER,
    p_total                   NUMBER,
    p_monto_cuota             NUMBER,
    p_cod_ciudad              NUMBER,
    p_cod_vendedor            NUMBER,
    p_fec_vencimiento_inicial DATE,
    p_entrega_inicial         NUMBER,
    p_porc_interes            NUMBER,
    p_estado                  VARCHAR2,
    p_cod_usuario             VARCHAR2
  ) IS
  BEGIN
    UPDATE solicitud_ventas_cabecera SET
      nro_solicitud           = p_nro_solicitud,
      fecha_factura           = p_fecha_factura,
      referencia              = p_referencia,
      cod_cliente             = p_cod_cliente,
      cantidad_cuotas         = p_cantidad_cuotas,
      total                   = p_total,
      monto_cuota             = p_monto_cuota,
      cod_ciudad              = p_cod_ciudad,
      cod_vendedor            = p_cod_vendedor,
      fec_vencimiento_inicial = p_fec_vencimiento_inicial,
      entrega_inicial         = p_entrega_inicial,
      porc_interes            = p_porc_interes,
      estado                  = p_estado,
      cod_usuario             = p_cod_usuario
    WHERE id = p_id;
    COMMIT;
  END upd_cabecera;

  PROCEDURE del_cabecera(p_id NUMBER) IS
  BEGIN
    DELETE FROM solicitud_ventas_detalle           WHERE id = p_id;
    DELETE FROM solicitud_ventas_referencias       WHERE id = p_id;
    DELETE FROM solicitud_ventas_actividad_laboral WHERE id = p_id;
    DELETE FROM solicitud_ventas_cabecera          WHERE id = p_id;
    COMMIT;
  END del_cabecera;

  --------------------------------------------------------------- DETALLE
  FUNCTION ins_detalle(
    p_id              NUMBER,
    p_cod_articulo    NUMBER,
    p_cantidad        NUMBER,
    p_precio_unitario NUMBER
  ) RETURN NUMBER IS
    l_id_detalle NUMBER;
  BEGIN
    INSERT INTO solicitud_ventas_detalle (id, cod_articulo, cantidad, precio_unitario)
    VALUES (p_id, p_cod_articulo, p_cantidad, p_precio_unitario)
    RETURNING id_detalle INTO l_id_detalle;
    COMMIT;
    RETURN l_id_detalle;
  END ins_detalle;

  PROCEDURE upd_detalle(
    p_id_detalle      NUMBER,
    p_cod_articulo    NUMBER,
    p_cantidad        NUMBER,
    p_precio_unitario NUMBER
  ) IS
  BEGIN
    UPDATE solicitud_ventas_detalle SET
      cod_articulo    = p_cod_articulo,
      cantidad        = p_cantidad,
      precio_unitario = p_precio_unitario
    WHERE id_detalle = p_id_detalle;
    COMMIT;
  END upd_detalle;

  PROCEDURE del_detalle(p_id_detalle NUMBER) IS
  BEGIN
    DELETE FROM solicitud_ventas_detalle WHERE id_detalle = p_id_detalle;
    COMMIT;
  END del_detalle;

  --------------------------------------------------------------- REFERENCIAS
  -- IND_GARANTE es NOT NULL con CHECK IN ('S','N'): normalizamos acá para que un
  -- NULL o un valor raro del cliente no tire ORA-01400 / ORA-02290.
  FUNCTION norm_garante(p_valor VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN CASE WHEN UPPER(TRIM(p_valor)) = 'S' THEN 'S' ELSE 'N' END;
  END norm_garante;

  FUNCTION ins_referencia(
    p_id              NUMBER,
    p_relacion        VARCHAR2,
    p_telefono        VARCHAR2,
    p_nombre_apellido VARCHAR2,
    p_ind_garante     VARCHAR2 DEFAULT 'N'
  ) RETURN NUMBER IS
    l_id_detalle NUMBER;
    -- norm_garante es privada del body: no se puede llamar dentro del SQL
    -- (PLS-00231), así que se resuelve antes en una variable.
    l_garante    VARCHAR2(1) := norm_garante(p_ind_garante);
  BEGIN
    INSERT INTO solicitud_ventas_referencias (id, relacion, telefono, nombre_apellido, ind_garante)
    VALUES (p_id, p_relacion, p_telefono, p_nombre_apellido, l_garante)
    RETURNING id_detalle INTO l_id_detalle;
    COMMIT;
    RETURN l_id_detalle;
  END ins_referencia;

  PROCEDURE upd_referencia(
    p_id_detalle      NUMBER,
    p_relacion        VARCHAR2,
    p_telefono        VARCHAR2,
    p_nombre_apellido VARCHAR2,
    p_ind_garante     VARCHAR2 DEFAULT 'N'
  ) IS
    l_garante VARCHAR2(1) := norm_garante(p_ind_garante);
  BEGIN
    UPDATE solicitud_ventas_referencias SET
      relacion        = p_relacion,
      telefono        = p_telefono,
      nombre_apellido = p_nombre_apellido,
      ind_garante     = l_garante
    WHERE id_detalle = p_id_detalle;
    COMMIT;
  END upd_referencia;

  PROCEDURE del_referencia(p_id_detalle NUMBER) IS
  BEGIN
    DELETE FROM solicitud_ventas_referencias WHERE id_detalle = p_id_detalle;
    COMMIT;
  END del_referencia;

  --------------------------------------------------------------- ACTIVIDAD LABORAL
  FUNCTION ins_actividad(
    p_id                 NUMBER,
    p_es_empleado        VARCHAR2,
    p_nombre_empresa     VARCHAR2,
    p_direccion          VARCHAR2,
    p_puesto_ocupado     VARCHAR2,
    p_ingresos_mensuales NUMBER,
    p_otros_ingresos     NUMBER,
    p_antiguedad         VARCHAR2,
    p_telefono           VARCHAR2,
    p_cod_profesion      NUMBER,
    p_cod_ciudad         NUMBER,
    p_aporta_ips         VARCHAR2
  ) RETURN NUMBER IS
    l_id_detalle NUMBER;
  BEGIN
    INSERT INTO solicitud_ventas_actividad_laboral (
      id, es_empleado, nombre_empresa, direccion, puesto_ocupado,
      ingresos_mensuales, otros_ingresos, antiguedad, telefono,
      cod_profesion, cod_ciudad, aporta_ips
    ) VALUES (
      p_id, p_es_empleado, p_nombre_empresa, p_direccion, p_puesto_ocupado,
      p_ingresos_mensuales, p_otros_ingresos, p_antiguedad, p_telefono,
      p_cod_profesion, p_cod_ciudad, p_aporta_ips
    ) RETURNING id_detalle INTO l_id_detalle;
    COMMIT;
    RETURN l_id_detalle;
  END ins_actividad;

  PROCEDURE upd_actividad(
    p_id_detalle         NUMBER,
    p_es_empleado        VARCHAR2,
    p_nombre_empresa     VARCHAR2,
    p_direccion          VARCHAR2,
    p_puesto_ocupado     VARCHAR2,
    p_ingresos_mensuales NUMBER,
    p_otros_ingresos     NUMBER,
    p_antiguedad         VARCHAR2,
    p_telefono           VARCHAR2,
    p_cod_profesion      NUMBER,
    p_cod_ciudad         NUMBER,
    p_aporta_ips         VARCHAR2
  ) IS
  BEGIN
    UPDATE solicitud_ventas_actividad_laboral SET
      es_empleado        = p_es_empleado,
      nombre_empresa     = p_nombre_empresa,
      direccion          = p_direccion,
      puesto_ocupado     = p_puesto_ocupado,
      ingresos_mensuales = p_ingresos_mensuales,
      otros_ingresos     = p_otros_ingresos,
      antiguedad         = p_antiguedad,
      telefono           = p_telefono,
      cod_profesion      = p_cod_profesion,
      cod_ciudad         = p_cod_ciudad,
      aporta_ips         = p_aporta_ips
    WHERE id_detalle = p_id_detalle;
    COMMIT;
  END upd_actividad;

  PROCEDURE del_actividad(p_id_detalle NUMBER) IS
  BEGIN
    DELETE FROM solicitud_ventas_actividad_laboral WHERE id_detalle = p_id_detalle;
    COMMIT;
  END del_actividad;

END pkg_solicitud_ventas;
/


-- ---------------------------------------------------------------------
-- 2. MÓDULO ORDS  (idempotente: redefine el módulo completo)
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

  ORDS.DEFINE_MODULE(
      p_module_name    => 'solicitudes',
      p_base_path      => '/solicitudes/',
      p_items_per_page => 25,
      p_status         => 'PUBLISHED',
      p_comments       => NULL);

  ---------------------------------------------------------------- CABECERA
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'solicitudes',
      p_pattern        => 'cabecera',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'solicitudes',
      p_pattern        => 'cabecera',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'      SELECT c.id, c.nro_solicitud, c.fecha_factura, c.referencia,
             c.cod_cliente, cl.razon_social AS cliente,
             c.cantidad_cuotas, c.total, c.monto_cuota,
             c.cod_ciudad, ci.descripcion AS ciudad,
             c.cod_vendedor, v.nombre AS vendedor,
             c.fec_vencimiento_inicial, c.entrega_inicial, c.porc_interes,
             c.estado,
             c.cod_usuario
      FROM   solicitud_ventas_cabecera c
      LEFT JOIN clientes   cl ON cl.cod_cliente  = c.cod_cliente
      LEFT JOIN ciudades   ci ON ci.cod_ciudad   = c.cod_ciudad
      LEFT JOIN vendedores v  ON v.cod_vendedor  = c.cod_vendedor
      ORDER BY c.id DESC
    ');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'solicitudes',
      p_pattern        => 'cabecera',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'DECLARE l_id NUMBER;
BEGIN
  l_id := pkg_solicitud_ventas.ins_cabecera(
    p_nro_solicitud           => :nro_solicitud,
    p_fecha_factura           => TO_DATE(:fecha_factura,''YYYY-MM-DD''),
    p_referencia              => :referencia,
    p_cod_cliente             => :cod_cliente,
    p_cantidad_cuotas         => :cantidad_cuotas,
    p_total                   => :total,
    p_monto_cuota             => :monto_cuota,
    p_cod_ciudad              => :cod_ciudad,
    p_cod_vendedor            => :cod_vendedor,
    p_fec_vencimiento_inicial => TO_DATE(:fec_vencimiento_inicial,''YYYY-MM-DD''),
    p_entrega_inicial         => :entrega_inicial,
    p_porc_interes            => :porc_interes,
    p_estado                  => NVL(:estado,''PENDIENTE''),
    p_cod_usuario             => :cod_usuario);
  :status_code := 201;
  htp.p(''{"success": true, "id": '' || l_id ||
        '', "cod_usuario": '' || apex_json.stringify(:cod_usuario) || ''}'');
EXCEPTION WHEN OTHERS THEN
  :status_code := 400;
  htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
END;');

  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'solicitudes',
      p_pattern        => 'cabecera/:id',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'solicitudes',
      p_pattern        => 'cabecera/:id',
      p_method         => 'GET',
      p_source_type    => 'json/query;type=single',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'      SELECT c.id, c.nro_solicitud, c.fecha_factura, c.referencia,
             c.cod_cliente, cl.razon_social AS cliente,
             c.cantidad_cuotas, c.total, c.monto_cuota,
             c.cod_ciudad, ci.descripcion AS ciudad,
             c.cod_vendedor, v.nombre AS vendedor,
             c.fec_vencimiento_inicial, c.entrega_inicial, c.porc_interes,
             c.estado,
             c.cod_usuario
      FROM   solicitud_ventas_cabecera c
      LEFT JOIN clientes   cl ON cl.cod_cliente  = c.cod_cliente
      LEFT JOIN ciudades   ci ON ci.cod_ciudad   = c.cod_ciudad
      LEFT JOIN vendedores v  ON v.cod_vendedor  = c.cod_vendedor
      WHERE  c.id = :id
    ');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'solicitudes',
      p_pattern        => 'cabecera/:id',
      p_method         => 'PUT',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'BEGIN
  pkg_solicitud_ventas.upd_cabecera(
    p_id                      => :id,
    p_nro_solicitud           => :nro_solicitud,
    p_fecha_factura           => TO_DATE(:fecha_factura,''YYYY-MM-DD''),
    p_referencia              => :referencia,
    p_cod_cliente             => :cod_cliente,
    p_cantidad_cuotas         => :cantidad_cuotas,
    p_total                   => :total,
    p_monto_cuota             => :monto_cuota,
    p_cod_ciudad              => :cod_ciudad,
    p_cod_vendedor            => :cod_vendedor,
    p_fec_vencimiento_inicial => TO_DATE(:fec_vencimiento_inicial,''YYYY-MM-DD''),
    p_entrega_inicial         => :entrega_inicial,
    p_porc_interes            => :porc_interes,
    p_estado                  => :estado,
    p_cod_usuario             => :cod_usuario);
  :status_code := 200;
  htp.p(''{"success": true}'');
EXCEPTION WHEN OTHERS THEN
  :status_code := 400;
  htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
END;');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'solicitudes',
      p_pattern        => 'cabecera/:id',
      p_method         => 'DELETE',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      BEGIN
        pkg_solicitud_ventas.del_cabecera(:id);
        :status_code := 200;
        htp.p(''{"success": true}'');
      EXCEPTION WHEN OTHERS THEN
        :status_code := 400;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ---------------------------------------------------------------- DETALLE
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'solicitudes',
      p_pattern        => 'detalle/:id',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'solicitudes',
      p_pattern        => 'detalle/:id',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      SELECT d.id_detalle, d.id, d.cod_articulo, a.descripcion AS articulo,
             d.cantidad, d.precio_unitario,
             d.cantidad * d.precio_unitario AS subtotal
      FROM   solicitud_ventas_detalle d
      LEFT JOIN articulos a ON a.cod_articulo = d.cod_articulo
      WHERE  d.id = :id
      ORDER BY d.id_detalle
    ');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'solicitudes',
      p_pattern        => 'detalle/:id',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      DECLARE l_idd NUMBER;
      BEGIN
        l_idd := pkg_solicitud_ventas.ins_detalle(
          p_id => :id, p_cod_articulo => :cod_articulo,
          p_cantidad => :cantidad, p_precio_unitario => :precio_unitario);
        :status_code := 201;
        htp.p(''{"success": true, "id_detalle": '' || l_idd || ''}'');
      EXCEPTION WHEN OTHERS THEN
        :status_code := 400;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'solicitudes',
      p_pattern        => 'detalle/item/:id_detalle',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'solicitudes',
      p_pattern        => 'detalle/item/:id_detalle',
      p_method         => 'PUT',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      BEGIN
        pkg_solicitud_ventas.upd_detalle(
          p_id_detalle => :id_detalle, p_cod_articulo => :cod_articulo,
          p_cantidad => :cantidad, p_precio_unitario => :precio_unitario);
        :status_code := 200;
        htp.p(''{"success": true}'');
      EXCEPTION WHEN OTHERS THEN
        :status_code := 400;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'solicitudes',
      p_pattern        => 'detalle/item/:id_detalle',
      p_method         => 'DELETE',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      BEGIN
        pkg_solicitud_ventas.del_detalle(:id_detalle);
        :status_code := 200;
        htp.p(''{"success": true}'');
      EXCEPTION WHEN OTHERS THEN
        :status_code := 400;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ---------------------------------------------------------------- REFERENCIAS
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'solicitudes',
      p_pattern        => 'referencias/:id',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  -- SELECT * ya incluye IND_GARANTE; el frontend lo lee como ind_garante.
  ORDS.DEFINE_HANDLER(
      p_module_name    => 'solicitudes',
      p_pattern        => 'referencias/:id',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'SELECT * FROM solicitud_ventas_referencias WHERE id = :id ORDER BY id_detalle');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'solicitudes',
      p_pattern        => 'referencias/:id',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      DECLARE l_idd NUMBER;
      BEGIN
        l_idd := pkg_solicitud_ventas.ins_referencia(
          p_id => :id, p_relacion => :relacion,
          p_telefono => :telefono, p_nombre_apellido => :nombre_apellido,
          p_ind_garante => :ind_garante);
        :status_code := 201;
        htp.p(''{"success": true, "id_detalle": '' || l_idd || ''}'');
      EXCEPTION WHEN OTHERS THEN
        :status_code := 400;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'solicitudes',
      p_pattern        => 'referencias/item/:id_detalle',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'solicitudes',
      p_pattern        => 'referencias/item/:id_detalle',
      p_method         => 'PUT',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      BEGIN
        pkg_solicitud_ventas.upd_referencia(
          p_id_detalle => :id_detalle, p_relacion => :relacion,
          p_telefono => :telefono, p_nombre_apellido => :nombre_apellido,
          p_ind_garante => :ind_garante);
        :status_code := 200;
        htp.p(''{"success": true}'');
      EXCEPTION WHEN OTHERS THEN
        :status_code := 400;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'solicitudes',
      p_pattern        => 'referencias/item/:id_detalle',
      p_method         => 'DELETE',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      BEGIN
        pkg_solicitud_ventas.del_referencia(:id_detalle);
        :status_code := 200;
        htp.p(''{"success": true}'');
      EXCEPTION WHEN OTHERS THEN
        :status_code := 400;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ---------------------------------------------------------------- ACTIVIDAD LABORAL
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'solicitudes',
      p_pattern        => 'actividad/:id',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'solicitudes',
      p_pattern        => 'actividad/:id',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      SELECT al.id_detalle, al.id, al.es_empleado, al.nombre_empresa,
             al.direccion, al.puesto_ocupado, al.ingresos_mensuales,
             al.otros_ingresos, al.antiguedad, al.telefono,
             al.cod_profesion, p.descripcion AS profesion,
             al.cod_ciudad, ci.descripcion AS ciudad,
             al.aporta_ips
      FROM   solicitud_ventas_actividad_laboral al
      LEFT JOIN profesiones p  ON p.cod_profesion = al.cod_profesion
      LEFT JOIN ciudades    ci ON ci.cod_ciudad   = al.cod_ciudad
      WHERE  al.id = :id
      ORDER BY al.id_detalle
    ');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'solicitudes',
      p_pattern        => 'actividad/:id',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      DECLARE l_idd NUMBER;
      BEGIN
        l_idd := pkg_solicitud_ventas.ins_actividad(
          p_id => :id, p_es_empleado => :es_empleado, p_nombre_empresa => :nombre_empresa,
          p_direccion => :direccion, p_puesto_ocupado => :puesto_ocupado,
          p_ingresos_mensuales => :ingresos_mensuales, p_otros_ingresos => :otros_ingresos,
          p_antiguedad => :antiguedad, p_telefono => :telefono,
          p_cod_profesion => :cod_profesion, p_cod_ciudad => :cod_ciudad,
          p_aporta_ips => :aporta_ips);
        :status_code := 201;
        htp.p(''{"success": true, "id_detalle": '' || l_idd || ''}'');
      EXCEPTION WHEN OTHERS THEN
        :status_code := 400;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'solicitudes',
      p_pattern        => 'actividad/item/:id_detalle',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'solicitudes',
      p_pattern        => 'actividad/item/:id_detalle',
      p_method         => 'PUT',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      BEGIN
        pkg_solicitud_ventas.upd_actividad(
          p_id_detalle => :id_detalle, p_es_empleado => :es_empleado,
          p_nombre_empresa => :nombre_empresa, p_direccion => :direccion,
          p_puesto_ocupado => :puesto_ocupado, p_ingresos_mensuales => :ingresos_mensuales,
          p_otros_ingresos => :otros_ingresos, p_antiguedad => :antiguedad,
          p_telefono => :telefono, p_cod_profesion => :cod_profesion,
          p_cod_ciudad => :cod_ciudad, p_aporta_ips => :aporta_ips);
        :status_code := 200;
        htp.p(''{"success": true}'');
      EXCEPTION WHEN OTHERS THEN
        :status_code := 400;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'solicitudes',
      p_pattern        => 'actividad/item/:id_detalle',
      p_method         => 'DELETE',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      BEGIN
        pkg_solicitud_ventas.del_actividad(:id_detalle);
        :status_code := 200;
        htp.p(''{"success": true}'');
      EXCEPTION WHEN OTHERS THEN
        :status_code := 400;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ---------------------------------------------------------------- LOVs
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'solicitudes',
      p_pattern        => 'lov/clientes',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'solicitudes',
      p_pattern        => 'lov/clientes',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'      SELECT cod_cliente AS value,
             razon_social AS label,
             nombre_fantasia,
             ci,
             ruc
      FROM   clientes
      WHERE   nvl(estado,''A'') = ''A''
      ORDER BY razon_social
    ');

  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'solicitudes',
      p_pattern        => 'lov/ciudades',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'solicitudes',
      p_pattern        => 'lov/ciudades',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'      SELECT cod_ciudad AS value, descripcion AS label
      FROM   ciudades
      ORDER BY descripcion
    ');

  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'solicitudes',
      p_pattern        => 'lov/vendedores',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'solicitudes',
      p_pattern        => 'lov/vendedores',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'      SELECT cod_vendedor AS value, nombre AS label
      FROM   vendedores
      ORDER BY nombre
    ');

  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'solicitudes',
      p_pattern        => 'lov/articulos',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'solicitudes',
      p_pattern        => 'lov/articulos',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'      SELECT cod_articulo AS value,
             descripcion  AS label,
             cod_unidad_medida
      FROM   articulos
      WHERE  NVL(estado,''A'') = ''A''
      ORDER BY descripcion
    ');

  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'solicitudes',
      p_pattern        => 'lov/profesiones',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'solicitudes',
      p_pattern        => 'lov/profesiones',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'      SELECT cod_profesion AS value, descripcion AS label
      FROM   profesiones
      ORDER BY descripcion
    ');

  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'solicitudes',
      p_pattern        => 'lov/relaciones',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'solicitudes',
      p_pattern        => 'lov/relaciones',
      p_method         => 'GET',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      DECLARE
        l_token VARCHAR2(64);
        l_user  VARCHAR2(255);
      BEGIN
        -- Validar token
        l_token := REPLACE(:authorization, ''Bearer '', '''');
        l_user  := pkg_auth_token.validar_token(l_token);

        IF l_user IS NULL THEN
          :status_code := 401;
          htp.p(''{"success": false, "message": "Token invalido o expirado"}'');
          RETURN;
        END IF;

        -- Devolver el LOV
        apex_json.open_object;
        apex_json.write(''success'', TRUE);
        apex_json.open_array(''items'');
        FOR r IN (
          SELECT cod_relacion, descripcion
          FROM   relaciones_personales
          WHERE  (:q IS NULL OR UPPER(descripcion) LIKE ''%''||UPPER(:q)||''%'')
          ORDER  BY descripcion ASC
        ) LOOP
          apex_json.open_object;
          apex_json.write(''value'', r.cod_relacion);
          apex_json.write(''label'', r.descripcion);
          apex_json.close_object;
        END LOOP;
        apex_json.close_array;
        apex_json.close_object;
      EXCEPTION WHEN OTHERS THEN
        :status_code := 500;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_PARAMETER(
      p_module_name        => 'solicitudes',
      p_pattern            => 'lov/relaciones',
      p_method             => 'GET',
      p_name               => 'authorization',
      p_bind_variable_name => 'authorization',
      p_source_type        => 'HEADER',
      p_param_type         => 'STRING',
      p_access_method      => 'IN',
      p_comments           => NULL);

  ---------------------------------------------------------------- PRECIOS
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'solicitudes',
      p_pattern        => 'precios',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'solicitudes',
      p_pattern        => 'precios',
      p_method         => 'GET',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      DECLARE
        l_token VARCHAR2(64);
        l_user  VARCHAR2(255);
      BEGIN
        -- 1) Validar token del header Authorization
        l_token := REPLACE(:authorization, ''Bearer '', '''');
        l_user  := pkg_auth_token.validar_token(l_token);

        IF l_user IS NULL THEN
          :status_code := 401;
          htp.p(''{"success": false, "message": "Token invalido o expirado"}'');
          RETURN;
        END IF;

        -- 2) Devolver la vista en JSON
        apex_json.open_object;
        apex_json.write(''success'', TRUE);
        apex_json.open_array(''items'');
        FOR r IN (
          SELECT cod_articulo, nombre_articulo, precio_unitario,
                 id_lista_precio, lista_precio, cantidad_cuotas,
                 porcentaje, precio_con_recargo, valor_cuota
          FROM   v_precios_ventas
          WHERE  (:cod_articulo   IS NULL OR cod_articulo   = :cod_articulo)
          AND    (:id_lista_precio IS NULL OR id_lista_precio = :id_lista_precio)
        ) LOOP
          apex_json.open_object;
          apex_json.write(''cod_articulo'',       r.cod_articulo);
          apex_json.write(''nombre_articulo'',    r.nombre_articulo);
          apex_json.write(''precio_unitario'',    r.precio_unitario);
          apex_json.write(''id_lista_precio'',    r.id_lista_precio);
          apex_json.write(''lista_precio'',       r.lista_precio);
          apex_json.write(''cantidad_cuotas'',    r.cantidad_cuotas);
          apex_json.write(''porcentaje'',         r.porcentaje);
          apex_json.write(''precio_con_recargo'', r.precio_con_recargo);
          apex_json.write(''valor_cuota'',        r.valor_cuota);
          apex_json.close_object;
        END LOOP;
        apex_json.close_array;
        apex_json.close_object;
      EXCEPTION WHEN OTHERS THEN
        :status_code := 500;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_PARAMETER(
      p_module_name        => 'solicitudes',
      p_pattern            => 'precios',
      p_method             => 'GET',
      p_name               => 'authorization',
      p_bind_variable_name => 'authorization',
      p_source_type        => 'HEADER',
      p_param_type         => 'STRING',
      p_access_method      => 'IN',
      p_comments           => NULL);

COMMIT;
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    RAISE;

END;
/
