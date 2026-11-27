-- M-V · cierre local de R3: pre-lecturas de personas (`api.*`), contexto de empresa, lecturas de los servicios del sistema (`fel_sys_*`) y privilegios mínimos. Superusuario con `set role`; todo se deshace.
-- Cada rechazo se comprueba por su mensaje o por su efecto (nulo/vacío), no por «cualquier error».
\set ON_ERROR_STOP on
begin;
create or replace function pg_temp.root() returns void language plpgsql as $$ begin perform set_config('role', 'postgres', true); end $$;
create or replace function pg_temp.como(p_uid text, p_sesion text, p_emp text default null) returns void language plpgsql as $$
begin perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', (json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', p_sesion, 'aal', 'aal1')::jsonb || case when p_emp is null then '{}'::jsonb else jsonb_build_object('app_metadata', jsonb_build_object('empresa_id', p_emp)) end)::text, true);
  perform set_config('role', 'authenticated', true); end $$;
create or replace function pg_temp.espera(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_msg text := null;
begin begin execute p_sql; exception when others then v_msg := sqlerrm; end;
  if v_msg is null then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if;
  if v_msg !~ p_patron then raise exception 'ERROR DISTINTO al esperado /%/: «%» en: %', p_patron, v_msg, p_sql; end if; end $$;
insert into auth.sessions (id, user_id, aal) values ('99000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c3', 'aal1'), ('99000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d1', 'aal1'), ('99000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c2', 'aal1');
-- ===== datos (triggers desactivados solo para sembrar estados) =====
set local session_replication_role = replica;
do $$ declare a uuid := '10000000-0000-0000-0000-00000000000a'; b uuid := '10000000-0000-0000-0000-00000000000b'; cli uuid; clib uuid; cf uuid; d1 uuid; d2 uuid; db uuid; op uuid;
begin
  insert into public.clientes (empresa_id, tipo_identificacion, numero_identificacion, nombre, email) values (a, 'NIT', '8300001-1', 'Cliente Ref A', 'a@ejemplo.test') returning id into cli;
  insert into public.clientes (empresa_id, tipo_identificacion, numero_identificacion, nombre) values (a, 'CF', 'CF', 'Consumidor Final') returning id into cf;
  insert into public.clientes (empresa_id, tipo_identificacion, numero_identificacion, nombre) values (b, 'NIT', '8300002-2', 'Cliente Ref B') returning id into clib;
  insert into public.documentos (empresa_id, numero_borrador, cliente_id, subtotal, base_imponible, total, estado_preparacion, estado_fiscal, serie, numero_fiscal, autorizacion_sat, certificacion_verificada_en, fecha_emision_prevista)
    values (a, 1, cli, 100, 100, 112, 'revisado', 'certificado', 'SIM', '1', 'SIM-1', now(), date '2026-11-02') returning id into d1;
  insert into public.documentos (empresa_id, numero_borrador, cliente_id, subtotal, base_imponible, total) values (a, 2, cli, 10, 10, 11) returning id into d2;
  insert into public.documentos (empresa_id, numero_borrador, cliente_id) values (b, 1, clib) returning id into db;
  insert into public.operaciones_fiscales (empresa_id, documento_id, tipo, clave_idempotencia, hash_contenido, estado, resuelta_en, resolucion, proveedor) values (a, d1, 'certificacion', 'clave-r3-prueba-0001', repeat('a', 64), 'confirmada_exitosa', now(), 'proveedor', 'mock') returning id into op;
  insert into public.artefactos_documento (empresa_id, documento_id, operacion_id, tipo, nombre, mime, sha256, tamano, contenido) values (a, d1, op, 'pdf', 'f.pdf', 'application/pdf', encode(sha256('PDFX'::bytea), 'hex'), 4, 'PDFX'::bytea);
  insert into public.alertas_fiscales (empresa_id, documento_id, operacion_id, tipo) values (a, d2, op, 'certificacion_huerfana');
  insert into public.operaciones_fiscales (empresa_id, documento_id, tipo, clave_idempotencia, hash_contenido, estado, resuelta_en, resolucion, proveedor) values (b, db, 'certificacion', 'clave-r3-prueba-0002', repeat('b', 64), 'confirmada_exitosa', now(), 'proveedor', 'mock');
  insert into public.alertas_fiscales (empresa_id, documento_id, operacion_id, tipo) select b, db, id, 'certificacion_huerfana' from public.operaciones_fiscales where clave_idempotencia = 'clave-r3-prueba-0002';
  insert into public.consumos (cuenta_id, empresa_id, evento_tipo, operacion_id, documento_id, clave_idempotencia, hash_contenido, estado, unidades_reservadas, regla_id) values (gen_random_uuid(), a, (select codigo from public.evento_tipos limit 1), op, d1, 'consumo-r3-prueba-0001', repeat('c', 64), 'reservado', 1, gen_random_uuid());
  insert into public.documento_lineas (documento_id, empresa_id, orden, descripcion, cantidad, precio_unitario) values (d1, a, 1, 'Servicio', 2, 50);
  insert into public.auditoria (empresa_id, accion, entidad, entidad_id, origen, datos) values (a, 'digifact_test.correo_solicitado', 'documento', d1::text, 'prueba', '{"x": 1}'::jsonb);
end $$;
set local session_replication_role = origin;
update public.plataforma_parametros set valor = 0 where clave = 'establecimiento_por_usuario';   -- alcance apagado (los documentos sembrados no llevan establecimiento)
create temp table t_ids as select (select id from public.documentos where empresa_id = '10000000-0000-0000-0000-00000000000a' and numero_borrador = 1) d1, (select id from public.documentos where empresa_id = '10000000-0000-0000-0000-00000000000a' and numero_borrador = 2) d2,
  (select id from public.documentos where empresa_id = '10000000-0000-0000-0000-00000000000b' and numero_borrador = 1) db, (select id from public.operaciones_fiscales where clave_idempotencia = 'clave-r3-prueba-0001') op,
  (select id from public.alertas_fiscales where empresa_id = '10000000-0000-0000-0000-00000000000a' limit 1) al, (select id from public.alertas_fiscales where empresa_id = '10000000-0000-0000-0000-00000000000b' limit 1) alb, (select id from public.clientes where numero_identificacion = '8300001-1') cli, (select id from public.clientes where numero_identificacion = '8300002-2') clib;
grant select on t_ids to public;
-- ===== A) personas: pre-lecturas =====
select pg_temp.como('00000000-0000-0000-0000-0000000000c3', '99000000-0000-0000-0000-0000000000c3');
do $$ declare r jsonb; t t_ids; begin select * into t from t_ids;
  r := api.documento_ref(t.d1); assert r ->> 'estado_fiscal' = 'certificado' and r ->> 'fecha_emision_prevista' = '2026-11-02' and r ->> 'tipo_dte' = 'FACT' and (r ->> 'version')::int >= 1 and r ->> 'cliente_id' = t.cli::text, 'documento_ref: datos de validación de SU documento: ' || r::text;
  assert api.documento_ref(t.db) is null, 'documento_ref: un documento de OTRA empresa no existe'; assert api.documento_ref(gen_random_uuid()) is null, 'inexistente: nulo';
  assert api.cliente_ref(t.cli) ->> 'tipo_identificacion' = 'NIT', 'cliente_ref por id'; assert api.cliente_ref(t.clib) is null, 'cliente de otra empresa: nulo';
  assert (api.cliente_ref(null, 'Consumidor Final') ->> 'id') is not null and api.cliente_ref(null, 'Otro nombre') is null, 'cliente CF por nombre (activo, de la empresa)';
  assert api.referencia('operacion_certificada', t.d1) = t.op, 'referencia: operación certificada del documento'; assert api.referencia('operacion_certificada', t.db) is null, 'referencia: otra empresa → nulo';
  assert api.referencia('documento_de_alerta', t.al) = t.d2, 'referencia: documento de la alerta'; assert api.referencia('documento_de_alerta', t.alb) is null, 'referencia: alerta de OTRA empresa → nulo'; assert api.referencia('operacion_de_conciliacion', gen_random_uuid()) is null; assert api.referencia('tipo_inventado', t.d1) is null, 'tipo desconocido: nulo';
  r := api.empresa_contexto(); assert r -> 'empresa' ->> 'nit' = '1111111-1' and r -> 'empresa' ->> 'razon_social' = 'Empresa A S.A.' and (r ->> 'ultimo_borrador')::int = 2 and jsonb_typeof(r -> 'canales') = 'array', 'empresa_contexto: SU empresa: ' || r::text;
  assert jsonb_array_length(api.documento_cobertura(t.d1)) = 1, 'cobertura de SU documento: un consumo'; assert api.documento_cobertura(t.d2) = '[]'::jsonb, 'cobertura sin consumos: lista vacía'; end $$;
select pg_temp.como('00000000-0000-0000-0000-0000000000d1', '99000000-0000-0000-0000-0000000000d1');
do $$ declare t t_ids; r jsonb; begin select * into t from t_ids; r := api.empresa_contexto(); assert r -> 'empresa' ->> 'nit' = '2222222-2' and (r ->> 'ultimo_borrador')::int = 1, 'B recibe SU empresa'; assert api.documento_ref(t.d1) is null and api.referencia('operacion_certificada', t.d1) is null and api.documento_cobertura(t.d1) = '[]'::jsonb, 'B no obtiene nada de A'; end $$;
-- persona con DOS empresas y selector: cada RPC devuelve SOLO la elegida (el filtro por empresa propio de cada función, además de la RLS)
select pg_temp.root(); insert into public.miembros (empresa_id, user_id, rol) values ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000c2', 'propietario');
select pg_temp.como('00000000-0000-0000-0000-0000000000c2', '99000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-00000000000b');
do $$ declare t t_ids; r jsonb; begin select * into t from t_ids;
  r := api.empresa_contexto(); assert r -> 'empresa' ->> 'nit' = '2222222-2', 'selector B: empresa_contexto de B (aunque también es miembro de A)';
  assert api.documento_ref(t.d1) is null and api.referencia('operacion_certificada', t.d1) is null and api.documento_cobertura(t.d1) = '[]'::jsonb and api.cliente_ref(t.cli) is null, 'selector B: nada de A por ninguna función';
  assert api.documento_ref(t.db) is not null, 'selector B: sí su documento de B'; end $$;
select pg_temp.como('00000000-0000-0000-0000-0000000000c2', '99000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-00000000000a');
do $$ declare t t_ids; begin select * into t from t_ids; assert api.documento_ref(t.db) is null and api.empresa_contexto() -> 'empresa' ->> 'nit' = '1111111-1', 'selector A: nada de B'; end $$;
select pg_temp.root(); delete from public.miembros where empresa_id = '10000000-0000-0000-0000-00000000000b' and user_id = '00000000-0000-0000-0000-0000000000c2';
-- permisos y alcance: sin `borradores.ver` la cobertura y la referencia del documento quedan vacías
select pg_temp.root(); update public.miembros set permisos_revocados = array['borradores.ver'] where user_id = '00000000-0000-0000-0000-0000000000c3';
select pg_temp.como('00000000-0000-0000-0000-0000000000c3', '99000000-0000-0000-0000-0000000000c3');
do $$ declare t t_ids; begin select * into t from t_ids; assert api.documento_ref(t.d1) is null, 'sin borradores.ver: documento_ref vacío (RLS)'; assert api.documento_cobertura(t.d1) = '[]'::jsonb, 'sin borradores.ver: cobertura vacía aunque el documento tenga consumos'; end $$;
select pg_temp.root(); update public.miembros set permisos_revocados = '{}' where user_id = '00000000-0000-0000-0000-0000000000c3';
-- sin sesión viva / anónimo
select pg_temp.root(); delete from auth.sessions where id = '99000000-0000-0000-0000-0000000000c3'; select pg_temp.como('00000000-0000-0000-0000-0000000000c3', '99000000-0000-0000-0000-0000000000c3');
select pg_temp.espera($$select api.empresa_contexto()$$, 'sesión no válida'); select pg_temp.espera($$select api.referencia('operacion_certificada', gen_random_uuid())$$, 'sesión no válida'); select pg_temp.espera($$select api.documento_ref(gen_random_uuid())$$, 'sesión no válida');
select pg_temp.espera($$select api.documento_cobertura(gen_random_uuid())$$, 'sesión no válida');
select pg_temp.root(); select set_config('role', 'anon', true); select pg_temp.espera($$select api.empresa_contexto()$$, 'permission denied'); select pg_temp.espera($$select api.referencia('x', gen_random_uuid())$$, 'permission denied');
-- ===== B) servicios del sistema: solo nexa_sys; la empresa va como parámetro verificado por quien llama =====
select pg_temp.root();
do $$ declare t t_ids; f text; begin select * into t from t_ids;
  foreach f in array array['fel_sys_doc_fel', 'fel_sys_doc_cliente', 'fel_sys_doc_correo', 'fel_sys_op_certificada', 'fel_sys_auditoria_ultima', 'fel_sys_auditoria_contar', 'fel_sys_artefactos_op'] loop
    assert exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = f and prosecdef and proconfig::text ~ 'search_path') , f || ': DEFINER con search_path fijo';
    assert not exists (select 1 from pg_proc p where p.proname = f and p.pronamespace = 'public'::regnamespace and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))), f || ': ni anon, ni authenticated, ni PUBLIC';
    assert exists (select 1 from pg_proc p where p.proname = f and p.pronamespace = 'public'::regnamespace and has_function_privilege('nexa_sys', p.oid, 'execute')), f || ': nexa_sys sí';
    assert not exists (select 1 from pg_proc p where p.proname = f and p.pronamespace = 'public'::regnamespace and has_function_privilege('nexa_app', p.oid, 'execute')), f || ': nexa_app NO (M-E la revoca)';
  end loop; end $$;
set local role nexa_sys;
do $$ declare t t_ids; r jsonb; a uuid := '10000000-0000-0000-0000-00000000000a'; b uuid := '10000000-0000-0000-0000-00000000000b'; n int; begin select * into t from t_ids;
  r := public.fel_sys_doc_fel(a, t.d1); assert r -> 'documento' ->> 'c_nombre' = 'Cliente Ref A' and r -> 'documento' ->> 'estado_fiscal' = 'certificado' and r -> 'documento' ->> 'fecha_emision_prevista' = '2026-11-02' and jsonb_array_length(r -> 'lineas') = 1 and r -> 'lineas' -> 0 ->> 'cantidad' = '2', 'doc_fel: documento, receptor y líneas: ' || r::text;
  assert public.fel_sys_doc_fel(b, t.d1) is null, 'doc_fel con la empresa equivocada: nulo (la empresa filtra)'; assert public.fel_sys_doc_fel(a, t.db) is null;
  assert public.fel_sys_doc_cliente(a, t.d1) ->> 'email' = 'a@ejemplo.test' and public.fel_sys_doc_cliente(b, t.d1) is null, 'doc_cliente';
  r := public.fel_sys_doc_correo(a, t.d1); assert r ->> 'cliente_email' = 'a@ejemplo.test' and r ->> 'total' = '112' and r ->> 'razon_social' = 'Empresa A S.A.' and public.fel_sys_doc_correo(b, t.d1) is null, 'doc_correo';
  assert public.fel_sys_op_certificada(a, t.d1) = t.op and public.fel_sys_op_certificada(b, t.d1) is null, 'op_certificada';
  assert public.fel_sys_auditoria_contar(a, 'digifact_test.correo_solicitado', 'documento', t.d1::text) = 1 and public.fel_sys_auditoria_contar(b, 'digifact_test.correo_solicitado', 'documento', t.d1::text) = 0, 'auditoria_contar acotada por empresa';
  assert public.fel_sys_auditoria_ultima(a, 'digifact_test.correo_solicitado', 'documento', t.d1::text) -> 'datos' ->> 'x' = '1' and public.fel_sys_auditoria_ultima(b, 'digifact_test.correo_solicitado', 'documento', t.d1::text) is null, 'auditoria_ultima';
  select count(*) into n from public.fel_sys_artefactos_op(a, t.d1, t.op); assert n = 1 and (select convert_from(contenido, 'UTF8') from public.fel_sys_artefactos_op(a, t.d1, t.op)) = 'PDFX', 'artefactos_op: contenido íntegro de SU empresa';
  assert (select count(*) from public.fel_sys_artefactos_op(b, t.d1, t.op)) = 0, 'artefactos_op: otra empresa → nada'; end $$;
-- y nada más: sin tablas de datos de empresa, ni auditoría, ni sesiones
select pg_temp.espera($$select count(*) from public.documentos$$, 'permission denied'); select pg_temp.espera($$select count(*) from public.clientes$$, 'permission denied'); select pg_temp.espera($$select count(*) from public.auditoria$$, 'permission denied');
select pg_temp.espera($$select count(*) from public.artefactos_documento$$, 'permission denied'); select pg_temp.espera($$select count(*) from public.empresas$$, 'permission denied');
select pg_temp.espera($$insert into public.documentos (empresa_id, numero_borrador) values ('10000000-0000-0000-0000-00000000000a', 99)$$, 'permission denied');
reset role; select pg_temp.root();
-- authenticated no ejecuta las de sistema
select set_config('role', 'authenticated', true); select pg_temp.espera($$select public.fel_sys_doc_fel('10000000-0000-0000-0000-00000000000a', gen_random_uuid())$$, 'permission denied'); select pg_temp.espera($$select public.fel_sys_auditoria_contar('10000000-0000-0000-0000-00000000000a', 'x', 'y', 'z')$$, 'permission denied');
select pg_temp.root();
select 'PRUEBAS DE CIERRE LOCAL DE R3 OK';
rollback;
