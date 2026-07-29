-- =====================================================================
-- MÓDULO: /recibos  —  emisión, consulta, edición y anulación de recibos
-- Portado de la app APEX "Josias Muebles Cobradores" (266784), páginas 2 y 3.
-- Correr como WKSP_JOSIASMUEBLES.
--
-- Contenido de este archivo:
--   1. SANEAMIENTO de la base   -> NO es idempotente. Leer antes de correr.
--   2. PAQUETE pkg_recibos      -> CREATE OR REPLACE, se puede repetir siempre.
--   3. MÓDULO ORDS recibos      -> borra y redefine el módulo completo.
--   4. VERIFICACIÓN             -> consultas sueltas, no se corren en el deploy.
--
-- =====================================================================
-- CÓMO DESPLEGAR  —  EN TRES EJECUCIONES SEPARADAS
-- =====================================================================
-- NO correr el archivo entero de una. Correrlo todo junto da ORA-00060 de
-- forma reproducible: el bloque que borra el módulo queda esperando un lock
-- sobre ORDS_METADATA.ORDS_MODULES y termina en interbloqueo, y después el
-- DEFINE_MODULE choca con ORA-00001 porque el módulo sigue ahí.
--
-- La secuencia que SÍ funciona, ejecutando cada paso por separado y esperando
-- a que termine antes del siguiente:
--
--   PASO 1 — Sección 2 completa (el paquete).
--            Marcar desde "CREATE OR REPLACE PACKAGE pkg_recibos" hasta el
--            "END pkg_recibos; /" del body, y ejecutar.
--
--   PASO 2 — Solo esto, nada más seleccionado:
--
--              BEGIN
--                ORDS.DELETE_MODULE(p_module_name => 'recibos');
--                COMMIT;
--              END;
--              /
--
--            Tiene que tardar milisegundos. Si tarda ~12 segundos, es que está
--            esperando el lock: ver más abajo cómo destrabarlo.
--            Verificar antes de seguir:
--              SELECT COUNT(*) FROM user_ords_modules WHERE name = 'recibos';  -- 0
--
--   PASO 3 — Sección 3 completa (el bloque DECLARE ... END; / que define
--            el módulo y sus handlers).
--
-- El bloque de borrado que está al principio de la sección 3 sirve para la
-- primera instalación en una base limpia. En una base donde el módulo ya
-- existe, hacer el PASO 2 a mano igual.
--
-- ---------------------------------------------------------------------
-- SI FALLA CON ORA-00060 / ORA-00001 (ORDS_MODULES_UNIQUE1)
-- ---------------------------------------------------------------------
-- Significa que el DELETE_MODULE no pudo borrar porque otra sesión tiene una
-- transacción abierta sobre ORDS_METADATA.ORDS_MODULES — típicamente un intento
-- anterior que quedó trabado. Se reconoce porque el bloque tarda ~13 segundos:
-- no está trabajando, está esperando el lock hasta que Oracle declara el
-- interbloqueo.
--
-- PASO A: soltar la sesión trabada
--   1. Cerrar TODAS las pestañas de SQL Developer Web / APEX / SQL Workshop.
--   2. Esperar 1 o 2 minutos a que Oracle mate la sesión huérfana.
--   3. Volver a entrar, en una sola pestaña.
--
-- PASO B: borrar el módulo solo, y confirmar que se fue
--
--   ROLLBACK;
--
--   SELECT id, name, uri_prefix FROM user_ords_modules WHERE name = 'recibos';
--
--   BEGIN
--     ORDS.DELETE_MODULE(p_module_name => 'recibos');
--   END;
--   /
--   COMMIT;
--
--   -- Tiene que dar 0. Si da 1, NO seguir: el lock sigue ahí.
--   SELECT COUNT(*) FROM user_ords_modules WHERE name = 'recibos';
--
-- PASO C: con el conteo en 0, correr la sección 3 completa.
--
-- PASO B-bis: si el DELETE da ORA-00060, borrar con reintentos. El lock de
-- ORDS_METADATA suele soltarse solo a los pocos segundos.
--
--   SET SERVEROUTPUT ON
--   DECLARE
--     l_intento PLS_INTEGER := 0;
--   BEGIN
--     LOOP
--       l_intento := l_intento + 1;
--       BEGIN
--         ORDS.DELETE_MODULE(p_module_name => 'recibos');
--         COMMIT;
--         DBMS_OUTPUT.PUT_LINE('Borrado en el intento ' || l_intento);
--         EXIT;
--       EXCEPTION
--         WHEN OTHERS THEN
--           ROLLBACK;
--           DBMS_OUTPUT.PUT_LINE('Intento ' || l_intento || ' fallo: ' || SQLERRM);
--           IF l_intento >= 8 THEN RAISE; END IF;
--           DBMS_SESSION.SLEEP(5);
--       END;
--     END LOOP;
--   END;
--   /
--
-- ALTERNATIVA si el PASO B vuelve a fallar:
--   Borrarlo desde la interfaz, que evita el problema por completo:
--   SQL Developer Web -> REST -> Modules -> recibos -> botón derecho -> Delete.
--   Hace lo mismo que ORDS.DELETE_MODULE pero ORDS maneja la transacción.
--   Después correr la sección 3.
--
-- ---------------------------------------------------------------------
-- SI EL NAVEGADOR REPORTA UN ERROR DE CORS
-- ---------------------------------------------------------------------
-- Casi siempre es un 500 disfrazado: cuando el handler explota, ORDS devuelve
-- el error SIN cabeceras CORS y el browser tapa el mensaje real. Ningún módulo
-- de este schema define origins_allowed y todos funcionan, así que no es CORS.
-- Diagnosticar con curl, que sí muestra el cuerpo del error (ver sección 4.d).
-- =====================================================================
--
-- Las tablas NO se crean acá: ya están en producción. Su DDL, para referencia:
--   CUOTAS_COBRADAS (NRO_RECIBO, FECHA_RECIBO, COD_CLIENTE, CONCEPTO,
--     ID_SOLICITUD, ID_CUOTA, MONTO, FEC_VENCIMIENTO, TOTAL_INTERES,
--     SALDO_CUOTA, COD_COBRADOR, COD_USUARIO, ANULADO)
--     PK (NRO_RECIBO, ID_SOLICITUD, ID_CUOTA)
--   VENTAS_CUOTAS   (ID_DETALLE, ID, NRO_CUOTA, FEC_VENCIMIENTO,
--     MONTO_CUOTA, SALDO_CUOTA, FEC_DERIVACION)  PK (ID, ID_DETALLE)
--   VENTAS_CABECERA (ID, NRO_SOLICITUD, ..., ID_SOLICITUD)  PK (ID)
--   CLIENTES        (COD_CLIENTE, RAZON_SOCIAL, CI, RUC, NRO_TELEFONO, ...)
--
-- También usa la vista V_SALDOS y las funciones RETORNA_ARTICULOS, FN_CUOTAS,
-- FN_USUARIO y NUM_LETRAS, que ya existen en la base.
--
-- ---------------------------------------------------------------------
-- LO QUE HACEN LOS TRIGGERS (no replicar acá, se duplicaría el efecto)
-- ---------------------------------------------------------------------
-- TRG_ACTUALIZA_CUOTA  AFTER I/U/D OF MONTO ON CUOTAS_COBRADAS
--     descuenta/devuelve VENTAS_CUOTAS.SALDO_CUOTA.
-- TRG_ANULA_CUOTA      AFTER UPDATE OF ANULADO
--     devuelve el saldo al anular ('S'), lo vuelve a descontar al reactivar.
-- TRG_NRO_RECIBO       BEFORE INSERT
--     asigna NRO_RECIBO si viene NULL (primer hueco >= 100000).
-- TRG_CTRL_CUOTA       AFTER UPDATE OF SALDO_CUOTA ON VENTAS_CUOTAS
--     ORA-20101 si el saldo queda negativo, ORA-20102 si supera la cuota.
--
-- => El INSERT va con NRO_RECIBO en NULL y se recupera con RETURNING.
-- => Nunca se toca VENTAS_CUOTAS desde el paquete.
--
-- ---------------------------------------------------------------------
-- PERMISOS
-- ---------------------------------------------------------------------
-- El usuario SIEMPRE sale del token (pkg_auth_token), nunca del body.
--
--   Acción            Cobrador                     Admin (JOSEG)
--   ----------------- ---------------------------- -------------------
--   Listar / ver      solo sus propios recibos     todos
--   Emitir            sí                           sí
--   Editar monto      NO (ORA-20210)               sí
--   Anular/reactivar  NO (ORA-20211)               sí
--
-- Lo de lectura replica el filtro de APEX:
--   and (cod_usuario = :APP_USER or :APP_USER = 'JOSEG')
-- Lo de escritura es nuevo: en APEX la pantalla de edición solo se alcanzaba
-- desde el listado ya filtrado, pero un endpoint REST es invocable directo, así
-- que la restricción tiene que ser explícita.
--
-- El admin está en c_usuario_admin (paquete). Los handlers de lectura repiten
-- 'JOSEG' inline a propósito, para no depender del paquete en los GET.
-- =====================================================================


-- =====================================================================
-- 1. SANEAMIENTO DE LA BASE
--    OJO: esta sección NO es idempotente y toca una base en producción.
--    Leerla entera y correrla a mano, paso por paso. El resto del archivo
--    (secciones 2 y 3) funciona sin esto.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1.a  Eliminar el trigger de numeración duplicado        [RECOMENDADO]
-- ---------------------------------------------------------------------
-- Hay DOS triggers BEFORE INSERT que asignan NRO_RECIBO con algoritmos
-- distintos, y Oracle no garantiza el orden en que disparan:
--
--   TRG_NRO_RECIBO        -> primer hueco de la numeración a partir de 100000
--   TRG_RENUMERAR_RECIBO  -> MAX(nro_recibo) + 1
--
-- El segundo en disparar encuentra :NEW.nro_recibo ya cargado y no hace nada,
-- así que hoy el número depende de cuál corra primero. Además
-- TRG_RENUMERAR_RECIBO tapa cualquier error con "WHEN OTHERS THEN NULL",
-- lo que puede dejar pasar un recibo sin número.
--
-- Se conserva TRG_NRO_RECIBO: es el que refleja la intención del sistema
-- (reusar huecos) y el que replica el código de la página 3 de APEX.
--
-- Guardar copia antes de borrar:
--   SELECT trigger_body FROM user_triggers WHERE trigger_name = 'TRG_RENUMERAR_RECIBO';

-- DROP TRIGGER TRG_RENUMERAR_RECIBO;


-- ---------------------------------------------------------------------
-- 1.b  Índice para el listado de recibos                  [RECOMENDADO]
-- ---------------------------------------------------------------------
-- El listado filtra por COD_USUARIO y ordena por FECHA_RECIBO DESC,
-- NRO_RECIBO DESC. Con 130.000+ filas y sin este índice cada consulta es un
-- full scan + sort. El índice existente (ID_SOLICITUD, ID_CUOTA, ANULADO) no
-- sirve para ese acceso.

-- CREATE INDEX IDX_CUOTAS_COBRADAS_USR_FEC
--     ON CUOTAS_COBRADAS (COD_USUARIO, FECHA_RECIBO DESC, NRO_RECIBO DESC);


-- ---------------------------------------------------------------------
-- 1.c  Unicidad del número de recibo               [VERIFICAR ANTES]
-- ---------------------------------------------------------------------
-- La PK es (NRO_RECIBO, ID_SOLICITUD, ID_CUOTA): la base HOY PERMITE dos
-- recibos distintos con el mismo número. Sumado a que TRG_NRO_RECIBO calcula
-- el número sin ningún bloqueo, dos cobradores que graban al mismo tiempo
-- pueden llevarse el mismo NRO_RECIBO y la base los acepta.
--
-- 1) Verificar si ya pasó (ver también la sección 4):
--
--    SELECT nro_recibo, COUNT(*) c FROM cuotas_cobradas
--     GROUP BY nro_recibo HAVING COUNT(*) > 1 ORDER BY c DESC;
--
-- 2) Si devuelve filas, NO correr el ALTER: hay que decidir primero qué se
--    hace con los duplicados (renumerar es lo habitual, pero son recibos ya
--    entregados en papel al cliente).
--
-- 3) Si devuelve vacío, correrlo. A partir de ahí un choque de numeración
--    falla con ORA-00001 y el endpoint devuelve 400, en vez de duplicar en
--    silencio.

-- ALTER TABLE CUOTAS_COBRADAS
--   ADD CONSTRAINT CUOTAS_COBRADAS_UK_NRO UNIQUE (NRO_RECIBO);


-- ---------------------------------------------------------------------
-- 1.d  Serializar la asignación del número                   [OPCIONAL]
-- ---------------------------------------------------------------------
-- 1.c evita el dato malo, pero el usuario ve un error. Si el choque llega a
-- ser frecuente, conviene además serializar la asignación dentro de
-- TRG_NRO_RECIBO con un lock de aplicación:
--
--   l_lock := DBMS_LOCK.ALLOCATE_UNIQUE('JM_NRO_RECIBO', l_handle);
--   l_res  := DBMS_LOCK.REQUEST(l_handle, DBMS_LOCK.X_MODE, 10, FALSE);
--
-- Requiere GRANT EXECUTE ON DBMS_LOCK TO WKSP_JOSIASMUEBLES.
--
-- La alternativa más limpia es una secuencia, pero abandona el reuso de
-- huecos: la numeración pasa a ser estrictamente creciente. Es decisión de
-- negocio, no técnica.


-- ---------------------------------------------------------------------
-- 1.e  Rollback de esta sección
-- ---------------------------------------------------------------------
-- DROP INDEX IDX_CUOTAS_COBRADAS_USR_FEC;
-- ALTER TABLE CUOTAS_COBRADAS DROP CONSTRAINT CUOTAS_COBRADAS_UK_NRO;
-- TRG_RENUMERAR_RECIBO: recrear desde la copia guardada en 1.a.



-- =====================================================================
-- 2. PAQUETE
-- =====================================================================
CREATE OR REPLACE PACKAGE pkg_recibos AS

  -- Usuario con visión total. En APEX estaba hardcodeado como :APP_USER = 'JOSEG'
  -- en cada página; acá queda en un solo lugar.
  c_usuario_admin CONSTANT VARCHAR2(50) := 'JOSEG';

  FUNCTION es_admin(p_usuario VARCHAR2) RETURN VARCHAR2;

  -- Emite un recibo. Devuelve el NRO_RECIBO que asignó el trigger.
  -- SALDO_CUOTA, TOTAL_INTERES y FEC_VENCIMIENTO se toman de V_SALDOS (foto del
  -- momento del cobro), no de lo que mande el cliente.
  FUNCTION crear(
    p_cod_cliente   NUMBER,
    p_id_solicitud  NUMBER,
    p_id_cuota      NUMBER,
    p_monto         NUMBER,
    p_cod_usuario   VARCHAR2,
    p_fecha_recibo  DATE     DEFAULT SYSDATE,
    p_concepto      VARCHAR2 DEFAULT NULL,
    p_cod_cobrador  NUMBER   DEFAULT NULL
  ) RETURN NUMBER;

  -- Edita un recibo vigente. El trigger reajusta el saldo por la diferencia.
  -- SOLO ADMIN: cambiar el monto mueve plata igual que anular.
  PROCEDURE actualizar(
    p_nro_recibo    NUMBER,
    p_id_solicitud  NUMBER,
    p_id_cuota      NUMBER,
    p_monto         NUMBER,
    p_cod_usuario   VARCHAR2,
    p_concepto      VARCHAR2 DEFAULT NULL,
    p_fecha_recibo  DATE     DEFAULT NULL
  );

  -- Anula ('S') o reactiva ('N'). El trigger devuelve o vuelve a descontar el saldo.
  -- SOLO ADMIN: un cobrador no puede anular ni reactivar recibos.
  PROCEDURE anular(
    p_nro_recibo    NUMBER,
    p_id_solicitud  NUMBER,
    p_id_cuota      NUMBER,
    p_cod_usuario   VARCHAR2,
    p_anulado       VARCHAR2 DEFAULT 'S'
  );

  -- Deriva una cuota: marca la fecha en que pasó a gestión de cobranza.
  -- Es el proceso "Guardar" de la página 4 de APEX, que hacía un UPDATE directo
  -- de VENTAS_CUOTAS.FEC_DERIVACION. No dispara ningún trigger: TRG_CTRL_CUOTA
  -- solo escucha cambios de SALDO_CUOTA.
  PROCEDURE derivar(
    p_id_solicitud     NUMBER,
    p_id_cuota         NUMBER,
    p_fecha_derivacion DATE
  );

  -- Guarda el link de Google Maps del domicilio del cliente.
  -- Es el proceso "Guardar" de la página 6 de APEX: un UPDATE de CLIENTES.UBICACION
  -- con la URL que arma el botón "Obtener Ubicación" a partir del GPS del celular.
  PROCEDURE guardar_ubicacion(
    p_cod_cliente NUMBER,
    p_ubicacion   VARCHAR2
  );

END pkg_recibos;
/

CREATE OR REPLACE PACKAGE BODY pkg_recibos AS

  -- ORDS no bindea BOOLEAN, por eso 'S'/'N' en vez de TRUE/FALSE.
  FUNCTION es_admin(p_usuario VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN CASE WHEN UPPER(TRIM(p_usuario)) = c_usuario_admin THEN 'S' ELSE 'N' END;
  END es_admin;


  FUNCTION crear(
    p_cod_cliente   NUMBER,
    p_id_solicitud  NUMBER,
    p_id_cuota      NUMBER,
    p_monto         NUMBER,
    p_cod_usuario   VARCHAR2,
    p_fecha_recibo  DATE     DEFAULT SYSDATE,
    p_concepto      VARCHAR2 DEFAULT NULL,
    p_cod_cobrador  NUMBER   DEFAULT NULL
  ) RETURN NUMBER IS
    l_nro_recibo      NUMBER;
    l_saldo_cuota     NUMBER;
    l_total_interes   NUMBER;
    l_fec_vencimiento DATE;
    l_concepto        VARCHAR2(500);
    l_fecha           DATE := NVL(p_fecha_recibo, SYSDATE);
  BEGIN
    ------------------------------------------------------------------
    -- Validaciones (las de la página 3, más las que allá quedaban
    -- libradas al trigger, para devolver un mensaje entendible)
    ------------------------------------------------------------------
    IF p_cod_cliente IS NULL OR p_id_solicitud IS NULL OR p_id_cuota IS NULL THEN
      RAISE_APPLICATION_ERROR(-20201, 'Faltan cliente, solicitud o cuota');
    END IF;

    IF NVL(p_monto, 0) <= 0 THEN
      RAISE_APPLICATION_ERROR(-20202, 'El monto debe ser mayor a cero');
    END IF;

    -- Validación "Nuevo" de la página 3.
    IF TRUNC(l_fecha) > TRUNC(SYSDATE) THEN
      RAISE_APPLICATION_ERROR(-20203, 'La fecha no puede ser posterior a la fecha actual');
    END IF;

    ------------------------------------------------------------------
    -- Foto de la cuota. Es lo que hacía la acción dinámica CALCULOS.
    ------------------------------------------------------------------
    BEGIN
      SELECT NVL(saldo_cuota, 0), NVL(total_interes, 0), fec_vencimiento
        INTO l_saldo_cuota, l_total_interes, l_fec_vencimiento
        FROM v_saldos
       WHERE cod_cliente  = p_cod_cliente
         AND id_solicitud = p_id_solicitud
         AND id_cuota     = p_id_cuota;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20204, 'La cuota no existe o no pertenece a ese cliente');
    END;

    IF l_saldo_cuota <= 0 THEN
      RAISE_APPLICATION_ERROR(-20205, 'La cuota ya está cancelada');
    END IF;

    -- TRG_CTRL_CUOTA lo impediría igual, pero con ORA-20101 y sin decir cuánto.
    IF p_monto > l_saldo_cuota THEN
      RAISE_APPLICATION_ERROR(-20206,
        'El monto supera el saldo de la cuota (saldo: ' ||
        TO_CHAR(l_saldo_cuota, 'FM999G999G999G990') || ')');
    END IF;

    -- Igual que CARGA_CONCEPTOS: si no viene, se arma con los artículos.
    l_concepto := NVL(p_concepto, RETORNA_ARTICULOS(p_id_solicitud));

    ------------------------------------------------------------------
    -- El INSERT. NRO_RECIBO va NULL a propósito: lo pone TRG_NRO_RECIBO.
    -- ANULADO arranca en 'N' (en APEX quedaba NULL; los triggers tratan
    -- NULL y 'N' igual, pero explícito es mejor).
    ------------------------------------------------------------------
    INSERT INTO cuotas_cobradas (
      nro_recibo, fecha_recibo, cod_cliente, concepto,
      id_solicitud, id_cuota, monto,
      fec_vencimiento, total_interes, saldo_cuota,
      cod_cobrador, cod_usuario, anulado
    ) VALUES (
      NULL, l_fecha, p_cod_cliente, l_concepto,
      p_id_solicitud, p_id_cuota, p_monto,
      l_fec_vencimiento, l_total_interes, l_saldo_cuota,
      p_cod_cobrador, UPPER(TRIM(p_cod_usuario)), 'N'
    )
    RETURNING nro_recibo INTO l_nro_recibo;

    COMMIT;
    RETURN l_nro_recibo;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      RAISE;
  END crear;


  PROCEDURE actualizar(
    p_nro_recibo    NUMBER,
    p_id_solicitud  NUMBER,
    p_id_cuota      NUMBER,
    p_monto         NUMBER,
    p_cod_usuario   VARCHAR2,
    p_concepto      VARCHAR2 DEFAULT NULL,
    p_fecha_recibo  DATE     DEFAULT NULL
  ) IS
    l_anulado VARCHAR2(1);
  BEGIN
    -- El cobrador emite y consulta; modificar es del supervisor. Sin esto,
    -- cualquiera que conozca la PK podría editar el recibo de otro: el endpoint
    -- REST es invocable directo, no como la pantalla de APEX a la que solo se
    -- llegaba desde el listado ya filtrado.
    IF es_admin(p_cod_usuario) <> 'S' THEN
      RAISE_APPLICATION_ERROR(-20210,
        'No tenés permiso para modificar recibos. Pedíselo a un supervisor.');
    END IF;

    IF NVL(p_monto, 0) <= 0 THEN
      RAISE_APPLICATION_ERROR(-20202, 'El monto debe ser mayor a cero');
    END IF;

    BEGIN
      SELECT NVL(anulado, 'N') INTO l_anulado
        FROM cuotas_cobradas
       WHERE nro_recibo   = p_nro_recibo
         AND id_solicitud = p_id_solicitud
         AND id_cuota     = p_id_cuota
         FOR UPDATE;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20207, 'El recibo no existe');
    END;

    -- TRG_ACTUALIZA_CUOTA no mira ANULADO: si dejáramos editar el monto de un
    -- recibo anulado, descontaría del saldo una plata que ya fue devuelta.
    IF l_anulado = 'S' THEN
      RAISE_APPLICATION_ERROR(-20208,
        'El recibo está anulado. Reactivalo antes de modificarlo.');
    END IF;

    UPDATE cuotas_cobradas
       SET monto        = p_monto,
           concepto     = NVL(p_concepto, concepto),
           fecha_recibo = NVL(p_fecha_recibo, fecha_recibo)
     WHERE nro_recibo   = p_nro_recibo
       AND id_solicitud = p_id_solicitud
       AND id_cuota     = p_id_cuota;

    COMMIT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      RAISE;
  END actualizar;


  PROCEDURE anular(
    p_nro_recibo    NUMBER,
    p_id_solicitud  NUMBER,
    p_id_cuota      NUMBER,
    p_cod_usuario   VARCHAR2,
    p_anulado       VARCHAR2 DEFAULT 'S'
  ) IS
    l_actual VARCHAR2(1);
    l_nuevo  VARCHAR2(1) := CASE WHEN UPPER(NVL(p_anulado,'S')) = 'S' THEN 'S' ELSE 'N' END;
  BEGIN
    -- Un cobrador NO puede anular ni reactivar: anular devuelve el monto al
    -- saldo de la cuota (TRG_ANULA_CUOTA), o sea que mueve plata.
    IF es_admin(p_cod_usuario) <> 'S' THEN
      RAISE_APPLICATION_ERROR(-20211,
        'No tenés permiso para anular recibos. Pedíselo a un supervisor.');
    END IF;

    BEGIN
      SELECT NVL(anulado, 'N') INTO l_actual
        FROM cuotas_cobradas
       WHERE nro_recibo   = p_nro_recibo
         AND id_solicitud = p_id_solicitud
         AND id_cuota     = p_id_cuota
         FOR UPDATE;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20207, 'El recibo no existe');
    END;

    -- TRG_ANULA_CUOTA no hace nada si el estado no cambia, pero cortamos antes
    -- para poder avisar al usuario.
    IF l_actual = l_nuevo THEN
      RAISE_APPLICATION_ERROR(-20209,
        CASE WHEN l_nuevo = 'S' THEN 'El recibo ya estaba anulado'
             ELSE 'El recibo ya estaba vigente' END);
    END IF;

    UPDATE cuotas_cobradas
       SET anulado      = l_nuevo
     WHERE nro_recibo   = p_nro_recibo
       AND id_solicitud = p_id_solicitud
       AND id_cuota     = p_id_cuota;

    COMMIT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      RAISE;
  END anular;


  PROCEDURE derivar(
    p_id_solicitud     NUMBER,
    p_id_cuota         NUMBER,
    p_fecha_derivacion DATE
  ) IS
    l_saldo NUMBER;
  BEGIN
    IF p_fecha_derivacion IS NULL THEN
      RAISE_APPLICATION_ERROR(-20220, 'Falta la fecha de derivación');
    END IF;

    BEGIN
      SELECT NVL(saldo_cuota, 0) INTO l_saldo
        FROM ventas_cuotas
       WHERE id         = p_id_solicitud
         AND id_detalle = p_id_cuota
         FOR UPDATE;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20221, 'La cuota no existe');
    END;

    -- El LOV de la página 4 solo ofrece cuotas con saldo; se valida igual acá
    -- porque el endpoint es invocable directo.
    IF l_saldo = 0 THEN
      RAISE_APPLICATION_ERROR(-20222, 'La cuota ya está cancelada, no se puede derivar');
    END IF;

    UPDATE ventas_cuotas
       SET fec_derivacion = p_fecha_derivacion
     WHERE id         = p_id_solicitud
       AND id_detalle = p_id_cuota;

    COMMIT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      RAISE;
  END derivar;


  PROCEDURE guardar_ubicacion(
    p_cod_cliente NUMBER,
    p_ubicacion   VARCHAR2
  ) IS
  BEGIN
    IF p_cod_cliente IS NULL THEN
      RAISE_APPLICATION_ERROR(-20230, 'Falta el cliente');
    END IF;

    IF TRIM(p_ubicacion) IS NULL THEN
      RAISE_APPLICATION_ERROR(-20231, 'Falta la ubicación');
    END IF;

    -- La columna es VARCHAR2(1000); si llega algo más largo, avisar con un
    -- mensaje entendible en vez del ORA-12899 crudo.
    IF LENGTH(p_ubicacion) > 1000 THEN
      RAISE_APPLICATION_ERROR(-20232, 'La ubicación supera los 1000 caracteres');
    END IF;

    UPDATE clientes
       SET ubicacion   = TRIM(p_ubicacion)
     WHERE cod_cliente = p_cod_cliente;

    IF SQL%ROWCOUNT = 0 THEN
      RAISE_APPLICATION_ERROR(-20233, 'El cliente no existe');
    END IF;

    COMMIT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      RAISE;
  END guardar_ubicacion;

END pkg_recibos;
/



-- =====================================================================
-- 3. MÓDULO ORDS
-- =====================================================================
-- OJO: ORDS.DEFINE_MODULE **no** es idempotente. Si el módulo ya existe falla
-- con ORA-00001 sobre ORDS_MODULES_UNIQUE1. Por eso se borra primero.
-- Borrar el módulo no toca datos: solo la definición del servicio REST.
--
-- Sin EXCEPTION a propósito: si el DELETE falla (típicamente ORA-00060, otra
-- sesión con una transacción abierta sobre ORDS_MODULES), hay que verlo. Un
-- "WHEN OTHERS THEN NULL" acá hace creer que borró y después el DEFINE choca
-- con ORA-00001 sin explicación.
DECLARE
  l_existe NUMBER;
BEGIN
  SELECT COUNT(*) INTO l_existe FROM user_ords_modules WHERE name = 'recibos';
  IF l_existe > 0 THEN
    ORDS.DELETE_MODULE(p_module_name => 'recibos');
    COMMIT;
  END IF;
END;
/

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
      p_module_name    => 'recibos',
      p_base_path      => '/recibos/',
      p_items_per_page => 25,
      p_status         => 'PUBLISHED',
      p_comments       => NULL);


  -- ==================================================================
  -- LISTADO   GET /recibos/?limit=&offset=&q=&desde=&hasta=&anulados=
  -- ==================================================================
  -- A diferencia del resto de la app, acá NO se trae todo y se filtra en el
  -- cliente: la tabla tiene más de 130.000 recibos. Se pagina y se busca en
  -- el servidor. La respuesta imita el feed de ORDS ({items, hasMore}) para
  -- que el cliente HTTP no tenga que aprender otro formato.
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'recibos',
      p_pattern        => '.',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'recibos',
      p_pattern        => '.',
      p_method         => 'GET',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      DECLARE
        l_user     VARCHAR2(255);
        l_admin    VARCHAR2(1);
        l_limit    NUMBER       := LEAST(NVL(:limit, 50), 500);
        l_offset   NUMBER       := NVL(:offset, 0);
        l_q        VARCHAR2(200):= UPPER(TRIM(:q));
        l_desde    DATE;
        l_hasta    DATE;
        l_anulados VARCHAR2(1)  := NVL(UPPER(:anulados), ''N'');
        l_cnt      NUMBER       := 0;
      BEGIN
        -- Mismo patron que solicitudes/precios y solicitudes/lov/relaciones.
        l_user := pkg_auth_token.validar_token(REPLACE(:authorization, ''Bearer '', ''''));
        IF l_user IS NULL THEN
          :status_code := 401;
          htp.p(''{"success": false, "message": "Token invalido o expirado"}'');
          RETURN;
        END IF;
        -- Sin llamar a pkg_recibos: si el paquete queda INVALID, un GET que lo
        -- invoque devuelve 500 sin cabeceras y el navegador lo reporta como
        -- error de CORS. Los GET del resto de la app tampoco usan paquetes.
        l_admin := CASE WHEN UPPER(TRIM(l_user)) = ''JOSEG'' THEN ''S'' ELSE ''N'' END;

        BEGIN l_desde := TO_DATE(:desde, ''YYYY-MM-DD''); EXCEPTION WHEN OTHERS THEN l_desde := NULL; END;
        BEGIN l_hasta := TO_DATE(:hasta, ''YYYY-MM-DD''); EXCEPTION WHEN OTHERS THEN l_hasta := NULL; END;

        apex_json.open_object;
        apex_json.write(''success'', TRUE);
        apex_json.open_array(''items'');

        FOR r IN (
          SELECT cc.nro_recibo,
                 cc.fecha_recibo,
                 cc.cod_cliente,
                 NVL(c.ci, c.ruc) || '' '' || c.razon_social AS nombre,
                 c.nro_telefono,
                 cc.concepto,
                 v.nro_solicitud,
                 vc.nro_cuota,
                 cc.monto,
                 cc.total_interes,
                 cc.id_solicitud,
                 cc.id_cuota,
                 NVL(cc.anulado, ''N'') AS anulado,
                 cc.cod_usuario
            FROM cuotas_cobradas cc
            JOIN clientes        c  ON c.cod_cliente = cc.cod_cliente
            JOIN ventas_cabecera v  ON v.id  = cc.id_solicitud
            JOIN ventas_cuotas   vc ON vc.id = cc.id_solicitud
                                   AND vc.id_detalle = cc.id_cuota
           WHERE (l_admin = ''S'' OR UPPER(cc.cod_usuario) = l_user)
             AND (l_anulados = ''T'' OR NVL(cc.anulado, ''N'') = l_anulados)
             AND (l_desde IS NULL OR cc.fecha_recibo >= l_desde)
             AND (l_hasta IS NULL OR cc.fecha_recibo <  l_hasta + 1)
             AND (l_q IS NULL
                  OR UPPER(c.razon_social) LIKE ''%'' || l_q || ''%''
                  OR TO_CHAR(cc.nro_recibo)    LIKE ''%'' || l_q || ''%''
                  OR TO_CHAR(v.nro_solicitud)  LIKE ''%'' || l_q || ''%''
                  OR REPLACE(NVL(c.ci, c.ruc), ''.'', '''') LIKE ''%'' || REPLACE(l_q, ''.'', '''') || ''%'')
           ORDER BY cc.fecha_recibo DESC, cc.nro_recibo DESC
           OFFSET l_offset ROWS FETCH NEXT l_limit + 1 ROWS ONLY
        ) LOOP
          l_cnt := l_cnt + 1;
          EXIT WHEN l_cnt > l_limit;   -- la fila extra solo sirve para saber si hay mas

          apex_json.open_object;
          apex_json.write(''nro_recibo'',    r.nro_recibo);
          apex_json.write(''fecha_recibo'',  TO_CHAR(r.fecha_recibo, ''YYYY-MM-DD''));
          apex_json.write(''cod_cliente'',   r.cod_cliente);
          apex_json.write(''nombre'',        r.nombre);
          apex_json.write(''nro_telefono'',  r.nro_telefono);
          apex_json.write(''concepto'',      r.concepto);
          apex_json.write(''nro_solicitud'', r.nro_solicitud);
          apex_json.write(''nro_cuota'',     r.nro_cuota);
          apex_json.write(''monto'',         r.monto);
          apex_json.write(''total_interes'', r.total_interes);
          apex_json.write(''id_solicitud'',  r.id_solicitud);
          apex_json.write(''id_cuota'',      r.id_cuota);
          apex_json.write(''anulado'',       r.anulado);
          apex_json.write(''cod_usuario'',   r.cod_usuario);
          apex_json.close_object;
        END LOOP;

        apex_json.close_array;
        apex_json.write(''hasMore'', l_cnt > l_limit);
        apex_json.close_object;
      EXCEPTION WHEN OTHERS THEN
        :status_code := 500;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_PARAMETER(p_module_name => 'recibos', p_pattern => '.', p_method => 'GET',
      p_name => 'authorization', p_bind_variable_name => 'authorization',
      p_source_type => 'HEADER', p_param_type => 'STRING', p_access_method => 'IN', p_comments => NULL);


  -- ==================================================================
  -- ALTA   POST /recibos/
  -- ==================================================================
  ORDS.DEFINE_HANDLER(
      p_module_name    => 'recibos',
      p_pattern        => '.',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      DECLARE
        l_user VARCHAR2(255);
        l_nro  NUMBER;
      BEGIN
        -- Mismo patron que solicitudes/precios y solicitudes/lov/relaciones.
        l_user := pkg_auth_token.validar_token(REPLACE(:authorization, ''Bearer '', ''''));
        IF l_user IS NULL THEN
          :status_code := 401;
          htp.p(''{"success": false, "message": "Token invalido o expirado"}'');
          RETURN;
        END IF;

        l_nro := pkg_recibos.crear(
          p_cod_cliente  => :cod_cliente,
          p_id_solicitud => :id_solicitud,
          p_id_cuota     => :id_cuota,
          p_monto        => :monto,
          p_cod_usuario  => l_user,          -- del token, nunca del body
          p_fecha_recibo => NVL(TO_DATE(:fecha_recibo, ''YYYY-MM-DD''), SYSDATE),
          p_concepto     => :concepto,
          p_cod_cobrador => :cod_cobrador);

        :status_code := 201;
        htp.p(''{"success": true, "nro_recibo": '' || l_nro || ''}'');
      EXCEPTION WHEN OTHERS THEN
        :status_code := 400;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_PARAMETER(p_module_name => 'recibos', p_pattern => '.', p_method => 'POST',
      p_name => 'authorization', p_bind_variable_name => 'authorization',
      p_source_type => 'HEADER', p_param_type => 'STRING', p_access_method => 'IN', p_comments => NULL);


  -- ==================================================================
  -- EDICIÓN   PUT /recibos/
  -- ==================================================================
  -- La PK va en el body porque son tres columnas.
  ORDS.DEFINE_HANDLER(
      p_module_name    => 'recibos',
      p_pattern        => '.',
      p_method         => 'PUT',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      DECLARE
        l_user VARCHAR2(255);
      BEGIN
        -- Mismo patron que solicitudes/precios y solicitudes/lov/relaciones.
        l_user := pkg_auth_token.validar_token(REPLACE(:authorization, ''Bearer '', ''''));
        IF l_user IS NULL THEN
          :status_code := 401;
          htp.p(''{"success": false, "message": "Token invalido o expirado"}'');
          RETURN;
        END IF;

        pkg_recibos.actualizar(
          p_nro_recibo   => :nro_recibo,
          p_id_solicitud => :id_solicitud,
          p_id_cuota     => :id_cuota,
          p_monto        => :monto,
          p_cod_usuario  => l_user,          -- del token, nunca del body
          p_concepto     => :concepto,
          p_fecha_recibo => TO_DATE(:fecha_recibo, ''YYYY-MM-DD''));

        :status_code := 200;
        htp.p(''{"success": true}'');
      EXCEPTION WHEN OTHERS THEN
        :status_code := 400;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_PARAMETER(p_module_name => 'recibos', p_pattern => '.', p_method => 'PUT',
      p_name => 'authorization', p_bind_variable_name => 'authorization',
      p_source_type => 'HEADER', p_param_type => 'STRING', p_access_method => 'IN', p_comments => NULL);


  -- ==================================================================
  -- DETALLE   GET /recibos/:nro_recibo
  -- ==================================================================
  -- La PK es (NRO_RECIBO, ID_SOLICITUD, ID_CUOTA), así que en teoría un mismo
  -- número puede tener varias filas. Se devuelven todas; en la práctica es una.
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'recibos',
      p_pattern        => ':nro_recibo',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'recibos',
      p_pattern        => ':nro_recibo',
      p_method         => 'GET',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      DECLARE
        l_user  VARCHAR2(255);
        l_admin VARCHAR2(1);
      BEGIN
        -- Mismo patron que solicitudes/precios y solicitudes/lov/relaciones.
        l_user := pkg_auth_token.validar_token(REPLACE(:authorization, ''Bearer '', ''''));
        IF l_user IS NULL THEN
          :status_code := 401;
          htp.p(''{"success": false, "message": "Token invalido o expirado"}'');
          RETURN;
        END IF;
        -- Sin llamar a pkg_recibos: si el paquete queda INVALID, un GET que lo
        -- invoque devuelve 500 sin cabeceras y el navegador lo reporta como
        -- error de CORS. Los GET del resto de la app tampoco usan paquetes.
        l_admin := CASE WHEN UPPER(TRIM(l_user)) = ''JOSEG'' THEN ''S'' ELSE ''N'' END;

        apex_json.open_object;
        apex_json.write(''success'', TRUE);
        apex_json.open_array(''items'');
        FOR r IN (
          SELECT cc.nro_recibo,
                 cc.fecha_recibo,
                 cc.cod_cliente,
                 NVL(c.ci, c.ruc)  AS documento,
                 c.razon_social,
                 c.nro_telefono,
                 cc.concepto,
                 v.nro_solicitud,
                 vc.nro_cuota,
                 vc.monto_cuota,
                 cc.monto,
                 cc.total_interes,
                 cc.saldo_cuota,
                 cc.fec_vencimiento,
                 cc.id_solicitud,
                 cc.id_cuota,
                 NVL(cc.anulado, ''N'') AS anulado,
                 cc.cod_usuario,
                 FN_CUOTAS(cc.id_solicitud, cc.id_cuota) AS cuota_texto,
                 FN_USUARIO(cc.cod_usuario)              AS nombre_usuario,
                 NUM_LETRAS(cc.monto)                    AS monto_letras
            FROM cuotas_cobradas cc
            JOIN clientes        c  ON c.cod_cliente = cc.cod_cliente
            JOIN ventas_cabecera v  ON v.id  = cc.id_solicitud
            JOIN ventas_cuotas   vc ON vc.id = cc.id_solicitud
                                   AND vc.id_detalle = cc.id_cuota
           WHERE cc.nro_recibo = :nro_recibo
             AND (l_admin = ''S'' OR UPPER(cc.cod_usuario) = l_user)
        ) LOOP
          apex_json.open_object;
          apex_json.write(''nro_recibo'',     r.nro_recibo);
          apex_json.write(''fecha_recibo'',   TO_CHAR(r.fecha_recibo, ''YYYY-MM-DD''));
          apex_json.write(''cod_cliente'',    r.cod_cliente);
          apex_json.write(''documento'',      r.documento);
          apex_json.write(''razon_social'',   r.razon_social);
          apex_json.write(''nro_telefono'',   r.nro_telefono);
          apex_json.write(''concepto'',       r.concepto);
          apex_json.write(''nro_solicitud'',  r.nro_solicitud);
          apex_json.write(''nro_cuota'',      r.nro_cuota);
          apex_json.write(''monto_cuota'',    r.monto_cuota);
          apex_json.write(''monto'',          r.monto);
          apex_json.write(''total_interes'',  r.total_interes);
          apex_json.write(''saldo_cuota'',    r.saldo_cuota);
          apex_json.write(''fec_vencimiento'',TO_CHAR(r.fec_vencimiento, ''YYYY-MM-DD''));
          apex_json.write(''id_solicitud'',   r.id_solicitud);
          apex_json.write(''id_cuota'',       r.id_cuota);
          apex_json.write(''anulado'',        r.anulado);
          apex_json.write(''cod_usuario'',    r.cod_usuario);
          apex_json.write(''cuota_texto'',    r.cuota_texto);
          apex_json.write(''nombre_usuario'', r.nombre_usuario);
          apex_json.write(''monto_letras'',   r.monto_letras);
          apex_json.close_object;
        END LOOP;
        apex_json.close_array;
        apex_json.close_object;
      EXCEPTION WHEN OTHERS THEN
        :status_code := 500;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_PARAMETER(p_module_name => 'recibos', p_pattern => ':nro_recibo', p_method => 'GET',
      p_name => 'authorization', p_bind_variable_name => 'authorization',
      p_source_type => 'HEADER', p_param_type => 'STRING', p_access_method => 'IN', p_comments => NULL);


  -- ==================================================================
  -- ANULACIÓN   POST /recibos/anular
  -- ==================================================================
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'recibos',
      p_pattern        => 'anular',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'recibos',
      p_pattern        => 'anular',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      DECLARE
        l_user VARCHAR2(255);
      BEGIN
        -- Mismo patron que solicitudes/precios y solicitudes/lov/relaciones.
        l_user := pkg_auth_token.validar_token(REPLACE(:authorization, ''Bearer '', ''''));
        IF l_user IS NULL THEN
          :status_code := 401;
          htp.p(''{"success": false, "message": "Token invalido o expirado"}'');
          RETURN;
        END IF;

        pkg_recibos.anular(
          p_nro_recibo   => :nro_recibo,
          p_id_solicitud => :id_solicitud,
          p_id_cuota     => :id_cuota,
          p_cod_usuario  => l_user,          -- del token, nunca del body
          p_anulado      => NVL(:anulado, ''S''));

        :status_code := 200;
        htp.p(''{"success": true}'');
      EXCEPTION WHEN OTHERS THEN
        :status_code := 400;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_PARAMETER(p_module_name => 'recibos', p_pattern => 'anular', p_method => 'POST',
      p_name => 'authorization', p_bind_variable_name => 'authorization',
      p_source_type => 'HEADER', p_param_type => 'STRING', p_access_method => 'IN', p_comments => NULL);


  -- ==================================================================
  -- DERIVACIÓN   POST /recibos/derivar
  -- ==================================================================
  -- Página 4 de APEX ("Cuotas"): marca FEC_DERIVACION en la cuota.
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'recibos',
      p_pattern        => 'derivar',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'recibos',
      p_pattern        => 'derivar',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      DECLARE
        l_user VARCHAR2(255);
      BEGIN
        l_user := pkg_auth_token.validar_token(REPLACE(:authorization, ''Bearer '', ''''));
        IF l_user IS NULL THEN
          :status_code := 401;
          htp.p(''{"success": false, "message": "Token invalido o expirado"}'');
          RETURN;
        END IF;

        pkg_recibos.derivar(
          p_id_solicitud     => :id_solicitud,
          p_id_cuota         => :id_cuota,
          p_fecha_derivacion => TO_DATE(:fecha_derivacion, ''YYYY-MM-DD''));

        :status_code := 200;
        htp.p(''{"success": true}'');
      EXCEPTION WHEN OTHERS THEN
        :status_code := 400;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_PARAMETER(p_module_name => 'recibos', p_pattern => 'derivar', p_method => 'POST',
      p_name => 'authorization', p_bind_variable_name => 'authorization',
      p_source_type => 'HEADER', p_param_type => 'STRING', p_access_method => 'IN', p_comments => NULL);


  -- ==================================================================
  -- FICHA DEL CLIENTE   GET /recibos/cliente/:cod_cliente   [EN DESUSO]
  -- ==================================================================
  -- Página 10 de APEX ("Consulta de Clientes"), proceso GET_DATOS_CLIENTE.
  --
  -- OJO: el frontend YA NO LLAMA A ESTE HANDLER. Desde el navegador respondía
  -- sin cabeceras CORS (o sea: reventaba), así que el mismo SELECT se republicó
  -- en el módulo `consultas` -> GET /consultas/cliente/:cod_cliente
  -- (backend/consultas.sql). Se deja acá a propósito, sin tocar, para poder
  -- comparar los dos con curl y saber si este módulo quedó dañado: el cotejo
  -- está en la sección 3.d de consultas.sql. Si se confirma que anda bien, se
  -- puede borrar este bloque; si se confirma que no, hay que redesplegar el
  -- módulo `recibos` entero.
  --
  -- El original unía CLIENTES con CIUDADES con un INNER JOIN
  -- (`from clientes cl, ciudades ci where ci.cod_ciudad = cl.cod_ciudad`), así
  -- que un cliente sin ciudad cargada NO devolvía filas y la pantalla decía
  -- "Cliente no encontrado o sin datos" aunque el cliente existiera. Acá va
  -- LEFT JOIN: la ciudad viene NULL y el resto de los datos se muestra igual.
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'recibos',
      p_pattern        => 'cliente/:cod_cliente',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'recibos',
      p_pattern        => 'cliente/:cod_cliente',
      p_method         => 'GET',
      p_source_type    => 'json/query;type=single',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'      SELECT cl.cod_cliente,
             cl.razon_social,
             NVL(cl.ci, cl.ruc)  AS documento,
             cl.nro_telefono,
             ci.descripcion      AS ciudad,
             cl.direccion,
             cl.nro_casa,
             cl.ubicacion
      FROM   clientes cl
      LEFT JOIN ciudades ci ON ci.cod_ciudad = cl.cod_ciudad
      WHERE  cl.cod_cliente = :cod_cliente
    ');


  -- ==================================================================
  -- UBICACIÓN   POST /recibos/ubicacion
  -- ==================================================================
  -- Página 6 de APEX ("Cargar Ubicación"): guarda CLIENTES.UBICACION.
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'recibos',
      p_pattern        => 'ubicacion',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'recibos',
      p_pattern        => 'ubicacion',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      DECLARE
        l_user VARCHAR2(255);
      BEGIN
        l_user := pkg_auth_token.validar_token(REPLACE(:authorization, ''Bearer '', ''''));
        IF l_user IS NULL THEN
          :status_code := 401;
          htp.p(''{"success": false, "message": "Token invalido o expirado"}'');
          RETURN;
        END IF;

        pkg_recibos.guardar_ubicacion(
          p_cod_cliente => :cod_cliente,
          p_ubicacion   => :ubicacion);

        :status_code := 200;
        htp.p(''{"success": true}'');
      EXCEPTION WHEN OTHERS THEN
        :status_code := 400;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_PARAMETER(p_module_name => 'recibos', p_pattern => 'ubicacion', p_method => 'POST',
      p_name => 'authorization', p_bind_variable_name => 'authorization',
      p_source_type => 'HEADER', p_param_type => 'STRING', p_access_method => 'IN', p_comments => NULL);


  -- ==================================================================
  -- LOV 1   GET /recibos/lov/clientes?q=
  -- ==================================================================
  -- Solo clientes con alguna cuota con saldo. Es el LOV de P3_COD_CLIENTE.
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'recibos',
      p_pattern        => 'lov/clientes',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'recibos',
      p_pattern        => 'lov/clientes',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
-- Sin filtro de búsqueda: devuelve la lista completa y el cliente filtra.
--
-- OJO: NO agregar un bind `:q` acá. En ORDS `q` es un parámetro RESERVADO
-- (lo usa para su filtro JSON `?q={"col":"valor"}`), así que jamás llega al
-- handler y el filtro parece "no andar". Es el mismo motivo por el que
-- solicitudes/lov/clientes tampoco filtra en el servidor y src/lib/api.ts
-- resuelve la búsqueda con filtrarLov(). Si alguna vez hace falta filtrar del
-- lado de Oracle, usar otro nombre de parámetro (`buscar`, por ejemplo).
--
-- Se devuelven todos los campos útiles (fantasía, CI, RUC, teléfono) porque el
-- filtro del cliente busca sobre TODOS los valores de cada fila.
'      SELECT cl.cod_cliente                                        AS value,
             NVL(cl.ci, cl.ruc) || '' '' || cl.razon_social         AS label,
             cl.ci, cl.ruc, cl.nro_telefono, cl.nombre_fantasia
      FROM   clientes cl
      WHERE  cl.razon_social IS NOT NULL
      AND    EXISTS (SELECT 1
                     FROM   ventas_cabecera c
                     JOIN   ventas_cuotas  c1 ON c.id = c1.id
                     WHERE  c.cod_cliente = cl.cod_cliente
                     AND    NVL(c1.saldo_cuota, 0) <> 0)
      ORDER BY cl.razon_social ASC
    ');


  -- ==================================================================
  -- LOV 1b  GET /recibos/lov/clientes-todos
  -- ==================================================================
  -- Igual al anterior pero SIN el filtro de deuda: es el LOV de la página 5
  -- (ubicaciones), que lista todos los clientes. Trae UBICACION para no tener
  -- que pedir la ficha del cliente en una segunda llamada.
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'recibos',
      p_pattern        => 'lov/clientes-todos',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'recibos',
      p_pattern        => 'lov/clientes-todos',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'      SELECT cl.cod_cliente                                        AS value,
             NVL(cl.ci, cl.ruc) || '' '' || cl.razon_social         AS label,
             cl.ci, cl.ruc, cl.nro_telefono, cl.nombre_fantasia,
             cl.ubicacion
      FROM   clientes cl
      WHERE  cl.razon_social IS NOT NULL
      ORDER BY cl.razon_social ASC
    ');


  -- ==================================================================
  -- LOV 2   GET /recibos/lov/solicitudes/:cod_cliente
  -- ==================================================================
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'recibos',
      p_pattern        => 'lov/solicitudes/:cod_cliente',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'recibos',
      p_pattern        => 'lov/solicitudes/:cod_cliente',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'      SELECT a.id                                                   AS value,
             a.nro_solicitud || '' - '' || RETORNA_ARTICULOS(a.id)   AS label,
             a.nro_solicitud,
             a.cantidad_cuotas,
             a.total,
             (SELECT NVL(SUM(NVL(x.saldo_cuota,0)), 0)
                FROM ventas_cuotas x WHERE x.id = a.id)              AS saldo_total
      FROM   ventas_cabecera a
      WHERE  a.cod_cliente = :cod_cliente
      AND    EXISTS (SELECT 1 FROM ventas_cuotas c1 WHERE c1.id = a.id)
      ORDER BY a.id DESC
    ');


  -- ==================================================================
  -- LOV 3   GET /recibos/lov/cuotas/:id_solicitud
  -- ==================================================================
  -- NRO_CUOTA = 0 es la entrega inicial (la crea TRG_CUOTA_INICIAL).
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'recibos',
      p_pattern        => 'lov/cuotas/:id_solicitud',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'recibos',
      p_pattern        => 'lov/cuotas/:id_solicitud',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'      SELECT id_detalle                                             AS value,
             CASE WHEN nro_cuota = 0 THEN ''Entrega inicial''
                  ELSE ''Cuota '' || nro_cuota END
               || '' - Saldo: '' || TO_CHAR(NVL(saldo_cuota,0), ''FM999G999G999G990'') AS label,
             nro_cuota,
             monto_cuota,
             NVL(saldo_cuota, 0)                                     AS saldo_cuota,
             TO_CHAR(fec_vencimiento, ''YYYY-MM-DD'')                AS fec_vencimiento,
             TO_CHAR(fec_derivacion,  ''YYYY-MM-DD'')                AS fec_derivacion
      FROM   ventas_cuotas
      WHERE  id = :id_solicitud
      AND    (:con_saldo IS NULL OR NVL(saldo_cuota, 0) <> 0)
      ORDER BY nro_cuota ASC
    ');


  -- ==================================================================
  -- DATOS DE LA CUOTA   GET /recibos/cuota/:cod_cliente/:id_solicitud/:id_cuota
  -- ==================================================================
  -- Equivale a la acción dinámica CALCULOS de la página 3: al elegir la cuota
  -- devuelve saldo, interés, vencimiento y el concepto sugerido.
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'recibos',
      p_pattern        => 'cuota/:cod_cliente/:id_solicitud/:id_cuota',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'recibos',
      p_pattern        => 'cuota/:cod_cliente/:id_solicitud/:id_cuota',
      p_method         => 'GET',
      p_source_type    => 'json/query;type=single',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'      SELECT NVL(s.saldo_cuota, 0)                     AS saldo_cuota,
             NVL(s.total_interes, 0)                    AS total_interes,
             TO_CHAR(s.fec_vencimiento, ''YYYY-MM-DD'') AS fec_vencimiento,
             RETORNA_ARTICULOS(:id_solicitud)           AS concepto,
             FN_CUOTAS(:id_solicitud, :id_cuota)        AS cuota_texto
      FROM   v_saldos s
      WHERE  s.cod_cliente  = :cod_cliente
      AND    s.id_solicitud = :id_solicitud
      AND    s.id_cuota     = :id_cuota
    ');


  -- ==================================================================
  -- MONTO EN LETRAS   GET /recibos/letras/:monto
  -- ==================================================================
  -- Para el recibo impreso. NUM_LETRAS vive en la base, no se reimplementa en JS.
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'recibos',
      p_pattern        => 'letras/:monto',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'recibos',
      p_pattern        => 'letras/:monto',
      p_method         => 'GET',
      p_source_type    => 'json/query;type=single',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'      SELECT NUM_LETRAS(:monto) AS monto_letras FROM dual
    ');

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
-- a) ¿Hay números de recibo duplicados? Los triggers BEFORE INSERT que asignan
--    NRO_RECIBO no bloquean nada, y la PK incluye ID_SOLICITUD/ID_CUOTA, así
--    que la base no impide dos recibos distintos con el mismo número.
--    Si esto vuelve vacío, se puede aplicar el paso 1.c.
--
--    SELECT nro_recibo, COUNT(*) c
--      FROM cuotas_cobradas
--     GROUP BY nro_recibo HAVING COUNT(*) > 1
--     ORDER BY c DESC;
--
-- b) ¿Los saldos coinciden con lo efectivamente cobrado?
--
--    SELECT vc.id, vc.nro_cuota, vc.monto_cuota, vc.saldo_cuota,
--           NVL((SELECT SUM(cc.monto) FROM cuotas_cobradas cc
--                 WHERE cc.id_solicitud = vc.id AND cc.id_cuota = vc.id_detalle
--                   AND NVL(cc.anulado,'N') = 'N'), 0) AS cobrado
--      FROM ventas_cuotas vc
--     WHERE vc.monto_cuota - NVL(vc.saldo_cuota,0) <>
--           NVL((SELECT SUM(cc.monto) FROM cuotas_cobradas cc
--                 WHERE cc.id_solicitud = vc.id AND cc.id_cuota = vc.id_detalle
--                   AND NVL(cc.anulado,'N') = 'N'), 0);
--
-- c) ¿Compiló el paquete? Es lo PRIMERO que hay que mirar si el navegador
--    reporta un error de CORS: ORDS devuelve el 500 sin cabeceras CORS, y el
--    browser lo muestra como "No 'Access-Control-Allow-Origin' header".
--    Ningún módulo de este schema define origins_allowed y todos funcionan,
--    así que un error de CORS acá casi siempre es un 500 disfrazado.
--
--    SELECT object_name, object_type, status
--      FROM user_objects
--     WHERE object_name IN ('PKG_RECIBOS','V_SALDOS','RETORNA_ARTICULOS',
--                           'FN_CUOTAS','FN_USUARIO','NUM_LETRAS');
--
--    SELECT line, position, text
--      FROM user_errors WHERE name = 'PKG_RECIBOS' ORDER BY sequence;
--
-- d) Prueba de humo del endpoint (reemplazar <TOKEN> y el host):
--
--    curl -i -H "Authorization: Bearer <TOKEN>" \
--      "https://oracleapex.com/ords/josiasmuebles/recibos/?limit=5"
--
--    Con curl se ve el cuerpo real del error, que el navegador esconde detrás
--    del mensaje de CORS.
