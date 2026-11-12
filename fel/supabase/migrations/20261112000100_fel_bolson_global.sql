-- D2-1 · Bolsón global de Digifact (mundo A, solo plataforma). SOLO objetos nuevos: ninguna tabla ni función existente se modifica.
-- Diseño aprobado: fel/docs (DISENO-D2-BOLSON-MULTIEMPRESA §3.1–3.2 y §4). Sin conexión con ningún proveedor real: no hay credenciales, ni red, ni cuentas de producción.
--   · Estas tablas guardan HECHOS del proveedor (compras, reglas de consumo, extractos). Ninguna empresa cliente puede verlas (RLS: solo administrador maestro).
--   · Libros de solo inserción; los saldos viven en una proyección con restricción que impide el sobreconsumo.
--   · Escritura únicamente por funciones fel_admin_* (actor = administrador maestro). Ningún acceso directo de authenticated ni de service_role a las tablas.

-- ============================================================ catálogo de eventos facturables (global; solo inserción)
create table public.evento_tipos (
  codigo      text primary key check (codigo ~ '^[a-z][a-z_]{2,39}$'),
  descripcion text not null check (length(btrim(descripcion)) >= 5),
  fiscal      boolean not null,                      -- ligado a una operación fiscal
  creado_en   timestamptz not null default now()
);
insert into public.evento_tipos (codigo, descripcion, fiscal) values
  ('certificacion',            'Certificación de un DTE',                                           true),
  ('anulacion',                'Anulación de un DTE (solo modelo de datos; la operación fiscal no está implementada)', true),
  ('consulta',                 'Consulta del estado de un DTE o de la cuenta',                      true),
  ('rechazo_proveedor',        'Solicitud rechazada por el proveedor',                              true),
  ('rechazo_validacion_local', 'Solicitud rechazada por validación local de NEXA (no llega al proveedor)', true),
  ('nota_credito',             'Nota de crédito',                                                   true),
  ('reintento_confirmado',     'Reintento permitido tras confirmar que no hubo resultado',          true),
  ('descarga_artefacto',       'Descarga de XML/PDF',                                               false),
  ('devolucion',               'Unidades devueltas por el proveedor',                               false),
  ('otro',                     'Otra operación facturable',                                         false);

-- ============================================================ cuentas del proveedor
create table public.bolson_cuentas (
  id                 uuid primary key default gen_random_uuid(),
  proveedor_id       text not null references public.proveedores_emision (id),
  ambiente           text not null check (ambiente in ('pruebas','produccion')),
  referencia_externa text not null check (length(btrim(referencia_externa)) between 1 and 120),   -- identificador, NUNCA credenciales
  unidad             text not null default 'documento' check (length(btrim(unidad)) between 1 and 40),
  estado             text not null default 'activa' check (estado in ('activa','pausada','cerrada')),
  creada_por         uuid references auth.users (id),
  creada_en          timestamptz not null default now(),
  unique (proveedor_id, ambiente, referencia_externa),
  check (ambiente <> 'produccion' or proveedor_id = 'digifact')
);

-- ============================================================ lotes (compras/recargas; solo inserción)
create table public.bolson_lotes (
  id                   uuid primary key default gen_random_uuid(),
  cuenta_id            uuid not null references public.bolson_cuentas (id),
  unidades             numeric(20,6) not null check (unidades > 0),
  costo_total          numeric(18,6) not null check (costo_total >= 0),
  moneda               char(3) not null default 'GTQ' check (moneda = 'GTQ'),
  referencia_proveedor text not null check (length(btrim(referencia_proveedor)) between 1 and 120),
  vigente_desde        timestamptz not null default now(),
  vence_en             timestamptz,
  registrado_por       uuid references auth.users (id),
  registrado_en        timestamptz not null default now(),
  unique (cuenta_id, referencia_proveedor),
  check (vence_en is null or vence_en > vigente_desde)
);

-- ============================================================ reglas de consumo (qué eventos consumen; versionadas)
create table public.bolson_reglas_consumo (
  id             uuid primary key default gen_random_uuid(),
  cuenta_id      uuid not null references public.bolson_cuentas (id),
  evento_tipo    text not null references public.evento_tipos (codigo),
  consume        text not null check (consume in ('si','no','desconocido')),
  unidades       numeric(20,6) not null check (unidades >= 0),
  medible        boolean not null,
  fuente         text not null check (fuente in ('pendiente','contrato_escrito','observado_en_pruebas','definicion_interna')),
  evidencia      jsonb,
  vigente_desde  timestamptz not null,
  vigente_hasta  timestamptz,
  registrada_por uuid references auth.users (id),
  registrada_en  timestamptz not null default now(),
  check (vigente_hasta is null or vigente_hasta > vigente_desde),
  check (consume = 'desconocido' or fuente <> 'pendiente'),                         -- una regla firme exige fuente
  check (fuente not in ('contrato_escrito','observado_en_pruebas') or evidencia is not null),
  check (consume <> 'no' or unidades = 0),
  check (consume <> 'si' or unidades > 0)
);
create unique index bolson_reglas_una_vigente on public.bolson_reglas_consumo (cuenta_id, evento_tipo) where vigente_hasta is null;

-- ============================================================ extractos de consumo reportados por el proveedor (solo inserción)
create table public.bolson_extractos (
  id             uuid primary key default gen_random_uuid(),
  cuenta_id      uuid not null references public.bolson_cuentas (id),
  periodo_desde  date not null,
  periodo_hasta  date not null,
  fuente         text not null check (fuente in ('api','archivo','manual')),
  hash_contenido text not null check (hash_contenido ~ '^[0-9a-f]{64}$'),
  saldo_inicial  numeric(20,6) not null,
  saldo_final    numeric(20,6) not null,
  importado_por  uuid references auth.users (id),
  importado_en   timestamptz not null default now(),
  check (periodo_hasta >= periodo_desde),
  unique (cuenta_id, hash_contenido),
  unique (id, cuenta_id)
);
create table public.bolson_extracto_lineas (
  id                 uuid primary key default gen_random_uuid(),
  extracto_id        uuid not null,
  cuenta_id          uuid not null,
  numero_linea       integer not null check (numero_linea > 0),
  referencia_externa text not null check (length(btrim(referencia_externa)) between 1 and 200),
  evento_externo     text not null check (length(btrim(evento_externo)) between 1 and 80),
  unidades           numeric(20,6) not null,
  ocurrido_en        timestamptz not null,
  nit_declarado      text check (nit_declarado is null or length(nit_declarado) <= 20),
  hash_linea         text not null check (hash_linea ~ '^[0-9a-f]{64}$'),
  foreign key (extracto_id, cuenta_id) references public.bolson_extractos (id, cuenta_id),
  unique (extracto_id, numero_linea),
  unique (cuenta_id, hash_linea)                                                    -- extractos solapados no duplican consumos
);

-- ============================================================ proyección de saldos (una fila por cuenta)
create table public.bolson_saldos (
  cuenta_id      uuid primary key references public.bolson_cuentas (id),
  comprado       numeric(20,6) not null default 0 check (comprado >= 0),
  consumido      numeric(20,6) not null default 0 check (consumido >= 0),
  reservado      numeric(20,6) not null default 0 check (reservado >= 0),
  ajustado       numeric(20,6) not null default 0,
  actualizado_en timestamptz not null default now(),
  check (comprado + ajustado - consumido - reservado >= 0)                          -- defensa final contra el sobreconsumo
);

-- ============================================================ protecciones (triggers)
create trigger evento_tipos_solo_insertar            before update or delete on public.evento_tipos           for each row execute function public.fel_solo_insertar();
create trigger bolson_lotes_solo_insertar            before update or delete on public.bolson_lotes           for each row execute function public.fel_solo_insertar();
create trigger bolson_extractos_solo_insertar        before update or delete on public.bolson_extractos       for each row execute function public.fel_solo_insertar();
create trigger bolson_extracto_lineas_solo_insertar  before update or delete on public.bolson_extracto_lineas for each row execute function public.fel_solo_insertar();

create or replace function public.fel_bolson_cuenta_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'FEL_APPEND_ONLY: las cuentas del bolsón no se borran'; end if;
  if (new.id, new.proveedor_id, new.ambiente, new.referencia_externa, new.unidad, new.creada_por, new.creada_en)
     is distinct from (old.id, old.proveedor_id, old.ambiente, old.referencia_externa, old.unidad, old.creada_por, old.creada_en) then
    raise exception 'FEL_APPEND_ONLY: de una cuenta del bolsón solo puede cambiar el estado';
  end if;
  if new.estado is distinct from old.estado and (old.estado = 'cerrada' or not (
        (old.estado = 'activa' and new.estado in ('pausada','cerrada')) or (old.estado = 'pausada' and new.estado in ('activa','cerrada')))) then
    raise exception 'FEL_REGLA: transición de estado de la cuenta no permitida (% → %)', old.estado, new.estado;
  end if;
  return new;
end $$;
create trigger bolson_cuentas_guard before update or delete on public.bolson_cuentas for each row execute function public.fel_bolson_cuenta_guard();

create or replace function public.fel_bolson_regla_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'FEL_APPEND_ONLY: las reglas de consumo no se borran'; end if;
  if tg_op = 'UPDATE' then
    -- única modificación permitida: cerrar la vigencia (NULL → fecha posterior al inicio), una sola vez
    if (new.id, new.cuenta_id, new.evento_tipo, new.consume, new.unidades, new.medible, new.fuente, new.evidencia, new.vigente_desde, new.registrada_por, new.registrada_en)
       is distinct from (old.id, old.cuenta_id, old.evento_tipo, old.consume, old.unidades, old.medible, old.fuente, old.evidencia, old.vigente_desde, old.registrada_por, old.registrada_en)
       or old.vigente_hasta is not null or new.vigente_hasta is null then
      raise exception 'FEL_APPEND_ONLY: de una regla de consumo solo puede cerrarse la vigencia, una vez';
    end if;
    return new;
  end if;
  -- inserción: sin solapamiento de vigencias para la misma cuenta y evento
  if exists (select 1 from public.bolson_reglas_consumo r
              where r.cuenta_id = new.cuenta_id and r.evento_tipo = new.evento_tipo
                and tstzrange(r.vigente_desde, r.vigente_hasta, '[)') && tstzrange(new.vigente_desde, new.vigente_hasta, '[)')) then
    raise exception 'FEL_REGLA: la vigencia de la regla se solapa con otra de la misma cuenta y evento';
  end if;
  return new;
end $$;
create trigger bolson_reglas_guard before insert or update or delete on public.bolson_reglas_consumo for each row execute function public.fel_bolson_regla_guard();

create or replace function public.fel_bolson_saldo_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'FEL_APPEND_ONLY: los saldos del bolsón no se borran'; end if;
  if new.cuenta_id is distinct from old.cuenta_id then raise exception 'FEL_APPEND_ONLY: la cuenta de un saldo no cambia'; end if;
  if new.comprado < old.comprado then raise exception 'FEL_REGLA: lo comprado no disminuye (las correcciones son ajustes)'; end if;
  new.actualizado_en := now();
  return new;
end $$;
create trigger bolson_saldos_guard before update or delete on public.bolson_saldos for each row execute function public.fel_bolson_saldo_guard();

-- ============================================================ funciones (solo administrador maestro)
-- Reglas iniciales de una cuenta: TODO lo desconocido se trata como que consume (conservador). La validación local nunca llega al proveedor (definición interna); una devolución desconocida no devuelve nada.
create or replace function public.fel__bolson_sembrar_reglas(p_actor uuid, p_cuenta uuid, p_evento text default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into public.bolson_reglas_consumo (cuenta_id, evento_tipo, consume, unidades, medible, fuente, vigente_desde, registrada_por)
  select p_cuenta, e.codigo,
         case when e.codigo = 'rechazo_validacion_local' then 'no' else 'desconocido' end,
         case when e.codigo in ('rechazo_validacion_local','devolucion') then 0 else 1 end,
         true,
         case when e.codigo = 'rechazo_validacion_local' then 'definicion_interna' else 'pendiente' end,
         now(), p_actor
    from public.evento_tipos e
   where (p_evento is null or e.codigo = p_evento)
     and not exists (select 1 from public.bolson_reglas_consumo r where r.cuenta_id = p_cuenta and r.evento_tipo = e.codigo and r.vigente_hasta is null);
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.fel_admin_bolson_cuenta_crear(
  p_actor uuid, p_proveedor text, p_ambiente text, p_referencia text, p_unidad text default 'documento') returns public.bolson_cuentas
language plpgsql security definer set search_path = '' as $$
declare v_prov public.proveedores_emision; v_c public.bolson_cuentas;
begin
  perform public.fel__exigir_plataforma(p_actor);
  select * into v_prov from public.proveedores_emision where id = p_proveedor;
  if not found then raise exception 'FEL_REGLA: proveedor desconocido'; end if;
  if p_ambiente = 'produccion' and not v_prov.habilitado then
    raise exception 'FEL_REGLA: no se pueden crear cuentas de producción mientras el proveedor % no esté habilitado por autorización escrita', p_proveedor;
  end if;
  insert into public.bolson_cuentas (proveedor_id, ambiente, referencia_externa, unidad, creada_por)
  values (p_proveedor, p_ambiente, btrim(p_referencia), coalesce(p_unidad, 'documento'), p_actor)
  on conflict (proveedor_id, ambiente, referencia_externa) do nothing
  returning * into v_c;
  if not found then   -- repetición idempotente: devuelve la existente sin tocar nada
    select * into v_c from public.bolson_cuentas where proveedor_id = p_proveedor and ambiente = p_ambiente and referencia_externa = btrim(p_referencia);
    return v_c;
  end if;
  insert into public.bolson_saldos (cuenta_id) values (v_c.id);
  perform public.fel__bolson_sembrar_reglas(p_actor, v_c.id);
  perform public.fel_auditar(null, p_actor, 'bolson.cuenta_creada', 'bolson_cuenta', v_c.id::text,
    jsonb_build_object('proveedor', p_proveedor, 'ambiente', p_ambiente, 'unidad', v_c.unidad));
  return v_c;
end $$;

create or replace function public.fel_admin_bolson_cuenta_estado(p_actor uuid, p_cuenta uuid, p_estado text, p_motivo text) returns public.bolson_cuentas
language plpgsql security definer set search_path = '' as $$
declare v_c public.bolson_cuentas;
begin
  perform public.fel__exigir_plataforma(p_actor);
  if p_motivo is null or length(btrim(p_motivo)) < 5 then raise exception 'FEL_REGLA: el motivo es obligatorio (mínimo 5 caracteres)'; end if;
  select * into v_c from public.bolson_cuentas where id = p_cuenta for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: cuenta del bolsón no encontrada'; end if;
  if v_c.estado = p_estado then return v_c; end if;
  update public.bolson_cuentas set estado = p_estado where id = p_cuenta returning * into v_c;
  perform public.fel_auditar(null, p_actor, 'bolson.cuenta_estado', 'bolson_cuenta', p_cuenta::text, jsonb_build_object('estado', p_estado, 'motivo', p_motivo));
  return v_c;
end $$;

create or replace function public.fel_admin_bolson_evento_tipo_crear(p_actor uuid, p_codigo text, p_descripcion text, p_fiscal boolean) returns public.evento_tipos
language plpgsql security definer set search_path = '' as $$
declare v_t public.evento_tipos; c record;
begin
  perform public.fel__exigir_plataforma(p_actor);
  insert into public.evento_tipos (codigo, descripcion, fiscal) values (p_codigo, p_descripcion, p_fiscal)
  on conflict (codigo) do nothing returning * into v_t;
  if not found then select * into v_t from public.evento_tipos where codigo = p_codigo; return v_t; end if;
  -- invariante: toda cuenta tiene siempre una regla vigente para cada tipo de evento (nueva ⇒ desconocida, conservadora)
  for c in select id from public.bolson_cuentas order by id loop perform public.fel__bolson_sembrar_reglas(p_actor, c.id, p_codigo); end loop;
  perform public.fel_auditar(null, p_actor, 'bolson.evento_tipo_creado', 'evento_tipo', p_codigo, jsonb_build_object('fiscal', p_fiscal));
  return v_t;
end $$;

create or replace function public.fel_admin_bolson_regla_registrar(
  p_actor uuid, p_cuenta uuid, p_evento text, p_consume text, p_unidades numeric, p_medible boolean, p_fuente text, p_evidencia jsonb,
  p_vigente_desde timestamptz default null) returns public.bolson_reglas_consumo
language plpgsql security definer set search_path = '' as $$
declare v_act public.bolson_reglas_consumo; v_n public.bolson_reglas_consumo; v_desde timestamptz;
begin
  perform public.fel__exigir_plataforma(p_actor);
  perform 1 from public.bolson_cuentas where id = p_cuenta for update;           -- serializa los cambios de reglas de la cuenta
  if not found then raise exception 'FEL_NO_ENCONTRADO: cuenta del bolsón no encontrada'; end if;
  if not exists (select 1 from public.evento_tipos where codigo = p_evento) then raise exception 'FEL_REGLA: tipo de evento desconocido'; end if;
  v_desde := coalesce(p_vigente_desde, clock_timestamp());
  select * into v_act from public.bolson_reglas_consumo where cuenta_id = p_cuenta and evento_tipo = p_evento and vigente_hasta is null for update;
  if found then
    if v_desde <= v_act.vigente_desde then raise exception 'FEL_REGLA: la nueva vigencia debe ser posterior al inicio de la regla vigente'; end if;
    update public.bolson_reglas_consumo set vigente_hasta = v_desde where id = v_act.id;
  end if;
  insert into public.bolson_reglas_consumo (cuenta_id, evento_tipo, consume, unidades, medible, fuente, evidencia, vigente_desde, registrada_por)
  values (p_cuenta, p_evento, p_consume, p_unidades, p_medible, p_fuente, p_evidencia, v_desde, p_actor) returning * into v_n;
  perform public.fel_auditar(null, p_actor, 'bolson.regla_registrada', 'bolson_regla', v_n.id::text,
    jsonb_build_object('cuenta', p_cuenta, 'evento', p_evento, 'consume', p_consume, 'unidades', p_unidades, 'fuente', p_fuente));
  return v_n;
end $$;

create or replace function public.fel_admin_bolson_lote_registrar(
  p_actor uuid, p_cuenta uuid, p_unidades numeric, p_costo_total numeric, p_referencia text,
  p_vigente_desde timestamptz default null, p_vence_en timestamptz default null) returns public.bolson_lotes
language plpgsql security definer set search_path = '' as $$
declare v_c public.bolson_cuentas; v_l public.bolson_lotes;
begin
  perform public.fel__exigir_plataforma(p_actor);
  perform 1 from public.bolson_saldos where cuenta_id = p_cuenta for update;     -- serializa compras y deja el saldo consistente
  if not found then raise exception 'FEL_NO_ENCONTRADO: cuenta del bolsón no encontrada'; end if;
  select * into v_c from public.bolson_cuentas where id = p_cuenta;
  if v_c.estado = 'cerrada' then raise exception 'FEL_REGLA: la cuenta del bolsón está cerrada'; end if;
  select * into v_l from public.bolson_lotes where cuenta_id = p_cuenta and referencia_proveedor = btrim(p_referencia);
  if found then   -- repetición: idempotente si es idéntica; si difiere, error (nunca se acepta en silencio)
    if v_l.unidades = p_unidades and v_l.costo_total = p_costo_total then return v_l; end if;
    raise exception 'FEL_IDEMPOTENCIA: la referencia del lote ya existe con datos distintos';
  end if;
  insert into public.bolson_lotes (cuenta_id, unidades, costo_total, referencia_proveedor, vigente_desde, vence_en, registrado_por)
  values (p_cuenta, p_unidades, p_costo_total, btrim(p_referencia), coalesce(p_vigente_desde, now()), p_vence_en, p_actor) returning * into v_l;
  update public.bolson_saldos set comprado = comprado + v_l.unidades where cuenta_id = p_cuenta;
  perform public.fel_auditar(null, p_actor, 'bolson.lote_registrado', 'bolson_lote', v_l.id::text,
    jsonb_build_object('cuenta', p_cuenta, 'unidades', v_l.unidades, 'referencia', v_l.referencia_proveedor));
  return v_l;
end $$;

-- ============================================================ RLS y privilegios
alter table public.evento_tipos           enable row level security;
alter table public.bolson_cuentas         enable row level security;
alter table public.bolson_lotes           enable row level security;
alter table public.bolson_reglas_consumo  enable row level security;
alter table public.bolson_extractos       enable row level security;
alter table public.bolson_extracto_lineas enable row level security;
alter table public.bolson_saldos          enable row level security;

revoke all on public.evento_tipos, public.bolson_cuentas, public.bolson_lotes, public.bolson_reglas_consumo,
              public.bolson_extractos, public.bolson_extracto_lineas, public.bolson_saldos from public, anon, authenticated, service_role;
grant select on public.evento_tipos, public.bolson_cuentas, public.bolson_lotes, public.bolson_reglas_consumo,
                public.bolson_extractos, public.bolson_extracto_lineas, public.bolson_saldos to authenticated;   -- RLS decide qué filas

create policy evento_tipos_leer on public.evento_tipos for select to authenticated using (true);                   -- catálogo no sensible
create policy bolson_cuentas_leer  on public.bolson_cuentas         for select to authenticated using (public.fel_es_admin_plataforma());
create policy bolson_lotes_leer    on public.bolson_lotes           for select to authenticated using (public.fel_es_admin_plataforma());
create policy bolson_reglas_leer   on public.bolson_reglas_consumo  for select to authenticated using (public.fel_es_admin_plataforma());
create policy bolson_extractos_leer on public.bolson_extractos      for select to authenticated using (public.fel_es_admin_plataforma());
create policy bolson_lineas_leer   on public.bolson_extracto_lineas for select to authenticated using (public.fel_es_admin_plataforma());
create policy bolson_saldos_leer   on public.bolson_saldos          for select to authenticated using (public.fel_es_admin_plataforma());

do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like 'fel\_admin\_bolson\_%' or p.proname = 'fel__bolson_sembrar_reglas') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
  revoke all on function public.fel_bolson_cuenta_guard() from public, anon, authenticated, service_role;
  revoke all on function public.fel_bolson_regla_guard()  from public, anon, authenticated, service_role;
  revoke all on function public.fel_bolson_saldo_guard()  from public, anon, authenticated, service_role;
end $$;

comment on table public.bolson_cuentas is 'D2-1: cuenta del proveedor (mundo A). Solo plataforma. Sin credenciales.';
comment on table public.bolson_saldos  is 'D2-1: proyección de saldos; la restricción impide el sobreconsumo. El libro de movimientos llega en D2-2.';
