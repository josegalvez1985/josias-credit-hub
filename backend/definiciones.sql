-- =====================================================================
-- ENDPOINT: /definiciones  —  "Definiciones" (tablas maestras)
-- Contiene: paquete pkg_definiciones + módulo ORDS `definiciones`.
-- Correr como WKSP_JOSIASMUEBLES.
--
-- ABM de las tablas de referencia que usan el resto de los módulos. Arranca
-- con PROFESIONES (2026-10-19); la idea es que las próximas (ciudades,
-- vendedores, relaciones...) se sumen acá como un template más, con sus
-- procedimientos en el mismo paquete.
--
--   PROFESIONES                         escribe  (PK COD_PROFESION, trigger + secuencia)
--   VENTAS_ACTIVIDAD_LABORAL            lee      (FK a PROFESIONES, NO ACTION)
--   SOLICITUD_VENTAS_ACTIVIDAD_LABORAL  lee      (COD_PROFESION SIN FK)
--
-- REGLAS DE NEGOCIO — PROFESIONES (confirmadas por Jose el 2026-10-19)
-- ---------------------------------------------------------------------
-- · DESCRIPCION es obligatoria y no se repite (sin distinguir mayúsculas ni
--   espacios de más). Se guarda con las mayúsculas como se escribió, solo sin
--   espacios al borde ni repetidos. La columna no tiene NOT NULL ni UNIQUE: lo
--   valida el paquete.
--
-- · El código lo pone el trigger BI_PROFESIONES con PROFESIONES_SEQ. El
--   INSERT lo manda NULL y lo recupera con RETURNING. Al 2026-10-19: 17 filas,
--   MAX(cod_profesion) = 81, secuencia en 101 — no hay choque con la PK.
--
-- · Editar renombra la profesión en TODAS las solicitudes y créditos que ya
--   la tienen (se guarda el código, no el texto). Es a propósito: sirve para
--   corregir un nombre mal escrito.
--
-- · No se puede borrar una profesión en uso. Se cuentan las DOS tablas:
--   VENTAS_ACTIVIDAD_LABORAL tiene FK (Oracle daría ORA-02292), pero
--   SOLICITUD_VENTAS_ACTIVIDAD_LABORAL no, y sin este control el borrado
--   dejaría solicitudes apuntando a un código que ya no existe.
--
-- · El LOV del asesor (GET /solicitudes/lov/profesiones) lee la misma tabla:
--   un alta, edición o baja acá se ve en el wizard de solicitud al instante.
--
-- · Sin control de concurrencia en el "no se repite": dos altas iguales en el
--   mismo segundo pasarían las dos. Son tres usuarios; no lo justifica.
--
-- PERMISOS
-- ---------------------------------------------------------------------
-- Los mismos usuarios del módulo administrativo, validados CONTRA EL TOKEN en
-- cada handler, lectura incluida. La lista está repetida y tiene que ser la
-- misma en todos lados:
--   1. pkg_definiciones.es_admin            (sección 2 de este archivo)
--   2. l_admins del bloque del módulo        (sección 3.b de este archivo)
--   3. pkg_recibos_compra.es_admin y l_admins de backend/proveedores.sql
--   4. USUARIOS_ADMIN de src/lib/permisos.ts (lo que se dibuja en pantalla)
--
-- "No tenés permiso" responde 400 y NO 403: src/lib/api.ts trata 401/403 como
-- sesión vencida y manda al usuario al login.
--
-- Códigos de error: -20600 a -20619 (proveedores usa el -205xx).
-- =====================================================================


-- =====================================================================
-- 1. SANEAMIENTO
-- =====================================================================
-- Nada que correr. Lo verificado contra la base el 2026-10-19:
--
--   PROFESIONES
--     COD_PROFESION  NUMBER          PK PROFESIONES_PK
--     DESCRIPCION    VARCHAR2(200)   (sin NOT NULL ni UNIQUE)
--   Trigger BI_PROFESIONES: BEFORE INSERT, si COD_PROFESION viene NULL lo
--   toma de PROFESIONES_SEQ.
--
--   FK que apuntan a PROFESIONES_PK:
--     VENTAS_ACTIVIDAD_LABORAL.VENTAS_ACTIVIDAD_LABORAL_FK_PROFESION  NO ACTION
--   SOLICITUD_VENTAS_ACTIVIDAD_LABORAL.COD_PROFESION no tiene FK.
--
-- Antes de usar la pantalla conviene mirar si ya hay duplicados, porque a
-- partir de ahora no se podría renombrar uno igual al otro:
--
--   SELECT UPPER(TRIM(descripcion)) AS descripcion, COUNT(*), LISTAGG(cod_profesion, ', ')
--     FROM profesiones
--    GROUP BY UPPER(TRIM(descripcion))
--   HAVING COUNT(*) > 1;


-- =====================================================================
-- 2. PAQUETE — ejecución 1 de 3
-- =====================================================================
CREATE OR REPLACE PACKAGE pkg_definiciones AS

  -- 'S' si el usuario puede usar el módulo administrativo. ORDS no bindea
  -- BOOLEAN, por eso 'S'/'N'. Ver "PERMISOS" en la cabecera del archivo.
  FUNCTION es_admin(p_usuario VARCHAR2) RETURN VARCHAR2;

  -- Alta. Devuelve el COD_PROFESION que asignó el trigger.
  FUNCTION profesion_crear(p_descripcion VARCHAR2, p_cod_usuario VARCHAR2) RETURN NUMBER;

  PROCEDURE profesion_actualizar(
    p_cod_profesion NUMBER,
    p_descripcion   VARCHAR2,
    p_cod_usuario   VARCHAR2);

  -- Falla si la profesión está en uso en solicitudes o en créditos.
  PROCEDURE profesion_eliminar(p_cod_profesion NUMBER, p_cod_usuario VARCHAR2);

END pkg_definiciones;
/

CREATE OR REPLACE PACKAGE BODY pkg_definiciones AS

  FUNCTION es_admin(p_usuario VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN CASE WHEN UPPER(TRIM(p_usuario)) IN ('AAQUINO', 'AGONZALEZ', 'JOSEG')
                THEN 'S' ELSE 'N' END;
  END es_admin;


  PROCEDURE exigir_admin(p_cod_usuario VARCHAR2) IS
  BEGIN
    IF es_admin(p_cod_usuario) <> 'S' THEN
      RAISE_APPLICATION_ERROR(-20600, 'No tenés permiso para modificar las definiciones.');
    END IF;
  END exigir_admin;


  -- Valida la descripción y la devuelve limpia: sin espacios al borde ni
  -- repetidos, con las mayúsculas como se escribió. En Oracle '' es NULL, así
  -- que un texto vacío o solo con espacios queda NULL. p_excluir es el código
  -- que se está editando, para que no choque consigo mismo.
  FUNCTION profesion_validar(p_descripcion VARCHAR2, p_excluir NUMBER) RETURN VARCHAR2 IS
    l_desc VARCHAR2(4000) := TRIM(REGEXP_REPLACE(p_descripcion, '\s+', ' '));
    l_otro NUMBER;
  BEGIN
    IF l_desc IS NULL THEN
      RAISE_APPLICATION_ERROR(-20601, 'Falta la descripción');
    END IF;
    IF LENGTH(l_desc) > 200 THEN
      RAISE_APPLICATION_ERROR(-20602, 'La descripción admite hasta 200 caracteres');
    END IF;

    -- El "no se repite" no distingue mayúsculas ni espacios de más.
    -- La limpieza va escrita acá y no en una función propia: una función que
    -- no está en la spec no se puede llamar desde un SELECT (PLS-00231).
    SELECT MIN(cod_profesion) INTO l_otro
      FROM profesiones
     WHERE UPPER(TRIM(REGEXP_REPLACE(descripcion, '\s+', ' '))) = UPPER(l_desc)
       AND cod_profesion <> NVL(p_excluir, -1);
    IF l_otro IS NOT NULL THEN
      RAISE_APPLICATION_ERROR(-20603,
        'Ya existe la profesión ' || l_desc || ' (código ' || l_otro || ')');
    END IF;

    RETURN l_desc;
  END profesion_validar;


  FUNCTION profesion_crear(p_descripcion VARCHAR2, p_cod_usuario VARCHAR2) RETURN NUMBER IS
    l_desc VARCHAR2(200);
    l_cod  NUMBER;
  BEGIN
    exigir_admin(p_cod_usuario);
    l_desc := profesion_validar(p_descripcion, NULL);

    -- COD_PROFESION en NULL: lo pone BI_PROFESIONES con la secuencia.
    INSERT INTO profesiones (cod_profesion, descripcion)
    VALUES (NULL, l_desc)
    RETURNING cod_profesion INTO l_cod;

    COMMIT;
    RETURN l_cod;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      RAISE;
  END profesion_crear;


  PROCEDURE profesion_actualizar(
    p_cod_profesion NUMBER,
    p_descripcion   VARCHAR2,
    p_cod_usuario   VARCHAR2
  ) IS
    l_desc VARCHAR2(200);
    l_cod  NUMBER;
  BEGIN
    exigir_admin(p_cod_usuario);

    IF p_cod_profesion IS NULL THEN
      RAISE_APPLICATION_ERROR(-20604, 'Falta la profesión');
    END IF;

    BEGIN
      SELECT cod_profesion INTO l_cod
        FROM profesiones
       WHERE cod_profesion = p_cod_profesion
         FOR UPDATE;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20605, 'La profesión no existe');
    END;

    l_desc := profesion_validar(p_descripcion, p_cod_profesion);

    UPDATE profesiones
       SET descripcion = l_desc
     WHERE cod_profesion = p_cod_profesion;

    COMMIT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      RAISE;
  END profesion_actualizar;


  PROCEDURE profesion_eliminar(p_cod_profesion NUMBER, p_cod_usuario VARCHAR2) IS
    l_cod         NUMBER;
    l_solicitudes NUMBER;
    l_creditos    NUMBER;
  BEGIN
    exigir_admin(p_cod_usuario);

    IF p_cod_profesion IS NULL THEN
      RAISE_APPLICATION_ERROR(-20604, 'Falta la profesión');
    END IF;

    BEGIN
      SELECT cod_profesion INTO l_cod
        FROM profesiones
       WHERE cod_profesion = p_cod_profesion
         FOR UPDATE;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20605, 'La profesión no existe');
    END;

    -- SOLICITUD_VENTAS_ACTIVIDAD_LABORAL no tiene FK: si no se cuenta acá,
    -- el DELETE pasa y deja solicitudes huérfanas.
    SELECT COUNT(*) INTO l_solicitudes
      FROM solicitud_ventas_actividad_laboral
     WHERE cod_profesion = p_cod_profesion;

    SELECT COUNT(*) INTO l_creditos
      FROM ventas_actividad_laboral
     WHERE cod_profesion = p_cod_profesion;

    IF l_solicitudes + l_creditos > 0 THEN
      RAISE_APPLICATION_ERROR(-20606,
        'No se puede eliminar: la profesión está en uso en ' ||
        CASE WHEN l_solicitudes > 0 THEN l_solicitudes || ' solicitud(es)' END ||
        CASE WHEN l_solicitudes > 0 AND l_creditos > 0 THEN ' y ' END ||
        CASE WHEN l_creditos > 0 THEN l_creditos || ' crédito(s)' END ||
        '. Si el nombre está mal, editala.');
    END IF;

    DELETE FROM profesiones WHERE cod_profesion = p_cod_profesion;

    COMMIT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      -- Por si alguien carga un crédito con esta profesión entre el conteo y
      -- el DELETE: la FK lo frena con un ORA-02292 que no dice nada.
      IF SQLCODE = -2292 THEN
        RAISE_APPLICATION_ERROR(-20606,
          'No se puede eliminar: la profesión está en uso en créditos.');
      END IF;
      RAISE;
  END profesion_eliminar;

END pkg_definiciones;
/

-- Tiene que dar VALID en las dos filas antes de seguir:
--   SELECT object_type, status FROM user_objects WHERE object_name = 'PKG_DEFINICIONES';


-- =====================================================================
-- 3. MÓDULO ORDS
-- =====================================================================
-- Tres ejecuciones SEPARADAS, nunca el archivo entero de una (ORA-00060
-- reproducible): (1) la sección 2 · (2) el bloque 3.a solo · (3) el 3.b solo.
-- Detalle en backend/README.md → "Desplegar un módulo ORDS".
--
-- ⚠ ANTES DEL PRIMER DESPLIEGUE: 3.a borra cualquier módulo que se llame
-- 'definiciones'. Confirmar que no exista uno que no sea este:
--
--   SELECT name, uri_prefix FROM user_ords_modules ORDER BY name;
--
-- Si aparece 'definiciones' o un uri_prefix '/definiciones/' que no salió de
-- este archivo, NO correr 3.a: hay que elegir otro nombre.

-- ---------------------------------------------------------------------
-- 3.a  Borrado previo — ejecución 2 de 3. CORRER SOLO ESTO Y ESPERAR
-- ---------------------------------------------------------------------
-- Sin EXCEPTION a propósito: si el borrado falla hay que verlo.
DECLARE
  l_existe NUMBER;
BEGIN
  SELECT COUNT(*) INTO l_existe FROM user_ords_modules WHERE name = 'definiciones';
  IF l_existe > 0 THEN
    ORDS.DELETE_MODULE(p_module_name => 'definiciones');
    COMMIT;
  END IF;
END;
/

-- Tiene que dar 0 ANTES de seguir con 3.b:
--   SELECT COUNT(*) FROM user_ords_modules WHERE name = 'definiciones';
-- Si el bloque de arriba tardó ~13 segundos, estaba esperando un lock: ver
-- backend/README.md antes de insistir.


-- ---------------------------------------------------------------------
-- 3.b  Definición del módulo — ejecución 3 de 3. CORRER SOLO ESTO
-- ---------------------------------------------------------------------
-- Todos los handlers son plsql/block: es el único tipo que puede validar el
-- token. El GET arma el JSON a mano y devuelve TODAS las filas, sin paginar
-- (no acepta ?limit/?offset ni ?page): son 17 profesiones y el cliente busca
-- en memoria.
--
-- El GET no llama a pkg_definiciones (sí a pkg_auth_token): si el paquete
-- queda INVALID, la lectura sigue andando.
DECLARE

  -- Usuarios habilitados, ya escritos como lista de un IN (...). Es la misma
  -- lista que pkg_definiciones.es_admin, que proveedores.sql y que
  -- src/lib/permisos.ts.
  l_admins  CONSTANT VARCHAR2(200) := '''AAQUINO'', ''AGONZALEZ'', ''JOSEG''';

  -- Arranque común de TODOS los handlers: token válido y usuario habilitado.
  -- Copia de l_guardia de proveedores.sql. Cada handler tiene que declarar
  -- l_user.
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
      p_module_name    => 'definiciones',
      p_base_path      => '/definiciones/',
      p_items_per_page => 25,
      p_status         => 'PUBLISHED',
      p_comments       => NULL);


  -- ==================================================================
  -- PROFESIONES   GET /definiciones/profesiones
  -- ==================================================================
  -- Todas, con cuántas solicitudes y créditos la usan: la pantalla deshabilita
  -- el borrado de las que están en uso.
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'definiciones',
      p_pattern        => 'profesiones',
      p_priority       => 0,
      p_etag_type      => 'NONE',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'definiciones',
      p_pattern        => 'profesiones',
      p_method         => 'GET',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      DECLARE
        l_user VARCHAR2(255);
      BEGIN' || l_guardia || '
        apex_json.open_object;
        apex_json.write(''success'', TRUE);
        apex_json.open_array(''items'');

        FOR r IN (
          SELECT p.cod_profesion,
                 p.descripcion,
                 NVL(s.cant, 0) AS usos_solicitudes,
                 NVL(v.cant, 0) AS usos_creditos
            FROM profesiones p
            LEFT JOIN ( SELECT cod_profesion, COUNT(*) AS cant
                          FROM solicitud_ventas_actividad_laboral
                         GROUP BY cod_profesion ) s ON s.cod_profesion = p.cod_profesion
            LEFT JOIN ( SELECT cod_profesion, COUNT(*) AS cant
                          FROM ventas_actividad_laboral
                         GROUP BY cod_profesion ) v ON v.cod_profesion = p.cod_profesion
           ORDER BY UPPER(p.descripcion), p.cod_profesion
        ) LOOP
          apex_json.open_object;
          apex_json.write(''cod_profesion'',    r.cod_profesion);
          apex_json.write(''descripcion'',      r.descripcion);
          apex_json.write(''usos_solicitudes'', r.usos_solicitudes);
          apex_json.write(''usos_creditos'',    r.usos_creditos);
          apex_json.close_object;
        END LOOP;

        apex_json.close_array;
        apex_json.close_object;
      EXCEPTION WHEN OTHERS THEN
        :status_code := 500;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_PARAMETER(p_module_name => 'definiciones', p_pattern => 'profesiones', p_method => 'GET',
      p_name => 'authorization', p_bind_variable_name => 'authorization',
      p_source_type => 'HEADER', p_param_type => 'STRING', p_access_method => 'IN', p_comments => NULL);


  -- ==================================================================
  -- ALTA   POST /definiciones/profesiones   body {"descripcion": "..."}
  -- ==================================================================
  ORDS.DEFINE_HANDLER(
      p_module_name    => 'definiciones',
      p_pattern        => 'profesiones',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      DECLARE
        l_user VARCHAR2(255);
        l_cod  NUMBER;
      BEGIN' || l_guardia || '
        l_cod := pkg_definiciones.profesion_crear(
          p_descripcion => :descripcion,
          p_cod_usuario => l_user);          -- del token, nunca del body

        :status_code := 201;
        htp.p(''{"success": true, "cod_profesion": '' || l_cod || ''}'');
      EXCEPTION WHEN OTHERS THEN
        :status_code := 400;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_PARAMETER(p_module_name => 'definiciones', p_pattern => 'profesiones', p_method => 'POST',
      p_name => 'authorization', p_bind_variable_name => 'authorization',
      p_source_type => 'HEADER', p_param_type => 'STRING', p_access_method => 'IN', p_comments => NULL);


  -- ==================================================================
  -- EDICIÓN   PUT /definiciones/profesiones/:id   body {"descripcion": "..."}
  -- ==================================================================
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'definiciones',
      p_pattern        => 'profesiones/:id',
      p_priority       => 0,
      p_etag_type      => 'NONE',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'definiciones',
      p_pattern        => 'profesiones/:id',
      p_method         => 'PUT',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      DECLARE
        l_user VARCHAR2(255);
      BEGIN' || l_guardia || '
        pkg_definiciones.profesion_actualizar(
          p_cod_profesion => TO_NUMBER(:id),
          p_descripcion   => :descripcion,
          p_cod_usuario   => l_user);

        :status_code := 200;
        htp.p(''{"success": true}'');
      EXCEPTION WHEN OTHERS THEN
        :status_code := 400;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_PARAMETER(p_module_name => 'definiciones', p_pattern => 'profesiones/:id', p_method => 'PUT',
      p_name => 'authorization', p_bind_variable_name => 'authorization',
      p_source_type => 'HEADER', p_param_type => 'STRING', p_access_method => 'IN', p_comments => NULL);


  -- ==================================================================
  -- BAJA   DELETE /definiciones/profesiones/:id
  -- ==================================================================
  -- El cliente lo manda con Content-Type: text/plain y sin cuerpo (ver
  -- eliminarProfesion en src/lib/api.ts y la 4.f de proveedores.sql).
  ORDS.DEFINE_HANDLER(
      p_module_name    => 'definiciones',
      p_pattern        => 'profesiones/:id',
      p_method         => 'DELETE',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      DECLARE
        l_user VARCHAR2(255);
      BEGIN' || l_guardia || '
        pkg_definiciones.profesion_eliminar(
          p_cod_profesion => TO_NUMBER(:id),
          p_cod_usuario   => l_user);

        :status_code := 200;
        htp.p(''{"success": true}'');
      EXCEPTION WHEN OTHERS THEN
        :status_code := 400;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_PARAMETER(p_module_name => 'definiciones', p_pattern => 'profesiones/:id', p_method => 'DELETE',
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
-- 4. VERIFICACIÓN (correr a mano, no es parte del despliegue)
-- =====================================================================

-- 4.a  ¿Quedaron los cuatro handlers?
--
--   SELECT t.uri_template, h.method, h.source_type
--     FROM user_ords_modules p
--     JOIN user_ords_templates t ON t.module_id = p.id
--     JOIN user_ords_handlers  h ON h.template_id = t.id
--    WHERE p.name = 'definiciones'
--    ORDER BY t.uri_template, h.method;
--
--   profesiones      GET     plsql/block
--   profesiones      POST    plsql/block
--   profesiones/:id  DELETE  plsql/block
--   profesiones/:id  PUT     plsql/block

-- 4.b  Desde afuera, con curl (NUNCA desde el navegador: un 500 llega como
--      "error de CORS" y esconde el ORA- real). El TOKEN sale del login, como
--      en la 4.c de proveedores.sql.
--
--   B="https://oracleapex.com/ords/josiasmuebles/definiciones"
--   curl -i "$B/profesiones" -H "Authorization: Bearer $TOKEN"
--     -> 17 filas, cada una con usos_solicitudes y usos_creditos.
--
--   curl -i -X POST "$B/profesiones" -H "Authorization: Bearer $TOKEN" \
--        -H "Content-Type: application/json" -d '{"descripcion":"  prueba   borrar "}'
--     -> 201 {"success": true, "cod_profesion": 101}  (guardada "prueba borrar")
--   POST con "Prueba Borrar" -> 400 "Ya existe la profesión Prueba Borrar (código 101)".
--
--   curl -i -X PUT "$B/profesiones/101" -H "Authorization: Bearer $TOKEN" \
--        -H "Content-Type: application/json" -d '{"descripcion":"prueba editada"}'
--   curl -i -X DELETE "$B/profesiones/101" -H "Authorization: Bearer $TOKEN"
--
--   DELETE de una profesión en uso -> 400 "No se puede eliminar: ... en uso en N ...".
--   Sin el header -> 401. Usuario fuera de la lista -> 400.


-- =====================================================================
-- 5. ROLLBACK
-- =====================================================================
-- No toca esquema. Se deshace borrando el módulo y el paquete; las
-- profesiones cargadas o editadas quedan en la tabla.
--
--   BEGIN
--     ORDS.DELETE_MODULE(p_module_name => 'definiciones');
--     COMMIT;
--   END;
--   /
--   DROP PACKAGE pkg_definiciones;
