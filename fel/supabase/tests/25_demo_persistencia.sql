-- D5 · tablas de persistencia de la demostración: cerradas para todo el mundo salvo el propietario de la base; restricciones; secretos solo como hash/cifrado.
\set ON_ERROR_STOP on
begin;
create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_ok boolean := false;
begin begin execute p_sql; exception when others then v_ok := (sqlerrm ~ p_patron) or (sqlstate ~ p_patron); end;
  if not v_ok then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if; end $$;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1','m@fel.test'), ('00000000-0000-0000-0000-0000000000c1','c@fel.test');
do $$ declare t text; begin
  foreach t in array array['demo_entorno','demo_credenciales','demo_sesiones','demo_intentos'] loop
    assert (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass), 'sin RLS: ' || t;
    assert not has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('authenticated', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('service_role', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE'), 'acceso indebido a ' || t;
    assert not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t), 'sin políticas: nadie entra por RLS en ' || t;
  end loop;
  insert into public.demo_entorno default values; perform pg_temp.espera_error($q$insert into public.demo_entorno (id) values (false)$q$, 'check|duplicate');
  insert into public.demo_credenciales (usuario, user_id, nombre, sal, hash) values ('ana', '00000000-0000-0000-0000-0000000000c1', 'Ana Torres', repeat('a', 32), repeat('b', 64));
  perform pg_temp.espera_error($q$insert into public.demo_credenciales (usuario, user_id, nombre, sal, hash) values ('Mal Usuario', '00000000-0000-0000-0000-0000000000a1', 'X Y Z', repeat('a', 32), repeat('b', 64))$q$, 'check');
  perform pg_temp.espera_error($q$insert into public.demo_credenciales (usuario, user_id, nombre, sal, hash) values ('otro', '00000000-0000-0000-0000-0000000000c1', 'Otra Persona', repeat('a', 32), repeat('b', 64))$q$, 'unique|duplicate');   -- una cuenta de la demo por usuario de la base
  perform pg_temp.espera_error($q$insert into public.demo_credenciales (usuario, user_id, nombre, sal, hash) values ('claro', '00000000-0000-0000-0000-0000000000a1', 'Contraseña en claro', 'sal', 'miclave123')$q$, 'check');   -- ni sal ni hash «en claro»
  perform pg_temp.espera_error($q$insert into public.demo_sesiones (token_hash, usuario, creada_en, ultima_en) values ('token-en-claro', 'ana', now(), now())$q$, 'check');   -- la sesión solo guarda el SHA-256
  insert into public.demo_sesiones (token_hash, usuario, creada_en, ultima_en) values (repeat('c', 64), 'ana', now(), now());
  perform pg_temp.espera_error($q$insert into public.demo_sesiones (token_hash, usuario, creada_en, ultima_en) values (repeat('d', 64), 'fantasma', now(), now())$q$, 'foreign key');
  delete from public.demo_credenciales where usuario = 'ana'; assert (select count(*) from public.demo_sesiones) = 0, 'al borrar la cuenta caen sus sesiones';
end $$;
set local role authenticated;
do $$ begin begin perform count(*) from public.demo_credenciales; raise exception 'NO DEBIÓ'; exception when insufficient_privilege then null; end; end $$;
reset role; set local role anon;
do $$ begin begin perform count(*) from public.demo_sesiones; raise exception 'NO DEBIÓ'; exception when insufficient_privilege then null; end; end $$;
reset role;
rollback;
\echo OK 25_demo_persistencia
