-- NEXA CORE · C00 · rol de los módulos/procesos (sin contraseña, sin herencia). En Supabase, además: grant core_worker to authenticator; (para que la Data API pueda asumirlo con la reclamación role=core_worker).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'core_worker') then create role core_worker nologin noinherit; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticator') then execute 'grant core_worker to authenticator'; end if;
end $$;
