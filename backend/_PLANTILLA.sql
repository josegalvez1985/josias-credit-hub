-- =====================================================================
-- ENDPOINT: /<modulo>  —  <qué resuelve>
-- Contiene: paquete + módulo ORDS. Sin DDL (las tablas se crean aparte).
-- Correr como WKSP_JOSIASMUEBLES. Es idempotente: se puede volver a correr.
--
-- Tablas que usa: <TABLA_1>, <TABLA_2>.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. PAQUETE
-- ---------------------------------------------------------------------
CREATE OR REPLACE PACKAGE pkg_<modulo> AS

  FUNCTION ins_<entidad>(
    p_campo_txt  VARCHAR2,
    p_campo_num  NUMBER
  ) RETURN NUMBER;

  PROCEDURE upd_<entidad>(
    p_id         NUMBER,
    p_campo_txt  VARCHAR2,
    p_campo_num  NUMBER
  );

  PROCEDURE del_<entidad>(p_id NUMBER);

END pkg_<modulo>;
/

CREATE OR REPLACE PACKAGE BODY pkg_<modulo> AS

  FUNCTION ins_<entidad>(
    p_campo_txt  VARCHAR2,
    p_campo_num  NUMBER
  ) RETURN NUMBER IS
    l_id NUMBER;
    -- OJO: si normalizás un valor con una función privada del body, resolvela
    -- ANTES en una variable. Llamarla dentro del INSERT/UPDATE da PLS-00231.
  BEGIN
    INSERT INTO <tabla> (campo_txt, campo_num)
    VALUES (p_campo_txt, p_campo_num)
    RETURNING id INTO l_id;
    COMMIT;
    RETURN l_id;
  END ins_<entidad>;

  PROCEDURE upd_<entidad>(
    p_id         NUMBER,
    p_campo_txt  VARCHAR2,
    p_campo_num  NUMBER
  ) IS
  BEGIN
    UPDATE <tabla> SET
      campo_txt = p_campo_txt,
      campo_num = p_campo_num
    WHERE id = p_id;
    COMMIT;
  END upd_<entidad>;

  PROCEDURE del_<entidad>(p_id NUMBER) IS
  BEGIN
    DELETE FROM <tabla> WHERE id = p_id;
    COMMIT;
  END del_<entidad>;

END pkg_<modulo>;
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
      p_module_name    => '<modulo>',
      p_base_path      => '/<modulo>/',
      p_items_per_page => 25,
      p_status         => 'PUBLISHED',
      p_comments       => NULL);

  ---------------------------------------------------------------- LISTADO
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => '<modulo>',
      p_pattern        => '<entidad>',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  -- json/collection: ORDS arma solo el {"items":[...],"hasMore":...}.
  -- El cliente pagina con limit=500&offset=N (ver src/lib/api.ts).
  ORDS.DEFINE_HANDLER(
      p_module_name    => '<modulo>',
      p_pattern        => '<entidad>',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'      SELECT id, campo_txt, campo_num
      FROM   <tabla>
      ORDER BY id DESC
    ');

  ORDS.DEFINE_HANDLER(
      p_module_name    => '<modulo>',
      p_pattern        => '<entidad>',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      DECLARE l_id NUMBER;
      BEGIN
        l_id := pkg_<modulo>.ins_<entidad>(
          p_campo_txt => :campo_txt,
          p_campo_num => :campo_num);
        :status_code := 201;
        htp.p(''{"success": true, "id": '' || l_id || ''}'');
      EXCEPTION WHEN OTHERS THEN
        :status_code := 400;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ---------------------------------------------------------------- ITEM
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => '<modulo>',
      p_pattern        => '<entidad>/:id',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => '<modulo>',
      p_pattern        => '<entidad>/:id',
      p_method         => 'GET',
      p_source_type    => 'json/query;type=single',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'      SELECT id, campo_txt, campo_num
      FROM   <tabla>
      WHERE  id = :id
    ');

  ORDS.DEFINE_HANDLER(
      p_module_name    => '<modulo>',
      p_pattern        => '<entidad>/:id',
      p_method         => 'PUT',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      BEGIN
        pkg_<modulo>.upd_<entidad>(
          p_id        => :id,
          p_campo_txt => :campo_txt,
          p_campo_num => :campo_num);
        :status_code := 200;
        htp.p(''{"success": true}'');
      EXCEPTION WHEN OTHERS THEN
        :status_code := 400;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_HANDLER(
      p_module_name    => '<modulo>',
      p_pattern        => '<entidad>/:id',
      p_method         => 'DELETE',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      BEGIN
        pkg_<modulo>.del_<entidad>(:id);
        :status_code := 200;
        htp.p(''{"success": true}'');
      EXCEPTION WHEN OTHERS THEN
        :status_code := 400;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ---------------------------------------------------------------- CON TOKEN
  -- Cuando el handler tiene que validar la sesión: plsql/block + el
  -- DEFINE_PARAMETER de tipo HEADER de más abajo (sin él, :authorization llega NULL).
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => '<modulo>',
      p_pattern        => '<entidad>/privado',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => '<modulo>',
      p_pattern        => '<entidad>/privado',
      p_method         => 'GET',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      DECLARE
        l_user VARCHAR2(255);
      BEGIN
        l_user := pkg_auth_token.usuario_de_header(:authorization);

        IF l_user IS NULL THEN
          :status_code := 401;
          htp.p(''{"success": false, "message": "Token invalido o expirado"}'');
          RETURN;
        END IF;

        apex_json.open_object;
        apex_json.write(''success'', TRUE);
        apex_json.open_array(''items'');
        FOR r IN (
          SELECT id, campo_txt
          FROM   <tabla>
          WHERE  UPPER(cod_usuario) = l_user
        ) LOOP
          apex_json.open_object;
          apex_json.write(''id'',        r.id);
          apex_json.write(''campo_txt'', r.campo_txt);
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
      p_module_name        => '<modulo>',
      p_pattern            => '<entidad>/privado',
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
