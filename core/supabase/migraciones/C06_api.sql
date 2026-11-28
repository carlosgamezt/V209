-- NEXA CORE · C06 · API estable: esquema `api` (personas autenticadas, con identidad real y permisos por empresa y módulo) y `core_sys` (módulos y procesos; el módulo se identifica con la reclamación `modulo` del token).
-- Toda función es SECURITY DEFINER con search_path vacío, valida identidad y permiso antes de leer o escribir, y deja auditoría y eventos. Sin acceso directo a tablas.
begin;

-- ====== personas ======
create or replace function api.mi_contexto() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c record; r jsonb;
begin
  select * into c from core.ctx();
  select jsonb_build_object('user_id', c.o_user, 'nombre', p.nombre, 'aal2', c.o_aal2,
    'plataforma', exists (select 1 from core.plataforma_admins a where a.user_id = c.o_user and a.activo),
    'empresas', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'nombre', e.nombre_comercial, 'estado', e.estado,
        'roles', coalesce((select jsonb_agg(distinct r2.modulo || '.' || r2.codigo) from core.membresia_roles mr join core.roles r2 on r2.id = mr.rol_id where mr.empresa_id = e.id and mr.user_id = c.o_user), '[]'::jsonb),
        'modulos', coalesce((select jsonb_agg(em.modulo order by em.modulo) from core.empresa_modulos em where em.empresa_id = e.id and core.modulo_vigente(e.id, em.modulo)), '[]'::jsonb)) order by e.nombre_comercial)
      from core.membresias m join core.empresas e on e.id = m.empresa_id where m.user_id = c.o_user and m.estado = 'activa'), '[]'::jsonb))
  into r from core.perfiles p where p.user_id = c.o_user;
  return r;
end $$;

create or replace function api.permisos(p_empresa uuid, p_modulo text) returns text[] language plpgsql stable security definer set search_path = '' as $$
declare c record;
begin select * into c from core.ctx(); return core.permisos_de(p_empresa, c.o_user, p_modulo); end $$;

create or replace function api.verificar_acceso(p_empresa uuid, p_modulo text, p_permiso text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c record; e text;
begin
  select * into c from core.ctx();
  select e2.estado into e from core.membresias m join core.empresas e2 on e2.id = m.empresa_id where m.empresa_id = p_empresa and m.user_id = c.o_user and m.estado = 'activa';
  if not found then return jsonb_build_object('permitido', false, 'motivo', 'sin_membresia'); end if;
  if e <> 'activa' then return jsonb_build_object('permitido', false, 'motivo', 'empresa_inactiva'); end if;
  if p_modulo <> 'core' and not core.modulo_vigente(p_empresa, p_modulo) then return jsonb_build_object('permitido', false, 'motivo', 'modulo_no_vigente'); end if;
  if not (p_permiso = any (core.permisos_de(p_empresa, c.o_user, p_modulo))) then return jsonb_build_object('permitido', false, 'motivo', 'sin_permiso'); end if;
  return jsonb_build_object('permitido', true, 'motivo', 'ok');
end $$;

create or replace function api.empresa_registrar(p_nombre text, p_razon text default null, p_nit text default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare c record; eid uuid; rid uuid;
begin
  select * into c from core.ctx();
  if core.param('registro_publico') <> 1 then raise exception 'CORE_REGISTRO_NO_HABILITADO' using errcode = '42501'; end if;
  insert into core.empresas (nombre_comercial, razon_social, nit, creado_por) values (p_nombre, p_razon, p_nit, c.o_user) returning id into eid;
  insert into core.membresias (empresa_id, user_id, invitado_por) values (eid, c.o_user, c.o_user);
  select r.id into rid from core.roles r where r.empresa_id is null and r.modulo = 'core' and r.codigo = 'propietario';
  insert into core.membresia_roles (empresa_id, user_id, rol_id) values (eid, c.o_user, rid);
  perform core.auditar(eid, 'empresa_registrada', 'empresa', eid::text, null, jsonb_build_object('nombre', p_nombre));
  perform core.evento('empresa_creada', eid, null, jsonb_build_object('nombre', p_nombre));
  return eid;
end $$;

create or replace function api.invitacion_crear(p_empresa uuid, p_email text, p_roles jsonb default '[]'::jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare u uuid; iid uuid; ids uuid[]; x uuid; es_prop boolean;
begin
  u := core.exigir(p_empresa, 'core', 'miembros.gestionar');
  ids := core.resolver_roles(p_empresa, p_roles);
  foreach x in array ids loop
    if exists (select 1 from core.roles r where r.id = x and r.modulo = 'core' and r.codigo = 'propietario') and not core.es_propietario(p_empresa, u) then raise exception 'CORE_SOLO_PROPIETARIO_NOMBRA_PROPIETARIO' using errcode = '42501'; end if;
  end loop;
  insert into core.invitaciones (empresa_id, email, roles, invitado_por, expira_en) values (p_empresa, lower(btrim(p_email)), coalesce(p_roles, '[]'::jsonb), u, now() + make_interval(days => core.param('invitacion_dias')::int)) returning id into iid;
  perform core.auditar(p_empresa, 'invitacion_creada', 'invitacion', iid::text, null, jsonb_build_object('email', lower(btrim(p_email)), 'roles', p_roles));
  return iid;
end $$;

create or replace function api.invitacion_aceptar(p_id uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare c record; inv core.invitaciones%rowtype; mail text; ids uuid[]; x uuid;
begin
  select * into c from core.ctx();
  select * into inv from core.invitaciones where id = p_id and estado = 'pendiente' for update;
  if not found then raise exception 'CORE_INVITACION_NO_VALIDA' using errcode = '22023'; end if;
  if inv.expira_en <= now() then update core.invitaciones set estado = 'vencida' where id = p_id; raise exception 'CORE_INVITACION_VENCIDA' using errcode = '22023'; end if;
  select lower(u.email) into mail from auth.users u where u.id = c.o_user;
  if mail is distinct from inv.email then raise exception 'CORE_INVITACION_AJENA' using errcode = '42501'; end if;
  insert into core.membresias (empresa_id, user_id, invitado_por) values (inv.empresa_id, c.o_user, inv.invitado_por)
  on conflict (empresa_id, user_id) do update set estado = 'activa', actualizado_en = now();
  ids := core.resolver_roles(inv.empresa_id, inv.roles);
  foreach x in array ids loop insert into core.membresia_roles (empresa_id, user_id, rol_id) values (inv.empresa_id, c.o_user, x) on conflict do nothing; end loop;
  update core.invitaciones set estado = 'aceptada', user_id = c.o_user, aceptada_en = now() where id = p_id;
  perform core.auditar(inv.empresa_id, 'invitacion_aceptada', 'invitacion', p_id::text, null, jsonb_build_object('user_id', c.o_user));
  perform core.evento('miembro_agregado', inv.empresa_id, null, jsonb_build_object('user_id', c.o_user));
  return inv.empresa_id;
end $$;

create or replace function api.miembro_roles_asignar(p_empresa uuid, p_user uuid, p_roles jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare u uuid; ids uuid[]; x uuid; antes jsonb;
begin
  u := core.exigir(p_empresa, 'core', 'miembros.gestionar');
  if not exists (select 1 from core.membresias where empresa_id = p_empresa and user_id = p_user) then raise exception 'CORE_MIEMBRO_INEXISTENTE' using errcode = '22023'; end if;
  ids := core.resolver_roles(p_empresa, p_roles);
  foreach x in array ids loop
    if exists (select 1 from core.roles r where r.id = x and r.modulo = 'core' and r.codigo = 'propietario') and not core.es_propietario(p_empresa, u) then raise exception 'CORE_SOLO_PROPIETARIO_NOMBRA_PROPIETARIO' using errcode = '42501'; end if;
  end loop;
  if core.es_propietario(p_empresa, p_user) and core.otros_propietarios(p_empresa, p_user) = 0
     and not exists (select 1 from core.roles r where r.id = any (ids) and r.modulo = 'core' and r.codigo = 'propietario') then raise exception 'CORE_ULTIMO_PROPIETARIO' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(r.modulo || '.' || r.codigo order by r.modulo, r.codigo), '[]'::jsonb) into antes from core.membresia_roles mr join core.roles r on r.id = mr.rol_id where mr.empresa_id = p_empresa and mr.user_id = p_user;
  delete from core.membresia_roles where empresa_id = p_empresa and user_id = p_user;
  foreach x in array ids loop insert into core.membresia_roles (empresa_id, user_id, rol_id) values (p_empresa, p_user, x) on conflict do nothing; end loop;
  perform core.auditar(p_empresa, 'miembro_roles_cambiados', 'membresia', p_user::text, antes, p_roles);
  perform core.evento('miembro_roles_cambiados', p_empresa, null, jsonb_build_object('user_id', p_user));
end $$;

create or replace function api.miembro_estado(p_empresa uuid, p_user uuid, p_estado text) returns void language plpgsql security definer set search_path = '' as $$
declare u uuid; antes text;
begin
  u := core.exigir(p_empresa, 'core', 'miembros.gestionar');
  if p_estado not in ('activa', 'suspendida') then raise exception 'CORE_ESTADO_INVALIDO' using errcode = '22023'; end if;
  select estado into antes from core.membresias where empresa_id = p_empresa and user_id = p_user for update;
  if not found then raise exception 'CORE_MIEMBRO_INEXISTENTE' using errcode = '22023'; end if;
  if p_estado = 'suspendida' and core.es_propietario(p_empresa, p_user) and core.otros_propietarios(p_empresa, p_user) = 0 then raise exception 'CORE_ULTIMO_PROPIETARIO' using errcode = '22023'; end if;
  update core.membresias set estado = p_estado, actualizado_en = now() where empresa_id = p_empresa and user_id = p_user;
  perform core.auditar(p_empresa, 'miembro_estado_cambiado', 'membresia', p_user::text, to_jsonb(antes), to_jsonb(p_estado));
  perform core.evento('miembro_estado_cambiado', p_empresa, null, jsonb_build_object('user_id', p_user, 'estado', p_estado));
end $$;

create or replace function api.miembro_permiso(p_empresa uuid, p_user uuid, p_modulo text, p_codigo text, p_efecto text) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform core.exigir(p_empresa, 'core', 'miembros.gestionar');
  if not exists (select 1 from core.membresias where empresa_id = p_empresa and user_id = p_user) then raise exception 'CORE_MIEMBRO_INEXISTENTE' using errcode = '22023'; end if;
  if p_modulo <> 'core' and not core.modulo_vigente(p_empresa, p_modulo) then raise exception 'CORE_MODULO_NO_VIGENTE' using errcode = '22023'; end if;
  if p_efecto is null then
    delete from core.membresia_permisos where empresa_id = p_empresa and user_id = p_user and modulo = p_modulo and codigo = p_codigo;
  else
    if p_efecto not in ('conceder', 'revocar') then raise exception 'CORE_EFECTO_INVALIDO' using errcode = '22023'; end if;
    if not exists (select 1 from core.permisos where modulo = p_modulo and codigo = p_codigo and not solo_plataforma) then raise exception 'CORE_PERMISO_INEXISTENTE' using errcode = '22023'; end if;
    insert into core.membresia_permisos (empresa_id, user_id, modulo, codigo, efecto) values (p_empresa, p_user, p_modulo, p_codigo, p_efecto)
    on conflict (empresa_id, user_id, modulo, codigo) do update set efecto = excluded.efecto;
  end if;
  perform core.auditar(p_empresa, 'miembro_permiso_cambiado', 'membresia', p_user::text, null, jsonb_build_object('modulo', p_modulo, 'codigo', p_codigo, 'efecto', p_efecto));
end $$;

create or replace function api.rol_definir(p_empresa uuid, p_modulo text, p_codigo text, p_nombre text, p_permisos text[]) returns uuid language plpgsql security definer set search_path = '' as $$
declare rid uuid; p text;
begin
  perform core.exigir(p_empresa, 'core', 'roles.gestionar');
  if p_modulo <> 'core' and not core.modulo_vigente(p_empresa, p_modulo) then raise exception 'CORE_MODULO_NO_VIGENTE' using errcode = '22023'; end if;
  foreach p in array coalesce(p_permisos, '{}') loop
    if not exists (select 1 from core.permisos where modulo = p_modulo and codigo = p and not solo_plataforma) then raise exception 'CORE_PERMISO_INEXISTENTE: %', p using errcode = '22023'; end if;
  end loop;
  insert into core.roles (empresa_id, modulo, codigo, nombre, sistema) values (p_empresa, p_modulo, p_codigo, p_nombre, false)
  on conflict (coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid), modulo, codigo) do update set nombre = excluded.nombre
  returning id into rid;
  delete from core.rol_permisos where rol_id = rid;
  insert into core.rol_permisos (rol_id, permiso_modulo, permiso_codigo) select rid, p_modulo, x from unnest(coalesce(p_permisos, '{}')) x;
  perform core.auditar(p_empresa, 'rol_definido', 'rol', rid::text, null, jsonb_build_object('modulo', p_modulo, 'codigo', p_codigo, 'permisos', p_permisos));
  return rid;
end $$;

create or replace function api.config_leer(p_empresa uuid, p_modulo text, p_clave text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  perform core.exigir(p_empresa, 'core', 'config.ver');
  select c.valor into v from core.configuracion c where c.empresa_id = p_empresa and c.modulo is not distinct from p_modulo and c.clave = p_clave and c.ambito = case when p_modulo is null then 'empresa' else 'modulo' end;
  return v;
end $$;
create or replace function api.config_escribir(p_empresa uuid, p_modulo text, p_clave text, p_valor jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare u uuid; antes jsonb;
begin
  u := core.exigir(p_empresa, 'core', 'config.editar');
  if p_modulo is not null and not core.modulo_vigente(p_empresa, p_modulo) then raise exception 'CORE_MODULO_NO_VIGENTE' using errcode = '22023'; end if;
  select c.valor into antes from core.configuracion c where c.empresa_id = p_empresa and c.modulo is not distinct from p_modulo and c.clave = p_clave and c.ambito = case when p_modulo is null then 'empresa' else 'modulo' end;
  if antes is null then
    insert into core.configuracion (ambito, empresa_id, modulo, clave, valor, actualizado_por) values (case when p_modulo is null then 'empresa' else 'modulo' end, p_empresa, p_modulo, p_clave, p_valor, u);
  else
    update core.configuracion set valor = p_valor, actualizado_por = u, actualizado_en = now() where empresa_id = p_empresa and modulo is not distinct from p_modulo and clave = p_clave and ambito = case when p_modulo is null then 'empresa' else 'modulo' end;
  end if;
  perform core.auditar(p_empresa, 'config_cambiada', 'configuracion', coalesce(p_modulo, 'empresa') || '.' || p_clave, antes, p_valor);
  perform core.evento('config_cambiada', p_empresa, p_modulo, jsonb_build_object('clave', p_clave));
end $$;

create or replace function api.auditoria_listar(p_empresa uuid, p_desde bigint default null, p_limite int default 50) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform core.exigir(p_empresa, 'core', 'auditoria.ver');
  return coalesce((select jsonb_agg(to_jsonb(a) order by a.id desc) from (select id, ocurrido_en, actor_user_id, origen, accion, entidad, entidad_id, antes, despues from core.auditoria
     where empresa_id = p_empresa and (p_desde is null or id < p_desde) order by id desc limit least(greatest(coalesce(p_limite, 50), 1), 200)) a), '[]'::jsonb);
end $$;

-- activar / desactivar módulos de MI empresa (permiso core.modulos.gestionar): la activación real la completa el módulo con core_sys.aprov_completar.
create or replace function core.solicitar_modulo(p_empresa uuid, p_modulo text, p_accion text, p_origen text) returns uuid language plpgsql security definer set search_path = '' as $$
declare aid uuid; k text; m core.modulos%rowtype;
begin
  select * into m from core.modulos where codigo = p_modulo;
  if not found or m.estado = 'retirado' or not m.aprovisionable then raise exception 'CORE_MODULO_NO_DISPONIBLE' using errcode = '22023'; end if;
  if not exists (select 1 from core.empresas where id = p_empresa and estado = 'activa') then raise exception 'CORE_EMPRESA_INACTIVA' using errcode = '22023'; end if;
  if p_accion = 'activar' then
    if p_origen = 'plan' and not exists (select 1 from core.suscripciones s join core.plan_modulos pm on pm.plan_codigo = s.plan_codigo and pm.modulo = p_modulo
        where s.empresa_id = p_empresa and s.estado in ('prueba', 'activa') and s.inicia_en <= now() and (s.vence_en is null or s.vence_en + make_interval(days => core.param('suscripcion_gracia_dias')::int) > now())) then
      raise exception 'CORE_PLAN_NO_INCLUYE_MODULO' using errcode = '42501';
    end if;
    insert into core.empresa_modulos (empresa_id, modulo, estado, origen) values (p_empresa, p_modulo, 'solicitado', p_origen)
    on conflict (empresa_id, modulo) do update set estado = case when core.empresa_modulos.estado = 'activo' then 'activo' else 'solicitado' end, origen = excluded.origen, actualizado_en = now();
  else
    if not exists (select 1 from core.empresa_modulos where empresa_id = p_empresa and modulo = p_modulo) then raise exception 'CORE_MODULO_NO_ACTIVADO' using errcode = '22023'; end if;
    update core.empresa_modulos set estado = 'suspendido', actualizado_en = now() where empresa_id = p_empresa and modulo = p_modulo and estado in ('activo', 'solicitado', 'aprovisionando', 'error');
  end if;
  select id into aid from core.aprovisionamientos where empresa_id = p_empresa and modulo = p_modulo and accion = p_accion and estado in ('pendiente', 'en_proceso');
  if aid is null then
    k := p_empresa::text || ':' || p_modulo || ':' || p_accion || ':' || extract(epoch from clock_timestamp())::text;
    insert into core.aprovisionamientos (empresa_id, modulo, accion, clave) values (p_empresa, p_modulo, p_accion, k) returning id into aid;
    perform core.evento(case when p_accion = 'activar' then 'modulo_activacion_solicitada' else 'modulo_desactivacion_solicitada' end, p_empresa, p_modulo, jsonb_build_object('aprovisionamiento', aid));
    perform core.auditar(p_empresa, 'modulo_' || p_accion || '_solicitado', 'empresa_modulo', p_modulo, null, jsonb_build_object('aprovisionamiento', aid, 'origen', p_origen));
  end if;
  return aid;
end $$;
create or replace function api.modulo_activar(p_empresa uuid, p_modulo text) returns uuid language plpgsql security definer set search_path = '' as $$
begin perform core.exigir(p_empresa, 'core', 'modulos.gestionar'); return core.solicitar_modulo(p_empresa, p_modulo, 'activar', 'plan'); end $$;
create or replace function api.modulo_desactivar(p_empresa uuid, p_modulo text) returns uuid language plpgsql security definer set search_path = '' as $$
begin perform core.exigir(p_empresa, 'core', 'modulos.gestionar'); return core.solicitar_modulo(p_empresa, p_modulo, 'desactivar', 'plan'); end $$;

-- ====== plataforma (panel maestro): administradores sin membresías, con aal2 ======
create or replace function api.pla_empresa_crear(p_nombre text, p_razon text, p_nit text, p_propietario_email text) returns uuid language plpgsql security definer set search_path = '' as $$
declare u uuid; eid uuid; iid uuid;
begin
  u := core.exigir_plataforma();
  insert into core.empresas (nombre_comercial, razon_social, nit, creado_por) values (p_nombre, p_razon, p_nit, u) returning id into eid;
  insert into core.invitaciones (empresa_id, email, roles, invitado_por, expira_en)
  values (eid, lower(btrim(p_propietario_email)), '[{"modulo":"core","codigo":"propietario"}]'::jsonb, u, now() + make_interval(days => core.param('invitacion_dias')::int)) returning id into iid;
  perform core.auditar(eid, 'empresa_creada', 'empresa', eid::text, null, jsonb_build_object('nombre', p_nombre, 'invitacion', iid));
  perform core.evento('empresa_creada', eid, null, jsonb_build_object('nombre', p_nombre));
  return eid;
end $$;
create or replace function api.pla_empresa_estado(p_empresa uuid, p_estado text, p_motivo text default null) returns void language plpgsql security definer set search_path = '' as $$
declare antes text;
begin
  perform core.exigir_plataforma();
  if p_estado not in ('activa', 'suspendida', 'baja') then raise exception 'CORE_ESTADO_INVALIDO' using errcode = '22023'; end if;
  select estado into antes from core.empresas where id = p_empresa for update;
  if not found then raise exception 'CORE_EMPRESA_INEXISTENTE' using errcode = '22023'; end if;
  update core.empresas set estado = p_estado, actualizado_en = now() where id = p_empresa;
  perform core.auditar(p_empresa, 'empresa_estado_cambiado', 'empresa', p_empresa::text, to_jsonb(antes), jsonb_build_object('estado', p_estado, 'motivo', p_motivo));
  perform core.evento('empresa_estado_cambiado', p_empresa, null, jsonb_build_object('estado', p_estado));
end $$;
create or replace function api.pla_empresas_listar(p_buscar text default null, p_limite int default 50, p_despues uuid default null) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform core.exigir_plataforma();
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (
    select e.id, e.nombre_comercial, e.nit, e.estado, e.creado_en,
      (select s.plan_codigo from core.suscripciones s where s.empresa_id = e.id and s.estado in ('prueba', 'activa')) as plan,
      (select count(*) from core.empresa_modulos em where em.empresa_id = e.id and em.estado = 'activo') as modulos_activos,
      (select count(*) from core.membresias m where m.empresa_id = e.id and m.estado = 'activa') as miembros
    from core.empresas e where (p_buscar is null or e.nombre_comercial ilike '%' || p_buscar || '%' or e.nit = upper(p_buscar)) and (p_despues is null or e.id > p_despues)
    order by e.id limit least(greatest(coalesce(p_limite, 50), 1), 200)) x), '[]'::jsonb);
end $$;
create or replace function api.pla_empresa_detalle(p_empresa uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform core.exigir_plataforma();
  return (select jsonb_build_object('empresa', to_jsonb(e),
    'suscripcion', (select to_jsonb(s) from core.suscripciones s where s.empresa_id = e.id and s.estado in ('prueba', 'activa')),
    'modulos', coalesce((select jsonb_agg(jsonb_build_object('modulo', em.modulo, 'estado', em.estado, 'origen', em.origen, 'vigente', core.modulo_vigente(e.id, em.modulo)) order by em.modulo) from core.empresa_modulos em where em.empresa_id = e.id), '[]'::jsonb),
    'miembros', (select count(*) from core.membresias m where m.empresa_id = e.id and m.estado = 'activa'))
    from core.empresas e where e.id = p_empresa);
end $$;
create or replace function api.pla_plan_definir(p_plan jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare cod text := p_plan ->> 'codigo'; x jsonb;
begin
  perform core.exigir_plataforma(true);
  insert into core.planes (codigo, nombre, descripcion, periodo, precio_centavos, moneda, limites, activo)
  values (cod, coalesce(p_plan ->> 'nombre', cod), p_plan ->> 'descripcion', coalesce(p_plan ->> 'periodo', 'mensual'), (p_plan ->> 'precio_centavos')::int, coalesce(p_plan ->> 'moneda', 'GTQ'), coalesce(p_plan -> 'limites', '{}'::jsonb), coalesce((p_plan ->> 'activo')::boolean, true))
  on conflict (codigo) do update set nombre = excluded.nombre, descripcion = excluded.descripcion, periodo = excluded.periodo, precio_centavos = excluded.precio_centavos, moneda = excluded.moneda, limites = excluded.limites, activo = excluded.activo;
  delete from core.plan_modulos where plan_codigo = cod;
  for x in select * from jsonb_array_elements(coalesce(p_plan -> 'modulos', '[]'::jsonb)) loop
    insert into core.plan_modulos (plan_codigo, modulo, limites) values (cod, x ->> 'modulo', coalesce(x -> 'limites', '{}'::jsonb));
  end loop;
  perform core.auditar(null, 'plan_definido', 'plan', cod, null, p_plan);
end $$;
create or replace function api.pla_suscripcion_asignar(p_empresa uuid, p_plan text, p_estado text default 'activa', p_vence timestamptz default null, p_renueva boolean default false) returns uuid language plpgsql security definer set search_path = '' as $$
declare u uuid; sid uuid; em record;
begin
  u := core.exigir_plataforma();
  if p_estado not in ('prueba', 'activa') then raise exception 'CORE_ESTADO_INVALIDO' using errcode = '22023'; end if;
  if not exists (select 1 from core.planes where codigo = p_plan and activo) then raise exception 'CORE_PLAN_INEXISTENTE' using errcode = '22023'; end if;
  if not exists (select 1 from core.empresas where id = p_empresa) then raise exception 'CORE_EMPRESA_INEXISTENTE' using errcode = '22023'; end if;
  update core.suscripciones set estado = 'cancelada' where empresa_id = p_empresa and estado in ('prueba', 'activa');
  insert into core.suscripciones (empresa_id, plan_codigo, estado, vence_en, renueva, creado_por) values (p_empresa, p_plan, p_estado, p_vence, p_renueva, u) returning id into sid;
  -- los módulos activados por plan que el plan nuevo ya no incluye se suspenden de inmediato y se avisa al módulo
  for em in select e.modulo from core.empresa_modulos e where e.empresa_id = p_empresa and e.origen = 'plan' and e.estado = 'activo'
            and not exists (select 1 from core.plan_modulos pm where pm.plan_codigo = p_plan and pm.modulo = e.modulo) loop
    perform core.solicitar_modulo(p_empresa, em.modulo, 'desactivar', 'plan');
  end loop;
  perform core.auditar(p_empresa, 'suscripcion_asignada', 'suscripcion', sid::text, null, jsonb_build_object('plan', p_plan, 'estado', p_estado, 'vence', p_vence));
  perform core.evento('suscripcion_cambiada', p_empresa, null, jsonb_build_object('plan', p_plan, 'estado', p_estado));
  return sid;
end $$;
create or replace function api.pla_modulo_activar_manual(p_empresa uuid, p_modulo text) returns uuid language plpgsql security definer set search_path = '' as $$
begin perform core.exigir_plataforma(true); return core.solicitar_modulo(p_empresa, p_modulo, 'activar', 'manual'); end $$;
create or replace function api.pla_modulo_registrar(p_manifiesto jsonb) returns void language plpgsql security definer set search_path = '' as $$
begin perform core.exigir_plataforma(true); perform core.registrar_manifiesto(p_manifiesto); perform core.auditar(null, 'modulo_registrado', 'modulo', p_manifiesto ->> 'modulo', null, jsonb_build_object('version_api', p_manifiesto -> 'version_api')); end $$;
create or replace function api.pla_admin_definir(p_user uuid, p_nivel text, p_activo boolean) returns void language plpgsql security definer set search_path = '' as $$
declare u uuid;
begin
  u := core.exigir_plataforma(true);
  if p_nivel not in ('maestro', 'soporte') then raise exception 'CORE_NIVEL_INVALIDO' using errcode = '22023'; end if;
  if p_user = u and not p_activo then raise exception 'CORE_NO_DESACTIVARSE' using errcode = '22023'; end if;
  insert into core.plataforma_admins (user_id, nivel, activo) values (p_user, p_nivel, p_activo) on conflict (user_id) do update set nivel = excluded.nivel, activo = excluded.activo;
  perform core.auditar(null, 'plataforma_admin_definido', 'plataforma_admin', p_user::text, null, jsonb_build_object('nivel', p_nivel, 'activo', p_activo));
end $$;
create or replace function api.pla_parametro_definir(p_clave text, p_valor numeric) returns void language plpgsql security definer set search_path = '' as $$
declare antes numeric;
begin
  perform core.exigir_plataforma(true);
  select valor into antes from core.parametros where clave = p_clave;
  if not found then raise exception 'CORE_PARAMETRO_INEXISTENTE' using errcode = '22023'; end if;
  update core.parametros set valor = p_valor, actualizado_en = now() where clave = p_clave;
  perform core.auditar(null, 'parametro_definido', 'parametro', p_clave, to_jsonb(antes), to_jsonb(p_valor));
end $$;
create or replace function api.pla_auditoria_listar(p_empresa uuid default null, p_desde bigint default null, p_limite int default 50) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform core.exigir_plataforma();
  return coalesce((select jsonb_agg(to_jsonb(a) order by a.id desc) from (select id, ocurrido_en, empresa_id, actor_user_id, origen, accion, entidad, entidad_id from core.auditoria
     where (p_empresa is null or empresa_id = p_empresa) and (p_desde is null or id < p_desde) order by id desc limit least(greatest(coalesce(p_limite, 50), 1), 200)) a), '[]'::jsonb);
end $$;

-- ====== módulos y procesos (core_sys): el módulo se identifica con la reclamación `modulo` del token ======
create schema if not exists core_sys;
revoke all on schema core_sys from public, anon, authenticated;
create or replace function core.exigir_modulo(p_modulo text) returns void language plpgsql stable security definer set search_path = '' as $$
declare claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
begin
  if p_modulo is null or (claims ->> 'modulo') is distinct from p_modulo or not exists (select 1 from core.modulos where codigo = p_modulo) then raise exception 'CORE_MODULO_NO_AUTENTICADO' using errcode = '42501'; end if;
end $$;
create or replace function core_sys.aprov_tomar(p_modulo text, p_max int default 5) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  perform core.exigir_modulo(p_modulo);
  with t as (
    select a.id from core.aprovisionamientos a
    where a.modulo = p_modulo and a.intentos < 5 and (a.estado = 'pendiente' or (a.estado = 'en_proceso' and a.tomado_en < now() - interval '15 minutes'))
    order by a.creado_en limit least(greatest(coalesce(p_max, 5), 1), 20) for update skip locked
  ), u as (
    update core.aprovisionamientos a set estado = 'en_proceso', intentos = a.intentos + 1, tomado_en = now() from t where a.id = t.id returning a.*
  ), em as (
    update core.empresa_modulos e set estado = 'aprovisionando', actualizado_en = now() from u where e.empresa_id = u.empresa_id and e.modulo = u.modulo and u.accion = 'activar' and e.estado in ('solicitado', 'error') returning e.empresa_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'accion', u.accion, 'intento', u.intentos,
      'empresa', (select jsonb_build_object('id', e.id, 'nombre_comercial', e.nombre_comercial, 'razon_social', e.razon_social, 'nit', e.nit, 'pais', e.pais, 'moneda', e.moneda, 'zona_horaria', e.zona_horaria) from core.empresas e where e.id = u.empresa_id))), '[]'::jsonb)
  into r from u;
  return r;
end $$;
create or replace function core_sys.aprov_completar(p_modulo text, p_id uuid, p_ok boolean, p_error text default null) returns void language plpgsql security definer set search_path = '' as $$
declare a core.aprovisionamientos%rowtype;
begin
  perform core.exigir_modulo(p_modulo);
  select * into a from core.aprovisionamientos where id = p_id and modulo = p_modulo and estado = 'en_proceso' for update;
  if not found then raise exception 'CORE_APROVISIONAMIENTO_NO_VALIDO' using errcode = '22023'; end if;
  if p_ok then
    update core.aprovisionamientos set estado = 'completado', completado_en = now(), ultimo_error = null where id = p_id;
    update core.empresa_modulos set estado = case a.accion when 'activar' then 'activo' when 'reanudar' then 'activo' when 'suspender' then 'suspendido' else 'desactivado' end,
      activado_en = case when a.accion in ('activar', 'reanudar') then now() else activado_en end,
      desactivado_en = case when a.accion = 'desactivar' then now() else desactivado_en end, actualizado_en = now()
      where empresa_id = a.empresa_id and modulo = a.modulo;
    perform core.evento(case a.accion when 'activar' then 'modulo_activado' when 'reanudar' then 'modulo_activado' else 'modulo_desactivado' end, a.empresa_id, a.modulo, '{}'::jsonb);
    perform core.auditar(a.empresa_id, 'modulo_' || a.accion || '_completado', 'empresa_modulo', a.modulo, null, null, 'modulo:' || p_modulo);
  elsif a.intentos >= 5 then
    update core.aprovisionamientos set estado = 'fallido', ultimo_error = left(p_error, 300) where id = p_id;
    update core.empresa_modulos set estado = 'error', actualizado_en = now() where empresa_id = a.empresa_id and modulo = a.modulo and a.accion = 'activar';
    perform core.evento('modulo_error_aprovisionamiento', a.empresa_id, null, jsonb_build_object('modulo', a.modulo, 'accion', a.accion));
    perform core.auditar(a.empresa_id, 'modulo_' || a.accion || '_fallido', 'empresa_modulo', a.modulo, null, jsonb_build_object('error', left(p_error, 300)), 'modulo:' || p_modulo);
  else
    update core.aprovisionamientos set estado = 'pendiente', ultimo_error = left(p_error, 300) where id = p_id;
  end if;
end $$;
create or replace function core_sys.eventos_leer(p_modulo text, p_desde bigint default 0, p_limite int default 100) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform core.exigir_modulo(p_modulo);
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (
    select ev.id, ev.ocurrido_en, ev.tipo, ev.empresa_id, ev.version, ev.payload from core.eventos ev
    where ev.id > coalesce(p_desde, 0) and (ev.modulo = p_modulo or (ev.modulo is null and ev.empresa_id is not null and exists (select 1 from core.empresa_modulos em where em.empresa_id = ev.empresa_id and em.modulo = p_modulo)))
    order by ev.id limit least(greatest(coalesce(p_limite, 100), 1), 500)) x), '[]'::jsonb);
end $$;
create or replace function core_sys.eventos_confirmar(p_modulo text, p_hasta bigint) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform core.exigir_modulo(p_modulo);
  insert into core.eventos_consumo (modulo, ultimo_id) values (p_modulo, p_hasta) on conflict (modulo) do update set ultimo_id = greatest(core.eventos_consumo.ultimo_id, excluded.ultimo_id), actualizado_en = now();
end $$;
create or replace function core_sys.verificar_acceso(p_modulo text, p_empresa uuid, p_user uuid, p_permiso text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare e text;
begin
  perform core.exigir_modulo(p_modulo);
  select e2.estado into e from core.membresias m join core.empresas e2 on e2.id = m.empresa_id where m.empresa_id = p_empresa and m.user_id = p_user and m.estado = 'activa';
  if not found then return jsonb_build_object('permitido', false, 'motivo', 'sin_membresia'); end if;
  if e <> 'activa' then return jsonb_build_object('permitido', false, 'motivo', 'empresa_inactiva'); end if;
  if not core.modulo_vigente(p_empresa, p_modulo) then return jsonb_build_object('permitido', false, 'motivo', 'modulo_no_vigente'); end if;
  if not (p_permiso = any (core.permisos_de(p_empresa, p_user, p_modulo))) then return jsonb_build_object('permitido', false, 'motivo', 'sin_permiso'); end if;
  return jsonb_build_object('permitido', true, 'motivo', 'ok');
end $$;
create or replace function core_sys.empresa_contexto(p_modulo text, p_empresa uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform core.exigir_modulo(p_modulo);
  return (select jsonb_build_object('empresa', jsonb_build_object('id', e.id, 'nombre_comercial', e.nombre_comercial, 'razon_social', e.razon_social, 'nit', e.nit, 'pais', e.pais, 'moneda', e.moneda, 'zona_horaria', e.zona_horaria, 'estado', e.estado),
      'modulo', jsonb_build_object('estado', em.estado, 'vigente', core.modulo_vigente(e.id, p_modulo), 'config', em.config),
      'configuracion', coalesce((select jsonb_object_agg(c.clave, c.valor) from core.configuracion c where c.empresa_id = e.id and c.modulo = p_modulo and c.ambito = 'modulo'), '{}'::jsonb))
    from core.empresas e join core.empresa_modulos em on em.empresa_id = e.id and em.modulo = p_modulo where e.id = p_empresa);
end $$;
create or replace function core.eventos_purgar() returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin delete from core.eventos where ocurrido_en < now() - make_interval(days => core.param('eventos_retencion_dias')::int); get diagnostics n = row_count; return n; end $$;

-- ====== privilegios mínimos ======
do $p$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('core', 'api', 'core_sys') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'core_worker') then
    execute 'grant usage on schema core_sys to core_worker';
    for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'core_sys' loop
      execute format('grant execute on function %s to core_worker', f.sig);
    end loop;
  end if;
end $p$;
revoke all on all tables in schema core from public, anon, authenticated;
revoke all on all sequences in schema core from public, anon, authenticated;
commit;
