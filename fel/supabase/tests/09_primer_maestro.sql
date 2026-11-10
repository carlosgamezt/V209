-- Procedimiento del primer administrador maestro (fel_bootstrap_primer_maestro) y exigencia de aal2 en lecturas del maestro.
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_ok boolean := false;
begin
  begin execute p_sql; exception when others then v_ok := (sqlerrm ~ p_patron) or (sqlstate ~ p_patron); end;
  if not v_ok then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if;
end $$;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'maestro@fel.test', now()),
  ('00000000-0000-0000-0000-0000000000a2', 'sinmfa@fel.test', now()),
  ('00000000-0000-0000-0000-0000000000a3', 'mfapendiente@fel.test', now()),
  ('00000000-0000-0000-0000-0000000000a4', 'sinconfirmar@fel.test', null),
  ('00000000-0000-0000-0000-0000000000a5', 'segundo@fel.test', now()),
  ('00000000-0000-0000-0000-0000000000a6', 'bloqueado@fel.test', now());
-- La tabla real de Supabase exige id y fechas (sin valor por defecto) y usa tipos enumerados: se envían literales completos.
insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a1', 'totp', 'verified', now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a3', 'totp', 'unverified', now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a4', 'totp', 'verified', now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a5', 'totp', 'verified', now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a6', 'totp', 'verified', now(), now());
insert into public.perfiles (user_id, activo) values ('00000000-0000-0000-0000-0000000000a6', false);

-- rechazos
select pg_temp.espera_error($$select public.fel_bootstrap_primer_maestro('noexiste@fel.test')$$, 'FEL_NO_ENCONTRADO');
select pg_temp.espera_error($$select public.fel_bootstrap_primer_maestro('')$$, 'FEL_NO_ENCONTRADO');
select pg_temp.espera_error($$select public.fel_bootstrap_primer_maestro('sinconfirmar@fel.test')$$, 'sin confirmar|no está confirmado');
select pg_temp.espera_error($$select public.fel_bootstrap_primer_maestro('sinmfa@fel.test')$$, 'TOTP verificado');
select pg_temp.espera_error($$select public.fel_bootstrap_primer_maestro('mfapendiente@fel.test')$$, 'TOTP verificado');
select pg_temp.espera_error($$select public.fel_bootstrap_primer_maestro('bloqueado@fel.test')$$, 'desactivada');
do $$ begin assert not exists (select 1 from public.plataforma_admins), 'se creó un maestro con un rechazo'; end $$;
-- éxito (el correo se normaliza)
do $$ declare u uuid; begin
  u := public.fel_bootstrap_primer_maestro('  Maestro@Fel.Test ');
  assert u = '00000000-0000-0000-0000-0000000000a1';
  assert exists (select 1 from public.plataforma_admins where user_id = u), 'sin fila de maestro';
  assert public.fel_estado_cuenta(u) = 'activa', 'sin perfil activo';
  assert public.fel_es_plataforma(u), 'no es maestro';
  assert exists (select 1 from public.auditoria where accion = 'plataforma.primer_maestro_creado' and actor_user_id = u), 'sin auditoría';
end $$;

-- ================= SEPARACIÓN: el primer maestro y los adicionales son procedimientos distintos
-- el procedimiento del primero NO sirve para agregar otro (ni con el mismo operador de la base de datos)
select pg_temp.espera_error($$select public.fel_bootstrap_primer_maestro('segundo@fel.test')$$, 'ya existe un administrador maestro');
select pg_temp.espera_error($$select public.fel_bootstrap_primer_maestro('maestro@fel.test')$$, 'ya existe un administrador maestro');
-- un adicional exige autorización previa
select pg_temp.espera_error($$select public.fel_agregar_maestro_adicional('segundo@fel.test')$$, 'no hay una autorización vigente');
-- la autorización la emite SOLO un maestro activo, con motivo
select pg_temp.espera_error($$select public.fel_admin_maestro_autorizar('00000000-0000-0000-0000-0000000000a2', 'segundo@fel.test', 'Ampliar el equipo de administración')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_admin_maestro_autorizar('00000000-0000-0000-0000-0000000000a1', 'segundo@fel.test', 'corto')$$, 'motivo');
select pg_temp.espera_error($$select public.fel_admin_maestro_autorizar('00000000-0000-0000-0000-0000000000a1', 'maestro@fel.test', 'Intento sobre quien ya es maestro')$$, 'ya es administradora');
select pg_temp.espera_error($$select public.fel_admin_maestro_autorizar('00000000-0000-0000-0000-0000000000a1', 'no-es-correo', 'Motivo suficientemente largo')$$, 'correo no válido');
create temp table t_aut as select public.fel_admin_maestro_autorizar('00000000-0000-0000-0000-0000000000a1', ' Segundo@Fel.Test ', 'Ampliar el equipo de administración') as id;
select pg_temp.espera_error($$select public.fel_admin_maestro_autorizar('00000000-0000-0000-0000-0000000000a1', 'segundo@fel.test', 'Segunda autorización duplicada')$$, 'ya hay una autorización abierta');
-- la autorización de OTRO correo no sirve; y el candidato debe cumplir TODO (TOTP, correo confirmado, cuenta activa)
select pg_temp.espera_error($$select public.fel_agregar_maestro_adicional('sinmfa@fel.test')$$, 'TOTP verificado|autorización vigente');
do $$ begin
  assert exists (select 1 from public.auditoria where accion = 'plataforma.maestro_autorizado' and datos ->> 'email' = 'segundo@fel.test'), 'sin auditoría de la autorización';
  assert not exists (select 1 from public.plataforma_admins where user_id = '00000000-0000-0000-0000-0000000000a5'), 'se creó un maestro sin consumir la autorización';
end $$;
-- una autorización vencida o revocada no se puede usar
update public.autorizaciones_maestro set expira_en = now() - interval '1 minute' where id = (select id from t_aut);
select pg_temp.espera_error($$select public.fel_agregar_maestro_adicional('segundo@fel.test')$$, 'no hay una autorización vigente');
create temp table t_aut2 as select public.fel_admin_maestro_autorizar('00000000-0000-0000-0000-0000000000a1', 'segundo@fel.test', 'Nueva autorización tras vencer la anterior') as id;
select public.fel_admin_maestro_revocar_autorizacion('00000000-0000-0000-0000-0000000000a1', (select id from t_aut2));
select pg_temp.espera_error($$select public.fel_agregar_maestro_adicional('segundo@fel.test')$$, 'no hay una autorización vigente');
select pg_temp.espera_error($$select public.fel_admin_maestro_revocar_autorizacion('00000000-0000-0000-0000-0000000000a1', (select id from t_aut2))$$, 'ya no está abierta');
-- ahora sí: autorización vigente → se consume una sola vez
create temp table t_aut3 as select public.fel_admin_maestro_autorizar('00000000-0000-0000-0000-0000000000a1', 'segundo@fel.test', 'Autorización definitiva para la prueba') as id;
do $$ declare u uuid; begin
  u := public.fel_agregar_maestro_adicional('segundo@fel.test');
  assert u = '00000000-0000-0000-0000-0000000000a5' and public.fel_es_plataforma(u), 'no quedó como maestro';
  assert (select usada_en from public.autorizaciones_maestro where id = (select id from t_aut3)) is not null, 'no se consumió la autorización';
  assert exists (select 1 from public.auditoria where accion = 'plataforma.maestro_adicional_creado' and datos ->> 'autorizado_por' = '00000000-0000-0000-0000-0000000000a1'), 'sin auditoría del adicional';
end $$;
select pg_temp.espera_error($$select public.fel_agregar_maestro_adicional('segundo@fel.test')$$, 'no hay una autorización vigente');   -- no es reutilizable
-- si el maestro que autorizó deja de estar activo, la autorización muere con él
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-0000000000a7', 'tercero@fel.test', now());
insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at) values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a7', 'totp', 'verified', now(), now());
select public.fel_admin_maestro_autorizar('00000000-0000-0000-0000-0000000000a1', 'tercero@fel.test', 'Autorización que perderá a su emisor');
update public.perfiles set activo = false where user_id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.espera_error($$select public.fel_agregar_maestro_adicional('tercero@fel.test')$$, 'maestro activo');
update public.perfiles set activo = true where user_id = '00000000-0000-0000-0000-0000000000a1';

-- ================= lecturas del maestro por RLS: solo con aal2
insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id, estado)
select '10000000-0000-0000-0000-00000000000a', 'A', 'A S.A.', '1111111-1', id, 'habilitada' from public.regimenes_fiscales where codigo = 'general';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}', true) as _cfg \gset
do $$ begin
  assert not public.fel_es_admin_plataforma(), 'el maestro con aal1 sigue siéndolo';
  assert (select count(*) from public.empresas) = 0, 'el maestro con aal1 ve empresas';
  assert (select count(*) from public.plataforma_admins) = 0, 'el maestro con aal1 ve la lista de maestros';
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true) as _cfg \gset
do $$ begin assert not public.fel_es_admin_plataforma(), 'sin claim aal'; end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true) as _cfg \gset
do $$ begin
  assert public.fel_es_admin_plataforma(), 'el maestro con aal2 debe serlo';
  assert (select count(*) from public.empresas) = 1, 'el maestro con aal2 debe ver las empresas';
end $$;
-- un usuario común con aal2 no es maestro
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal2"}', true) as _cfg \gset
do $$ begin assert not public.fel_es_admin_plataforma(), 'un usuario común con aal2 es maestro'; end $$;
reset role;

rollback;
\echo 'OK 09_primer_maestro'
