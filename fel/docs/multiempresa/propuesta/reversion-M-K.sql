-- Reversión del ROL nexa_sys (M-K): retira sus privilegios y elimina el rol (cerrar antes sus sesiones). Los envoltorios fel_ses_sys_* se retiran con reversion.sql.
\set ON_ERROR_STOP on
begin;
do $$ declare r record; begin
  for r in select p.oid::regprocedure as f from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'fel\_sys\_%' loop execute format('revoke execute on function %s from nexa_sys', r.f); end loop;
end $$;
revoke usage on schema public from nexa_sys;
drop role if exists nexa_sys;
commit;
