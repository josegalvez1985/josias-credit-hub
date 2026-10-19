-- =====================================================================
-- ENDPOINT: /solicitudes  —  cabecera, detalle, referencias, actividad,
--                            LOVs y precios.
-- Contiene: trigger TRG_APROBAR_SOLICITUD (sección 0) + paquete + módulo
-- ORDS. Sin DDL de tablas (se crean aparte).
-- Correr como WKSP_JOSIASMUEBLES. Es idempotente: se puede volver a correr.
--
-- Base: export de ORDS 26.2.0 del 2026-07-24, con estos cambios:
--   * POST/PUT de referencias mandan :ind_garante.
--   * 2026-10-19: POST/PUT de referencias mandan también :nro_documento
--     (cédula, cualquier referencia) y los datos laborales del garante
--     (:es_empleado ... :aporta_ips). Jose agregó las columnas a mano en
--     SOLICITUD_VENTAS_REFERENCIAS:
--       NRO_DOCUMENTO        VARCHAR2(20)
--       ES_EMPLEADO          VARCHAR2(1)    CHECK IN ('S','N')
--       ANTIGUEDAD_ANIOS     NUMBER(3,0)
--       COD_PROFESION        NUMBER         FK PROFESIONES (SOLICITUD_VENTAS_REF_PROF_FK)
--       EMPRESA_NOMBRE / _TELEFONO / _CIUDAD / _CALLE_NRO   VARCHAR2(200)
--                            (la ciudad es texto libre, no COD_CIUDAD)
--       PUESTO               VARCHAR2(200)
--       INGRESOS_MENSUALES   NUMBER(15,2)
--       POSEE_OTROS_INGRESOS VARCHAR2(1)    CHECK IN ('S','N')
--       CONCEPTOS            VARCHAR2(400)
--       APORTA_IPS           VARCHAR2(1)    CHECK IN ('S','N')
--     Todas opcionales. El paquete las deja NULL si la referencia no es garante.
--
-- DESPLIEGUE: el trigger (sección 0) va solo, en su propia ejecución, y es
-- independiente del resto. El módulo, igual que los demás (backend/README.md),
-- en tres ejecuciones: (1) la sección 1, el paquete · (2) el
-- ORDS.DELETE_MODULE de 'solicitudes' solo, verificando que el conteo dé 0 ·
-- (3) la sección 2.
-- Es el módulo de los asesores en la calle: hacerlo en un horario sin carga.
--   * Se unieron los literales que el exportador partía en dos
--     (':s' || 'tatus_code'); es texto equivalente.
--
-- Tablas que usa: SOLICITUD_VENTAS_CABECERA, _DETALLE, _REFERENCIAS,
-- _ACTIVIDAD_LABORAL, CLIENTES, ARTICULOS, CIUDADES, VENDEDORES,
-- PROFESIONES, RELACIONES_PERSONALES y la vista V_PRECIOS_VENTAS.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. TRIGGER TRG_APROBAR_SOLICITUD  (correr aparte, una sola vez)
-- ---------------------------------------------------------------------
-- Es el que convierte la solicitud en crédito: al pasar ESTADO a 'APROBADA'
-- copia cabecera, detalle, referencias y actividad a las tablas VENTAS_*.
-- Estaba solo en la base; se versiona acá el 2026-10-19 porque hubo que
-- tocarlo.
--
-- ÚNICO CAMBIO contra el que está en producción: el INSERT de REFERENCIAS
-- (punto 3) copia también la cédula y los datos del garante. Antes copiaba
-- solo relacion, telefono, nombre_apellido e ind_garante, y esos datos se
-- quedaban en la solicitud. El resto está textual, incluidos los comentarios
-- repetidos del correlativo.
--
-- Requiere que las dos tablas ya tengan las columnas (en las dos ya están,
-- 2026-10-19). Si faltara alguna, el trigger compila INVALID y la próxima
-- aprobación falla con ORA-04098 — y en el celular el asesor no puede
-- aprobar nada.
--
-- Después de correrlo:
--   SELECT status FROM user_objects WHERE object_name = 'TRG_APROBAR_SOLICITUD';
--   -> VALID
--
-- Rollback: volver a crearlo con el INSERT de referencias de antes:
--   INSERT INTO ventas_referencias (id, relacion, telefono, nombre_apellido, ind_garante)
--   SELECT l_ventas_id, r.relacion, r.telefono, r.nombre_apellido, r.ind_garante
--   FROM   solicitud_ventas_referencias r
--   WHERE  r.id = :NEW.id;

CREATE OR REPLACE EDITIONABLE TRIGGER "TRG_APROBAR_SOLICITUD"
AFTER UPDATE OF estado ON solicitud_ventas_cabecera
FOR EACH ROW
 WHEN (NEW.estado = 'APROBADA' AND NVL(OLD.estado, '~') <> 'APROBADA') DECLARE
  l_ventas_id   ventas_cabecera.id%TYPE;
  l_nro         ventas_cabecera.nro_solicitud%TYPE;
  l_existe      NUMBER;
BEGIN
  -- Evitar duplicar la venta si esta solicitud ya fue aprobada antes
  SELECT COUNT(*) INTO l_existe
  FROM   ventas_cabecera
  WHERE  id_solicitud = :NEW.id;

  IF l_existe > 0 THEN
    RETURN;
  END IF;

  -- Numero correlativo desde 100000: MAX actual + 1
-- Numero correlativo: siempre superior a 100000
SELECT GREATEST(NVL(MAX(nro_solicitud), 0), 100000) + 1
INTO   l_nro
FROM   ventas_cabecera;
  ----------------------------------------------------------------------------
  -- 1) CABECERA  (el ID de la venta lo genera BI_VENTAS_CABECERA)
  ----------------------------------------------------------------------------
  INSERT INTO ventas_cabecera (
    nro_solicitud, fecha_factura, referencia, cod_cliente, cantidad_cuotas,
    total, monto_cuota, cod_ciudad, cod_vendedor, fec_vencimiento_inicial,
    entrega_inicial, porc_interes, id_solicitud
  ) VALUES (
    l_nro, :NEW.fecha_factura, :NEW.referencia, :NEW.cod_cliente,
    :NEW.cantidad_cuotas, :NEW.total, :NEW.monto_cuota, :NEW.cod_ciudad,
    :NEW.cod_vendedor, :NEW.fec_vencimiento_inicial, :NEW.entrega_inicial,
    :NEW.porc_interes, :NEW.id
  ) RETURNING id INTO l_ventas_id;

  ----------------------------------------------------------------------------
  -- 2) DETALLE (articulos)   ID_DETALLE lo genera BI_VENTAS_DETALLE
  ----------------------------------------------------------------------------
  INSERT INTO ventas_detalle (id, cod_articulo, cantidad, precio_unitario)
  SELECT l_ventas_id, d.cod_articulo, d.cantidad, d.precio_unitario
  FROM   solicitud_ventas_detalle d
  WHERE  d.id = :NEW.id;

  ----------------------------------------------------------------------------
  -- 3) REFERENCIAS   (2026-10-19: + cédula y datos laborales del garante)
  ----------------------------------------------------------------------------
    INSERT INTO ventas_referencias (
      id, relacion, telefono, nombre_apellido, ind_garante,
      nro_documento, es_empleado, antiguedad_anios, cod_profesion,
      empresa_nombre, empresa_telefono, empresa_ciudad, empresa_calle_nro,
      puesto, ingresos_mensuales, posee_otros_ingresos, conceptos, aporta_ips
    )
    SELECT l_ventas_id, r.relacion, r.telefono, r.nombre_apellido, r.ind_garante,
           r.nro_documento, r.es_empleado, r.antiguedad_anios, r.cod_profesion,
           r.empresa_nombre, r.empresa_telefono, r.empresa_ciudad, r.empresa_calle_nro,
           r.puesto, r.ingresos_mensuales, r.posee_otros_ingresos, r.conceptos, r.aporta_ips
    FROM   solicitud_ventas_referencias r
    WHERE  r.id = :NEW.id;

  ----------------------------------------------------------------------------
  -- 4) ACTIVIDAD LABORAL
  ----------------------------------------------------------------------------
  INSERT INTO ventas_actividad_laboral (
    id, es_empleado, nombre_empresa, direccion, puesto_ocupado,
    ingresos_mensuales, otros_ingresos, antiguedad, telefono,
    cod_profesion, cod_ciudad, aporta_ips
  )
  SELECT l_ventas_id, al.es_empleado, al.nombre_empresa, al.direccion,
         al.puesto_ocupado, al.ingresos_mensuales, al.otros_ingresos,
         al.antiguedad, al.telefono, al.cod_profesion, al.cod_ciudad,
         al.aporta_ips
  FROM   solicitud_ventas_actividad_laboral al
  WHERE  al.id = :NEW.id;

EXCEPTION
  WHEN OTHERS THEN
    RAISE_APPLICATION_ERROR(-20050,
      'No se pudo generar la venta al aprobar la solicitud ' ||
      :NEW.id || ': ' || SQLERRM);
END;
/
ALTER TRIGGER "TRG_APROBAR_SOLICITUD" ENABLE;


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
  --
  -- p_nro_documento (2026-10-19): cédula de cualquier referencia, garante o no.
  -- El resto (de p_es_empleado a p_aporta_ips) son los datos laborales del
  -- garante: solo se guardan si p_ind_garante = 'S'; en una referencia común
  -- van NULL aunque lleguen. Todos opcionales (decisión de Jose) y con DEFAULT
  -- NULL, igual que p_ind_garante.
  FUNCTION ins_referencia(
    p_id                   NUMBER,
    p_relacion             VARCHAR2,
    p_telefono             VARCHAR2,
    p_nombre_apellido      VARCHAR2,
    p_ind_garante          VARCHAR2 DEFAULT 'N',
    p_nro_documento        VARCHAR2 DEFAULT NULL,
    p_es_empleado          VARCHAR2 DEFAULT NULL,
    p_antiguedad_anios     NUMBER   DEFAULT NULL,
    p_cod_profesion        NUMBER   DEFAULT NULL,
    p_empresa_nombre       VARCHAR2 DEFAULT NULL,
    p_empresa_telefono     VARCHAR2 DEFAULT NULL,
    p_empresa_ciudad       VARCHAR2 DEFAULT NULL,
    p_empresa_calle_nro    VARCHAR2 DEFAULT NULL,
    p_puesto               VARCHAR2 DEFAULT NULL,
    p_ingresos_mensuales   NUMBER   DEFAULT NULL,
    p_posee_otros_ingresos VARCHAR2 DEFAULT NULL,
    p_conceptos            VARCHAR2 DEFAULT NULL,
    p_aporta_ips           VARCHAR2 DEFAULT NULL
  ) RETURN NUMBER;

  PROCEDURE upd_referencia(
    p_id_detalle           NUMBER,
    p_relacion             VARCHAR2,
    p_telefono             VARCHAR2,
    p_nombre_apellido      VARCHAR2,
    p_ind_garante          VARCHAR2 DEFAULT 'N',
    p_nro_documento        VARCHAR2 DEFAULT NULL,
    p_es_empleado          VARCHAR2 DEFAULT NULL,
    p_antiguedad_anios     NUMBER   DEFAULT NULL,
    p_cod_profesion        NUMBER   DEFAULT NULL,
    p_empresa_nombre       VARCHAR2 DEFAULT NULL,
    p_empresa_telefono     VARCHAR2 DEFAULT NULL,
    p_empresa_ciudad       VARCHAR2 DEFAULT NULL,
    p_empresa_calle_nro    VARCHAR2 DEFAULT NULL,
    p_puesto               VARCHAR2 DEFAULT NULL,
    p_ingresos_mensuales   NUMBER   DEFAULT NULL,
    p_posee_otros_ingresos VARCHAR2 DEFAULT NULL,
    p_conceptos            VARCHAR2 DEFAULT NULL,
    p_aporta_ips           VARCHAR2 DEFAULT NULL
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

  --------------------------------------------------------------- PROFESIONES
  -- Alta de una profesión desde el wizard (2026-10-19), para cualquier asesor
  -- con token válido (decisión de Jose). Mismas reglas que
  -- pkg_definiciones.profesion_crear, pero sin la lista de administradores:
  -- descripción sin espacios de más, hasta 200 caracteres, y no repetida sin
  -- distinguir mayúsculas. Devuelve el COD_PROFESION que pone BI_PROFESIONES.
  --
  -- No llama a pkg_definiciones a propósito: si ese paquete queda INVALID (o
  -- no está desplegado), este body también, y se caen todas las solicitudes.
  FUNCTION ins_profesion(p_descripcion VARCHAR2) RETURN NUMBER;

END pkg_solicitud_ventas;
/

CREATE OR REPLACE PACKAGE BODY pkg_solicitud_ventas AS

  -- ⚠ Los TIPOS van acá arriba, antes de cualquier FUNCTION/PROCEDURE: en un
  -- package body una declaración después de un subprograma no compila
  -- (PLS-00103 "Se ha encontrado el símbolo TYPE"). Pasó el 2026-10-19 y dejó
  -- el body INVALID: todos los POST/PUT de solicitudes respondían error.
  --
  -- Datos laborales del garante, ya normalizados (ver datos_garante).
  TYPE t_garante IS RECORD (
    es_empleado          VARCHAR2(1),
    antiguedad_anios     NUMBER,
    cod_profesion        NUMBER,
    empresa_nombre       VARCHAR2(200),
    empresa_telefono     VARCHAR2(200),
    empresa_ciudad       VARCHAR2(200),
    empresa_calle_nro    VARCHAR2(200),
    puesto               VARCHAR2(200),
    ingresos_mensuales   NUMBER,
    posee_otros_ingresos VARCHAR2(1),
    conceptos            VARCHAR2(400),
    aporta_ips           VARCHAR2(1)
  );

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

  -- ES_EMPLEADO, POSEE_OTROS_INGRESOS y APORTA_IPS admiten NULL, pero sus CHECK
  -- solo aceptan 'S'/'N': cualquier otro valor se guarda NULL (sin dato) en
  -- vez de tirar ORA-02290.
  FUNCTION norm_sn(p_valor VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN CASE UPPER(TRIM(p_valor)) WHEN 'S' THEN 'S' WHEN 'N' THEN 'N' END;
  END norm_sn;

  -- Los datos del garante, ya normalizados (el tipo t_garante está al
  -- principio del body). Una referencia común los deja todos NULL aunque el
  -- cliente los mande; CONCEPTOS solo va si POSEE_OTROS_INGRESOS = 'S'. Los
  -- rangos se validan acá para dar un mensaje legible en vez de ORA-01438
  -- (ANTIGUEDAD_ANIOS es NUMBER(3,0)).
  FUNCTION datos_garante(
    p_ind_garante          VARCHAR2,
    p_es_empleado          VARCHAR2,
    p_antiguedad_anios     NUMBER,
    p_cod_profesion        NUMBER,
    p_empresa_nombre       VARCHAR2,
    p_empresa_telefono     VARCHAR2,
    p_empresa_ciudad       VARCHAR2,
    p_empresa_calle_nro    VARCHAR2,
    p_puesto               VARCHAR2,
    p_ingresos_mensuales   NUMBER,
    p_posee_otros_ingresos VARCHAR2,
    p_conceptos            VARCHAR2,
    p_aporta_ips           VARCHAR2
  ) RETURN t_garante IS
    g t_garante;
  BEGIN
    IF p_ind_garante <> 'S' THEN
      RETURN g;
    END IF;

    IF p_antiguedad_anios IS NOT NULL
       AND (p_antiguedad_anios < 0 OR p_antiguedad_anios > 99
            OR p_antiguedad_anios <> TRUNC(p_antiguedad_anios)) THEN
      RAISE_APPLICATION_ERROR(-20401, 'La antigüedad del garante va en años enteros, de 0 a 99');
    END IF;
    IF p_ingresos_mensuales IS NOT NULL AND p_ingresos_mensuales < 0 THEN
      RAISE_APPLICATION_ERROR(-20402, 'Los ingresos mensuales del garante no pueden ser negativos');
    END IF;

    g.es_empleado          := norm_sn(p_es_empleado);
    g.antiguedad_anios     := p_antiguedad_anios;
    g.cod_profesion        := p_cod_profesion;
    g.empresa_nombre       := TRIM(p_empresa_nombre);
    g.empresa_telefono     := TRIM(p_empresa_telefono);
    g.empresa_ciudad       := TRIM(p_empresa_ciudad);
    g.empresa_calle_nro    := TRIM(p_empresa_calle_nro);
    g.puesto               := TRIM(p_puesto);
    g.ingresos_mensuales   := p_ingresos_mensuales;
    g.posee_otros_ingresos := norm_sn(p_posee_otros_ingresos);
    g.conceptos            := CASE WHEN g.posee_otros_ingresos = 'S' THEN TRIM(p_conceptos) END;
    g.aporta_ips           := norm_sn(p_aporta_ips);
    RETURN g;
  END datos_garante;

  FUNCTION ins_referencia(
    p_id                   NUMBER,
    p_relacion             VARCHAR2,
    p_telefono             VARCHAR2,
    p_nombre_apellido      VARCHAR2,
    p_ind_garante          VARCHAR2 DEFAULT 'N',
    p_nro_documento        VARCHAR2 DEFAULT NULL,
    p_es_empleado          VARCHAR2 DEFAULT NULL,
    p_antiguedad_anios     NUMBER   DEFAULT NULL,
    p_cod_profesion        NUMBER   DEFAULT NULL,
    p_empresa_nombre       VARCHAR2 DEFAULT NULL,
    p_empresa_telefono     VARCHAR2 DEFAULT NULL,
    p_empresa_ciudad       VARCHAR2 DEFAULT NULL,
    p_empresa_calle_nro    VARCHAR2 DEFAULT NULL,
    p_puesto               VARCHAR2 DEFAULT NULL,
    p_ingresos_mensuales   NUMBER   DEFAULT NULL,
    p_posee_otros_ingresos VARCHAR2 DEFAULT NULL,
    p_conceptos            VARCHAR2 DEFAULT NULL,
    p_aporta_ips           VARCHAR2 DEFAULT NULL
  ) RETURN NUMBER IS
    l_id_detalle NUMBER;
    -- norm_garante y datos_garante son privadas del body: no se pueden llamar
    -- dentro del SQL (PLS-00231), así que se resuelven antes en variables.
    l_garante    VARCHAR2(1) := norm_garante(p_ind_garante);
    g            t_garante   := datos_garante(
                                  l_garante, p_es_empleado, p_antiguedad_anios, p_cod_profesion,
                                  p_empresa_nombre, p_empresa_telefono, p_empresa_ciudad,
                                  p_empresa_calle_nro, p_puesto, p_ingresos_mensuales,
                                  p_posee_otros_ingresos, p_conceptos, p_aporta_ips);
  BEGIN
    INSERT INTO solicitud_ventas_referencias (
      id, relacion, telefono, nombre_apellido, ind_garante, nro_documento,
      es_empleado, antiguedad_anios, cod_profesion, empresa_nombre, empresa_telefono,
      empresa_ciudad, empresa_calle_nro, puesto, ingresos_mensuales,
      posee_otros_ingresos, conceptos, aporta_ips
    ) VALUES (
      p_id, p_relacion, p_telefono, p_nombre_apellido, l_garante, TRIM(p_nro_documento),
      g.es_empleado, g.antiguedad_anios, g.cod_profesion, g.empresa_nombre, g.empresa_telefono,
      g.empresa_ciudad, g.empresa_calle_nro, g.puesto, g.ingresos_mensuales,
      g.posee_otros_ingresos, g.conceptos, g.aporta_ips
    ) RETURNING id_detalle INTO l_id_detalle;
    COMMIT;
    RETURN l_id_detalle;
  END ins_referencia;

  PROCEDURE upd_referencia(
    p_id_detalle           NUMBER,
    p_relacion             VARCHAR2,
    p_telefono             VARCHAR2,
    p_nombre_apellido      VARCHAR2,
    p_ind_garante          VARCHAR2 DEFAULT 'N',
    p_nro_documento        VARCHAR2 DEFAULT NULL,
    p_es_empleado          VARCHAR2 DEFAULT NULL,
    p_antiguedad_anios     NUMBER   DEFAULT NULL,
    p_cod_profesion        NUMBER   DEFAULT NULL,
    p_empresa_nombre       VARCHAR2 DEFAULT NULL,
    p_empresa_telefono     VARCHAR2 DEFAULT NULL,
    p_empresa_ciudad       VARCHAR2 DEFAULT NULL,
    p_empresa_calle_nro    VARCHAR2 DEFAULT NULL,
    p_puesto               VARCHAR2 DEFAULT NULL,
    p_ingresos_mensuales   NUMBER   DEFAULT NULL,
    p_posee_otros_ingresos VARCHAR2 DEFAULT NULL,
    p_conceptos            VARCHAR2 DEFAULT NULL,
    p_aporta_ips           VARCHAR2 DEFAULT NULL
  ) IS
    l_garante VARCHAR2(1) := norm_garante(p_ind_garante);
    g         t_garante   := datos_garante(
                               l_garante, p_es_empleado, p_antiguedad_anios, p_cod_profesion,
                               p_empresa_nombre, p_empresa_telefono, p_empresa_ciudad,
                               p_empresa_calle_nro, p_puesto, p_ingresos_mensuales,
                               p_posee_otros_ingresos, p_conceptos, p_aporta_ips);
  BEGIN
    -- Si deja de ser garante, sus datos laborales se borran (g viene vacío).
    UPDATE solicitud_ventas_referencias SET
      relacion             = p_relacion,
      telefono             = p_telefono,
      nombre_apellido      = p_nombre_apellido,
      ind_garante          = l_garante,
      nro_documento        = TRIM(p_nro_documento),
      es_empleado          = g.es_empleado,
      antiguedad_anios     = g.antiguedad_anios,
      cod_profesion        = g.cod_profesion,
      empresa_nombre       = g.empresa_nombre,
      empresa_telefono     = g.empresa_telefono,
      empresa_ciudad       = g.empresa_ciudad,
      empresa_calle_nro    = g.empresa_calle_nro,
      puesto               = g.puesto,
      ingresos_mensuales   = g.ingresos_mensuales,
      posee_otros_ingresos = g.posee_otros_ingresos,
      conceptos            = g.conceptos,
      aporta_ips           = g.aporta_ips
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

  --------------------------------------------------------------- PROFESIONES
  -- Misma validación que pkg_definiciones.profesion_validar (copiada, ver la
  -- spec): si cambia una regla allá, cambiarla acá también.
  FUNCTION ins_profesion(p_descripcion VARCHAR2) RETURN NUMBER IS
    l_desc VARCHAR2(4000) := TRIM(REGEXP_REPLACE(p_descripcion, '\s+', ' '));
    l_otro NUMBER;
    l_cod  NUMBER;
  BEGIN
    IF l_desc IS NULL THEN
      RAISE_APPLICATION_ERROR(-20411, 'Falta la descripción de la profesión');
    END IF;
    IF LENGTH(l_desc) > 200 THEN
      RAISE_APPLICATION_ERROR(-20412, 'La profesión admite hasta 200 caracteres');
    END IF;

    SELECT MIN(cod_profesion) INTO l_otro
      FROM profesiones
     WHERE UPPER(TRIM(REGEXP_REPLACE(descripcion, '\s+', ' '))) = UPPER(l_desc);
    IF l_otro IS NOT NULL THEN
      RAISE_APPLICATION_ERROR(-20413,
        'Ya existe la profesión ' || l_desc || ': buscala en la lista');
    END IF;

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
  END ins_profesion;

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

  -- SELECT * ya incluye IND_GARANTE y las columnas del 2026-10-19 (cédula y
  -- datos del garante); el frontend las lee en minúscula. La profesión del
  -- garante se resuelve en el cliente con lovLabels("profesiones").
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
          p_ind_garante => :ind_garante, p_nro_documento => :nro_documento,
          p_es_empleado => :es_empleado, p_antiguedad_anios => :antiguedad_anios,
          p_cod_profesion => :cod_profesion, p_empresa_nombre => :empresa_nombre,
          p_empresa_telefono => :empresa_telefono, p_empresa_ciudad => :empresa_ciudad,
          p_empresa_calle_nro => :empresa_calle_nro, p_puesto => :puesto,
          p_ingresos_mensuales => :ingresos_mensuales,
          p_posee_otros_ingresos => :posee_otros_ingresos,
          p_conceptos => :conceptos, p_aporta_ips => :aporta_ips);
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
          p_ind_garante => :ind_garante, p_nro_documento => :nro_documento,
          p_es_empleado => :es_empleado, p_antiguedad_anios => :antiguedad_anios,
          p_cod_profesion => :cod_profesion, p_empresa_nombre => :empresa_nombre,
          p_empresa_telefono => :empresa_telefono, p_empresa_ciudad => :empresa_ciudad,
          p_empresa_calle_nro => :empresa_calle_nro, p_puesto => :puesto,
          p_ingresos_mensuales => :ingresos_mensuales,
          p_posee_otros_ingresos => :posee_otros_ingresos,
          p_conceptos => :conceptos, p_aporta_ips => :aporta_ips);
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

  -- Alta de profesión desde el wizard (2026-10-19). Cualquier asesor con token
  -- válido; las reglas están en pkg_solicitud_ventas.ins_profesion. Devuelve
  -- la fila como la da el LOV ({value, label}) para que el wizard la deje
  -- elegida sin volver a pedir la lista.
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'solicitudes',
      p_pattern        => 'profesiones',
      p_priority       => 0,
      p_etag_type      => 'NONE',
      p_etag_query     => NULL,
      p_comments       => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'solicitudes',
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
        l_desc VARCHAR2(200);
      BEGIN
        l_user := pkg_auth_token.validar_token(REPLACE(:authorization, ''Bearer '', ''''));
        IF l_user IS NULL THEN
          :status_code := 401;
          htp.p(''{"success": false, "message": "Token invalido o expirado"}'');
          RETURN;
        END IF;

        l_cod := pkg_solicitud_ventas.ins_profesion(:descripcion);
        SELECT descripcion INTO l_desc FROM profesiones WHERE cod_profesion = l_cod;

        :status_code := 201;
        apex_json.open_object;
        apex_json.write(''success'', TRUE);
        apex_json.write(''value'',   l_cod);
        apex_json.write(''label'',   l_desc);
        apex_json.close_object;
      EXCEPTION WHEN OTHERS THEN
        :status_code := 400;
        htp.p(''{"success": false, "message": '' || apex_json.stringify(SQLERRM) || ''}'');
      END;
    ');

  ORDS.DEFINE_PARAMETER(
      p_module_name        => 'solicitudes',
      p_pattern            => 'profesiones',
      p_method             => 'POST',
      p_name               => 'authorization',
      p_bind_variable_name => 'authorization',
      p_source_type        => 'HEADER',
      p_param_type         => 'STRING',
      p_access_method      => 'IN',
      p_comments           => NULL);

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
