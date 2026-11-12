-- D5 · estado de los simuladores: tabla cerrada (RLS sin políticas, sin privilegios) y con clave válida.
\set ON_ERROR_STOP on
begin;
do $$ begin
  assert (select relrowsecurity from pg_class where oid = 'public.demo_simulador_estado'::regclass), 'sin RLS';
  assert not has_table_privilege('anon', 'public.demo_simulador_estado', 'SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('authenticated', 'public.demo_simulador_estado', 'SELECT,INSERT,UPDATE,DELETE'), 'privilegios abiertos';
  assert not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'demo_simulador_estado'), 'sin políticas';
  insert into public.demo_simulador_estado (clave, estado) values ('digifact', '{}');
  begin insert into public.demo_simulador_estado (clave, estado) values ('Mala Clave', '{}'); raise exception 'NO DEBIÓ'; exception when check_violation then null; end;
end $$;
set local role authenticated;
do $$ begin begin perform count(*) from public.demo_simulador_estado; raise exception 'NO DEBIÓ'; exception when insufficient_privilege then null; end; end $$;
reset role;
rollback;
