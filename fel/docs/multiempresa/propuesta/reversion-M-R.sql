-- Reversión de M-R: vuelve a la función sin argumentos de M-O (lista completa, SOLO con sesión viva) y retira la clasificación.
\set ON_ERROR_STOP on
begin;
drop function if exists public.fel__parametros_lista(text);
create or replace function public.fel__parametros_lista() returns jsonb language sql stable security definer set search_path = '' as $$
  select case when public.fel__sesion_viva() then (select coalesce(jsonb_agg(to_jsonb(t) order by t.clave), '[]'::jsonb) from (select p.clave, p.valor::text as valor from public.plataforma_parametros p) t) else null end
$$;
revoke all on function public.fel__parametros_lista() from public, anon; grant execute on function public.fel__parametros_lista() to authenticated;
create or replace function public.fel_es_admin_plataforma() returns boolean language sql stable security definer set search_path = '' as $$
  select public.fel_usuario_activo(auth.uid())
     and exists (select 1 from public.plataforma_admins pa where pa.user_id = auth.uid())
     and coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'aal', '') = 'aal2'
     and public.fel__sesion_vigente()
$$;
drop function if exists public.fel__parametro_permiso(text);
drop function if exists public.fel__parametro_clase(text);
commit;
