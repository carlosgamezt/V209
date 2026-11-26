-- Pruebas SQL de M-A a M-D en un PostgreSQL temporal (no tocan ningún proyecto de Supabase): permisos, aislamiento entre empresas, RLS, secretos, reglas y acceso excepcional del maestro.
\set ON_ERROR_STOP on
begin;
create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_ok boolean := false;
begin
  begin execute p_sql; exception when others then v_ok := (sqlerrm ~ p_patron) or (sqlstate ~ p_patron); end;
  if not v_ok then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if;
end $$;
create or replace function pg_temp.como(p_uid text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', p_uid, true); perform set_config('role', 'authenticated', true); end $$;
create or replace function pg_temp.anonimo() returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', '', true); perform set_config('role', 'anon', true); end $$;
create or replace function pg_temp.volver() returns void language plpgsql as $$ begin perform set_config('role', 'postgres', true); end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'maestro@fel.test'), ('00000000-0000-0000-0000-0000000000a2', 'maestro2@fel.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'propA@fel.test'), ('00000000-0000-0000-0000-0000000000c4', 'adminA@fel.test'), ('00000000-0000-0000-0000-0000000000c2', 'lectorA@fel.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'emisorA@fel.test'), ('00000000-0000-0000-0000-0000000000d1', 'propB@fel.test');
insert into public.perfiles (user_id) select id from auth.users on conflict (user_id) do nothing;
insert into public.plataforma_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000a2');
insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id, estado)
select e.id, e.n, e.n || ' S.A.', e.nit, r.id, 'habilitada'
  from (values ('10000000-0000-0000-0000-00000000000a'::uuid, 'Empresa A', '1111111-1'), ('10000000-0000-0000-0000-00000000000b'::uuid, 'Empresa B', '2222222-2')) e(id, n, nit),
       public.regimenes_fiscales r where r.codigo = 'general';
insert into public.miembros (empresa_id, user_id, rol) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 'propietario'), ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c4', 'administrador'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c2', 'lector'), ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', 'emisor'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000d1', 'propietario');

-- ================= 1. permisos por rol
do $$ begin
  assert 'digifact.conectar' = any (public.fel_permisos_efectivos('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1')), 'propietario conecta';
  assert 'fiscal.aprobar_emisor' = any (public.fel_permisos_efectivos('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1')), 'propietario aprueba';
  assert 'fiscal.configurar' = any (public.fel_permisos_efectivos('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c4')), 'administrador configura';
  assert 'digifact.probar' = any (public.fel_permisos_efectivos('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c4')), 'administrador prueba';
  assert not ('digifact.conectar' = any (public.fel_permisos_efectivos('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c4'))), 'administrador NO conecta';
  assert not ('fiscal.aprobar_emisor' = any (public.fel_permisos_efectivos('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c4'))), 'administrador NO aprueba';
  assert (select count(*) from unnest(public.fel_permisos_efectivos('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3')) p where p in ('fiscal.configurar','fiscal.aprobar_emisor','digifact.conectar','digifact.probar')) = 0, 'emisor sin permisos nuevos';
  assert (select count(*) from unnest(public.fel_permisos_efectivos('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c2')) p where p in ('fiscal.configurar','fiscal.aprobar_emisor','digifact.conectar','digifact.probar')) = 0, 'lector sin permisos nuevos';
  assert (select count(*) from unnest(public.fel_permisos_efectivos('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1')) p) = 0, 'el maestro no tiene permisos de empresa';
end $$;

-- ================= 2. emisor: guardar, aprobar, inmutabilidad, aislamiento
create temp table t_e10 as select (public.fel_op_establecimiento_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, '10', 'Sucursal 10', 'Dirección 10', 'activo')).id a;
select pg_temp.espera_error($$select public.fel_op_emisor_guardar('00000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-00000000000a', (select a from t_e10), '1111111', 'Empresa A, S.A.', null, 'GEN', '[]', null, 'Calle 1', '01001', 'Guatemala', 'Guatemala', 'aaaaaaaaaaaaaaaa')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_emisor_guardar('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000a', (select a from t_e10), '1111111', 'Empresa A, S.A.', null, 'GEN', '[]', null, 'Calle 1', '01001', 'Guatemala', 'Guatemala', 'aaaaaaaaaaaaaaaa')$$, 'FEL_NO_AUTORIZADO');   -- el propietario de B no toca A
select public.fel_op_emisor_guardar('00000000-0000-0000-0000-0000000000c4', '10000000-0000-0000-0000-00000000000a', (select a from t_e10), '1111111', 'Empresa A, S.A.', null, 'GEN', '[{"tipo":1,"escenario":2}]', null, 'Calle 1', '01001', 'Guatemala', 'Guatemala', 'aaaaaaaaaaaaaaaa');
select pg_temp.espera_error($$select public.fel_op_emisor_aprobar('00000000-0000-0000-0000-0000000000c4', '10000000-0000-0000-0000-00000000000a', (select a from t_e10), 1, 'aaaaaaaaaaaaaaaa')$$, 'FEL_NO_AUTORIZADO');   -- el administrador no aprueba
select pg_temp.espera_error($$select public.fel_op_emisor_aprobar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select a from t_e10), 1, 'bbbbbbbbbbbbbbbb')$$, 'FEL_REGLA');   -- huella distinta
select public.fel_op_emisor_aprobar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select a from t_e10), 1, 'aaaaaaaaaaaaaaaa');
select pg_temp.espera_error($$update public.empresa_emisor_versiones set nombre_fiscal = 'Otro' where empresa_id = '10000000-0000-0000-0000-00000000000a' and version = 1$$, 'FEL_REGLA');
select pg_temp.espera_error($$delete from public.empresa_emisor_versiones where empresa_id = '10000000-0000-0000-0000-00000000000a' and version = 1$$, 'FEL_REGLA');
select public.fel_op_emisor_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select a from t_e10), '1111111', 'Empresa A, S.A.', 'A', 'GEN', '[]', null, 'Calle 2', '01001', 'Guatemala', 'Guatemala', 'cccccccccccccccc');
select public.fel_op_emisor_aprobar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select a from t_e10), 2, 'cccccccccccccccc');
do $$ begin
  assert (select count(*) from public.empresa_emisor_versiones where empresa_id = '10000000-0000-0000-0000-00000000000a' and estado = 'aprobada') = 1, 'una sola versión vigente';
  assert (select estado from public.empresa_emisor_versiones where empresa_id = '10000000-0000-0000-0000-00000000000a' and version = 1) = 'reemplazada', 'la anterior queda reemplazada';
  assert (select huella from public.fel_sys_emisor_vigente('10000000-0000-0000-0000-00000000000a')) = 'cccccccccccccccc', 'el servicio lee la vigente';
  assert (select count(*) from public.fel_sys_emisor_vigente('10000000-0000-0000-0000-00000000000b')) = 0, 'B no tiene emisor';
end $$;

-- ================= 3. conexión con Digifact: conectar, probar, interruptores, unicidad, bloqueo optimista
create temp table t_cred as select decode(repeat('ab', 40), 'hex') as c;
select pg_temp.espera_error($$select public.fel_op_digifact_conectar('00000000-0000-0000-0000-0000000000c4', '10000000-0000-0000-0000-00000000000a', '5888492', (select c from t_cred), 1::smallint, 0)$$, 'FEL_NO_AUTORIZADO');   -- el administrador no conecta
select pg_temp.espera_error($$select public.fel_op_digifact_conectar('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000a', '5888492', (select c from t_cred), 1::smallint, 0)$$, 'FEL_NO_AUTORIZADO');
select public.fel_op_digifact_conectar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', '5888492', (select c from t_cred), 1::smallint, 0);
select pg_temp.espera_error($$select public.fel_op_digifact_conectar('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000b', '5888492', (select c from t_cred), 1::smallint, 0)$$, '23505|unique|duplicate');   -- el NIT de Digifact no se comparte
select pg_temp.espera_error($$select public.fel_op_digifact_conectar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', '5888492', (select c from t_cred), 1::smallint, 0)$$, 'FEL_CONFLICTO');   -- versión vieja
select pg_temp.espera_error($$select public.fel_op_digifact_interruptores('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', true, false, false, false, 1)$$, 'FEL_REGLA');   -- aún sin prueba
select pg_temp.espera_error($$update public.empresa_digifact_config set certificar = true where empresa_id = '10000000-0000-0000-0000-00000000000a'$$, '23514|check|FEL_REGLA');
select pg_temp.espera_error($$select public.fel_op_digifact_registrar_prueba('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', true)$$, 'FEL_NO_AUTORIZADO');   -- el emisor no prueba
select public.fel_op_digifact_registrar_prueba('00000000-0000-0000-0000-0000000000c4', '10000000-0000-0000-0000-00000000000a', true);   -- el administrador sí
do $$ begin assert (select estado from public.empresa_digifact_config where empresa_id = '10000000-0000-0000-0000-00000000000a') = 'activo', 'activo tras la prueba'; end $$;
select public.fel_op_digifact_interruptores('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', true, true, true, true, (select version from public.empresa_digifact_config where empresa_id = '10000000-0000-0000-0000-00000000000a'));
do $$ begin
  assert (select certificar and consulta_nit and consulta_cui and correo_digifact from public.empresa_digifact_config where empresa_id = '10000000-0000-0000-0000-00000000000a'), 'interruptores encendidos';
  assert (select count(*) from public.fel_sys_digifact_credencial('10000000-0000-0000-0000-00000000000a')) = 1, 'el servicio lee la credencial de A';
  assert (select count(*) from public.fel_sys_digifact_credencial('10000000-0000-0000-0000-00000000000b')) = 0, 'B no tiene credencial';
  assert (select count(*) from public.empresa_digifact_eventos where empresa_id = '10000000-0000-0000-0000-00000000000a' and tipo = 'uso_credencial') = 1, 'el uso queda registrado';
  perform public.fel_sys_digifact_credencial('10000000-0000-0000-0000-00000000000a');
  assert (select count(*) from public.empresa_digifact_eventos where empresa_id = '10000000-0000-0000-0000-00000000000a' and tipo = 'uso_credencial') = 1, 'el registro de uso se limita a uno cada 10 minutos';
end $$;
-- reemplazar la credencial apaga todo y exige nueva prueba
select public.fel_op_digifact_conectar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', '5888492', (select c from t_cred), 2::smallint, (select version from public.empresa_digifact_config where empresa_id = '10000000-0000-0000-0000-00000000000a'));
do $$ begin assert (select estado = 'pendiente_prueba' and not certificar and not consulta_nit and not consulta_cui and not correo_digifact and ultima_prueba_ok is null from public.empresa_digifact_config where empresa_id = '10000000-0000-0000-0000-00000000000a'), 'reemplazo apaga todo'; end $$;
select public.fel_op_digifact_registrar_prueba('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', true);
-- suspender
select public.fel_op_digifact_suspender('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a');
do $$ begin assert (select estado = 'suspendido' and not certificar from public.empresa_digifact_config where empresa_id = '10000000-0000-0000-0000-00000000000a'), 'suspendido'; assert (select count(*) from public.fel_sys_digifact_credencial('10000000-0000-0000-0000-00000000000a')) = 0, 'suspendida: el servicio no entrega credencial'; end $$;
select public.fel_op_digifact_registrar_prueba('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', true);
-- el NIT no cambia tras la primera operación
create temp table t_est as select a from t_e10;
select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', null, 'NIT', '3333333-3', 'Cliente A1', null, null, null, null);
create temp table t_doc as select (public.fel_op_documento_guardar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', null,
  (select id from public.clientes where empresa_id = '10000000-0000-0000-0000-00000000000a' limit 1), current_date, 'prueba',
  jsonb_build_array(jsonb_build_object('orden', 1, 'descripcion', 'Servicio', 'cantidad', 2, 'precio_unitario', 10.5)), 21, 0, 21, '{"oficial":false}'::jsonb, null)).id as d;
insert into public.digifact_operaciones (id, empresa_id, documento_id, referencia, hash, huella_emisor, fecha_emision, establecimiento, total, estado, creada_ms, actualizada_ms, actor_id, intento_del_documento)
select gen_random_uuid(), '10000000-0000-0000-0000-00000000000a', d, gen_random_uuid(), 'hash-prueba-1', 'cccccccccccccccc', to_char(current_date, 'YYYY-MM-DD'), 1, '21', 'preparada', 1, 1, '00000000-0000-0000-0000-0000000000c1', 1 from t_doc;
select pg_temp.espera_error($$update public.empresa_digifact_config set digifact_nit = '5888493' where empresa_id = '10000000-0000-0000-0000-00000000000a'$$, 'FEL_REGLA');

-- ================= 4. RLS: lo que ve cada identidad
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');   -- propietario de A
do $$ begin
  assert (select count(*) from public.v_empresa_digifact_estado) = 1, 'el propietario ve la conexión de su empresa';
  assert (select estado from public.v_empresa_digifact_estado) = 'activo', 'estado visible';
  assert (select count(*) from public.empresa_emisor_versiones) = 2, 've sus versiones del emisor';
  assert (select count(*) from public.empresa_digifact_eventos) >= 4, 've los eventos de su empresa (con auditoria.ver)';
end $$;
select pg_temp.espera_error($$select credencial_cifrada from public.empresa_digifact_config$$, 'permission denied|42501');
select pg_temp.espera_error($$select * from public.empresa_digifact_config$$, 'permission denied|42501');
select pg_temp.espera_error($$select llave_version from public.v_empresa_digifact_estado$$, 'does not exist|42703');
select pg_temp.espera_error($$update public.empresa_digifact_config set certificar = false$$, 'permission denied|42501');
select pg_temp.espera_error($$insert into public.empresa_digifact_eventos (empresa_id, tipo) values ('10000000-0000-0000-0000-00000000000a', 'probar')$$, 'permission denied|42501');
select pg_temp.espera_error($$select public.fel_op_digifact_suspender('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a')$$, 'permission denied|42501');   -- ni el propietario ejecuta la función de servicio por la API
select pg_temp.espera_error($$select * from public.fel_sys_digifact_credencial('10000000-0000-0000-0000-00000000000a')$$, 'permission denied|42501');
select pg_temp.espera_error($$select * from public.acceso_maestro_datos$$, 'permission denied|42501');
select pg_temp.volver();
select pg_temp.como('00000000-0000-0000-0000-0000000000d1');   -- propietario de B: no ve nada de A
do $$ begin
  assert (select count(*) from public.v_empresa_digifact_estado) = 0, 'B no ve la conexión de A';
  assert (select count(*) from public.empresa_emisor_versiones) = 0, 'B no ve el emisor de A';
  assert (select count(*) from public.empresa_digifact_eventos) = 0, 'B no ve los eventos de A';
end $$;
select pg_temp.volver();
select pg_temp.como('00000000-0000-0000-0000-0000000000c2');   -- lector de A (tiene fiscal.ver pero no auditoria.ver)
do $$ begin assert (select count(*) from public.v_empresa_digifact_estado) >= 0, 'consulta ok'; assert (select count(*) from public.empresa_digifact_eventos) = 0, 'el lector no ve los eventos'; end $$;
select pg_temp.volver();
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');   -- MAESTRO con sus permisos ordinarios
do $$ begin
  assert (select count(*) from public.v_empresa_digifact_estado) = 0, 'el maestro no ve la conexión';
  assert (select count(*) from public.empresa_emisor_versiones) = 0, 'el maestro no ve el emisor';
  assert (select count(*) from public.empresa_digifact_eventos) = 0, 'el maestro no ve eventos';
  assert (select count(*) from public.documentos) = 0, 'el maestro no ve documentos';
  assert (select count(*) from public.clientes) = 0, 'el maestro no ve clientes';
end $$;
select pg_temp.espera_error($$select credencial_cifrada from public.empresa_digifact_config$$, 'permission denied|42501');
select pg_temp.espera_error($$select * from public.fel_admin_datos_excepcionales_documentos('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a')$$, 'permission denied|42501');   -- ni siquiera por la API
select pg_temp.volver();
select pg_temp.anonimo();
select pg_temp.espera_error($$select * from public.v_empresa_digifact_estado$$, 'permission denied|42501');
select pg_temp.espera_error($$select * from public.empresa_emisor_versiones$$, 'permission denied|42501');
select pg_temp.espera_error($$select * from public.empresa_digifact_eventos$$, 'permission denied|42501');
select pg_temp.volver();

-- ================= 5. los eventos son de solo alta y no admiten secretos
select pg_temp.espera_error($$update public.empresa_digifact_eventos set tipo = 'probar'$$, 'FEL_REGLA');
select pg_temp.espera_error($$delete from public.empresa_digifact_eventos$$, 'FEL_REGLA');
select pg_temp.espera_error($$insert into public.empresa_digifact_eventos (empresa_id, tipo, detalle) values ('10000000-0000-0000-0000-00000000000a', 'conectar', '{"password":"x"}')$$, '23514|check');
select pg_temp.espera_error($$insert into public.empresa_digifact_eventos (empresa_id, tipo, detalle) values ('10000000-0000-0000-0000-00000000000a', 'conectar', '{"usuario":"x"}')$$, '23514|check');

-- ================= 6. ningún registro contiene la credencial (ni su hexadecimal ni su base64)
do $$ declare v_hex text := repeat('ab', 40); v_b64 text := encode(decode(repeat('ab', 40), 'hex'), 'base64');
begin
  assert not exists (select 1 from public.auditoria where coalesce(datos::text, '') ilike '%' || v_hex || '%' or coalesce(datos::text, '') ilike '%' || left(v_b64, 20) || '%'), 'la auditoría no contiene la credencial';
  assert not exists (select 1 from public.empresa_digifact_eventos where detalle::text ilike '%' || v_hex || '%' or detalle::text ilike '%' || left(v_b64, 20) || '%'), 'los eventos no contienen la credencial';
  assert not exists (select 1 from public.auditoria where accion like 'digifact.%' and datos::text ~* '(password|contrasena|token|credencial)'), 'sin claves sensibles en la auditoría';
end $$;

-- ================= 7. acceso excepcional del maestro
select pg_temp.espera_error($$select public.fel_admin_acceso_solicitar('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'documentos', 'motivo corto', '00000000-0000-0000-0000-0000000000a2', 2)$$, '23514|check');
select pg_temp.espera_error($$select public.fel_admin_acceso_solicitar('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'documentos', 'Revisión por ticket 123 de soporte', '00000000-0000-0000-0000-0000000000a1', 2)$$, 'FEL_REGLA');   -- no se aprueba a sí mismo
select pg_temp.espera_error($$select public.fel_admin_acceso_solicitar('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'documentos', 'Revisión por ticket 123 de soporte', '00000000-0000-0000-0000-0000000000c1', 2)$$, 'FEL_REGLA');   -- el aprobador debe ser maestro
select pg_temp.espera_error($$select public.fel_admin_acceso_solicitar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', 'documentos', 'Revisión por ticket 123 de soporte', '00000000-0000-0000-0000-0000000000a2', 2)$$, 'FEL_NO_AUTORIZADO');   -- un propietario no se otorga acceso de maestro
select pg_temp.espera_error($$select public.fel_admin_acceso_solicitar('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'documentos', 'Revisión por ticket 123 de soporte', '00000000-0000-0000-0000-0000000000a2', 48)$$, 'FEL_REGLA');
select pg_temp.espera_error($$select * from public.fel_admin_datos_excepcionales_documentos('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a')$$, 'FEL_NO_AUTORIZADO');   -- sin permiso vigente
select pg_temp.espera_error($$select public.fel_admin_acceso_solicitar('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'credenciales', 'Revisión por ticket 123 de soporte', '00000000-0000-0000-0000-0000000000a2', 2)$$, '23514|check');   -- las credenciales nunca son alcance
create temp table t_acc as select (public.fel_admin_acceso_solicitar('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'documentos', 'Revisión por ticket 123 de soporte', '00000000-0000-0000-0000-0000000000a2', 2)).id as a;
do $$ begin
  assert (select count(*) from public.fel_admin_datos_excepcionales_documentos('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a')) >= 1, 'con permiso vigente lee los documentos de A';
  assert (select count(*) from public.auditoria where empresa_id = '10000000-0000-0000-0000-00000000000a' and accion = 'maestro.lectura_excepcional') = 1, 'la lectura queda en la auditoría de la empresa';
  assert (select count(*) from public.auditoria where empresa_id = '10000000-0000-0000-0000-00000000000a' and accion = 'maestro.acceso_excepcional.concedido') = 1, 'la concesión queda en la auditoría de la empresa';
end $$;
select pg_temp.espera_error($$select * from public.fel_admin_datos_excepcionales_documentos('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000b')$$, 'FEL_NO_AUTORIZADO');   -- no sirve para otra empresa
select pg_temp.espera_error($$select * from public.fel_admin_datos_excepcionales_documentos('00000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a')$$, 'FEL_NO_AUTORIZADO');   -- ni para otro maestro
select pg_temp.espera_error($$select public.fel_admin_datos_excepcionales_configuracion('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a')$$, 'FEL_NO_AUTORIZADO');   -- alcance distinto
select public.fel_admin_acceso_solicitar('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'configuracion', 'Revisión de la configuración por soporte', '00000000-0000-0000-0000-0000000000a2', 1);
do $$ declare j jsonb; begin
  j := public.fel_admin_datos_excepcionales_configuracion('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a');
  assert j -> 'digifact' ->> 'tiene_credencial' = 'true', 'indica que hay credencial';
  assert j::text !~* '(credencial_cifrada|llave_version|abababab)', 'la lectura excepcional JAMÁS devuelve la credencial';
  assert j -> 'emisores' -> 0 ->> 'huella' = 'cccccccccccccccc', 'devuelve el emisor aprobado';
end $$;
-- vence y se revoca
update public.acceso_maestro_datos set creada_en = now() - interval '3 hours', expira_en = now() - interval '1 hour' where id = (select a from t_acc);
select pg_temp.espera_error($$select * from public.fel_admin_datos_excepcionales_documentos('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a')$$, 'FEL_NO_AUTORIZADO');   -- vencido
create temp table t_acc2 as select (public.fel_admin_acceso_solicitar('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'documentos', 'Segunda revisión por ticket 124', '00000000-0000-0000-0000-0000000000a2', 1)).id as a;
select public.fel_admin_acceso_revocar('00000000-0000-0000-0000-0000000000a1', (select a from t_acc2));
select pg_temp.espera_error($$select * from public.fel_admin_datos_excepcionales_documentos('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a')$$, 'FEL_NO_AUTORIZADO');   -- revocado
select pg_temp.espera_error($$delete from public.acceso_maestro_datos$$, 'FEL_REGLA');
-- resumen ordinario: solo cantidades
do $$ declare r record; begin
  select * into r from public.fel_admin_empresas_resumen('00000000-0000-0000-0000-0000000000a1') where empresa_id = '10000000-0000-0000-0000-00000000000a';
  assert r.usuarios_activos = 4 and r.documentos_30d >= 1 and r.digifact_estado = 'activo', 'resumen con cantidades y estado';
end $$;
select pg_temp.espera_error($$select * from public.fel_admin_empresas_resumen('00000000-0000-0000-0000-0000000000c1')$$, 'FEL_NO_AUTORIZADO');

-- ================= 8. cerrojos
select pg_temp.espera_error($$update public.empresa_digifact_config set ambiente = 'produccion'$$, '23514|check');
select pg_temp.espera_error($$update public.empresa_digifact_config set credencial_cifrada = null where empresa_id = '10000000-0000-0000-0000-00000000000a'$$, '23514|check');   -- credencial y versión de llave van juntas

select 'PRUEBAS MULTIEMPRESA OK' as resultado;
rollback;
