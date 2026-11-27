-- M-M · W1 (PROPUESTA; fuera de supabase/migrations; NO se aplica sin autorización). Requiere M-F, M-G y M-L. IDENTIDAD de Supabase Auth: `auth.uid()` + sesión viva + MFA real, resuelta en UN solo lugar.
-- Hasta ahora `fel__sesion_empresa(p_token)` / `fel__sesion_maestro(p_token)` validaban el token de `demo_sesiones` (R1: la aplicación podía fabricarlo). Con este cambio, si NO se les entrega token, la identidad sale de lo que
-- PostgREST deja en la transacción tras validar el JWT con las llaves de Supabase: `auth.uid()`, `session_id`, `aal`. La aplicación no puede afirmar esa identidad. Con token, siguen funcionando igual (transición; se retiran en W6).
-- Reglas del camino de Supabase Auth:
--   · la sesión debe estar VIVA en `auth.sessions` (cerrar sesión o dar de baja = efecto inmediato, sin esperar el `exp` del token);
--   · la persona debe tener perfil activo; la EMPRESA sale de la tabla `miembros` (membresía activa). Si pertenece a varias, el claim `app_metadata.empresa_id` solo SELECCIONA entre las suyas (se verifica la membresía en la tabla; un claim ajeno falla);
--   · MFA: `aal2` solo vale si el token Y la sesión guardada lo dicen (`fel__aal2`). Las operaciones sensibles lo exigen (`fel__exigir_aal2`, parámetro `mfa_operaciones_sensibles`, 1 en la nube);
--   · la plataforma exige además estar en `plataforma_admins`, sin empresa, y aal2 si `plataforma_mfa_obligatoria = 1`.
insert into public.plataforma_parametros (clave, valor, descripcion) values ('mfa_operaciones_sensibles', 1, 'Operaciones sensibles de empresa por la Data API (fiscales, usuarios, canales, agentes): 1 = exigen aal2 (verificación en dos pasos real); 0 = no (solo pruebas)') on conflict (clave) do nothing;

create or replace function public.fel__ctx(out o_user uuid, out o_empresa uuid, out o_aal2 boolean, out o_sesion text) language plpgsql stable security definer set search_path = '' as $$
declare v_sel uuid; n int;
begin
  o_user := auth.uid();
  if o_user is null then raise exception 'FEL_NO_AUTORIZADO: sin identidad'; end if;
  if not public.fel__sesion_viva() then raise exception 'FEL_NO_AUTORIZADO: sesión no válida'; end if;
  if not exists (select 1 from public.perfiles pf where pf.user_id = o_user and pf.activo) then raise exception 'FEL_NO_AUTORIZADO: cuenta desactivada'; end if;
  if exists (select 1 from public.plataforma_admins where user_id = o_user) then raise exception 'FEL_NO_AUTORIZADO: esta operación es de una empresa; la sesión es de la plataforma'; end if;
  v_sel := nullif(auth.jwt() -> 'app_metadata' ->> 'empresa_id', '')::uuid;
  if v_sel is not null then
    select m.empresa_id into o_empresa from public.miembros m where m.user_id = o_user and m.empresa_id = v_sel and m.activo;
    if o_empresa is null then raise exception 'FEL_NO_AUTORIZADO: no eres miembro activo de esa empresa'; end if;
  else
    select count(*), min(m.empresa_id::text)::uuid into n, o_empresa from public.miembros m where m.user_id = o_user and m.activo;
    if n = 0 then raise exception 'FEL_NO_AUTORIZADO: no perteneces a ninguna empresa'; end if;
    if n > 1 then raise exception 'FEL_REGLA: perteneces a varias empresas; elige una'; end if;
  end if;
  o_aal2 := public.fel__aal2(); o_sesion := auth.jwt() ->> 'session_id';
end $$;
create or replace function public.fel__exigir_aal2() returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(public.fel__parametro('mfa_operaciones_sensibles'), 1) = 1 and not public.fel__aal2() then raise exception 'FEL_NO_AUTORIZADO: esta operación exige verificación en dos pasos (aal2)'; end if;
end $$;

-- la misma función que ya usan TODOS los envoltorios: con token, el camino de siempre; sin token, Supabase Auth
create or replace function public.fel__sesion_empresa(p_token text, out o_user uuid, out o_empresa uuid, out o_mfa boolean, out o_hash text) language plpgsql stable security definer set search_path = '' as $$
begin
  if p_token is null then   -- Data API: la identidad la afirma Supabase Auth, no la aplicación
    select c.o_user, c.o_empresa, c.o_aal2, 'auth:' || c.o_sesion into o_user, o_empresa, o_mfa, o_hash from public.fel__ctx() c; return;
  end if;
  select s.user_id, s.empresa_id, s.mfa, s.token_hash into o_user, o_empresa, o_mfa, o_hash from public.fel__sesion(p_token) s;
  if o_user is null then raise exception 'FEL_NO_AUTORIZADO: sesión no válida'; end if;
  if o_empresa is null then raise exception 'FEL_NO_AUTORIZADO: esta operación es de una empresa; la sesión es de la plataforma'; end if;
end $$;
create or replace function public.fel__sesion_maestro(p_token text, out o_user uuid) language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid; v_mfa boolean;
begin
  if p_token is null then   -- Data API: plataforma por Supabase Auth
    o_user := auth.uid();
    if o_user is null then raise exception 'FEL_NO_AUTORIZADO: sin identidad'; end if;
    if not public.fel__sesion_viva() then raise exception 'FEL_NO_AUTORIZADO: sesión no válida'; end if;
    if not exists (select 1 from public.perfiles pf where pf.user_id = o_user and pf.activo) or not public.fel_es_plataforma(o_user) or exists (select 1 from public.miembros m where m.user_id = o_user and m.activo) then raise exception 'FEL_NO_AUTORIZADO: solo el administrador de la plataforma'; end if;
    if coalesce(public.fel__parametro('plataforma_mfa_obligatoria'), 0) = 1 and not public.fel__aal2() then raise exception 'FEL_NO_AUTORIZADO: la plataforma exige verificación en dos pasos'; end if;
    return;
  end if;
  select s.user_id, s.empresa_id, s.mfa into o_user, v_emp, v_mfa from public.fel__sesion(p_token) s;
  if o_user is null then raise exception 'FEL_NO_AUTORIZADO: sesión no válida'; end if;
  if v_emp is not null or not public.fel_es_plataforma(o_user) then raise exception 'FEL_NO_AUTORIZADO: solo el administrador de la plataforma'; end if;
  if coalesce(public.fel__parametro('plataforma_mfa_obligatoria'), 0) = 1 and not coalesce(v_mfa, false) then raise exception 'FEL_NO_AUTORIZADO: la plataforma exige verificación en dos pasos'; end if;
end $$;
-- el establecimiento ACTIVO por sesión admite también sesiones de Auth (clave «auth:<session_id>»): se retira la llave foránea a demo_sesiones y la limpieza pasa a depender de la vida de la sesión
alter table public.sesion_establecimiento_activo drop constraint if exists sesion_establecimiento_activo_token_hash_fkey;
revoke all on function public.fel__ctx(), public.fel__exigir_aal2() from public, anon, authenticated;
