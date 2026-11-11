-- NEXA FEL · Fase 4 (2/9) · agente local: vinculación por empresa, cola de órdenes con arrendamiento y fencing, y separación estricta simulador/real.
-- Diseño: docs/agente-arquitectura.md, agente-protocolo.md, agente-seguridad.md. SOLO SIMULADOR: ninguna orden puede ser de un ambiente distinto de «simulado»,
-- «digifact» no puede habilitarse y «portal_playwright» solo admite el ambiente simulado. No se modifica el orquestador ni las reglas anti-duplicados.
-- Reglas: (1) cada acción del agente se valida EN LA BASE (agente activo, empresa, estado de operación y orden, token de fencing);
-- (2) lo incierto tras presentar la vista previa NUNCA se reintenta: la orden queda «incierta» y la operación «por_verificar».

-- ============================================================ permiso nuevo
insert into public.permisos_catalogo (codigo, descripcion) values
  ('agentes.administrar', 'Vincular y revocar agentes locales de la empresa');
insert into public.rol_permisos (rol, permiso) values ('propietario', 'agentes.administrar'), ('administrador', 'agentes.administrar');

-- ============================================================ parámetros
insert into public.plataforma_parametros (clave, valor, descripcion) values
  ('agente_lease_seg',        120, 'Segundos de arrendamiento de una orden reclamada por un agente'),
  ('agente_latido_max_seg',   60,  'Segundos sin latido tras los cuales el agente se considera desconectado'),
  ('agente_reloj_max_seg',    60,  'Desfase máximo (segundos) entre el reloj del agente y el del servidor'),
  ('agente_codigo_min',       10,  'Minutos de validez de un código de vinculación');

-- ============================================================ separación simulador / integración real (restricciones de tabla)
-- «portal_playwright» solo puede existir en el ambiente simulado en esta versión; «digifact» no puede habilitarse; el proveedor simulado sigue igual.
update public.proveedores_emision set ambientes = '{simulado}', habilitado = true,
       nota = 'Canal asistido con agente local: SOLO contra el simulador local; ejecución real bloqueada hasta aclarar permisos y condiciones de SAT'
 where id = 'portal_playwright';
alter table public.proveedores_emision add constraint proveedores_portal_solo_simulado_chk check (id <> 'portal_playwright' or ambientes = '{simulado}');
alter table public.proveedores_emision add constraint proveedores_digifact_bloqueado_chk   check (id <> 'digifact' or habilitado = false);

-- ============================================================ agentes locales
create table public.agentes_locales (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas (id),
  nombre        text not null check (length(btrim(nombre)) between 1 and 80),
  clave_publica text not null check (clave_publica ~ '^[A-Za-z0-9_-]{43}$'),   -- Ed25519 crudo (32 bytes) en base64url sin relleno
  version       text check (version is null or length(version) <= 40),
  estado        text not null default 'activo' check (estado in ('activo','revocado')),
  visto_en      timestamptz,
  error_codigo  text check (error_codigo is null or length(error_codigo) <= 40),
  error_en      timestamptz,
  creado_por    uuid references auth.users (id),
  creado_en     timestamptz not null default now(),
  revocado_por  uuid references auth.users (id),
  revocado_en   timestamptz,
  unique (id, empresa_id),
  unique (clave_publica),                                   -- una clave no puede estar en dos empresas
  check ((estado = 'revocado') = (revocado_en is not null))
);
create index agentes_empresa_idx on public.agentes_locales (empresa_id, estado);

create table public.codigos_vinculacion (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas (id),
  codigo_hash text not null unique check (codigo_hash ~ '^[0-9a-f]{64}$'),   -- solo el hash; el código en claro se entrega una vez
  creado_por  uuid not null references auth.users (id),
  creado_en   timestamptz not null default now(),
  expira_en   timestamptz not null,
  usado_en    timestamptz,
  agente_id   uuid,
  foreign key (agente_id, empresa_id) references public.agentes_locales (id, empresa_id),
  check ((usado_en is null) = (agente_id is null))
);
create table public.vinculacion_fallos (id bigint generated always as identity primary key, creado_en timestamptz not null default clock_timestamp());
create table public.agente_nonces (
  agente_id uuid not null references public.agentes_locales (id),
  nonce     text not null check (length(nonce) between 16 and 64),
  creado_en timestamptz not null default clock_timestamp(),
  primary key (agente_id, nonce)
);

-- ============================================================ órdenes de emisión asistida (cola)
create table public.ordenes_emision (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null,
  operacion_id       uuid not null,
  documento_id       uuid not null,
  agente_id          uuid,
  estado             text not null default 'pendiente' check (estado in ('pendiente','reclamada','llenada','completada','descartada','fallida','incierta','cancelada')),
  token              bigint not null default 0,                                -- token de fencing: sube en cada reclamo
  lease_hasta        timestamptz,
  ambiente           text not null check (ambiente = 'simulado'),             -- separación estricta: ninguna orden real
  clave_idempotencia text not null,
  hash_contenido     text not null check (hash_contenido ~ '^[0-9a-f]{64}$'),
  instantanea        jsonb not null,
  intentos           integer not null default 0,
  serie              text, numero text, autorizacion text,
  error_codigo       text check (error_codigo is null or length(error_codigo) <= 60),
  creada_en          timestamptz not null default clock_timestamp(),
  reclamada_en       timestamptz,
  llenada_en         timestamptz,
  cerrada_en         timestamptz,
  foreign key (operacion_id, empresa_id) references public.operaciones_fiscales (id, empresa_id),
  foreign key (agente_id, empresa_id)    references public.agentes_locales (id, empresa_id),   -- un agente solo puede tener órdenes de SU empresa
  unique (operacion_id),                                                                      -- una orden por operación: sin órdenes duplicadas
  check ((estado = 'completada') = (serie is not null and numero is not null and autorizacion is not null)),
  check (autorizacion is null or autorizacion like 'SIM-%'),                                  -- una emisión simulada nunca se confunde con una real
  check (estado not in ('reclamada','llenada') or (agente_id is not null and lease_hasta is not null))
);
create index ordenes_cola_idx on public.ordenes_emision (empresa_id, estado, creada_en);

-- Guarda: la identidad de la orden es inmutable y las transiciones de estado son solo las permitidas.
create or replace function public.fel_orden_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op in ('DELETE','TRUNCATE') then raise exception 'FEL_REGLA: las órdenes no se borran'; end if;
  if new.empresa_id <> old.empresa_id or new.operacion_id <> old.operacion_id or new.documento_id <> old.documento_id or new.hash_contenido <> old.hash_contenido
     or new.instantanea <> old.instantanea or new.clave_idempotencia <> old.clave_idempotencia or new.ambiente <> old.ambiente or new.id <> old.id then
    raise exception 'FEL_REGLA: la identidad de una orden es inmutable';
  end if;
  if new.token < old.token then raise exception 'FEL_REGLA: el token de una orden nunca retrocede'; end if;
  if new.estado <> old.estado and not (
       (old.estado = 'pendiente' and new.estado in ('reclamada','cancelada'))
    or (old.estado = 'reclamada' and new.estado in ('llenada','fallida','pendiente','cancelada','incierta'))
    or (old.estado = 'llenada'  and new.estado in ('completada','descartada','incierta'))
  ) then raise exception 'FEL_ESTADO: transición de orden no permitida (% → %)', old.estado, new.estado; end if;
  if old.estado in ('completada','descartada','fallida','incierta','cancelada') and new.estado <> old.estado then raise exception 'FEL_ESTADO: una orden cerrada no se reabre'; end if;
  return new;
end $$;
create trigger ordenes_guard before update or delete on public.ordenes_emision for each row execute function public.fel_orden_guard();
create trigger ordenes_sin_truncate before truncate on public.ordenes_emision for each statement execute function public.fel_orden_guard();

-- ============================================================ RLS y privilegios: la app solo LEE lo de su empresa
alter table public.agentes_locales      enable row level security;
alter table public.codigos_vinculacion  enable row level security;
alter table public.vinculacion_fallos   enable row level security;
alter table public.agente_nonces        enable row level security;
alter table public.ordenes_emision      enable row level security;
revoke all on public.agentes_locales, public.codigos_vinculacion, public.vinculacion_fallos, public.agente_nonces, public.ordenes_emision from public, anon, authenticated;
grant select (id, empresa_id, nombre, version, estado, visto_en, error_codigo, error_en, creado_en, revocado_en) on public.agentes_locales to authenticated;   -- sin la clave pública
grant select (id, empresa_id, operacion_id, documento_id, agente_id, estado, ambiente, intentos, creada_en, reclamada_en, llenada_en, cerrada_en, serie, numero, autorizacion, error_codigo) on public.ordenes_emision to authenticated;   -- sin token ni instantánea
create policy agentes_leer on public.agentes_locales for select to authenticated using (public.fel_tiene_permiso(empresa_id, 'canales.ver'));
create policy ordenes_leer on public.ordenes_emision for select to authenticated using (public.fel_tiene_permiso(empresa_id, 'fiscal.ver'));
revoke delete, truncate on public.agentes_locales, public.codigos_vinculacion, public.agente_nonces, public.ordenes_emision from service_role;

-- Guarda del agente: empresa y clave pública inmutables; solo se pasa de activo a revocado (nunca se reactiva).
create or replace function public.fel_agente_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op in ('DELETE','TRUNCATE') then raise exception 'FEL_REGLA: los agentes no se borran'; end if;
  if new.empresa_id <> old.empresa_id or new.clave_publica <> old.clave_publica or new.id <> old.id then raise exception 'FEL_REGLA: la empresa y la clave de un agente son inmutables'; end if;
  if old.estado = 'revocado' and new.estado <> 'revocado' then raise exception 'FEL_REGLA: un agente revocado no se reactiva'; end if;
  return new;
end $$;
create trigger agentes_guard before update or delete on public.agentes_locales for each row execute function public.fel_agente_guard();
create trigger agentes_sin_truncate before truncate on public.agentes_locales for each statement execute function public.fel_agente_guard();

-- ============================================================ vinculación
create or replace function public.fel_op_agente_codigo_crear(p_actor uuid, p_empresa uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_codigo text; v_exp timestamptz;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'agentes.administrar');
  if not exists (select 1 from public.empresas where id = p_empresa) then raise exception 'FEL_NO_ENCONTRADO: empresa no encontrada'; end if;
  v_codigo := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));     -- 48 bits; de un uso y caduca
  v_exp := clock_timestamp() + make_interval(mins => public.fel__parametro('agente_codigo_min')::integer);
  insert into public.codigos_vinculacion (empresa_id, codigo_hash, creado_por, expira_en)
  values (p_empresa, encode(sha256(convert_to(v_codigo, 'UTF8')), 'hex'), p_actor, v_exp);
  perform public.fel_auditar(p_empresa, p_actor, 'agente.codigo_creado', 'agente', null, jsonb_build_object('expira_en', v_exp));
  return jsonb_build_object('codigo', substr(v_codigo, 1, 4) || '-' || substr(v_codigo, 5, 4) || '-' || substr(v_codigo, 9, 4), 'expira_en', v_exp);
end $$;

create or replace function public.fel_sys_agente_vincular(p_codigo text, p_clave_publica text, p_nombre text, p_version text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.codigos_vinculacion; v_norm text; a public.agentes_locales; v_fallos integer; v_emp text;
begin
  -- límite global de intentos fallidos (anti fuerza bruta del código)
  delete from public.vinculacion_fallos where creado_en < clock_timestamp() - interval '10 minutes';
  select count(*) into v_fallos from public.vinculacion_fallos;
  if v_fallos >= 20 then raise exception 'FEL_LIMITE: demasiados intentos de vinculación; espera unos minutos'; end if;
  v_norm := upper(replace(btrim(coalesce(p_codigo, '')), '-', ''));
  select * into c from public.codigos_vinculacion where codigo_hash = encode(sha256(convert_to(v_norm, 'UTF8')), 'hex') for update;
  if not found or c.usado_en is not null or c.expira_en < clock_timestamp() then
    insert into public.vinculacion_fallos default values;   -- no se lanza excepción: se revertiría el registro del fallo y el límite no contaría
    return jsonb_build_object('error', 'FEL_CODIGO');
  end if;
  if p_clave_publica is null or p_clave_publica !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'FEL_DATOS_INVALIDOS: clave pública no válida'; end if;
  if p_nombre is null or length(btrim(p_nombre)) not between 1 and 80 then raise exception 'FEL_DATOS_INVALIDOS: nombre del agente no válido'; end if;
  begin
    insert into public.agentes_locales (empresa_id, nombre, clave_publica, version, creado_por, visto_en)
    values (c.empresa_id, btrim(p_nombre), p_clave_publica, left(p_version, 40), c.creado_por, clock_timestamp()) returning * into a;
  exception when unique_violation then raise exception 'FEL_DATOS_INVALIDOS: esa clave pública ya está registrada';
  end;
  update public.codigos_vinculacion set usado_en = clock_timestamp(), agente_id = a.id where id = c.id;
  perform public.fel_auditar(c.empresa_id, c.creado_por, 'agente.vinculado', 'agente', a.id::text, jsonb_build_object('nombre', a.nombre, 'version', a.version), 'agente');
  select nombre_comercial into v_emp from public.empresas where id = c.empresa_id;
  return jsonb_build_object('agente_id', a.id, 'empresa_id', a.empresa_id, 'empresa', v_emp);
end $$;

create or replace function public.fel_op_agente_revocar(p_actor uuid, p_empresa uuid, p_agente uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.agentes_locales; r public.ordenes_emision;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'agentes.administrar');
  select * into a from public.agentes_locales where id = p_agente and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: agente no encontrado'; end if;
  if a.estado = 'revocado' then return; end if;
  update public.agentes_locales set estado = 'revocado', revocado_por = p_actor, revocado_en = clock_timestamp() where id = p_agente;
  -- sus órdenes activas se resuelven con las reglas de vencimiento: antes de presentar vuelven a la cola; después de presentar quedan INCIERTAS
  for r in select * from public.ordenes_emision where agente_id = p_agente and estado in ('reclamada','llenada') for update loop
    perform public.fel__orden_expirar(r.id);
  end loop;
  perform public.fel_auditar(p_empresa, p_actor, 'agente.revocado', 'agente', p_agente::text, jsonb_build_object('nombre', a.nombre));
end $$;

-- ============================================================ autenticación de cada petición (la firma Ed25519 se verifica en el plano de control con la clave de esta función)
create or replace function public.fel_sys_agente_clave(p_agente uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('clave_publica', clave_publica, 'empresa_id', empresa_id) from public.agentes_locales where id = p_agente and estado = 'activo'
$$;

create or replace function public.fel_sys_agente_autenticar(p_agente uuid, p_ts timestamptz, p_nonce text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.agentes_locales; v_max integer := public.fel__parametro('agente_reloj_max_seg')::integer;
begin
  select * into a from public.agentes_locales where id = p_agente for update;
  if not found then raise exception 'FEL_NO_AUTORIZADO: agente desconocido'; end if;
  if a.estado <> 'activo' then raise exception 'FEL_REVOCADO: el agente fue revocado'; end if;
  if p_ts is null or abs(extract(epoch from (clock_timestamp() - p_ts))) > v_max then
    update public.agentes_locales set error_codigo = 'RELOJ', error_en = clock_timestamp() where id = p_agente;
    return jsonb_build_object('ok', false, 'error', 'FEL_RELOJ', 'max_seg', v_max);   -- sin excepción: así el error queda registrado y la interfaz puede mostrarlo
  end if;
  if p_nonce is null or length(p_nonce) not between 16 and 64 then raise exception 'FEL_DATOS_INVALIDOS: nonce no válido'; end if;
  delete from public.agente_nonces where creado_en < clock_timestamp() - interval '10 minutes';
  begin insert into public.agente_nonces (agente_id, nonce) values (p_agente, p_nonce);
  exception when unique_violation then raise exception 'FEL_REPETICION: petición repetida (nonce ya usado)'; end;
  return jsonb_build_object('ok', true, 'empresa_id', a.empresa_id);
end $$;

-- latido: marca presencia, informa errores y extiende SOLO los arrendamientos vigentes del propio agente
create or replace function public.fel_sys_agente_latido(p_agente uuid, p_version text, p_error text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.agentes_locales; v_lease integer := public.fel__parametro('agente_lease_seg')::integer;
begin
  select * into a from public.agentes_locales where id = p_agente and estado = 'activo' for update;
  if not found then raise exception 'FEL_REVOCADO: el agente no está activo'; end if;
  update public.agentes_locales set visto_en = clock_timestamp(), version = coalesce(left(p_version, 40), version),
         error_codigo = nullif(left(coalesce(p_error, ''), 40), ''), error_en = case when nullif(coalesce(p_error, ''), '') is null then null else clock_timestamp() end where id = p_agente;
  update public.ordenes_emision set lease_hasta = clock_timestamp() + make_interval(secs => v_lease)
   where agente_id = p_agente and estado in ('reclamada','llenada') and lease_hasta >= clock_timestamp();
  return jsonb_build_object('estado', 'activo');
end $$;

-- ============================================================ órdenes: creación (adaptador), reclamo, progreso, resultado y vencimiento
-- Expiración de UNA orden con las reglas de la condición 1: antes de presentar vuelve a la cola; tras presentar queda incierta y la operación pasa a por_verificar.
create or replace function public.fel__orden_expirar(p_orden uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare r public.ordenes_emision; o public.operaciones_fiscales;
begin
  select * into r from public.ordenes_emision where id = p_orden for update;
  if r.estado = 'reclamada' then
    update public.ordenes_emision set estado = 'pendiente', agente_id = null, lease_hasta = null where id = p_orden;
    perform public.fel_auditar(r.empresa_id, null, 'orden.devuelta_a_la_cola', 'orden', p_orden::text, jsonb_build_object('motivo', 'arrendamiento vencido antes de presentar'), 'sistema');
    return 'pendiente';
  elsif r.estado = 'llenada' then
    update public.ordenes_emision set estado = 'incierta', lease_hasta = null, cerrada_en = clock_timestamp() where id = p_orden;
    select * into o from public.operaciones_fiscales where id = r.operacion_id and empresa_id = r.empresa_id for update;
    if o.estado = 'iniciada' then perform public.fel_sys_operacion_desconocida(r.empresa_id, r.operacion_id, 'orden_incierta'); end if;
    perform public.fel_auditar(r.empresa_id, null, 'orden.incierta', 'orden', p_orden::text, jsonb_build_object('motivo', 'sin resultado tras presentar la vista previa'), 'sistema');
    return 'incierta';
  end if;
  return r.estado;
end $$;

create or replace function public.fel_sys_ordenes_vencer(p_empresa uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare r public.ordenes_emision; n integer := 0;
begin
  for r in select * from public.ordenes_emision where estado in ('reclamada','llenada') and lease_hasta < clock_timestamp() and (p_empresa is null or empresa_id = p_empresa) order by creada_en for update skip locked loop
    perform public.fel__orden_expirar(r.id); n := n + 1;
  end loop;
  return n;
end $$;

-- Crea la orden de una operación (la llama el adaptador portal_playwright). Valida operación, canal, ambiente y hash.
create or replace function public.fel_sys_orden_crear(p_empresa uuid, p_op uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare o public.operaciones_fiscales; v jsonb; c public.empresa_canales; v_id uuid;
begin
  select * into o from public.operaciones_fiscales where id = p_op and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: operación no encontrada'; end if;
  if o.tipo <> 'certificacion' or o.estado <> 'iniciada' or o.enviada_en is null or o.orden_externa is not null then raise exception 'FEL_ESTADO: la operación no admite una orden'; end if;
  if o.proveedor is distinct from 'portal_playwright' or o.ambiente is distinct from 'simulado' then raise exception 'FEL_REGLA: solo el canal portal_playwright del ambiente simulado admite órdenes de agente'; end if;
  select * into c from public.empresa_canales where id = o.canal_id and empresa_id = p_empresa;
  if not found or not c.habilitado or c.proveedor_id <> 'portal_playwright' or c.ambiente <> 'simulado' then raise exception 'FEL_REGLA: el canal no está habilitado'; end if;
  v := public.fel_sys_documento_instantanea(p_empresa, o.documento_id);
  if v ->> 'hash' <> o.hash_contenido then raise exception 'FEL_REGLA: el contenido del documento cambió desde que se solicitó la operación'; end if;
  begin
    insert into public.ordenes_emision (empresa_id, operacion_id, documento_id, ambiente, clave_idempotencia, hash_contenido, instantanea)
    values (p_empresa, p_op, o.documento_id, 'simulado', o.clave_idempotencia, o.hash_contenido, v -> 'instantanea') returning id into v_id;
  exception when unique_violation then raise exception 'FEL_ORDEN_DUPLICADA: ya existe una orden para esta operación';
  end;
  perform public.fel_auditar(p_empresa, null, 'orden.creada', 'orden', v_id::text, jsonb_build_object('operacion', p_op), 'sistema');
  return v_id;
end $$;

create or replace function public.fel_sys_orden_por_operacion(p_empresa uuid, p_op uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', id, 'estado', estado, 'serie', serie, 'numero', numero, 'autorizacion', autorizacion, 'error_codigo', error_codigo)
    from public.ordenes_emision where operacion_id = p_op and empresa_id = p_empresa
$$;

create or replace function public.fel_sys_orden_reclamar(p_agente uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.agentes_locales; r public.ordenes_emision; o public.operaciones_fiscales; c public.empresa_canales; v_lease integer := public.fel__parametro('agente_lease_seg')::integer; v_intentos integer := 0;
begin
  select * into a from public.agentes_locales where id = p_agente and estado = 'activo' for update;
  if not found then raise exception 'FEL_REVOCADO: el agente no está activo'; end if;
  perform public.fel_sys_ordenes_vencer(a.empresa_id);
  -- un agente atiende una orden a la vez; con una orden ya PRESENTADA no recibe otra
  if exists (select 1 from public.ordenes_emision where agente_id = p_agente and estado = 'llenada') then return null; end if;
  loop
    v_intentos := v_intentos + 1; exit when v_intentos > 20;
    select * into r from public.ordenes_emision where agente_id = p_agente and estado = 'reclamada' order by creada_en limit 1 for update;   -- reinicio del propio agente: recupera la suya (token nuevo)
    if not found then
      -- solo órdenes ya vinculadas a su operación por el orquestador (o cuya operación ya no está abierta, para cancelarlas): una orden aún sin vincular no bloquea la cola
      select q.* into r from public.ordenes_emision q join public.operaciones_fiscales x on x.id = q.operacion_id and x.empresa_id = q.empresa_id
       where q.empresa_id = a.empresa_id and q.estado = 'pendiente' and (x.orden_externa = q.id::text or x.estado <> 'iniciada')
       order by q.creada_en limit 1 for update of q skip locked;
    end if;
    if not found then return null; end if;
    -- el SERVIDOR valida el estado de la operación y del canal en cada reclamo
    select * into o from public.operaciones_fiscales where id = r.operacion_id and empresa_id = r.empresa_id for update;
    if o.estado <> 'iniciada' or (o.orden_externa is not null and o.orden_externa <> r.id::text) then
      update public.ordenes_emision set estado = 'cancelada', cerrada_en = clock_timestamp(), agente_id = null, lease_hasta = null where id = r.id;
      perform public.fel_auditar(r.empresa_id, null, 'orden.cancelada', 'orden', r.id::text, jsonb_build_object('motivo', 'la operación ya no está abierta'), 'sistema');
      continue;
    end if;
    select * into c from public.empresa_canales where id = o.canal_id and empresa_id = r.empresa_id;
    if not found or not c.habilitado or c.proveedor_id <> 'portal_playwright' or c.ambiente <> 'simulado' or o.ambiente <> 'simulado' then return null; end if;
    update public.ordenes_emision set estado = 'reclamada', agente_id = p_agente, token = token + 1, lease_hasta = clock_timestamp() + make_interval(secs => v_lease),
           reclamada_en = clock_timestamp(), intentos = intentos + 1 where id = r.id returning * into r;
    perform public.fel_auditar(r.empresa_id, null, 'orden.reclamada', 'orden', r.id::text, jsonb_build_object('agente', p_agente, 'token', r.token), 'agente');
    return jsonb_build_object('orden', r.id, 'token', r.token, 'lease_hasta', r.lease_hasta, 'hash', r.hash_contenido, 'instantanea', r.instantanea, 'clave_idempotencia', r.clave_idempotencia, 'ambiente', r.ambiente);
  end loop;
  return null;
end $$;

-- Validación común de cada acción sobre una orden: agente activo, orden de su empresa y de su agente, token vigente, arrendamiento vigente y operación abierta.
create or replace function public.fel__orden_validar(p_agente uuid, p_orden uuid, p_token bigint) returns public.ordenes_emision
language plpgsql security definer set search_path = '' as $$
declare a public.agentes_locales; r public.ordenes_emision; o public.operaciones_fiscales;
begin
  select * into a from public.agentes_locales where id = p_agente and estado = 'activo';
  if not found then raise exception 'FEL_REVOCADO: el agente no está activo'; end if;
  select * into r from public.ordenes_emision where id = p_orden for update;
  if not found or r.empresa_id <> a.empresa_id then raise exception 'FEL_EMPRESA: la orden no pertenece a la empresa del agente'; end if;
  if r.agente_id is distinct from p_agente or r.token <> p_token then raise exception 'FEL_FENCING: el token o el agente ya no corresponden a esta orden'; end if;
  if r.estado not in ('reclamada','llenada') then raise exception 'FEL_ESTADO: la orden está en estado %', r.estado; end if;
  if r.lease_hasta < clock_timestamp() then
    -- no se modifica nada aquí (la excepción lo revertiría): fel_sys_ordenes_vencer aplica el vencimiento (se ejecuta en cada reclamo y en el trabajo de recuperación)
    raise exception 'FEL_FENCING: el arrendamiento de la orden venció';
  end if;
  select * into o from public.operaciones_fiscales where id = r.operacion_id and empresa_id = r.empresa_id;
  if o.estado <> 'iniciada' then raise exception 'FEL_ESTADO: la operación ya no está abierta'; end if;
  return r;
end $$;

create or replace function public.fel_sys_orden_progreso(p_agente uuid, p_orden uuid, p_token bigint, p_fase text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.ordenes_emision; v_lease integer := public.fel__parametro('agente_lease_seg')::integer;
begin
  if p_fase not in ('llenando','detenido_en_vista_previa') then raise exception 'FEL_DATOS_INVALIDOS: fase no válida'; end if;
  r := public.fel__orden_validar(p_agente, p_orden, p_token);
  if p_fase = 'llenando' and r.estado <> 'reclamada' then raise exception 'FEL_ESTADO: la orden ya fue presentada'; end if;
  update public.ordenes_emision set lease_hasta = clock_timestamp() + make_interval(secs => v_lease),
         estado = case when p_fase = 'detenido_en_vista_previa' then 'llenada' else estado end,
         llenada_en = case when p_fase = 'detenido_en_vista_previa' and estado = 'reclamada' then clock_timestamp() else llenada_en end
   where id = p_orden returning * into r;
  if p_fase = 'detenido_en_vista_previa' then perform public.fel_auditar(r.empresa_id, null, 'orden.presentada', 'orden', p_orden::text, jsonb_build_object('agente', p_agente), 'agente'); end if;
  return jsonb_build_object('estado', r.estado, 'lease_hasta', r.lease_hasta);
end $$;

create or replace function public.fel_sys_orden_resultado(p_agente uuid, p_orden uuid, p_token bigint, p_tipo text, p_serie text, p_numero text, p_autorizacion text, p_detalle text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.ordenes_emision; v_estado text;
begin
  if p_tipo not in ('emitido_simulado','descartado','error') then raise exception 'FEL_DATOS_INVALIDOS: tipo de resultado no válido'; end if;
  r := public.fel__orden_validar(p_agente, p_orden, p_token);
  if p_tipo = 'emitido_simulado' then
    if r.estado <> 'llenada' then raise exception 'FEL_ESTADO: solo una orden presentada puede emitirse'; end if;
    if coalesce(btrim(p_serie), '') = '' or coalesce(btrim(p_numero), '') = '' or p_autorizacion is null or p_autorizacion !~ '^SIM-.+' then
      raise exception 'FEL_DATOS_INVALIDOS: serie, número y una autorización con prefijo SIM- son obligatorios';
    end if;
    update public.ordenes_emision set estado = 'completada', serie = btrim(p_serie), numero = btrim(p_numero), autorizacion = p_autorizacion, lease_hasta = null, cerrada_en = clock_timestamp() where id = p_orden returning estado into v_estado;
  elsif p_tipo = 'descartado' then
    if r.estado <> 'llenada' then raise exception 'FEL_ESTADO: solo una orden presentada puede descartarse'; end if;
    update public.ordenes_emision set estado = 'descartada', lease_hasta = null, cerrada_en = clock_timestamp() where id = p_orden returning estado into v_estado;
  else
    -- error: antes de presentar se PRUEBA que nada salió (fallida); tras presentar es INCIERTO (condición 1)
    if r.estado = 'reclamada' then
      update public.ordenes_emision set estado = 'fallida', error_codigo = left(coalesce(nullif(p_detalle, ''), 'ERROR'), 60), lease_hasta = null, cerrada_en = clock_timestamp() where id = p_orden returning estado into v_estado;
    else
      update public.ordenes_emision set error_codigo = left(coalesce(nullif(p_detalle, ''), 'ERROR'), 60) where id = p_orden;
      v_estado := public.fel__orden_expirar(p_orden);   -- llenada → incierta + operación por_verificar
    end if;
  end if;
  perform public.fel_auditar(r.empresa_id, null, 'orden.resultado', 'orden', p_orden::text, jsonb_build_object('agente', p_agente, 'tipo', p_tipo, 'estado', v_estado), 'agente');
  return jsonb_build_object('estado', v_estado);
end $$;

-- Órdenes cerradas cuya operación sigue abierta (para que el cierre en NEXA sea recuperable tras una caída)
create or replace function public.fel_sys_ordenes_para_cerrar() returns table (orden_id uuid, empresa_id uuid, operacion_id uuid, estado text, serie text, numero text, autorizacion text)
language sql stable security definer set search_path = '' as $$
  select r.id, r.empresa_id, r.operacion_id, r.estado, r.serie, r.numero, r.autorizacion
    from public.ordenes_emision r join public.operaciones_fiscales o on o.id = r.operacion_id and o.empresa_id = r.empresa_id
   where r.estado in ('completada','descartada','fallida','cancelada') and o.estado = 'iniciada' and o.orden_externa = r.id::text
   order by r.cerrada_en
$$;

-- Estado del agente para la interfaz (derivado en el servidor; nada se simula)
create or replace function public.fel_op_agentes_listar(p_actor uuid, p_empresa uuid) returns table (id uuid, nombre text, version text, estado text, visto_en timestamptz, error_codigo text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'canales.ver');
  return query select a.id, a.nombre, a.version,
      case when a.estado = 'revocado' then 'revocado' when a.error_codigo is not null then 'error'
           when a.visto_en is not null and a.visto_en > clock_timestamp() - make_interval(secs => public.fel__parametro('agente_latido_max_seg')::integer) then 'conectado' else 'desconectado' end,
      a.visto_en, a.error_codigo
    from public.agentes_locales a where a.empresa_id = p_empresa order by a.creado_en;
end $$;

-- ============================================================ conciliación manual SOLO para órdenes «inciertas» (condición 1)
-- Igual que fel_op_conciliacion_proponer de la Fase 2, con un único cambio: la orden asistida ya no BLOQUEA si quedó incierta (nadie la está atendiendo).
create or replace function public.fel_op_conciliacion_proponer(
  p_actor uuid, p_empresa uuid, p_op uuid, p_tipo text, p_evidencia jsonb, p_datos jsonb) returns public.conciliaciones
language plpgsql security definer set search_path = '' as $$
declare o public.operaciones_fiscales; c public.conciliaciones; v_fecha timestamptz; v_espera integer;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'fiscal.conciliar');
  if p_tipo not in ('manual_fallida','manual_certificada') then raise exception 'FEL_REGLA: tipo de conciliación no válido'; end if;
  select * into o from public.operaciones_fiscales where id = p_op and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: operación no encontrada'; end if;
  if o.tipo <> 'certificacion' or o.estado <> 'desconocida' then raise exception 'FEL_REGLA: solo se concilia a mano una certificación de resultado desconocido'; end if;
  if o.orden_externa is not null and not exists (select 1 from public.ordenes_emision r where r.operacion_id = p_op and r.empresa_id = p_empresa and r.estado = 'incierta') then
    raise exception 'FEL_REGLA: hay una orden asistida pendiente; resuélvela con el canal';
  end if;
  -- (1) el sistema ya intentó conciliar con el proveedor y NO pudo decidir
  if not exists (select 1 from public.eventos_proveedor e where e.operacion_id = p_op and e.tipo = 'conciliacion' and e.resultado = 'indeterminado') then
    raise exception 'FEL_REGLA: antes de conciliar a mano, el proveedor debe haber sido consultado y haber respondido «indeterminado»';
  end if;
  if exists (select 1 from public.eventos_proveedor e where e.operacion_id = p_op and e.tipo = 'conciliacion' and e.resultado in ('certificado','no_existe_confirmado') and e.id > coalesce((select max(id) from public.eventos_proveedor x where x.operacion_id = p_op and x.resultado = 'indeterminado'), 0)) then
    raise exception 'FEL_REGLA: el proveedor ya dio una respuesta decisiva; la operación se resuelve sola';
  end if;
  -- (2) espera mínima desde el envío (respuestas tardías)
  v_espera := public.fel__parametro('espera_conciliacion_manual_min')::integer;
  if o.enviada_en is null or clock_timestamp() < o.enviada_en + make_interval(mins => v_espera) then
    raise exception 'FEL_ESPERA_TARDIA: deben pasar al menos % minutos desde el envío antes de una conciliación manual', v_espera;
  end if;
  -- (3) evidencia verificable y estructurada
  if jsonb_typeof(p_evidencia) <> 'object'
     or coalesce(p_evidencia ->> 'fuente', '') not in ('portal_sat_consulta','certificador_consulta','documento_fisico')
     or length(btrim(coalesce(p_evidencia ->> 'referencia', ''))) < 5
     or coalesce(p_evidencia ->> 'conclusion', '') not in ('no_figura','figura') then
    raise exception 'FEL_REGLA: evidencia no válida (fuente, referencia de al menos 5 caracteres y conclusión)';
  end if;
  begin v_fecha := (p_evidencia ->> 'fecha_consulta')::timestamptz; exception when others then v_fecha := null; end;
  if v_fecha is null or v_fecha > clock_timestamp() or v_fecha < o.enviada_en then raise exception 'FEL_REGLA: la fecha de la consulta debe ser posterior al envío y no futura'; end if;
  if (p_tipo = 'manual_fallida') <> (p_evidencia ->> 'conclusion' = 'no_figura') then raise exception 'FEL_REGLA: la conclusión de la evidencia no corresponde al tipo de conciliación'; end if;
  if p_tipo = 'manual_certificada' and (p_datos is null or coalesce(p_datos ->> 'serie','') = '' or coalesce(p_datos ->> 'numero','') = '' or coalesce(p_datos ->> 'autorizacion','') = '') then
    raise exception 'FEL_REGLA: certificar a mano exige serie, número y autorización';
  end if;
  insert into public.conciliaciones (empresa_id, operacion_id, tipo, evidencia, datos, propuesta_por)
  values (p_empresa, p_op, p_tipo, p_evidencia, case when p_tipo = 'manual_certificada' then p_datos end, p_actor) returning * into c;
  perform public.fel_auditar(p_empresa, p_actor, 'fiscal.conciliacion_propuesta', 'documento', o.documento_id::text, jsonb_build_object('operacion', p_op, 'conciliacion', c.id, 'tipo', p_tipo));
  return c;
end $$;

-- ============================================================ privilegios: las funciones nuevas solo para service_role
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like 'fel\_op\_agente%' or p.proname like 'fel\_sys\_agente%' or p.proname like 'fel\_sys\_orden%'
                  or p.proname in ('fel__orden_validar','fel__orden_expirar','fel_op_conciliacion_proponer')) loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
  revoke all on function public.fel_orden_guard() from public, anon, authenticated, service_role;
  revoke all on function public.fel_agente_guard() from public, anon, authenticated, service_role;
end $$;
