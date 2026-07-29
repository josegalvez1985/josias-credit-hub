-- =====================================================================
-- ENDPOINT: /consultas  —  ficha de cliente para "Consultar Datos de Clientes"
-- Contiene: solo el módulo ORDS. Sin paquete y sin DDL: es de lectura pura.
-- Correr como WKSP_JOSIASMUEBLES.
--
-- Tablas que usa: CLIENTES, CIUDADES  (ambas ya existen, no se tocan).
--
-- POR QUÉ ESTE ARCHIVO EXISTE
-- ---------------------------
-- `GET /recibos/cliente/:cod_cliente` empezó a fallar desde el navegador con
--   "No 'Access-Control-Allow-Origin' header is present"
-- desde el origen http://192.168.100.16:8080 (la app servida en la LAN).
-- Ese mensaje casi nunca es CORS: es un 500 —o un módulo ORDS trabado— que
-- responde sin cabeceras y el browser tapa el motivo real (ver backend/README.md).
--
-- En vez de redefinir el módulo `recibos` entero —que tiene 15 handlers y cuyo
-- DEFINE_MODULE no es idempotente— se publica el mismo SELECT en un módulo
-- nuevo e independiente. Es el recurso que ya está documentado en
-- backend/README.md → "Si el despliegue deja el módulo trabado", punto 4:
-- renombrar el módulo y ajustar la ruta en src/lib/api.ts.
--
-- Ventaja: si el `recibos` viejo estaba trabado, esto lo destraba sin riesgo;
-- si NO estaba trabado, tampoco rompe nada — el handler viejo sigue publicado
-- y sin usar. La sección 3 dice cómo distinguir un caso del otro.
-- =====================================================================


-- =====================================================================
-- 1. SANEAMIENTO
-- =====================================================================
-- Nada que sanear: este módulo solo lee CLIENTES y CIUDADES, no crea ni
-- altera objetos. No hay paquete tampoco — un GET que invoca un paquete
-- devuelve 500 en cuanto ese paquete queda INVALID, y ese es justamente el
-- fallo que estamos esquivando. SQL puro, como los GET de `solicitudes`.


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
  SELECT COUNT(*) INTO l_existe FROM user_ords_modules WHERE name = 'consultas';
  IF l_existe > 0 THEN
    ORDS.DELETE_MODULE(p_module_name => 'consultas');
    COMMIT;
  END IF;
END;
/

-- Verificar que dé 0 ANTES de seguir con 2.b:
--   SELECT COUNT(*) FROM user_ords_modules WHERE name = 'consultas';
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

  ORDS.DEFINE_MODULE(
      p_module_name    => 'consultas',
      p_base_path      => '/consultas/',
      p_items_per_page => 25,
      p_status         => 'PUBLISHED',
      p_comments       => NULL);


  -- ==================================================================
  -- FICHA DE CLIENTE   GET /consultas/cliente/:cod_cliente
  -- ==================================================================
  -- Página 10 de APEX ("Consultar Datos de Clientes").
  -- Mismo SELECT que tenía `recibos/cliente/:cod_cliente`, sin cambios de
  -- columnas: el tipo FichaCliente de src/lib/api.ts sigue calzando igual.
  --
  -- El LEFT JOIN es importante y no es cosmético: con el INNER JOIN original
  -- (heredado del `from clientes cl, ciudades ci`) un cliente SIN ciudad
  -- cargada no devolvía filas y la pantalla decía "Cliente no encontrado"
  -- aunque el cliente existiera. Así la ciudad viene NULL y el resto se ve.
  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'consultas',
      p_pattern        => 'cliente/:cod_cliente',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => NULL);

  -- json/query;type=single devuelve el objeto suelto (no un feed {items:[…]}).
  -- Si el cliente no existe, ORDS responde 404 con cuerpo vacío y el cliente
  -- HTTP lo reporta como "Error 404" — mismo comportamiento que antes.
  --
  -- Sin validación de token, igual que el handler que reemplaza y que todos
  -- los GET de lectura de `solicitudes` y de los LOV. Es SQL puro a propósito:
  -- validar el token obliga a plsql/block + pkg_auth_token, y un GET que llama
  -- a un paquete devuelve 500 apenas ese paquete queda INVALID. Si más adelante
  -- se decide protegerlo, el patrón está en _PLANTILLA.sql → "CON TOKEN"
  -- (hace falta además el ORDS.DEFINE_PARAMETER de tipo HEADER).
  ORDS.DEFINE_HANDLER(
      p_module_name    => 'consultas',
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

-- 3.a  ¿Quedó el handler publicado?
--
--   SELECT t.uri_template, h.method, h.source_type
--     FROM user_ords_modules p
--     JOIN user_ords_templates t ON t.module_id = p.id
--     JOIN user_ords_handlers  h ON h.template_id = t.id
--    WHERE p.name = 'consultas'
--    ORDER BY t.uri_template, h.method;
--
-- Tiene que devolver exactamente una fila:
--   cliente/:cod_cliente   GET   json/query;type=single

-- 3.b  ¿El SELECT corre de verdad? (probar con un cliente que exista)
--
--   SELECT cl.cod_cliente, cl.razon_social, NVL(cl.ci, cl.ruc) AS documento,
--          cl.nro_telefono, ci.descripcion AS ciudad, cl.direccion,
--          cl.nro_casa, cl.ubicacion
--     FROM clientes cl
--     LEFT JOIN ciudades ci ON ci.cod_ciudad = cl.cod_ciudad
--    WHERE cl.cod_cliente = 3229;

-- 3.c  Desde afuera, con curl (NUNCA desde el navegador: si algo falla, el
--      browser lo reporta como error de CORS y esconde el motivo real).
--
--   curl -i "https://oracleapex.com/ords/josiasmuebles/consultas/cliente/3229"
--
--   200 + JSON  -> listo, el módulo nuevo anda.
--   404         -> el módulo anda; ese cod_cliente no existe. Probar con otro.
--   500         -> mirar el cuerpo de la respuesta, ahí viene el ORA-.
--
-- 3.d  QUÉ PASÓ REALMENTE CON /recibos/cliente/  (vale la pena saberlo)
--      Con el módulo nuevo andando, comparar los dos contra el MISMO cliente:
--
--   curl -i "https://oracleapex.com/ords/josiasmuebles/consultas/cliente/3229"
--   curl -i "https://oracleapex.com/ords/josiasmuebles/recibos/cliente/3229"
--
--   Si el nuevo da 200 y el viejo da 500  -> el módulo `recibos` quedó trabado
--     o a medias. Conviene redesplegarlo entero (backend/recibos.sql §3) en
--     algún momento tranquilo, porque el resto de sus handlers está en riesgo.
--   Si los DOS dan 200 desde curl pero el navegador seguía fallando -> el
--     problema no era Oracle: es el borde (Akamai delante de oracleapex.com)
--     o el service worker de la PWA sirviendo una respuesta vieja. Ahí lo que
--     hay que hacer es Application -> Service Workers -> Unregister + Ctrl+Shift+R.
--   Si los dos dan 500 -> el problema es el SELECT o los permisos sobre
--     CIUDADES; 3.b lo confirma en un segundo.


-- =====================================================================
-- 4. ROLLBACK
-- =====================================================================
-- Este módulo no crea objetos ni toca datos: se deshace borrándolo, y el
-- frontend vuelve a /recibos/cliente/:cod_cliente cambiando esa ruta en
-- src/lib/api.ts (función fichaCliente).
--
--   BEGIN
--     ORDS.DELETE_MODULE(p_module_name => 'consultas');
--     COMMIT;
--   END;
--   /
