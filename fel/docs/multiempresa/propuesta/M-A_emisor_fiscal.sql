-- M-A · Configuración fiscal por empresa: versiones del emisor (inmutables al aprobarse) y dirección completa de los establecimientos (PROPUESTA; NO se aplica sin autorización).
-- Requiere M-D (permisos). Aditiva: no modifica ninguna función, política ni dato de las migraciones 1 a 30.
alter table public.establecimientos
  add column if not exists codigo_postal text check (codigo_postal is null or codigo_postal ~ '^[0-9]{5}$'),
  add column if not exists municipio     text check (municipio is null or length(btrim(municipio)) between 1 and 80),
  add column if not exists departamento  text check (departamento is null or length(btrim(departamento)) between 1 and 80);

create table public.empresa_emisor_versiones (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references public.empresas (id),
  establecimiento_id uuid not null,
  version          integer not null check (version >= 1),
  nit              text not null check (nit ~ '^[0-9]{1,12}$'),
  nombre_fiscal    text not null check (length(btrim(nombre_fiscal)) between 1 and 200),
  nombre_comercial text check (nombre_comercial is null or length(nombre_comercial) <= 200),
  afiliacion_iva   text not null check (afiliacion_iva ~ '^[A-Z]{3}$'),
  frases           jsonb not null default '[]' check (jsonb_typeof(frases) = 'array'),
  correo           text check (correo is null or correo ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  codigo_establecimiento integer not null check (codigo_establecimiento >= 1),
  direccion        text not null check (length(btrim(direccion)) between 1 and 300),
  codigo_postal    text not null check (codigo_postal ~ '^[0-9]{5}$'),
  municipio        text not null check (length(btrim(municipio)) between 1 and 80),
  departamento     text not null check (length(btrim(departamento)) between 1 and 80),
  huella           text not null check (huella ~ '^[0-9a-f]{16}$'),
  estado           text not null default 'borrador' check (estado in ('borrador','aprobada','reemplazada')),
  creado_por       uuid not null references auth.users (id),
  creado_en        timestamptz not null default now(),
  aprobado_por     uuid references auth.users (id),
  aprobado_en      timestamptz,
  unique (empresa_id, establecimiento_id, version),
  foreign key (establecimiento_id, empresa_id) references public.establecimientos (id, empresa_id),   -- un emisor jamás apunta al establecimiento de otra empresa
  check ((estado = 'borrador') = (aprobado_por is null and aprobado_en is null))
);
create unique index empresa_emisor_vigente_uq on public.empresa_emisor_versiones (empresa_id, establecimiento_id) where estado = 'aprobada';   -- UN emisor aprobado vigente por establecimiento
create unique index empresa_emisor_borrador_uq on public.empresa_emisor_versiones (empresa_id, establecimiento_id) where estado = 'borrador';
alter table public.empresa_emisor_versiones enable row level security;
revoke all on public.empresa_emisor_versiones from public, anon, authenticated;
grant select on public.empresa_emisor_versiones to authenticated;
create policy emisor_versiones_leer on public.empresa_emisor_versiones for select to authenticated using (public.fel_tiene_permiso(empresa_id, 'fiscal.ver'));

-- Una versión aprobada es inmutable: solo puede pasar de «aprobada» a «reemplazada»; nunca se borra.
create or replace function public.fel_emisor_inmutable() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.estado <> 'borrador' then raise exception 'FEL_REGLA: una versión aprobada del emisor no se borra'; end if;
    return old;
  end if;
  if old.estado <> 'borrador' then
    if not (old.estado = 'aprobada' and new.estado = 'reemplazada'
            and (to_jsonb(new) - 'estado') = (to_jsonb(old) - 'estado')) then
      raise exception 'FEL_REGLA: una versión aprobada del emisor es inmutable';
    end if;
  end if;
  return new;
end $$;
create trigger empresa_emisor_inmutable before update or delete on public.empresa_emisor_versiones for each row execute function public.fel_emisor_inmutable();

create or replace function public.fel_op_emisor_guardar(
  p_actor uuid, p_empresa uuid, p_establecimiento uuid, p_nit text, p_nombre_fiscal text, p_nombre_comercial text, p_afiliacion_iva text, p_frases jsonb, p_correo text,
  p_direccion text, p_codigo_postal text, p_municipio text, p_departamento text, p_huella text) returns public.empresa_emisor_versiones
language plpgsql security definer set search_path = '' as $$
declare v_ver integer; v_cod text; r public.empresa_emisor_versiones;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'fiscal.configurar');
  select codigo_sat into v_cod from public.establecimientos where id = p_establecimiento and empresa_id = p_empresa and estado = 'activo';
  if not found then raise exception 'FEL_REGLA: establecimiento no válido para esta empresa'; end if;
  if v_cod !~ '^[0-9]{1,4}$' then raise exception 'FEL_REGLA: el código SAT del establecimiento debe ser numérico (1 a 4 dígitos) para el emisor de Digifact'; end if;
  delete from public.empresa_emisor_versiones where empresa_id = p_empresa and establecimiento_id = p_establecimiento and estado = 'borrador';   -- un solo borrador a la vez por establecimiento
  select coalesce(max(version), 0) + 1 into v_ver from public.empresa_emisor_versiones where empresa_id = p_empresa and establecimiento_id = p_establecimiento;
  insert into public.empresa_emisor_versiones (empresa_id, establecimiento_id, version, nit, nombre_fiscal, nombre_comercial, afiliacion_iva, frases, correo, codigo_establecimiento, direccion, codigo_postal, municipio, departamento, huella, creado_por)
  values (p_empresa, p_establecimiento, v_ver, p_nit, p_nombre_fiscal, p_nombre_comercial, p_afiliacion_iva, coalesce(p_frases, '[]'::jsonb), p_correo, v_cod::integer, p_direccion, p_codigo_postal, p_municipio, p_departamento, p_huella, p_actor)
  returning * into r;
  perform public.fel_auditar(p_empresa, p_actor, 'emisor.guardar', 'emisor', r.id::text, jsonb_build_object('establecimiento', p_establecimiento, 'version', r.version, 'huella', r.huella));
  return r;
end $$;

-- Quien aprueba confirma la huella que vio: si no coincide con la guardada, no se aprueba.
create or replace function public.fel_op_emisor_aprobar(p_actor uuid, p_empresa uuid, p_establecimiento uuid, p_version integer, p_huella text) returns public.empresa_emisor_versiones
language plpgsql security definer set search_path = '' as $$
declare r public.empresa_emisor_versiones;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'fiscal.aprobar_emisor');
  select * into r from public.empresa_emisor_versiones where empresa_id = p_empresa and establecimiento_id = p_establecimiento and version = p_version for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: versión del emisor no encontrada'; end if;
  if r.estado <> 'borrador' then raise exception 'FEL_REGLA: solo se aprueba un borrador'; end if;
  if r.huella <> p_huella then raise exception 'FEL_REGLA: la huella confirmada no coincide con la de los datos guardados'; end if;
  update public.empresa_emisor_versiones set estado = 'reemplazada' where empresa_id = p_empresa and establecimiento_id = p_establecimiento and estado = 'aprobada';
  update public.empresa_emisor_versiones set estado = 'aprobada', aprobado_por = p_actor, aprobado_en = now() where id = r.id returning * into r;
  perform public.fel_auditar(p_empresa, p_actor, 'emisor.aprobar', 'emisor', r.id::text, jsonb_build_object('establecimiento', p_establecimiento, 'version', r.version, 'huella', r.huella));
  return r;
end $$;

-- Lectura para el servicio (resolvedor de Digifact): el emisor aprobado vigente, sin pasar por el usuario.
create or replace function public.fel_sys_emisor_vigente(p_empresa uuid) returns setof public.empresa_emisor_versiones
language sql stable security definer set search_path = '' as $$
  select * from public.empresa_emisor_versiones where empresa_id = p_empresa and estado = 'aprobada'
$$;

revoke all on function public.fel_emisor_inmutable() from public, anon, authenticated;
revoke all on function public.fel_op_emisor_guardar(uuid, uuid, uuid, text, text, text, text, jsonb, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.fel_op_emisor_aprobar(uuid, uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.fel_sys_emisor_vigente(uuid) from public, anon, authenticated;
grant execute on function public.fel_op_emisor_guardar(uuid, uuid, uuid, text, text, text, text, jsonb, text, text, text, text, text, text) to service_role;
grant execute on function public.fel_op_emisor_aprobar(uuid, uuid, uuid, integer, text) to service_role;
grant execute on function public.fel_sys_emisor_vigente(uuid) to service_role;
