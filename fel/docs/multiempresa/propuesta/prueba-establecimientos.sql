-- Pruebas SQL del establecimiento asignado y bloqueado por usuario (M-F), con dos establecimientos de la empresa A (códigos de PRUEBA 10 y 20; los reales de Digifact TEST se identifican aparte), un supervisor, un usuario de otra empresa y
-- accesos directos a las funciones. Se ejecuta en un PostgreSQL temporal; termina con ROLLBACK.
\set ON_ERROR_STOP on
begin;
create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_ok boolean := false;
begin begin execute p_sql; exception when others then v_ok := (sqlerrm ~ p_patron) or (sqlstate ~ p_patron); end;
  if not v_ok then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if; end $$;
create or replace function pg_temp.como(p_uid text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', p_uid, true); perform set_config('role', 'authenticated', true); end $$;
create or replace function pg_temp.anonimo() returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', '', true); perform set_config('role', 'anon', true); end $$;
create or replace function pg_temp.volver() returns void language plpgsql as $$ begin perform set_config('role', 'postgres', true); end $$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'maestro@fel.test'), ('00000000-0000-0000-0000-0000000000c1', 'propA@fel.test'), ('00000000-0000-0000-0000-0000000000c4', 'adminA@fel.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'factA@fel.test'), ('00000000-0000-0000-0000-0000000000c5', 'factB@fel.test'), ('00000000-0000-0000-0000-0000000000c6', 'superv@fel.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'lectorA@fel.test'), ('00000000-0000-0000-0000-0000000000d1', 'propB@fel.test'), ('00000000-0000-0000-0000-0000000000d2', 'factEmpB@fel.test');
insert into public.perfiles (user_id) select id from auth.users on conflict (user_id) do nothing;
insert into public.plataforma_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1');
insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id, estado)
select e.id, e.n, e.n || ' S.A.', e.nit, r.id, 'habilitada' from (values ('10000000-0000-0000-0000-00000000000a'::uuid, 'Empresa A', '1111111-1'), ('10000000-0000-0000-0000-00000000000b'::uuid, 'Empresa B', '2222222-2')) e(id, n, nit),
  public.regimenes_fiscales r where r.codigo = 'general';
insert into public.miembros (empresa_id, user_id, rol) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 'propietario'), ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c4', 'administrador'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', 'emisor'), ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c5', 'emisor'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c6', 'emisor'), ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c2', 'lector'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000d1', 'propietario'), ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000d2', 'emisor');
create temp table t_e as select
  (public.fel_op_establecimiento_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, '10', 'Sucursal 10', 'Dirección 10', 'activo')).id e10,
  (public.fel_op_establecimiento_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, '20', 'Sucursal 20', 'Dirección 20', 'activo')).id e20,
  (public.fel_op_establecimiento_guardar('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000b', null, '10', 'Sucursal B', 'Dirección B', 'activo')).id eb;
select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, 'NIT', '3333333-3', 'Cliente A', null, null, null, null);
select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000b', null, 'NIT', '5555555-5', 'Cliente B', null, null, null, null);
create temp table t_cli as select (select id from public.clientes where empresa_id = '10000000-0000-0000-0000-00000000000a' limit 1) a, (select id from public.clientes where empresa_id = '10000000-0000-0000-0000-00000000000b' limit 1) b;
create or replace function pg_temp.doc(p_actor text, p_emp text, p_cli uuid, p_id uuid default null, p_ver integer default null) returns uuid language plpgsql as $$
begin return (public.fel_op_documento_guardar(p_actor::uuid, p_emp::uuid, p_id, p_cli, current_date, 'prueba', jsonb_build_array(jsonb_build_object('orden', 1, 'descripcion', 'Servicio', 'cantidad', 2, 'precio_unitario', 10.5)), 21, 0, 21, '{"oficial":false}'::jsonb, p_ver)).id; end $$;
create or replace function pg_temp.est_de(p_doc uuid) returns uuid language sql as $$ select establecimiento_id from public.documentos where id = p_doc $$;

-- ================= 0. valores por omisión: interruptor APAGADO = comportamiento actual (el navegador elige; sin asignaciones nada cambia)
do $$ begin
  assert (select valor from public.plataforma_parametros where clave = 'establecimiento_por_usuario') = 0, 'apagado por defecto';
  assert not exists (select 1 from public.rol_permisos where permiso = 'establecimientos.multiples'), 'ningún rol incluye «multiples»: no se concede automáticamente';
  assert not exists (select 1 from public.miembros where 'establecimientos.multiples' = any (permisos_extra)), 'ningún miembro nuevo lo tiene';
end $$;
create temp table t_d0 as select pg_temp.doc('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select a from t_cli)) d;
select public.fel_op_documento_establecimiento('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select d from t_d0), (select e20 from t_e));
do $$ begin assert pg_temp.est_de((select d from t_d0)) = (select e20 from t_e), 'con el interruptor apagado el comportamiento es el de siempre'; end $$;

-- ================= 1. se enciende el interruptor y se asigna
update public.plataforma_parametros set valor = 1 where clave = 'establecimiento_por_usuario';
select pg_temp.espera_error($$select public.fel_op_asignacion_guardar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', (select e10 from t_e), true, 'x')$$, 'FEL_NO_AUTORIZADO');   -- un facturador no se asigna
select pg_temp.espera_error($$select public.fel_op_asignacion_guardar('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', (select e10 from t_e), true, 'x')$$, 'FEL_NO_AUTORIZADO');   -- otra empresa no asigna en A
select pg_temp.espera_error($$select public.fel_op_asignacion_guardar('00000000-0000-0000-0000-0000000000c4', '10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', (select eb from t_e), true, 'x')$$, 'FEL_REGLA');   -- establecimiento de otra empresa
select pg_temp.espera_error($$select public.fel_op_asignacion_guardar('00000000-0000-0000-0000-0000000000c4', '10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000d1', (select e10 from t_e), true, 'x')$$, 'FEL_REGLA');   -- usuario de otra empresa
select public.fel_op_asignacion_guardar('00000000-0000-0000-0000-0000000000c4', '10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', (select e10 from t_e), true, 'alta');   -- A → 10
select public.fel_op_asignacion_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c5', (select e20 from t_e), true, 'alta');   -- B → 20
select public.fel_op_asignacion_guardar('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000d2', (select eb from t_e), true, 'alta');   -- otra empresa
do $$ begin
  assert public.fel_alcance('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3') = jsonb_build_object('todos', false, 'multiples', false, 'ids', jsonb_build_array((select e10 from t_e))), 'A solo el 10';
  assert (public.fel_alcance('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c4') ->> 'todos') = 'true', 'administrador: todos';
  assert (public.fel_alcance('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1') ->> 'todos') = 'true', 'propietario: todos';
  assert (select count(*) from public.auditoria where accion = 'usuario.establecimiento') = 3, 'cada asignación queda auditada';
end $$;
-- un facturador sin permiso de supervisión no puede tener dos asignaciones activas, ni siquiera por SQL directo (la restricción es de la base)
select pg_temp.espera_error($$insert into public.usuario_establecimientos (empresa_id, user_id, establecimiento_id, predeterminado, creado_por) values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', (select e20 from t_e), false, '00000000-0000-0000-0000-0000000000c4'); set constraints all immediate$$, 'FEL_REGLA');
select pg_temp.espera_error($$insert into public.usuario_establecimientos (empresa_id, user_id, establecimiento_id, creado_por) values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000d2', (select e20 from t_e), '00000000-0000-0000-0000-0000000000c4')$$, '23503|foreign key');   -- un usuario de B jamás se asigna a un establecimiento de A

-- ================= 2. supervisor: permiso adicional EXPRESO (no automático) y no para un lector
select pg_temp.espera_error($$update public.miembros set permisos_extra = array['establecimientos.multiples'] where user_id = '00000000-0000-0000-0000-0000000000c2'$$, 'FEL_REGLA');   -- lector: no
update public.miembros set permisos_extra = array['establecimientos.multiples'] where user_id = '00000000-0000-0000-0000-0000000000c6';
select public.fel_op_asignacion_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c6', (select e10 from t_e), true, 'supervisor');
select public.fel_op_asignacion_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c6', (select e20 from t_e), false, 'supervisor');
do $$ begin
  assert jsonb_array_length(public.fel_alcance('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c6') -> 'ids') = 2, 'el supervisor tiene ambos';
  assert (public.fel_alcance('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c6') -> 'ids' ->> 0)::uuid = (select e10 from t_e), 'su predeterminado va primero';
end $$;

-- ================= 3. creación: el servidor/base fija el establecimiento asignado; rechaza (no cambia en silencio) uno ajeno
create temp table t_da as select pg_temp.doc('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select a from t_cli)) d;
create temp table t_db as select pg_temp.doc('00000000-0000-0000-0000-0000000000c5', '10000000-0000-0000-0000-00000000000a', (select a from t_cli)) d;
create temp table t_ds as select pg_temp.doc('00000000-0000-0000-0000-0000000000c6', '10000000-0000-0000-0000-00000000000a', (select a from t_cli)) d;
create temp table t_dp as select pg_temp.doc('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select a from t_cli)) d;
grant select on t_e, t_cli, t_da, t_db, t_ds, t_dp to public;   -- las comprobaciones con identidades reales (rol authenticated) leen estos identificadores
do $$ begin
  assert pg_temp.est_de((select d from t_da)) = (select e10 from t_e), 'A: documento nuevo nace en SU establecimiento 10, sin elegirlo';
  assert pg_temp.est_de((select d from t_db)) = (select e20 from t_e), 'B: documento nuevo nace en el 20';
  assert pg_temp.est_de((select d from t_ds)) = (select e10 from t_e), 'supervisor: nace en su predeterminado';
  assert pg_temp.est_de((select d from t_dp)) is null, 'propietario: sin establecimiento hasta que lo elija (alcance total)';
end $$;
select pg_temp.espera_error($$select public.fel_op_documento_establecimiento('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select d from t_da), (select e20 from t_e))$$, 'FEL_REGLA');   -- A intenta el 20: rechazado, no cambiado
select pg_temp.espera_error($$select public.fel_op_documento_establecimiento('00000000-0000-0000-0000-0000000000c5', '10000000-0000-0000-0000-00000000000a', (select d from t_db), (select e10 from t_e))$$, 'FEL_REGLA');
select public.fel_op_documento_establecimiento('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select d from t_da), (select e10 from t_e));   -- el propio: idempotente
select public.fel_op_documento_establecimiento('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select d from t_dp), (select e20 from t_e));   -- propietario elige
select pg_temp.espera_error($$select public.fel_op_documento_establecimiento('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', (select d from t_dp), (select e10 from t_e))$$, 'FEL_REGLA');   -- ni siquiera el propietario lo cambia después
do $$ begin assert pg_temp.est_de((select d from t_da)) = (select e10 from t_e) and pg_temp.est_de((select d from t_db)) = (select e20 from t_e), 'los rechazos no cambiaron nada'; end $$;
select pg_temp.espera_error($$select pg_temp.doc('00000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-00000000000a', (select a from t_cli))$$, 'FEL_NO_AUTORIZADO');   -- el lector no crea
select pg_temp.espera_error($$select public.fel_op_documento_establecimiento('00000000-0000-0000-0000-0000000000d2', '10000000-0000-0000-0000-00000000000a', (select d from t_da), (select e10 from t_e))$$, 'FEL_NO_AUTORIZADO');   -- usuario de otra empresa
-- un facturador SIN establecimiento asignado no crea documentos (falla cerrado)
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c7', 'sinasig@fel.test'); insert into public.perfiles (user_id) values ('00000000-0000-0000-0000-0000000000c7');
insert into public.miembros (empresa_id, user_id, rol) values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c7', 'emisor');
select pg_temp.espera_error($$select pg_temp.doc('00000000-0000-0000-0000-0000000000c7', '10000000-0000-0000-0000-00000000000a', (select a from t_cli))$$, 'sin un establecimiento|no tiene un establecimiento');

-- ================= 4. acceso: nadie modifica documentos de un establecimiento fuera de su alcance (defensa en la base)
select pg_temp.espera_error($$select pg_temp.doc('00000000-0000-0000-0000-0000000000c5', '10000000-0000-0000-0000-00000000000a', (select a from t_cli), (select d from t_da), (select version from public.documentos where id = (select d from t_da)))$$, 'fuera del alcance');   -- B edita un documento del 10
select pg_temp.espera_error($$select public.fel_op_documento_preparacion('00000000-0000-0000-0000-0000000000c5', '10000000-0000-0000-0000-00000000000a', (select d from t_da), 'revisado', null, (select version from public.documentos where id = (select d from t_da)))$$, 'FEL_NO_AUTORIZADO|FEL_REGLA|fuera del alcance');
select pg_temp.espera_error($$update public.documentos set establecimiento_id = (select e20 from t_e) where id = (select d from t_da)$$, 'FEL_REGLA');   -- ni por SQL directo
select pg_temp.doc('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select a from t_cli), (select d from t_da), (select version from public.documentos where id = (select d from t_da)));   -- A sí edita el suyo
select pg_temp.doc('00000000-0000-0000-0000-0000000000c6', '10000000-0000-0000-0000-00000000000a', (select a from t_cli), (select d from t_db), (select version from public.documentos where id = (select d from t_db)));   -- el supervisor edita ambos
select pg_temp.doc('00000000-0000-0000-0000-0000000000c4', '10000000-0000-0000-0000-00000000000a', (select a from t_cli), (select d from t_da), (select version from public.documentos where id = (select d from t_da)));   -- administrador: todos

-- ================= 5. lectura por la API de datos (identidades reales): cada quien ve solo lo de su alcance
select pg_temp.como('00000000-0000-0000-0000-0000000000c3');
do $$ begin
  assert (select count(*) from public.documentos) >= 1 and not exists (select 1 from public.documentos where establecimiento_id is distinct from (select e10 from t_e)), 'A ve solo documentos del 10';
  assert (select count(*) from public.usuario_establecimientos) = 1, 'A ve solo su asignación';
end $$;
select pg_temp.espera_error($$insert into public.usuario_establecimientos (empresa_id, user_id, establecimiento_id, creado_por) values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', gen_random_uuid(), '00000000-0000-0000-0000-0000000000c3')$$, 'permission denied|42501');
select pg_temp.espera_error($$select public.fel_op_asignacion_guardar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', gen_random_uuid(), true, 'x')$$, 'permission denied|42501');
select pg_temp.volver();
select pg_temp.como('00000000-0000-0000-0000-0000000000c5');
do $$ begin assert not exists (select 1 from public.documentos where establecimiento_id is distinct from (select e20 from t_e)) and (select count(*) from public.documentos) >= 1, 'B ve solo el 20'; end $$;
select pg_temp.volver();
select pg_temp.como('00000000-0000-0000-0000-0000000000c6');
do $$ begin assert (select count(distinct establecimiento_id) from public.documentos) = 2, 'el supervisor ve ambos'; end $$;
select pg_temp.volver();
select pg_temp.como('00000000-0000-0000-0000-0000000000c4');
do $$ begin assert (select count(*) from public.usuario_establecimientos) >= 4, 'el administrador ve todas las asignaciones de su empresa'; assert (select count(*) from public.documentos) >= 4, 'el administrador ve todos los documentos'; end $$;
select pg_temp.volver();
select pg_temp.como('00000000-0000-0000-0000-0000000000d2');   -- usuario de OTRA empresa
do $$ begin assert (select count(*) from public.documentos where empresa_id = '10000000-0000-0000-0000-00000000000a') = 0 and (select count(*) from public.usuario_establecimientos where empresa_id = '10000000-0000-0000-0000-00000000000a') = 0, 'la otra empresa no ve nada de A'; end $$;
select pg_temp.volver();
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');   -- maestro con permisos ordinarios
do $$ begin assert (select count(*) from public.documentos) = 0 and (select count(*) from public.usuario_establecimientos) = 0, 'el maestro no ve documentos ni asignaciones'; end $$;
select pg_temp.volver();
select pg_temp.anonimo();
select pg_temp.espera_error($$select * from public.usuario_establecimientos$$, 'permission denied|42501');
select pg_temp.volver();

-- ================= 6. reasignación: el historial no cambia; el nuevo alcance rige; los borradores pendientes se rescatan SOLO con un traslado explícito y auditado
create temp table t_hist as select d, pg_temp.est_de(d) e from (select (select d from t_da) d) x;
select public.fel_op_asignacion_guardar('00000000-0000-0000-0000-0000000000c4', '10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', (select e20 from t_e), true, 'cambio de sucursal');   -- A pasa al 20
do $$ begin
  assert pg_temp.est_de((select d from t_da)) = (select e from t_hist), 'el documento histórico conserva su establecimiento';
  assert (select count(*) from public.usuario_establecimientos where user_id = '00000000-0000-0000-0000-0000000000c3' and revocado_en is null) = 1, 'queda UNA asignación activa';
  assert (select count(*) from public.usuario_establecimientos where user_id = '00000000-0000-0000-0000-0000000000c3' and revocado_en is not null and motivo = 'cambio de sucursal') = 1, 'la anterior queda revocada (historial), no borrada';
  assert not public.fel_en_alcance('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', (select e10 from t_e)), 'ya no tiene alcance sobre el 10';
end $$;
select pg_temp.espera_error($$select pg_temp.doc('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select a from t_cli), (select d from t_da), (select version from public.documentos where id = (select d from t_da)))$$, 'FEL_REGLA|fuera del alcance');   -- su borrador del 10 ya no es suyo
select pg_temp.como('00000000-0000-0000-0000-0000000000c3');
do $$ begin assert not exists (select 1 from public.documentos where id = (select d from t_da)), 'ni lo lee por la API de datos'; end $$;
select pg_temp.volver();
create temp table t_dn as select pg_temp.doc('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select a from t_cli)) d;
do $$ begin assert pg_temp.est_de((select d from t_dn)) = (select e20 from t_e), 'los documentos nuevos nacen en el establecimiento nuevo'; end $$;
select pg_temp.espera_error($$select public.fel_op_borrador_trasladar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select d from t_da), (select e20 from t_e), 'motivo largo suficiente')$$, 'FEL_NO_AUTORIZADO');   -- un facturador no traslada
select pg_temp.espera_error($$select public.fel_op_borrador_trasladar('00000000-0000-0000-0000-0000000000c4', '10000000-0000-0000-0000-00000000000a', (select d from t_da), (select e20 from t_e), 'corto')$$, 'FEL_REGLA');
select public.fel_op_borrador_trasladar('00000000-0000-0000-0000-0000000000c4', '10000000-0000-0000-0000-00000000000a', (select d from t_da), (select e20 from t_e), 'Reasignación de A al establecimiento 20');
do $$ begin assert pg_temp.est_de((select d from t_da)) = (select e20 from t_e), 'borrador trasladado'; assert (select count(*) from public.auditoria where accion = 'documento.borrador_trasladado') = 1, 'traslado auditado'; end $$;
select public.fel_op_documento_preparacion('00000000-0000-0000-0000-0000000000c4', '10000000-0000-0000-0000-00000000000a', (select d from t_db), 'revisado', null, (select version from public.documentos where id = (select d from t_db)));
select pg_temp.espera_error($$select public.fel_op_borrador_trasladar('00000000-0000-0000-0000-0000000000c4', '10000000-0000-0000-0000-00000000000a', (select d from t_db), (select e10 from t_e), 'Intento de mover un revisado')$$, 'FEL_REGLA');   -- lo revisado ya es historia

-- ================= 7. interruptor apagado de nuevo: sin efecto sobre los documentos (compatibilidad)
update public.plataforma_parametros set valor = 0 where clave = 'establecimiento_por_usuario';
do $$ begin assert pg_temp.doc('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select a from t_cli)) is not null, 'apagado: se crea como antes'; end $$;
select 'PRUEBAS ESTABLECIMIENTOS OK' as resultado;
rollback;
