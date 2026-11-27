-- Reversión de M-M + M-N + M-O (W1–W4): retira el esquema `api` (con las lecturas de M-O), los ayudantes de identidad de Auth y devuelve `fel__sesion_empresa`/`fel__sesion_maestro` a su versión de M-G
-- (solo token de demo_sesiones). Las sesiones con identidad de Auth (token_hash 'auth:…') que hubiera en sesion_establecimiento_activo se borran para poder restituir la llave foránea.
\set ON_ERROR_STOP on
begin;
-- Orden: si se aplicaron, revertir ANTES reversion-M-S.sql, reversion-M-R.sql y reversion-M-Q.sql. Aquí se restituyen las políticas de M-O (clientes, conceptos, establecimientos) y se retira su función de conjunto.
drop policy if exists clientes_leer on public.clientes; create policy clientes_leer on public.clientes for select to authenticated using (fel_tiene_permiso(empresa_id, 'clientes.ver'));
drop policy if exists conceptos_leer on public.conceptos; create policy conceptos_leer on public.conceptos for select to authenticated using (fel_tiene_permiso(empresa_id, 'conceptos.ver'));
drop policy if exists establecimientos_leer on public.establecimientos; create policy establecimientos_leer on public.establecimientos for select to authenticated using (fel_tiene_permiso(empresa_id, 'establecimientos.ver'));
drop schema if exists api cascade;
drop function if exists public.fel__empresas_con_permiso(text);
drop function if exists public.fel__empresa_actual();
drop function if exists public.fel__parametros_lista();
drop function if exists public.fel__parametros_lista(text);
drop function if exists public.fel__parametro_permiso(text);
drop function if exists public.fel__parametro_clase(text);
drop function if exists public.fel__exigir_aal2();
drop function if exists public.fel__ctx();
create or replace function public.fel__sesion_empresa(p_token text, out o_user uuid, out o_empresa uuid, out o_mfa boolean, out o_hash text) language plpgsql stable security definer set search_path = '' as $$
begin
  select s.user_id, s.empresa_id, s.mfa, s.token_hash into o_user, o_empresa, o_mfa, o_hash from public.fel__sesion(p_token) s;
  if o_user is null then raise exception 'FEL_NO_AUTORIZADO: sesión no válida'; end if;
  if o_empresa is null then raise exception 'FEL_NO_AUTORIZADO: esta operación es de una empresa; la sesión es de la plataforma'; end if;
end $$;
create or replace function public.fel__sesion_maestro(p_token text, out o_user uuid) language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid; v_mfa boolean;
begin
  select s.user_id, s.empresa_id, s.mfa into o_user, v_emp, v_mfa from public.fel__sesion(p_token) s;
  if o_user is null then raise exception 'FEL_NO_AUTORIZADO: sesión no válida'; end if;
  if v_emp is not null or not public.fel_es_plataforma(o_user) then raise exception 'FEL_NO_AUTORIZADO: solo el administrador de la plataforma'; end if;
  -- MFA de la plataforma: con el parámetro en 1 (obligatorio en la nube) la cuenta DEBE tener la verificación en dos pasos registrada; el inicio de sesión ya la exige al entrar
  if coalesce(public.fel__parametro('plataforma_mfa_obligatoria'), 0) = 1 and not coalesce(v_mfa, false) then raise exception 'FEL_NO_AUTORIZADO: la plataforma exige verificación en dos pasos'; end if;
end $$;
delete from public.sesion_establecimiento_activo where token_hash like 'auth:%';
alter table public.sesion_establecimiento_activo drop constraint if exists sesion_establecimiento_activo_token_hash_fkey;
alter table public.sesion_establecimiento_activo add constraint sesion_establecimiento_activo_token_hash_fkey foreign key (token_hash) references public.demo_sesiones (token_hash) on delete cascade;
delete from public.plataforma_parametros where clave = 'mfa_operaciones_sensibles';
commit;
