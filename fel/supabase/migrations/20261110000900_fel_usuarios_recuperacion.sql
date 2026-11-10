-- NEXA FEL · Fase 1.2 · administración de usuarios, autorización separada de maestros adicionales y recuperación de MFA.
--  (1) Maestros: el PRIMER maestro y los ADICIONALES son procedimientos distintos. Un adicional exige una autorización
--      previa, con motivo y vencimiento, emitida por un maestro activo (con aal2, vía API) y consumida por el propietario de la base.
--  (2) Lista de miembros con correo, solo para quien tiene 'usuarios.ver' en esa empresa (el correo vive en Auth, no en perfiles).
--  (3) Recuperación del acceso cuando se pierde el dispositivo TOTP: solicitud del propio usuario + verificación administrativa
--      con evidencia + aprobación por otra persona autorizada. Ningún camino omite el MFA sin esa verificación.

-- ---------------------------------------------------------------- (1) maestros
create table public.autorizaciones_maestro (
  id             uuid primary key default gen_random_uuid(),
  email          text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  autorizado_por uuid not null references auth.users (id),
  motivo         text not null check (length(btrim(motivo)) >= 10),
  creada_en      timestamptz not null default now(),
  expira_en      timestamptz not null default (now() + interval '24 hours'),
  usada_en       timestamptz,
  revocada_en    timestamptz,
  check (usada_en is null or revocada_en is null)
);
create unique index autorizaciones_maestro_abierta_uq on public.autorizaciones_maestro (email) where usada_en is null and revocada_en is null;
alter table public.autorizaciones_maestro enable row level security;
revoke all on public.autorizaciones_maestro from public, anon, authenticated, service_role;

-- Comprobaciones comunes de una persona candidata (solo uso interno).
create or replace function public.fel__validar_candidato_maestro(p_email text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_conf timestamptz; v_mail text := lower(btrim(coalesce(p_email, '')));
begin
  select u.id, u.email_confirmed_at into v_user, v_conf from auth.users u where lower(u.email) = v_mail;
  if v_user is null then raise exception 'FEL_NO_ENCONTRADO: no existe un usuario en Auth con ese correo; créalo primero con una invitación'; end if;
  if v_conf is null then raise exception 'FEL_REGLA: el correo del usuario todavía no está confirmado'; end if;
  if not exists (select 1 from auth.mfa_factors f where f.user_id = v_user and f.factor_type::text = 'totp' and f.status::text = 'verified') then
    raise exception 'FEL_REGLA: el usuario aún no tiene un factor TOTP verificado; debe activar la verificación en dos pasos antes';
  end if;
  if public.fel_estado_cuenta(v_user) = 'bloqueada' then
    raise exception 'FEL_REGLA: la cuenta está desactivada; no se convierte en administrador maestro';
  end if;
  return v_user;
end $$;

drop function if exists public.fel_bootstrap_primer_maestro(text, boolean);

-- PRIMER maestro: solo si todavía no existe ninguno.
create or replace function public.fel_bootstrap_primer_maestro(p_email text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  perform pg_advisory_xact_lock(hashtext('fel_maestros'));
  v_user := public.fel__validar_candidato_maestro(p_email);
  if exists (select 1 from public.plataforma_admins) then
    raise exception 'FEL_REGLA: ya existe un administrador maestro; para agregar otro hace falta una autorización (fel_admin_maestro_autorizar) y fel_agregar_maestro_adicional';
  end if;
  insert into public.perfiles (user_id) values (v_user) on conflict (user_id) do nothing;
  insert into public.plataforma_admins (user_id) values (v_user);
  perform public.fel_auditar(null, v_user, 'plataforma.primer_maestro_creado', 'plataforma', v_user::text,
    jsonb_build_object('email', lower(btrim(p_email))), 'sql');
  return v_user;
end $$;

-- Autorización de un maestro ADICIONAL: la emite un maestro activo (API con aal2); queda auditada y vence en 24 h.
create or replace function public.fel_admin_maestro_autorizar(p_actor uuid, p_email text, p_motivo text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_mail text := lower(btrim(coalesce(p_email, '')));
begin
  perform public.fel__exigir_plataforma(p_actor);
  if p_motivo is null or length(btrim(p_motivo)) < 10 then raise exception 'FEL_REGLA: el motivo es obligatorio (mínimo 10 caracteres)'; end if;
  if v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'FEL_REGLA: correo no válido'; end if;
  if exists (select 1 from public.plataforma_admins pa join auth.users u on u.id = pa.user_id where lower(u.email) = v_mail) then
    raise exception 'FEL_REGLA: esa persona ya es administradora maestra';
  end if;
  update public.autorizaciones_maestro set revocada_en = now() where usada_en is null and revocada_en is null and expira_en <= now();
  if (select count(*) from public.autorizaciones_maestro where usada_en is null and revocada_en is null) >= 3 then
    raise exception 'FEL_REGLA: hay demasiadas autorizaciones abiertas; revoca alguna antes';
  end if;
  begin
    insert into public.autorizaciones_maestro (email, autorizado_por, motivo) values (v_mail, p_actor, btrim(p_motivo)) returning id into v_id;
  exception when unique_violation then
    raise exception 'FEL_CONFLICTO: ya hay una autorización abierta para ese correo';
  end;
  perform public.fel_auditar(null, p_actor, 'plataforma.maestro_autorizado', 'plataforma', v_id::text,
    jsonb_build_object('email', v_mail, 'motivo', btrim(p_motivo)));
  return v_id;
end $$;

create or replace function public.fel_admin_maestro_revocar_autorizacion(p_actor uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.autorizaciones_maestro;
begin
  perform public.fel__exigir_plataforma(p_actor);
  select * into v from public.autorizaciones_maestro where id = p_id for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: autorización no encontrada'; end if;
  if v.usada_en is not null or v.revocada_en is not null then raise exception 'FEL_REGLA: la autorización ya no está abierta'; end if;
  update public.autorizaciones_maestro set revocada_en = now() where id = p_id;
  perform public.fel_auditar(null, p_actor, 'plataforma.maestro_autorizacion_revocada', 'plataforma', p_id::text, jsonb_build_object('email', v.email));
end $$;

-- Maestro ADICIONAL: solo con una autorización vigente, emitida por un maestro que sigue activo y que no es la propia persona.
create or replace function public.fel_agregar_maestro_adicional(p_email text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid; a public.autorizaciones_maestro; v_mail text := lower(btrim(coalesce(p_email, '')));
begin
  perform pg_advisory_xact_lock(hashtext('fel_maestros'));
  v_user := public.fel__validar_candidato_maestro(p_email);
  if not exists (select 1 from public.plataforma_admins) then
    raise exception 'FEL_REGLA: todavía no hay un administrador maestro; usa fel_bootstrap_primer_maestro';
  end if;
  select * into a from public.autorizaciones_maestro
   where email = v_mail and usada_en is null and revocada_en is null and expira_en > now() for update;
  if not found then raise exception 'FEL_NO_AUTORIZADO: no hay una autorización vigente para ese correo'; end if;
  if a.autorizado_por = v_user or not public.fel_es_plataforma(a.autorizado_por) then
    raise exception 'FEL_NO_AUTORIZADO: la autorización no la emitió un administrador maestro activo distinto de la persona';
  end if;
  insert into public.perfiles (user_id) values (v_user) on conflict (user_id) do nothing;
  insert into public.plataforma_admins (user_id) values (v_user) on conflict (user_id) do nothing;
  update public.autorizaciones_maestro set usada_en = now() where id = a.id;
  perform public.fel_auditar(null, v_user, 'plataforma.maestro_adicional_creado', 'plataforma', v_user::text,
    jsonb_build_object('email', v_mail, 'autorizacion', a.id, 'autorizado_por', a.autorizado_por), 'sql');
  return v_user;
end $$;

-- ---------------------------------------------------------------- (2) miembros con correo
create or replace function public.fel_op_miembros_listar(p_actor uuid, p_empresa uuid)
returns table (user_id uuid, email text, nombre text, rol text, permisos_extra text[], permisos_revocados text[],
               activo boolean, cuenta text, permisos_efectivos text[], creado_en timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'usuarios.ver');
  return query
    select m.user_id, u.email::text, pf.nombre, m.rol, m.permisos_extra, m.permisos_revocados, m.activo,
           public.fel_estado_cuenta(m.user_id), public.fel_permisos_efectivos(p_empresa, m.user_id), m.creado_en
      from public.miembros m
      join auth.users u on u.id = m.user_id
      left join public.perfiles pf on pf.user_id = m.user_id
     where m.empresa_id = p_empresa
     order by public.fel__rango(m.rol) desc, u.email;
end $$;

-- ---------------------------------------------------------------- (3) recuperación de MFA
create table public.solicitudes_recuperacion_mfa (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  estado              text not null default 'pendiente' check (estado in ('pendiente','aprobada','rechazada','ejecutada','expirada')),
  motivo              text not null check (length(btrim(motivo)) between 10 and 500),
  solicitada_en       timestamptz not null default now(),
  expira_en           timestamptz not null default (now() + interval '72 hours'),
  resuelta_por        uuid references auth.users (id),
  resuelta_en         timestamptz,
  verificacion        text check (verificacion is null or length(btrim(verificacion)) >= 20),   -- cómo se verificó la identidad (obligatorio al aprobar)
  factores_eliminados integer,
  ejecutada_en        timestamptz,
  check (estado not in ('aprobada','ejecutada') or (resuelta_por is not null and verificacion is not null))
);
create unique index solicitudes_mfa_abierta_uq on public.solicitudes_recuperacion_mfa (user_id) where estado in ('pendiente','aprobada');
alter table public.solicitudes_recuperacion_mfa enable row level security;
revoke all on public.solicitudes_recuperacion_mfa from public, anon, authenticated, service_role;

-- ¿Puede esta persona resolver la solicitud de esa otra? Nunca la propia. Un maestro solo lo resuelve otro maestro.
-- Una persona común: un maestro, o un propietario de una empresa en la que ambos son miembros activos.
create or replace function public.fel__puede_resolver_mfa(p_actor uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_actor is not null and p_user is not null and p_actor <> p_user and public.fel_usuario_activo(p_actor)
     and case
       when exists (select 1 from public.plataforma_admins where user_id = p_user) then public.fel_es_plataforma(p_actor)
       else public.fel_es_plataforma(p_actor) or exists (
         select 1 from public.miembros ma
           join public.miembros mt on mt.empresa_id = ma.empresa_id
          where ma.user_id = p_actor and ma.rol = 'propietario' and ma.activo and mt.user_id = p_user and mt.activo
            and 'usuarios.gestionar' = any (public.fel_permisos_efectivos(ma.empresa_id, p_actor)))
     end
$$;

create or replace function public.fel_op_mfa_recuperacion_solicitar(p_user uuid, p_motivo text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if public.fel_estado_cuenta(p_user) <> 'activa' then raise exception 'FEL_NO_AUTORIZADO: la cuenta no puede solicitar una recuperación'; end if;
  if p_motivo is null or length(btrim(p_motivo)) < 10 or length(btrim(p_motivo)) > 500 then raise exception 'FEL_REGLA: explica lo ocurrido (entre 10 y 500 caracteres)'; end if;
  if not exists (select 1 from auth.mfa_factors f where f.user_id = p_user and f.factor_type::text = 'totp' and f.status::text = 'verified') then
    raise exception 'FEL_REGLA: tu cuenta no tiene verificación en dos pasos activa; no hay nada que recuperar';
  end if;
  update public.solicitudes_recuperacion_mfa set estado = 'expirada' where user_id = p_user and estado = 'pendiente' and expira_en <= now();
  if exists (select 1 from public.solicitudes_recuperacion_mfa where user_id = p_user and estado in ('pendiente','aprobada')) then
    raise exception 'FEL_CONFLICTO: ya tienes una solicitud en curso';
  end if;
  if (select count(*) from public.solicitudes_recuperacion_mfa where user_id = p_user and solicitada_en > now() - interval '24 hours') >= 3 then
    raise exception 'FEL_REGLA: demasiadas solicitudes en las últimas 24 horas';
  end if;
  insert into public.solicitudes_recuperacion_mfa (user_id, motivo) values (p_user, btrim(p_motivo)) returning id into v_id;
  perform public.fel_auditar(null, p_user, 'plataforma.mfa_recuperacion_solicitada', 'plataforma', v_id::text, jsonb_build_object('motivo', btrim(p_motivo)));
  return v_id;
end $$;

create or replace function public.fel_op_mfa_recuperacion_listar(p_actor uuid)
returns table (id uuid, user_id uuid, email text, motivo text, estado text, solicitada_en timestamptz, expira_en timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.id, s.user_id, u.email::text, s.motivo, s.estado, s.solicitada_en, s.expira_en
    from public.solicitudes_recuperacion_mfa s join auth.users u on u.id = s.user_id
   where (s.estado = 'aprobada' or (s.estado = 'pendiente' and s.expira_en > now()))
     and public.fel__puede_resolver_mfa(p_actor, s.user_id)
   order by s.solicitada_en
$$;

-- Aprobar exige evidencia de cómo se verificó la identidad. Devuelve los factores a eliminar (la API los elimina con la API de
-- administración de Auth y luego llama a _cerrar). Es repetible: si el borrado falla, se vuelve a llamar con la solicitud 'aprobada'.
create or replace function public.fel_op_mfa_recuperacion_aprobar(p_actor uuid, p_solicitud uuid, p_verificacion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.solicitudes_recuperacion_mfa; v_factores text[]; v_mail text;
begin
  select * into s from public.solicitudes_recuperacion_mfa where id = p_solicitud for update;
  if not found or not public.fel__puede_resolver_mfa(p_actor, s.user_id) then
    raise exception 'FEL_NO_AUTORIZADO: no puedes resolver esta solicitud';
  end if;
  if s.estado = 'pendiente' and s.expira_en <= now() then
    update public.solicitudes_recuperacion_mfa set estado = 'expirada' where id = s.id;
    raise exception 'FEL_REGLA: la solicitud venció; la persona debe pedirla de nuevo';
  end if;
  if s.estado not in ('pendiente','aprobada') then raise exception 'FEL_REGLA: la solicitud ya está %', s.estado; end if;
  if s.estado = 'pendiente' then
    if p_verificacion is null or length(btrim(p_verificacion)) < 20 then
      raise exception 'FEL_REGLA: describe cómo verificaste la identidad de la persona (mínimo 20 caracteres)';
    end if;
    update public.solicitudes_recuperacion_mfa set estado = 'aprobada', resuelta_por = p_actor, resuelta_en = now(), verificacion = btrim(p_verificacion) where id = s.id;
    perform public.fel_auditar(null, p_actor, 'plataforma.mfa_recuperacion_aprobada', 'plataforma', s.id::text,
      jsonb_build_object('usuario', s.user_id, 'verificacion', btrim(p_verificacion)));
  end if;
  select coalesce(array_agg(f.id::text), '{}'), max(u.email) into v_factores, v_mail
    from auth.mfa_factors f join auth.users u on u.id = f.user_id where f.user_id = s.user_id and f.factor_type::text = 'totp';
  return jsonb_build_object('user_id', s.user_id, 'factores', to_jsonb(v_factores));
end $$;

create or replace function public.fel_op_mfa_recuperacion_cerrar(p_actor uuid, p_solicitud uuid, p_eliminados integer) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.solicitudes_recuperacion_mfa;
begin
  select * into s from public.solicitudes_recuperacion_mfa where id = p_solicitud for update;
  if not found or not public.fel__puede_resolver_mfa(p_actor, s.user_id) then raise exception 'FEL_NO_AUTORIZADO: no puedes resolver esta solicitud'; end if;
  if s.estado <> 'aprobada' then raise exception 'FEL_REGLA: la solicitud no está aprobada'; end if;
  if exists (select 1 from auth.mfa_factors f where f.user_id = s.user_id and f.factor_type::text = 'totp') then
    raise exception 'FEL_REGLA: todavía quedan factores TOTP por eliminar';
  end if;
  update public.solicitudes_recuperacion_mfa set estado = 'ejecutada', ejecutada_en = now(), factores_eliminados = greatest(coalesce(p_eliminados, 0), 0) where id = s.id;
  perform public.fel_auditar(null, p_actor, 'plataforma.mfa_recuperacion_ejecutada', 'plataforma', s.id::text,
    jsonb_build_object('usuario', s.user_id, 'factores_eliminados', coalesce(p_eliminados, 0)));
end $$;

create or replace function public.fel_op_mfa_recuperacion_rechazar(p_actor uuid, p_solicitud uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.solicitudes_recuperacion_mfa;
begin
  select * into s from public.solicitudes_recuperacion_mfa where id = p_solicitud for update;
  if not found or not public.fel__puede_resolver_mfa(p_actor, s.user_id) then raise exception 'FEL_NO_AUTORIZADO: no puedes resolver esta solicitud'; end if;
  if s.estado <> 'pendiente' then raise exception 'FEL_REGLA: solo se rechaza una solicitud pendiente'; end if;
  if p_motivo is null or length(btrim(p_motivo)) < 5 then raise exception 'FEL_REGLA: el motivo es obligatorio (mínimo 5 caracteres)'; end if;
  update public.solicitudes_recuperacion_mfa set estado = 'rechazada', resuelta_por = p_actor, resuelta_en = now() where id = s.id;
  perform public.fel_auditar(null, p_actor, 'plataforma.mfa_recuperacion_rechazada', 'plataforma', s.id::text, jsonb_build_object('usuario', s.user_id, 'motivo', btrim(p_motivo)));
end $$;

-- Ruta de emergencia (único maestro que perdió el dispositivo): el propietario de la base actúa en el panel de Supabase
-- y deja constancia aquí. Esta función SOLO registra en la auditoría; no cambia ninguna cuenta.
create or replace function public.fel_registrar_recuperacion_manual(p_email text, p_referencia text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  if p_referencia is null or length(btrim(p_referencia)) < 20 then raise exception 'FEL_REGLA: la referencia debe describir la verificación realizada (mínimo 20 caracteres)'; end if;
  select id into v_user from auth.users where lower(email) = lower(btrim(coalesce(p_email, '')));
  if v_user is null then raise exception 'FEL_NO_ENCONTRADO: no existe un usuario con ese correo'; end if;
  perform public.fel_auditar(null, v_user, 'plataforma.mfa_recuperacion_manual', 'plataforma', v_user::text,
    jsonb_build_object('email', lower(btrim(p_email)), 'referencia', btrim(p_referencia)), 'sql');
end $$;

-- ---------------------------------------------------------------- permisos de ejecución
-- Solo el propietario de la base de datos (consola SQL): ni service_role, ni authenticated, ni anon.
revoke all on function public.fel__validar_candidato_maestro(text), public.fel_bootstrap_primer_maestro(text),
  public.fel_agregar_maestro_adicional(text), public.fel__puede_resolver_mfa(uuid, uuid), public.fel_registrar_recuperacion_manual(text, text)
  from public, anon, authenticated, service_role;
-- Operaciones de la API (service_role), cada una con su propia validación de actor.
revoke all on function public.fel_admin_maestro_autorizar(uuid, text, text), public.fel_admin_maestro_revocar_autorizacion(uuid, uuid),
  public.fel_op_miembros_listar(uuid, uuid), public.fel_op_mfa_recuperacion_solicitar(uuid, text), public.fel_op_mfa_recuperacion_listar(uuid),
  public.fel_op_mfa_recuperacion_aprobar(uuid, uuid, text), public.fel_op_mfa_recuperacion_cerrar(uuid, uuid, integer),
  public.fel_op_mfa_recuperacion_rechazar(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.fel_admin_maestro_autorizar(uuid, text, text), public.fel_admin_maestro_revocar_autorizacion(uuid, uuid),
  public.fel_op_miembros_listar(uuid, uuid), public.fel_op_mfa_recuperacion_solicitar(uuid, text), public.fel_op_mfa_recuperacion_listar(uuid),
  public.fel_op_mfa_recuperacion_aprobar(uuid, uuid, text), public.fel_op_mfa_recuperacion_cerrar(uuid, uuid, integer),
  public.fel_op_mfa_recuperacion_rechazar(uuid, uuid, text) to service_role;
