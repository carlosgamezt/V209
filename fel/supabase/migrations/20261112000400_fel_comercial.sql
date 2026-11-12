-- D2-3 · Capa COMERCIAL: planes, tarifas, contratos, monedero (prepago), pagos SIMULADOS, cargos y cobros, y las funciones de «cobertura» que reservan bolsón y monedero juntos.
-- Principios (diseño D2 + decisiones aprobadas):
--   · SEPARACIÓN: el consumo del proveedor (consumos / bolson_movimientos) y los cargos al cliente son mundos distintos. Un cargo nace de un consumo CONFIRMADO de NEXA, con la tarifa vigente COPIADA
--     en el cargo; nada que corrija el lado del proveedor modifica un cargo.
--   · Prepago, consumo mensual y suscripción son modalidades del mismo modelo; ninguna obliga a monedero.
--   · Los rechazos por datos incorrectos NO se cobran al cliente (aunque el proveedor genere consumo) y las anulaciones no se cobran mientras no haya confirmación escrita (tarifa «no cargable»).
--   · PAGOS: solo el medio «simulado» (restricción de tabla). Activar pagos reales exige una migración deliberada y autorización expresa; aquí no existe ninguna pasarela.
--   · NEXA no calcula IVA ni redondeo de sus propias facturas (V1/V2 bloqueados): el cobro solo guarda el monto neto y la REFERENCIA al documento emitido fuera de este sistema.
--   · El saldo del monedero cambia solo por su libro (igual que el bolsón); todo es numeric exacto.
-- Cambios sobre objetos previos (declarados): filas nuevas en permisos_catalogo y rol_permisos (consumo.ver, facturacion.ver para propietario y administrador).

-- ============================================================ permisos nuevos (solo datos)
insert into public.permisos_catalogo (codigo, descripcion) values
  ('consumo.ver',     'Ver el consumo de la empresa (eventos facturables)'),
  ('facturacion.ver', 'Ver el plan, el saldo, los cargos y los pagos de la empresa');
insert into public.rol_permisos (rol, permiso) values
  ('propietario', 'consumo.ver'), ('propietario', 'facturacion.ver'), ('administrador', 'consumo.ver'), ('administrador', 'facturacion.ver');

-- ============================================================ catálogo comercial
create table public.planes (
  codigo    text primary key check (codigo ~ '^[a-z][a-z0-9_]{2,39}$'),
  nombre    text not null check (length(btrim(nombre)) between 3 and 80),
  modalidad text not null check (modalidad in ('prepago','consumo_mensual','suscripcion')),
  activo    boolean not null default true,
  creado_en timestamptz not null default now()
);
create table public.plan_versiones (
  id                 uuid primary key default gen_random_uuid(),
  plan_codigo        text not null references public.planes (codigo),
  version            integer not null check (version > 0),
  vigente_desde      date not null,
  cuota_fija         numeric(18,6) not null default 0 check (cuota_fija >= 0),
  unidades_incluidas numeric(20,6) not null default 0 check (unidades_incluidas >= 0),
  permite_sobregiro  boolean not null default false,
  limite_sobregiro   numeric(18,6) not null default 0 check (limite_sobregiro >= 0),
  moneda             char(3) not null default 'GTQ' check (moneda = 'GTQ'),
  creada_por         uuid references auth.users (id),
  creada_en          timestamptz not null default now(),
  unique (plan_codigo, version),
  check (permite_sobregiro or limite_sobregiro = 0)
);
create table public.tarifas (
  id              uuid primary key default gen_random_uuid(),
  plan_version_id uuid not null references public.plan_versiones (id),
  evento_tipo     text not null references public.evento_tipos (codigo),
  precio_unitario numeric(18,6) not null check (precio_unitario >= 0),
  cargable        boolean not null,
  unique (plan_version_id, evento_tipo),
  check (cargable or precio_unitario = 0)
);

-- ============================================================ cuenta comercial y contratos (una cuenta por empresa)
create table public.cuentas_comerciales (
  id                    uuid primary key default gen_random_uuid(),
  empresa_id            uuid not null unique references public.empresas (id),
  estado                text not null default 'activa' check (estado in ('activa','suspendida','cerrada')),
  cupo_mensual_unidades numeric(20,6) check (cupo_mensual_unidades is null or cupo_mensual_unidades >= 0),
  creada_en             timestamptz not null default now(),
  unique (id, empresa_id)
);
create table public.contratos_plan (
  id                  uuid primary key default gen_random_uuid(),
  cuenta_comercial_id uuid not null,
  empresa_id          uuid not null,
  plan_version_id     uuid not null references public.plan_versiones (id),
  desde               date not null,
  hasta               date,
  creado_por          uuid references auth.users (id),
  creado_en           timestamptz not null default now(),
  foreign key (cuenta_comercial_id, empresa_id) references public.cuentas_comerciales (id, empresa_id),
  check (hasta is null or hasta > desde)
);
create unique index contratos_un_vigente on public.contratos_plan (cuenta_comercial_id) where hasta is null;

-- ============================================================ monedero (prepago): proyección + libro
create table public.monedero_saldos (
  cuenta_comercial_id uuid primary key references public.cuentas_comerciales (id),
  empresa_id          uuid not null,
  recargado           numeric(18,6) not null default 0 check (recargado >= 0),
  consumido           numeric(18,6) not null default 0 check (consumido >= 0),
  reservado           numeric(18,6) not null default 0 check (reservado >= 0),
  reembolsado         numeric(18,6) not null default 0 check (reembolsado >= 0),
  ajustado            numeric(18,6) not null default 0,
  sobregiro           numeric(18,6) not null default 0 check (sobregiro >= 0),
  actualizado_en      timestamptz not null default now(),
  foreign key (cuenta_comercial_id, empresa_id) references public.cuentas_comerciales (id, empresa_id),
  check (recargado + ajustado - consumido - reservado - reembolsado + sobregiro >= 0)            -- defensa final: el monedero no se sobregira más allá de lo contratado
);
create table public.pagos (
  id                  uuid primary key default gen_random_uuid(),
  cuenta_comercial_id uuid not null,
  empresa_id          uuid not null,
  monto               numeric(18,6) not null check (monto > 0),
  medio               text not null check (medio = 'simulado'),                                   -- SOLO simulado: no existe ninguna pasarela de pago real
  referencia_pago     text not null check (length(btrim(referencia_pago)) between 1 and 120),
  estado              text not null default 'confirmado' check (estado in ('confirmado','revertido')),
  clave_idempotencia  text not null check (length(clave_idempotencia) between 16 and 80),
  confirmado_por      uuid references auth.users (id),
  confirmado_en       timestamptz not null default now(),
  foreign key (cuenta_comercial_id, empresa_id) references public.cuentas_comerciales (id, empresa_id),
  unique (id, empresa_id), unique (empresa_id, medio, referencia_pago), unique (empresa_id, clave_idempotencia)
);
create table public.cargos (
  id                  uuid primary key default gen_random_uuid(),
  cuenta_comercial_id uuid not null,
  empresa_id          uuid not null,
  concepto            text not null check (concepto in ('evento','cuota_plan','suscripcion','ajuste')),
  naturaleza          text not null default 'cargo' check (naturaleza in ('cargo','abono')),
  consumo_id          uuid,
  cargo_origen_id     uuid,
  plan_version_id     uuid not null references public.plan_versiones (id),
  tarifa_id           uuid references public.tarifas (id),
  cantidad            numeric(20,6) not null check (cantidad > 0),
  precio_unitario     numeric(18,6) not null check (precio_unitario >= 0),                          -- COPIA de la tarifa vigente al cobrar
  monto               numeric(18,6) not null check (monto >= 0),
  periodo             date not null,
  estado              text not null default 'pendiente' check (estado in ('pendiente','incluido_en_cobro')),
  cobro_id            uuid,
  clave_idempotencia  text not null check (length(clave_idempotencia) between 16 and 80),
  creado_en           timestamptz not null default clock_timestamp(),
  foreign key (cuenta_comercial_id, empresa_id) references public.cuentas_comerciales (id, empresa_id),
  foreign key (consumo_id, empresa_id) references public.consumos (id, empresa_id),
  foreign key (cargo_origen_id, empresa_id) references public.cargos (id, empresa_id),
  unique (id, empresa_id), unique (cuenta_comercial_id, clave_idempotencia),
  check ((estado = 'pendiente') = (cobro_id is null))
);
create unique index cargos_uno_por_consumo on public.cargos (consumo_id, concepto) where consumo_id is not null and naturaleza = 'cargo';
create table public.cobros (
  id                     uuid primary key default gen_random_uuid(),
  cuenta_comercial_id    uuid not null,
  empresa_id             uuid not null,
  tipo                   text not null default 'factura' check (tipo in ('factura','nota_credito','recibo')),
  periodo                date not null,
  monto_neto             numeric(18,6) not null check (monto_neto >= 0),
  referencia_documento   text,                                                                      -- identificador del documento que NEXA emitió FUERA de este sistema
  monto_total_documento  numeric(18,6) check (monto_total_documento is null or monto_total_documento >= 0),
  estado                 text not null default 'borrador' check (estado in ('borrador','emitido','anulado')),
  creado_por             uuid references auth.users (id),
  creado_en              timestamptz not null default now(),
  foreign key (cuenta_comercial_id, empresa_id) references public.cuentas_comerciales (id, empresa_id),
  unique (id, empresa_id), unique (empresa_id, periodo, tipo),
  check ((estado = 'borrador') = (referencia_documento is null))
);
alter table public.cargos add constraint cargos_cobro_fk foreign key (cobro_id, empresa_id) references public.cobros (id, empresa_id);
create table public.monedero_movimientos (
  id                  bigint generated always as identity primary key,
  cuenta_comercial_id uuid not null,
  empresa_id          uuid not null,
  tipo                text not null check (tipo in ('recarga','reserva','liberacion','consumo','reembolso','vencimiento','ajuste')),
  monto               numeric(18,6) not null check (monto > 0),
  sentido             smallint not null default 1 check (sentido in (-1, 1)),
  pago_id             uuid,
  cargo_id            uuid,
  consumo_id          uuid,
  motivo              text check (motivo is null or length(btrim(motivo)) between 1 and 300),
  creado_por          uuid references auth.users (id),
  creado_en           timestamptz not null default clock_timestamp(),
  foreign key (cuenta_comercial_id, empresa_id) references public.cuentas_comerciales (id, empresa_id),
  foreign key (pago_id, empresa_id)    references public.pagos (id, empresa_id),
  foreign key (cargo_id, empresa_id)   references public.cargos (id, empresa_id),
  foreign key (consumo_id, empresa_id) references public.consumos (id, empresa_id),
  check (tipo = 'ajuste' or sentido = 1),
  check (tipo <> 'recarga' or pago_id is not null),
  check (tipo not in ('reserva','liberacion','consumo') or consumo_id is not null),
  check (tipo <> 'ajuste' or motivo is not null)
);
create unique index monedero_una_recarga_por_pago on public.monedero_movimientos (pago_id) where tipo = 'recarga';
create index monedero_mov_consumo_idx on public.monedero_movimientos (consumo_id) where consumo_id is not null;

-- ============================================================ protecciones
create trigger planes_solo_insertar_guard  before delete on public.planes for each row execute function public.fel_solo_insertar();
create trigger plan_versiones_solo_insertar before update or delete on public.plan_versiones for each row execute function public.fel_solo_insertar();
create trigger tarifas_solo_insertar        before update or delete on public.tarifas        for each row execute function public.fel_solo_insertar();
create trigger pagos_solo_insertar_borrado  before delete on public.pagos for each row execute function public.fel_solo_insertar();
create trigger monedero_mov_solo_insertar   before update or delete on public.monedero_movimientos for each row execute function public.fel_solo_insertar();

create or replace function public.fel_comercial_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'FEL_APPEND_ONLY: % no se borra', tg_table_name; end if;
  if tg_table_name = 'planes' then
    if (new.codigo, new.modalidad, new.creado_en) is distinct from (old.codigo, old.modalidad, old.creado_en) then raise exception 'FEL_APPEND_ONLY: de un plan solo cambian el nombre y si está activo'; end if;
  elsif tg_table_name = 'cuentas_comerciales' then
    if (new.id, new.empresa_id, new.creada_en) is distinct from (old.id, old.empresa_id, old.creada_en) then raise exception 'FEL_APPEND_ONLY: de una cuenta comercial solo cambian el estado y el cupo'; end if;
    if old.estado = 'cerrada' and new.estado <> 'cerrada' then raise exception 'FEL_REGLA: una cuenta comercial cerrada es definitiva'; end if;
  elsif tg_table_name = 'contratos_plan' then
    if (new.id, new.cuenta_comercial_id, new.empresa_id, new.plan_version_id, new.desde, new.creado_en) is distinct from (old.id, old.cuenta_comercial_id, old.empresa_id, old.plan_version_id, old.desde, old.creado_en)
       or old.hasta is not null or new.hasta is null then raise exception 'FEL_APPEND_ONLY: de un contrato solo puede cerrarse la vigencia, una vez'; end if;
  elsif tg_table_name = 'cargos' then
    if (new.id, new.cuenta_comercial_id, new.empresa_id, new.concepto, new.naturaleza, new.consumo_id, new.cargo_origen_id, new.plan_version_id, new.tarifa_id, new.cantidad, new.precio_unitario, new.monto, new.periodo, new.clave_idempotencia, new.creado_en)
       is distinct from (old.id, old.cuenta_comercial_id, old.empresa_id, old.concepto, old.naturaleza, old.consumo_id, old.cargo_origen_id, old.plan_version_id, old.tarifa_id, old.cantidad, old.precio_unitario, old.monto, old.periodo, old.clave_idempotencia, old.creado_en)
       or old.estado <> 'pendiente' or new.estado <> 'incluido_en_cobro' then raise exception 'FEL_APPEND_ONLY: de un cargo solo puede asignarse a un cobro, una vez'; end if;
  elsif tg_table_name = 'cobros' then
    if (new.id, new.cuenta_comercial_id, new.empresa_id, new.tipo, new.periodo, new.monto_neto, new.creado_en) is distinct from (old.id, old.cuenta_comercial_id, old.empresa_id, old.tipo, old.periodo, old.monto_neto, old.creado_en)
       or not ((old.estado = 'borrador' and new.estado = 'emitido') or (old.estado = 'emitido' and new.estado = 'anulado')) then
      raise exception 'FEL_APPEND_ONLY: un cobro solo avanza de borrador a emitido y de emitido a anulado';
    end if;
  elsif tg_table_name = 'pagos' then
    if (new.id, new.cuenta_comercial_id, new.empresa_id, new.monto, new.medio, new.referencia_pago, new.clave_idempotencia, new.confirmado_en) is distinct from (old.id, old.cuenta_comercial_id, old.empresa_id, old.monto, old.medio, old.referencia_pago, old.clave_idempotencia, old.confirmado_en)
       or old.estado <> 'confirmado' or new.estado <> 'revertido' then raise exception 'FEL_APPEND_ONLY: de un pago solo cambia el estado de confirmado a revertido'; end if;
  end if;
  return new;
end $$;
create trigger planes_guard before update on public.planes for each row execute function public.fel_comercial_guard();
create trigger cuentas_comerciales_guard before update or delete on public.cuentas_comerciales for each row execute function public.fel_comercial_guard();
create trigger contratos_guard before update or delete on public.contratos_plan for each row execute function public.fel_comercial_guard();
create trigger cargos_guard before update or delete on public.cargos for each row execute function public.fel_comercial_guard();
create trigger cobros_guard before update or delete on public.cobros for each row execute function public.fel_comercial_guard();

-- Un cargo por evento SOLO nace de un consumo CONFIRMADO de la misma empresa (también por inserción directa).
create or replace function public.fel_cargo_consumo_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.concepto = 'evento' and new.naturaleza = 'cargo' then
    if new.consumo_id is null or not exists (select 1 from public.consumos c where c.id = new.consumo_id and c.empresa_id = new.empresa_id and c.estado = 'confirmado') then
      raise exception 'FEL_REGLA: un cargo por evento exige un consumo confirmado';
    end if;
  end if;
  return new;
end $$;
create trigger cargos_consumo_confirmado before insert on public.cargos for each row execute function public.fel_cargo_consumo_guard();
create trigger pagos_guard before update on public.pagos for each row execute function public.fel_comercial_guard();

create or replace function public.fel_contrato_solape_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.contratos_plan c where c.cuenta_comercial_id = new.cuenta_comercial_id and c.id <> new.id
              and daterange(c.desde, c.hasta, '[)') && daterange(new.desde, new.hasta, '[)')) then
    raise exception 'FEL_REGLA: el contrato se solapa con otro de la misma cuenta';
  end if;
  return new;
end $$;
create trigger contratos_solape before insert on public.contratos_plan for each row execute function public.fel_contrato_solape_guard();

-- El saldo del monedero cambia SOLO por su libro (disparador; profundidad ≥ 2), igual que el bolsón.
create or replace function public.fel__monedero_aplicar() returns trigger language plpgsql set search_path = '' as $$
begin
  update public.monedero_saldos set
    recargado   = recargado   + case when new.tipo = 'recarga' then new.monto else 0 end,
    reservado   = reservado   + case when new.tipo = 'reserva' then new.monto when new.tipo in ('liberacion','consumo') then -new.monto else 0 end,
    consumido   = consumido   + case when new.tipo = 'consumo' then new.monto else 0 end,
    reembolsado = reembolsado + case when new.tipo = 'reembolso' then new.monto else 0 end,
    ajustado    = ajustado    + case new.tipo when 'ajuste' then new.sentido * new.monto when 'vencimiento' then -new.monto else 0 end
   where cuenta_comercial_id = new.cuenta_comercial_id;
  if not found then raise exception 'FEL_NO_ENCONTRADO: la cuenta comercial no tiene monedero'; end if;
  return null;
end $$;
create trigger monedero_mov_aplicar after insert on public.monedero_movimientos for each row execute function public.fel__monedero_aplicar();
-- el sobregiro lo fija el contrato: solo se actualiza desde fel_admin_contrato_asignar (que lo hace como parte de un movimiento nulo? no: es un parámetro, no un saldo)
create or replace function public.fel__monedero_sobregiro(p_cuenta uuid, p_valor numeric) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('fel.monedero_param', 'on', true);
  update public.monedero_saldos set sobregiro = p_valor where cuenta_comercial_id = p_cuenta;
  perform set_config('fel.monedero_param', 'off', true);
end $$;
create or replace function public.fel_monedero_saldo_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'FEL_APPEND_ONLY: los saldos del monedero no se borran'; end if;
  if (new.cuenta_comercial_id, new.empresa_id) is distinct from (old.cuenta_comercial_id, old.empresa_id) then raise exception 'FEL_APPEND_ONLY: la cuenta de un saldo no cambia'; end if;
  if current_setting('fel.monedero_param', true) = 'on' then
    if (new.recargado, new.consumido, new.reservado, new.reembolsado, new.ajustado) is distinct from (old.recargado, old.consumido, old.reservado, old.reembolsado, old.ajustado) then
      raise exception 'FEL_APPEND_ONLY: el saldo del monedero solo cambia por movimientos del libro';
    end if;
    new.actualizado_en := now(); return new;
  end if;
  if pg_trigger_depth() < 2 then raise exception 'FEL_APPEND_ONLY: el saldo del monedero solo cambia por movimientos del libro'; end if;
  if new.sobregiro is distinct from old.sobregiro then raise exception 'FEL_APPEND_ONLY: el sobregiro lo fija el contrato'; end if;
  new.actualizado_en := now(); return new;
end $$;

create trigger monedero_saldos_guard before update or delete on public.monedero_saldos for each row execute function public.fel_monedero_saldo_guard();

-- ============================================================ utilidades
-- Periodo comercial = primer día del mes en hora de Guatemala (UTC−6, sin horario de verano).
create or replace function public.fel__periodo(p_ts timestamptz) returns date language sql immutable set search_path = '' as $$
  select date_trunc('month', p_ts - interval '6 hours')::date
$$;
create or replace function public.fel__contrato_vigente(p_empresa uuid, p_fecha date) returns public.contratos_plan language sql stable security definer set search_path = '' as $$
  select c.* from public.contratos_plan c where c.empresa_id = p_empresa and c.desde <= p_fecha and (c.hasta is null or c.hasta > p_fecha) order by c.desde desc limit 1
$$;

-- ============================================================ administración (solo administrador maestro)
create or replace function public.fel_admin_plan_crear(p_actor uuid, p_codigo text, p_nombre text, p_modalidad text) returns public.planes
language plpgsql security definer set search_path = '' as $$
declare v public.planes;
begin
  perform public.fel__exigir_plataforma(p_actor);
  insert into public.planes (codigo, nombre, modalidad) values (p_codigo, btrim(p_nombre), p_modalidad) on conflict (codigo) do nothing returning * into v;
  if not found then select * into v from public.planes where codigo = p_codigo; if v.modalidad <> p_modalidad then raise exception 'FEL_IDEMPOTENCIA: el plan ya existe con otra modalidad'; end if; return v; end if;
  perform public.fel_auditar(null, p_actor, 'comercial.plan_creado', 'plan', p_codigo, jsonb_build_object('modalidad', p_modalidad));
  return v;
end $$;

-- Nueva versión de un plan con sus tarifas: [{evento, precio, cargable}]. Los eventos sin tarifa NO se cobran.
create or replace function public.fel_admin_plan_version_crear(
  p_actor uuid, p_plan text, p_desde date, p_cuota_fija numeric, p_unidades_incluidas numeric, p_permite_sobregiro boolean, p_limite_sobregiro numeric, p_tarifas jsonb) returns public.plan_versiones
language plpgsql security definer set search_path = '' as $$
declare v public.plan_versiones; t jsonb; n integer;
begin
  perform public.fel__exigir_plataforma(p_actor);
  if jsonb_typeof(p_tarifas) <> 'array' then raise exception 'FEL_REGLA: las tarifas deben ser una lista'; end if;
  if not exists (select 1 from public.planes where codigo = p_plan) then raise exception 'FEL_NO_ENCONTRADO: plan no encontrado'; end if;
  perform 1 from public.planes where codigo = p_plan for update;
  select coalesce(max(version), 0) + 1 into n from public.plan_versiones where plan_codigo = p_plan;
  insert into public.plan_versiones (plan_codigo, version, vigente_desde, cuota_fija, unidades_incluidas, permite_sobregiro, limite_sobregiro, creada_por)
  values (p_plan, n, p_desde, p_cuota_fija, p_unidades_incluidas, p_permite_sobregiro, p_limite_sobregiro, p_actor) returning * into v;
  for t in select * from jsonb_array_elements(p_tarifas) loop
    insert into public.tarifas (plan_version_id, evento_tipo, precio_unitario, cargable)
    values (v.id, t ->> 'evento', (t ->> 'precio')::numeric, coalesce((t ->> 'cargable')::boolean, false));
  end loop;
  perform public.fel_auditar(null, p_actor, 'comercial.plan_version_creada', 'plan_version', v.id::text, jsonb_build_object('plan', p_plan, 'version', n));
  return v;
end $$;

-- Asigna (o cambia) el plan de una empresa: crea su cuenta comercial y su monedero si no existen y cierra el contrato anterior sin solapar.
create or replace function public.fel_admin_contrato_asignar(p_actor uuid, p_empresa uuid, p_plan_version uuid, p_desde date) returns public.contratos_plan
language plpgsql security definer set search_path = '' as $$
declare v_cc public.cuentas_comerciales; v_pv public.plan_versiones; v_act public.contratos_plan; v_n public.contratos_plan; v_plan public.planes;
begin
  perform public.fel__exigir_plataforma(p_actor);
  if not exists (select 1 from public.empresas where id = p_empresa) then raise exception 'FEL_NO_ENCONTRADO: empresa no encontrada'; end if;
  select * into v_pv from public.plan_versiones where id = p_plan_version;
  if not found then raise exception 'FEL_NO_ENCONTRADO: versión de plan no encontrada'; end if;
  select * into v_plan from public.planes where codigo = v_pv.plan_codigo;
  if not v_plan.activo then raise exception 'FEL_REGLA: el plan no está activo'; end if;
  insert into public.cuentas_comerciales (empresa_id) values (p_empresa) on conflict (empresa_id) do nothing;
  select * into v_cc from public.cuentas_comerciales where empresa_id = p_empresa for update;
  if v_cc.estado = 'cerrada' then raise exception 'FEL_REGLA: la cuenta comercial está cerrada'; end if;
  insert into public.monedero_saldos (cuenta_comercial_id, empresa_id) values (v_cc.id, p_empresa) on conflict (cuenta_comercial_id) do nothing;
  select * into v_act from public.contratos_plan where cuenta_comercial_id = v_cc.id and hasta is null for update;
  if found then
    if v_act.plan_version_id = p_plan_version then return v_act; end if;                       -- repetición idéntica
    if p_desde <= v_act.desde then raise exception 'FEL_REGLA: el nuevo contrato debe empezar después del vigente'; end if;
    update public.contratos_plan set hasta = p_desde where id = v_act.id;
  end if;
  insert into public.contratos_plan (cuenta_comercial_id, empresa_id, plan_version_id, desde, creado_por) values (v_cc.id, p_empresa, p_plan_version, p_desde, p_actor) returning * into v_n;
  perform public.fel__monedero_sobregiro(v_cc.id, case when v_pv.permite_sobregiro then v_pv.limite_sobregiro else 0 end);
  perform public.fel_auditar(p_empresa, p_actor, 'comercial.contrato_asignado', 'contrato', v_n.id::text, jsonb_build_object('plan', v_pv.plan_codigo, 'version', v_pv.version, 'desde', p_desde));
  return v_n;
end $$;

create or replace function public.fel_admin_cuenta_comercial_ajustar(p_actor uuid, p_empresa uuid, p_estado text, p_cupo numeric, p_motivo text) returns public.cuentas_comerciales
language plpgsql security definer set search_path = '' as $$
declare v public.cuentas_comerciales;
begin
  perform public.fel__exigir_plataforma(p_actor);
  if p_motivo is null or length(btrim(p_motivo)) < 5 then raise exception 'FEL_REGLA: el motivo es obligatorio (mínimo 5 caracteres)'; end if;
  select * into v from public.cuentas_comerciales where empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: la empresa no tiene cuenta comercial'; end if;
  update public.cuentas_comerciales set estado = p_estado, cupo_mensual_unidades = p_cupo where id = v.id returning * into v;
  perform public.fel_auditar(p_empresa, p_actor, 'comercial.cuenta_ajustada', 'cuenta_comercial', v.id::text, jsonb_build_object('estado', p_estado, 'cupo', p_cupo, 'motivo', p_motivo));
  return v;
end $$;

-- Pago SIMULADO: registra el pago y recarga el monedero en una sola transacción. Idempotente por clave; la misma clave con otros datos es un error.
create or replace function public.fel_admin_pago_simulado_registrar(p_actor uuid, p_empresa uuid, p_monto numeric, p_referencia text, p_clave text) returns public.pagos
language plpgsql security definer set search_path = '' as $$
declare v_cc public.cuentas_comerciales; v_p public.pagos;
begin
  perform public.fel__exigir_plataforma(p_actor);
  select * into v_cc from public.cuentas_comerciales where empresa_id = p_empresa;
  if not found then raise exception 'FEL_SIN_PLAN: la empresa no tiene cuenta comercial'; end if;
  perform 1 from public.monedero_saldos where cuenta_comercial_id = v_cc.id for update;          -- serializa los pagos y los consumos de la cuenta
  select * into v_p from public.pagos where empresa_id = p_empresa and clave_idempotencia = p_clave;
  if found then
    if v_p.monto = p_monto and v_p.referencia_pago = btrim(p_referencia) then return v_p; end if;
    raise exception 'FEL_IDEMPOTENCIA: la clave del pago ya se usó con otros datos';
  end if;
  if v_cc.estado = 'cerrada' then raise exception 'FEL_REGLA: la cuenta comercial está cerrada'; end if;
  insert into public.pagos (cuenta_comercial_id, empresa_id, monto, medio, referencia_pago, clave_idempotencia, confirmado_por) values (v_cc.id, p_empresa, p_monto, 'simulado', btrim(p_referencia), p_clave, p_actor) returning * into v_p;
  insert into public.monedero_movimientos (cuenta_comercial_id, empresa_id, tipo, monto, pago_id, motivo, creado_por) values (v_cc.id, p_empresa, 'recarga', v_p.monto, v_p.id, 'pago simulado ' || v_p.referencia_pago, p_actor);
  perform public.fel_auditar(p_empresa, p_actor, 'comercial.pago_simulado', 'pago', v_p.id::text, jsonb_build_object('monto', v_p.monto, 'referencia', v_p.referencia_pago));
  return v_p;
end $$;

-- Agrupa los cargos pendientes de un periodo en un cobro BORRADOR (sin calcular impuestos) y luego se registra la referencia del documento emitido fuera de este sistema.
create or replace function public.fel_admin_cobro_generar(p_actor uuid, p_empresa uuid, p_periodo date) returns public.cobros
language plpgsql security definer set search_path = '' as $$
declare v_cc public.cuentas_comerciales; v_c public.cobros; v_m numeric(18,6); per date := date_trunc('month', p_periodo)::date;
begin
  perform public.fel__exigir_plataforma(p_actor);
  select * into v_cc from public.cuentas_comerciales where empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_SIN_PLAN: la empresa no tiene cuenta comercial'; end if;
  select * into v_c from public.cobros where empresa_id = p_empresa and periodo = per and tipo = 'factura';
  if found then return v_c; end if;
  select coalesce(sum(case naturaleza when 'cargo' then monto else -monto end), 0) into v_m from public.cargos where empresa_id = p_empresa and periodo = per and estado = 'pendiente';
  if v_m <= 0 then raise exception 'FEL_REGLA: no hay cargos pendientes en el periodo'; end if;
  insert into public.cobros (cuenta_comercial_id, empresa_id, periodo, monto_neto, creado_por) values (v_cc.id, p_empresa, per, v_m, p_actor) returning * into v_c;
  update public.cargos set estado = 'incluido_en_cobro', cobro_id = v_c.id where empresa_id = p_empresa and periodo = per and estado = 'pendiente';
  perform public.fel_auditar(p_empresa, p_actor, 'comercial.cobro_generado', 'cobro', v_c.id::text, jsonb_build_object('periodo', per, 'monto_neto', v_m));
  return v_c;
end $$;
create or replace function public.fel_admin_cobro_emitir(p_actor uuid, p_cobro uuid, p_referencia text, p_monto_total numeric) returns public.cobros
language plpgsql security definer set search_path = '' as $$
declare v_c public.cobros;
begin
  perform public.fel__exigir_plataforma(p_actor);
  if p_referencia is null or length(btrim(p_referencia)) < 3 then raise exception 'FEL_REGLA: la referencia del documento emitido es obligatoria'; end if;
  select * into v_c from public.cobros where id = p_cobro for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: cobro no encontrado'; end if;
  if v_c.estado = 'emitido' and v_c.referencia_documento = btrim(p_referencia) then return v_c; end if;
  if v_c.estado <> 'borrador' then raise exception 'FEL_ESTADO: el cobro ya fue emitido'; end if;
  update public.cobros set estado = 'emitido', referencia_documento = btrim(p_referencia), monto_total_documento = p_monto_total where id = p_cobro returning * into v_c;
  perform public.fel_auditar(v_c.empresa_id, p_actor, 'comercial.cobro_emitido', 'cobro', p_cobro::text, jsonb_build_object('referencia', btrim(p_referencia)));
  return v_c;
end $$;

-- ============================================================ COBERTURA: reserva atómica de bolsón + monedero (el monedero se bloquea primero, luego el bolsón)
create or replace function public.fel__monedero_retenido(p_consumo uuid) returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case when tipo = 'reserva' then monto when tipo in ('liberacion','consumo') then -monto end), 0) from public.monedero_movimientos where consumo_id = p_consumo
$$;

create or replace function public.fel_sys_cobertura_reservar(
  p_empresa uuid, p_cuenta uuid, p_evento text, p_operacion uuid, p_documento uuid, p_clave text, p_hash text) returns public.consumos
language plpgsql security definer set search_path = '' as $$
declare v_cc public.cuentas_comerciales; v_ct public.contratos_plan; v_pv public.plan_versiones; v_plan public.planes; v_t public.tarifas; v_sal public.monedero_saldos;
        v_previo public.consumos; v_c public.consumos; v_u numeric(20,6); v_monto numeric(18,6) := 0; v_mes numeric; v_hoy date := (clock_timestamp() - interval '6 hours')::date;
begin
  select * into v_previo from public.consumos where empresa_id = p_empresa and clave_idempotencia = p_clave;
  if found then return public.fel_sys_consumo_reservar(p_empresa, p_cuenta, p_evento, p_operacion, p_documento, p_clave, p_hash); end if;   -- repetición: sin tocar el monedero otra vez
  select * into v_cc from public.cuentas_comerciales where empresa_id = p_empresa for update;                                             -- 1.º el monedero
  if not found then raise exception 'FEL_SIN_PLAN: la empresa no tiene un plan contratado'; end if;
  if v_cc.estado <> 'activa' then raise exception 'FEL_REGLA: la cuenta comercial no está activa (%)', v_cc.estado; end if;
  v_ct := public.fel__contrato_vigente(p_empresa, v_hoy);
  if v_ct.id is null then raise exception 'FEL_SIN_PLAN: la empresa no tiene un contrato vigente'; end if;
  select * into v_pv from public.plan_versiones where id = v_ct.plan_version_id; select * into v_plan from public.planes where codigo = v_pv.plan_codigo;
  select * into v_t from public.tarifas where plan_version_id = v_pv.id and evento_tipo = p_evento;
  select case when r.consume = 'no' then 0 else r.unidades end into v_u from public.bolson_reglas_consumo r where r.cuenta_id = p_cuenta and r.evento_tipo = p_evento and r.vigente_hasta is null;
  v_u := coalesce(v_u, 0);
  if v_cc.cupo_mensual_unidades is not null then
    select coalesce(sum(unidades_reservadas), 0) into v_mes from public.consumos where empresa_id = p_empresa and estado <> 'liberado' and public.fel__periodo(reservado_en) = public.fel__periodo(clock_timestamp());
    if v_mes + v_u > v_cc.cupo_mensual_unidades then raise exception 'FEL_CUPO_EXCEDIDO: el cupo mensual de la empresa está agotado'; end if;
  end if;
  if v_plan.modalidad = 'prepago' and v_t.id is not null and v_t.cargable then
    v_monto := v_t.precio_unitario * v_u;
    select * into v_sal from public.monedero_saldos where cuenta_comercial_id = v_cc.id;
    if v_monto > v_sal.recargado + v_sal.ajustado - v_sal.consumido - v_sal.reservado - v_sal.reembolsado + v_sal.sobregiro then
      raise exception 'FEL_SIN_SALDO: el monedero no alcanza para esta operación (se necesita %)', v_monto;
    end if;
  end if;
  v_c := public.fel_sys_consumo_reservar(p_empresa, p_cuenta, p_evento, p_operacion, p_documento, p_clave, p_hash);                      -- 2.º el bolsón
  if v_c.id is not null and v_monto > 0 then
    insert into public.monedero_movimientos (cuenta_comercial_id, empresa_id, tipo, monto, consumo_id, motivo) values (v_cc.id, p_empresa, 'reserva', v_monto, v_c.id, 'reserva antes de enviar');
  end if;
  return v_c;
end $$;

create or replace function public.fel_sys_cobertura_confirmar(p_empresa uuid, p_consumo uuid, p_unidades numeric default null, p_referencia text default null, p_evidencia jsonb default null) returns public.consumos
language plpgsql security definer set search_path = '' as $$
declare v_c public.consumos; v_cc public.cuentas_comerciales; v_ct public.contratos_plan; v_pv public.plan_versiones; v_plan public.planes; v_t public.tarifas; v_op public.operaciones_fiscales;
        v_ret numeric(18,6); v_cant numeric(20,6); v_monto numeric(18,6) := 0; v_prev numeric := 0; v_inc numeric := 0; v_cargo public.cargos; v_fecha date;
begin
  select * into v_cc from public.cuentas_comerciales where empresa_id = p_empresa for update;                                             -- 1.º el monedero
  v_c := public.fel_sys_consumo_confirmar(p_empresa, p_consumo, p_unidades, p_referencia, p_evidencia);                                  -- 2.º el bolsón (idempotente)
  if v_cc.id is null then return v_c; end if;
  if exists (select 1 from public.cargos where consumo_id = v_c.id and naturaleza = 'cargo') then return v_c; end if;                     -- ya cobrado (repetición)
  v_fecha := (v_c.reservado_en - interval '6 hours')::date;
  v_ct := public.fel__contrato_vigente(p_empresa, v_fecha);
  if v_ct.id is not null then
    select * into v_pv from public.plan_versiones where id = v_ct.plan_version_id; select * into v_plan from public.planes where codigo = v_pv.plan_codigo;
    select * into v_t from public.tarifas where plan_version_id = v_pv.id and evento_tipo = v_c.evento_tipo;
    v_cant := v_c.unidades_consumidas;
    -- POLÍTICA: un rechazo confirmado de una operación fiscal (datos incorrectos) NO se cobra aunque el proveedor haya consumido; la anulación solo se cobra si su tarifa es cargable
    if v_c.operacion_id is not null and v_c.evento_tipo in ('certificacion','anulacion') then
      select * into v_op from public.operaciones_fiscales where id = v_c.operacion_id and empresa_id = p_empresa;
      if v_op.estado = 'confirmada_fallida' then v_cant := 0; end if;
    end if;
    if v_t.id is not null and v_t.cargable and v_cant > 0 then
      if v_plan.modalidad = 'suscripcion' and v_pv.unidades_incluidas > 0 then      -- unidades incluidas en la cuota del periodo
        select coalesce(sum(unidades_consumidas), 0) into v_prev from public.consumos
         where empresa_id = p_empresa and estado = 'confirmado' and id <> v_c.id and public.fel__periodo(resuelto_en) = public.fel__periodo(v_c.resuelto_en)
           and exists (select 1 from public.tarifas tt where tt.plan_version_id = v_pv.id and tt.evento_tipo = consumos.evento_tipo and tt.cargable);
        v_inc := greatest(0, v_pv.unidades_incluidas - v_prev);
        v_cant := greatest(0, v_cant - v_inc);
      end if;
      if v_cant > 0 then
        v_monto := v_t.precio_unitario * v_cant;
        insert into public.cargos (cuenta_comercial_id, empresa_id, concepto, consumo_id, plan_version_id, tarifa_id, cantidad, precio_unitario, monto, periodo, clave_idempotencia)
        values (v_cc.id, p_empresa, 'evento', v_c.id, v_pv.id, v_t.id, v_cant, v_t.precio_unitario, v_monto, public.fel__periodo(v_c.resuelto_en), 'cargo-' || v_c.id::text) returning * into v_cargo;
      end if;
    end if;
  end if;
  v_ret := public.fel__monedero_retenido(v_c.id);                                                                                         -- liquidar lo retenido en el monedero
  if v_ret > 0 then
    if v_cargo.id is not null and v_plan.modalidad = 'prepago' then
      insert into public.monedero_movimientos (cuenta_comercial_id, empresa_id, tipo, monto, consumo_id, cargo_id, motivo) values (v_cc.id, p_empresa, 'consumo', least(v_ret, v_cargo.monto), v_c.id, v_cargo.id, 'cargo del consumo');
      if v_ret - v_cargo.monto > 0 then insert into public.monedero_movimientos (cuenta_comercial_id, empresa_id, tipo, monto, consumo_id, motivo) values (v_cc.id, p_empresa, 'liberacion', v_ret - v_cargo.monto, v_c.id, 'excedente retenido'); end if;
    else
      insert into public.monedero_movimientos (cuenta_comercial_id, empresa_id, tipo, monto, consumo_id, motivo) values (v_cc.id, p_empresa, 'liberacion', v_ret, v_c.id, 'sin cargo: se libera lo retenido');
    end if;
  end if;
  if v_cargo.id is not null then perform public.fel_auditar(p_empresa, null, 'comercial.cargo_generado', 'cargo', v_cargo.id::text, jsonb_build_object('consumo', v_c.id, 'monto', v_cargo.monto), 'sistema'); end if;
  return v_c;
end $$;

create or replace function public.fel_sys_cobertura_liberar(p_empresa uuid, p_consumo uuid, p_origen text, p_evidencia jsonb) returns public.consumos
language plpgsql security definer set search_path = '' as $$
declare v_c public.consumos; v_cc public.cuentas_comerciales; v_ret numeric(18,6);
begin
  select * into v_cc from public.cuentas_comerciales where empresa_id = p_empresa for update;
  v_c := public.fel_sys_consumo_liberar(p_empresa, p_consumo, p_origen, p_evidencia);
  if v_cc.id is null then return v_c; end if;
  v_ret := public.fel__monedero_retenido(v_c.id);
  if v_ret > 0 then insert into public.monedero_movimientos (cuenta_comercial_id, empresa_id, tipo, monto, consumo_id, motivo) values (v_cc.id, p_empresa, 'liberacion', v_ret, v_c.id, 'liberación: ' || p_origen); end if;
  return v_c;
end $$;

-- Coherencia comercial (solo lectura): el monedero reproduce su libro; cada cargo corresponde a un consumo confirmado y suma exacta.
create or replace function public.fel_sys_verificar_monederos() returns table (cuenta_comercial_id uuid, campo text, saldo numeric, libro numeric, ok boolean)
language sql stable security definer set search_path = '' as $$
  with m as (
    select s.cuenta_comercial_id,
      coalesce(sum(case when mv.tipo = 'recarga' then mv.monto end), 0) as recargado,
      coalesce(sum(case when mv.tipo = 'consumo' then mv.monto end), 0) as consumido,
      coalesce(sum(case when mv.tipo = 'reserva' then mv.monto when mv.tipo in ('liberacion','consumo') then -mv.monto end), 0) as reservado,
      coalesce(sum(case when mv.tipo = 'reembolso' then mv.monto end), 0) as reembolsado,
      coalesce(sum(case mv.tipo when 'ajuste' then mv.sentido * mv.monto when 'vencimiento' then -mv.monto end), 0) as ajustado
      from public.monedero_saldos s left join public.monedero_movimientos mv on mv.cuenta_comercial_id = s.cuenta_comercial_id group by s.cuenta_comercial_id)
  select s.cuenta_comercial_id, v.campo, v.saldo, v.libro, v.saldo = v.libro from public.monedero_saldos s join m on m.cuenta_comercial_id = s.cuenta_comercial_id
    cross join lateral (values ('recargado', s.recargado, m.recargado), ('consumido', s.consumido, m.consumido), ('reservado', s.reservado, m.reservado), ('reembolsado', s.reembolsado, m.reembolsado), ('ajustado', s.ajustado, m.ajustado)) v(campo, saldo, libro)
   order by s.cuenta_comercial_id, v.campo
$$;

-- ============================================================ RLS y privilegios
alter table public.planes enable row level security; alter table public.plan_versiones enable row level security; alter table public.tarifas enable row level security;
alter table public.cuentas_comerciales enable row level security; alter table public.contratos_plan enable row level security; alter table public.monedero_saldos enable row level security;
alter table public.monedero_movimientos enable row level security; alter table public.pagos enable row level security; alter table public.cargos enable row level security; alter table public.cobros enable row level security;
revoke all on public.planes, public.plan_versiones, public.tarifas, public.cuentas_comerciales, public.contratos_plan, public.monedero_saldos, public.monedero_movimientos, public.pagos, public.cargos, public.cobros
  from public, anon, authenticated, service_role;
grant select on public.planes, public.plan_versiones, public.tarifas, public.cuentas_comerciales, public.contratos_plan, public.monedero_saldos, public.monedero_movimientos, public.pagos, public.cargos, public.cobros to authenticated;   -- RLS decide

-- La empresa ve SOLO lo suyo (con facturacion.ver); el maestro ve todo. El catálogo (planes, versiones, tarifas) solo se ve si la empresa lo tiene contratado.
create policy cuentas_comerciales_leer on public.cuentas_comerciales for select to authenticated using (public.fel_tiene_permiso(empresa_id, 'facturacion.ver') or public.fel_es_admin_plataforma());
create policy contratos_leer on public.contratos_plan for select to authenticated using (public.fel_tiene_permiso(empresa_id, 'facturacion.ver') or public.fel_es_admin_plataforma());
create policy monedero_saldos_leer on public.monedero_saldos for select to authenticated using (public.fel_tiene_permiso(empresa_id, 'facturacion.ver') or public.fel_es_admin_plataforma());
create policy monedero_mov_leer on public.monedero_movimientos for select to authenticated using (public.fel_tiene_permiso(empresa_id, 'facturacion.ver') or public.fel_es_admin_plataforma());
create policy pagos_leer on public.pagos for select to authenticated using (public.fel_tiene_permiso(empresa_id, 'facturacion.ver') or public.fel_es_admin_plataforma());
create policy cargos_leer on public.cargos for select to authenticated using (public.fel_tiene_permiso(empresa_id, 'facturacion.ver') or public.fel_es_admin_plataforma());
create policy cobros_leer on public.cobros for select to authenticated using (public.fel_tiene_permiso(empresa_id, 'facturacion.ver') or public.fel_es_admin_plataforma());
create policy plan_versiones_leer on public.plan_versiones for select to authenticated using (public.fel_es_admin_plataforma()
  or exists (select 1 from public.contratos_plan c where c.plan_version_id = plan_versiones.id and public.fel_tiene_permiso(c.empresa_id, 'facturacion.ver')));
create policy tarifas_leer on public.tarifas for select to authenticated using (public.fel_es_admin_plataforma()
  or exists (select 1 from public.contratos_plan c where c.plan_version_id = tarifas.plan_version_id and public.fel_tiene_permiso(c.empresa_id, 'facturacion.ver')));
create policy planes_leer on public.planes for select to authenticated using (public.fel_es_admin_plataforma()
  or exists (select 1 from public.plan_versiones v join public.contratos_plan c on c.plan_version_id = v.id where v.plan_codigo = planes.codigo and public.fel_tiene_permiso(c.empresa_id, 'facturacion.ver')));

do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like 'fel\_admin\_plan%' or p.proname in ('fel_admin_contrato_asignar','fel_admin_cuenta_comercial_ajustar','fel_admin_pago_simulado_registrar','fel_admin_cobro_generar','fel_admin_cobro_emitir',
                 'fel_sys_cobertura_reservar','fel_sys_cobertura_confirmar','fel_sys_cobertura_liberar','fel_sys_verificar_monederos','fel__monedero_retenido','fel__contrato_vigente','fel__monedero_sobregiro','fel__periodo')) loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
  revoke all on function public.fel_comercial_guard() from public, anon, authenticated, service_role;
  revoke all on function public.fel_contrato_solape_guard() from public, anon, authenticated, service_role;
  revoke all on function public.fel_cargo_consumo_guard() from public, anon, authenticated, service_role;
  revoke all on function public.fel__monedero_aplicar() from public, anon, authenticated, service_role;
  revoke all on function public.fel_monedero_saldo_guard() from public, anon, authenticated, service_role;
end $$;
