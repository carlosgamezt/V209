-- Dos ejes de estado, idempotencia/conciliación de operaciones fiscales, anulación con reglas versionadas, identificaciones.
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_ok boolean := false;
begin
  begin execute p_sql; exception when others then v_ok := (sqlerrm ~ p_patron) or (sqlstate ~ p_patron); end;
  if not v_ok then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'maestro@fel.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'prop@fel.test'),
  ('00000000-0000-0000-0000-0000000000b3', 'emisor@fel.test'),
  ('00000000-0000-0000-0000-0000000000b9', 'prop2@fel.test');
insert into public.plataforma_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1');

insert into public.regimenes_fiscales (codigo, version, nombre, reglas, fuente, vigente_desde)
values ('prueba_reg', 1, 'Régimen de prueba', '{"esquema":1,"impuestos":[],"precios_incluyen_impuesto":false,"redondeo":{"modo":"x","decimales":2}}', 'Referencia de prueba', current_date);
update public.regimenes_fiscales set estado = 'verificado', verificado_por = '00000000-0000-0000-0000-0000000000a1', verificado_en = now() where codigo = 'prueba_reg';

insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id, estado)
select e.id, e.n, e.n || ' S.A.', e.nit, r.id, 'habilitada'
  from (values ('10000000-0000-0000-0000-00000000000a'::uuid, 'Empresa A', '1111111-1'),
               ('10000000-0000-0000-0000-00000000000b'::uuid, 'Empresa B', '2222222-2')) e(id, n, nit),
       public.regimenes_fiscales r where r.codigo = 'prueba_reg';
insert into public.miembros (empresa_id, user_id, rol) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b1', 'propietario'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b3', 'emisor'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b9', 'propietario');
-- emisión real SOLO en la empresa A (en B queda bloqueada)
select public.fel_admin_emision('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', true, 'Prueba de emisión');

select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000b3', '10000000-0000-0000-0000-00000000000a', null, 'NIT', '3333333-3', 'Cliente', null, null, null, null);

-- ================= identificaciones: sin verificar no se aplica patrón; verificada, sí (y solo la verifica el maestro)
select pg_temp.espera_error($$select public.fel_admin_identificacion_verificar('00000000-0000-0000-0000-0000000000b1', 'NIT', '^[0-9]{7}-[0-9K]$', 'Fuente de prueba', 'Prueba de verificación')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_admin_identificacion_verificar('00000000-0000-0000-0000-0000000000a1', 'NIT', '^[0-9]{7}-[0-9K]$', '', 'Prueba de verificación')$$, 'FEL_REGLA');
select public.fel_admin_identificacion_verificar('00000000-0000-0000-0000-0000000000a1', 'NIT', '^[0-9]{7}-[0-9K]$', 'Fuente de prueba', 'Prueba de verificación');
select pg_temp.espera_error($$select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000b3', '10000000-0000-0000-0000-00000000000a', null, 'NIT', 'ABC', 'Mal', null, null, null, null)$$, 'FEL_REGLA');
select pg_temp.espera_error($$update public.identificaciones_tipos set patron = '.*' where codigo = 'NIT'$$, 'FEL_REGLA');
select pg_temp.espera_error($$select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000b3', '10000000-0000-0000-0000-00000000000a', null, 'PASAPORTE', 'X1', 'Mal', null, null, null, null)$$, 'FEL_REGLA');
select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000b3', '10000000-0000-0000-0000-00000000000a', null, 'CF', 'lo-que-sea', 'Consumidor final', null, null, null, null);
do $$ begin assert exists (select 1 from public.clientes where tipo_identificacion = 'CF' and numero_identificacion = 'CF'), 'CF no se normalizó'; end $$;

-- ================= borrador: crear, editar con versión, revisar, congelar contenido
create temp table t_doc as
select (public.fel_op_documento_guardar('00000000-0000-0000-0000-0000000000b3', '10000000-0000-0000-0000-00000000000a', null,
  (select id from public.clientes where numero_identificacion = '3333333-3'), current_date, 'obs',
  '[{"orden":1,"descripcion":"Servicio","cantidad":2,"precio_unitario":10.5}]'::jsonb, 21, 0, 21, '{"oficial":false}'::jsonb, null)).id as id;
do $$ begin
  assert (select estado_preparacion || '/' || estado_fiscal from public.documentos where id = (select id from t_doc)) = 'borrador/ninguno', 'estado inicial';
  assert (select serie is null and numero_fiscal is null and autorizacion_sat is null from public.documentos where id = (select id from t_doc)), 'fiscales vacíos';
end $$;
select pg_temp.espera_error($$select public.fel_op_documento_guardar('00000000-0000-0000-0000-0000000000b3', '10000000-0000-0000-0000-00000000000a', (select id from t_doc), null, current_date, 'x', '[]'::jsonb, 0, 0, 0, '{}'::jsonb, 99)$$, 'FEL_CONFLICTO');
select pg_temp.espera_error($$select public.fel_op_documento_preparacion('00000000-0000-0000-0000-0000000000b3', '10000000-0000-0000-0000-00000000000a', (select id from t_doc), 'revisado', null, 1)$$, 'FEL_NO_AUTORIZADO');  -- el emisor no revisa
select public.fel_op_documento_preparacion('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000a', (select id from t_doc), 'revisado', null, 1);
select pg_temp.espera_error($$select public.fel_op_documento_guardar('00000000-0000-0000-0000-0000000000b3', '10000000-0000-0000-0000-00000000000a', (select id from t_doc), null, current_date, 'x', '[]'::jsonb, 0, 0, 0, '{}'::jsonb, 2)$$, 'FEL_REGLA');
select pg_temp.espera_error($$delete from public.documento_lineas$$, 'FEL_REGLA');
select pg_temp.espera_error($$update public.documentos set observaciones = 'cambio directo' where id = (select id from t_doc)$$, 'FEL_REGLA');
-- A no puede tocar el documento de la otra empresa indicando su id
select pg_temp.espera_error($$select public.fel_op_documento_preparacion('00000000-0000-0000-0000-0000000000b9', '10000000-0000-0000-0000-00000000000b', (select id from t_doc), 'archivado', 'intento ajeno', 2)$$, 'FEL_NO_ENCONTRADO');

-- ================= certificación: permisos, bloqueo de emisión, idempotencia
select pg_temp.espera_error($$select public.fel_op_certificacion_iniciar('00000000-0000-0000-0000-0000000000b3', '10000000-0000-0000-0000-00000000000a', (select id from t_doc), 'clave-0000000000001', repeat('a',64), 'prueba')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_certificacion_iniciar('00000000-0000-0000-0000-0000000000b9', '10000000-0000-0000-0000-00000000000b', (select id from t_doc), 'clave-0000000000001', repeat('a',64), 'prueba')$$, 'FEL_EMISION_BLOQUEADA');
create temp table t_op1 as
select (public.fel_op_certificacion_iniciar('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000a', (select id from t_doc), 'clave-0000000000001', repeat('a',64), 'prueba')).id as id;
do $$ begin
  assert (select estado_fiscal from public.documentos where id = (select id from t_doc)) = 'pendiente_certificacion', 'no quedó pendiente';
  -- repetir la MISMA clave devuelve la misma operación y no crea otra
  assert (select (public.fel_op_certificacion_iniciar('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000a', (select id from t_doc), 'clave-0000000000001', repeat('a',64), 'prueba')).id) = (select id from t_op1), 'idempotencia';
  assert (select count(*) from public.operaciones_fiscales) = 1, 'se duplicó la operación';
end $$;
select pg_temp.espera_error($$select public.fel_op_certificacion_iniciar('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000a', (select id from t_doc), 'clave-0000000000001', repeat('b',64), 'prueba')$$, 'FEL_CONFLICTO');
select pg_temp.espera_error($$select public.fel_op_certificacion_iniciar('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000a', (select id from t_doc), 'clave-0000000000002', repeat('a',64), 'prueba')$$, 'FEL_OPERACION_ABIERTA');
select pg_temp.espera_error($$update public.documentos set estado_fiscal = 'certificado' where id = (select id from t_doc)$$, 'FEL_REGLA');

-- ================= resultado desconocido: por verificar, SIN reintentos hasta conciliar
select public.fel_op_operacion_desconocida('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000a', (select id from t_op1));
do $$ begin assert (select estado_fiscal from public.documentos where id = (select id from t_doc)) = 'por_verificar', 'no quedó por verificar'; end $$;
select pg_temp.espera_error($$select public.fel_op_certificacion_iniciar('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000a', (select id from t_doc), 'clave-0000000000003', repeat('a',64), 'prueba')$$, 'FEL_OPERACION_ABIERTA');
select pg_temp.espera_error($$select public.fel_op_operacion_resolver('00000000-0000-0000-0000-0000000000b3', '10000000-0000-0000-0000-00000000000a', (select id from t_op1), false, 'conciliacion_manual', '{"nota":"x"}', null, null, null)$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_operacion_resolver('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000a', (select id from t_op1), false, 'conciliacion_manual', null, null, null, null)$$, 'FEL_REGLA');
-- se confirma (con evidencia) que NO se generó DTE: ahora sí se permite un nuevo intento con otra clave
select public.fel_op_operacion_resolver('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000a', (select id from t_op1), false, 'conciliacion_manual', '{"nota":"consulta en el portal: sin DTE"}', null, null, null);
do $$ begin assert (select estado_fiscal from public.documentos where id = (select id from t_doc)) = 'rechazado', 'no quedó rechazado'; end $$;
select pg_temp.espera_error($$update public.operaciones_fiscales set estado = 'iniciada'$$, 'FEL_REGLA');
select pg_temp.espera_error($$delete from public.operaciones_fiscales$$, 'FEL_APPEND_ONLY|FEL_REGLA');
create temp table t_op2 as
select (public.fel_op_certificacion_iniciar('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000a', (select id from t_doc), 'clave-0000000000004', repeat('c',64), 'prueba')).id as id;
select pg_temp.espera_error($$select public.fel_op_operacion_resolver('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000a', (select id from t_op2), true, 'proveedor', null, 'A', null, null)$$, 'FEL_REGLA');
select public.fel_op_operacion_resolver('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000a', (select id from t_op2), true, 'proveedor', '{"respuesta":"simulada-test"}', 'SERIE-TEST', 'NUM-TEST', 'AUT-TEST');

-- ================= DTE certificado: inmutable, no vuelve a borrador
do $$ begin assert (select estado_fiscal from public.documentos where id = (select id from t_doc)) = 'certificado', 'no certificó'; end $$;
select pg_temp.espera_error($$update public.documentos set observaciones = 'x' where id = (select id from t_doc)$$, 'FEL_REGLA');
select pg_temp.espera_error($$update public.documentos set serie = 'OTRA' where id = (select id from t_doc)$$, 'FEL_REGLA');
select pg_temp.espera_error($$update public.documentos set estado_preparacion = 'borrador' where id = (select id from t_doc)$$, 'FEL_REGLA');
select pg_temp.espera_error($$update public.documentos set estado_preparacion = 'archivado' where id = (select id from t_doc)$$, 'FEL_REGLA|23514');
select pg_temp.espera_error($$update public.documentos set estado_fiscal = 'ninguno' where id = (select id from t_doc)$$, 'FEL_REGLA');
select pg_temp.espera_error($$select public.fel_op_documento_preparacion('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000a', (select id from t_doc), 'archivado', 'intento archivar certificado', (select version from public.documentos where id = (select id from t_doc)))$$, 'FEL_REGLA');
select pg_temp.espera_error($$update public.documento_lineas set cantidad = 99$$, 'FEL_REGLA');

-- ================= anulación: reglas versionadas
select pg_temp.espera_error($$select public.fel_op_anulacion_iniciar('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000a', (select id from t_doc), 'anul-00000000000001', repeat('d',64), 'Motivo de prueba', 'prueba')$$, 'FEL_REGLA');  -- sin reglas verificadas
select pg_temp.espera_error($$update public.reglas_normativas set estado = 'verificado', verificado_por = '00000000-0000-0000-0000-0000000000a1', verificado_en = now(), fuente = 'Fuente de prueba', vigente_desde = current_date where codigo = 'anulacion_dte' and version = 1$$, 'FEL_REGLA');  -- incompleta
create temp table t_regla as
select public.fel_admin_regla_crear_version('00000000-0000-0000-0000-0000000000a1', 'anulacion_dte', 'Anulación (prueba)',
  '{"esquema":1,"plazo_tipo":"fecha_declaracion_iva","requiere_confirmacion_receptor":true}', 'Fuente de prueba', current_date) as id;
select pg_temp.espera_error($$select public.fel_admin_regla_verificar('00000000-0000-0000-0000-0000000000a1', (select id from t_regla), 'Fuente de prueba', 'Plazo aún no soportado')$$, 'FEL_REGLA');  -- plazo no soportado
create temp table t_regla2 as
select public.fel_admin_regla_crear_version('00000000-0000-0000-0000-0000000000a1', 'anulacion_dte', 'Anulación (prueba)',
  '{"esquema":1,"plazo_tipo":"dias_calendario","dias":30,"requiere_confirmacion_receptor":false}', 'Fuente de prueba', current_date) as id;
select pg_temp.espera_error($$select public.fel_admin_regla_verificar('00000000-0000-0000-0000-0000000000b1', (select id from t_regla2), 'Fuente de prueba', 'Intento no autorizado')$$, 'FEL_NO_AUTORIZADO');
select public.fel_admin_regla_verificar('00000000-0000-0000-0000-0000000000a1', (select id from t_regla2), 'Fuente de prueba', 'Prueba de verificación');
select pg_temp.espera_error($$update public.reglas_normativas set reglas = '{}' where id = (select id from t_regla2)$$, 'FEL_REGLA');
select pg_temp.espera_error($$select public.fel_op_anulacion_iniciar('00000000-0000-0000-0000-0000000000b3', '10000000-0000-0000-0000-00000000000a', (select id from t_doc), 'anul-00000000000001', repeat('d',64), 'Motivo de prueba', 'prueba')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_anulacion_iniciar('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000a', (select id from t_doc), 'anul-00000000000001', repeat('d',64), '', 'prueba')$$, 'FEL_REGLA');
create temp table t_an as
select (public.fel_op_anulacion_iniciar('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000a', (select id from t_doc), 'anul-00000000000001', repeat('d',64), 'Motivo de prueba', 'prueba')).id as id;
do $$ begin
  assert (select estado_fiscal from public.documentos where id = (select id from t_doc)) = 'anulacion_solicitada', 'no quedó anulacion_solicitada';
  assert (select regla_id from public.operaciones_fiscales where id = (select id from t_an)) = (select id from t_regla2), 'no registró la regla aplicada';
end $$;
-- una anulación rechazada devuelve el documento a certificado; luego se vuelve a pedir; al confirmarse queda anulado y definitivo
select public.fel_op_operacion_resolver('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000a', (select id from t_an), false, 'proveedor', '{"respuesta":"rechazada-test"}', null, null, null);
do $$ begin assert (select estado_fiscal from public.documentos where id = (select id from t_doc)) = 'certificado', 'no volvió a certificado'; end $$;
create temp table t_an2 as
select (public.fel_op_anulacion_iniciar('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000a', (select id from t_doc), 'anul-00000000000002', repeat('e',64), 'Motivo de prueba', 'prueba')).id as id;
select public.fel_op_operacion_resolver('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000a', (select id from t_an2), true, 'proveedor', '{"respuesta":"ok-test"}', null, null, null);
do $$ begin assert (select estado_fiscal from public.documentos where id = (select id from t_doc)) = 'anulado', 'no quedó anulado'; end $$;
select pg_temp.espera_error($$update public.documentos set observaciones = 'x' where id = (select id from t_doc)$$, 'FEL_REGLA');
select pg_temp.espera_error($$select public.fel_op_anulacion_iniciar('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000a', (select id from t_doc), 'anul-00000000000003', repeat('f',64), 'Motivo de prueba', 'prueba')$$, 'FEL_REGLA');

-- ================= archivado ≠ anulado: archivar solo un borrador sin vida fiscal
create temp table t_doc2 as
select (public.fel_op_documento_guardar('00000000-0000-0000-0000-0000000000b3', '10000000-0000-0000-0000-00000000000a', null, null, null, null, '[]'::jsonb, 0, 0, 0, '{}'::jsonb, null)).id as id;
select public.fel_op_documento_preparacion('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000a', (select id from t_doc2), 'archivado', 'Ya no se necesita', 1);
do $$ begin assert (select estado_preparacion || '/' || estado_fiscal from public.documentos where id = (select id from t_doc2)) = 'archivado/ninguno', 'archivado ≠ anulado'; end $$;
-- el historial registra cada eje por separado
do $$ begin
  assert exists (select 1 from public.documento_estados where eje = 'fiscal' and nuevo = 'anulado'), 'falta historial fiscal';
  assert exists (select 1 from public.documento_estados where eje = 'preparacion' and nuevo = 'archivado'), 'falta historial de preparación';
end $$;

rollback;
\echo 'OK 04_estados_fiscales'
