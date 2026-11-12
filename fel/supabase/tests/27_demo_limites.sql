-- D5 · contadores de limitación de la demostración: tabla cerrada, clave y contador válidos, incremento atómico por ventana.
\set ON_ERROR_STOP on
begin;
do $$ begin
  assert (select relrowsecurity from pg_class where oid = 'public.demo_limites'::regclass), 'sin RLS';
  assert not has_table_privilege('anon', 'public.demo_limites', 'SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('authenticated', 'public.demo_limites', 'SELECT,INSERT,UPDATE,DELETE'), 'privilegios abiertos';
  assert not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'demo_limites'), 'sin políticas';
  insert into public.demo_limites (clave, ventana, n, expira) values ('login:1.2.3.4', 10, 1, now() + interval '1 minute');
  insert into public.demo_limites (clave, ventana, n, expira) values ('login:1.2.3.4', 10, 1, now()) on conflict (clave, ventana) do update set n = public.demo_limites.n + 1;
  assert (select n from public.demo_limites where clave = 'login:1.2.3.4' and ventana = 10) = 2, 'el incremento es atómico por clave y ventana';
  begin insert into public.demo_limites (clave, ventana, n, expira) values ('', 1, 1, now()); raise exception 'NO DEBIÓ'; exception when check_violation then null; end;
  begin insert into public.demo_limites (clave, ventana, n, expira) values ('x', 1, 0, now()); raise exception 'NO DEBIÓ'; exception when check_violation then null; end;
end $$;
set local role authenticated;
do $$ begin begin perform count(*) from public.demo_limites; raise exception 'NO DEBIÓ'; exception when insufficient_privilege then null; end; end $$;
reset role;
rollback;
