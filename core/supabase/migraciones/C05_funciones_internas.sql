-- NEXA CORE · C05 · funciones internas del esquema core (no ejecutables por nadie salvo el propietario): identidad real, vigencia de módulos, permisos efectivos, auditoría, eventos y manifiestos de módulo.
begin;
create or replace function core.param(p_clave text) returns numeric language sql stable security definer set search_path = '' as $$ select valor from core.parametros where clave = p_clave $$;

-- Identidad: auth.uid() + sesión VIVA en auth.sessions (revocación inmediata) + perfil activo; aal2 real (token y sesión).
create or replace function core.ctx(out o_user uuid, out o_sesion uuid, out o_aal2 boolean) language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); sid uuid; s_aal text; claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
begin
  if uid is null then raise exception 'CORE_NO_AUTENTICADO' using errcode = '28000'; end if;
  begin sid := (claims ->> 'session_id')::uuid; exception when others then sid := null; end;
  select s.aal::text into s_aal from auth.sessions s where s.id = sid and s.user_id = uid and (s.not_after is null or s.not_after > now());
  if not found then raise exception 'CORE_SESION_NO_VIVA' using errcode = '28000'; end if;
  if not exists (select 1 from core.perfiles p where p.user_id = uid and p.activo) then raise exception 'CORE_PERFIL_INACTIVO' using errcode = '28000'; end if;
  o_user := uid; o_sesion := sid; o_aal2 := (claims ->> 'aal') = 'aal2' and s_aal = 'aal2';
end $$;

create or replace function core.exigir_plataforma(p_maestro boolean default false) returns uuid language plpgsql stable security definer set search_path = '' as $$
declare c record; n text;
begin
  select * into c from core.ctx();
  select a.nivel into n from core.plataforma_admins a where a.user_id = c.o_user and a.activo;
  if n is null or (p_maestro and n <> 'maestro') then raise exception 'CORE_PLATAFORMA_REQUERIDA' using errcode = '42501'; end if;
  if core.param('plataforma_mfa_obligatoria') = 1 and not c.o_aal2 then raise exception 'CORE_MFA_REQUERIDA' using errcode = '42501'; end if;
  return c.o_user;
end $$;

-- ¿El módulo está vigente para la empresa? activo + suscripción vigente (con gracia) que lo incluya, o activación manual (plataforma).
create or replace function core.modulo_vigente(p_empresa uuid, p_modulo text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from core.empresa_modulos em
    where em.empresa_id = p_empresa and em.modulo = p_modulo and em.estado = 'activo'
      and (em.origen = 'manual' or exists (
        select 1 from core.suscripciones s join core.plan_modulos pm on pm.plan_codigo = s.plan_codigo and pm.modulo = em.modulo
        where s.empresa_id = em.empresa_id and s.estado in ('prueba', 'activa')
          and s.inicia_en <= now() and (s.vence_en is null or s.vence_en + make_interval(days => core.param('suscripcion_gracia_dias')::int) > now())))
  )
$$;

-- Permisos efectivos de una persona en una empresa y módulo = permisos de sus roles + concedidos − revocados. Vacío si la empresa o la membresía no están activas, o el módulo no está vigente.
create or replace function core.permisos_de(p_empresa uuid, p_user uuid, p_modulo text) returns text[] language sql stable security definer set search_path = '' as $$
  select case
    when not exists (select 1 from core.membresias m join core.empresas e on e.id = m.empresa_id where m.empresa_id = p_empresa and m.user_id = p_user and m.estado = 'activa' and e.estado = 'activa') then '{}'::text[]
    when p_modulo <> 'core' and not core.modulo_vigente(p_empresa, p_modulo) then '{}'::text[]
    else coalesce((
      select array_agg(distinct x.codigo order by x.codigo) from (
        select rp.permiso_codigo as codigo from core.membresia_roles mr join core.roles r on r.id = mr.rol_id join core.rol_permisos rp on rp.rol_id = r.id
         where mr.empresa_id = p_empresa and mr.user_id = p_user and r.modulo = p_modulo and rp.permiso_modulo = p_modulo
        union
        select e.codigo from core.membresia_permisos e where e.empresa_id = p_empresa and e.user_id = p_user and e.modulo = p_modulo and e.efecto = 'conceder'
      ) x
      where not exists (select 1 from core.membresia_permisos v where v.empresa_id = p_empresa and v.user_id = p_user and v.modulo = p_modulo and v.codigo = x.codigo and v.efecto = 'revocar')
    ), '{}'::text[])
  end
$$;

create or replace function core.exigir(p_empresa uuid, p_modulo text, p_codigo text) returns uuid language plpgsql stable security definer set search_path = '' as $$
declare c record;
begin
  select * into c from core.ctx();
  if not (p_codigo = any (core.permisos_de(p_empresa, c.o_user, p_modulo))) then raise exception 'CORE_SIN_PERMISO' using errcode = '42501'; end if;
  return c.o_user;
end $$;

create or replace function core.auditar(p_empresa uuid, p_accion text, p_entidad text, p_entidad_id text, p_antes jsonb default null, p_despues jsonb default null, p_origen text default 'api') returns void language sql security definer set search_path = '' as $$
  insert into core.auditoria (empresa_id, actor_user_id, origen, accion, entidad, entidad_id, antes, despues) values (p_empresa, auth.uid(), p_origen, p_accion, p_entidad, p_entidad_id, p_antes, p_despues)
$$;
create or replace function core.evento(p_tipo text, p_empresa uuid, p_modulo text default null, p_payload jsonb default '{}'::jsonb) returns void language sql security definer set search_path = '' as $$
  insert into core.eventos (tipo, empresa_id, modulo, payload) values (p_tipo, p_empresa, p_modulo, coalesce(p_payload, '{}'::jsonb))
$$;
create or replace function core.es_propietario(p_empresa uuid, p_user uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from core.membresia_roles mr join core.roles r on r.id = mr.rol_id join core.membresias m on m.empresa_id = mr.empresa_id and m.user_id = mr.user_id
                 where mr.empresa_id = p_empresa and mr.user_id = p_user and r.modulo = 'core' and r.codigo = 'propietario' and m.estado = 'activa')
$$;
create or replace function core.otros_propietarios(p_empresa uuid, p_user uuid) returns int language sql stable security definer set search_path = '' as $$
  select count(distinct mr.user_id)::int from core.membresia_roles mr join core.roles r on r.id = mr.rol_id join core.membresias m on m.empresa_id = mr.empresa_id and m.user_id = mr.user_id
  where mr.empresa_id = p_empresa and mr.user_id <> p_user and r.modulo = 'core' and r.codigo = 'propietario' and m.estado = 'activa'
$$;
-- Valida y resuelve una lista [{modulo,codigo}] a ids de rol (plantilla global o rol propio de la empresa); el módulo debe ser core o estar vigente.
create or replace function core.resolver_roles(p_empresa uuid, p_roles jsonb) returns uuid[] language plpgsql stable security definer set search_path = '' as $$
declare x jsonb; rid uuid; out uuid[] := '{}';
begin
  if jsonb_typeof(coalesce(p_roles, '[]'::jsonb)) <> 'array' then raise exception 'CORE_ROLES_INVALIDOS' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_roles, '[]'::jsonb)) loop
    if (x ->> 'modulo') <> 'core' and not core.modulo_vigente(p_empresa, x ->> 'modulo') then raise exception 'CORE_MODULO_NO_VIGENTE: %', x ->> 'modulo' using errcode = '22023'; end if;
    select r.id into rid from core.roles r where r.modulo = x ->> 'modulo' and r.codigo = x ->> 'codigo' and (r.empresa_id = p_empresa or r.empresa_id is null) order by r.empresa_id nulls last limit 1;
    if rid is null then raise exception 'CORE_ROL_INEXISTENTE: %.%', x ->> 'modulo', x ->> 'codigo' using errcode = '22023'; end if;
    out := out || rid;
  end loop;
  return out;
end $$;

-- Manifiesto de módulo: lo que un módulo declara (permisos, roles plantilla, eventos). Idempotente.
create or replace function core.registrar_manifiesto(p_m jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare m text := p_m ->> 'modulo'; x jsonb; rid uuid;
begin
  if m is null or m !~ '^[a-z][a-z0-9_]{1,19}$' then raise exception 'CORE_MANIFIESTO_INVALIDO: modulo' using errcode = '22023'; end if;
  insert into core.modulos (codigo, nombre, descripcion, estado, version_api, aprovisionable)
  values (m, coalesce(p_m ->> 'nombre', m), p_m ->> 'descripcion', coalesce(p_m ->> 'estado', 'activo'), coalesce((p_m ->> 'version_api')::int, 1), coalesce((p_m ->> 'aprovisionable')::boolean, true))
  on conflict (codigo) do update set nombre = excluded.nombre, descripcion = excluded.descripcion, estado = excluded.estado, version_api = excluded.version_api, aprovisionable = excluded.aprovisionable;
  for x in select * from jsonb_array_elements(coalesce(p_m -> 'permisos', '[]'::jsonb)) loop
    insert into core.permisos (modulo, codigo, descripcion, sensible, solo_plataforma)
    values (m, x ->> 'codigo', coalesce(x ->> 'descripcion', '-'), coalesce((x ->> 'sensible')::boolean, false), coalesce((x ->> 'solo_plataforma')::boolean, false))
    on conflict (modulo, codigo) do update set descripcion = excluded.descripcion, sensible = excluded.sensible, solo_plataforma = excluded.solo_plataforma;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p_m -> 'roles', '[]'::jsonb)) loop
    insert into core.roles (empresa_id, modulo, codigo, nombre, sistema) values (null, m, x ->> 'codigo', coalesce(x ->> 'nombre', x ->> 'codigo'), true)
    on conflict (coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid), modulo, codigo) do update set nombre = excluded.nombre;
    select r.id into rid from core.roles r where r.empresa_id is null and r.modulo = m and r.codigo = x ->> 'codigo';
    delete from core.rol_permisos where rol_id = rid;
    insert into core.rol_permisos (rol_id, permiso_modulo, permiso_codigo) select rid, m, p from jsonb_array_elements_text(coalesce(x -> 'permisos', '[]'::jsonb)) p;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p_m -> 'eventos', '[]'::jsonb)) loop
    insert into core.evento_tipos (tipo, descripcion, modulo) values (x ->> 'tipo', coalesce(x ->> 'descripcion', '-'), m)
    on conflict (tipo) do update set descripcion = excluded.descripcion;
  end loop;
end $$;

-- Perfil automático al registrarse una persona en Supabase Auth.
create or replace function core.perfil_nuevo() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into core.perfiles (user_id, nombre) values (new.id, coalesce(new.raw_user_meta_data ->> 'nombre', split_part(new.email, '@', 1))) on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists core_perfil_nuevo on auth.users;
create trigger core_perfil_nuevo after insert on auth.users for each row execute function core.perfil_nuevo();
commit;
