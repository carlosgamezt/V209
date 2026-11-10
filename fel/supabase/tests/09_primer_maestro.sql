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
-- La tabla real de Supabase exige id y fechas (no tienen valor por defecto): se envían completos.
insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at)
select gen_random_uuid(), v.u::uuid, 'totp', v.st, now(), now() from (values
  ('00000000-0000-0000-0000-0000000000a1', 'verified'),
  ('00000000-0000-0000-0000-0000000000a3', 'unverified'),
  ('00000000-0000-0000-0000-0000000000a4', 'verified'),
  ('00000000-0000-0000-0000-0000000000a5', 'verified'),
  ('00000000-0000-0000-0000-0000000000a6', 'verified')) as v(u, st);
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
  assert exists (select 1 from public.auditoria where accion = 'plataforma.maestro_creado' and actor_user_id = u and datos ->> 'adicional' = 'false'), 'sin auditoría';
end $$;
-- ya existe uno: otro exige indicarlo expresamente; repetir con el mismo es inocuo
select pg_temp.espera_error($$select public.fel_bootstrap_primer_maestro('segundo@fel.test')$$, 'ya existe un administrador maestro');
do $$ begin
  perform public.fel_bootstrap_primer_maestro('maestro@fel.test', true);
  assert (select count(*) from public.plataforma_admins) = 1, 'duplicó al maestro';
  perform public.fel_bootstrap_primer_maestro('segundo@fel.test', true);
  assert (select count(*) from public.plataforma_admins) = 2, 'no agregó al segundo con la autorización expresa';
  assert exists (select 1 from public.auditoria where accion = 'plataforma.maestro_creado' and datos ->> 'adicional' = 'true'), 'sin auditoría del adicional';
end $$;

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
