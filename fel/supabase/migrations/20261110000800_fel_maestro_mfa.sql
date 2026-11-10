-- NEXA FEL · Fase 1.0 · administrador maestro con verificación en dos pasos.
--  (1) Las LECTURAS del maestro por RLS exigen una sesión aal2 (TOTP verificado); con solo contraseña no ve nada.
--      (La API ya exige aal2 para sus acciones administrativas; esto cierra el mismo hueco en las lecturas directas.)
--  (2) fel_bootstrap_primer_maestro: único camino para crear al primer administrador maestro, ejecutable SOLO por el
--      propietario de la base de datos (consola SQL). Nadie más: ni service_role, ni authenticated, ni anon.

create or replace function public.fel_es_admin_plataforma() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.fel_usuario_activo(auth.uid())
     and exists (select 1 from public.plataforma_admins pa where pa.user_id = auth.uid())
     and coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'aal', '') = 'aal2'
$$;

create or replace function public.fel_bootstrap_primer_maestro(p_email text, p_permitir_adicional boolean default false)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_conf timestamptz; v_mail text := lower(btrim(coalesce(p_email, '')));
begin
  select u.id, u.email_confirmed_at into v_user, v_conf from auth.users u where lower(u.email) = v_mail;
  if v_user is null then
    raise exception 'FEL_NO_ENCONTRADO: no existe un usuario en Auth con ese correo; créalo primero con una invitación';
  end if;
  if v_conf is null then
    raise exception 'FEL_REGLA: el correo del usuario todavía no está confirmado';
  end if;
  if not exists (select 1 from auth.mfa_factors f
                  where f.user_id = v_user and f.factor_type::text = 'totp' and f.status::text = 'verified') then
    raise exception 'FEL_REGLA: el usuario aún no tiene un factor TOTP verificado; debe activar la verificación en dos pasos antes';
  end if;
  if public.fel_estado_cuenta(v_user) = 'bloqueada' then
    raise exception 'FEL_REGLA: la cuenta está desactivada; no se convierte en administrador maestro';
  end if;
  if exists (select 1 from public.plataforma_admins) and not coalesce(p_permitir_adicional, false) then
    raise exception 'FEL_REGLA: ya existe un administrador maestro; para agregar otro hay que indicarlo expresamente';
  end if;
  insert into public.perfiles (user_id) values (v_user) on conflict (user_id) do nothing;
  insert into public.plataforma_admins (user_id) values (v_user) on conflict (user_id) do nothing;
  perform public.fel_auditar(null, v_user, 'plataforma.maestro_creado', 'plataforma', v_user::text,
    jsonb_build_object('email', v_mail, 'adicional', coalesce(p_permitir_adicional, false)), 'sql');
  return v_user;
end $$;

revoke all on function public.fel_bootstrap_primer_maestro(text, boolean) from public, anon, authenticated, service_role;
