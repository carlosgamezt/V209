-- Fase 4 (2/9): agente local — vinculación por empresa, autenticación, cola de órdenes con arrendamiento y fencing, incertidumbre tras presentar,
-- separación simulador/real y aislamiento entre empresas. Todo SIMULADO: no se habilita ningún canal real.
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_ok boolean := false;
begin
  begin execute p_sql; exception when others then v_ok := (sqlerrm ~ p_patron) or (sqlstate ~ p_patron); end;
  if not v_ok then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'propA@fel.test'), ('00000000-0000-0000-0000-0000000000c2', 'lectorA@fel.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'emisorA@fel.test'), ('00000000-0000-0000-0000-0000000000c4', 'adminA@fel.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'propB@fel.test');
insert into public.perfiles (user_id) select id from auth.users on conflict (user_id) do nothing;
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
update public.plataforma_parametros set valor = 0 where clave = 'espera_conciliacion_manual_min';

-- ================= 1. separación simulador / integración real (condición 4)
create temp table t_eA as select (public.fel_op_establecimiento_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, '1', 'Casa matriz A', null, 'activo')).id as id;
create temp table t_eB as select (public.fel_op_establecimiento_guardar('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000b', null, '1', 'Casa matriz B', null, 'activo')).id as id;
select pg_temp.espera_error($$select public.fel_op_canal_configurar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, 'portal_playwright', 'produccion', true)$$, 'FEL_REGLA');
select pg_temp.espera_error($$select public.fel_op_canal_configurar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, 'portal_playwright', 'pruebas', true)$$, 'FEL_REGLA');
-- (D3-1) Digifact solo contra el SIMULADOR (ver 16); aquí se confirma que no puede ampliarse a pruebas/producción
select public.fel_op_canal_configurar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, 'digifact', 'simulado', false);
select pg_temp.espera_error($$select public.fel_op_canal_configurar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, 'digifact', 'produccion', true)$$, 'FEL_REGLA');
select pg_temp.espera_error($$insert into public.empresa_canales (empresa_id, proveedor_id, ambiente, habilitado) values ('10000000-0000-0000-0000-00000000000a', 'portal_playwright', 'produccion', true)$$, '23514|check');
select pg_temp.espera_error($$update public.proveedores_emision set ambientes = '{simulado,produccion}' where id = 'digifact'$$, '23514|check');
select pg_temp.espera_error($$update public.proveedores_emision set ambientes = '{simulado,produccion}' where id = 'portal_playwright'$$, '23514|check');
select pg_temp.espera_error($$select public.fel_op_canal_configurar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', null, 'portal_playwright', 'simulado', true)$$, 'FEL_NO_AUTORIZADO');
create temp table t_cA as select (public.fel_op_canal_configurar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, 'portal_playwright', 'simulado', true)).id as id;   -- D-F2: solo simulado
create temp table t_cB as select (public.fel_op_canal_configurar('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000b', null, 'portal_playwright', 'simulado', true)).id as id;
create temp table t_cM as select (public.fel_op_canal_configurar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, 'mock', 'simulado', true)).id as id;
-- ninguna orden puede ser de un ambiente real, ni una emisión simulada puede llevar una autorización que no sea SIM-
select pg_temp.espera_error($$insert into public.ordenes_emision (empresa_id, operacion_id, documento_id, ambiente, clave_idempotencia, hash_contenido, instantanea) values ('10000000-0000-0000-0000-00000000000a', gen_random_uuid(), gen_random_uuid(), 'produccion', 'clave-0123456789ab', repeat('a',64), '{}')$$, '23514|check|23503');
do $$ begin assert not exists (select 1 from public.empresa_canales where habilitado and not ((proveedor_id = 'mock' or proveedor_id = 'portal_playwright') and ambiente = 'simulado')), 'ningún canal real habilitado';
  assert not exists (select 1 from public.empresas where emision_real_habilitada), 'sin emisión real'; end $$;

-- ================= 2. vinculación: permisos, código de un uso, caducidad, límite, clave única, aislamiento
select pg_temp.espera_error($$select public.fel_op_agente_codigo_crear('00000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-00000000000a')$$, 'FEL_NO_AUTORIZADO');   -- lector
select pg_temp.espera_error($$select public.fel_op_agente_codigo_crear('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a')$$, 'FEL_NO_AUTORIZADO');   -- emisor
select pg_temp.espera_error($$select public.fel_op_agente_codigo_crear('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000a')$$, 'FEL_NO_AUTORIZADO');   -- propietario de OTRA empresa
create temp table t_cod1 as select (public.fel_op_agente_codigo_crear('00000000-0000-0000-0000-0000000000c4', '10000000-0000-0000-0000-00000000000a') ->> 'codigo') as c;   -- el administrador sí
do $$ begin
  assert (select c ~ '^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$' from t_cod1), 'formato del código';
  assert not exists (select 1 from public.codigos_vinculacion where codigo_hash = (select c from t_cod1)), 'el código en claro no debe guardarse';
  assert (select count(*) from public.codigos_vinculacion where empresa_id = '10000000-0000-0000-0000-00000000000a' and usado_en is null) = 1, 'un código vigente';
end $$;
select pg_temp.espera_error($$select public.fel_sys_agente_vincular((select c from t_cod1), 'clave-corta', 'PC', '1.0')$$, 'FEL_DATOS_INVALIDOS');   -- clave pública no válida: no consume el código
select pg_temp.espera_error($$select public.fel_sys_agente_vincular((select c from t_cod1), repeat('A',43), '   ', '1.0')$$, 'FEL_DATOS_INVALIDOS');
create temp table t_ag1 as select public.fel_sys_agente_vincular((select c from t_cod1), repeat('A',43), 'PC contabilidad', '1.0.0') as r;
do $$ begin
  assert (select r ->> 'empresa_id' from t_ag1) = '10000000-0000-0000-0000-00000000000a', 'el agente queda ligado a la empresa del código';
  assert (select count(*) from public.agentes_locales where empresa_id = '10000000-0000-0000-0000-00000000000a') = 1;
  assert (select usado_en is not null from public.codigos_vinculacion limit 1), 'el código queda usado';
  assert (select count(*) from public.auditoria where accion = 'agente.vinculado') = 1, 'auditoría de la vinculación';
  assert (public.fel_sys_agente_vincular((select c from t_cod1), repeat('B',43), 'otro', '1') ->> 'error') = 'FEL_CODIGO', 'un código se usa una sola vez';
  assert (public.fel_sys_agente_vincular('0000-0000-0000', repeat('C',43), 'otro', '1') ->> 'error') = 'FEL_CODIGO', 'código inexistente';
end $$;
create temp table t_cod2 as select (public.fel_op_agente_codigo_crear('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a') ->> 'codigo') as c;
select pg_temp.espera_error($$select public.fel_sys_agente_vincular((select c from t_cod2), repeat('A',43), 'copia', '1')$$, 'FEL_DATOS_INVALIDOS');   -- la misma clave pública no puede registrarse dos veces
update public.codigos_vinculacion set expira_en = clock_timestamp() - interval '1 second' where codigo_hash = encode(sha256(convert_to(upper(replace((select c from t_cod2), '-', '')), 'UTF8')), 'hex');
do $$ begin assert (public.fel_sys_agente_vincular((select c from t_cod2), repeat('D',43), 'tarde', '1') ->> 'error') = 'FEL_CODIGO', 'un código vencido no sirve'; end $$;
-- límite de intentos fallidos (anti fuerza bruta): el fallo persiste porque la función no lanza excepción
do $$ declare i int; begin
  for i in 1..25 loop begin perform public.fel_sys_agente_vincular('FFFF-FFFF-' || lpad(i::text, 4, '0'), repeat('E',43), 'x', '1'); exception when others then if sqlerrm like 'FEL_LIMITE%' then exit; end if; end; end loop;
  assert (select count(*) from public.vinculacion_fallos) >= 20, 'los fallos deben contarse';
end $$;
select pg_temp.espera_error($$select public.fel_sys_agente_vincular('FFFF-FFFF-9999', repeat('E',43), 'x', '1')$$, 'FEL_LIMITE');
delete from public.vinculacion_fallos;
-- agentes: B, y un segundo agente de A
create temp table t_cod3 as select (public.fel_op_agente_codigo_crear('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000b') ->> 'codigo') as c;
create temp table t_agB as select public.fel_sys_agente_vincular((select c from t_cod3), repeat('F',43), 'PC de B', '1.0.0') as r;
create temp table t_cod4 as select (public.fel_op_agente_codigo_crear('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a') ->> 'codigo') as c;
create temp table t_ag2 as select public.fel_sys_agente_vincular((select c from t_cod4), repeat('G',43), 'PC de caja', '1.0.0') as r;
do $$ begin assert (select r ->> 'empresa_id' from t_agB) = '10000000-0000-0000-0000-00000000000b', 'el agente de B queda en B'; end $$;
-- inmutabilidad del agente
select pg_temp.espera_error($$update public.agentes_locales set empresa_id = '10000000-0000-0000-0000-00000000000b' where id = ((select r ->> 'agente_id' from t_ag1)::uuid)$$, 'FEL_REGLA');
select pg_temp.espera_error($$update public.agentes_locales set clave_publica = repeat('Z',43) where id = ((select r ->> 'agente_id' from t_ag1)::uuid)$$, 'FEL_REGLA');
select pg_temp.espera_error($$delete from public.agentes_locales where id = ((select r ->> 'agente_id' from t_ag1)::uuid)$$, 'FEL_REGLA|42501');

-- ================= 3. autenticación de cada petición y estado del agente
create or replace function pg_temp.ag(p_t text) returns uuid language sql as $$ select (case p_t when 'a1' then (select r ->> 'agente_id' from t_ag1) when 'a2' then (select r ->> 'agente_id' from t_ag2) else (select r ->> 'agente_id' from t_agB) end)::uuid $$;
do $$ declare r jsonb; begin
  r := public.fel_sys_agente_autenticar(pg_temp.ag('a1'), clock_timestamp(), 'nonce-aaaaaaaaaaaaaaaa');
  assert (r ->> 'ok')::boolean and r ->> 'empresa_id' = '10000000-0000-0000-0000-00000000000a', 'autenticación correcta devuelve la empresa del agente';
  assert (public.fel_sys_agente_clave(pg_temp.ag('a1')) ->> 'clave_publica') = repeat('A',43), 'clave pública para verificar la firma';
  assert (public.fel_sys_agente_clave(pg_temp.ag('a1')) ->> 'estado') = 'activo' and public.fel_sys_agente_clave(gen_random_uuid()) is null, 'agente desconocido: sin clave';
end $$;
select pg_temp.espera_error($$select public.fel_sys_agente_autenticar(pg_temp.ag('a1'), clock_timestamp(), 'nonce-aaaaaaaaaaaaaaaa')$$, 'FEL_REPETICION');
select pg_temp.espera_error($$select public.fel_sys_agente_autenticar(gen_random_uuid(), clock_timestamp(), 'nonce-bbbbbbbbbbbbbbbb')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_sys_agente_autenticar(pg_temp.ag('a1'), clock_timestamp(), 'corto')$$, 'FEL_DATOS_INVALIDOS');
do $$ declare r jsonb; begin
  r := public.fel_sys_agente_autenticar(pg_temp.ag('a1'), clock_timestamp() - interval '10 minutes', 'nonce-cccccccccccccccc');
  assert not (r ->> 'ok')::boolean and r ->> 'error' = 'FEL_RELOJ', 'reloj desfasado';
  assert (select error_codigo from public.agentes_locales where id = pg_temp.ag('a1')) = 'RELOJ', 'el error de reloj queda registrado y se muestra';
  assert (select estado from public.fel_op_agentes_listar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a') where id = pg_temp.ag('a1')) = 'error', 'estado error';
  perform public.fel_sys_agente_latido(pg_temp.ag('a1'), '1.0.1', null);
  assert (select estado from public.fel_op_agentes_listar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a') where id = pg_temp.ag('a1')) = 'conectado', 'el latido limpia el error y marca conectado';
  update public.agentes_locales set visto_en = clock_timestamp() - interval '5 minutes' where id = pg_temp.ag('a1');
  assert (select estado from public.fel_op_agentes_listar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a') where id = pg_temp.ag('a1')) = 'desconectado', 'sin latido: desconectado';
  perform public.fel_sys_agente_latido(pg_temp.ag('a1'), '1.0.1', 'FORMULARIO');
  assert (select estado from public.fel_op_agentes_listar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a') where id = pg_temp.ag('a1')) = 'error', 'error informado por el agente';
  perform public.fel_sys_agente_latido(pg_temp.ag('a1'), '1.0.1', null); perform public.fel_sys_agente_latido(pg_temp.ag('a2'), '1.0.1', null); perform public.fel_sys_agente_latido(pg_temp.ag('b'), '1.0.1', null);
  assert (select count(*) from public.fel_op_agentes_listar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a')) = 2, 'el emisor ve los agentes de su empresa (canales.ver)';
end $$;
select pg_temp.espera_error($$select * from public.fel_op_agentes_listar('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000a')$$, 'FEL_NO_AUTORIZADO');

-- ================= 4. órdenes: fixtures (hace lo que el orquestador y el adaptador harán)
select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', null, 'NIT', '3333333-3', 'Cliente A', null, null, null, null);
select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000b', null, 'NIT', '5555555-5', 'Cliente B', null, null, null, null);
create or replace function pg_temp.h(p_doc uuid) returns text language sql as $$ select public.fel_sys_hash_documento(empresa_id, id) from public.documentos where id = p_doc $$;
create or replace function pg_temp.doc_rev(p_emp uuid, p_creador uuid, p_revisor uuid, p_est uuid) returns uuid language plpgsql as $$
declare v_id uuid; v_ver int;
begin
  v_id := (public.fel_op_documento_guardar(p_creador, p_emp, null, (select id from public.clientes where empresa_id = p_emp limit 1), current_date, 'prueba',
           '[{"orden":1,"descripcion":"Servicio de prueba","cantidad":2,"precio_unitario":10.5}]'::jsonb, 21, 0, 21, '{"oficial":false}'::jsonb, null)).id;
  perform public.fel_op_documento_establecimiento(p_creador, p_emp, v_id, p_est);
  select version into v_ver from public.documentos where id = v_id;
  perform public.fel_op_documento_preparacion(p_revisor, p_emp, v_id, 'revisado', null, v_ver);
  return v_id;
end $$;
-- operación solicitada con envío marcado (como el orquestador); si p_vincular, además crea la orden y la vincula como el adaptador + orquestador
create or replace function pg_temp.op(p_emp uuid, p_creador uuid, p_prop uuid, p_est uuid, p_canal uuid, p_clave text, p_vincular boolean default true) returns jsonb language plpgsql as $$
declare v_doc uuid; v_op uuid; v_ord uuid;
begin
  v_doc := pg_temp.doc_rev(p_emp, p_creador, p_prop, p_est);
  v_op := (public.fel_op_certificacion_solicitar(p_prop, p_emp, v_doc, p_clave, pg_temp.h(v_doc), p_canal)).id;
  perform public.fel_sys_operacion_marcar_envio(p_emp, v_op);
  if p_vincular then v_ord := public.fel_sys_orden_crear(p_emp, v_op); perform public.fel_sys_operacion_orden(p_emp, v_op, v_ord::text); end if;
  return jsonb_build_object('doc', v_doc, 'op', v_op, 'orden', v_ord);
end $$;
create or replace function pg_temp.ord_estado(p_o uuid) returns text language sql as $$ select estado from public.ordenes_emision where id = p_o $$;
create or replace function pg_temp.op_estado(p_op uuid) returns text language sql as $$ select estado from public.operaciones_fiscales where id = p_op $$;
create or replace function pg_temp.doc_estado(p_d uuid) returns text language sql as $$ select estado_fiscal from public.documentos where id = p_d $$;

-- 4.1 creación de la orden: canal, ambiente, estado, duplicado
create temp table t_s1 as select pg_temp.op('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c1', (select id from t_eA), (select id from t_cA), 'clave-orden-000001', false) as j;
do $$ declare v uuid; begin
  select (j ->> 'op')::uuid into v from t_s1;
  v := public.fel_sys_orden_crear('10000000-0000-0000-0000-00000000000a', v);
  assert v is not null and pg_temp.ord_estado(v) = 'pendiente', 'orden pendiente';
  assert (select ambiente from public.ordenes_emision where id = v) = 'simulado' and (select hash_contenido from public.ordenes_emision where id = v) = pg_temp.h((select (j ->> 'doc')::uuid from t_s1)), 'hash del contenido congelado';
end $$;
select pg_temp.espera_error($$select public.fel_sys_orden_crear('10000000-0000-0000-0000-00000000000a', (select (j ->> 'op')::uuid from t_s1))$$, 'FEL_ORDEN_DUPLICADA');   -- una orden por operación
select pg_temp.espera_error($$select public.fel_sys_orden_crear('10000000-0000-0000-0000-00000000000b', (select (j ->> 'op')::uuid from t_s1))$$, 'FEL_NO_ENCONTRADO');   -- empresa distinta
create temp table t_s0 as select pg_temp.op('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c1', (select id from t_eA), (select id from t_cM), 'clave-mock-0000001', false) as j;
select pg_temp.espera_error($$select public.fel_sys_orden_crear('10000000-0000-0000-0000-00000000000a', (select (j ->> 'op')::uuid from t_s0))$$, 'FEL_REGLA');   -- operación de otro proveedor: no admite órdenes de agente

-- 4.2 reclamo: solo su empresa; no antes de vincular; token y arrendamiento; un agente a la vez
do $$ begin assert public.fel_sys_orden_reclamar(pg_temp.ag('a1')) is null, 'sin vincular la orden a la operación no se entrega'; end $$;
do $$ begin perform public.fel_sys_operacion_orden('10000000-0000-0000-0000-00000000000a', (select (j ->> 'op')::uuid from t_s1), (select id::text from public.ordenes_emision where operacion_id = (select (j ->> 'op')::uuid from t_s1))); end $$;
do $$ begin assert public.fel_sys_orden_reclamar(pg_temp.ag('b')) is null, 'el agente de B no ve órdenes de A'; end $$;
create temp table t_r1 as select public.fel_sys_orden_reclamar(pg_temp.ag('a1')) as r;
do $$ declare e uuid := (select (r ->> 'orden')::uuid from t_r1); begin
  assert (select (r ->> 'token')::int from t_r1) = 1 and (select r ->> 'ambiente' from t_r1) = 'simulado', 'token 1 y ambiente simulado';
  assert (select r ->> 'hash' from t_r1) = pg_temp.h((select (j ->> 'doc')::uuid from t_s1)), 'el agente recibe el hash calculado por la base';
  assert pg_temp.ord_estado(e) = 'reclamada' and (select agente_id from public.ordenes_emision where id = e) = pg_temp.ag('a1');
  assert public.fel_sys_orden_reclamar(pg_temp.ag('a2')) is null, 'otro agente de la empresa no recibe una orden ya reclamada';
end $$;
-- 4.3 progreso: fencing, empresa, fase
select pg_temp.espera_error($$select public.fel_sys_orden_progreso(pg_temp.ag('a1'), (select (r ->> 'orden')::uuid from t_r1), 99, 'llenando')$$, 'FEL_FENCING');
select pg_temp.espera_error($$select public.fel_sys_orden_progreso(pg_temp.ag('a2'), (select (r ->> 'orden')::uuid from t_r1), 1, 'llenando')$$, 'FEL_FENCING');   -- otro agente de la misma empresa
select pg_temp.espera_error($$select public.fel_sys_orden_progreso(pg_temp.ag('b'), (select (r ->> 'orden')::uuid from t_r1), 1, 'llenando')$$, 'FEL_EMPRESA');   -- agente de OTRA empresa
select pg_temp.espera_error($$select public.fel_sys_orden_progreso(pg_temp.ag('a1'), (select (r ->> 'orden')::uuid from t_r1), 1, 'fase-rara')$$, 'FEL_DATOS_INVALIDOS');
select pg_temp.espera_error($$select public.fel_sys_orden_resultado(pg_temp.ag('a1'), (select (r ->> 'orden')::uuid from t_r1), 1, 'emitido_simulado', 'SIMA', '1', 'SIM-1', null)$$, 'FEL_ESTADO');   -- no se puede emitir sin haber presentado la vista previa
select pg_temp.espera_error($$select public.fel_sys_orden_resultado(pg_temp.ag('b'), (select (r ->> 'orden')::uuid from t_r1), 1, 'descartado', null, null, null, null)$$, 'FEL_EMPRESA');
do $$ begin
  perform public.fel_sys_orden_progreso(pg_temp.ag('a1'), (select (r ->> 'orden')::uuid from t_r1), 1, 'llenando');
  perform public.fel_sys_orden_progreso(pg_temp.ag('a1'), (select (r ->> 'orden')::uuid from t_r1), 1, 'detenido_en_vista_previa');
  assert pg_temp.ord_estado((select (r ->> 'orden')::uuid from t_r1)) = 'llenada', 'presentada';
  assert public.fel_sys_orden_reclamar(pg_temp.ag('a1')) is null, 'con una orden presentada no recibe otra';
end $$;
select pg_temp.espera_error($$select public.fel_sys_orden_progreso(pg_temp.ag('a1'), (select (r ->> 'orden')::uuid from t_r1), 1, 'llenando')$$, 'FEL_ESTADO');   -- ya presentada
-- 4.4 resultado: solo con SIM-, serie y número; una vez
select pg_temp.espera_error($$select public.fel_sys_orden_resultado(pg_temp.ag('a1'), (select (r ->> 'orden')::uuid from t_r1), 1, 'emitido_simulado', 'SIMA', '1', 'AUT-REAL-1', null)$$, 'FEL_DATOS_INVALIDOS');   -- una autorización que no es SIM- se rechaza
select pg_temp.espera_error($$select public.fel_sys_orden_resultado(pg_temp.ag('a1'), (select (r ->> 'orden')::uuid from t_r1), 1, 'emitido_simulado', '', '1', 'SIM-1', null)$$, 'FEL_DATOS_INVALIDOS');
select pg_temp.espera_error($$select public.fel_sys_orden_resultado(pg_temp.ag('a1'), (select (r ->> 'orden')::uuid from t_r1), 7, 'emitido_simulado', 'SIMA', '1', 'SIM-1', null)$$, 'FEL_FENCING');
do $$ begin
  assert (public.fel_sys_orden_resultado(pg_temp.ag('a1'), (select (r ->> 'orden')::uuid from t_r1), 1, 'emitido_simulado', 'SIMA', '1', 'SIM-ORDEN-1', null) ->> 'estado') = 'completada';
  assert (select count(*) from public.fel_sys_ordenes_para_cerrar()) = 1, 'la orden completada espera el cierre en NEXA';
end $$;
select pg_temp.espera_error($$select public.fel_sys_orden_resultado(pg_temp.ag('a1'), (select (r ->> 'orden')::uuid from t_r1), 1, 'emitido_simulado', 'SIMA', '1', 'SIM-ORDEN-2', null)$$, 'FEL_ESTADO');   -- no se emite dos veces
-- 4.4b cierre EXCLUSIVO: solo un cierre reserva la orden; la reserva caduca sola y se puede liberar; órdenes aún abiertas no se reservan; parámetros acotados
do $$ declare o uuid := (select (r ->> 'orden')::uuid from t_r1); begin
  assert public.fel_sys_orden_cierre_reservar(o, 60) = true, 'el primer cierre reserva la orden';
  assert public.fel_sys_orden_cierre_reservar(o, 60) = false, 'un segundo cierre simultáneo no la procesa';
  perform public.fel_sys_orden_cierre_liberar(o);
  assert public.fel_sys_orden_cierre_reservar(o, 60) = true, 'liberada (cierre fallido): el siguiente ciclo la reintenta';
  update public.ordenes_emision set cierre_hasta = clock_timestamp() - interval '1 second' where id = o;
  assert public.fel_sys_orden_cierre_reservar(o, 60) = true, 'una reserva caducada (cierre caído) no bloquea la orden';
  assert public.fel_sys_orden_cierre_reservar(gen_random_uuid(), 60) = false, 'una orden inexistente no se reserva';
end $$;
select pg_temp.espera_error($$select public.fel_sys_orden_cierre_reservar((select (r ->> 'orden')::uuid from t_r1), 1)$$, 'FEL_REGLA');
select pg_temp.espera_error($$select public.fel_sys_orden_cierre_reservar((select (r ->> 'orden')::uuid from t_r1), 100000)$$, 'FEL_REGLA');
select pg_temp.espera_error($$update public.ordenes_emision set estado = 'pendiente' where id = (select (r ->> 'orden')::uuid from t_r1)$$, 'FEL_ESTADO');   -- una orden cerrada no se reabre
select pg_temp.espera_error($$update public.ordenes_emision set hash_contenido = repeat('c',64) where id = (select (r ->> 'orden')::uuid from t_r1)$$, 'FEL_REGLA');
select pg_temp.espera_error($$update public.ordenes_emision set empresa_id = '10000000-0000-0000-0000-00000000000b' where id = (select (r ->> 'orden')::uuid from t_r1)$$, 'FEL_REGLA|23503');
select pg_temp.espera_error($$delete from public.ordenes_emision where id = (select (r ->> 'orden')::uuid from t_r1)$$, 'FEL_REGLA');
select pg_temp.espera_error($$truncate public.ordenes_emision$$, 'FEL_REGLA|0A000|foreign key');
select pg_temp.espera_error($$update public.ordenes_emision set autorizacion = 'REAL-1' where id = (select (r ->> 'orden')::uuid from t_r1)$$, '23514|check|FEL_ESTADO');

-- 4.5 reinicio del agente: reclama su propia orden con token nuevo; el proceso anterior queda invalidado (fencing)
create temp table t_s2 as select pg_temp.op('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c1', (select id from t_eA), (select id from t_cA), 'clave-orden-000002') as j;
create temp table t_r2 as select public.fel_sys_orden_reclamar(pg_temp.ag('a1')) as r;
create temp table t_r2b as select public.fel_sys_orden_reclamar(pg_temp.ag('a1')) as r;
do $$ begin
  assert (select (r ->> 'orden') from t_r2) = (select (r ->> 'orden') from t_r2b) and (select (r ->> 'token')::int from t_r2b) = (select (r ->> 'token')::int from t_r2) + 1, 'el reinicio recupera la orden con token nuevo';
end $$;
select pg_temp.espera_error($$select public.fel_sys_orden_progreso(pg_temp.ag('a1'), (select (r ->> 'orden')::uuid from t_r2), (select (r ->> 'token')::bigint from t_r2), 'llenando')$$, 'FEL_FENCING');   -- el proceso anterior ya no puede actuar

-- 4.6 vencimiento ANTES de presentar: vuelve a la cola y otro agente la toma con token mayor
update public.ordenes_emision set lease_hasta = clock_timestamp() - interval '1 second' where id = (select (r ->> 'orden')::uuid from t_r2b);
select pg_temp.espera_error($$select public.fel_sys_orden_resultado(pg_temp.ag('a1'), (select (r ->> 'orden')::uuid from t_r2b), (select (r ->> 'token')::bigint from t_r2b), 'error', null, null, null, 'FORMULARIO')$$, 'FEL_FENCING');   -- arrendamiento vencido
do $$ begin
  assert public.fel_sys_ordenes_vencer('10000000-0000-0000-0000-00000000000a') = 1, 'una orden vencida';
  assert pg_temp.ord_estado((select (r ->> 'orden')::uuid from t_r2b)) = 'pendiente' and (select agente_id is null from public.ordenes_emision where id = (select (r ->> 'orden')::uuid from t_r2b)), 'antes de presentar vuelve a la cola';
  assert pg_temp.op_estado((select (j ->> 'op')::uuid from t_s2)) = 'iniciada', 'la operación sigue abierta (nada se presentó)';
end $$;
create temp table t_r2c as select public.fel_sys_orden_reclamar(pg_temp.ag('a2')) as r;
do $$ begin assert (select (r ->> 'token')::int from t_r2c) = (select (r ->> 'token')::int from t_r2b) + 1, 'el token sigue subiendo'; end $$;
select pg_temp.espera_error($$select public.fel_sys_orden_progreso(pg_temp.ag('a1'), (select (r ->> 'orden')::uuid from t_r2b), (select (r ->> 'token')::bigint from t_r2b), 'detenido_en_vista_previa')$$, 'FEL_FENCING');   -- el agente tardío no puede presentar ni cerrar

-- 4.7 INCERTIDUMBRE tras presentar (condición 1): vence → incierta + operación por_verificar + sin reintento; conciliación manual habilitada solo así
do $$ begin
  perform public.fel_sys_orden_progreso(pg_temp.ag('a2'), (select (r ->> 'orden')::uuid from t_r2c), (select (r ->> 'token')::bigint from t_r2c), 'detenido_en_vista_previa');
  update public.ordenes_emision set lease_hasta = clock_timestamp() - interval '1 second' where id = (select (r ->> 'orden')::uuid from t_r2c);
  assert public.fel_sys_ordenes_vencer(null) >= 1;
  assert pg_temp.ord_estado((select (r ->> 'orden')::uuid from t_r2c)) = 'incierta', 'tras presentar: incierta';
  assert pg_temp.op_estado((select (j ->> 'op')::uuid from t_s2)) = 'desconocida' and pg_temp.doc_estado((select (j ->> 'doc')::uuid from t_s2)) = 'por_verificar', 'la operación pasa a por_verificar';
  assert public.fel_sys_orden_reclamar(pg_temp.ag('a1')) is null and public.fel_sys_orden_reclamar(pg_temp.ag('a2')) is null, 'una orden incierta NO se reasigna ni se reintenta';
end $$;
select pg_temp.espera_error($$select public.fel_op_certificacion_solicitar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select (j ->> 'doc')::uuid from t_s2), 'clave-otra-0000001', pg_temp.h((select (j ->> 'doc')::uuid from t_s2)), (select id from t_cA))$$, 'FEL_POR_VERIFICAR');   -- ni con otra clave
select pg_temp.espera_error($$select public.fel_sys_orden_resultado(pg_temp.ag('a2'), (select (r ->> 'orden')::uuid from t_r2c), (select (r ->> 'token')::bigint from t_r2c), 'emitido_simulado', 'SIMA', '9', 'SIM-TARDIO-1', null)$$, 'FEL_ESTADO');   -- una respuesta tardía no cierra nada
-- conciliación manual: antes de la consulta al canal («indeterminado») no; después sí (dos personas, evidencia): la orden incierta ya no bloquea
select pg_temp.espera_error($$select public.fel_op_conciliacion_proponer('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select (j ->> 'op')::uuid from t_s2), 'manual_fallida', jsonb_build_object('fuente','documento_fisico','referencia','revision-visual-1','fecha_consulta', clock_timestamp()::text,'conclusion','no_figura'), null)$$, 'FEL_REGLA');
select public.fel_sys_evento_registrar('10000000-0000-0000-0000-00000000000a', (select (j ->> 'op')::uuid from t_s2), 'conciliacion', 'indeterminado', 'orden_incierta', null, null, null, null);
-- quién puede PROPONER sobre una orden incierta: solo con fiscal.conciliar (emisor, lector y otra empresa no)
select pg_temp.espera_error($$select public.fel_op_conciliacion_proponer('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select (j ->> 'op')::uuid from t_s2), 'manual_fallida', jsonb_build_object('fuente','documento_fisico','referencia','revision-visual-1','fecha_consulta', clock_timestamp()::text,'conclusion','no_figura'), null)$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_conciliacion_proponer('00000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-00000000000a', (select (j ->> 'op')::uuid from t_s2), 'manual_fallida', jsonb_build_object('fuente','documento_fisico','referencia','revision-visual-1','fecha_consulta', clock_timestamp()::text,'conclusion','no_figura'), null)$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_conciliacion_proponer('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000a', (select (j ->> 'op')::uuid from t_s2), 'manual_fallida', jsonb_build_object('fuente','documento_fisico','referencia','revision-visual-1','fecha_consulta', clock_timestamp()::text,'conclusion','no_figura'), null)$$, 'FEL_NO_AUTORIZADO');
-- evidencia inventada, referencia corta o fecha anterior al envío: rechazadas
select pg_temp.espera_error($$select public.fel_op_conciliacion_proponer('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select (j ->> 'op')::uuid from t_s2), 'manual_fallida', '{"fuente":"mi_palabra","referencia":"abcde","fecha_consulta":"2026-01-01T00:00:00Z","conclusion":"no_figura"}'::jsonb, null)$$, 'FEL_REGLA');
select pg_temp.espera_error($$select public.fel_op_conciliacion_proponer('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select (j ->> 'op')::uuid from t_s2), 'manual_fallida', jsonb_build_object('fuente','documento_fisico','referencia','x','fecha_consulta', clock_timestamp()::text,'conclusion','no_figura'), null)$$, 'FEL_REGLA');
create temp table t_c as select (public.fel_op_conciliacion_proponer('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select (j ->> 'op')::uuid from t_s2), 'manual_fallida', jsonb_build_object('fuente','documento_fisico','referencia','revision-visual-1','fecha_consulta', clock_timestamp()::text,'conclusion','no_figura'), null)).id as id;
-- quién puede APROBAR: otra persona con conciliacion.aprobar (no quien propone; ni emisor, lector u otra empresa)
select pg_temp.espera_error($$select public.fel_op_conciliacion_decidir('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select id from t_c), true, 'yo mismo')$$, 'FEL_REGLA');
select pg_temp.espera_error($$select public.fel_op_conciliacion_decidir('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select id from t_c), true, 'emisor')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_conciliacion_decidir('00000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-00000000000a', (select id from t_c), true, 'lector')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_conciliacion_decidir('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000a', (select id from t_c), true, 'otra empresa')$$, 'FEL_NO_AUTORIZADO');
do $$ begin assert pg_temp.op_estado((select (j ->> 'op')::uuid from t_s2)) = 'desconocida' and pg_temp.doc_estado((select (j ->> 'doc')::uuid from t_s2)) = 'por_verificar', 'hasta aprobar, sigue por_verificar'; end $$;
-- una respuesta TARDÍA del agente no cierra la orden incierta (ni descartar, ni error, ni progreso), antes ni después de aprobar
select pg_temp.espera_error($$select public.fel_sys_orden_resultado(pg_temp.ag('a2'), (select (r ->> 'orden')::uuid from t_r2c), (select (r ->> 'token')::bigint from t_r2c), 'descartado', null, null, null, null)$$, 'FEL_ESTADO');
select pg_temp.espera_error($$select public.fel_sys_orden_resultado(pg_temp.ag('a2'), (select (r ->> 'orden')::uuid from t_r2c), (select (r ->> 'token')::bigint from t_r2c), 'error', null, null, null, 'X')$$, 'FEL_ESTADO');
select pg_temp.espera_error($$select public.fel_sys_orden_progreso(pg_temp.ag('a2'), (select (r ->> 'orden')::uuid from t_r2c), (select (r ->> 'token')::bigint from t_r2c), 'detenido_en_vista_previa')$$, 'FEL_ESTADO');
select public.fel_op_conciliacion_decidir('00000000-0000-0000-0000-0000000000c4', '10000000-0000-0000-0000-00000000000a', (select id from t_c), true, 'revisado por una segunda persona');
do $$ begin
  assert pg_temp.op_estado((select (j ->> 'op')::uuid from t_s2)) = 'confirmada_fallida', 'la aprobación de otra persona cierra la operación';
  assert pg_temp.ord_estado((select (r ->> 'orden')::uuid from t_r2c)) = 'incierta', 'la orden sigue incierta (la historia no se reescribe)';
end $$;
select pg_temp.espera_error($$select public.fel_sys_orden_resultado(pg_temp.ag('a2'), (select (r ->> 'orden')::uuid from t_r2c), (select (r ->> 'token')::bigint from t_r2c), 'emitido_simulado', 'SIMA', '9', 'SIM-TARDIO-2', null)$$, 'FEL_ESTADO');   -- tampoco tras cerrar la operación

-- 4.8 error: antes de presentar ⇒ fallida (se prueba que nada salió); tras presentar ⇒ incierta
create temp table t_s3 as select pg_temp.op('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c1', (select id from t_eA), (select id from t_cA), 'clave-orden-000003') as j;
create temp table t_r3 as select public.fel_sys_orden_reclamar(pg_temp.ag('a1')) as r;
do $$ begin
  assert (public.fel_sys_orden_resultado(pg_temp.ag('a1'), (select (r ->> 'orden')::uuid from t_r3), 1, 'error', null, null, null, 'CAMPOS_OBLIGATORIOS') ->> 'estado') = 'fallida';
  assert pg_temp.op_estado((select (j ->> 'op')::uuid from t_s3)) = 'iniciada', 'el cierre de la operación lo hace NEXA (cierre de órdenes)';
  assert (select count(*) from public.fel_sys_ordenes_para_cerrar() where operacion_id = (select (j ->> 'op')::uuid from t_s3)) = 1;
end $$;
create temp table t_s4 as select pg_temp.op('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c1', (select id from t_eA), (select id from t_cA), 'clave-orden-000004') as j;
create temp table t_r4 as select public.fel_sys_orden_reclamar(pg_temp.ag('a1')) as r;
do $$ begin
  perform public.fel_sys_orden_progreso(pg_temp.ag('a1'), (select (r ->> 'orden')::uuid from t_r4), 1, 'detenido_en_vista_previa');
  assert (public.fel_sys_orden_resultado(pg_temp.ag('a1'), (select (r ->> 'orden')::uuid from t_r4), 1, 'error', null, null, null, 'PAGINA_PERDIDA') ->> 'estado') = 'incierta', 'un error tras presentar es incierto';
  assert pg_temp.op_estado((select (j ->> 'op')::uuid from t_s4)) = 'desconocida' and pg_temp.doc_estado((select (j ->> 'doc')::uuid from t_s4)) = 'por_verificar';
end $$;
-- descartado en el simulador (observado) ⇒ descartada
create temp table t_s5 as select pg_temp.op('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c1', (select id from t_eA), (select id from t_cA), 'clave-orden-000005') as j;
create temp table t_r5 as select public.fel_sys_orden_reclamar(pg_temp.ag('a1')) as r;
do $$ begin
  perform public.fel_sys_orden_progreso(pg_temp.ag('a1'), (select (r ->> 'orden')::uuid from t_r5), 1, 'detenido_en_vista_previa');
  assert (public.fel_sys_orden_resultado(pg_temp.ag('a1'), (select (r ->> 'orden')::uuid from t_r5), 1, 'descartado', null, null, null, null) ->> 'estado') = 'descartada';
end $$;

-- 4.9 el servidor valida el estado de la operación en cada reclamo (condición 3)
create temp table t_s6 as select pg_temp.op('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c1', (select id from t_eA), (select id from t_cA), 'clave-orden-000006') as j;
do $$ begin
  perform public.fel_sys_operacion_desconocida('10000000-0000-0000-0000-00000000000a', (select (j ->> 'op')::uuid from t_s6), 'prueba');   -- la operación deja de estar abierta por otra vía
  assert public.fel_sys_orden_reclamar(pg_temp.ag('a1')) is null, 'no se entrega una orden de una operación ya no abierta';
  assert pg_temp.ord_estado((select (j ->> 'orden')::uuid from t_s6)) = 'cancelada', 'la orden queda cancelada';
end $$;

-- 4.10 aislamiento entre empresas: el agente de B con su propia orden; el de A no la ve ni la toca
create temp table t_sB as select pg_temp.op('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d1', (select id from t_eB), (select id from t_cB), 'clave-orden-00000B') as j;
do $$ begin
  assert public.fel_sys_orden_reclamar(pg_temp.ag('a2')) is null, 'el agente de A no recibe órdenes de B';
  assert (public.fel_sys_orden_reclamar(pg_temp.ag('b')) ->> 'orden')::uuid = (select (j ->> 'orden')::uuid from t_sB), 'el agente de B recibe la suya';
end $$;
select pg_temp.espera_error($$select public.fel_sys_orden_progreso(pg_temp.ag('a1'), (select (j ->> 'orden')::uuid from t_sB), 1, 'llenando')$$, 'FEL_EMPRESA');

-- ================= 5. revocación
select pg_temp.espera_error($$select public.fel_op_agente_revocar('00000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-00000000000a', pg_temp.ag('a2'))$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_agente_revocar('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000a', pg_temp.ag('a2'))$$, 'FEL_NO_AUTORIZADO');   -- propietario de otra empresa
select pg_temp.espera_error($$select public.fel_op_agente_revocar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000b', pg_temp.ag('a2'))$$, 'FEL_NO_AUTORIZADO|FEL_NO_ENCONTRADO');
create temp table t_s7 as select pg_temp.op('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c1', (select id from t_eA), (select id from t_cA), 'clave-orden-000007') as j;
create temp table t_r7 as select public.fel_sys_orden_reclamar(pg_temp.ag('a2')) as r;
do $$ begin
  perform public.fel_sys_orden_progreso(pg_temp.ag('a2'), (select (r ->> 'orden')::uuid from t_r7), 1, 'detenido_en_vista_previa');
  perform public.fel_op_agente_revocar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', pg_temp.ag('a2'));
  assert pg_temp.ord_estado((select (r ->> 'orden')::uuid from t_r7)) = 'incierta' and pg_temp.op_estado((select (j ->> 'op')::uuid from t_s7)) = 'desconocida', 'revocar con una orden presentada ⇒ incierta y por_verificar';
  assert (select estado from public.fel_op_agentes_listar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a') where id = pg_temp.ag('a2')) = 'revocado';
  assert (select count(*) from public.auditoria where accion = 'agente.revocado') = 1;
end $$;
do $$ begin assert (public.fel_sys_agente_clave(pg_temp.ag('a2')) ->> 'estado') = 'revocado', 'clave de un revocado con su estado (el plano de control verifica la firma antes de decir revocado)'; end $$;
select pg_temp.espera_error($$select public.fel_sys_agente_latido(pg_temp.ag('a2'), '1', null)$$, 'FEL_REVOCADO');
select pg_temp.espera_error($$select public.fel_sys_orden_reclamar(pg_temp.ag('a2'))$$, 'FEL_REVOCADO');
select pg_temp.espera_error($$select public.fel_sys_agente_autenticar(pg_temp.ag('a2'), clock_timestamp(), 'nonce-dddddddddddddddd')$$, 'FEL_REVOCADO');
select pg_temp.espera_error($$update public.agentes_locales set estado = 'activo', revocado_en = null where id = pg_temp.ag('a2')$$, 'FEL_REGLA|23514');   -- no se reactiva

-- ================= 6. RLS y privilegios: la app no ve claves, tokens ni instantáneas, ni datos de otra empresa; no puede llamar a las funciones
set local role authenticated; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.agentes_locales where empresa_id = '10000000-0000-0000-0000-00000000000a') = 0, 'B no ve agentes de A';
  assert (select count(*) from public.ordenes_emision where empresa_id = '10000000-0000-0000-0000-00000000000a') = 0, 'B no ve órdenes de A';
  assert (select count(*) from public.agentes_locales) = 1, 'B ve solo el suyo';
end $$;
select pg_temp.espera_error($$select clave_publica from public.agentes_locales$$, '42501|permission denied');
select pg_temp.espera_error($$select token from public.ordenes_emision$$, '42501|permission denied');
select pg_temp.espera_error($$select instantanea from public.ordenes_emision$$, '42501|permission denied');
select pg_temp.espera_error($$select * from public.codigos_vinculacion$$, '42501|permission denied');
select pg_temp.espera_error($$select * from public.agente_nonces$$, '42501|permission denied');
select pg_temp.espera_error($$update public.ordenes_emision set estado = 'completada'$$, '42501|permission denied');
select pg_temp.espera_error($$select public.fel_sys_orden_reclamar(gen_random_uuid())$$, '42501|permission denied');
select pg_temp.espera_error($$select public.fel_sys_orden_cierre_reservar(gen_random_uuid(), 60)$$, '42501|permission denied');
select pg_temp.espera_error($$select public.fel_sys_orden_cierre_liberar(gen_random_uuid())$$, '42501|permission denied');
select pg_temp.espera_error($$select public.fel_sys_orden_vista_previa(gen_random_uuid(), gen_random_uuid(), 1, '{}'::jsonb, repeat('a',64))$$, '42501|permission denied');
select pg_temp.espera_error($$select public.fel_op_orden_confirmacion_autorizar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', gen_random_uuid(), 300)$$, '42501|permission denied');
select pg_temp.espera_error($$select public.fel_op_orden_vista_previa('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', gen_random_uuid())$$, '42501|permission denied');
select pg_temp.espera_error($$select * from public.ordenes_confirmaciones$$, '42501|permission denied');
select pg_temp.espera_error($$select public.fel_sys_agente_politica(null)$$, '42501|permission denied');
select pg_temp.espera_error($$select public.fel_sys_agente_metricas_guardar('[]'::jsonb)$$, '42501|permission denied');
select pg_temp.espera_error($$select public.fel_op_agente_metricas('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', 24)$$, '42501|permission denied');
select pg_temp.espera_error($$select * from public.agente_metricas$$, '42501|permission denied');
select pg_temp.espera_error($$select public.fel_sys_agente_vincular('AAAA-AAAA-AAAA', repeat('A',43), 'x', '1')$$, '42501|permission denied');
select pg_temp.espera_error($$select public.fel_op_agente_codigo_crear('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000b')$$, '42501|permission denied');
reset role;
set local role authenticated; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
do $$ begin assert (select count(*) from public.agentes_locales) = 2, 'el lector de A ve (sin clave) los agentes de A'; assert (select count(*) from public.ordenes_emision) >= 1, 'y sus órdenes (fiscal.ver)'; end $$;
reset role;

rollback;
\echo OK 17_agente_local
