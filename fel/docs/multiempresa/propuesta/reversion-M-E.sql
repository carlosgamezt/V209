-- Reversión de M-E: retira políticas y privilegios de nexa_app y elimina el rol (si no tiene sesiones abiertas).
\set ON_ERROR_STOP on
begin;
do $$ declare r record; begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' and policyname like 'nexa_app\_%' loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;
revoke all on all tables in schema public from nexa_app;
revoke all on all functions in schema public from nexa_app;
revoke usage on schema public from nexa_app;
drop role if exists nexa_app;
commit;
