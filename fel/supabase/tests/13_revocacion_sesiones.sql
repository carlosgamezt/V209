-- Marca de revocación de sesiones tras recuperar el MFA; fallos parciales de eliminación de factores sin duplicar operaciones.
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_ok boolean := false;
begin
  begin execute p_sql; exception when others then v_ok := (sqlerrm ~ p_patron) or (sqlstate ~ p_patron); end;
  if not v_ok then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if;
end $$;

-- p1 propietario de A · e1 emisor (pierde el dispositivo) · l1 lector (no afectado) · m1 maestro
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000b1', 'prop1@fel.test', now()), ('00000000-0000-0000-0000-0000000000b2', 'emisor1@fel.test', now()),
  ('00000000-0000-0000-0000-0000000000b3', 'lector1@fel.test', now()), ('00000000-0000-0000-0000-0000000000a1', 'maestro1@fel.test', now());
insert into public.perfiles (user_id) select id from auth.users;
insert into public.plataforma_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1');
insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at)
select gen_random_uuid(), id, 'totp', 'verified', now(), now() from auth.users;
insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000b2', 'totp', 'unverified', now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000b2', 'totp', 'verified', now(), now());   -- e1 tiene 3 factores
insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id, estado)
select '10000000-0000-0000-0000-00000000000a', 'A', 'A S.A.', '1111111-1', id, 'habilitada' from public.regimenes_fiscales where codigo = 'general';
insert into public.miembros (empresa_id, user_id, rol) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b1', 'propietario'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b2', 'emisor'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b3', 'lector');
select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000a', null, 'NIT', '3333333-3', 'Cliente', null, null, null, null);
insert into auth.sessions (user_id) values ('00000000-0000-0000-0000-0000000000b2'), ('00000000-0000-0000-0000-0000000000b2'), ('00000000-0000-0000-0000-0000000000b3');

-- ================= sin marca de revocación, el token vale (aunque no traiga amr)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true) as _cfg \gset
do $$ begin assert public.fel_tiene_permiso('10000000-0000-0000-0000-00000000000a', 'clientes.ver'), 'sin marca debe valer'; assert (select count(*) from public.clientes) = 1, 'el emisor lee sus clientes'; end $$;
reset role;

-- ================= solicitud y aprobación: fija la marca y borra sesiones ANTES de tocar los factores
create temp table t_sol as select public.fel_op_mfa_recuperacion_solicitar('00000000-0000-0000-0000-0000000000b2', 'Perdí el teléfono con la aplicación autenticadora') as id;
create temp table t_ap1 as select public.fel_op_mfa_recuperacion_aprobar('00000000-0000-0000-0000-0000000000b1', (select id from t_sol), 'Videollamada con documento en mano; confirmé identidad y cargo') as r;
do $$ declare r jsonb := (select r from t_ap1); begin
  assert jsonb_array_length(r -> 'factores') = 3 and (r ->> 'total')::int = 3, 'debía devolver los 3 factores y total 3';
  assert (select desde from public.revocaciones_sesion where user_id = '00000000-0000-0000-0000-0000000000b2') is not null, 'sin marca de revocación';
  assert public.fel_sesion_revocada_desde('00000000-0000-0000-0000-0000000000b2') is not null, 'la API no ve la marca';
  assert public.fel_sesion_revocada_desde('00000000-0000-0000-0000-0000000000b3') is null, 'la marca afectó a otra persona';
  assert (select count(*) from auth.sessions where user_id = '00000000-0000-0000-0000-0000000000b2') = 0, 'no se borraron las sesiones de Auth de la persona';
  assert (select count(*) from auth.sessions where user_id = '00000000-0000-0000-0000-0000000000b3') = 1, 'se borraron sesiones de otra persona';
  assert exists (select 1 from public.auditoria where accion = 'plataforma.mfa_recuperacion_aprobada' and (datos ->> 'factores')::int = 3), 'sin auditoría con el total';
end $$;

-- ================= efecto en la RLS: los tokens ANTERIORES a la marca no valen, aunque se renueven (amr no cambia); uno nuevo sí
create temp table t_marca as select floor(extract(epoch from desde))::bigint as ts from public.revocaciones_sesion where user_id = '00000000-0000-0000-0000-0000000000b2';
select set_config('fel.test_ts', (select ts::text from t_marca), false) as _t \gset
set local role authenticated;
do $$ declare ts bigint := current_setting('fel.test_ts')::bigint; c text; begin
  foreach c in array array[
    format('{"sub":"00000000-0000-0000-0000-0000000000b2","amr":[{"method":"password","timestamp":%s},{"method":"totp","timestamp":%s}]}', ts - 3600, ts - 3500),   -- sesión anterior (aal2)
    format('{"sub":"00000000-0000-0000-0000-0000000000b2","amr":[{"method":"password","timestamp":%s}]}', ts - 1),                                                   -- justo antes
    '{"sub":"00000000-0000-0000-0000-0000000000b2"}',                                                                                                                  -- sin amr
    '{"sub":"00000000-0000-0000-0000-0000000000b2","amr":"password"}',
    '{"sub":"00000000-0000-0000-0000-0000000000b2","amr":[{"method":"password","timestamp":"x"}]}',
    '{"sub":"00000000-0000-0000-0000-0000000000b2","amr":[{"method":"password"}]}',
    '{"sub":"00000000-0000-0000-0000-0000000000b2","amr":[1,2,3]}'] loop
    perform set_config('request.jwt.claims', c, true);
    assert not public.fel_tiene_permiso('10000000-0000-0000-0000-00000000000a', 'clientes.ver'), 'se aceptó un token anterior a la revocación: ' || c;
    assert (select count(*) from public.clientes) = 0, 'una sesión revocada aún lee clientes: ' || c;
    assert not public.fel_es_miembro('10000000-0000-0000-0000-00000000000a'), 'una sesión revocada sigue siendo miembro';
    assert not public.fel_tiene_permiso('10000000-0000-0000-0000-00000000000a', 'clientes.ver'), 'una sesión revocada conserva permisos';
  end loop;
  -- inicio de sesión NUEVO (evento de autenticación igual o posterior a la marca): vale
  perform set_config('request.jwt.claims', format('{"sub":"00000000-0000-0000-0000-0000000000b2","amr":[{"method":"password","timestamp":%s}]}', ts), true);
  assert public.fel_tiene_permiso('10000000-0000-0000-0000-00000000000a', 'clientes.ver') and (select count(*) from public.clientes) = 1, 'un inicio de sesión posterior debe valer';
  perform set_config('request.jwt.claims', format('{"sub":"00000000-0000-0000-0000-0000000000b2","amr":[{"method":"password","timestamp":%s},{"method":"totp","timestamp":%s}]}', ts + 5, ts + 60), true);
  assert public.fel_tiene_permiso('10000000-0000-0000-0000-00000000000a', 'clientes.ver'), 'un token con autenticación reciente debe valer';
  -- los demás no se ven afectados
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b3"}', true);
  assert (select count(*) from public.clientes) = 1, 'el lector no debía verse afectado';
end $$;
reset role;

-- ================= el maestro con sesión anterior a SU marca pierde las lecturas de plataforma aunque tenga aal2
insert into public.revocaciones_sesion (user_id, desde, motivo) values ('00000000-0000-0000-0000-0000000000a1', now(), 'prueba');
set local role authenticated;
select set_config('request.jwt.claims', format('{"sub":"00000000-0000-0000-0000-0000000000a1","aal":"aal2","amr":[{"method":"totp","timestamp":%s}]}', floor(extract(epoch from now())) - 7200), true) as _cfg \gset
do $$ begin assert not public.fel_es_admin_plataforma(), 'un maestro con aal2 anterior a la revocación sigue siéndolo'; end $$;
select set_config('request.jwt.claims', format('{"sub":"00000000-0000-0000-0000-0000000000a1","aal":"aal2","amr":[{"method":"totp","timestamp":%s}]}', floor(extract(epoch from now())) + 1), true) as _cfg \gset
do $$ begin assert public.fel_es_admin_plataforma(), 'tras volver a autenticarse debe recuperarlo'; end $$;
reset role;

-- ================= fallo parcial: se borra 1 de 3 factores y se interrumpe; reintentar NO duplica y el total se conserva
delete from auth.mfa_factors where id = ((select r from t_ap1) -> 'factores' ->> 0)::uuid;                                       -- la API logró borrar el primero y falló
select pg_temp.espera_error($$select public.fel_op_mfa_recuperacion_cerrar('00000000-0000-0000-0000-0000000000b1', (select id from t_sol), 1)$$, 'quedan factores');
do $$ begin assert (select estado from public.solicitudes_recuperacion_mfa where id = (select id from t_sol)) = 'aprobada', 'el fallo no debe cerrar la solicitud'; end $$;
create temp table t_ap2 as select public.fel_op_mfa_recuperacion_aprobar('00000000-0000-0000-0000-0000000000a1', (select id from t_sol), null) as r;   -- reintento por OTRA persona autorizada
do $$ declare v jsonb := (select r from t_ap2); begin
  assert jsonb_array_length(v -> 'factores') = 2, 'el reintento solo debe devolver los 2 factores que faltan';
  assert not (v -> 'factores') @> ((select r from t_ap1) -> 'factores' -> 0), 'el factor ya borrado volvió a aparecer';
  assert (v ->> 'total')::int = 3, 'el total debe conservarse';
  assert (select resuelta_por from public.solicitudes_recuperacion_mfa where id = (select id from t_sol)) = '00000000-0000-0000-0000-0000000000b1', 'el reintento no debe cambiar a quien aprobó';
  assert (select count(*) from public.auditoria where accion = 'plataforma.mfa_recuperacion_aprobada' and datos ->> 'usuario' = '00000000-0000-0000-0000-0000000000b2') = 1, 'el reintento duplicó la aprobación en la auditoría';
  assert (select floor(extract(epoch from desde)) from public.revocaciones_sesion where user_id = '00000000-0000-0000-0000-0000000000b2') = (select ts from t_marca), 'el reintento movió la marca de revocación';
end $$;
delete from auth.mfa_factors where user_id = '00000000-0000-0000-0000-0000000000b2';
select public.fel_op_mfa_recuperacion_cerrar('00000000-0000-0000-0000-0000000000b1', (select id from t_sol), 2);
do $$ begin
  assert (select estado from public.solicitudes_recuperacion_mfa where id = (select id from t_sol)) = 'ejecutada';
  assert (select factores_eliminados from public.solicitudes_recuperacion_mfa where id = (select id from t_sol)) = 3, 'el total registrado debe ser 3, no el de la última ejecución';
  assert exists (select 1 from public.auditoria where accion = 'plataforma.mfa_recuperacion_ejecutada' and (datos ->> 'factores_total')::int = 3 and (datos ->> 'eliminados_en_esta_ejecucion')::int = 2), 'sin auditoría del cierre';
end $$;
-- repetir tras el éxito: no vuelve a ejecutar nada (ni a abrir una nueva revocación)
select pg_temp.espera_error($$select public.fel_op_mfa_recuperacion_cerrar('00000000-0000-0000-0000-0000000000b1', (select id from t_sol), 0)$$, 'no está aprobada');
select pg_temp.espera_error($$select public.fel_op_mfa_recuperacion_aprobar('00000000-0000-0000-0000-0000000000b1', (select id from t_sol), 'Reintento después de que ya se ejecutó la recuperación')$$, 'ya está ejecutada');
-- el borrado ocurrió pero la API murió antes de cerrar: reintentar devuelve 0 factores y se puede cerrar sin repetir nada
create temp table t_sol2 as select public.fel_op_mfa_recuperacion_solicitar('00000000-0000-0000-0000-0000000000b3', 'Perdí el dispositivo al cambiar de teléfono') as id;
create temp table t_ap3 as select public.fel_op_mfa_recuperacion_aprobar('00000000-0000-0000-0000-0000000000b1', (select id from t_sol2), 'Presencial en la oficina con documento de identidad vigente') as r;
delete from auth.mfa_factors where user_id = '00000000-0000-0000-0000-0000000000b3';
do $$ begin assert jsonb_array_length((public.fel_op_mfa_recuperacion_aprobar('00000000-0000-0000-0000-0000000000b1', (select id from t_sol2), null)) -> 'factores') = 0, 'no quedaba nada por borrar'; end $$;
select public.fel_op_mfa_recuperacion_cerrar('00000000-0000-0000-0000-0000000000b1', (select id from t_sol2), 0);
do $$ begin assert (select estado from public.solicitudes_recuperacion_mfa where id = (select id from t_sol2)) = 'ejecutada'; end $$;

rollback;
\echo 'OK 13_revocacion_sesiones'
