-- =====================================================================
-- ENDPOINT: /auth  —  POST /auth/login
-- Contiene: paquete + módulo ORDS. Sin DDL (las tablas se crean aparte).
-- Correr como WKSP_JOSIASMUEBLES. Es idempotente: se puede volver a correr.
--
-- Contrato que espera src/lib/auth.tsx:
--   200 {"success":true,"token":"...","username":"JPEREZ"}
--   401 {"success":false,"message":"Credenciales invalidas"}
--
-- Tablas que usa: AUTH_TOKENS (token, username, fecha_emision, fecha_expira).
-- Permiso necesario: GRANT EXECUTE ON DBMS_CRYPTO TO WKSP_JOSIASMUEBLES;
-- Ver GUIA-LOGIN.md para el flujo completo.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. PAQUETE
-- ---------------------------------------------------------------------

CREATE OR REPLACE PACKAGE pkg_auth_token AS

  -- Emite un token para el usuario y lo guarda con vencimiento en p_horas.
  FUNCTION generar_token(p_username VARCHAR2, p_horas NUMBER DEFAULT 8) RETURN VARCHAR2;

  -- Devuelve el username si el token es válido y no expiró; NULL en caso contrario.
  FUNCTION validar_token(p_token VARCHAR2) RETURN VARCHAR2;

  -- Extrae el token del header "Bearer xxx" y lo valida. NULL si no sirve.
  FUNCTION usuario_de_header(p_authorization VARCHAR2) RETURN VARCHAR2;

  PROCEDURE revocar_token(p_token VARCHAR2);
  PROCEDURE purgar_expirados;

END pkg_auth_token;
/

CREATE OR REPLACE PACKAGE BODY pkg_auth_token AS

  FUNCTION generar_token(p_username VARCHAR2, p_horas NUMBER DEFAULT 8) RETURN VARCHAR2 IS
    PRAGMA AUTONOMOUS_TRANSACTION;
    l_token VARCHAR2(64);
  BEGIN
    -- 32 bytes aleatorios en hex = 64 caracteres.
    l_token := RAWTOHEX(DBMS_CRYPTO.RANDOMBYTES(32));

    -- Una sesión activa por usuario: al loguearse de nuevo, las anteriores caen.
    -- Si querés permitir varios dispositivos a la vez, borrá este DELETE.
    DELETE FROM auth_tokens WHERE UPPER(username) = UPPER(p_username);

    INSERT INTO auth_tokens (token, username, fecha_expira)
    VALUES (l_token, UPPER(p_username), SYSDATE + p_horas/24);

    COMMIT;
    RETURN l_token;
  END generar_token;

  FUNCTION validar_token(p_token VARCHAR2) RETURN VARCHAR2 IS
    l_username VARCHAR2(255);
  BEGIN
    IF p_token IS NULL THEN
      RETURN NULL;
    END IF;

    SELECT username INTO l_username
      FROM auth_tokens
     WHERE token = p_token
       AND fecha_expira > SYSDATE;

    RETURN l_username;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RETURN NULL;
  END validar_token;

  FUNCTION usuario_de_header(p_authorization VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    IF p_authorization IS NULL THEN
      RETURN NULL;
    END IF;
    RETURN validar_token(TRIM(REPLACE(p_authorization, 'Bearer ', '')));
  END usuario_de_header;

  PROCEDURE revocar_token(p_token VARCHAR2) IS
    PRAGMA AUTONOMOUS_TRANSACTION;
  BEGIN
    DELETE FROM auth_tokens WHERE token = p_token;
    COMMIT;
  END revocar_token;

  PROCEDURE purgar_expirados IS
    PRAGMA AUTONOMOUS_TRANSACTION;
  BEGIN
    DELETE FROM auth_tokens WHERE fecha_expira <= SYSDATE;
    COMMIT;
  END purgar_expirados;

END pkg_auth_token;
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
      p_module_name    => 'auth',
      p_base_path      => '/auth/',
      p_items_per_page => 25,
      p_status         => 'PUBLISHED',
      p_comments       => NULL);

  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'auth',
      p_pattern        => 'login',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'auth',
      p_pattern        => 'login',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      DECLARE
        l_username  VARCHAR2(255) := :username;
        l_password  VARCHAR2(255) := :password;
        l_token     VARCHAR2(64);
      BEGIN
        apex_util.set_workspace(p_workspace => ''JOSIASMUEBLES'');

        IF apex_util.is_login_password_valid(l_username, l_password) THEN
          l_token := pkg_auth_token.generar_token(l_username, 8);
          :status_code := 200;
          apex_json.open_object;
          apex_json.write(''success'', TRUE);
          apex_json.write(''token'', l_token);
          apex_json.write(''username'', l_username);
          apex_json.close_object;
        ELSE
          :status_code := 401;
          apex_json.open_object;
          apex_json.write(''success'', FALSE);
          apex_json.write(''message'', ''Credenciales invalidas'');
          apex_json.close_object;
        END IF;
      EXCEPTION
        WHEN OTHERS THEN
          :status_code := 500;
          apex_json.open_object;
          apex_json.write(''success'', FALSE);
          apex_json.write(''message'', SQLERRM);
          apex_json.close_object;
      END;
    ');

  COMMIT;
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    RAISE;
END;
/
