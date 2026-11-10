-- Recuperación de acceso por pérdida del dispositivo TOTP: solicitud + verificación administrativa + aprobación por otra persona.
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_ok boolean := false;
begin
  begin execute p_sql; exception when others then v_ok := (sqlerrm ~ p_patron) or (sqlstate ~ p_patron); end;
  if not v_ok then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if;
end $$;

-- m1,m2 maestros · p1 propietario de A · e1 emisor de A · p2 propietario de B · x sin factor · b bloqueado · o propietario de A (segundo)
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'maestro1@fel.test', now()), ('00000000-0000-0000-0000-0000000000a2', 'maestro2@fel.test', now()),
  ('00000000-0000-0000-0000-0000000000b1', 'prop1@fel.test', now()), ('00000000-0000-0000-0000-0000000000b2', 'emisor1@fel.test', now()),
  ('00000000-0000-0000-0000-0000000000b3', 'propB@fel.test', now()), ('00000000-0000-0000-0000-0000000000b4', 'sinfactor@fel.test', now()),
  ('00000000-0000-0000-0000-0000000000b5', 'bloqueado@fel.test', now()), ('00000000-0000-0000-0000-0000000000b6', 'prop1bis@fel.test', now()),
  ('00000000-0000-0000-0000-0000000000b7', 'lector1@fel.test', now());
insert into public.perfiles (user_id, activo) select id, id <> '00000000-0000-0000-0000-0000000000b5' from auth.users;
insert into public.plataforma_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000a2');
insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at)
select gen_random_uuid(), id, 'totp', 'verified', now(), now() from auth.users where id <> '00000000-0000-0000-0000-0000000000b4';
insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id, estado)
select e.id, e.n, e.n || ' S.A.', e.nit, r.id, 'habilitada'
  from (values ('10000000-0000-0000-0000-00000000000a'::uuid, 'Empresa A', '1111111-1'), ('10000000-0000-0000-0000-00000000000b'::uuid, 'Empresa B', '2222222-2')) e(id, n, nit),
       public.regimenes_fiscales r where r.codigo = 'general';
insert into public.miembros (empresa_id, user_id, rol) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b1', 'propietario'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b6', 'propietario'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b2', 'emisor'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b7', 'lector'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b3', 'propietario');

-- ================= solicitar
select pg_temp.espera_error($$select public.fel_op_mfa_recuperacion_solicitar('00000000-0000-0000-0000-0000000000b4', 'Perdí mi teléfono con la app')$$, 'no hay nada que recuperar|no tiene verificación');
select pg_temp.espera_error($$select public.fel_op_mfa_recuperacion_solicitar('00000000-0000-0000-0000-0000000000b5', 'Perdí mi teléfono con la app')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_mfa_recuperacion_solicitar(gen_random_uuid(), 'Perdí mi teléfono con la app')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_mfa_recuperacion_solicitar('00000000-0000-0000-0000-0000000000b2', 'corto')$$, 'explica lo ocurrido');
create temp table t_sol as select public.fel_op_mfa_recuperacion_solicitar('00000000-0000-0000-0000-0000000000b2', 'Perdí mi teléfono con la app autenticadora') as id;
select pg_temp.espera_error($$select public.fel_op_mfa_recuperacion_solicitar('00000000-0000-0000-0000-0000000000b2', 'Otra solicitud mientras hay una abierta')$$, 'FEL_CONFLICTO|en curso');
-- el MFA NO se toca por solicitar: el factor sigue ahí
do $$ begin assert exists (select 1 from auth.mfa_factors where user_id = '00000000-0000-0000-0000-0000000000b2' and status::text = 'verified'), 'solicitar eliminó el factor'; end $$;

-- ================= quién puede ver y resolver
do $$ begin
  assert exists (select 1 from public.fel_op_mfa_recuperacion_listar('00000000-0000-0000-0000-0000000000b1')), 'el propietario de A debe ver la solicitud de su emisor';
  assert exists (select 1 from public.fel_op_mfa_recuperacion_listar('00000000-0000-0000-0000-0000000000b6')), 'el otro propietario de A también';
  assert exists (select 1 from public.fel_op_mfa_recuperacion_listar('00000000-0000-0000-0000-0000000000a1')), 'un maestro debe verla';
  assert not exists (select 1 from public.fel_op_mfa_recuperacion_listar('00000000-0000-0000-0000-0000000000b3')), 'el propietario de OTRA empresa no la ve';
  assert not exists (select 1 from public.fel_op_mfa_recuperacion_listar('00000000-0000-0000-0000-0000000000b7')), 'un lector no resuelve';
  assert not exists (select 1 from public.fel_op_mfa_recuperacion_listar('00000000-0000-0000-0000-0000000000b2')), 'nadie ve su propia solicitud como resolutor';
end $$;
select pg_temp.espera_error($$select public.fel_op_mfa_recuperacion_aprobar('00000000-0000-0000-0000-0000000000b2', (select id from t_sol), 'Me verifiqué a mí mismo con mi propia cuenta')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_mfa_recuperacion_aprobar('00000000-0000-0000-0000-0000000000b3', (select id from t_sol), 'Propietario de otra empresa sin relación alguna')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_mfa_recuperacion_aprobar('00000000-0000-0000-0000-0000000000b7', (select id from t_sol), 'Un lector que quiere resolver la solicitud')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_mfa_recuperacion_aprobar('00000000-0000-0000-0000-0000000000b5', (select id from t_sol), 'Cuenta bloqueada intentando resolver la solicitud')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_mfa_recuperacion_aprobar(null, (select id from t_sol), 'Actor nulo intentando resolver la solicitud')$$, 'FEL_NO_AUTORIZADO');
-- sin evidencia de la verificación de identidad no se aprueba
select pg_temp.espera_error($$select public.fel_op_mfa_recuperacion_aprobar('00000000-0000-0000-0000-0000000000b1', (select id from t_sol), 'ok')$$, 'cómo verificaste');
select pg_temp.espera_error($$select public.fel_op_mfa_recuperacion_aprobar('00000000-0000-0000-0000-0000000000b1', (select id from t_sol), null)$$, 'cómo verificaste');
do $$ begin assert (select estado from public.solicitudes_recuperacion_mfa where id = (select id from t_sol)) = 'pendiente', 'cambió de estado sin evidencia'; end $$;
-- el cierre no se puede forzar sin aprobación ni mientras queden factores
select pg_temp.espera_error($$select public.fel_op_mfa_recuperacion_cerrar('00000000-0000-0000-0000-0000000000b1', (select id from t_sol), 1)$$, 'no está aprobada');

-- ================= aprobar → la API elimina los factores → cerrar
create temp table t_apr as select public.fel_op_mfa_recuperacion_aprobar('00000000-0000-0000-0000-0000000000b1', (select id from t_sol), 'Videollamada con cédula en mano; se confirmó la identidad y el cargo') as r;
do $$ declare r jsonb := (select r from t_apr); begin
  assert (r ->> 'user_id') = '00000000-0000-0000-0000-0000000000b2' and jsonb_array_length(r -> 'factores') = 1, 'debe devolver el usuario y su factor';
  assert exists (select 1 from public.auditoria where accion = 'plataforma.mfa_recuperacion_aprobada' and actor_user_id = '00000000-0000-0000-0000-0000000000b1' and datos ? 'verificacion'), 'sin auditoría con la evidencia';
end $$;
select pg_temp.espera_error($$select public.fel_op_mfa_recuperacion_cerrar('00000000-0000-0000-0000-0000000000b1', (select id from t_sol), 0)$$, 'quedan factores');
-- repetible: si el borrado falló, aprobar de nuevo devuelve los factores que aún existen
do $$ begin assert jsonb_array_length((public.fel_op_mfa_recuperacion_aprobar('00000000-0000-0000-0000-0000000000b6', (select id from t_sol), null)) -> 'factores') = 1, 'repetir no devolvió el factor'; end $$;
delete from auth.mfa_factors where user_id = '00000000-0000-0000-0000-0000000000b2';   -- lo que hace la API de administración de Auth
select public.fel_op_mfa_recuperacion_cerrar('00000000-0000-0000-0000-0000000000b1', (select id from t_sol), 1);
do $$ begin
  assert (select estado from public.solicitudes_recuperacion_mfa where id = (select id from t_sol)) = 'ejecutada';
  assert exists (select 1 from public.auditoria where accion = 'plataforma.mfa_recuperacion_ejecutada'), 'sin auditoría de la ejecución';
end $$;
select pg_temp.espera_error($$select public.fel_op_mfa_recuperacion_aprobar('00000000-0000-0000-0000-0000000000b1', (select id from t_sol), 'Intento de reutilizar una solicitud ya ejecutada')$$, 'ya está ejecutada');

-- ================= rechazar y vencer
create temp table t_sol2 as select public.fel_op_mfa_recuperacion_solicitar('00000000-0000-0000-0000-0000000000b7', 'Perdí el dispositivo en un viaje reciente') as id;
select pg_temp.espera_error($$select public.fel_op_mfa_recuperacion_rechazar('00000000-0000-0000-0000-0000000000b3', (select id from t_sol2), 'Sin relación con la empresa')$$, 'FEL_NO_AUTORIZADO');
select public.fel_op_mfa_recuperacion_rechazar('00000000-0000-0000-0000-0000000000b1', (select id from t_sol2), 'No se pudo verificar la identidad');
select pg_temp.espera_error($$select public.fel_op_mfa_recuperacion_aprobar('00000000-0000-0000-0000-0000000000b1', (select id from t_sol2), 'Aprobar una solicitud que ya fue rechazada')$$, 'ya está rechazada');
do $$ begin assert exists (select 1 from auth.mfa_factors where user_id = '00000000-0000-0000-0000-0000000000b7'), 'rechazar eliminó el factor'; end $$;
insert into public.solicitudes_recuperacion_mfa (user_id, motivo, solicitada_en, expira_en) values ('00000000-0000-0000-0000-0000000000b6', 'Solicitud antigua que ya venció', now() - interval '5 days', now() - interval '2 days');
create temp table t_venc as select id from public.solicitudes_recuperacion_mfa where user_id = '00000000-0000-0000-0000-0000000000b6';
do $$ begin assert not exists (select 1 from public.fel_op_mfa_recuperacion_listar('00000000-0000-0000-0000-0000000000a1') where id = (select id from t_venc)), 'una solicitud vencida se lista'; end $$;
select pg_temp.espera_error($$select public.fel_op_mfa_recuperacion_aprobar('00000000-0000-0000-0000-0000000000a1', (select id from t_venc), 'Aprobar una solicitud vencida hace días')$$, 'venció');

-- ================= jerarquía: un maestro solo lo resuelve otro maestro; un propietario no puede con un maestro
create temp table t_sol3 as select public.fel_op_mfa_recuperacion_solicitar('00000000-0000-0000-0000-0000000000a2', 'Perdí el dispositivo del administrador maestro') as id;
select pg_temp.espera_error($$select public.fel_op_mfa_recuperacion_aprobar('00000000-0000-0000-0000-0000000000b1', (select id from t_sol3), 'Un propietario intenta resolver a un maestro')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_mfa_recuperacion_aprobar('00000000-0000-0000-0000-0000000000a2', (select id from t_sol3), 'El maestro intenta aprobarse a sí mismo')$$, 'FEL_NO_AUTORIZADO');
do $$ begin assert jsonb_array_length((public.fel_op_mfa_recuperacion_aprobar('00000000-0000-0000-0000-0000000000a1', (select id from t_sol3), 'Verificación presencial por el otro administrador maestro')) -> 'factores') = 1, 'otro maestro debía poder'; end $$;
-- ruta de emergencia: solo registra
select pg_temp.espera_error($$select public.fel_registrar_recuperacion_manual('maestro1@fel.test', 'corto')$$, 'verificación realizada');
do $$ begin
  perform public.fel_registrar_recuperacion_manual('maestro1@fel.test', 'Verificación presencial con acta firmada y dos testigos');
  assert exists (select 1 from public.auditoria where accion = 'plataforma.mfa_recuperacion_manual'), 'sin registro';
  assert exists (select 1 from auth.mfa_factors where user_id = '00000000-0000-0000-0000-0000000000a1'), 'la función manual no debe tocar factores';
end $$;

rollback;
\echo 'OK 12_mfa_recuperacion'
