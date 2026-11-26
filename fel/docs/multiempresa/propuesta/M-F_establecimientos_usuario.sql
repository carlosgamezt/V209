-- M-F · Establecimiento asignado y bloqueado por usuario (PROPUESTA; fuera de supabase/migrations; NO se aplica sin autorización). Requiere M-D, M-A, M-B, M-C.
-- Interruptor `establecimiento_por_usuario` (plataforma_parametros; 0 = apagado, comportamiento actual; 1 = obligatorio). Con 0 NADA cambia para los documentos existentes ni para la demo.
insert into public.permisos_catalogo (codigo, descripcion) values
  ('establecimientos.asignar',   'Asignar y reasignar el establecimiento de los usuarios de la empresa'),
  ('establecimientos.multiples', 'Supervisión: acceso a varios establecimientos asignados (NO se concede automáticamente: solo como permiso extra a una persona expresamente autorizada)');
insert into public.rol_permisos (rol, permiso) values ('propietario', 'establecimientos.asignar'), ('administrador', 'establecimientos.asignar');   -- «multiples» NO va en ningún rol
insert into public.plataforma_parametros (clave, valor, descripcion) values ('establecimiento_por_usuario', 0, 'Establecimiento asignado y bloqueado por usuario: 0 = apagado, 1 = obligatorio');

create table public.usuario_establecimientos (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null,
  user_id          uuid not null,
  establecimiento_id uuid not null,
  predeterminado   boolean not null default true,
  creado_por       uuid not null references auth.users (id),
  creado_en        timestamptz not null default now(),
  revocado_por     uuid references auth.users (id),
  revocado_en      timestamptz,
  motivo           text check (motivo is null or length(motivo) <= 300),
  foreign key (empresa_id, user_id) references public.miembros (empresa_id, user_id),
  foreign key (establecimiento_id, empresa_id) references public.establecimientos (id, empresa_id),   -- jamás de otra empresa
  check ((revocado_en is null) = (revocado_por is null))
);
create unique index usuario_est_activa_uq on public.usuario_establecimientos (empresa_id, user_id, establecimiento_id) where revocado_en is null;
create unique index usuario_est_pred_uq on public.usuario_establecimientos (empresa_id, user_id) where revocado_en is null and predeterminado;   -- un solo predeterminado activo
create index usuario_est_idx on public.usuario_establecimientos (empresa_id, establecimiento_id) where revocado_en is null;
alter table public.usuario_establecimientos enable row level security;
revoke all on public.usuario_establecimientos from public, anon, authenticated;
grant select on public.usuario_establecimientos to authenticated;
create policy usuario_est_leer on public.usuario_establecimientos for select to authenticated using (user_id = auth.uid() or public.fel_tiene_permiso(empresa_id, 'establecimientos.asignar'));
create trigger usuario_est_solo_alta before delete on public.usuario_establecimientos for each row execute function public.fel_solo_agregar();   -- el historial no se borra

-- Alcance de una persona en una empresa: todos (propietario/administrador), o los establecimientos asignados activos. `multiples` = permiso de supervisión.
create or replace function public.fel_alcance(p_empresa uuid, p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'todos', coalesce(m.rol in ('propietario', 'administrador'), false),
    'multiples', coalesce(('establecimientos.multiples' = any (public.fel_permisos_efectivos(p_empresa, p_user))), false),
    'ids', coalesce((select jsonb_agg(ue.establecimiento_id order by ue.predeterminado desc, ue.creado_en) from public.usuario_establecimientos ue
                      join public.establecimientos e on e.id = ue.establecimiento_id and e.empresa_id = ue.empresa_id and e.estado = 'activo'
                     where ue.empresa_id = p_empresa and ue.user_id = p_user and ue.revocado_en is null), '[]'::jsonb))
  from public.miembros m where m.empresa_id = p_empresa and m.user_id = p_user and m.activo
$$;
create or replace function public.fel_en_alcance(p_empresa uuid, p_user uuid, p_est uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((a ->> 'todos')::boolean or (p_est is not null and (a -> 'ids') @> to_jsonb(p_est::text)), false) from (select public.fel_alcance(p_empresa, p_user) a) x
$$;
create or replace function public.fel__establecimiento_por_usuario() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select valor = 1 from public.plataforma_parametros where clave = 'establecimiento_por_usuario'), false) $$;

-- Un facturador común (sin «multiples») tiene A LO SUMO una asignación activa; con el interruptor encendido no puede quedar con varias.
create or replace function public.fel_usuario_est_unica() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_n integer; v_mult boolean;
begin
  if new.revocado_en is not null then return new; end if;
  v_mult := 'establecimientos.multiples' = any (public.fel_permisos_efectivos(new.empresa_id, new.user_id));
  select count(*) into v_n from public.usuario_establecimientos where empresa_id = new.empresa_id and user_id = new.user_id and revocado_en is null;
  if v_n > 1 and not v_mult then raise exception 'FEL_REGLA: un facturador sin permiso de supervisión solo puede tener UN establecimiento asignado'; end if;
  return new;
end $$;
create constraint trigger usuario_est_unica after insert or update on public.usuario_establecimientos deferrable initially deferred for each row execute function public.fel_usuario_est_unica();

-- «multiples» solo puede existir como permiso extra de quien tiene rol de supervisión (administrador, propietario) o de un emisor expresamente autorizado: jamás por rol y jamás en un lector.
create or replace function public.fel_miembro_multiples() returns trigger language plpgsql set search_path = '' as $$
begin
  if 'establecimientos.multiples' = any (new.permisos_extra) and new.rol = 'lector' then raise exception 'FEL_REGLA: el permiso de supervisión de establecimientos no se concede a un lector'; end if;
  return new;
end $$;
create trigger miembros_multiples before insert or update on public.miembros for each row execute function public.fel_miembro_multiples();

-- Asignar o reasignar. Un facturador común: la nueva asignación REEMPLAZA a la anterior (la anterior queda revocada con su motivo; nada se borra). Con «multiples»: se agrega.
create or replace function public.fel_op_asignacion_guardar(p_actor uuid, p_empresa uuid, p_usuario uuid, p_establecimiento uuid, p_predeterminado boolean, p_motivo text) returns public.usuario_establecimientos
language plpgsql security definer set search_path = '' as $$
declare r public.usuario_establecimientos; v_mult boolean; v_prev uuid;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'establecimientos.asignar');
  if not exists (select 1 from public.miembros where empresa_id = p_empresa and user_id = p_usuario and activo) then raise exception 'FEL_REGLA: el usuario no es miembro activo de esta empresa'; end if;
  if not exists (select 1 from public.establecimientos where id = p_establecimiento and empresa_id = p_empresa and estado = 'activo') then raise exception 'FEL_REGLA: establecimiento no válido para esta empresa'; end if;
  v_mult := 'establecimientos.multiples' = any (public.fel_permisos_efectivos(p_empresa, p_usuario));
  select establecimiento_id into v_prev from public.usuario_establecimientos where empresa_id = p_empresa and user_id = p_usuario and revocado_en is null and predeterminado;
  if not v_mult then
    update public.usuario_establecimientos set revocado_por = p_actor, revocado_en = now(), motivo = left(coalesce(p_motivo, 'reasignación'), 300) where empresa_id = p_empresa and user_id = p_usuario and revocado_en is null;
    p_predeterminado := true;
  elsif p_predeterminado then
    update public.usuario_establecimientos set predeterminado = false where empresa_id = p_empresa and user_id = p_usuario and revocado_en is null and predeterminado;
  end if;
  insert into public.usuario_establecimientos (empresa_id, user_id, establecimiento_id, predeterminado, creado_por, motivo)
  values (p_empresa, p_usuario, p_establecimiento, coalesce(p_predeterminado, false), p_actor, left(p_motivo, 300)) returning * into r;
  perform public.fel_auditar(p_empresa, p_actor, 'usuario.establecimiento', 'usuario', p_usuario::text, jsonb_build_object('establecimiento', p_establecimiento, 'anterior', v_prev, 'predeterminado', r.predeterminado));
  return r;
end $$;

create or replace function public.fel_op_asignacion_revocar(p_actor uuid, p_empresa uuid, p_usuario uuid, p_establecimiento uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'establecimientos.asignar');
  update public.usuario_establecimientos set revocado_por = p_actor, revocado_en = now(), motivo = left(coalesce(p_motivo, 'revocada'), 300), predeterminado = false
   where empresa_id = p_empresa and user_id = p_usuario and establecimiento_id = p_establecimiento and revocado_en is null;
  if not found then raise exception 'FEL_NO_ENCONTRADO: asignación no encontrada'; end if;
  perform public.fel_auditar(p_empresa, p_actor, 'usuario.establecimiento.revocar', 'usuario', p_usuario::text, jsonb_build_object('establecimiento', p_establecimiento));
end $$;

-- Un borrador pendiente de alguien reasignado se queda en su establecimiento (nadie fuera de ese alcance lo ve). Si hay que rescatarlo, un administrador lo traslada EXPLÍCITAMENTE (solo borradores sin estado fiscal; auditado).
create or replace function public.fel_op_borrador_trasladar(p_actor uuid, p_empresa uuid, p_doc uuid, p_destino uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_ant uuid;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'establecimientos.asignar');
  if length(btrim(coalesce(p_motivo, ''))) < 10 then raise exception 'FEL_REGLA: el traslado de un borrador exige un motivo (mínimo 10 caracteres)'; end if;
  if not exists (select 1 from public.establecimientos where id = p_destino and empresa_id = p_empresa and estado = 'activo') then raise exception 'FEL_REGLA: establecimiento no válido para esta empresa'; end if;
  select establecimiento_id into v_ant from public.documentos where id = p_doc and empresa_id = p_empresa and estado_preparacion = 'borrador' and estado_fiscal = 'ninguno' for update;
  if not found then raise exception 'FEL_REGLA: solo se traslada un borrador sin estado fiscal de esta empresa'; end if;
  perform set_config('fel.traslado_autorizado', p_doc::text, true);
  update public.documentos set establecimiento_id = p_destino, actualizado_por = p_actor, version = version + 1 where id = p_doc and empresa_id = p_empresa;
  perform public.fel_auditar(p_empresa, p_actor, 'documento.borrador_trasladado', 'documento', p_doc::text, jsonb_build_object('de', v_ant, 'a', p_destino, 'motivo', p_motivo));
end $$;

-- Defensa en la base: con el interruptor encendido, un usuario restringido no crea ni modifica documentos fuera de su alcance, el establecimiento de un documento ya fijado no cambia (salvo el traslado explícito de un
-- borrador) y un documento nuevo de un facturador nace con SU establecimiento asignado.
create or replace function public.fel_documento_alcance() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_al jsonb;
begin
  if not public.fel__establecimiento_por_usuario() then return new; end if;
  if tg_op = 'INSERT' then
    v_actor := new.creado_por; if v_actor is null then return new; end if;
    v_al := public.fel_alcance(new.empresa_id, v_actor);
    if v_al is null or (v_al ->> 'todos')::boolean then return new; end if;   -- propietario y administrador: todos los establecimientos de su empresa
    if new.establecimiento_id is null then
      if jsonb_array_length(v_al -> 'ids') = 0 then raise exception 'FEL_REGLA: tu usuario no tiene un establecimiento asignado'; end if;
      new.establecimiento_id := ((v_al -> 'ids') ->> 0)::uuid;   -- el predeterminado
    elsif not public.fel_en_alcance(new.empresa_id, v_actor, new.establecimiento_id) then raise exception 'FEL_REGLA: establecimiento no autorizado para este usuario';
    end if;
    return new;
  end if;
  -- UPDATE
  v_actor := new.actualizado_por;
  if old.establecimiento_id is distinct from new.establecimiento_id and old.establecimiento_id is not null and coalesce(current_setting('fel.traslado_autorizado', true), '') <> old.id::text then
    raise exception 'FEL_REGLA: el establecimiento de un documento no cambia';
  end if;
  if v_actor is not null and old.establecimiento_id is not null and not public.fel_en_alcance(old.empresa_id, v_actor, old.establecimiento_id)
     and coalesce(current_setting('fel.traslado_autorizado', true), '') <> old.id::text and (public.fel_alcance(old.empresa_id, v_actor) ->> 'todos') = 'false' then
    raise exception 'FEL_REGLA: documento fuera del alcance de este usuario';
  end if;
  return new;
end $$;
create trigger documentos_alcance before insert or update on public.documentos for each row execute function public.fel_documento_alcance();

-- El establecimiento de un documento solo se fija una vez y solo dentro del alcance del usuario (rechaza; nunca lo cambia en silencio). Misma firma que la función actual.
create or replace function public.fel_op_documento_establecimiento(p_actor uuid, p_empresa uuid, p_doc uuid, p_est uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actual uuid;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'borradores.editar');
  if not exists (select 1 from public.establecimientos where id = p_est and empresa_id = p_empresa and estado = 'activo') then
    raise exception 'FEL_REGLA: establecimiento no válido para esta empresa';
  end if;
  select establecimiento_id into v_actual from public.documentos where id = p_doc and empresa_id = p_empresa;
  if not found then raise exception 'FEL_NO_ENCONTRADO: documento no encontrado'; end if;
  if public.fel__establecimiento_por_usuario() then
    if not public.fel_en_alcance(p_empresa, p_actor, p_est) then raise exception 'FEL_REGLA: establecimiento no autorizado para este usuario'; end if;
    if v_actual is not null and v_actual <> p_est then raise exception 'FEL_REGLA: el establecimiento de un documento no cambia'; end if;
  end if;
  update public.documentos set establecimiento_id = p_est, actualizado_por = p_actor, version = version + 1
   where id = p_doc and empresa_id = p_empresa and estado_preparacion = 'borrador' and estado_fiscal = 'ninguno';
  if not found then raise exception 'FEL_REGLA: el establecimiento solo se asigna a un borrador sin estado fiscal'; end if;
  perform public.fel_auditar(p_empresa, p_actor, 'documento.establecimiento', 'documento', p_doc::text, jsonb_build_object('establecimiento', p_est));
end $$;

-- Con el interruptor encendido, quien no tiene el documento en su alcance tampoco lo LEE por la API de datos (política RESTRICTIVA sobre las políticas de lectura actuales).
create policy documentos_alcance_leer on public.documentos as restrictive for select to authenticated
  using (not public.fel__establecimiento_por_usuario() or public.fel_en_alcance(empresa_id, auth.uid(), establecimiento_id));

revoke all on function public.fel_alcance(uuid, uuid), public.fel_en_alcance(uuid, uuid, uuid), public.fel__establecimiento_por_usuario(), public.fel_usuario_est_unica(), public.fel_miembro_multiples(), public.fel_documento_alcance(),
  public.fel_op_asignacion_guardar(uuid, uuid, uuid, uuid, boolean, text), public.fel_op_asignacion_revocar(uuid, uuid, uuid, uuid, text), public.fel_op_borrador_trasladar(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.fel_en_alcance(uuid, uuid, uuid), public.fel__establecimiento_por_usuario() to authenticated;   -- la política restrictiva las evalúa con la identidad del usuario
grant execute on function public.fel_alcance(uuid, uuid), public.fel_en_alcance(uuid, uuid, uuid), public.fel__establecimiento_por_usuario(),
  public.fel_op_asignacion_guardar(uuid, uuid, uuid, uuid, boolean, text), public.fel_op_asignacion_revocar(uuid, uuid, uuid, uuid, text), public.fel_op_borrador_trasladar(uuid, uuid, uuid, uuid, text) to service_role;
