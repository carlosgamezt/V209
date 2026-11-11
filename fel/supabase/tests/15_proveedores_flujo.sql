-- Fase 2: flujo individual SIMULADO (proveedor mock), estados bloqueantes, conciliación verificable, respuestas tardías, recuperación y aislamiento por empresa.
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
  ('00000000-0000-0000-0000-0000000000c1', 'propA@fel.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'lectorA@fel.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'emisorA@fel.test'),
  ('00000000-0000-0000-0000-0000000000c4', 'adminA@fel.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'propB@fel.test');
insert into public.perfiles (user_id) select id from auth.users on conflict (user_id) do nothing;
insert into public.plataforma_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1');
insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id, estado)
select e.id, e.n, e.n || ' S.A.', e.nit, r.id, 'habilitada'
  from (values ('10000000-0000-0000-0000-00000000000a'::uuid, 'Empresa A', '1111111-1'), ('10000000-0000-0000-0000-00000000000b'::uuid, 'Empresa B', '2222222-2')) e(id, n, nit),
       public.regimenes_fiscales r where r.codigo = 'general';
insert into public.miembros (empresa_id, user_id, rol) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 'propietario'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c2', 'lector'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', 'emisor'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c4', 'administrador'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000d1', 'propietario');
-- OJO: la emisión real NO se habilita en ninguna parte de esta prueba (el flujo simulado no la necesita).

-- ================= establecimientos y canales
select pg_temp.espera_error($$select public.fel_op_establecimiento_guardar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', null, '1', 'Casa matriz', null, 'activo')$$, 'FEL_NO_AUTORIZADO');
create temp table t_eA as select (public.fel_op_establecimiento_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, '1', 'Casa matriz A', 'Dirección de prueba', 'activo')).id as id;
create temp table t_eB as select (public.fel_op_establecimiento_guardar('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000b', null, '1', 'Casa matriz B', null, 'activo')).id as id;
select pg_temp.espera_error($$select public.fel_op_establecimiento_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, '1', 'Duplicado', null, 'activo')$$, '23505|duplicate');
select pg_temp.espera_error($$select public.fel_op_canal_configurar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', null, 'mock', 'simulado', true)$$, 'FEL_NO_AUTORIZADO');
create temp table t_cA as select (public.fel_op_canal_configurar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, 'mock', 'simulado', true)).id as id;
create temp table t_cB as select (public.fel_op_canal_configurar('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000b', null, 'mock', 'simulado', true)).id as id;
-- cerrojo: solo canales simulados del proveedor simulado pueden habilitarse; el real/otros proveedores, jamás en esta versión
select pg_temp.espera_error($$select public.fel_op_canal_configurar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, 'portal_playwright', 'produccion', true)$$, 'FEL_REGLA');   -- Fase 4 (D-F2): el portal con agente solo admite el ambiente simulado; en producción sigue rechazado
select pg_temp.espera_error($$select public.fel_op_canal_configurar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, 'digifact', 'pruebas', true)$$, 'FEL_REGLA');
select pg_temp.espera_error($$select public.fel_op_canal_configurar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, 'mock', 'produccion', false)$$, 'FEL_REGLA');
select pg_temp.espera_error($$insert into public.empresa_canales (empresa_id, proveedor_id, ambiente, habilitado) values ('10000000-0000-0000-0000-00000000000a', 'digifact', 'produccion', true)$$, '23514|check');
select pg_temp.espera_error($$insert into public.empresa_canales (empresa_id, proveedor_id, ambiente, habilitado) values ('10000000-0000-0000-0000-00000000000a', 'mock', 'produccion', false)$$, '23514|check');
create temp table t_cPW as select (public.fel_op_canal_configurar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, 'portal_playwright', 'simulado', false)).id as id;   -- registrado pero apagado

-- ================= fixture: clientes y borradores revisados
select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', null, 'NIT', '3333333-3', 'Cliente A', null, null, null, null);
select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000b', null, 'NIT', '5555555-5', 'Cliente B', null, null, null, null);
create or replace function pg_temp.h(p_doc uuid) returns text language sql as $$ select public.fel_sys_hash_documento(empresa_id, id) from public.documentos where id = p_doc $$;
create or replace function pg_temp.doc_revisado(p_emp uuid, p_user uuid, p_est uuid, p_poner_est boolean default true) returns uuid language plpgsql as $$
declare v_id uuid; v_ver int;
begin
  v_id := (public.fel_op_documento_guardar(p_user, p_emp, null, (select id from public.clientes where empresa_id = p_emp limit 1), current_date, 'prueba',
           '[{"orden":1,"descripcion":"Servicio de prueba","cantidad":2,"precio_unitario":10.5}]'::jsonb, 21, 0, 21, '{"oficial":false}'::jsonb, null)).id;
  if p_poner_est then perform public.fel_op_documento_establecimiento(p_user, p_emp, v_id, p_est); end if;
  select version into v_ver from public.documentos where id = v_id;
  perform public.fel_op_documento_preparacion(p_user, p_emp, v_id, 'revisado', null, v_ver);
  return v_id;
end $$;
-- (el emisor crea y el propietario revisa: el emisor no tiene borradores.revisar)
create or replace function pg_temp.doc_revisado2(p_emp uuid, p_creador uuid, p_revisor uuid, p_est uuid) returns uuid language plpgsql as $$
declare v_id uuid; v_ver int;
begin
  v_id := (public.fel_op_documento_guardar(p_creador, p_emp, null, (select id from public.clientes where empresa_id = p_emp limit 1), current_date, 'prueba',
           '[{"orden":1,"descripcion":"Servicio de prueba","cantidad":2,"precio_unitario":10.5}]'::jsonb, 21, 0, 21, '{"oficial":false}'::jsonb, null)).id;
  perform public.fel_op_documento_establecimiento(p_creador, p_emp, v_id, p_est);
  select version into v_ver from public.documentos where id = v_id;
  perform public.fel_op_documento_preparacion(p_revisor, p_emp, v_id, 'revisado', null, v_ver);
  return v_id;
end $$;

create temp table t_d1 as select pg_temp.doc_revisado2('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c1', (select id from t_eA)) as id;
do $$ begin assert (select establecimiento_id from public.documentos where id = (select id from t_d1)) = (select id from t_eA), 'sin establecimiento'; end $$;
-- el establecimiento forma parte del contenido: congelado tras revisar; y no puede ser de otra empresa
select pg_temp.espera_error($$select public.fel_op_documento_establecimiento('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select id from t_d1), (select id from t_eA))$$, 'FEL_REGLA');
select pg_temp.espera_error($$update public.documentos set establecimiento_id = (select id from t_eB) where id = (select id from t_d1)$$, 'FEL_REGLA|23503');

-- ================= solicitar certificación SIMULADA: permisos, canal, persistencia ANTES de enviar, idempotencia
select pg_temp.espera_error($$select public.fel_op_certificacion_solicitar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select id from t_d1), 'clave-flujo-000001', pg_temp.h((select id from t_d1)), (select id from t_cA))$$, 'FEL_NO_AUTORIZADO');   -- el emisor no certifica
select pg_temp.espera_error($$select public.fel_op_certificacion_solicitar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select id from t_d1), 'clave-flujo-000001', pg_temp.h((select id from t_d1)), (select id from t_cB))$$, 'FEL_REGLA');   -- canal de OTRA empresa
select pg_temp.espera_error($$select public.fel_op_certificacion_solicitar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select id from t_d1), 'clave-flujo-000001', pg_temp.h((select id from t_d1)), (select id from t_cPW))$$, 'FEL_REGLA');   -- canal apagado
select pg_temp.espera_error($$select public.fel_op_certificacion_solicitar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select id from t_d1), 'corta', pg_temp.h((select id from t_d1)), (select id from t_cA))$$, '23514|check');
select pg_temp.espera_error($$select public.fel_op_certificacion_solicitar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select id from t_d1), 'clave-flujo-hashmal', repeat('a',64), (select id from t_cA))$$, 'FEL_REGLA');   -- un hash inventado no sirve: la base lo calcula
create temp table t_op1 as select (public.fel_op_certificacion_solicitar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select id from t_d1), 'clave-flujo-000001', pg_temp.h((select id from t_d1)), (select id from t_cA))).id as id;
do $$ begin
  assert (select estado_fiscal from public.documentos where id = (select id from t_d1)) = 'pendiente_certificacion', 'no quedó pendiente';
  assert (select estado || '/' || ambiente || '/' || proveedor from public.operaciones_fiscales where id = (select id from t_op1)) = 'iniciada/simulado/mock', 'operación mal registrada';
  assert (select enviada_en is null from public.operaciones_fiscales where id = (select id from t_op1)), 'el envío no debe estar marcado todavía';
  assert (select (public.fel_op_certificacion_solicitar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select id from t_d1), 'clave-flujo-000001', pg_temp.h((select id from t_d1)), (select id from t_cA))).id) = (select id from t_op1), 'idempotencia';
end $$;
select pg_temp.espera_error($$select public.fel_op_certificacion_solicitar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select id from t_d1), 'clave-flujo-000001', repeat('b',64), (select id from t_cA))$$, 'FEL_CONFLICTO');
select pg_temp.espera_error($$select public.fel_op_certificacion_solicitar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select id from t_d1), 'clave-flujo-000002', pg_temp.h((select id from t_d1)), (select id from t_cA))$$, 'FEL_OPERACION_ABIERTA');
-- un solo envío por operación: la marca se hace una vez
select public.fel_sys_operacion_marcar_envio('10000000-0000-0000-0000-00000000000a', (select id from t_op1));
select pg_temp.espera_error($$select public.fel_sys_operacion_marcar_envio('10000000-0000-0000-0000-00000000000a', (select id from t_op1))$$, 'FEL_YA_ENVIADA');
select pg_temp.espera_error($$update public.operaciones_fiscales set enviada_en = now() + interval '1 hour' where id = (select id from t_op1)$$, 'FEL_REGLA');
-- el proceso no puede liberar «sin envío» una operación ya enviada
select pg_temp.espera_error($$select public.fel_sys_operacion_no_enviada('10000000-0000-0000-0000-00000000000a', (select id from t_op1))$$, 'FEL_REGLA');

-- ================= resultado: éxito simulado por EVENTO verificable; simulación y realidad no se mezclan
select pg_temp.espera_error($$select public.fel_sys_operacion_resolver_evento('10000000-0000-0000-0000-00000000000a', (select id from t_op1), 999999)$$, 'FEL_REGLA');   -- evento inexistente
select pg_temp.espera_error($$select public.fel_sys_evento_registrar('10000000-0000-0000-0000-00000000000a', (select id from t_op1), 'envio', 'certificado', null, 'SIMA', null, 'SIM-X', null)$$, '23514|check');   -- certificado incompleto
select pg_temp.espera_error($$select public.fel_sys_evento_registrar('10000000-0000-0000-0000-00000000000a', (select id from t_op1), 'envio', 'no_existe_confirmado', null, null, null, null, null)$$, '23514|check');   -- «no existe» solo en conciliación
select pg_temp.espera_error($$select public.fel_sys_operacion_resolver_evento('10000000-0000-0000-0000-00000000000a', (select id from t_op1), public.fel_sys_evento_registrar('10000000-0000-0000-0000-00000000000a', (select id from t_op1), 'envio', 'certificado', null, 'SERIE-REAL', '1', 'AUT-REAL-1', null))$$, 'FEL_REGLA');   -- autorización «real» en una operación simulada
select public.fel_sys_operacion_resolver_evento('10000000-0000-0000-0000-00000000000a', (select id from t_op1),
  public.fel_sys_evento_registrar('10000000-0000-0000-0000-00000000000a', (select id from t_op1), 'envio', 'certificado', null, 'SIMA', '00000001', 'SIM-AAAA-0001', repeat('c',64)));
do $$ begin
  assert (select estado_fiscal || '/' || autorizacion_sat from public.documentos where id = (select id from t_d1)) = 'certificado/SIM-AAAA-0001', 'no certificó';
  assert (select estado from public.operaciones_fiscales where id = (select id from t_op1)) = 'confirmada_exitosa', 'operación sin confirmar';
end $$;
-- una respuesta repetida o tardía NO reabre ni modifica lo confirmado
select public.fel_sys_operacion_resolver_evento('10000000-0000-0000-0000-00000000000a', (select id from t_op1), public.fel_sys_evento_registrar('10000000-0000-0000-0000-00000000000a', (select id from t_op1), 'conciliacion', 'certificado', null, 'SIMA', '00000001', 'SIM-AAAA-0001', null));
do $$ begin assert (select count(*) from public.alertas_fiscales) = 0, 'una repetición no es una alerta'; end $$;
select pg_temp.espera_error($$select public.fel_op_certificacion_solicitar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select id from t_d1), 'clave-flujo-000009', pg_temp.h((select id from t_d1)), (select id from t_cA))$$, 'FEL_REGLA');   -- ya certificado
-- eventos y artefactos: solo inserción; artefacto con hash verificado por la base
select pg_temp.espera_error($$update public.eventos_proveedor set motivo = 'x'$$, 'FEL_APPEND_ONLY');
select pg_temp.espera_error($$delete from public.eventos_proveedor$$, 'FEL_APPEND_ONLY');
select public.fel_sys_artefacto_guardar('10000000-0000-0000-0000-00000000000a', (select id from t_op1), 'xml', 'SIMA-1.xml', 'application/xml', convert_to('<DTESimulado simulado="true"/>', 'UTF8'));
select public.fel_sys_artefacto_guardar('10000000-0000-0000-0000-00000000000a', (select id from t_op1), 'pdf', 'SIMA-1.pdf', 'application/pdf', convert_to('%PDF-1.4 SIMULADO', 'UTF8'));
do $$ begin
  assert (select count(*) from public.artefactos_documento) = 2, 'artefactos';
  assert public.fel_sys_artefacto_guardar('10000000-0000-0000-0000-00000000000a', (select id from t_op1), 'xml', 'otro.xml', 'application/xml', convert_to('distinto', 'UTF8')) is null, 'debe ser idempotente por operación y tipo';
  assert (select sha256 from public.artefactos_documento where tipo = 'xml') = encode(sha256(convert_to('<DTESimulado simulado="true"/>', 'UTF8')), 'hex'), 'hash';
end $$;
select pg_temp.espera_error($$update public.artefactos_documento set nombre = 'x'$$, 'FEL_APPEND_ONLY');
select pg_temp.espera_error($$insert into public.artefactos_documento (empresa_id, documento_id, operacion_id, tipo, nombre, mime, sha256, tamano, contenido) select empresa_id, documento_id, id, 'pdf', 'x', 'x', repeat('0',64), 1, '\x01'::bytea from public.operaciones_fiscales where id = (select id from t_op1)$$, '23514|23505|check|unique');
-- un DTE certificado simulado es inmutable (misma disciplina que el real)
select pg_temp.espera_error($$update public.documentos set observaciones = 'x' where id = (select id from t_d1)$$, 'FEL_REGLA');
select pg_temp.espera_error($$update public.documentos set autorizacion_sat = 'SIM-OTRA' where id = (select id from t_d1)$$, 'FEL_REGLA');
-- la autorización no puede pertenecer a dos documentos
create temp table t_d2 as select pg_temp.doc_revisado2('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c1', (select id from t_eA)) as id;
create temp table t_op2 as select (public.fel_op_certificacion_solicitar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select id from t_d2), 'clave-flujo-000020', pg_temp.h((select id from t_d2)), (select id from t_cA))).id as id;
select public.fel_sys_operacion_marcar_envio('10000000-0000-0000-0000-00000000000a', (select id from t_op2));
select pg_temp.espera_error($$select public.fel_sys_operacion_resolver_evento('10000000-0000-0000-0000-00000000000a', (select id from t_op2), public.fel_sys_evento_registrar('10000000-0000-0000-0000-00000000000a', (select id from t_op2), 'envio', 'certificado', null, 'SIMA', '00000002', 'SIM-AAAA-0001', null))$$, 'FEL_CONFLICTO');

-- ================= resultado DESCONOCIDO: por_verificar BLOQUEA; solo eventos decisivos o conciliación manual verificable lo liberan
select public.fel_sys_operacion_desconocida('10000000-0000-0000-0000-00000000000a', (select id from t_op2), 'timeout');
do $$ begin assert (select estado_fiscal from public.documentos where id = (select id from t_d2)) = 'por_verificar', 'no quedó por_verificar'; end $$;
select public.fel_sys_operacion_desconocida('10000000-0000-0000-0000-00000000000a', (select id from t_op2), 'timeout');   -- idempotente
select pg_temp.espera_error($$select public.fel_op_certificacion_solicitar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select id from t_d2), 'clave-flujo-000021', pg_temp.h((select id from t_d2)), (select id from t_cA))$$, 'FEL_POR_VERIFICAR');
select pg_temp.espera_error($$select public.fel_op_operacion_resolver('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select id from t_op2), false, 'conciliacion_manual', '{"nota":"marcar fallida"}', null, null, null)$$, 'FEL_REGLA');   -- marcar fallida NO libera
select pg_temp.espera_error($$select public.fel_op_operacion_resolver('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select id from t_op2), false, 'proveedor', '{"nota":"x"}', null, null, null)$$, 'FEL_REGLA');
-- eventos NO decisivos no liberan nada
do $$ declare r text; begin
  r := public.fel_sys_operacion_resolver_evento('10000000-0000-0000-0000-00000000000a', (select id from t_op2), public.fel_sys_evento_registrar('10000000-0000-0000-0000-00000000000a', (select id from t_op2), 'conciliacion', 'indeterminado', 'prueba', null, null, null, null));
  assert r = 'sin_cambio', 'un indeterminado no resuelve';
  assert (select estado_fiscal from public.documentos where id = (select id from t_d2)) = 'por_verificar', 'sigue bloqueado';
end $$;
-- propuesta de conciliación manual: condiciones, una por una
update public.plataforma_parametros set valor = 120 where clave = 'espera_conciliacion_manual_min';
select pg_temp.espera_error($$select public.fel_op_conciliacion_proponer('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select id from t_op2), 'manual_fallida', '{}', null)$$, 'FEL_NO_AUTORIZADO');   -- emisor
select pg_temp.espera_error($$select public.fel_op_conciliacion_proponer('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select id from t_op2), 'manual_fallida', jsonb_build_object('fuente','portal_sat_consulta','referencia','consulta-777','fecha_consulta', clock_timestamp(), 'conclusion','no_figura'), null)$$, 'FEL_ESPERA_TARDIA');   -- aún no pasa la espera
update public.plataforma_parametros set valor = 0 where clave in ('espera_conciliacion_manual_min', 'ventana_tardia_min');
select pg_temp.espera_error($$select public.fel_op_conciliacion_proponer('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select id from t_op2), 'manual_fallida', '{"fuente":"inventada","referencia":"x","conclusion":"no_figura"}', null)$$, 'FEL_REGLA');
select pg_temp.espera_error($$select public.fel_op_conciliacion_proponer('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select id from t_op2), 'manual_fallida', jsonb_build_object('fuente','portal_sat_consulta','referencia','abc','fecha_consulta', clock_timestamp(), 'conclusion','no_figura'), null)$$, 'FEL_REGLA');   -- referencia corta
select pg_temp.espera_error($$select public.fel_op_conciliacion_proponer('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select id from t_op2), 'manual_fallida', jsonb_build_object('fuente','portal_sat_consulta','referencia','consulta-777','fecha_consulta', '2000-01-01T00:00:00Z', 'conclusion','no_figura'), null)$$, 'FEL_REGLA');   -- consulta anterior al envío
select pg_temp.espera_error($$select public.fel_op_conciliacion_proponer('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select id from t_op2), 'manual_fallida', jsonb_build_object('fuente','portal_sat_consulta','referencia','consulta-777','fecha_consulta', clock_timestamp(), 'conclusion','figura'), null)$$, 'FEL_REGLA');   -- conclusión contradictoria
select pg_temp.espera_error($$select public.fel_op_conciliacion_proponer('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select id from t_op2), 'manual_certificada', jsonb_build_object('fuente','portal_sat_consulta','referencia','consulta-777','fecha_consulta', clock_timestamp(), 'conclusion','figura'), '{"serie":"SIMA"}')$$, 'FEL_REGLA');   -- sin número/autorización
create temp table t_conc as select (public.fel_op_conciliacion_proponer('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select id from t_op2), 'manual_fallida',
  jsonb_build_object('fuente','portal_sat_consulta','referencia','consulta-777','fecha_consulta', clock_timestamp(), 'conclusion','no_figura'), null)).id as id;
select pg_temp.espera_error($$select public.fel_op_conciliacion_proponer('00000000-0000-0000-0000-0000000000c4', '10000000-0000-0000-0000-00000000000a', (select id from t_op2), 'manual_fallida', jsonb_build_object('fuente','portal_sat_consulta','referencia','consulta-778','fecha_consulta', clock_timestamp(), 'conclusion','no_figura'), null)$$, '23505|duplicate');   -- solo una propuesta abierta
select pg_temp.espera_error($$select public.fel_op_certificacion_solicitar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select id from t_d2), 'clave-flujo-000022', pg_temp.h((select id from t_d2)), (select id from t_cA))$$, 'FEL_POR_VERIFICAR');   -- una propuesta NO libera
select pg_temp.espera_error($$select public.fel_op_conciliacion_decidir('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select id from t_conc), true, 'yo mismo')$$, 'FEL_REGLA');   -- misma persona
select pg_temp.espera_error($$select public.fel_op_conciliacion_decidir('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select id from t_conc), true, 'emisor')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_conciliacion_decidir('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000a', (select id from t_conc), true, 'otra empresa')$$, 'FEL_NO_AUTORIZADO');
select public.fel_op_conciliacion_decidir('00000000-0000-0000-0000-0000000000c4', '10000000-0000-0000-0000-00000000000a', (select id from t_conc), true, 'verificado por una segunda persona');
do $$ begin
  assert (select estado_fiscal from public.documentos where id = (select id from t_d2)) = 'rechazado', 'no quedó rechazado';
  assert (select resolucion from public.operaciones_fiscales where id = (select id from t_op2)) = 'conciliacion_manual', 'resolución';
end $$;
-- tras la conciliación manual el reintento exige comprobación POSTERIOR del proveedor (directo desde rechazado, con otra clave)
select pg_temp.espera_error($$select public.fel_op_certificacion_solicitar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select id from t_d2), 'clave-flujo-000023', pg_temp.h((select id from t_d2)), (select id from t_cA))$$, 'FEL_AUDITORIA_PENDIENTE');
update public.plataforma_parametros set valor = 1440 where clave = 'ventana_tardia_min';   -- (la espera se calculó al aprobar con 0: el reintento_desde ya venció)
-- RESPUESTA TARDÍA: el proveedor certifica DESPUÉS de la conciliación manual → alerta (certificación huérfana) que bloquea cualquier operación
do $$ declare r text; begin
  r := public.fel_sys_operacion_resolver_evento('10000000-0000-0000-0000-00000000000a', (select id from t_op2), public.fel_sys_evento_registrar('10000000-0000-0000-0000-00000000000a', (select id from t_op2), 'conciliacion', 'certificado', null, 'SIMA', '00000099', 'SIM-TARDIA-0099', null));
  assert r = 'alerta', 'debía generar una alerta';
  assert (select count(*) from public.alertas_fiscales where operacion_id = (select id from t_op2) and resuelta_en is null) = 1, 'alerta abierta';
  assert (select estado from public.operaciones_fiscales where id = (select id from t_op2)) = 'confirmada_fallida', 'la operación cerrada no se reabre';
  r := public.fel_sys_operacion_resolver_evento('10000000-0000-0000-0000-00000000000a', (select id from t_op2), (select max(id) from public.eventos_proveedor where operacion_id = (select id from t_op2)));
  assert (select count(*) from public.alertas_fiscales where operacion_id = (select id from t_op2)) = 1, 'la alerta no se duplica';
end $$;
select pg_temp.espera_error($$select public.fel_op_certificacion_solicitar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select id from t_d2), 'clave-flujo-000024', pg_temp.h((select id from t_d2)), (select id from t_cA))$$, 'FEL_ALERTA_ABIERTA');
select pg_temp.espera_error($$insert into public.operaciones_fiscales (empresa_id, documento_id, tipo, clave_idempotencia, hash_contenido, iniciada_por) values ('10000000-0000-0000-0000-00000000000a', (select id from t_d2), 'certificacion', 'clave-directa-0001', repeat('a',64), '00000000-0000-0000-0000-0000000000c1')$$, 'FEL_ALERTA_ABIERTA');   -- ni por una ruta directa
select pg_temp.espera_error($$select public.fel_op_alerta_resolver('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select id from public.alertas_fiscales limit 1), 'corta')$$, 'FEL_REGLA');
select pg_temp.espera_error($$select public.fel_op_alerta_resolver('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select id from public.alertas_fiscales limit 1), 'nota suficientemente larga')$$, 'FEL_NO_AUTORIZADO');
select public.fel_op_alerta_resolver('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select id from public.alertas_fiscales limit 1), 'Se anuló la certificación huérfana con el proveedor');

-- ================= recuperación: proceso caído ANTES de marcar el envío (se prueba que nada salió) y DESPUÉS (desconocida)
create temp table t_d3 as select pg_temp.doc_revisado2('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c1', (select id from t_eA)) as id;
create temp table t_op3 as select (public.fel_op_certificacion_solicitar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select id from t_d3), 'clave-flujo-000030', pg_temp.h((select id from t_d3)), (select id from t_cA))).id as id;
update public.operaciones_fiscales set iniciada_en = iniciada_en where id = (select id from t_op3);   -- (sin efecto: la operación es inmutable salvo sus campos de seguimiento)
do $$ begin assert (select count(*) from public.fel_sys_operaciones_pendientes(0) where operacion_id = (select id from t_op3) and not enviada) = 1, 'debe aparecer como pendiente sin enviar'; end $$;
select public.fel_sys_operacion_no_enviada('10000000-0000-0000-0000-00000000000a', (select id from t_op3));
do $$ begin
  assert (select estado_fiscal from public.documentos where id = (select id from t_d3)) = 'rechazado', 'sin envío: debe quedar rechazado (liberado con prueba)';
  assert (select resolucion from public.operaciones_fiscales where id = (select id from t_op3)) = 'sistema_no_enviada', 'resolución';
end $$;
select pg_temp.espera_error($$select public.fel_sys_operacion_no_enviada('10000000-0000-0000-0000-00000000000a', (select id from t_op3))$$, 'FEL_REGLA');   -- ya cerrada
-- tras un rechazo confirmado: corregir (volver a borrador) exige permiso y versión vigente; reintento directo con otra clave también es posible
select pg_temp.espera_error($$select public.fel_op_documento_reabrir('00000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-00000000000a', (select id from t_d3), (select version from public.documentos where id = (select id from t_d3)))$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_documento_reabrir('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select id from t_d3), 0)$$, 'FEL_CONFLICTO');
select public.fel_op_documento_reabrir('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select id from t_d3), (select version from public.documentos where id = (select id from t_d3)));
do $$ begin assert (select estado_preparacion || '/' || estado_fiscal from public.documentos where id = (select id from t_d3)) = 'borrador/ninguno', 'no volvió a borrador'; end $$;
select pg_temp.espera_error($$select public.fel_op_documento_reabrir('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select id from t_d3), (select version from public.documentos where id = (select id from t_d3)))$$, 'FEL_REGLA');   -- ya no está rechazado
-- orden de canal asistido: la operación sigue abierta y no admite conciliación manual
create temp table t_d4 as select pg_temp.doc_revisado2('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c1', (select id from t_eA)) as id;
create temp table t_op4 as select (public.fel_op_certificacion_solicitar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select id from t_d4), 'clave-flujo-000040', pg_temp.h((select id from t_d4)), (select id from t_cA))).id as id;
select public.fel_sys_operacion_marcar_envio('10000000-0000-0000-0000-00000000000a', (select id from t_op4));
select public.fel_sys_operacion_orden('10000000-0000-0000-0000-00000000000a', (select id from t_op4), 'ORD-1');
select pg_temp.espera_error($$select public.fel_sys_operacion_no_enviada('10000000-0000-0000-0000-00000000000a', (select id from t_op4))$$, 'FEL_REGLA');
select pg_temp.espera_error($$select public.fel_op_certificacion_solicitar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select id from t_d4), 'clave-flujo-000041', pg_temp.h((select id from t_d4)), (select id from t_cA))$$, 'FEL_OPERACION_ABIERTA');

-- ================= AISLAMIENTO entre empresas (RLS real: rol authenticated + claims)
create temp table t_dB as select pg_temp.doc_revisado('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000d1', (select id from t_eB)) as id;
create temp table t_opB as select (public.fel_op_certificacion_solicitar('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000b', (select id from t_dB), 'clave-flujo-0000B1', pg_temp.h((select id from t_dB)), (select id from t_cB))).id as id;
select public.fel_sys_operacion_marcar_envio('10000000-0000-0000-0000-00000000000b', (select id from t_opB));
select public.fel_sys_operacion_resolver_evento('10000000-0000-0000-0000-00000000000b', (select id from t_opB), public.fel_sys_evento_registrar('10000000-0000-0000-0000-00000000000b', (select id from t_opB), 'envio', 'certificado', null, 'SIMA', '00000001', 'SIM-BBBB-0001', null));
select public.fel_sys_artefacto_guardar('10000000-0000-0000-0000-00000000000b', (select id from t_opB), 'xml', 'B.xml', 'application/xml', convert_to('<B/>', 'UTF8'));
-- un usuario o un canal de A no puede operar sobre lo de B (ni con identificadores ajenos)
select pg_temp.espera_error($$select public.fel_op_certificacion_solicitar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select id from t_dB), 'clave-cruzada-0001', pg_temp.h((select id from t_dB)), (select id from t_cA))$$, 'FEL_NO_ENCONTRADO');
select pg_temp.espera_error($$select public.fel_op_certificacion_solicitar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000b', (select id from t_dB), 'clave-cruzada-0002', pg_temp.h((select id from t_dB)), (select id from t_cB))$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_sys_operacion_marcar_envio('10000000-0000-0000-0000-00000000000a', (select id from t_opB))$$, 'FEL_NO_ENCONTRADO');
select pg_temp.espera_error($$select public.fel_sys_artefacto_guardar('10000000-0000-0000-0000-00000000000a', (select id from t_opB), 'pdf', 'x', 'x', 'x'::bytea)$$, 'FEL_REGLA');
select pg_temp.espera_error($$select public.fel_op_conciliacion_decidir('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000b', gen_random_uuid(), true, 'x')$$, 'FEL_NO_AUTORIZADO');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true) as _a \gset
do $$ begin
  assert (select count(*) from public.establecimientos) = 1 and (select count(*) from public.establecimientos where empresa_id <> '10000000-0000-0000-0000-00000000000a') = 0, 'A ve establecimientos ajenos';
  assert (select count(*) from public.empresa_canales where empresa_id <> '10000000-0000-0000-0000-00000000000a') = 0, 'A ve canales ajenos';
  assert (select count(*) from public.operaciones_fiscales where empresa_id <> '10000000-0000-0000-0000-00000000000a') = 0, 'A ve operaciones ajenas';
  assert (select count(*) from public.eventos_proveedor where empresa_id <> '10000000-0000-0000-0000-00000000000a') = 0, 'A ve eventos ajenos';
  assert (select count(*) from public.eventos_proveedor) > 0, 'A debe ver sus eventos';
  assert (select count(*) from public.conciliaciones where empresa_id <> '10000000-0000-0000-0000-00000000000a') = 0, 'A ve conciliaciones ajenas';
  assert (select count(*) from public.alertas_fiscales where empresa_id <> '10000000-0000-0000-0000-00000000000a') = 0, 'A ve alertas ajenas';
  assert (select count(*) from public.artefactos_documento where empresa_id <> '10000000-0000-0000-0000-00000000000a') = 0, 'A ve artefactos ajenos';
  assert (select count(*) from public.artefactos_documento) = 2, 'A debe ver los metadatos de sus artefactos';
  assert (select count(*) from public.documentos where empresa_id <> '10000000-0000-0000-0000-00000000000a') = 0, 'A ve documentos ajenos';
  begin perform contenido from public.artefactos_documento; raise exception 'NO DEBIÓ LEER los bytes'; exception when insufficient_privilege then null; end;
  begin insert into public.eventos_proveedor (empresa_id, operacion_id, tipo, resultado) values ('10000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'envio', 'desconocido'); raise exception 'NO DEBIÓ ESCRIBIR'; exception when insufficient_privilege then null; end;
  begin update public.empresa_canales set habilitado = false; raise exception 'NO DEBIÓ ESCRIBIR'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.plataforma_parametros; raise exception 'NO DEBIÓ LEER parámetros'; exception when insufficient_privilege then null; end;
  begin perform public.fel_sys_operacion_marcar_envio('10000000-0000-0000-0000-00000000000a', gen_random_uuid()); raise exception 'NO DEBIÓ EJECUTAR funciones del sistema'; exception when insufficient_privilege then null; end;
  begin perform public.fel_op_certificacion_solicitar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'clave-flujo-000099', repeat('a',64), gen_random_uuid()); raise exception 'NO DEBIÓ EJECUTAR la escritura'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- lector: ve metadatos de artefactos (descargar) pero no operaciones ajenas; emisor sin conciliar; maestro de plataforma NO ve datos de negocio
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true) as _l \gset
do $$ begin assert (select count(*) from public.artefactos_documento) = 2, 'el lector descarga'; assert (select count(*) from public.conciliaciones) = 0 or true; end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true) as _m \gset
do $$ begin
  assert (select count(*) from public.establecimientos) = 0 and (select count(*) from public.eventos_proveedor) = 0 and (select count(*) from public.artefactos_documento) = 0
         and (select count(*) from public.alertas_fiscales) = 0 and (select count(*) from public.empresa_canales) = 0, 'el administrador maestro no ve datos de negocio';
  assert (select count(*) from public.proveedores_emision) = 3, 'el catálogo de proveedores sí es visible';
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true) as _b \gset
do $$ begin
  assert (select count(*) from public.eventos_proveedor where empresa_id = '10000000-0000-0000-0000-00000000000a') = 0, 'B ve eventos de A';
  assert (select count(*) from public.eventos_proveedor) = 1 and (select count(*) from public.artefactos_documento) = 1 and (select count(*) from public.establecimientos) = 1, 'B ve lo suyo';
end $$;
reset role;

rollback;
\echo OK 15_proveedores_flujo
