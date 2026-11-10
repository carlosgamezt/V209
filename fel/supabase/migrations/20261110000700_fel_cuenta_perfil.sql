-- NEXA FEL · Fase 1.0 · cuenta sin perfil = SIN acceso.
-- Antes, una cuenta sin fila en perfiles se consideraba activa. Ahora una cuenta solo está "activa" si tiene perfil activo.
-- La ÚNICA excepción es aceptar una invitación vigente: esa operación (fel_op_invitacion_aceptar) es la que crea el perfil,
-- y solo si la cuenta tiene un correo confirmado que coincide con una invitación pendiente y no vencida.
-- Primer administrador maestro: debe crearse su usuario en Auth, su fila en perfiles y su fila en plataforma_admins.

create or replace function public.fel_estado_cuenta(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when p_user is null then 'sin_perfil'
         else coalesce((select case when pf.activo then 'activa' else 'bloqueada' end
                          from public.perfiles pf where pf.user_id = p_user), 'sin_perfil') end
$$;

create or replace function public.fel_usuario_activo(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.fel_estado_cuenta(p_user) = 'activa'
$$;

-- Las funciones que usan las políticas RLS y las operaciones exigen cuenta activa (con perfil).
create or replace function public.fel_es_admin_plataforma() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.fel_usuario_activo(auth.uid())
     and exists (select 1 from public.plataforma_admins pa where pa.user_id = auth.uid())
$$;

create or replace function public.fel_permisos_efectivos(p_empresa uuid, p_user uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select array(
      select distinct x.p from (
        select rp.permiso as p from public.rol_permisos rp where rp.rol = m.rol
        union
        select unnest(m.permisos_extra)
      ) x
      where x.p <> all (m.permisos_revocados)
      order by 1)
    from public.miembros m
    join public.empresas e on e.id = m.empresa_id and e.estado = 'habilitada'
    where m.empresa_id = p_empresa and m.user_id = p_user and m.activo
      and public.fel_usuario_activo(m.user_id)
  ), '{}'::text[])
$$;

create or replace function public.fel_es_miembro(p_empresa uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.miembros m
    join public.empresas e on e.id = m.empresa_id and e.estado = 'habilitada'
    where m.empresa_id = p_empresa and m.user_id = auth.uid() and m.activo
      and public.fel_usuario_activo(m.user_id))
$$;

create or replace function public.fel__exigir_plataforma(p_actor uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_actor is null or not public.fel_es_plataforma(p_actor) then
    raise exception 'FEL_NO_AUTORIZADO: solo el administrador maestro puede hacer esto';
  end if;
end $$;

-- Aceptar invitaciones: única operación que puede ejecutar una cuenta sin perfil.
--  · El correo se toma de Auth (no del cliente) y debe estar confirmado; p_email solo se contrasta.
--  · Sin perfil, exige al menos una invitación pendiente y no vencida; si no, no crea nada.
--  · Una cuenta bloqueada nunca se reactiva por esta vía.
create or replace function public.fel_op_invitacion_aceptar(p_user uuid, p_email text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v public.invitaciones; n integer := 0; v_mail text; v_conf timestamptz; v_estado text; v_validas integer;
begin
  if p_user is null then raise exception 'FEL_NO_AUTORIZADO: no tienes una invitación vigente'; end if;
  select lower(btrim(u.email)), u.email_confirmed_at into v_mail, v_conf from auth.users u where u.id = p_user;
  if v_mail is null or v_conf is null or v_mail <> lower(btrim(coalesce(p_email, ''))) then
    raise exception 'FEL_NO_AUTORIZADO: no tienes una invitación vigente';
  end if;
  v_estado := public.fel_estado_cuenta(p_user);
  if v_estado = 'bloqueada' then raise exception 'FEL_NO_AUTORIZADO: la cuenta está desactivada'; end if;
  select count(*) into v_validas from public.invitaciones where email = v_mail and estado = 'pendiente' and expira_en > now();
  if v_validas = 0 and v_estado = 'sin_perfil' then
    raise exception 'FEL_NO_AUTORIZADO: no tienes una invitación vigente';
  end if;
  update public.invitaciones set estado = 'vencida' where email = v_mail and estado = 'pendiente' and expira_en <= now();
  if v_validas = 0 then return 0; end if;
  insert into public.perfiles (user_id) values (p_user) on conflict (user_id) do nothing;
  for v in select * from public.invitaciones where email = v_mail and estado = 'pendiente' and expira_en > now() for update loop
    insert into public.miembros (empresa_id, user_id, rol, permisos_extra, invitado_por)
    values (v.empresa_id, p_user, v.rol, v.permisos_extra, v.invitado_por)
    on conflict (empresa_id, user_id) do update
      set rol = excluded.rol, permisos_extra = excluded.permisos_extra, permisos_revocados = '{}', activo = true;
    update public.invitaciones set estado = 'aceptada', aceptada_en = now(), user_id = p_user where id = v.id;
    perform public.fel_auditar(v.empresa_id, p_user, 'invitacion.aceptar', 'invitacion', v.id::text,
      jsonb_build_object('rol', v.rol, 'email', v_mail));
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.fel_estado_cuenta(uuid) from public, anon, authenticated;
grant execute on function public.fel_estado_cuenta(uuid) to service_role;
