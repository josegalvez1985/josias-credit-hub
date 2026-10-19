-- =====================================================================
-- ENDPOINT: /proveedores  —  "Recibos de Proveedores"
-- Contiene: paquete pkg_recibos_compra + módulo ORDS `proveedores`.
-- Correr como WKSP_JOSIASMUEBLES.
--
-- Pagos a proveedores por facturas de compra a crédito. No migra ninguna
-- página de APEX: las tablas RECIBOS_COMPRA_* son nuevas (2026-09) y esta es
-- su primera pantalla. Es la primera sección del módulo administrativo que
-- ESCRIBE en la base.
--
--   RECIBOS_COMPRA_CABECERA   el recibo            escribe  (PK ID_RECIBO, identity)
--   RECIBOS_COMPRA_DETALLE    facturas que paga    escribe  (FK ID_RECIBO on delete cascade)
--   RECIBOS_COMPRA_PAGOS      con qué se paga      escribe  (FK ID_RECIBO on delete cascade)
--   COMPRAS_CABECERA          la factura           lee y bloquea (FOR UPDATE)
--   COMPRAS_DETALLE           renglones            lee (de acá sale el total)
--   PROVEEDORES               proveedor            lee
--
-- REGLAS DE NEGOCIO (confirmadas por Jose el 2026-09-24)
-- ---------------------------------------------------------------------
-- · Factura a crédito = COMPRAS_CABECERA con TIPO = 'C' y CONDICION_COMPRA = 2.
--   TIPO 'S' es inventario y NO entra. CONDICION_COMPRA 1 es contado.
--   Entran los dos MOTIVO ('C' y 'E').
--
-- · COMPRAS_CABECERA no tiene columna de monto. El total de una factura es
--       ROUND(SUM(NVL(cantidad,0) * NVL(precio_unitario,0)))  de COMPRAS_DETALLE
--   con IVA incluido. El ROUND es porque el guaraní no tiene decimales: si un
--   precio unitario trae decimales, sin él quedaría un saldo de 0,4 imposible
--   de pagar.
--   ⚠ La fórmula está repetida en el paquete (saldo_factura) y en los handlers
--   facturas, recibos/:id y lov/proveedores — los GET no llaman al paquete
--   (backend/README.md). Si cambia, buscar "TOTAL DE FACTURA" en este archivo.
--
-- · Saldo = total − SUM(RECIBOS_COMPRA_DETALLE.MONTO_APLICADO). No se guarda en
--   ningún lado: se calcula siempre. Por eso eliminar un recibo "devuelve" el
--   saldo solo, sin tocar nada más.
--
-- · Pagos parciales sí, sobrepago no: MONTO_APLICADO <= saldo de la factura.
--
-- · Todas las facturas de un recibo son del proveedor del recibo.
--
-- · NRO_RECIBO (el número que emite el proveedor) es OBLIGATORIO aunque la
--   columna admite NULL: la UNIQUE (COD_PROVEEDOR, NRO_RECIBO) trata dos
--   (5, NULL) como duplicados, así que el segundo recibo sin número del mismo
--   proveedor daría ORA-00001.
--
-- · FORMAS DE PAGO (2026-10-19): un recibo se paga con UNA O VARIAS, cada
--   una es una fila de RECIBOS_COMPRA_PAGOS. Solo hay tres, y sus datos los
--   exigen los CHECK de la tabla (el paquete los repite para dar un mensaje
--   legible en vez de un ORA-02290):
--       EFECTIVO        solo monto
--       TRANSFERENCIA   nro. de transferencia + monto
--       CHEQUE          nro. de cheque + banco + fecha de emisión + fecha
--                       de vencimiento (>= emisión) + monto
--   BANCO (2026-10-19) no tiene CHECK: que sea obligatorio en el cheque y NULL
--   en las otras formas lo pone el paquete.
--   La emisión del cheque no puede ser posterior a la fecha del recibo; el
--   vencimiento sí puede ser futuro (cheque diferido).
--   QR y tarjetas dejaron de existir. La columna FORMA_PAGO de la cabecera se
--   borró con este cambio, y NRO_COMPROBANTE quedó sin uso: se graba NULL.
--
-- · La fecha no puede ser posterior a hoy (igual que en recibos).
--
-- · MONTO_TOTAL lo calcula el paquete como suma del detalle. El cliente no lo
--   manda. La suma de los pagos tiene que ser EXACTAMENTE igual: no hay
--   anticipos ni saldo a favor del proveedor.
--
-- · Para corregir un error se ELIMINA el recibo y se vuelve a cargar. No hay
--   ANULADO ni edición. El detalle y los pagos se van solos por el ON DELETE
--   CASCADE.
--
-- · Las facturas a crédito anteriores a este módulo aparecen con saldo
--   pendiente completo, aunque se hayan pagado por fuera. Es a propósito: no
--   hay fecha de corte.
--
-- · Sin auditoría por ahora: las tablas no guardan quién cargó el recibo.
--
-- PERMISOS
-- ---------------------------------------------------------------------
-- Solo los usuarios del módulo administrativo, validados CONTRA EL TOKEN en
-- cada handler, lectura incluida. La lista está en TRES lugares y tiene que
-- ser la misma en los tres:
--   1. pkg_recibos_compra.es_admin          (sección 2)
--   2. l_admins del bloque del módulo        (sección 3.b)
--   3. USUARIOS_ADMIN de src/lib/permisos.ts (lo que se dibuja en pantalla)
--
-- "No tenés permiso" responde 400 y NO 403: src/lib/api.ts trata 401/403 como
-- sesión vencida y manda al usuario al login. Un permiso mal cargado haría que
-- un administrador legítimo quede rebotando contra la pantalla de login sin
-- entender por qué. Es el mismo criterio que pkg_recibos (-20210).
-- =====================================================================


-- =====================================================================
-- 1. SANEAMIENTO
-- =====================================================================
-- Las tablas las creó Jose a mano y ya están en producción. Lo que se
-- verificó contra la base:
--
--   · Ninguna de las tres RECIBOS_COMPRA_* tiene triggers (RECIBOS_COMPRA_PAGOS
--     verificada el 2026-10-19). Los ID salen de las IDENTITY (GENERATED BY
--     DEFAULT ON NULL): el INSERT los manda NULL y el de la cabecera se
--     recupera con RETURNING.
--   · COMPRAS_CABECERA/DETALLE solo tienen BI_* (secuencias) y
--     TRG_UPD_FECHA_INV (AFTER INSERT en COMPRAS_DETALLE). Este módulo no
--     inserta ni actualiza en COMPRAS_*: solo las lee y bloquea la cabecera
--     con FOR UPDATE, que no dispara triggers.
--
-- 1.a  Formas de pago en tabla aparte (2026-10-19)            [YA APLICADO]
-- ---------------------------------------------------------------------
-- Jose creó RECIBOS_COMPRA_PAGOS y borró RECIBOS_COMPRA_CABECERA.FORMA_PAGO.
-- Con la columna se perdió la forma de pago de los recibos ya cargados
-- (E/T/Q/D/C) y pkg_recibos_compra quedó INVALID: hasta redesplegar este
-- archivo (secciones 2 y 3) el alta, la baja, el listado de recibos, su
-- detalle y el reporte de saldos responden error.
--
-- 1.b  Pagos de los recibos anteriores al cambio              [A MANO]
-- ---------------------------------------------------------------------
-- RECIBOS_COMPRA_PAGOS arrancó vacía, así que los recibos viejos no dicen
-- con qué se pagaron: las pantallas los muestran "Sin registrar". La forma
-- de pago se perdió, pero NRO_COMPROBANTE sigue y permite deducir una parte:
-- el paquete viejo lo guardaba NULL solo en efectivo y lo exigía en las
-- demás formas.
--
-- Primero mirar cuáles son:
--
--   SELECT rc.id_recibo, rc.nro_recibo, rc.fecha, rc.nro_comprobante, rc.monto_total
--     FROM recibos_compra_cabecera rc
--    WHERE NOT EXISTS (SELECT 1 FROM recibos_compra_pagos p WHERE p.id_recibo = rc.id_recibo)
--    ORDER BY rc.id_recibo;
--
-- Los que no tienen comprobante fueron en efectivo, sin duda:
--
--   INSERT INTO recibos_compra_pagos (id_recibo, forma_pago, monto)
--   SELECT rc.id_recibo, 'EFECTIVO', rc.monto_total
--     FROM recibos_compra_cabecera rc
--    WHERE rc.nro_comprobante IS NULL
--      AND NOT EXISTS (SELECT 1 FROM recibos_compra_pagos p WHERE p.id_recibo = rc.id_recibo);
--
-- Los que tienen comprobante fueron transferencia, QR o tarjeta, y no hay
-- forma de saber cuál. Decidir uno por uno. Si fue transferencia:
--
--   INSERT INTO recibos_compra_pagos (id_recibo, forma_pago, nro_documento, monto)
--   SELECT id_recibo, 'TRANSFERENCIA', nro_comprobante, monto_total
--     FROM recibos_compra_cabecera
--    WHERE id_recibo = <ID>;
--
-- QR y tarjeta no existen más: o se cargan como TRANSFERENCIA o se dejan sin
-- pagos (el saldo de las facturas no cambia: sale del detalle).
--
--   COMMIT;
--
-- 1.c  NRO_COMPROBANTE de la cabecera                          [OPCIONAL]
-- ---------------------------------------------------------------------
-- Ya no se lee ni se escribe. Se puede borrar DESPUÉS de la 1.b, cuando los
-- números que guarda ya estén en RECIBOS_COMPRA_PAGOS:
--
--   ALTER TABLE recibos_compra_cabecera DROP COLUMN nro_comprobante;
--
-- DDL resumido (el completo lo tiene Jose):
--
--   RECIBOS_COMPRA_CABECERA
--     ID_RECIBO        NUMBER identity      PK
--     NRO_RECIBO       VARCHAR2(20)          UK (COD_PROVEEDOR, NRO_RECIBO)
--     COD_PROVEEDOR    NUMBER NOT NULL       FK PROVEEDORES
--     FECHA            DATE NOT NULL         DEFAULT SYSDATE
--     NRO_COMPROBANTE  VARCHAR2(30)          sin uso desde el 2026-10-19
--     MONTO_TOTAL      NUMBER NOT NULL       DEFAULT 0
--     OBSERVACION      VARCHAR2(500)
--
--   RECIBOS_COMPRA_DETALLE
--     ID_DETALLE       NUMBER identity      PK
--     ID_RECIBO        NUMBER NOT NULL       FK cabecera ON DELETE CASCADE
--     ID_CABECERA      NUMBER NOT NULL       FK COMPRAS_CABECERA
--     MONTO_APLICADO   NUMBER NOT NULL       CHECK > 0
--     UK (ID_RECIBO, ID_CABECERA) · índice por ID_CABECERA
--
--   RECIBOS_COMPRA_PAGOS
--     ID_PAGO            NUMBER identity      PK
--     ID_RECIBO          NUMBER NOT NULL       FK cabecera ON DELETE CASCADE · índice
--     FORMA_PAGO         VARCHAR2(15) NOT NULL CHECK EFECTIVO | TRANSFERENCIA | CHEQUE
--     NRO_DOCUMENTO      VARCHAR2(30)          nro. de transferencia o de cheque
--     FECHA_EMISION      DATE                  solo cheque
--     FECHA_VENCIMIENTO  DATE                  solo cheque, CHECK >= FECHA_EMISION
--     MONTO              NUMBER(15,2) NOT NULL CHECK > 0
--     BANCO              VARCHAR2(100)         banco que emite el cheque (agregada 2026-10-19)
--     CHECK RECIBOS_COMPRA_PAG_CK_DATOS: qué datos lleva cada forma (BANCO no entra)
--
--   PROVEEDORES: COD_PROVEEDOR (identity) · NOMBRE · RUC (UK) · CI (UK)


-- =====================================================================
-- 2. PAQUETE — ejecución 1 de 3
-- =====================================================================
CREATE OR REPLACE PACKAGE pkg_recibos_compra AS

  -- 'S' si el usuario puede usar el módulo administrativo. ORDS no bindea
  -- BOOLEAN, por eso 'S'/'N'. Ver "PERMISOS" en la cabecera del archivo.
  FUNCTION es_admin(p_usuario VARCHAR2) RETURN VARCHAR2;

  -- Saldo pendiente de una factura: total − todo lo aplicado en recibos.
  -- Negativo solo si alguien achicó la factura en COMPRAS_DETALLE después de
  -- pagarla.
  FUNCTION saldo_factura(p_id_cabecera NUMBER) RETURN NUMBER;

  -- Graba un recibo completo (cabecera + facturas + pagos) en UNA
  -- transacción. Devuelve el ID_RECIBO.
  --
  -- p_body es el JSON del POST tal cual llega:
  --   {
  --     "cod_proveedor":   12,
  --     "nro_recibo":      "001-001-0000123",
  --     "fecha":           "2026-10-19",          -- YYYY-MM-DD; vacío = hoy
  --     "observacion":     "texto libre",
  --     "facturas": [ { "id_cabecera": 12462, "monto_aplicado": 7040000 }, ... ],
  --     "pagos": [
  --       { "forma_pago": "EFECTIVO",      "monto": 1040000 },
  --       { "forma_pago": "TRANSFERENCIA", "nro_documento": "889911", "monto": 2000000 },
  --       { "forma_pago": "CHEQUE",        "nro_documento": "4471",
  --         "banco": "Banco Continental",
  --         "fecha_emision": "2026-10-19", "fecha_vencimiento": "2026-11-19",
  --         "monto": 4000000 }
  --     ]
  --   }
  -- La suma de "pagos" tiene que ser igual a la de "facturas".
  --
  -- Se recibe el JSON entero y no parámetros sueltos porque facturas y pagos
  -- son arrays y ORDS no bindea arrays. El handler lee :body_text una sola
  -- vez y lo pasa acá.
  FUNCTION crear(p_body CLOB, p_cod_usuario VARCHAR2) RETURN NUMBER;

  -- Borra el recibo; detalle y pagos se van por el ON DELETE CASCADE y el
  -- saldo de las facturas vuelve solo (es calculado).
  PROCEDURE eliminar(p_id_recibo NUMBER, p_cod_usuario VARCHAR2);

END pkg_recibos_compra;
/

CREATE OR REPLACE PACKAGE BODY pkg_recibos_compra AS

  FUNCTION es_admin(p_usuario VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN CASE WHEN UPPER(TRIM(p_usuario)) IN ('AAQUINO', 'AGONZALEZ', 'JOSEG')
                THEN 'S' ELSE 'N' END;
  END es_admin;


  FUNCTION saldo_factura(p_id_cabecera NUMBER) RETURN NUMBER IS
    l_total  NUMBER;
    l_pagado NUMBER;
  BEGIN
    -- TOTAL DE FACTURA (ver cabecera del archivo)
    SELECT ROUND(NVL(SUM(NVL(cantidad, 0) * NVL(precio_unitario, 0)), 0))
      INTO l_total
      FROM compras_detalle
     WHERE id_cabecera = p_id_cabecera;

    SELECT NVL(SUM(monto_aplicado), 0)
      INTO l_pagado
      FROM recibos_compra_detalle
     WHERE id_cabecera = p_id_cabecera;

    RETURN l_total - l_pagado;
  END saldo_factura;


  FUNCTION crear(p_body CLOB, p_cod_usuario VARCHAR2) RETURN NUMBER IS
    l_cod_proveedor   NUMBER;
    l_nro_recibo      VARCHAR2(4000);
    l_fecha_txt       VARCHAR2(4000);
    l_fecha           DATE;
    l_observacion     VARCHAR2(4000);

    l_cant            NUMBER;
    l_con_id          NUMBER;
    l_con_monto       NUMBER;
    l_distintas       NUMBER;
    l_existe          NUMBER;
    l_suma_facturas   NUMBER;
    l_suma_pagos      NUMBER;

    l_id_recibo       NUMBER;
    l_total           NUMBER := 0;

    l_tipo            compras_cabecera.tipo%TYPE;
    l_condicion       compras_cabecera.condicion_compra%TYPE;
    l_prov_factura    compras_cabecera.cod_proveedor%TYPE;
    l_factura         VARCHAR2(100);
    l_saldo           NUMBER;

    l_forma           VARCHAR2(4000);
    l_nro_doc         VARCHAR2(4000);
    l_emision         DATE;
    l_vencimiento     DATE;
    l_banco           VARCHAR2(4000);
    l_pago            VARCHAR2(100);   -- "Pago 2 (cheque)", para los mensajes
  BEGIN
    IF es_admin(p_cod_usuario) <> 'S' THEN
      RAISE_APPLICATION_ERROR(-20500,
        'No tenés permiso para cargar recibos de proveedores.');
    END IF;

    IF p_body IS NULL OR DBMS_LOB.GETLENGTH(p_body) = 0 THEN
      RAISE_APPLICATION_ERROR(-20501, 'El pedido llegó vacío');
    END IF;

    ------------------------------------------------------------------
    -- Cabecera. JSON_TABLE devuelve NULL en un campo que no se puede
    -- convertir (NULL ON ERROR) y cero filas si el texto no es JSON.
    ------------------------------------------------------------------
    BEGIN
      SELECT jt.cod_proveedor, jt.nro_recibo, jt.fecha, jt.observacion
        INTO l_cod_proveedor, l_nro_recibo, l_fecha_txt, l_observacion
        FROM JSON_TABLE(p_body, '$'
               COLUMNS (cod_proveedor   NUMBER         PATH '$.cod_proveedor',
                        nro_recibo      VARCHAR2(4000) PATH '$.nro_recibo',
                        fecha           VARCHAR2(4000) PATH '$.fecha',
                        observacion     VARCHAR2(4000) PATH '$.observacion')) jt;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20501, 'El pedido no es un JSON válido');
    END;

    -- En Oracle '' es NULL, así que un campo vacío o con espacios queda NULL.
    l_nro_recibo  := TRIM(l_nro_recibo);
    l_observacion := TRIM(l_observacion);

    IF l_cod_proveedor IS NULL THEN
      RAISE_APPLICATION_ERROR(-20502, 'Falta el proveedor');
    END IF;

    SELECT COUNT(*) INTO l_existe FROM proveedores WHERE cod_proveedor = l_cod_proveedor;
    IF l_existe = 0 THEN
      RAISE_APPLICATION_ERROR(-20503, 'El proveedor no existe');
    END IF;

    IF l_nro_recibo IS NULL THEN
      RAISE_APPLICATION_ERROR(-20504, 'Falta el número de recibo del proveedor');
    END IF;
    IF LENGTH(l_nro_recibo) > 20 THEN
      RAISE_APPLICATION_ERROR(-20505, 'El número de recibo admite hasta 20 caracteres');
    END IF;

    -- La UNIQUE lo impediría igual, pero con un ORA-00001 que no dice nada.
    SELECT COUNT(*) INTO l_existe
      FROM recibos_compra_cabecera
     WHERE cod_proveedor = l_cod_proveedor
       AND nro_recibo    = l_nro_recibo;
    IF l_existe > 0 THEN
      RAISE_APPLICATION_ERROR(-20506,
        'Ya existe el recibo N° ' || l_nro_recibo || ' de este proveedor');
    END IF;

    IF l_fecha_txt IS NULL THEN
      l_fecha := TRUNC(SYSDATE);
    ELSE
      BEGIN
        l_fecha := TO_DATE(l_fecha_txt, 'YYYY-MM-DD');
      EXCEPTION
        WHEN OTHERS THEN
          RAISE_APPLICATION_ERROR(-20507, 'Fecha inválida: se espera AAAA-MM-DD');
      END;
    END IF;
    IF l_fecha > TRUNC(SYSDATE) THEN
      RAISE_APPLICATION_ERROR(-20508, 'La fecha no puede ser posterior a hoy');
    END IF;

    -- -20509 a -20512 eran de FORMA_PAGO/NRO_COMPROBANTE de la cabecera
    -- (hasta el 2026-10-19). No se reusan para no confundir errores viejos.

    IF LENGTH(l_observacion) > 500 THEN
      RAISE_APPLICATION_ERROR(-20513, 'La observación admite hasta 500 caracteres');
    END IF;

    ------------------------------------------------------------------
    -- Forma del detalle, antes de tocar nada
    ------------------------------------------------------------------
    SELECT COUNT(*), COUNT(id_cabecera), COUNT(monto_aplicado), COUNT(DISTINCT id_cabecera),
           NVL(SUM(monto_aplicado), 0)
      INTO l_cant, l_con_id, l_con_monto, l_distintas, l_suma_facturas
      FROM JSON_TABLE(p_body, '$.facturas[*]'
             COLUMNS (id_cabecera    NUMBER PATH '$.id_cabecera',
                      monto_aplicado NUMBER PATH '$.monto_aplicado'));

    IF l_cant = 0 THEN
      RAISE_APPLICATION_ERROR(-20514, 'El recibo tiene que pagar al menos una factura');
    END IF;
    IF l_con_id < l_cant OR l_con_monto < l_cant THEN
      RAISE_APPLICATION_ERROR(-20515, 'Hay facturas sin identificar o sin monto');
    END IF;
    -- RECIBOS_COMPRA_DET_UK lo impediría igual, con ORA-00001.
    IF l_distintas < l_cant THEN
      RAISE_APPLICATION_ERROR(-20516, 'Una factura aparece dos veces en el recibo');
    END IF;

    ------------------------------------------------------------------
    -- Forma de los pagos, antes de tocar nada. El detalle de cada uno
    -- (datos según la forma) se valida al grabarlo, más abajo.
    ------------------------------------------------------------------
    SELECT COUNT(*), COUNT(monto), NVL(SUM(monto), 0)
      INTO l_cant, l_con_monto, l_suma_pagos
      FROM JSON_TABLE(p_body, '$.pagos[*]'
             COLUMNS (monto NUMBER PATH '$.monto'));

    IF l_cant = 0 THEN
      RAISE_APPLICATION_ERROR(-20526, 'Falta la forma de pago: el recibo tiene que tener al menos un pago');
    END IF;
    IF l_con_monto < l_cant THEN
      RAISE_APPLICATION_ERROR(-20527, 'Hay pagos sin monto');
    END IF;

    -- Lo pagado tiene que ser exactamente lo aplicado: no hay anticipos ni
    -- saldo a favor del proveedor.
    IF l_suma_pagos <> l_suma_facturas THEN
      RAISE_APPLICATION_ERROR(-20528,
        'Los pagos suman ' || TO_CHAR(l_suma_pagos, 'FM999G999G999G990') ||
        ' y lo aplicado a las facturas ' || TO_CHAR(l_suma_facturas, 'FM999G999G999G990') ||
        ': tienen que ser iguales');
    END IF;

    -- El mismo cheque o la misma transferencia cargada dos veces.
    SELECT COUNT(*), COUNT(DISTINCT UPPER(TRIM(forma_pago)) || '|' || TRIM(nro_documento))
      INTO l_cant, l_distintas
      FROM JSON_TABLE(p_body, '$.pagos[*]'
             COLUMNS (forma_pago    VARCHAR2(4000) PATH '$.forma_pago',
                      nro_documento VARCHAR2(4000) PATH '$.nro_documento'))
     WHERE TRIM(nro_documento) IS NOT NULL
       AND UPPER(TRIM(forma_pago)) <> 'EFECTIVO';
    IF l_distintas < l_cant THEN
      RAISE_APPLICATION_ERROR(-20539, 'Un mismo número de transferencia o cheque aparece dos veces');
    END IF;

    ------------------------------------------------------------------
    -- Cabecera. MONTO_TOTAL arranca en 0 y se fija al final con la suma
    -- real del detalle. Todo esto es una sola transacción: si una factura
    -- o un pago falla, el ROLLBACK de abajo se lleva también la cabecera.
    -- NRO_COMPROBANTE queda NULL: el número va en cada pago.
    ------------------------------------------------------------------
    BEGIN
      INSERT INTO recibos_compra_cabecera (
        id_recibo, nro_recibo, cod_proveedor, fecha, monto_total, observacion
      ) VALUES (
        NULL, l_nro_recibo, l_cod_proveedor, l_fecha, 0, l_observacion
      )
      RETURNING id_recibo INTO l_id_recibo;
    EXCEPTION
      -- Dos personas cargando el mismo recibo a la vez: el chequeo de arriba
      -- no lo ve porque el otro todavía no hizo COMMIT.
      WHEN DUP_VAL_ON_INDEX THEN
        RAISE_APPLICATION_ERROR(-20506,
          'Ya existe el recibo N° ' || l_nro_recibo || ' de este proveedor');
    END;

    ------------------------------------------------------------------
    -- Facturas. Se recorren ORDENADAS POR ID a propósito: cada una se
    -- bloquea con FOR UPDATE, y dos recibos que pagan las mismas facturas
    -- en distinto orden se bloquearían entre sí (ORA-00060). En el mismo
    -- orden, el segundo simplemente espera al primero y después ve el
    -- saldo ya descontado, así que no hay forma de pagar dos veces.
    ------------------------------------------------------------------
    FOR d IN (
      SELECT id_cabecera, monto_aplicado
        FROM JSON_TABLE(p_body, '$.facturas[*]'
               COLUMNS (id_cabecera    NUMBER PATH '$.id_cabecera',
                        monto_aplicado NUMBER PATH '$.monto_aplicado'))
       ORDER BY id_cabecera
    ) LOOP
      BEGIN
        SELECT tipo, condicion_compra, cod_proveedor,
               NVL(referencia, 'ID ' || id_cabecera)
          INTO l_tipo, l_condicion, l_prov_factura, l_factura
          FROM compras_cabecera
         WHERE id_cabecera = d.id_cabecera
           FOR UPDATE;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN
          RAISE_APPLICATION_ERROR(-20517, 'La factura ID ' || d.id_cabecera || ' no existe');
      END;

      IF NVL(l_tipo, '-') <> 'C' OR NVL(l_condicion, 0) <> 2 THEN
        RAISE_APPLICATION_ERROR(-20518,
          'La factura ' || l_factura || ' no es una compra a crédito');
      END IF;

      IF NVL(l_prov_factura, -1) <> l_cod_proveedor THEN
        RAISE_APPLICATION_ERROR(-20519,
          'La factura ' || l_factura || ' es de otro proveedor');
      END IF;

      IF d.monto_aplicado <= 0 THEN
        RAISE_APPLICATION_ERROR(-20520,
          'El monto aplicado a la factura ' || l_factura || ' tiene que ser mayor a cero');
      END IF;
      IF d.monto_aplicado <> TRUNC(d.monto_aplicado) THEN
        RAISE_APPLICATION_ERROR(-20521,
          'El monto aplicado a la factura ' || l_factura || ' no puede tener decimales');
      END IF;

      -- Se lee DESPUÉS del FOR UPDATE: así ve lo que pagó un recibo que se
      -- grabó mientras este esperaba el bloqueo.
      l_saldo := saldo_factura(d.id_cabecera);

      IF l_saldo <= 0 THEN
        RAISE_APPLICATION_ERROR(-20522, 'La factura ' || l_factura || ' ya está cancelada');
      END IF;

      IF d.monto_aplicado > l_saldo THEN
        RAISE_APPLICATION_ERROR(-20523,
          'El monto aplicado a la factura ' || l_factura || ' supera su saldo (saldo: ' ||
          TO_CHAR(l_saldo, 'FM999G999G999G990') || ')');
      END IF;

      INSERT INTO recibos_compra_detalle (id_detalle, id_recibo, id_cabecera, monto_aplicado)
      VALUES (NULL, l_id_recibo, d.id_cabecera, d.monto_aplicado);

      l_total := l_total + d.monto_aplicado;
    END LOOP;

    ------------------------------------------------------------------
    -- Pagos, en el orden en que llegan. Los CHECK de RECIBOS_COMPRA_PAGOS
    -- exigen lo mismo; se valida antes para que el mensaje diga qué pago
    -- está mal y no "ORA-02290: RECIBOS_COMPRA_PAG_CK_DATOS".
    ------------------------------------------------------------------
    FOR p IN (
      SELECT n, forma_pago, nro_documento, banco, fecha_emision, fecha_vencimiento, monto
        FROM JSON_TABLE(p_body, '$.pagos[*]'
               COLUMNS (n                 FOR ORDINALITY,
                        forma_pago        VARCHAR2(4000) PATH '$.forma_pago',
                        nro_documento     VARCHAR2(4000) PATH '$.nro_documento',
                        banco             VARCHAR2(4000) PATH '$.banco',
                        fecha_emision     VARCHAR2(4000) PATH '$.fecha_emision',
                        fecha_vencimiento VARCHAR2(4000) PATH '$.fecha_vencimiento',
                        monto             NUMBER         PATH '$.monto'))
       ORDER BY n
    ) LOOP
      l_forma       := UPPER(TRIM(p.forma_pago));
      l_nro_doc     := TRIM(p.nro_documento);
      l_banco       := NULL;
      l_emision     := NULL;
      l_vencimiento := NULL;

      IF l_forma IS NULL OR l_forma NOT IN ('EFECTIVO', 'TRANSFERENCIA', 'CHEQUE') THEN
        RAISE_APPLICATION_ERROR(-20529,
          'Pago ' || p.n || ': forma de pago inválida (EFECTIVO, TRANSFERENCIA o CHEQUE)');
      END IF;
      l_pago := 'Pago ' || p.n || ' (' || LOWER(l_forma) || ')';

      IF p.monto <= 0 THEN
        RAISE_APPLICATION_ERROR(-20530, l_pago || ': el monto tiene que ser mayor a cero');
      END IF;
      IF p.monto <> TRUNC(p.monto) THEN
        RAISE_APPLICATION_ERROR(-20531, l_pago || ': el monto no puede tener decimales');
      END IF;

      IF l_forma = 'EFECTIVO' THEN
        -- El CHECK exige estos tres NULL en efectivo.
        l_nro_doc := NULL;
      ELSE
        IF l_nro_doc IS NULL THEN
          RAISE_APPLICATION_ERROR(-20532,
            l_pago || ': falta el número de ' ||
            CASE l_forma WHEN 'CHEQUE' THEN 'cheque' ELSE 'transferencia' END);
        END IF;
        IF LENGTH(l_nro_doc) > 30 THEN
          RAISE_APPLICATION_ERROR(-20533, l_pago || ': el número admite hasta 30 caracteres');
        END IF;
      END IF;

      -- Solo el cheque lleva banco y fechas; en las otras formas se ignoran.
      IF l_forma = 'CHEQUE' THEN
        l_banco := TRIM(p.banco);
        IF l_banco IS NULL THEN
          RAISE_APPLICATION_ERROR(-20538, l_pago || ': falta el banco');
        END IF;
        IF LENGTH(l_banco) > 100 THEN
          RAISE_APPLICATION_ERROR(-20540, l_pago || ': el banco admite hasta 100 caracteres');
        END IF;

        IF TRIM(p.fecha_emision) IS NULL OR TRIM(p.fecha_vencimiento) IS NULL THEN
          RAISE_APPLICATION_ERROR(-20534,
            l_pago || ': faltan la fecha de emisión y la de vencimiento');
        END IF;
        BEGIN
          l_emision     := TO_DATE(p.fecha_emision, 'YYYY-MM-DD');
          l_vencimiento := TO_DATE(p.fecha_vencimiento, 'YYYY-MM-DD');
        EXCEPTION
          WHEN OTHERS THEN
            RAISE_APPLICATION_ERROR(-20535, l_pago || ': fecha inválida, se espera AAAA-MM-DD');
        END;
        IF l_emision > l_fecha THEN
          RAISE_APPLICATION_ERROR(-20536,
            l_pago || ': la emisión no puede ser posterior a la fecha del recibo');
        END IF;
        -- El vencimiento sí puede ser futuro: es un cheque diferido.
        IF l_vencimiento < l_emision THEN
          RAISE_APPLICATION_ERROR(-20537,
            l_pago || ': el vencimiento no puede ser anterior a la emisión');
        END IF;
      END IF;

      INSERT INTO recibos_compra_pagos (
        id_pago, id_recibo, forma_pago, nro_documento, banco,
        fecha_emision, fecha_vencimiento, monto
      ) VALUES (
        NULL, l_id_recibo, l_forma, l_nro_doc, l_banco,
        l_emision, l_vencimiento, p.monto
      );
    END LOOP;

    UPDATE recibos_compra_cabecera
       SET monto_total = l_total
     WHERE id_recibo = l_id_recibo;

    COMMIT;
    RETURN l_id_recibo;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      RAISE;
  END crear;


  PROCEDURE eliminar(p_id_recibo NUMBER, p_cod_usuario VARCHAR2) IS
    l_id NUMBER;
  BEGIN
    IF es_admin(p_cod_usuario) <> 'S' THEN
      RAISE_APPLICATION_ERROR(-20500,
        'No tenés permiso para eliminar recibos de proveedores.');
    END IF;

    IF p_id_recibo IS NULL THEN
      RAISE_APPLICATION_ERROR(-20524, 'Falta el recibo');
    END IF;

    BEGIN
      SELECT id_recibo INTO l_id
        FROM recibos_compra_cabecera
       WHERE id_recibo = p_id_recibo
         FOR UPDATE;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20525, 'El recibo no existe');
    END;

    -- Detalle y pagos se borran solos: RECIBOS_COMPRA_DET_FK_REC y
    -- RECIBOS_COMPRA_PAG_FK_REC son ON DELETE CASCADE.
    DELETE FROM recibos_compra_cabecera WHERE id_recibo = p_id_recibo;

    COMMIT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      RAISE;
  END eliminar;

END pkg_recibos_compra;
/

-- Tiene que dar VALID en las dos filas antes de seguir:
--   SELECT object_type, status FROM user_objects WHERE object_name = 'PKG_RECIBOS_COMPRA';


-- =====================================================================
-- 3. MÓDULO ORDS
-- =====================================================================
-- Tres ejecuciones SEPARADAS, nunca el archivo entero de una (ORA-00060
-- reproducible): (1) la sección 2 · (2) el bloque 3.a solo · (3) el 3.b solo.
-- Detalle en backend/README.md → "Desplegar un módulo ORDS".
--
-- ⚠ ANTES DEL PRIMER DESPLIEGUE: 3.a borra cualquier módulo que se llame
-- 'proveedores'. Confirmar que no exista uno que no sea este:
--
--   SELECT name, uri_prefix FROM user_ords_modules ORDER BY name;
--
-- Si aparece 'proveedores' o un uri_prefix '/proveedores/' que no salió de
-- este archivo, NO correr 3.a: hay que elegir otro nombre.

-- ---------------------------------------------------------------------
-- 3.a  Borrado previo — ejecución 2 de 3. CORRER SOLO ESTO Y ESPERAR
-- ---------------------------------------------------------------------
-- Sin EXCEPTION a propósito: si el borrado falla hay que verlo.
DECLARE
  l_existe NUMBER;
BEGIN
  SELECT COUNT(*) INTO l_existe FROM user_ords_modules WHERE name = 'proveedores';
  IF l_existe > 0 THEN
    ORDS.DELETE_MODULE(p_module_name => 'proveedores');
    COMMIT;
  END IF;
END;
/

-- Tiene que dar 0 ANTES de seguir con 3.b:
--   SELECT COUNT(*) FROM user_ords_modules WHERE name = 'proveedores';
-- Si el bloque de arriba tardó ~13 segundos, estaba esperando un lock: ver
-- backend/README.md antes de insistir.


-- ---------------------------------------------------------------------
-- 3.b  Definición del módulo — ejecución 3 de 3. CORRER SOLO ESTO
-- ---------------------------------------------------------------------
-- Todos los handlers son plsql/block: es el único tipo que puede validar el
-- token. Arman el JSON a mano y devuelven TODAS las filas, sin paginar — no
-- aceptan ?limit/?offset ni ?page. Son pocas filas (117 facturas a crédito
-- al 2026-09-24) y el cliente filtra y busca en memoria.
--
-- Ningún GET llama a pkg_recibos_compra (sí a pkg_auth_token, como todos los
-- de recibos): si el paquete queda INVALID, las lecturas siguen andando.
DECLARE

  -- Usuarios habilitados, ya escritos como lista de un IN (...). Es la misma
  -- lista que pkg_recibos_compra.es_admin y que src/lib/permisos.ts.
  l_admins  CONSTANT VARCHAR2(200) := '''AAQUINO'', ''AGONZALEZ'', ''JOSEG''';

  -- Arranque común de TODOS los handlers: token válido y usuario habilitado.
  -- Se pega en cada p_source para no repetir diez líneas seis veces; en SQL
  -- Developer Web cada handler se ve con el texto ya expandido. Cada handler
  -- tiene que declarar l_user.
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
      p_module_name    => 'proveedores',
      p_base_path      => '/proveedores/',
      p_items_per_page => 25,
      p_status         => 'PUBLISHED',
      p_comments       => NULL);


  -- ==================================================================
  -- FACTURAS A CRÉDITO   GET /proveedores/facturas?cod_proveedor=&pendientes=S
  -- ==================================================================
  -- Todas las facturas de compra a crédito con total, pagado y saldo.
  --   cod_proveedor  opcional: solo las de ese proveedor (lo usa el alta)
  --   pendientes=S   opcional: solo las que tienen saldo > 0
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'proveedores',
      p_pattern        => 'facturas',
      p_priority       => 0,
      p_etag_type      => 'NONE',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'proveedores',
      p_pattern        => 'facturas',
      p_method         => 'GET',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      DECLARE
        l_user VARCHAR2(255);
        l_prov NUMBER;
        l_pend VARCHAR2(1) := CASE WHEN UPPER(:pendientes) = ''S'' THEN ''S'' ELSE ''N'' END;
      BEGIN' || l_guardia || '
        BEGIN l_prov := TO_NUMBER(:cod_proveedor); EXCEPTION WHEN OTHERS THEN l_prov := NULL; END;

        apex_json.open_object;
        apex_json.write(''success'', TRUE);
        apex_json.open_array(''items'');

        FOR r IN (
          SELECT c.id_cabecera,
                 c.referencia,
                 c.fecha,
                 c.motivo,
                 c.cod_proveedor,
                 p.nombre                              AS proveedor,
                 NVL(p.ruc, p.ci)                      AS documento,
                 c.observacion,
                 NVL(t.total, 0)                       AS total,
                 NVL(g.pagado, 0)                      AS pagado,
                 NVL(t.total, 0) - NVL(g.pagado, 0)    AS saldo,
                 NVL(g.cant, 0)                        AS cant_recibos
            FROM compras_cabecera c
            LEFT JOIN proveedores p ON p.cod_proveedor = c.cod_proveedor
            -- TOTAL DE FACTURA (ver cabecera del archivo)
            LEFT JOIN ( SELECT id_cabecera,
                               ROUND(SUM(NVL(cantidad, 0) * NVL(precio_unitario, 0))) AS total
                          FROM compras_detalle
                         GROUP BY id_cabecera ) t ON t.id_cabecera = c.id_cabecera
            LEFT JOIN ( SELECT id_cabecera, SUM(monto_aplicado) AS pagado, COUNT(*) AS cant
                          FROM recibos_compra_detalle
                         GROUP BY id_cabecera ) g ON g.id_cabecera = c.id_cabecera
           WHERE c.tipo = ''C''
             AND c.condicion_compra = 2
             AND (l_prov IS NULL OR c.cod_proveedor = l_prov)
             AND (l_pend = ''N'' OR NVL(t.total, 0) - NVL(g.pagado, 0) > 0)
           ORDER BY c.fecha DESC NULLS LAST, c.id_cabecera DESC
        ) LOOP
          apex_json.open_object;
          apex_json.write(''id_cabecera'',   r.id_cabecera);
          apex_json.write(''referencia'',    r.referencia);
          apex_json.write(''fecha'',         TO_CHAR(r.fecha, ''YYYY-MM-DD''));
          apex_json.write(''motivo'',        r.motivo);
          apex_json.write(''cod_proveedor'', r.cod_proveedor);
          apex_json.write(''proveedor'',     r.proveedor);
          apex_json.write(''documento'',     r.documento);
          apex_json.write(''observacion'',   r.observacion);
          apex_json.write(''total'',         r.total);
          apex_json.write(''pagado'',        r.pagado);
          apex_json.write(''saldo'',         r.saldo);
          apex_json.write(''cant_recibos'',  r.cant_recibos);
          apex_json.close_object;
        END LOOP;

        apex_json.close_array;
        apex_json.close_object;
      EXCEPTION WHEN OTHERS THEN
        :status_code := 500;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_PARAMETER(p_module_name => 'proveedores', p_pattern => 'facturas', p_method => 'GET',
      p_name => 'authorization', p_bind_variable_name => 'authorization',
      p_source_type => 'HEADER', p_param_type => 'STRING', p_access_method => 'IN', p_comments => NULL);


  -- ==================================================================
  -- ARTÍCULOS DE UNA FACTURA   GET /proveedores/facturas/:id/articulos
  -- ==================================================================
  -- Los renglones de COMPRAS_DETALLE de una factura (:id = ID_CABECERA), con
  -- la descripción y la unidad de medida del artículo. Lo usa el modal de
  -- artículos (articulos-factura-dialog.tsx): Recibos de Proveedores y
  -- Compras por Período. Sirve para cualquier factura, contado o crédito.
  --
  -- COMPRAS_DETALLE no tiene IVA ni descuento aparte: el subtotal es
  -- cantidad × precio_unitario, y la suma redondeada de los subtotales es el
  -- TOTAL DE FACTURA (ver cabecera del archivo). El ROUND va solo en el total,
  -- igual que en los otros handlers; el subtotal viaja con sus decimales.
  --
  -- 404 si la factura no existe. Una factura que existe pero no tiene
  -- renglones devuelve items vacío: es la "Sin monto" de las pantallas.
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'proveedores',
      p_pattern        => 'facturas/:id/articulos',
      p_priority       => 0,
      p_etag_type      => 'NONE',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'proveedores',
      p_pattern        => 'facturas/:id/articulos',
      p_method         => 'GET',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      DECLARE
        l_user   VARCHAR2(255);
        l_id     NUMBER;
        l_existe NUMBER;
      BEGIN' || l_guardia || '
        BEGIN l_id := TO_NUMBER(:id); EXCEPTION WHEN OTHERS THEN l_id := NULL; END;

        SELECT COUNT(*) INTO l_existe FROM compras_cabecera WHERE id_cabecera = l_id;
        IF l_existe = 0 THEN
          :status_code := 404;
          htp.p(''{"success": false, "message": "La factura no existe"}'');
          RETURN;
        END IF;

        apex_json.open_object;
        apex_json.write(''success'', TRUE);
        apex_json.open_array(''items'');

        FOR r IN (
          SELECT d.id_detalle,
                 d.cod_articulo,
                 a.descripcion                                    AS articulo,
                 a.cod_unidad_medida                              AS unidad,
                 d.cantidad,
                 d.precio_unitario,
                 NVL(d.cantidad, 0) * NVL(d.precio_unitario, 0)   AS subtotal
            FROM compras_detalle d
            LEFT JOIN articulos a ON a.cod_articulo = d.cod_articulo
           WHERE d.id_cabecera = l_id
           ORDER BY d.id_detalle
        ) LOOP
          apex_json.open_object;
          apex_json.write(''id_detalle'',      r.id_detalle);
          apex_json.write(''cod_articulo'',    r.cod_articulo);
          apex_json.write(''articulo'',        r.articulo);
          apex_json.write(''unidad'',          r.unidad);
          apex_json.write(''cantidad'',        r.cantidad);
          apex_json.write(''precio_unitario'', r.precio_unitario);
          apex_json.write(''subtotal'',        r.subtotal);
          apex_json.close_object;
        END LOOP;

        apex_json.close_array;
        apex_json.close_object;
      EXCEPTION WHEN OTHERS THEN
        :status_code := 500;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_PARAMETER(p_module_name => 'proveedores', p_pattern => 'facturas/:id/articulos', p_method => 'GET',
      p_name => 'authorization', p_bind_variable_name => 'authorization',
      p_source_type => 'HEADER', p_param_type => 'STRING', p_access_method => 'IN', p_comments => NULL);


  -- ==================================================================
  -- LISTADO DE RECIBOS   GET /proveedores/recibos?cod_proveedor=
  -- ==================================================================
  -- `facturas` es el texto con los números de factura que paga cada recibo,
  -- para mostrarlo en la tabla sin abrir el detalle. ON OVERFLOW TRUNCATE
  -- corta con "..." si alguna vez pasa de 4000 caracteres, en vez de dar
  -- ORA-01489 y tumbar el listado entero.
  --
  -- `formas_pago` resume los pagos en orden de carga, uno por segmento
  -- separado por " + ": la forma y, si tiene, el número
  -- ("EFECTIVO + CHEQUE 4471"). NULL en un recibo sin pagos cargados (los
  -- anteriores al 2026-10-19, ver 1.b). Lo traduce textoFormasPago() de
  -- src/lib/api.ts. Mismo campo en GET pagos.
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'proveedores',
      p_pattern        => 'recibos',
      p_priority       => 0,
      p_etag_type      => 'NONE',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'proveedores',
      p_pattern        => 'recibos',
      p_method         => 'GET',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      DECLARE
        l_user VARCHAR2(255);
        l_prov NUMBER;
      BEGIN' || l_guardia || '
        BEGIN l_prov := TO_NUMBER(:cod_proveedor); EXCEPTION WHEN OTHERS THEN l_prov := NULL; END;

        apex_json.open_object;
        apex_json.write(''success'', TRUE);
        apex_json.open_array(''items'');

        FOR r IN (
          SELECT rc.id_recibo,
                 rc.nro_recibo,
                 rc.fecha,
                 rc.cod_proveedor,
                 p.nombre            AS proveedor,
                 NVL(p.ruc, p.ci)    AS documento,
                 rc.monto_total,
                 rc.observacion,
                 ( SELECT COUNT(*)
                     FROM recibos_compra_detalle d
                    WHERE d.id_recibo = rc.id_recibo ) AS cant_facturas,
                 ( SELECT LISTAGG(pg.forma_pago || NVL2(pg.nro_documento, '' '' || pg.nro_documento, NULL),
                                  '' + '' ON OVERFLOW TRUNCATE)
                            WITHIN GROUP (ORDER BY pg.id_pago)
                     FROM recibos_compra_pagos pg
                    WHERE pg.id_recibo = rc.id_recibo ) AS formas_pago,
                 ( SELECT LISTAGG(NVL(c.referencia, ''ID '' || c.id_cabecera), '', '' ON OVERFLOW TRUNCATE)
                            WITHIN GROUP (ORDER BY c.fecha, c.id_cabecera)
                     FROM recibos_compra_detalle d
                     JOIN compras_cabecera c ON c.id_cabecera = d.id_cabecera
                    WHERE d.id_recibo = rc.id_recibo ) AS facturas
            FROM recibos_compra_cabecera rc
            LEFT JOIN proveedores p ON p.cod_proveedor = rc.cod_proveedor
           WHERE (l_prov IS NULL OR rc.cod_proveedor = l_prov)
           ORDER BY rc.fecha DESC, rc.id_recibo DESC
        ) LOOP
          apex_json.open_object;
          apex_json.write(''id_recibo'',       r.id_recibo);
          apex_json.write(''nro_recibo'',      r.nro_recibo);
          apex_json.write(''fecha'',           TO_CHAR(r.fecha, ''YYYY-MM-DD''));
          apex_json.write(''cod_proveedor'',   r.cod_proveedor);
          apex_json.write(''proveedor'',       r.proveedor);
          apex_json.write(''documento'',       r.documento);
          apex_json.write(''formas_pago'',     r.formas_pago);
          apex_json.write(''monto_total'',     r.monto_total);
          apex_json.write(''observacion'',     r.observacion);
          apex_json.write(''cant_facturas'',   r.cant_facturas);
          apex_json.write(''facturas'',        r.facturas);
          apex_json.close_object;
        END LOOP;

        apex_json.close_array;
        apex_json.close_object;
      EXCEPTION WHEN OTHERS THEN
        :status_code := 500;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_PARAMETER(p_module_name => 'proveedores', p_pattern => 'recibos', p_method => 'GET',
      p_name => 'authorization', p_bind_variable_name => 'authorization',
      p_source_type => 'HEADER', p_param_type => 'STRING', p_access_method => 'IN', p_comments => NULL);


  -- ==================================================================
  -- ALTA   POST /proveedores/recibos
  -- ==================================================================
  -- El cuerpo entero va al paquete (ver pkg_recibos_compra.crear): el
  -- detalle es un array y ORDS no lo bindea. :body_text se puede leer UNA
  -- sola vez por request, por eso se guarda en una variable.
  ORDS.DEFINE_HANDLER(
      p_module_name    => 'proveedores',
      p_pattern        => 'recibos',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      DECLARE
        l_user VARCHAR2(255);
        l_body CLOB;
        l_id   NUMBER;
      BEGIN' || l_guardia || '
        l_body := :body_text;

        l_id := pkg_recibos_compra.crear(
          p_body        => l_body,
          p_cod_usuario => l_user);          -- del token, nunca del body

        :status_code := 201;
        htp.p(''{"success": true, "id_recibo": '' || l_id || ''}'');
      EXCEPTION WHEN OTHERS THEN
        :status_code := 400;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_PARAMETER(p_module_name => 'proveedores', p_pattern => 'recibos', p_method => 'POST',
      p_name => 'authorization', p_bind_variable_name => 'authorization',
      p_source_type => 'HEADER', p_param_type => 'STRING', p_access_method => 'IN', p_comments => NULL);


  -- ==================================================================
  -- DETALLE   GET /proveedores/recibos/:id
  -- ==================================================================
  -- La cabecera con sus facturas y sus pagos en un solo objeto:
  --   { success, id_recibo, nro_recibo, ..., facturas: [ ... ], pagos: [ ... ] }
  -- En cada factura, `saldo` es el saldo de HOY, no el del momento del pago.
  -- `pagos` viene vacío en los recibos anteriores al 2026-10-19 (ver 1.b).
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'proveedores',
      p_pattern        => 'recibos/:id',
      p_priority       => 0,
      p_etag_type      => 'NONE',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'proveedores',
      p_pattern        => 'recibos/:id',
      p_method         => 'GET',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      DECLARE
        l_user       VARCHAR2(255);
        l_id         NUMBER;
        l_encontrado BOOLEAN := FALSE;
      BEGIN' || l_guardia || '
        BEGIN l_id := TO_NUMBER(:id); EXCEPTION WHEN OTHERS THEN l_id := NULL; END;

        FOR r IN (
          SELECT rc.id_recibo, rc.nro_recibo, rc.fecha, rc.cod_proveedor,
                 p.nombre AS proveedor, NVL(p.ruc, p.ci) AS documento,
                 rc.monto_total, rc.observacion
            FROM recibos_compra_cabecera rc
            LEFT JOIN proveedores p ON p.cod_proveedor = rc.cod_proveedor
           WHERE rc.id_recibo = l_id
        ) LOOP
          l_encontrado := TRUE;

          apex_json.open_object;
          apex_json.write(''success'',         TRUE);
          apex_json.write(''id_recibo'',       r.id_recibo);
          apex_json.write(''nro_recibo'',      r.nro_recibo);
          apex_json.write(''fecha'',           TO_CHAR(r.fecha, ''YYYY-MM-DD''));
          apex_json.write(''cod_proveedor'',   r.cod_proveedor);
          apex_json.write(''proveedor'',       r.proveedor);
          apex_json.write(''documento'',       r.documento);
          apex_json.write(''monto_total'',     r.monto_total);
          apex_json.write(''observacion'',     r.observacion);

          apex_json.open_array(''pagos'');
          FOR pg IN (
            SELECT id_pago, forma_pago, nro_documento, banco,
                   fecha_emision, fecha_vencimiento, monto
              FROM recibos_compra_pagos
             WHERE id_recibo = r.id_recibo
             ORDER BY id_pago
          ) LOOP
            apex_json.open_object;
            apex_json.write(''id_pago'',           pg.id_pago);
            apex_json.write(''forma_pago'',        pg.forma_pago);
            apex_json.write(''nro_documento'',     pg.nro_documento);
            apex_json.write(''banco'',             pg.banco);
            apex_json.write(''fecha_emision'',     TO_CHAR(pg.fecha_emision, ''YYYY-MM-DD''));
            apex_json.write(''fecha_vencimiento'', TO_CHAR(pg.fecha_vencimiento, ''YYYY-MM-DD''));
            apex_json.write(''monto'',             pg.monto);
            apex_json.close_object;
          END LOOP;
          apex_json.close_array;

          apex_json.open_array(''facturas'');
          FOR f IN (
            SELECT d.id_detalle,
                   d.id_cabecera,
                   c.referencia,
                   c.fecha,
                   d.monto_aplicado,
                   NVL(t.total, 0)                      AS total,
                   NVL(t.total, 0) - NVL(g.pagado, 0)   AS saldo
              FROM recibos_compra_detalle d
              JOIN compras_cabecera c ON c.id_cabecera = d.id_cabecera
              -- TOTAL DE FACTURA (ver cabecera del archivo)
              LEFT JOIN ( SELECT id_cabecera,
                                 ROUND(SUM(NVL(cantidad, 0) * NVL(precio_unitario, 0))) AS total
                            FROM compras_detalle
                           GROUP BY id_cabecera ) t ON t.id_cabecera = d.id_cabecera
              LEFT JOIN ( SELECT id_cabecera, SUM(monto_aplicado) AS pagado
                            FROM recibos_compra_detalle
                           GROUP BY id_cabecera ) g ON g.id_cabecera = d.id_cabecera
             WHERE d.id_recibo = r.id_recibo
             ORDER BY c.fecha, c.id_cabecera
          ) LOOP
            apex_json.open_object;
            apex_json.write(''id_detalle'',     f.id_detalle);
            apex_json.write(''id_cabecera'',    f.id_cabecera);
            apex_json.write(''referencia'',     f.referencia);
            apex_json.write(''fecha'',          TO_CHAR(f.fecha, ''YYYY-MM-DD''));
            apex_json.write(''monto_aplicado'', f.monto_aplicado);
            apex_json.write(''total'',          f.total);
            apex_json.write(''saldo'',          f.saldo);
            apex_json.close_object;
          END LOOP;
          apex_json.close_array;

          apex_json.close_object;
        END LOOP;

        IF NOT l_encontrado THEN
          :status_code := 404;
          htp.p(''{"success": false, "message": "El recibo no existe"}'');
        END IF;
      EXCEPTION WHEN OTHERS THEN
        :status_code := 500;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_PARAMETER(p_module_name => 'proveedores', p_pattern => 'recibos/:id', p_method => 'GET',
      p_name => 'authorization', p_bind_variable_name => 'authorization',
      p_source_type => 'HEADER', p_param_type => 'STRING', p_access_method => 'IN', p_comments => NULL);


  -- ==================================================================
  -- BAJA   DELETE /proveedores/recibos/:id
  -- ==================================================================
  ORDS.DEFINE_HANDLER(
      p_module_name    => 'proveedores',
      p_pattern        => 'recibos/:id',
      p_method         => 'DELETE',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      DECLARE
        l_user VARCHAR2(255);
      BEGIN' || l_guardia || '
        pkg_recibos_compra.eliminar(
          p_id_recibo   => TO_NUMBER(:id),
          p_cod_usuario => l_user);

        :status_code := 200;
        htp.p(''{"success": true}'');
      EXCEPTION WHEN OTHERS THEN
        :status_code := 400;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_PARAMETER(p_module_name => 'proveedores', p_pattern => 'recibos/:id', p_method => 'DELETE',
      p_name => 'authorization', p_bind_variable_name => 'authorization',
      p_source_type => 'HEADER', p_param_type => 'STRING', p_access_method => 'IN', p_comments => NULL);


  -- ==================================================================
  -- PAGOS POR FACTURA   GET /proveedores/pagos?cod_proveedor=
  -- ==================================================================
  -- Una fila por cada factura pagada en cada recibo (RECIBOS_COMPRA_DETALLE
  -- con los datos de su recibo). Lo usa el reporte Saldos de Proveedores en
  -- "Con recibos" y "Todos" para listar debajo de cada factura qué recibos la
  -- pagaron y cuánto. El listado de recibos no alcanza: trae los nros. de
  -- factura pero no el monto aplicado a cada una, y el detalle es de a un
  -- recibo por pedido.
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'proveedores',
      p_pattern        => 'pagos',
      p_priority       => 0,
      p_etag_type      => 'NONE',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'proveedores',
      p_pattern        => 'pagos',
      p_method         => 'GET',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      DECLARE
        l_user VARCHAR2(255);
        l_prov NUMBER;
      BEGIN' || l_guardia || '
        BEGIN l_prov := TO_NUMBER(:cod_proveedor); EXCEPTION WHEN OTHERS THEN l_prov := NULL; END;

        apex_json.open_object;
        apex_json.write(''success'', TRUE);
        apex_json.open_array(''items'');

        FOR r IN (
          SELECT d.id_detalle,
                 d.id_cabecera,
                 d.monto_aplicado,
                 rc.id_recibo,
                 rc.nro_recibo,
                 rc.fecha,
                 -- Mismo resumen que GET recibos (ver ahí).
                 ( SELECT LISTAGG(pg.forma_pago || NVL2(pg.nro_documento, '' '' || pg.nro_documento, NULL),
                                  '' + '' ON OVERFLOW TRUNCATE)
                            WITHIN GROUP (ORDER BY pg.id_pago)
                     FROM recibos_compra_pagos pg
                    WHERE pg.id_recibo = rc.id_recibo ) AS formas_pago
            FROM recibos_compra_detalle d
            JOIN recibos_compra_cabecera rc ON rc.id_recibo = d.id_recibo
           WHERE (l_prov IS NULL OR rc.cod_proveedor = l_prov)
           ORDER BY d.id_cabecera, rc.fecha, rc.id_recibo
        ) LOOP
          apex_json.open_object;
          apex_json.write(''id_detalle'',      r.id_detalle);
          apex_json.write(''id_cabecera'',     r.id_cabecera);
          apex_json.write(''monto_aplicado'',  r.monto_aplicado);
          apex_json.write(''id_recibo'',       r.id_recibo);
          apex_json.write(''nro_recibo'',      r.nro_recibo);
          apex_json.write(''fecha'',           TO_CHAR(r.fecha, ''YYYY-MM-DD''));
          apex_json.write(''formas_pago'',     r.formas_pago);
          apex_json.close_object;
        END LOOP;

        apex_json.close_array;
        apex_json.close_object;
      EXCEPTION WHEN OTHERS THEN
        :status_code := 500;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_PARAMETER(p_module_name => 'proveedores', p_pattern => 'pagos', p_method => 'GET',
      p_name => 'authorization', p_bind_variable_name => 'authorization',
      p_source_type => 'HEADER', p_param_type => 'STRING', p_access_method => 'IN', p_comments => NULL);


  -- ==================================================================
  -- COMPRAS POR PERÍODO   GET /proveedores/compras?desde=&hasta=&cod_proveedor=
  -- ==================================================================
  -- Facturas de compra, contado y crédito, con fecha entre desde y hasta
  -- (YYYY-MM-DD, los dos incluidos y obligatorios). Lo usa el reporte Compras
  -- por Período (2026-10-19).
  --
  -- TIPO = 'C' (compra; 'S' es inventario) y MOTIVO 'C' (compra) o 'E'
  -- (entrada), decisión de Jose. Sin IVA desglosado: ni COMPRAS_* ni
  -- ARTICULOS guardan la tasa.
  --
  -- `pagado` y `saldo`: en crédito (CONDICION_COMPRA 2) salen de los recibos,
  -- igual que en GET facturas. Una compra al contado se paga en el momento:
  -- pagado = total y saldo = 0. Así las sumas de saldo del reporte son solo
  -- la deuda real.
  --
  -- La fecha se compara con < hasta + 1 y no con <= hasta: si alguna FECHA
  -- trae hora, la del último día también entra.
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'proveedores',
      p_pattern        => 'compras',
      p_priority       => 0,
      p_etag_type      => 'NONE',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'proveedores',
      p_pattern        => 'compras',
      p_method         => 'GET',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      DECLARE
        l_user  VARCHAR2(255);
        l_prov  NUMBER;
        l_desde DATE;
        l_hasta DATE;
      BEGIN' || l_guardia || '
        BEGIN l_prov := TO_NUMBER(:cod_proveedor); EXCEPTION WHEN OTHERS THEN l_prov := NULL; END;

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
          SELECT c.id_cabecera,
                 c.referencia,
                 c.fecha,
                 c.condicion_compra,
                 c.cod_proveedor,
                 p.nombre                              AS proveedor,
                 NVL(p.ruc, p.ci)                      AS documento,
                 c.observacion,
                 NVL(t.total, 0)                       AS total,
                 CASE WHEN c.condicion_compra = 2
                      THEN NVL(g.pagado, 0)
                      ELSE NVL(t.total, 0) END         AS pagado,
                 CASE WHEN c.condicion_compra = 2
                      THEN NVL(t.total, 0) - NVL(g.pagado, 0)
                      ELSE 0 END                       AS saldo
            FROM compras_cabecera c
            LEFT JOIN proveedores p ON p.cod_proveedor = c.cod_proveedor
            -- TOTAL DE FACTURA (ver cabecera del archivo)
            LEFT JOIN ( SELECT id_cabecera,
                               ROUND(SUM(NVL(cantidad, 0) * NVL(precio_unitario, 0))) AS total
                          FROM compras_detalle
                         GROUP BY id_cabecera ) t ON t.id_cabecera = c.id_cabecera
            LEFT JOIN ( SELECT id_cabecera, SUM(monto_aplicado) AS pagado
                          FROM recibos_compra_detalle
                         GROUP BY id_cabecera ) g ON g.id_cabecera = c.id_cabecera
           WHERE c.tipo   = ''C''
             AND c.motivo IN (''C'', ''E'')
             AND c.fecha >= l_desde
             AND c.fecha <  l_hasta + 1
             AND (l_prov IS NULL OR c.cod_proveedor = l_prov)
           ORDER BY c.fecha, c.id_cabecera
        ) LOOP
          apex_json.open_object;
          apex_json.write(''id_cabecera'',      r.id_cabecera);
          apex_json.write(''referencia'',       r.referencia);
          apex_json.write(''fecha'',            TO_CHAR(r.fecha, ''YYYY-MM-DD''));
          apex_json.write(''condicion_compra'', r.condicion_compra);
          apex_json.write(''cod_proveedor'',    r.cod_proveedor);
          apex_json.write(''proveedor'',        r.proveedor);
          apex_json.write(''documento'',        r.documento);
          apex_json.write(''observacion'',      r.observacion);
          apex_json.write(''total'',            r.total);
          apex_json.write(''pagado'',           r.pagado);
          apex_json.write(''saldo'',            r.saldo);
          apex_json.close_object;
        END LOOP;

        apex_json.close_array;
        apex_json.close_object;
      EXCEPTION WHEN OTHERS THEN
        :status_code := 500;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_PARAMETER(p_module_name => 'proveedores', p_pattern => 'compras', p_method => 'GET',
      p_name => 'authorization', p_bind_variable_name => 'authorization',
      p_source_type => 'HEADER', p_param_type => 'STRING', p_access_method => 'IN', p_comments => NULL);


  -- ==================================================================
  -- CHEQUES A VENCER   GET /proveedores/cheques?desde=&hasta=&cod_proveedor=
  -- ==================================================================
  -- Los cheques entregados a proveedores (RECIBOS_COMPRA_PAGOS con
  -- FORMA_PAGO 'CHEQUE') con FECHA_VENCIMIENTO entre desde y hasta
  -- (YYYY-MM-DD, los dos incluidos y obligatorios). Lo usa el reporte Cheques
  -- a Vencer (2026-10-19): lo que el proveedor puede cobrar, y se debita de la
  -- cuenta, cada día.
  --
  -- La base no registra si un cheque ya se cobró: un vencimiento anterior a
  -- hoy quiere decir "ya se pudo cobrar", no "se cobró". Los días que faltan
  -- los calcula el cliente con la fecha local: SYSDATE es la del servidor.
  --
  -- Los cheques de recibos anteriores al 2026-10-19 no existen: esos recibos
  -- no tienen pagos cargados (ver 1.b).
  --
  -- `facturas`: los nros. de las facturas que paga el recibo, como en GET
  -- recibos. Si el recibo se pagó con varias formas, el cheque cubre una
  -- parte: el reporte lo dice con `monto_recibo`.
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'proveedores',
      p_pattern        => 'cheques',
      p_priority       => 0,
      p_etag_type      => 'NONE',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'proveedores',
      p_pattern        => 'cheques',
      p_method         => 'GET',
      p_source_type    => 'plsql/block',
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_source         =>
'
      DECLARE
        l_user  VARCHAR2(255);
        l_prov  NUMBER;
        l_desde DATE;
        l_hasta DATE;
      BEGIN' || l_guardia || '
        BEGIN l_prov := TO_NUMBER(:cod_proveedor); EXCEPTION WHEN OTHERS THEN l_prov := NULL; END;

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
          SELECT pg.id_pago,
                 pg.nro_documento,
                 pg.banco,
                 pg.fecha_emision,
                 pg.fecha_vencimiento,
                 pg.monto,
                 rc.id_recibo,
                 rc.nro_recibo,
                 rc.fecha                AS fecha_recibo,
                 rc.monto_total          AS monto_recibo,
                 rc.cod_proveedor,
                 p.nombre                AS proveedor,
                 NVL(p.ruc, p.ci)        AS documento,
                 ( SELECT LISTAGG(NVL(c.referencia, ''ID '' || c.id_cabecera), '', '' ON OVERFLOW TRUNCATE)
                            WITHIN GROUP (ORDER BY c.fecha, c.id_cabecera)
                     FROM recibos_compra_detalle d
                     JOIN compras_cabecera c ON c.id_cabecera = d.id_cabecera
                    WHERE d.id_recibo = rc.id_recibo ) AS facturas
            FROM recibos_compra_pagos pg
            JOIN recibos_compra_cabecera rc ON rc.id_recibo = pg.id_recibo
            LEFT JOIN proveedores p ON p.cod_proveedor = rc.cod_proveedor
           WHERE pg.forma_pago = ''CHEQUE''
             AND pg.fecha_vencimiento >= l_desde
             AND pg.fecha_vencimiento <  l_hasta + 1
             AND (l_prov IS NULL OR rc.cod_proveedor = l_prov)
           ORDER BY pg.fecha_vencimiento, p.nombre, pg.id_pago
        ) LOOP
          apex_json.open_object;
          apex_json.write(''id_pago'',           r.id_pago);
          apex_json.write(''nro_documento'',     r.nro_documento);
          apex_json.write(''banco'',             r.banco);
          apex_json.write(''fecha_emision'',     TO_CHAR(r.fecha_emision, ''YYYY-MM-DD''));
          apex_json.write(''fecha_vencimiento'', TO_CHAR(r.fecha_vencimiento, ''YYYY-MM-DD''));
          apex_json.write(''monto'',             r.monto);
          apex_json.write(''id_recibo'',         r.id_recibo);
          apex_json.write(''nro_recibo'',        r.nro_recibo);
          apex_json.write(''fecha_recibo'',      TO_CHAR(r.fecha_recibo, ''YYYY-MM-DD''));
          apex_json.write(''monto_recibo'',      r.monto_recibo);
          apex_json.write(''cod_proveedor'',     r.cod_proveedor);
          apex_json.write(''proveedor'',         r.proveedor);
          apex_json.write(''documento'',         r.documento);
          apex_json.write(''facturas'',          r.facturas);
          apex_json.close_object;
        END LOOP;

        apex_json.close_array;
        apex_json.close_object;
      EXCEPTION WHEN OTHERS THEN
        :status_code := 500;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_PARAMETER(p_module_name => 'proveedores', p_pattern => 'cheques', p_method => 'GET',
      p_name => 'authorization', p_bind_variable_name => 'authorization',
      p_source_type => 'HEADER', p_param_type => 'STRING', p_access_method => 'IN', p_comments => NULL);


  -- ==================================================================
  -- LOV   GET /proveedores/lov/proveedores
  -- ==================================================================
  -- Solo los proveedores que tienen alguna factura a crédito: los demás no
  -- tienen nada que hacer en esta pantalla. `pendientes` y `saldo` resumen lo
  -- que se les debe; el alta muestra solo los que tienen saldo > 0.
  -- No filtra por texto: la búsqueda va en el cliente (filtrarLov), como en
  -- todos los LOV de la app.
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'proveedores',
      p_pattern        => 'lov/proveedores',
      p_priority       => 0,
      p_etag_type      => 'NONE',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'proveedores',
      p_pattern        => 'lov/proveedores',
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
          SELECT p.cod_proveedor,
                 NVL(p.nombre, ''Proveedor '' || p.cod_proveedor)      AS nombre,
                 NVL(p.ruc, p.ci)                                       AS documento,
                 COUNT(CASE WHEN f.saldo > 0 THEN 1 END)                AS pendientes,
                 NVL(SUM(CASE WHEN f.saldo > 0 THEN f.saldo END), 0)    AS saldo
            FROM proveedores p
            JOIN ( SELECT c.cod_proveedor,
                          NVL(t.total, 0) - NVL(g.pagado, 0) AS saldo
                     FROM compras_cabecera c
                     -- TOTAL DE FACTURA (ver cabecera del archivo)
                     LEFT JOIN ( SELECT id_cabecera,
                                        ROUND(SUM(NVL(cantidad, 0) * NVL(precio_unitario, 0))) AS total
                                   FROM compras_detalle
                                  GROUP BY id_cabecera ) t ON t.id_cabecera = c.id_cabecera
                     LEFT JOIN ( SELECT id_cabecera, SUM(monto_aplicado) AS pagado
                                   FROM recibos_compra_detalle
                                  GROUP BY id_cabecera ) g ON g.id_cabecera = c.id_cabecera
                    WHERE c.tipo = ''C''
                      AND c.condicion_compra = 2 ) f ON f.cod_proveedor = p.cod_proveedor
           GROUP BY p.cod_proveedor, p.nombre, p.ruc, p.ci
           ORDER BY UPPER(NVL(p.nombre, ''Proveedor '' || p.cod_proveedor))
        ) LOOP
          apex_json.open_object;
          apex_json.write(''value'',      r.cod_proveedor);
          apex_json.write(''label'',      r.nombre);
          apex_json.write(''documento'',  r.documento);
          apex_json.write(''pendientes'', r.pendientes);
          apex_json.write(''saldo'',      r.saldo);
          apex_json.close_object;
        END LOOP;

        apex_json.close_array;
        apex_json.close_object;
      EXCEPTION WHEN OTHERS THEN
        :status_code := 500;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_PARAMETER(p_module_name => 'proveedores', p_pattern => 'lov/proveedores', p_method => 'GET',
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

-- 4.a  ¿Quedaron los diez handlers?
--
--   SELECT t.uri_template, h.method, h.source_type
--     FROM user_ords_modules p
--     JOIN user_ords_templates t ON t.module_id = p.id
--     JOIN user_ords_handlers  h ON h.template_id = t.id
--    WHERE p.name = 'proveedores'
--    ORDER BY t.uri_template, h.method;
--
-- Tienen que ser exactamente estas diez filas (`pagos` se agregó el
-- 2026-09-24 para el reporte, `facturas/:id/articulos` el 2026-10-14 para el
-- modal del detalle, `compras` el 2026-10-19 para Compras por Período y
-- `cheques` el mismo día para Cheques a Vencer; si falta alguna, el módulo
-- es el de antes):
--   cheques                 GET     plsql/block
--   compras                 GET     plsql/block
--   facturas                GET     plsql/block
--   facturas/:id/articulos  GET     plsql/block
--   lov/proveedores         GET     plsql/block
--   pagos                   GET     plsql/block
--   recibos                 GET     plsql/block
--   recibos                 POST    plsql/block
--   recibos/:id             DELETE  plsql/block
--   recibos/:id             GET     plsql/block

-- 4.b  ¿El total calculado coincide con la factura en papel? Tomar dos o tres
--      facturas y compararlas a mano:
--
--   SELECT c.id_cabecera, c.referencia, pkg_recibos_compra.saldo_factura(c.id_cabecera) saldo
--     FROM compras_cabecera c
--    WHERE c.tipo = 'C' AND c.condicion_compra = 2
--    ORDER BY c.fecha DESC FETCH FIRST 5 ROWS ONLY;

-- 4.c  Desde afuera, con curl (NUNCA desde el navegador: un 500 llega como
--      "error de CORS" y esconde el ORA- real). Todos piden token:
--
--   curl -s -X POST "https://oracleapex.com/ords/josiasmuebles/auth/login" \
--        -H "Content-Type: application/json" \
--        -d '{"username":"JOSEG","password":"..."}'
--   -> copiar el "token" de la respuesta en TOKEN.
--
--   B="https://oracleapex.com/ords/josiasmuebles/proveedores"
--   curl -i "$B/lov/proveedores"                        -H "Authorization: Bearer $TOKEN"
--   curl -i "$B/facturas?pendientes=S"                  -H "Authorization: Bearer $TOKEN"
--   curl -i "$B/facturas?cod_proveedor=<COD>"           -H "Authorization: Bearer $TOKEN"
--   curl -i "$B/recibos"                                -H "Authorization: Bearer $TOKEN"
--   curl -i "$B/pagos"                                  -H "Authorization: Bearer $TOKEN"
--   curl -i "$B/compras?desde=2026-09-01&hasta=2026-09-30" -H "Authorization: Bearer $TOKEN"
--     -> motivo C y E. Sin fechas, o desde > hasta -> 400 con mensaje.
--   curl -i "$B/cheques?desde=2026-10-01&hasta=2026-12-31" -H "Authorization: Bearer $TOKEN"
--     -> solo forma CHEQUE, ordenados por vencimiento. Mismos 400 que compras.
--   curl -i "$B/facturas/<ID>/articulos"                -H "Authorization: Bearer $TOKEN"
--     -> la suma redondeada de los `subtotal` tiene que dar el `total` de
--        esa factura en `facturas`. Un ID que no existe -> 404.
--
--   Sin el header -> 401. Con token de un usuario que no está en la lista ->
--   400 "no tiene habilitado el modulo administrativo".
--
-- 4.d  Alta y baja de prueba, con una factura pendiente de verdad (sale del
--      curl de facturas). Pagar un monto chico y después eliminarlo:
--
--   curl -i -X POST "$B/recibos" -H "Authorization: Bearer $TOKEN" \
--        -H "Content-Type: application/json" \
--        -d '{"cod_proveedor":<COD>,"nro_recibo":"PRUEBA-1","fecha":"2026-10-19",
--             "facturas":[{"id_cabecera":<ID>,"monto_aplicado":3000}],
--             "pagos":[{"forma_pago":"EFECTIVO","monto":1000},
--                      {"forma_pago":"CHEQUE","nro_documento":"PRUEBA","monto":2000,
--                       "banco":"Banco de prueba",
--                       "fecha_emision":"2026-10-19","fecha_vencimiento":"2026-11-19"}]}'
--   -> 201 {"success": true, "id_recibo": N}
--
--   curl -i "$B/recibos/N"              -H "Authorization: Bearer $TOKEN"
--     -> `pagos` con las dos filas; en GET recibos,
--        "formas_pago": "EFECTIVO + CHEQUE PRUEBA".
--   curl -i -X DELETE "$B/recibos/N"    -H "Authorization: Bearer $TOKEN"
--     -> los pagos se van con el recibo:
--        SELECT COUNT(*) FROM recibos_compra_pagos WHERE id_recibo = N;  -- 0
--
--   Repetir el POST con el mismo nro_recibo sin borrar -> 400 "Ya existe el
--   recibo". Con monto_aplicado mayor al saldo -> 400 "supera su saldo".
--   Con pagos que suman 2000 -> 400 "Los pagos suman 2.000 y lo aplicado ...".
--   Cheque sin fechas -> 400 "Pago 2 (cheque): faltan la fecha de emisión ...".
--
-- 4.e  Si el POST devuelve 400 "El pedido llegó vacío" con un body que sí
--      viaja: :body_text llegó NULL. Revisar que el curl mande
--      Content-Type: application/json.
--
-- 4.f  Si el DELETE responde "Expected one of: <<{,[,",number,true,false,null>>
--      but got: <<EOF>>": NO es este archivo. Es ORDS parseando un cuerpo
--      vacío porque llegó Content-Type: application/json, y corta ANTES del
--      handler (no borra nada). Mandar body "{}" NO alcanza: el cuerpo del
--      DELETE no le llega. El front lo manda con Content-Type: text/plain
--      (eliminarReciboProveedor en src/lib/api.ts); con curl, sin ese
--      header. Pasó el 2026-09-24.


-- =====================================================================
-- 5. ROLLBACK
-- =====================================================================
-- No toca esquema. Se deshace borrando el módulo y el paquete; los recibos
-- que se hayan cargado quedan en las tablas.
--
--   BEGIN
--     ORDS.DELETE_MODULE(p_module_name => 'proveedores');
--     COMMIT;
--   END;
--   /
--   DROP PACKAGE pkg_recibos_compra;
