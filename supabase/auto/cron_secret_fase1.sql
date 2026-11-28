-- Rotación del secreto de las tareas programadas, FASE 1 (idempotente; no cambia ninguna tarea todavía).
-- El secreto nuevo lo genera PostgreSQL y vive solo en una tabla sin acceso para la app; nunca se escribe en el repositorio, en comandos ni en registros.
begin;
create table if not exists public.nexa_cron_secret (
  id int primary key check (id = 1),
  valor text not null check (length(valor) >= 48),
  rotado_at timestamptz not null default now()
);
alter table public.nexa_cron_secret enable row level security;
revoke all on public.nexa_cron_secret from public, anon, authenticated;
insert into public.nexa_cron_secret (id, valor)
  select 1, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
  where not exists (select 1 from public.nexa_cron_secret);
create or replace function public.nexa_cron_check(p text) returns boolean
language sql stable security definer set search_path = '' as $f$
  select p is not null and coalesce((select s.valor = p from public.nexa_cron_secret s where s.id = 1), false)
$f$;
revoke all on function public.nexa_cron_check(text) from public, anon, authenticated;
grant execute on function public.nexa_cron_check(text) to service_role;
commit;
select json_build_object(
  'paso', 'cron_secret fase 1',
  'secreto_guardado', exists (select 1 from public.nexa_cron_secret where id = 1),
  'longitud_del_secreto', (select length(valor) from public.nexa_cron_secret where id = 1),
  'anon_puede_leer_tabla', has_table_privilege('anon', 'public.nexa_cron_secret', 'select'),
  'authenticated_puede_leer_tabla', has_table_privilege('authenticated', 'public.nexa_cron_secret', 'select'),
  'anon_puede_ejecutar_comprobacion', has_function_privilege('anon', 'public.nexa_cron_check(text)', 'execute'),
  'authenticated_puede_ejecutar_comprobacion', has_function_privilege('authenticated', 'public.nexa_cron_check(text)', 'execute'),
  'service_role_puede_ejecutar_comprobacion', has_function_privilege('service_role', 'public.nexa_cron_check(text)', 'execute'),
  'rls_activa', (select relrowsecurity from pg_class where oid = 'public.nexa_cron_secret'::regclass),
  'comprobacion_rechaza_texto_falso', public.nexa_cron_check('x') = false and public.nexa_cron_check(null) = false
) as cron_secret_fase1;
