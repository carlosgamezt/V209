-- NEXA FEL · Fase 1.3 · revocación de sesiones tras una recuperación de MFA.
-- Problema: eliminar el factor TOTP no garantiza (con mecanismos documentados de Supabase) que las sesiones YA emitidas dejen de valer;
-- y un token de renovación robado produce JWT nuevos con el mismo nivel. Solución propia, verificable aquí:
--   "marca de revocación": desde ese instante, un token solo vale si TODOS sus eventos de AUTENTICACIÓN (claim amr[].timestamp) son
--   posteriores a la marca (más un margen de reloj). Renovar un token viejo NO crea eventos nuevos (amr se conserva), así que las sesiones anteriores quedan fuera aunque
--   se renueven; un inicio de sesión nuevo (contraseña, y TOTP si lo hay) sí cumple. Se aplica en la API y en la RLS (lecturas directas).
-- Además se intenta borrar las sesiones en Auth (mejor esfuerzo; si el esquema interno difiere, la marca sigue protegiendo).

create table public.revocaciones_sesion (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  desde      timestamptz not null,
  motivo     text not null,
  creada_en  timestamptz not null default now()
);
alter table public.revocaciones_sesion enable row level security;
revoke all on public.revocaciones_sesion from public, anon, authenticated, service_role;

-- Margen para diferencias de reloj entre Auth (que escribe los instantes del token) y la base de datos (que escribe la marca): un evento solo
-- cuenta si es posterior a la marca MÁS este margen. Una sesión anterior cuyo reloj de Auth vaya adelantado hasta 5 s no se cuela; a cambio,
-- quien inicia sesión en los 5 s siguientes a la aprobación debe esperar un momento. Se define aquí una sola vez (API y RLS lo comparten).
create or replace function public.fel__margen_reloj_s() returns integer
language sql immutable set search_path = '' as $$ select 5 $$;

-- Umbral (segundos Unix): los eventos de autenticación del token deben ser ESTRICTAMENTE mayores. Nulo = sin revocación.
create or replace function public.fel_sesion_revocada_desde(p_user uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select floor(extract(epoch from r.desde))::bigint + public.fel__margen_reloj_s() from public.revocaciones_sesion r where r.user_id = p_user
$$;

-- ¿El token de ESTA petición (claims de PostgREST) es posterior a la marca de revocación de la persona?
--  · Se exige que TODOS los eventos amr sean posteriores (mínimo > umbral): una sesión anterior a la que se le añadió después un TOTP
--    (paso intermedio o un factor nuevo) conserva su evento de contraseña antiguo y sigue revocada. (Con el máximo, se colaba.)
--  · Un evento de autenticación situado en el futuro (más de 5 min) es sospechoso y no vale.
create or replace function public.fel__sesion_vigente() returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_umbral bigint; v_claims jsonb; v_min bigint; v_max bigint;
begin
  v_umbral := public.fel_sesion_revocada_desde(auth.uid());
  if v_umbral is null then return true; end if;
  begin v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb; exception when others then return false; end;
  select min(t), max(t) into v_min, v_max from (
    select case when jsonb_typeof(e.v) = 'object' and (e.v ->> 'timestamp') ~ '^[0-9]{1,12}$' then (e.v ->> 'timestamp')::bigint end as t
      from jsonb_array_elements(case when jsonb_typeof(v_claims -> 'amr') = 'array' then v_claims -> 'amr' else '[]'::jsonb end) as e(v)) x
   where t is not null;
  if v_min is null then return false; end if;
  if v_max > floor(extract(epoch from clock_timestamp())) + 300 then return false; end if;
  return v_min > v_umbral;
end $$;

-- Las comprobaciones que usan las políticas RLS exigen además sesión no revocada.
create or replace function public.fel_tiene_permiso(p_empresa uuid, p_permiso text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.fel__sesion_vigente() and p_permiso = any (public.fel_permisos_efectivos(p_empresa, auth.uid()))
$$;

create or replace function public.fel_es_miembro(p_empresa uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.fel__sesion_vigente() and exists (
    select 1 from public.miembros m
    join public.empresas e on e.id = m.empresa_id and e.estado = 'habilitada'
    where m.empresa_id = p_empresa and m.user_id = auth.uid() and m.activo
      and public.fel_usuario_activo(m.user_id))
$$;

create or replace function public.fel_es_admin_plataforma() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.fel_usuario_activo(auth.uid())
     and exists (select 1 from public.plataforma_admins pa where pa.user_id = auth.uid())
     and coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'aal', '') = 'aal2'
     and public.fel__sesion_vigente()
$$;

-- Mejor esfuerzo: borrar las sesiones de Auth de la persona (equivale a un cierre de sesión global). -1 si el esquema interno no lo permite.
create or replace function public.fel__borrar_sesiones_auth(p_user uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer := 0;
begin
  begin
    delete from auth.sessions where user_id = p_user;
    get diagnostics n = row_count;
  exception when others then
    return -1;
  end;
  return n;
end $$;

-- Aprobar: AHORA fija la marca de revocación y borra sesiones ANTES de tocar los factores (si el borrado de factores falla, las
-- sesiones viejas ya no valen). Guarda cuántos factores había al aprobar por primera vez (el total no cambia al reintentar).
create or replace function public.fel_op_mfa_recuperacion_aprobar(p_actor uuid, p_solicitud uuid, p_verificacion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.solicitudes_recuperacion_mfa; v_factores text[]; v_total integer; v_borradas integer := null;
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
    select count(*) into v_total from auth.mfa_factors f where f.user_id = s.user_id and f.factor_type::text = 'totp';
    update public.solicitudes_recuperacion_mfa
       set estado = 'aprobada', resuelta_por = p_actor, resuelta_en = now(), verificacion = btrim(p_verificacion), factores_eliminados = v_total
     where id = s.id;
    insert into public.revocaciones_sesion (user_id, desde, motivo) values (s.user_id, clock_timestamp(), 'recuperacion_mfa')
      on conflict (user_id) do update set desde = greatest(excluded.desde, public.revocaciones_sesion.desde), motivo = excluded.motivo;
    v_borradas := public.fel__borrar_sesiones_auth(s.user_id);
    perform public.fel_auditar(null, p_actor, 'plataforma.mfa_recuperacion_aprobada', 'plataforma', s.id::text,
      jsonb_build_object('usuario', s.user_id, 'verificacion', btrim(p_verificacion), 'factores', v_total, 'sesiones_auth_borradas', v_borradas));
  end if;
  select coalesce(array_agg(f.id::text), '{}') into v_factores from auth.mfa_factors f where f.user_id = s.user_id and f.factor_type::text = 'totp';
  return jsonb_build_object('user_id', s.user_id, 'factores', to_jsonb(v_factores),
                            'total', (select factores_eliminados from public.solicitudes_recuperacion_mfa where id = s.id),
                            'sesiones_auth_borradas', v_borradas);   -- nulo en un reintento; -1 = no se pudieron borrar en Auth (la marca sigue protegiendo)
end $$;

-- Cierre: el total registrado es el de la primera aprobación (reintentos no lo duplican); el parámetro solo queda en la auditoría.
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
  update public.solicitudes_recuperacion_mfa set estado = 'ejecutada', ejecutada_en = now() where id = s.id;
  perform public.fel_auditar(null, p_actor, 'plataforma.mfa_recuperacion_ejecutada', 'plataforma', s.id::text,
    jsonb_build_object('usuario', s.user_id, 'factores_total', s.factores_eliminados, 'eliminados_en_esta_ejecucion', coalesce(p_eliminados, 0)));
end $$;

-- Compatibilidad con el esquema INTERNO de Auth (no es una API pública de Supabase): comprobaciones de solo lectura que se ejecutan justo
-- después de aplicar las migraciones y antes de cada tanda de pruebas. Cada fila: qué se comprobó, si está bien y el detalle.
create or replace function public.fel_verificar_dependencias_auth() returns table (comprobacion text, ok boolean, detalle text)
language plpgsql security definer set search_path = '' as $$
declare t record; c text; v_ok boolean; v_det text;
begin
  -- tablas y columnas que las funciones de FEL usan
  for t in select * from (values
      ('users', array['id', 'email', 'email_confirmed_at']), ('mfa_factors', array['id', 'user_id', 'factor_type', 'status']),
      ('sessions', array['id', 'user_id'])) as v(tabla, columnas) loop
    foreach c in array t.columnas loop
      select exists (select 1 from information_schema.columns i where i.table_schema = 'auth' and i.table_name = t.tabla and i.column_name = c) into v_ok;
      comprobacion := format('auth.%s.%s existe', t.tabla, c); ok := v_ok; detalle := case when v_ok then '' else 'columna ausente: las funciones que la usan fallarán' end; return next;
    end loop;
  end loop;
  -- privilegios EFECTIVOS del propietario de las funciones (las funciones son SECURITY DEFINER)
  comprobacion := 'privilegio SELECT sobre auth.users'; ok := has_table_privilege('auth.users', 'SELECT'); detalle := current_user::text; return next;
  comprobacion := 'privilegio SELECT sobre auth.mfa_factors'; ok := has_table_privilege('auth.mfa_factors', 'SELECT'); detalle := current_user::text; return next;
  comprobacion := 'privilegio DELETE sobre auth.sessions (borrado de sesiones; si falta, la marca de revocación sigue protegiendo)'; ok := has_table_privilege('auth.sessions', 'DELETE'); detalle := current_user::text; return next;
  -- el borrado se prueba de verdad (sin borrar nada): una condición falsa ejecuta las comprobaciones de privilegio y de esquema
  begin delete from auth.sessions where false; v_ok := true; v_det := ''; exception when others then v_ok := false; v_det := sqlerrm; end;
  comprobacion := 'DELETE ... WHERE false sobre auth.sessions se ejecuta'; ok := v_ok; detalle := v_det; return next;
  -- valores que las funciones comparan: 'totp' y 'verified' (pueden ser texto o enumerados)
  select exists (select 1 from auth.mfa_factors where false) into v_ok;
  begin perform 1 from auth.mfa_factors f where f.factor_type::text = 'totp' and f.status::text = 'verified' limit 1; v_ok := true; v_det := ''; exception when others then v_ok := false; v_det := sqlerrm; end;
  comprobacion := 'mfa_factors.factor_type/status se comparan como texto (totp, verified)'; ok := v_ok; detalle := v_det; return next;
  select exists (select 1 from pg_type ty join pg_enum en on en.enumtypid = ty.oid where ty.typname = 'factor_status' and en.enumlabel = 'verified') or
         not exists (select 1 from pg_type ty where ty.typname = 'factor_status') into v_ok;
  comprobacion := 'si factor_status es enumerado, incluye verified'; ok := v_ok; detalle := ''; return next;
  -- el token de Auth debe poder leerse: auth.uid() existe
  select exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'auth' and p.proname = 'uid') into v_ok;
  comprobacion := 'auth.uid() existe'; ok := v_ok; detalle := ''; return next;
end $$;

revoke all on function public.fel__borrar_sesiones_auth(uuid) from public, anon, authenticated, service_role;
revoke all on function public.fel_verificar_dependencias_auth() from public, anon, authenticated;
grant execute on function public.fel_verificar_dependencias_auth() to service_role;
revoke all on function public.fel__margen_reloj_s() from public, anon, authenticated, service_role;
revoke all on function public.fel__sesion_vigente(), public.fel_sesion_revocada_desde(uuid) from public, anon, authenticated;
grant execute on function public.fel__sesion_vigente(), public.fel_sesion_revocada_desde(uuid) to service_role;
