-- Funciones de autorización y protecciones
create or replace function public.fel__rango(p_rol text) returns integer
language sql immutable set search_path = '' as $$
  select case p_rol when 'propietario' then 4 when 'administrador' then 3 when 'emisor' then 2 when 'lector' then 1 else 0 end
$$;

create or replace function public.fel_es_admin_plataforma() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.plataforma_admins pa where pa.user_id = auth.uid())
     and not exists (select 1 from public.perfiles pf where pf.user_id = auth.uid() and not pf.activo)
$$;

-- Permisos efectivos = permisos del rol + extras - revocados. Solo si la membresía y la empresa están activas/habilitadas.
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
      and not exists (select 1 from public.perfiles pf where pf.user_id = m.user_id and not pf.activo)
  ), '{}'::text[])
$$;

create or replace function public.fel_tiene_permiso(p_empresa uuid, p_permiso text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_permiso = any (public.fel_permisos_efectivos(p_empresa, auth.uid()))
$$;

create or replace function public.fel_es_miembro(p_empresa uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.miembros m
    join public.empresas e on e.id = m.empresa_id and e.estado = 'habilitada'
    where m.empresa_id = p_empresa and m.user_id = auth.uid() and m.activo
      and not exists (select 1 from public.perfiles pf where pf.user_id = m.user_id and not pf.activo))
$$;

-- Auditoría: única vía de escritura. Registra usuario, empresa, acción, fecha y hora (servidor) y datos relevantes.
create or replace function public.fel_auditar(
  p_empresa uuid, p_actor uuid, p_accion text, p_entidad text, p_entidad_id text,
  p_datos jsonb default '{}'::jsonb, p_origen text default 'fel-api') returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_email text;
begin
  select email into v_email from auth.users where id = p_actor;
  insert into public.auditoria (empresa_id, actor_user_id, actor_email, accion, entidad, entidad_id, datos, origen)
  values (p_empresa, p_actor, v_email, p_accion, p_entidad, p_entidad_id, coalesce(p_datos, '{}'::jsonb), p_origen)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.fel_siguiente_borrador(p_empresa uuid) returns integer
create or replace function public.fel__exigir_permiso(p_actor uuid, p_empresa uuid, p_permiso text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_actor is null or not (p_permiso = any (public.fel_permisos_efectivos(p_empresa, p_actor))) then
    raise exception 'FEL_NO_AUTORIZADO: no tienes permiso para esta operación';
  end if;
end $$;
