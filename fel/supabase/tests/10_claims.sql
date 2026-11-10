-- Auditoría de claims: los únicos lugares donde la base lee claims del JWT, y que solo se acepta aal2 exacto.
-- (En Supabase, PostgREST verifica la firma del JWT y pone los claims en el parámetro de transacción request.jwt.claims.)
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_ok boolean := false;
begin
  begin execute p_sql; exception when others then v_ok := (sqlerrm ~ p_patron) or (sqlstate ~ p_patron); end;
  if not v_ok then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if;
end $$;

-- ================= inventario: qué funciones de public leen claims del JWT directamente
do $$ declare lectoras text[]; begin
  select coalesce(array_agg(p.proname::text order by p.proname), '{}') into lectoras
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc ~* 'request\.jwt|jwt_claims|auth\.jwt\(';
  assert lectoras = array['fel__sesion_vigente', 'fel_es_admin_plataforma'], 'funciones que leen claims del JWT: ' || lectoras::text;
  -- ninguna política RLS lee claims por su cuenta: todas pasan por auth.uid() o por las funciones fel_*
  assert not exists (select 1 from pg_policies where schemaname = 'public' and coalesce(qual, '') || coalesce(with_check, '') ~* 'request\.jwt|jwt_claims|auth\.jwt\('),
    'una política RLS lee claims directamente';
end $$;

-- ================= solo aal2 EXACTO cuenta (no mayúsculas, espacios, números ni listas)
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-0000000000a1', 'maestro@fel.test', now());
insert into public.perfiles (user_id) values ('00000000-0000-0000-0000-0000000000a1');
insert into public.plataforma_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
do $$ declare c text; begin
  foreach c in array array[
    '{"sub":"00000000-0000-0000-0000-0000000000a1","aal":"AAL2"}',
    '{"sub":"00000000-0000-0000-0000-0000000000a1","aal":" aal2"}',
    '{"sub":"00000000-0000-0000-0000-0000000000a1","aal":"aal2 "}',
    '{"sub":"00000000-0000-0000-0000-0000000000a1","aal":2}',
    '{"sub":"00000000-0000-0000-0000-0000000000a1","aal":["aal2"]}',
    '{"sub":"00000000-0000-0000-0000-0000000000a1","aal":null}',
    '{"sub":"00000000-0000-0000-0000-0000000000a1","amr":[{"method":"totp"}]}',
    '{"sub":"00000000-0000-0000-0000-0000000000a1","user_metadata":{"aal":"aal2"}}',
    '{"sub":"00000000-0000-0000-0000-0000000000a1","app_metadata":{"aal":"aal2"}}',
    ''] loop
    perform set_config('request.jwt.claims', c, true);
    assert not public.fel_es_admin_plataforma(), 'se aceptó como aal2: ' || c;
  end loop;
  -- el formato antiguo de un claim suelto tampoco cuenta
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
  perform set_config('request.jwt.claim.aal', 'aal2', true);
  assert not public.fel_es_admin_plataforma(), 'el claim suelto request.jwt.claim.aal no debe contar';
  perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.aal', '', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","aal":"aal2"}', true);
  assert public.fel_es_admin_plataforma(), 'aal2 exacto debe aceptarse';
end $$;
reset role;

-- ================= un usuario no puede fabricarse el nivel desde los datos que él controla
-- (perfiles.nombre u otros campos no influyen en la decisión de aal/maestro)
update public.perfiles set nombre = '{"aal":"aal2"}' where user_id = '00000000-0000-0000-0000-0000000000a1';
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-0000000000b1', 'comun@fel.test', now());
insert into public.perfiles (user_id, nombre) values ('00000000-0000-0000-0000-0000000000b1', 'aal2');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","aal":"aal2"}', true) as _cfg \gset
do $$ begin assert not public.fel_es_admin_plataforma(), 'aal2 de un usuario común no lo vuelve maestro'; end $$;
reset role;

rollback;
\echo 'OK 10_claims'
