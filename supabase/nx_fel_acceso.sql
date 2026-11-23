-- NEXA FEL · acceso exclusivo por cuenta de Supabase Auth (UUID).
-- Se ejecuta A MANO, una vez, en el editor SQL del Supabase de NEXA, como el rol «postgres». Es idempotente: se puede repetir sin perder las cuentas ya registradas.
-- NO contiene ningún UUID ni correo: las cuentas autorizadas se registran con el PASO 2 (comentado abajo) y nunca se guardan en el repositorio.
--
-- Qué hace:
--   · Tabla public.nx_fel_cuentas_autorizadas: los UUID de Supabase Auth autorizados. Con RLS activado y SIN políticas, y sin permisos para public, anon, authenticated ni service_role:
--     ningún usuario de la aplicación (tampoco un administrador) puede leerla ni escribirla por la API.
--   · Función public.nx_fel_autorizado(): devuelve SOLO true o false. Es true únicamente si auth.uid() (el UUID de la sesión, tomado del token verificado) está en la tabla.
--     Sin sesión, o con un UUID no registrado, devuelve false. No depende del rol «admin» ni de ningún dato que envíe el navegador.
--     SECURITY DEFINER (corre con los permisos de su propietario «postgres» para leer la tabla), con search_path vacío (todo va calificado) y ejecutable solo por «authenticated».
--
-- NEXA FEL sigue siendo una aplicación independiente con su propio inicio de sesión: esto solo decide si NEXA muestra el acceso.

begin;

create table if not exists public.nx_fel_cuentas_autorizadas (
  auth_id   uuid primary key references auth.users (id) on delete cascade,
  creado_en timestamptz not null default now()
);
comment on table public.nx_fel_cuentas_autorizadas is 'Cuentas de Supabase Auth (UUID) autorizadas a ver el acceso a NEXA FEL. Sin políticas RLS a propósito: solo el propietario puede leerla o escribirla.';

alter table public.nx_fel_cuentas_autorizadas owner to postgres;
alter table public.nx_fel_cuentas_autorizadas enable row level security;
-- (no se usa FORCE ROW LEVEL SECURITY: la función SECURITY DEFINER corre como propietario y debe poder leer la tabla)
revoke all on table public.nx_fel_cuentas_autorizadas from public, anon, authenticated, service_role;

create or replace function public.nx_fel_autorizado()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select exists (select 1 from public.nx_fel_cuentas_autorizadas a where a.auth_id = (select auth.uid()))),
    false
  )
$$;
comment on function public.nx_fel_autorizado() is 'true solo si el UUID de la sesión (auth.uid()) está en nx_fel_cuentas_autorizadas; false en cualquier otro caso. SECURITY DEFINER, search_path vacío.';

alter function public.nx_fel_autorizado() owner to postgres;
revoke all on function public.nx_fel_autorizado() from public, anon, authenticated, service_role;
grant execute on function public.nx_fel_autorizado() to authenticated;

commit;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------
-- PASO 2 (a mano, UNA vez, en el editor SQL; NO guardes tu correo ni tu UUID en el repositorio ni en este archivo):
--
--   insert into public.nx_fel_cuentas_autorizadas (auth_id)
--   select id from auth.users where lower(email) = lower('PEGA-AQUI-TU-CORREO');
--   -- (o, si prefieres el UUID de Authentication → Users → «User UID»:)
--   -- insert into public.nx_fel_cuentas_autorizadas (auth_id) values ('PEGA-AQUI-TU-UUID');
--
-- Verificación (debe dar 1 y nada más):   select count(*) from public.nx_fel_cuentas_autorizadas;
-- Quitar el acceso a una cuenta:           delete from public.nx_fel_cuentas_autorizadas where auth_id = 'PEGA-AQUI-EL-UUID';
-- Revertir todo:                           drop function public.nx_fel_autorizado(); drop table public.nx_fel_cuentas_autorizadas;
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------
