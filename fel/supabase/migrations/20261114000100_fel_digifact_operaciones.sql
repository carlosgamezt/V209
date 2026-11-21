-- NEXA FEL · migración 29: almacén persistente de las certificaciones de Digifact (TEST) y aplicación de la certificación al documento.
-- ADITIVA: crea 2 tablas, 3 funciones y sus índices/disparadores; no modifica ninguna tabla, función, política ni dato de las migraciones 1–28.
-- Una operación = un intento de certificar UN documento, con su referencia determinista. Garantías EN LA PROPIA BASE (no solo en el código): una sola operación que bloquea por documento
-- (enviando/certificada/desconocida), la misma referencia no se prepara dos veces, una autorización de Digifact no se repite dentro de la empresa, la identidad de la operación no cambia,
-- solo existen las transiciones de estado válidas, nada se borra y los XML/PDF son de solo inserción con su SHA-256 verificado por la base.
-- Aislamiento por empresa EN LA BASE: toda clave foránea es compuesta e incluye empresa_id (operación→documento y artefacto→operación), así que una fila no puede apuntar a datos de otra empresa aunque el código se equivocara.
-- Privilegios: ninguna tabla ni función es accesible para anon, authenticated ni service_role (solo el rol propietario, que es el que usa el servidor de NEXA FEL por conexión directa). RLS activado y sin políticas.
-- No guarda credenciales ni tokens. La reversión segura y la verificación posterior viven fuera de las migraciones: docs/migracion-29/.

-- Precondiciones: se aplica SOLO sobre un esquema con las 28 migraciones y sin rastro de la 29 (si algo no cuadra, no se crea nada y el mensaje dice qué).
do $$ begin
  if to_regclass('public.digifact_operaciones') is not null or to_regclass('public.digifact_artefactos') is not null
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('fel_digifact_op_guarda', 'fel_digifact_art_guarda', 'fel_sys_digifact_aplicar')) then
    raise exception 'PRECONDICIÓN 29: ya existen objetos de la migración 29; no se vuelve a aplicar' using errcode = 'P0001'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'empresas_no_borrar' and tgrelid = 'public.empresas'::regclass) then
    raise exception 'PRECONDICIÓN 29: falta la migración 28 (las empresas aún se podrían borrar)' using errcode = 'P0001'; end if;
  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'fel__fiscal_cambiar') then
    raise exception 'PRECONDICIÓN 29: falta fel__fiscal_cambiar (migraciones anteriores)' using errcode = 'P0001'; end if;
  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'fel_auditar') then
    raise exception 'PRECONDICIÓN 29: falta fel_auditar (migraciones anteriores)' using errcode = 'P0001'; end if;
end $$;

create table public.digifact_operaciones (
  id                    uuid primary key,
  empresa_id            uuid not null references public.empresas (id),
  documento_id          uuid not null,
  referencia            uuid not null,
  hash                  text not null check (length(hash) between 8 and 128),
  huella_emisor         text not null check (huella_emisor ~ '^[0-9a-f]{16}$'),
  fecha_emision         text not null check (fecha_emision ~ '^\d{4}-\d{2}-\d{2}'),
  establecimiento       integer not null check (establecimiento >= 1),
  total                 text not null check (total ~ '^\d+(\.\d{1,6})?$'),
  estado                text not null check (estado in ('preparada','enviando','certificada','rechazada','desconocida','no_enviada')),
  creada_ms             bigint not null check (creada_ms > 0),
  actualizada_ms        bigint not null check (actualizada_ms >= creada_ms),
  actor_id              uuid not null,
  intento_del_documento integer not null check (intento_del_documento >= 0),
  intentos_conciliacion integer not null default 0 check (intentos_conciliacion >= 0),
  resultado             jsonb check (resultado is null or jsonb_typeof(resultado) = 'object'),
  unique (id, empresa_id),                                                                 -- destino de la clave foránea compuesta de los artefactos
  foreign key (documento_id, empresa_id) references public.documentos (id, empresa_id)     -- una operación jamás apunta al documento de otra empresa
);
create unique index digifact_op_una_que_bloquea_uq on public.digifact_operaciones (empresa_id, documento_id) where estado in ('enviando','certificada','desconocida');
create unique index digifact_op_preparada_uq        on public.digifact_operaciones (empresa_id, documento_id, referencia) where estado = 'preparada';
create unique index digifact_op_autorizacion_uq     on public.digifact_operaciones (empresa_id, (resultado ->> 'autorizacion')) where resultado ->> 'autorizacion' is not null;
create index digifact_op_documento_idx on public.digifact_operaciones (empresa_id, documento_id, creada_ms);

create function public.fel_digifact_op_guarda() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'FEL_DIGIFACT: las operaciones de certificación no se borran' using errcode = 'P0001'; end if;
  if tg_op = 'INSERT' then   -- toda operación nace «preparada», sin resultado: el estado solo avanza por las transiciones válidas
    if new.estado <> 'preparada' or new.resultado is not null or new.intentos_conciliacion <> 0 then raise exception 'FEL_DIGIFACT: una operación nueva solo puede crearse «preparada» y sin resultado' using errcode = 'P0001'; end if;
    return new;
  end if;
  if new.id is distinct from old.id or new.empresa_id is distinct from old.empresa_id or new.documento_id is distinct from old.documento_id or new.referencia is distinct from old.referencia
     or new.hash is distinct from old.hash or new.huella_emisor is distinct from old.huella_emisor or new.fecha_emision is distinct from old.fecha_emision
     or new.establecimiento is distinct from old.establecimiento or new.total is distinct from old.total or new.actor_id is distinct from old.actor_id
     or new.creada_ms is distinct from old.creada_ms or new.intento_del_documento is distinct from old.intento_del_documento then
    raise exception 'FEL_DIGIFACT: los datos de identidad de la operación no se modifican' using errcode = 'P0001';
  end if;
  if new.estado is distinct from old.estado then
    if not ((old.estado = 'preparada' and new.estado = 'enviando')
         or (old.estado = 'enviando' and new.estado in ('no_enviada','desconocida','certificada','rechazada'))
         or (old.estado = 'desconocida' and new.estado = 'certificada')) then
      raise exception 'FEL_DIGIFACT: transición de estado no permitida (% → %)', old.estado, new.estado using errcode = 'P0001';
    end if;
  elsif old.estado <> 'desconocida' then
    raise exception 'FEL_DIGIFACT: la operación en estado % ya no cambia', old.estado using errcode = 'P0001';
  end if;
  if old.estado = 'certificada' and new.resultado is distinct from old.resultado then raise exception 'FEL_DIGIFACT: el resultado certificado no se modifica' using errcode = 'P0001'; end if;
  if new.actualizada_ms < old.actualizada_ms then raise exception 'FEL_DIGIFACT: la fecha de actualización no retrocede' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger digifact_op_guarda before insert or update or delete on public.digifact_operaciones for each row execute function public.fel_digifact_op_guarda();
revoke all on function public.fel_digifact_op_guarda() from public, anon, authenticated, service_role;

alter table public.digifact_operaciones enable row level security;
revoke all on public.digifact_operaciones from public, anon, authenticated, service_role;

-- ============================================================ artefactos REALES (XML/PDF) del certificador y aplicación de la certificación al documento
-- Tabla aparte de public.artefactos_documento a propósito: aquella solo admite «db_simulado»; los de Digifact son reales de PRUEBAS y no se mezclan con los simulados.
-- Solo inserción (ni UPDATE ni DELETE), sin privilegios para nadie salvo el rol propietario: la descarga pasa siempre por el servidor, que comprueba sesión, permiso y empresa.
create table public.digifact_artefactos (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null,
  documento_id uuid not null,
  operacion_id uuid not null,
  tipo         text not null check (tipo in ('xml','pdf')),
  nombre       text not null check (length(nombre) between 1 and 120),
  mime         text not null check (mime in ('application/xml','application/pdf')),
  sha256       text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  tamano       integer not null check (tamano between 1 and 5242880),
  contenido    bytea not null,
  origen       text not null default 'digifact_test' check (origen = 'digifact_test'),
  creado_en    timestamptz not null default now(),
  foreign key (operacion_id, empresa_id) references public.digifact_operaciones (id, empresa_id),   -- un artefacto jamás apunta a la operación de otra empresa
  foreign key (documento_id, empresa_id) references public.documentos (id, empresa_id),
  unique (operacion_id, tipo),
  check (sha256 = encode(sha256(contenido), 'hex') and tamano = octet_length(contenido)),
  check ((tipo = 'xml' and mime = 'application/xml') or (tipo = 'pdf' and mime = 'application/pdf'))
);
create function public.fel_digifact_art_guarda() returns trigger language plpgsql set search_path = '' as $$
declare o public.digifact_operaciones;
begin
  if tg_op <> 'INSERT' then raise exception 'FEL_APPEND_ONLY: los artefactos de Digifact son de solo inserción' using errcode = 'P0001'; end if;
  select * into o from public.digifact_operaciones where id = new.operacion_id;
  if not found or o.empresa_id <> new.empresa_id or o.documento_id <> new.documento_id then raise exception 'FEL_DIGIFACT: el artefacto no corresponde a la operación' using errcode = 'P0001'; end if;
  if o.estado <> 'certificada' then raise exception 'FEL_DIGIFACT: solo una operación certificada tiene artefactos' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger digifact_art_guarda before insert or update or delete on public.digifact_artefactos for each row execute function public.fel_digifact_art_guarda();
revoke all on function public.fel_digifact_art_guarda() from public, anon, authenticated, service_role;
alter table public.digifact_artefactos enable row level security;
revoke all on public.digifact_artefactos from public, anon, authenticated, service_role;

-- Aplica la certificación REAL de PRUEBAS al documento, de forma atómica e idempotente: estado fiscal «certificado» con serie, número y autorización tomados del resultado válido del certificador.
-- Nunca inventa datos: sin una operación «certificada» con los tres datos no hace nada. Misma ruta de estados que las demás certificaciones (fel__fiscal_cambiar): sin atajos.
create function public.fel_sys_digifact_aplicar(p_empresa uuid, p_op uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare o public.digifact_operaciones; d public.documentos; v_aut text; v_serie text; v_num text;
begin
  select * into o from public.digifact_operaciones where id = p_op and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: operación no encontrada'; end if;
  if o.estado <> 'certificada' then raise exception 'FEL_REGLA: la operación no está certificada'; end if;
  v_aut := btrim(coalesce(o.resultado ->> 'autorizacion', '')); v_serie := btrim(coalesce(o.resultado ->> 'serie', '')); v_num := btrim(coalesce(o.resultado ->> 'numero', ''));
  if v_aut = '' or v_serie = '' or v_num = '' then raise exception 'FEL_REGLA: el resultado del certificador no trae serie, número y autorización'; end if;
  if upper(v_aut) like 'SIM-%' then raise exception 'FEL_REGLA: una autorización simulada no puede aplicarse como certificación real'; end if;
  select * into d from public.documentos where id = o.documento_id and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: documento no encontrado'; end if;
  if d.estado_fiscal = 'certificado' then
    if d.autorizacion_sat = v_aut and d.serie = v_serie and d.numero_fiscal = v_num then return 'ya_aplicada'; end if;
    raise exception 'FEL_CONFLICTO: el documento ya está certificado con otros datos fiscales';
  end if;
  if d.estado_preparacion <> 'revisado' or d.estado_fiscal not in ('ninguno','rechazado','por_verificar','pendiente_certificacion') then raise exception 'FEL_REGLA: el documento no está en un estado que admita la certificación (%/%)', d.estado_preparacion, d.estado_fiscal; end if;
  if exists (select 1 from public.documentos x where x.empresa_id = p_empresa and x.autorizacion_sat = v_aut and x.id <> d.id) then raise exception 'FEL_CONFLICTO: la autorización ya pertenece a otro documento'; end if;
  if d.estado_fiscal in ('ninguno','rechazado') then perform public.fel__fiscal_cambiar(d.id, p_empresa, 'pendiente_certificacion', o.actor_id, null, 'digifact_test'); end if;
  perform public.fel__fiscal_cambiar(d.id, p_empresa, 'certificado', o.actor_id, null, 'digifact_test', v_serie, v_num, v_aut);
  perform public.fel_auditar(p_empresa, o.actor_id, 'digifact_test.aplicada_al_documento', 'documento', d.id::text, jsonb_build_object('operacion', o.id, 'referencia', o.referencia));
  return 'aplicada';
end $$;
-- Solo el rol propietario puede ejecutarla: el servidor de NEXA FEL la llama por la conexión directa y ningún rol de la API la necesita (mínimo privilegio; una llave de servicio filtrada no puede invocarla).
revoke all on function public.fel_sys_digifact_aplicar(uuid, uuid) from public, anon, authenticated, service_role;
