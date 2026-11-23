-- NEXA FEL · verificación previa de SOLO LECTURA (un único SELECT). Compatible con el flujo «Consultar Supabase (solo lectura)».
-- Confirma que el proyecto es NEXA principal y que todavía no existen los objetos de NEXA FEL. No imprime datos de usuarios ni UUID.
select json_build_object(
  'rol', current_user,
  'servidor', current_setting('server_version'),
  'tiene_pa_docs', to_regclass('public.pa_docs') is not null,
  'tiene_pa_profiles', to_regclass('public.pa_profiles') is not null,
  'tiene_pa_next_seq', exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'pa_next_seq'),
  'es_nexa_fel_demo_si_true', to_regclass('public.empresas') is not null,
  'roles_supabase_esperado_4', (select count(*) from pg_roles where rolname in ('anon','authenticated','service_role','postgres')),
  'auth_users', to_regclass('auth.users') is not null,
  'auth_uid', to_regprocedure('auth.uid()') is not null,
  'objetos_nx_fel_existentes_esperado_0', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relname ilike 'nx\_fel%')
                                          + (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname ilike 'nx\_fel%')
                                          + (select count(*) from pg_type t where t.typname ilike 'nx\_fel%'),
  'cuentas_en_auth', (select count(*) from auth.users),
  'filas_pa_docs', (select count(*) from public.pa_docs),
  'tamano_base', pg_size_pretty(pg_database_size(current_database()))
) as verificacion;
