-- D2-2 · Consumos por empresa, libro de movimientos del bolsón y alertas. Segunda de las cinco migraciones aprobadas de D2.
-- Diseño aprobado: DISENO-D2-BOLSON-MULTIEMPRESA §3.3, §5 y §6.5–6.6. Sin conexión con ningún proveedor real; sin credenciales.
--   · Consumo del PROVEEDOR (este archivo) y cargos COMERCIALES (D2-3) son mundos separados: aquí no existe ninguna tabla, columna ni referencia de precios, tarifas, cargos, cobros ni monedero.
--   · El libro de movimientos es la ÚNICA vía para cambiar los saldos del bolsón (un disparador aplica cada movimiento; ningún otro código puede tocar bolson_saldos).
--   · Una reserva con resultado fiscal incierto NUNCA se libera: solo se libera con la operación confirmada como fallida (y, tras una conciliación manual, vencida la espera de respuestas tardías
--     y comprobado el proveedor); un resultado desconocido deja la reserva en vigilancia con alerta.
--   · Cambios sobre objetos de D2-1 (declarados): función fel_admin_bolson_lote_registrar (ahora registra la recarga en el libro), guarda de saldos (solo por movimientos) y restricción única (id, cuenta_id) de lotes.
--   · No modifica ninguna tabla ni función anterior a D2; el orquestador, EmissionProvider y las pantallas no se tocan.

-- ============================================================ lotes: clave compuesta para atar recargas a su cuenta
alter table public.bolson_lotes add constraint bolson_lotes_id_cuenta_uq unique (id, cuenta_id);

-- ============================================================ consumos: una fila por evento facturable (unidad de idempotencia)
create table public.consumos (
  id                  uuid primary key default gen_random_uuid(),
  cuenta_id           uuid not null references public.bolson_cuentas (id),
  empresa_id          uuid not null references public.empresas (id),
  evento_tipo         text not null references public.evento_tipos (codigo),
  operacion_id        uuid,
  documento_id        uuid,
  consumo_origen_id   uuid,
  clave_idempotencia  text not null check (length(clave_idempotencia) between 16 and 80),
  hash_contenido      text not null check (hash_contenido ~ '^[0-9a-f]{64}$'),
  estado              text not null default 'reservado' check (estado in ('reservado','confirmado','liberado')),
  en_vigilancia       boolean not null default false,
  unidades_reservadas numeric(20,6) not null check (unidades_reservadas >= 0),
  unidades_consumidas numeric(20,6) not null default 0 check (unidades_consumidas >= 0),
  regla_id            uuid not null references public.bolson_reglas_consumo (id),
  referencia_externa  text check (referencia_externa is null or length(btrim(referencia_externa)) between 1 and 200),
  reservado_en        timestamptz not null default clock_timestamp(),
  resuelto_en         timestamptz,
  resuelto_por        uuid references auth.users (id),
  evidencia           jsonb,
  extracto_linea_id   uuid references public.bolson_extracto_lineas (id),
  unique (id, empresa_id),
  unique (id, cuenta_id),
  unique (empresa_id, clave_idempotencia),
  foreign key (operacion_id, empresa_id) references public.operaciones_fiscales (id, empresa_id),
  foreign key (documento_id, empresa_id) references public.documentos (id, empresa_id),
  foreign key (consumo_origen_id, empresa_id) references public.consumos (id, empresa_id),
  check (estado <> 'reservado' or (unidades_consumidas = 0 and resuelto_en is null)),
  check (estado = 'reservado' or resuelto_en is not null),
  check (estado <> 'liberado' or unidades_consumidas = 0),
  check (estado = 'reservado' or not en_vigilancia),
  check (unidades_consumidas <= unidades_reservadas),
  check (consumo_origen_id is null or evento_tipo = 'devolucion')
);
create unique index consumos_unico_por_operacion on public.consumos (operacion_id, evento_tipo)
  where evento_tipo in ('certificacion','anulacion') and operacion_id is not null;                  -- a lo sumo un consumo de certificación/anulación por operación
create index consumos_empresa_idx on public.consumos (empresa_id, reservado_en desc);
create index consumos_reservados_idx on public.consumos (cuenta_id, reservado_en) where estado = 'reservado';

-- ============================================================ libro de movimientos del bolsón (solo inserción)
create table public.bolson_movimientos (
  id                     bigint generated always as identity primary key,
  cuenta_id              uuid not null references public.bolson_cuentas (id),
  empresa_id             uuid references public.empresas (id),
  consumo_id             uuid,
  lote_id                uuid,
  tipo                   text not null check (tipo in ('recarga','reserva','consumo','liberacion','ajuste','caducidad','devolucion')),
  unidades               numeric(20,6) not null check (unidades > 0),
  sentido                smallint not null default 1 check (sentido in (-1, 1)),                    -- solo «ajuste» puede restar
  conciliacion_partida_id uuid,                                                                     -- la clave foránea llega con la conciliación (D2-4)
  motivo                 text check (motivo is null or length(btrim(motivo)) between 1 and 300),
  creado_por             uuid references auth.users (id),
  creado_en              timestamptz not null default clock_timestamp(),
  foreign key (consumo_id, cuenta_id)  references public.consumos (id, cuenta_id),
  foreign key (consumo_id, empresa_id) references public.consumos (id, empresa_id),
  foreign key (lote_id, cuenta_id)     references public.bolson_lotes (id, cuenta_id),
  check (tipo = 'ajuste' or sentido = 1),
  check (consumo_id is null or empresa_id is not null),
  check (tipo not in ('reserva','consumo','liberacion') or consumo_id is not null),
  check (tipo <> 'recarga' or (lote_id is not null and consumo_id is null and empresa_id is null)),
  check (tipo <> 'ajuste' or motivo is not null)
);
create index bolson_movimientos_cuenta_idx on public.bolson_movimientos (cuenta_id, id);
create index bolson_movimientos_consumo_idx on public.bolson_movimientos (consumo_id) where consumo_id is not null;

-- Las recargas de los lotes que ya existieran quedan en el libro (ANTES de crear el disparador: el saldo ya las cuenta).
insert into public.bolson_movimientos (cuenta_id, lote_id, tipo, unidades, motivo, creado_por, creado_en)
select l.cuenta_id, l.id, 'recarga', l.unidades, 'lote registrado antes de D2-2', l.registrado_por, l.registrado_en from public.bolson_lotes l order by l.registrado_en, l.id;

-- ============================================================ alertas
create table public.bolson_alertas (
  id           uuid primary key default gen_random_uuid(),
  cuenta_id    uuid not null references public.bolson_cuentas (id),
  empresa_id   uuid references public.empresas (id),
  consumo_id   uuid,
  tipo         text not null check (tipo in ('bolson_bajo','empresa_cerca_de_cupo','consumo_anomalo','reserva_envejecida','diferencia_conciliacion','consumo_sin_operacion_resuelta','consumo_incierto')),
  detalle      jsonb not null default '{}'::jsonb,
  creada_en    timestamptz not null default now(),
  resuelta_en  timestamptz,
  resuelta_por uuid references auth.users (id),                                                     -- nulo con resuelta_en = resolución automática al resolverse el consumo
  nota         text,
  foreign key (consumo_id, empresa_id) references public.consumos (id, empresa_id),
  check (consumo_id is null or empresa_id is not null),
  check (resuelta_por is null or resuelta_en is not null)
);
create unique index bolson_alertas_una_por_consumo on public.bolson_alertas (consumo_id, tipo) where resuelta_en is null and consumo_id is not null;
create unique index bolson_alertas_una_global on public.bolson_alertas (cuenta_id, coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid), tipo) where resuelta_en is null and consumo_id is null;

-- ============================================================ protecciones (triggers)
create trigger bolson_movimientos_solo_insertar before update or delete on public.bolson_movimientos for each row execute function public.fel_solo_insertar();

-- Cada movimiento se APLICA al saldo en la misma transacción. Es la única vía para cambiar bolson_saldos.
create or replace function public.fel__bolson_aplicar_movimiento() returns trigger language plpgsql set search_path = '' as $$
begin
  update public.bolson_saldos set
    comprado  = comprado  + case when new.tipo = 'recarga' then new.unidades else 0 end,
    reservado = reservado + case when new.tipo = 'reserva' then new.unidades when new.tipo in ('consumo','liberacion') then -new.unidades else 0 end,
    consumido = consumido + case when new.tipo = 'consumo' then new.unidades else 0 end,
    ajustado  = ajustado  + case new.tipo when 'ajuste' then new.sentido * new.unidades when 'caducidad' then -new.unidades when 'devolucion' then new.unidades else 0 end
   where cuenta_id = new.cuenta_id;
  if not found then raise exception 'FEL_NO_ENCONTRADO: la cuenta del bolsón no tiene saldo'; end if;
  return null;
end $$;
create trigger bolson_movimientos_aplicar after insert on public.bolson_movimientos for each row execute function public.fel__bolson_aplicar_movimiento();

-- La guarda de saldos de D2-1 se endurece: el saldo solo cambia desde el disparador del libro (profundidad ≥ 2), nunca por una actualización directa.
create or replace function public.fel_bolson_saldo_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'FEL_APPEND_ONLY: los saldos del bolsón no se borran'; end if;
  if pg_trigger_depth() < 2 then raise exception 'FEL_APPEND_ONLY: el saldo del bolsón solo cambia por movimientos del libro'; end if;
  if new.cuenta_id is distinct from old.cuenta_id then raise exception 'FEL_APPEND_ONLY: la cuenta de un saldo no cambia'; end if;
  if new.comprado < old.comprado then raise exception 'FEL_REGLA: lo comprado no disminuye (las correcciones son ajustes)'; end if;
  new.actualizado_en := now();
  return new;
end $$;

create or replace function public.fel_bolson_consumo_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'FEL_APPEND_ONLY: los consumos no se borran'; end if;
  if (new.id, new.cuenta_id, new.empresa_id, new.evento_tipo, new.operacion_id, new.documento_id, new.consumo_origen_id, new.clave_idempotencia, new.hash_contenido,
      new.unidades_reservadas, new.regla_id, new.reservado_en, new.extracto_linea_id)
     is distinct from
     (old.id, old.cuenta_id, old.empresa_id, old.evento_tipo, old.operacion_id, old.documento_id, old.consumo_origen_id, old.clave_idempotencia, old.hash_contenido,
      old.unidades_reservadas, old.regla_id, old.reservado_en, old.extracto_linea_id) then
    raise exception 'FEL_APPEND_ONLY: los datos de un consumo son inmutables';
  end if;
  if old.estado <> 'reservado' then
    if new is distinct from old then raise exception 'FEL_APPEND_ONLY: un consumo resuelto no se modifica (las correcciones son consumos o ajustes nuevos)'; end if;
    return new;
  end if;
  if new.estado = 'reservado' then
    if (new.unidades_consumidas, new.referencia_externa, new.resuelto_en, new.resuelto_por, new.evidencia)
       is distinct from (old.unidades_consumidas, old.referencia_externa, old.resuelto_en, old.resuelto_por, old.evidencia) then
      raise exception 'FEL_APPEND_ONLY: mientras está reservado solo puede cambiar la marca de vigilancia';
    end if;
    if old.en_vigilancia and not new.en_vigilancia then raise exception 'FEL_REGLA: la vigilancia solo termina al resolver el consumo'; end if;
  end if;
  return new;
end $$;
create trigger consumos_guard before update or delete on public.consumos for each row execute function public.fel_bolson_consumo_guard();

create or replace function public.fel_bolson_alerta_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'FEL_APPEND_ONLY: las alertas no se borran'; end if;
  if (new.id, new.cuenta_id, new.empresa_id, new.consumo_id, new.tipo, new.detalle, new.creada_en) is distinct from (old.id, old.cuenta_id, old.empresa_id, old.consumo_id, old.tipo, old.detalle, old.creada_en)
     or old.resuelta_en is not null then
    raise exception 'FEL_APPEND_ONLY: de una alerta solo puede cerrarse la resolución, una vez';
  end if;
  return new;
end $$;
create trigger bolson_alertas_guard before update or delete on public.bolson_alertas for each row execute function public.fel_bolson_alerta_guard();

-- ============================================================ utilidades internas
create or replace function public.fel__bolson_alertar(p_cuenta uuid, p_empresa uuid, p_consumo uuid, p_tipo text, p_detalle jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_consumo is not null then
    insert into public.bolson_alertas (cuenta_id, empresa_id, consumo_id, tipo, detalle) values (p_cuenta, p_empresa, p_consumo, p_tipo, coalesce(p_detalle, '{}'::jsonb))
    on conflict (consumo_id, tipo) where resuelta_en is null and consumo_id is not null do nothing returning id into v_id;
  else
    insert into public.bolson_alertas (cuenta_id, empresa_id, tipo, detalle) values (p_cuenta, p_empresa, p_tipo, coalesce(p_detalle, '{}'::jsonb))
    on conflict (cuenta_id, (coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid)), tipo) where resuelta_en is null and consumo_id is null do nothing returning id into v_id;
  end if;
  return v_id;      -- nulo si ya había una abierta
end $$;

-- Una repetición solo es válida si es IDÉNTICA; si no, nunca se acepta en silencio.
create or replace function public.fel__bolson_consumo_repetido(v public.consumos, p_cuenta uuid, p_evento text, p_operacion uuid, p_documento uuid, p_hash text) returns public.consumos
language plpgsql security definer set search_path = '' as $$
begin
  if v.hash_contenido <> p_hash or v.cuenta_id <> p_cuenta or v.evento_tipo <> p_evento
     or v.operacion_id is distinct from p_operacion or v.documento_id is distinct from p_documento then
    raise exception 'FEL_IDEMPOTENCIA: la clave ya se usó con otro contenido';
  end if;
  return v;
end $$;

-- ============================================================ RESERVAR
create or replace function public.fel_sys_consumo_reservar(
  p_empresa uuid, p_cuenta uuid, p_evento text, p_operacion uuid, p_documento uuid, p_clave text, p_hash text) returns public.consumos
language plpgsql security definer set search_path = '' as $$
declare v_c public.consumos; v_emp public.empresas; v_cta public.bolson_cuentas; v_regla public.bolson_reglas_consumo; v_op public.operaciones_fiscales; v_sal public.bolson_saldos; v_u numeric(20,6);
begin
  if p_clave is null or length(p_clave) not between 16 and 80 then raise exception 'FEL_REGLA: clave de idempotencia inválida (16 a 80 caracteres)'; end if;
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'FEL_REGLA: el hash del contenido debe ser SHA-256 en hexadecimal'; end if;
  -- 1. repetición (camino rápido, sin bloqueo global)
  select * into v_c from public.consumos where empresa_id = p_empresa and clave_idempotencia = p_clave;
  if found then return public.fel__bolson_consumo_repetido(v_c, p_cuenta, p_evento, p_operacion, p_documento, p_hash); end if;
  -- 2. contexto
  select * into v_emp from public.empresas where id = p_empresa;
  if not found then raise exception 'FEL_NO_ENCONTRADO: empresa no encontrada'; end if;
  if v_emp.estado <> 'habilitada' then raise exception 'FEL_REGLA: la empresa no está habilitada'; end if;
  if p_evento = 'devolucion' then raise exception 'FEL_REGLA: las devoluciones no se reservan; se registran por conciliación'; end if;
  if not exists (select 1 from public.evento_tipos where codigo = p_evento) then raise exception 'FEL_REGLA: tipo de evento desconocido'; end if;
  select * into v_cta from public.bolson_cuentas where id = p_cuenta;
  if not found then raise exception 'FEL_NO_ENCONTRADO: cuenta del bolsón no encontrada'; end if;
  if v_cta.estado <> 'activa' then raise exception 'FEL_REGLA: la cuenta del bolsón no está activa (%)', v_cta.estado; end if;
  if p_evento in ('certificacion','anulacion') and p_operacion is null then raise exception 'FEL_REGLA: el consumo de % exige su operación fiscal', p_evento; end if;
  if p_documento is not null and not exists (select 1 from public.documentos where id = p_documento and empresa_id = p_empresa) then raise exception 'FEL_NO_ENCONTRADO: documento no encontrado en la empresa'; end if;
  if p_operacion is not null then
    select * into v_op from public.operaciones_fiscales where id = p_operacion and empresa_id = p_empresa;
    if not found then raise exception 'FEL_NO_ENCONTRADO: operación no encontrada en la empresa'; end if;
    if p_documento is not null and v_op.documento_id <> p_documento then raise exception 'FEL_REGLA: el documento no corresponde a la operación'; end if;
    if v_op.ambiente is null or v_op.ambiente = 'simulado' then raise exception 'FEL_REGLA: las operaciones simuladas no consumen el bolsón'; end if;
    if v_op.ambiente <> v_cta.ambiente or v_op.proveedor is distinct from v_cta.proveedor_id then
      raise exception 'FEL_REGLA: la operación (%/%) no corresponde a la cuenta del bolsón (%/%)', v_op.proveedor, v_op.ambiente, v_cta.proveedor_id, v_cta.ambiente;
    end if;
    if p_evento in ('certificacion','anulacion') then
      if v_op.tipo <> p_evento then raise exception 'FEL_REGLA: el evento % no corresponde a una operación de %', p_evento, v_op.tipo; end if;
      if v_op.estado not in ('iniciada','desconocida') then raise exception 'FEL_REGLA: la operación ya está confirmada; no admite un consumo nuevo'; end if;
    end if;
  end if;
  -- 3. bloqueo del saldo (orden fijo) y segunda comprobación de la repetición
  select * into v_sal from public.bolson_saldos where cuenta_id = p_cuenta for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: la cuenta del bolsón no tiene saldo'; end if;
  select * into v_c from public.consumos where empresa_id = p_empresa and clave_idempotencia = p_clave;
  if found then return public.fel__bolson_consumo_repetido(v_c, p_cuenta, p_evento, p_operacion, p_documento, p_hash); end if;
  select * into v_regla from public.bolson_reglas_consumo where cuenta_id = p_cuenta and evento_tipo = p_evento and vigente_hasta is null;
  if not found then raise exception 'FEL_REGLA: la cuenta no tiene una regla de consumo vigente para %', p_evento; end if;
  v_u := case when v_regla.consume = 'no' then 0 else v_regla.unidades end;            -- «desconocido» se trata como que consume
  if v_regla.consume = 'no' and not v_regla.medible then return null; end if;          -- nada que medir
  if v_u > v_sal.comprado + v_sal.ajustado - v_sal.consumido - v_sal.reservado then
    raise exception 'FEL_BOLSON_AGOTADO: no hay unidades disponibles en el bolsón para reservar %', v_u;
  end if;
  begin
    insert into public.consumos (cuenta_id, empresa_id, evento_tipo, operacion_id, documento_id, clave_idempotencia, hash_contenido, unidades_reservadas, regla_id)
    values (p_cuenta, p_empresa, p_evento, p_operacion, p_documento, p_clave, p_hash, v_u, v_regla.id) returning * into v_c;
  exception when unique_violation then
    raise exception 'FEL_OPERACION_CON_CONSUMO: la operación ya tiene un consumo de %', p_evento;
  end;
  if v_u > 0 then
    insert into public.bolson_movimientos (cuenta_id, empresa_id, consumo_id, tipo, unidades, motivo) values (p_cuenta, p_empresa, v_c.id, 'reserva', v_u, 'reserva antes de enviar');
  end if;
  perform public.fel_auditar(p_empresa, null, 'bolson.consumo_reservado', 'consumo', v_c.id::text,
    jsonb_build_object('evento', p_evento, 'unidades', v_u, 'regla', v_regla.id, 'consume', v_regla.consume, 'operacion', p_operacion), 'sistema');
  return v_c;
end $$;

-- ============================================================ CONFIRMAR (hecho reportado por el proveedor; solo con el resultado fiscal confirmado)
create or replace function public.fel_sys_consumo_confirmar(
  p_empresa uuid, p_consumo uuid, p_unidades numeric default null, p_referencia text default null, p_evidencia jsonb default null) returns public.consumos
language plpgsql security definer set search_path = '' as $$
declare v_c public.consumos; v_op public.operaciones_fiscales; v_u numeric(20,6);
begin
  select * into v_c from public.consumos where id = p_consumo and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: consumo no encontrado'; end if;
  if v_c.estado = 'confirmado' then       -- repetición: solo si es idéntica
    if (p_unidades is null or p_unidades = v_c.unidades_consumidas) and (p_referencia is null or p_referencia = v_c.referencia_externa) then return v_c; end if;
    raise exception 'FEL_IDEMPOTENCIA: el consumo ya está confirmado con otros datos';
  end if;
  if v_c.estado = 'liberado' then raise exception 'FEL_ESTADO: el consumo ya fue liberado; no puede confirmarse'; end if;
  v_u := coalesce(p_unidades, v_c.unidades_reservadas);
  if v_u < 0 or v_u > v_c.unidades_reservadas then
    raise exception 'FEL_REGLA: no puede confirmarse más de lo reservado (% de %); el exceso se registra como ajuste', v_u, v_c.unidades_reservadas;
  end if;
  if p_referencia is not null and length(btrim(p_referencia)) not between 1 and 200 then raise exception 'FEL_REGLA: referencia externa inválida'; end if;
  if v_c.operacion_id is not null and v_c.evento_tipo in ('certificacion','anulacion') then
    select * into v_op from public.operaciones_fiscales where id = v_c.operacion_id and empresa_id = p_empresa;
    if v_op.estado not in ('confirmada_exitosa','confirmada_fallida') then
      raise exception 'FEL_INCIERTO: el resultado fiscal de la operación aún no está confirmado (%); el consumo permanece reservado', v_op.estado;
    end if;
  end if;
  if v_u > 0 then
    insert into public.bolson_movimientos (cuenta_id, empresa_id, consumo_id, tipo, unidades, motivo) values (v_c.cuenta_id, p_empresa, v_c.id, 'consumo', v_u, 'consumo confirmado');
  end if;
  if v_c.unidades_reservadas - v_u > 0 then
    insert into public.bolson_movimientos (cuenta_id, empresa_id, consumo_id, tipo, unidades, motivo) values (v_c.cuenta_id, p_empresa, v_c.id, 'liberacion', v_c.unidades_reservadas - v_u, 'excedente de la reserva al confirmar');
  end if;
  update public.consumos set estado = 'confirmado', en_vigilancia = false, unidades_consumidas = v_u, referencia_externa = coalesce(p_referencia, referencia_externa),
         resuelto_en = clock_timestamp(), evidencia = p_evidencia
   where id = v_c.id returning * into v_c;
  update public.bolson_alertas set resuelta_en = clock_timestamp(), nota = 'resuelta al confirmarse el consumo' where consumo_id = v_c.id and resuelta_en is null;
  perform public.fel_auditar(p_empresa, null, 'bolson.consumo_confirmado', 'consumo', v_c.id::text, jsonb_build_object('unidades', v_u, 'reservadas', v_c.unidades_reservadas), 'sistema');
  return v_c;
end $$;

-- ============================================================ LIBERAR (solo con el resultado confirmado como fallido; nunca por incertidumbre ni por tiempo)
create or replace function public.fel_sys_consumo_liberar(p_empresa uuid, p_consumo uuid, p_origen text, p_evidencia jsonb) returns public.consumos
language plpgsql security definer set search_path = '' as $$
declare v_c public.consumos; v_op public.operaciones_fiscales;
begin
  if p_origen is null or p_origen not in ('proveedor_confirma_sin_consumo','no_enviado') then
    raise exception 'FEL_REGLA: origen de liberación no válido (proveedor_confirma_sin_consumo | no_enviado); la liberación por conciliación llega con D2-4';
  end if;
  if p_evidencia is null or jsonb_typeof(p_evidencia) <> 'object' or p_evidencia = '{}'::jsonb then raise exception 'FEL_REGLA: liberar exige evidencia'; end if;
  select * into v_c from public.consumos where id = p_consumo and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: consumo no encontrado'; end if;
  if v_c.estado = 'liberado' then
    if v_c.evidencia ->> 'origen' = p_origen then return v_c; end if;
    raise exception 'FEL_IDEMPOTENCIA: el consumo ya está liberado con otro origen';
  end if;
  if v_c.estado = 'confirmado' then raise exception 'FEL_ESTADO: el consumo ya fue confirmado; no puede liberarse'; end if;
  if v_c.operacion_id is not null and v_c.evento_tipo in ('certificacion','anulacion') then
    select * into v_op from public.operaciones_fiscales where id = v_c.operacion_id and empresa_id = p_empresa;
    if v_op.estado <> 'confirmada_fallida' then
      raise exception 'FEL_INCIERTO: no se libera una reserva mientras el resultado fiscal no esté confirmado como fallido (operación %)', v_op.estado;
    end if;
    if v_op.resolucion = 'conciliacion_manual' and (
         clock_timestamp() < coalesce(v_op.reintento_desde, v_op.resuelta_en)
         or not exists (select 1 from public.eventos_proveedor e where e.operacion_id = v_op.id and e.tipo = 'conciliacion' and e.creado_en >= v_op.resuelta_en and e.resultado <> 'certificado')) then
      raise exception 'FEL_INCIERTO: tras una conciliación manual «fallida» la reserva se mantiene hasta vencer la espera de respuestas tardías y comprobar al proveedor';
    end if;
  else
    if v_c.en_vigilancia then raise exception 'FEL_INCIERTO: un consumo en vigilancia solo se resuelve por conciliación aprobada'; end if;
  end if;
  if v_c.unidades_reservadas > 0 then
    insert into public.bolson_movimientos (cuenta_id, empresa_id, consumo_id, tipo, unidades, motivo) values (v_c.cuenta_id, p_empresa, v_c.id, 'liberacion', v_c.unidades_reservadas, 'liberación: ' || p_origen);
  end if;
  update public.consumos set estado = 'liberado', en_vigilancia = false, resuelto_en = clock_timestamp(), evidencia = p_evidencia || jsonb_build_object('origen', p_origen)
   where id = v_c.id returning * into v_c;
  update public.bolson_alertas set resuelta_en = clock_timestamp(), nota = 'resuelta al liberarse el consumo' where consumo_id = v_c.id and resuelta_en is null;
  perform public.fel_auditar(p_empresa, null, 'bolson.consumo_liberado', 'consumo', v_c.id::text, jsonb_build_object('origen', p_origen, 'unidades', v_c.unidades_reservadas), 'sistema');
  return v_c;
end $$;

-- ============================================================ VIGILAR (resultado desconocido: la reserva se conserva y se alerta)
create or replace function public.fel_sys_consumo_vigilar(p_empresa uuid, p_consumo uuid, p_motivo text) returns public.consumos
language plpgsql security definer set search_path = '' as $$
declare v_c public.consumos;
begin
  select * into v_c from public.consumos where id = p_consumo and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: consumo no encontrado'; end if;
  if v_c.estado <> 'reservado' then raise exception 'FEL_ESTADO: solo un consumo reservado puede ponerse en vigilancia (%)', v_c.estado; end if;
  if v_c.en_vigilancia then return v_c; end if;
  update public.consumos set en_vigilancia = true where id = v_c.id returning * into v_c;
  perform public.fel__bolson_alertar(v_c.cuenta_id, p_empresa, v_c.id, 'consumo_incierto', jsonb_build_object('motivo', left(coalesce(p_motivo, ''), 80), 'unidades', v_c.unidades_reservadas));
  perform public.fel_auditar(p_empresa, null, 'bolson.consumo_en_vigilancia', 'consumo', v_c.id::text, jsonb_build_object('motivo', left(coalesce(p_motivo, ''), 80)), 'sistema');
  return v_c;
end $$;

-- ============================================================ verificación y coherencia (solo lectura)
create or replace function public.fel_sys_verificar_saldos() returns table (cuenta_id uuid, campo text, saldo numeric, libro numeric, ok boolean)
language sql stable security definer set search_path = '' as $$
  with m as (
    select s.cuenta_id,
           coalesce(sum(case when mv.tipo = 'recarga' then mv.unidades end), 0) as comprado,
           coalesce(sum(case when mv.tipo = 'consumo' then mv.unidades end), 0) as consumido,
           coalesce(sum(case when mv.tipo = 'reserva' then mv.unidades when mv.tipo in ('consumo','liberacion') then -mv.unidades end), 0) as reservado,
           coalesce(sum(case mv.tipo when 'ajuste' then mv.sentido * mv.unidades when 'caducidad' then -mv.unidades when 'devolucion' then mv.unidades end), 0) as ajustado
      from public.bolson_saldos s left join public.bolson_movimientos mv on mv.cuenta_id = s.cuenta_id group by s.cuenta_id),
  c as (
    select co.cuenta_id,
           coalesce(sum(case when co.estado = 'reservado' then co.unidades_reservadas end), 0) as reservado,
           coalesce(sum(case when co.estado = 'confirmado' then co.unidades_consumidas end), 0) as consumido
      from public.consumos co group by co.cuenta_id)
  select s.cuenta_id, v.campo, v.saldo, v.libro, v.saldo = v.libro
    from public.bolson_saldos s
    join m on m.cuenta_id = s.cuenta_id
    left join c on c.cuenta_id = s.cuenta_id
    cross join lateral (values
      ('comprado', s.comprado, m.comprado), ('consumido', s.consumido, m.consumido), ('reservado', s.reservado, m.reservado), ('ajustado', s.ajustado, m.ajustado),
      ('reservado_vs_consumos', s.reservado, coalesce(c.reservado, 0)), ('consumido_vs_consumos', s.consumido, coalesce(c.consumido, 0))) v(campo, saldo, libro)
   order by s.cuenta_id, v.campo
$$;

create or replace function public.fel_sys_consumos_incoherentes() returns table (consumo_id uuid, empresa_id uuid, operacion_id uuid, motivo text)
language sql stable security definer set search_path = '' as $$
  select c.id, c.empresa_id, c.operacion_id, 'operacion_resuelta_con_reserva_pendiente'
    from public.consumos c join public.operaciones_fiscales o on o.id = c.operacion_id and o.empresa_id = c.empresa_id
   where c.estado = 'reservado' and c.evento_tipo in ('certificacion','anulacion') and o.estado in ('confirmada_exitosa','confirmada_fallida')
  union all
  select c.id, c.empresa_id, c.operacion_id, 'liberado_pero_certificado'
    from public.consumos c join public.operaciones_fiscales o on o.id = c.operacion_id and o.empresa_id = c.empresa_id
   where c.estado = 'liberado' and c.evento_tipo = 'certificacion' and o.estado = 'confirmada_exitosa'
  order by 1
$$;

-- Revisión periódica: alertas por reservas envejecidas e incoherencias. NO libera nada. El umbral es obligatorio (sin valor predeterminado).
create or replace function public.fel_sys_bolson_revisar(p_umbral_min integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer := 0; r record; v uuid;
begin
  if p_umbral_min is null or p_umbral_min <= 0 then raise exception 'FEL_REGLA: el umbral de envejecimiento es obligatorio y mayor que cero'; end if;
  for r in select c.id, c.cuenta_id, c.empresa_id, c.unidades_reservadas, c.reservado_en from public.consumos c
            where c.estado = 'reservado' and c.reservado_en < clock_timestamp() - make_interval(mins => p_umbral_min) order by c.reservado_en loop
    v := public.fel__bolson_alertar(r.cuenta_id, r.empresa_id, r.id, 'reserva_envejecida', jsonb_build_object('desde', r.reservado_en, 'unidades', r.unidades_reservadas));
    if v is not null then n := n + 1; end if;
  end loop;
  for r in select i.consumo_id, c.cuenta_id, i.empresa_id, i.motivo from public.fel_sys_consumos_incoherentes() i join public.consumos c on c.id = i.consumo_id order by i.consumo_id loop
    v := public.fel__bolson_alertar(r.cuenta_id, r.empresa_id, r.consumo_id, 'consumo_sin_operacion_resuelta', jsonb_build_object('motivo', r.motivo));
    if v is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;

create or replace function public.fel_admin_bolson_alerta_resolver(p_actor uuid, p_alerta uuid, p_nota text) returns public.bolson_alertas
language plpgsql security definer set search_path = '' as $$
declare a public.bolson_alertas;
begin
  perform public.fel__exigir_plataforma(p_actor);
  if p_nota is null or length(btrim(p_nota)) < 5 then raise exception 'FEL_REGLA: la nota es obligatoria (mínimo 5 caracteres)'; end if;
  select * into a from public.bolson_alertas where id = p_alerta for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: alerta no encontrada'; end if;
  if a.resuelta_en is not null then return a; end if;
  update public.bolson_alertas set resuelta_en = clock_timestamp(), resuelta_por = p_actor, nota = p_nota where id = p_alerta returning * into a;
  perform public.fel_auditar(a.empresa_id, p_actor, 'bolson.alerta_resuelta', 'bolson_alerta', p_alerta::text, jsonb_build_object('tipo', a.tipo), 'fel-api');
  return a;
end $$;

-- ============================================================ la recarga de un lote pasa por el libro (reemplaza la función de D2-1; misma firma y comportamiento observable)
create or replace function public.fel_admin_bolson_lote_registrar(
  p_actor uuid, p_cuenta uuid, p_unidades numeric, p_costo_total numeric, p_referencia text,
  p_vigente_desde timestamptz default null, p_vence_en timestamptz default null) returns public.bolson_lotes
language plpgsql security definer set search_path = '' as $$
declare v_c public.bolson_cuentas; v_l public.bolson_lotes;
begin
  perform public.fel__exigir_plataforma(p_actor);
  perform 1 from public.bolson_saldos where cuenta_id = p_cuenta for update;     -- serializa compras y reservas de la cuenta
  if not found then raise exception 'FEL_NO_ENCONTRADO: cuenta del bolsón no encontrada'; end if;
  select * into v_c from public.bolson_cuentas where id = p_cuenta;
  if v_c.estado = 'cerrada' then raise exception 'FEL_REGLA: la cuenta del bolsón está cerrada'; end if;
  select * into v_l from public.bolson_lotes where cuenta_id = p_cuenta and referencia_proveedor = btrim(p_referencia);
  if found then
    if v_l.unidades = p_unidades and v_l.costo_total = p_costo_total then return v_l; end if;
    raise exception 'FEL_IDEMPOTENCIA: la referencia del lote ya existe con datos distintos';
  end if;
  insert into public.bolson_lotes (cuenta_id, unidades, costo_total, referencia_proveedor, vigente_desde, vence_en, registrado_por)
  values (p_cuenta, p_unidades, p_costo_total, btrim(p_referencia), coalesce(p_vigente_desde, now()), p_vence_en, p_actor) returning * into v_l;
  insert into public.bolson_movimientos (cuenta_id, lote_id, tipo, unidades, motivo, creado_por) values (p_cuenta, v_l.id, 'recarga', v_l.unidades, 'lote ' || v_l.referencia_proveedor, p_actor);
  perform public.fel_auditar(null, p_actor, 'bolson.lote_registrado', 'bolson_lote', v_l.id::text,
    jsonb_build_object('cuenta', p_cuenta, 'unidades', v_l.unidades, 'referencia', v_l.referencia_proveedor));
  return v_l;
end $$;

-- ============================================================ coherencia al migrar: el libro reproduce exactamente los saldos existentes
do $$ declare n integer; begin
  select count(*) into n from public.fel_sys_verificar_saldos() where not ok;
  if n > 0 then raise exception 'D2-2: el libro de movimientos no reproduce los saldos existentes (% diferencias)', n; end if;
end $$;

-- ============================================================ RLS y privilegios
alter table public.consumos          enable row level security;
alter table public.bolson_movimientos enable row level security;
alter table public.bolson_alertas    enable row level security;
revoke all on public.consumos, public.bolson_movimientos, public.bolson_alertas from public, anon, authenticated, service_role;
-- La empresa ve SOLO sus consumos y SOLO columnas que no revelan el bolsón (sin cuenta, regla, evidencia del proveedor ni extractos).
grant select (id, empresa_id, evento_tipo, operacion_id, documento_id, estado, en_vigilancia, unidades_reservadas, unidades_consumidas, referencia_externa, reservado_en, resuelto_en) on public.consumos to authenticated;
grant select on public.bolson_movimientos, public.bolson_alertas to authenticated;                         -- RLS: solo plataforma
create policy consumos_leer on public.consumos for select to authenticated using (public.fel_tiene_permiso(empresa_id, 'consumo.ver') or public.fel_es_admin_plataforma());
create policy bolson_movimientos_leer on public.bolson_movimientos for select to authenticated using (public.fel_es_admin_plataforma());
create policy bolson_alertas_leer on public.bolson_alertas for select to authenticated using (public.fel_es_admin_plataforma());

do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like 'fel\_sys\_consumo%' or p.proname in ('fel_sys_verificar_saldos','fel_sys_bolson_revisar','fel_admin_bolson_alerta_resolver','fel__bolson_alertar','fel__bolson_consumo_repetido')) loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
  revoke all on function public.fel__bolson_aplicar_movimiento() from public, anon, authenticated, service_role;
  revoke all on function public.fel_bolson_consumo_guard() from public, anon, authenticated, service_role;
  revoke all on function public.fel_bolson_alerta_guard()  from public, anon, authenticated, service_role;
  revoke all on function public.fel_bolson_saldo_guard()   from public, anon, authenticated, service_role;
  -- las funciones de D2-1 reemplazadas conservan sus permisos (solo service_role)
  revoke all on function public.fel_admin_bolson_lote_registrar(uuid,uuid,numeric,numeric,text,timestamptz,timestamptz) from public, anon, authenticated;
  grant execute on function public.fel_admin_bolson_lote_registrar(uuid,uuid,numeric,numeric,text,timestamptz,timestamptz) to service_role;
end $$;

comment on table public.consumos is 'D2-2: consumo medido por NEXA por evento facturable. Mundo B; no contiene precios ni cargos (eso es D2-3).';
comment on table public.bolson_movimientos is 'D2-2: libro de movimientos del bolsón; único camino para cambiar bolson_saldos.';
