-- NEXA FEL · Fase 2 · flujo individual de facturación SIMULADO sobre proveedores de emisión intercambiables.
-- Diseño: docs/saas-proveedores-diseno.md · Decisiones: docs/saas-decisiones-arquitectura.md · Plan: docs/saas-plan-implementacion.md
-- SOLO SIMULACIÓN: los canales de pruebas y de producción NO pueden habilitarse (restricción de la tabla). Nada de aquí emite documentos reales.
-- Principios: (1) la operación se persiste ANTES de enviar y el envío se marca ANTES de salir; (2) lo desconocido bloquea (por_verificar);
-- (3) ninguna operación se libera por «marcar fallida»: solo por un evento verificable del proveedor o por conciliación manual propuesta,
-- esperada, evidenciada y aprobada por OTRA persona; (4) todo aislado por empresa con RLS; (5) la app solo lee; escribe fel-api / el sistema.

-- ============================================================ permisos nuevos
insert into public.permisos_catalogo (codigo, descripcion) values
  ('establecimientos.ver',      'Ver los establecimientos de la empresa'),
  ('establecimientos.gestionar','Crear y editar establecimientos'),
  ('canales.ver',               'Ver los canales de emisión de la empresa'),
  ('canales.configurar',        'Configurar los canales de emisión (solo simulados en esta versión)'),
  ('conciliacion.aprobar',      'Aprobar o rechazar una conciliación manual propuesta por otra persona'),
  ('artefactos.descargar',      'Descargar el XML y el PDF de los documentos');
insert into public.rol_permisos (rol, permiso)
select r.rol, p.codigo from (values ('propietario'), ('administrador')) r(rol), public.permisos_catalogo p
 where p.codigo in ('establecimientos.ver','establecimientos.gestionar','canales.ver','canales.configurar','conciliacion.aprobar','artefactos.descargar');
insert into public.rol_permisos (rol, permiso) values
  ('emisor', 'establecimientos.ver'), ('emisor', 'canales.ver'), ('emisor', 'artefactos.descargar'),
  ('lector', 'establecimientos.ver'), ('lector', 'canales.ver'), ('lector', 'artefactos.descargar');

-- ============================================================ parámetros de plataforma (sin acceso directo para nadie; solo las funciones)
create table public.plataforma_parametros (
  clave          text primary key,
  valor          numeric not null check (valor >= 0),
  descripcion    text not null,
  actualizado_en timestamptz not null default now()
);
alter table public.plataforma_parametros enable row level security;
revoke all on public.plataforma_parametros from public, anon, authenticated, service_role;
insert into public.plataforma_parametros (clave, valor, descripcion) values
  ('espera_conciliacion_manual_min', 120,  'Minutos mínimos desde el envío antes de poder proponer una conciliación manual'),
  ('ventana_tardia_min',             1440, 'Minutos tras una conciliación manual «fallida» durante los cuales NO se permite reintentar (respuestas tardías)'),
  ('umbral_recuperacion_min',        10,   'Minutos sin resultado tras los cuales una operación iniciada se somete a recuperación'),
  ('ventana_auditoria_min',          10080,'Minutos tras una conciliación manual «fallida» durante los cuales se sigue auditando al proveedor por respuestas tardías (7 días)');
create or replace function public.fel__parametro(p_clave text) returns numeric
language sql stable security definer set search_path = '' as $$ select valor from public.plataforma_parametros where clave = p_clave $$;

-- ============================================================ establecimientos
create table public.establecimientos (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas (id),
  codigo_sat     text not null check (codigo_sat ~ '^[0-9A-Za-z-]{1,10}$'),
  nombre         text not null check (length(btrim(nombre)) between 1 and 120),
  direccion      text check (direccion is null or length(direccion) <= 300),
  estado         text not null default 'activo' check (estado in ('activo','inactivo')),
  creado_por     uuid references auth.users (id),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (id, empresa_id),
  unique (empresa_id, codigo_sat)
);
alter table public.documentos add column establecimiento_id uuid;
alter table public.documentos add constraint documentos_establecimiento_fk
  foreign key (establecimiento_id, empresa_id) references public.establecimientos (id, empresa_id);

-- ============================================================ proveedores y canales
create table public.proveedores_emision (
  id          text primary key check (id in ('mock','portal_playwright','digifact')),
  nombre      text not null,
  ambientes   text[] not null,
  habilitado  boolean not null default false,
  nota        text
);
insert into public.proveedores_emision (id, nombre, ambientes, habilitado, nota) values
  ('mock',              'Proveedor simulado',                   '{simulado}',                 true,  'Solo simulación: sin red, sin credenciales, sin valor fiscal'),
  ('portal_playwright', 'Portal de SAT con agente local',       '{simulado,pruebas,produccion}', false, 'Principal por prioridad; llenado asistido; ejecución real bloqueada hasta aclarar permisos y condiciones de SAT'),
  ('digifact',          'Certificador Digifact (secundario)',   '{simulado,pruebas,produccion}', false, 'Secundario; sin integración todavía');
create table public.empresa_canales (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references public.empresas (id),
  establecimiento_id uuid,
  proveedor_id     text not null references public.proveedores_emision (id),
  ambiente         text not null check (ambiente in ('simulado','pruebas','produccion')),
  habilitado       boolean not null default false,
  prioridad        integer not null default 1 check (prioridad >= 1),
  creado_por       uuid references auth.users (id),
  creado_en        timestamptz not null default now(),
  unique (id, empresa_id),
  foreign key (establecimiento_id, empresa_id) references public.establecimientos (id, empresa_id),
  -- Cerrojo de esta fase: SOLO los canales simulados pueden estar habilitados; el proveedor simulado solo existe en simulado.
  constraint canal_solo_simulado_chk check (ambiente = 'simulado' or habilitado = false),
  constraint canal_mock_simulado_chk check (proveedor_id <> 'mock' or ambiente = 'simulado')
);
create unique index empresa_canales_unico on public.empresa_canales (empresa_id, coalesce(establecimiento_id, '00000000-0000-0000-0000-000000000000'::uuid), proveedor_id, ambiente);

-- ============================================================ columnas nuevas de operaciones_fiscales
alter table public.operaciones_fiscales add constraint operaciones_id_empresa_uq unique (id, empresa_id);
alter table public.operaciones_fiscales add column canal_id uuid;
alter table public.operaciones_fiscales add column ambiente text check (ambiente in ('simulado','pruebas','produccion'));
alter table public.operaciones_fiscales add column enviada_en timestamptz;          -- instante en que se MARCÓ el envío (antes de salir)
alter table public.operaciones_fiscales add column orden_externa text;              -- canal asistido: id de la orden pendiente de acción humana
alter table public.operaciones_fiscales add column motivo_desconocido text;
alter table public.operaciones_fiscales add column reintento_desde timestamptz;     -- tras una conciliación manual «fallida»: no antes de este instante
alter table public.operaciones_fiscales add constraint operaciones_canal_fk foreign key (canal_id, empresa_id) references public.empresa_canales (id, empresa_id);
alter table public.operaciones_fiscales drop constraint operaciones_fiscales_resolucion_check;
alter table public.operaciones_fiscales add constraint operaciones_fiscales_resolucion_check
  check (resolucion in ('proveedor','conciliacion_manual','sistema_no_enviada'));

-- ============================================================ eventos del proveedor (solo inserción: es la EVIDENCIA verificable)
create table public.eventos_proveedor (
  id           bigint generated always as identity primary key,
  empresa_id   uuid not null,
  operacion_id uuid not null,
  tipo         text not null check (tipo in ('envio','conciliacion','recuperacion')),
  resultado    text not null check (resultado in ('certificado','rechazado_confirmado','desconocido','requiere_accion_humana','no_existe_confirmado','indeterminado')),
  motivo       text,
  serie        text,
  numero       text,
  autorizacion text,
  hash_respuesta text check (hash_respuesta is null or hash_respuesta ~ '^[0-9a-f]{64}$'),
  creado_en    timestamptz not null default clock_timestamp(),   -- reloj real (no el de la transacción): el orden entre eventos y resoluciones importa
  foreign key (operacion_id, empresa_id) references public.operaciones_fiscales (id, empresa_id),
  -- coherencia: solo «certificado» lleva datos fiscales, y los lleva completos
  check ((resultado = 'certificado') = (serie is not null and numero is not null and autorizacion is not null)),
  check (resultado <> 'no_existe_confirmado' or tipo = 'conciliacion'),
  check (resultado <> 'rechazado_confirmado' or tipo = 'envio')
);
create index eventos_proveedor_op on public.eventos_proveedor (operacion_id, id);

-- ============================================================ conciliaciones manuales (propuesta + aprobación de otra persona)
create table public.conciliaciones (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null,
  operacion_id  uuid not null,
  tipo          text not null check (tipo in ('manual_fallida','manual_certificada')),
  estado        text not null default 'propuesta' check (estado in ('propuesta','aprobada','rechazada')),
  evidencia     jsonb not null,
  datos         jsonb,
  propuesta_por uuid not null references auth.users (id),
  propuesta_en  timestamptz not null default now(),
  decidida_por  uuid references auth.users (id),
  decidida_en   timestamptz,
  nota          text,
  foreign key (operacion_id, empresa_id) references public.operaciones_fiscales (id, empresa_id),
  check (decidida_por is null or decidida_por <> propuesta_por),                       -- dos personas distintas
  check ((estado = 'propuesta') = (decidida_por is null and decidida_en is null))
);
create unique index conciliaciones_una_abierta on public.conciliaciones (operacion_id) where estado = 'propuesta';

-- ============================================================ alertas fiscales (certificaciones huérfanas / respuestas tardías)
create table public.alertas_fiscales (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null,
  documento_id uuid not null,
  operacion_id uuid not null,
  tipo         text not null check (tipo in ('certificacion_huerfana')),
  detalle      jsonb not null default '{}'::jsonb,
  creada_en    timestamptz not null default now(),
  resuelta_en  timestamptz,
  resuelta_por uuid references auth.users (id),
  nota         text,
  foreign key (operacion_id, empresa_id) references public.operaciones_fiscales (id, empresa_id),
  foreign key (documento_id, empresa_id) references public.documentos (id, empresa_id),
  check ((resuelta_en is null) = (resuelta_por is null))
);
create unique index alertas_una_abierta on public.alertas_fiscales (operacion_id, tipo) where resuelta_en is null;

-- ============================================================ artefactos (XML/PDF). En esta fase los bytes viven en la base (simulación); el almacenamiento real vendrá después.
create table public.artefactos_documento (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null,
  documento_id uuid not null,
  operacion_id uuid not null,
  tipo         text not null check (tipo in ('xml','pdf')),
  nombre       text not null check (length(nombre) between 1 and 120),
  mime         text not null,
  sha256       text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  tamano       integer not null check (tamano between 1 and 5242880),
  contenido    bytea not null,
  almacenamiento text not null default 'db_simulado' check (almacenamiento = 'db_simulado'),
  creado_en    timestamptz not null default now(),
  foreign key (operacion_id, empresa_id) references public.operaciones_fiscales (id, empresa_id),
  foreign key (documento_id, empresa_id) references public.documentos (id, empresa_id),
  unique (operacion_id, tipo),
  check (sha256 = encode(sha256(contenido), 'hex') and tamano = octet_length(contenido))
);

-- Tablas de solo inserción: ni UPDATE ni DELETE, ni con la clave de servicio (las conciliaciones y alertas se modifican solo con sus funciones).
create or replace function public.fel_solo_insertar() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'FEL_APPEND_ONLY: % es de solo inserción', tg_table_name; end $$;
create trigger eventos_proveedor_solo_insertar before update or delete on public.eventos_proveedor for each row execute function public.fel_solo_insertar();
create trigger artefactos_solo_insertar before update or delete on public.artefactos_documento for each row execute function public.fel_solo_insertar();

-- ============================================================ RLS: la app solo LEE, y solo lo de su empresa
alter table public.establecimientos      enable row level security;
alter table public.proveedores_emision   enable row level security;
alter table public.empresa_canales       enable row level security;
alter table public.eventos_proveedor     enable row level security;
alter table public.conciliaciones        enable row level security;
alter table public.alertas_fiscales      enable row level security;
alter table public.artefactos_documento  enable row level security;
grant select on public.establecimientos, public.proveedores_emision, public.empresa_canales, public.eventos_proveedor, public.conciliaciones, public.alertas_fiscales to authenticated;
grant select (id, empresa_id, documento_id, operacion_id, tipo, nombre, mime, sha256, tamano, almacenamiento, creado_en) on public.artefactos_documento to authenticated;   -- sin los bytes
create policy establecimientos_leer on public.establecimientos for select to authenticated using (public.fel_tiene_permiso(empresa_id, 'establecimientos.ver'));
create policy proveedores_leer      on public.proveedores_emision for select to authenticated using (true);
create policy canales_leer          on public.empresa_canales for select to authenticated using (public.fel_tiene_permiso(empresa_id, 'canales.ver'));
create policy eventos_leer          on public.eventos_proveedor for select to authenticated using (public.fel_tiene_permiso(empresa_id, 'fiscal.ver'));
create policy conciliaciones_leer   on public.conciliaciones for select to authenticated using (public.fel_tiene_permiso(empresa_id, 'fiscal.ver'));
create policy alertas_leer          on public.alertas_fiscales for select to authenticated using (public.fel_tiene_permiso(empresa_id, 'fiscal.ver'));
create policy artefactos_leer       on public.artefactos_documento for select to authenticated using (public.fel_tiene_permiso(empresa_id, 'artefactos.descargar'));
revoke delete, truncate on public.establecimientos, public.empresa_canales, public.eventos_proveedor, public.conciliaciones, public.alertas_fiscales, public.artefactos_documento from service_role;
revoke update on public.eventos_proveedor, public.artefactos_documento from service_role;

-- ============================================================ guardas reforzadas
-- Documento: el establecimiento forma parte del contenido (solo se cambia en un borrador sin vida fiscal).
create or replace function public.fel_documento_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_fiscal_cambia boolean; v_prep_cambia boolean; v_contenido_cambia boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'FEL_REGLA: los documentos no se borran; un borrador se archiva';
  end if;
  if tg_op = 'INSERT' then
    if new.estado_preparacion <> 'borrador' or new.estado_fiscal <> 'ninguno' then
      raise exception 'FEL_REGLA: un documento nuevo nace como borrador sin estado fiscal';
    end if;
    return new;
  end if;
  if new.id <> old.id or new.empresa_id <> old.empresa_id or new.numero_borrador <> old.numero_borrador
     or new.tipo_documento <> old.tipo_documento or new.creado_en <> old.creado_en then
    raise exception 'FEL_REGLA: la identidad del documento no se puede modificar';
  end if;
  v_fiscal_cambia := new.estado_fiscal <> old.estado_fiscal;
  v_prep_cambia   := new.estado_preparacion <> old.estado_preparacion;
  v_contenido_cambia :=
       new.cliente_id is distinct from old.cliente_id or new.cliente_snapshot is distinct from old.cliente_snapshot
    or new.regimen_id is distinct from old.regimen_id or new.regimen_snapshot is distinct from old.regimen_snapshot
    or new.moneda <> old.moneda or new.fecha_emision_prevista is distinct from old.fecha_emision_prevista
    or new.subtotal is distinct from old.subtotal or new.descuento_total is distinct from old.descuento_total
    or new.base_imponible is distinct from old.base_imponible or new.impuestos is distinct from old.impuestos
    or new.total is distinct from old.total or new.calculo is distinct from old.calculo
    or new.observaciones is distinct from old.observaciones
    or new.establecimiento_id is distinct from old.establecimiento_id;
  if v_contenido_cambia and not (old.estado_preparacion = 'borrador' and old.estado_fiscal = 'ninguno') then
    raise exception 'FEL_REGLA: el contenido solo se edita en un borrador sin estado fiscal; un documento certificado es inmutable';
  end if;
  if v_prep_cambia then
    if old.estado_fiscal <> 'ninguno' and not (old.estado_fiscal = 'rechazado' and new.estado_fiscal = 'ninguno') then
      raise exception 'FEL_REGLA: un documento con vida fiscal no cambia su estado de preparación';
    end if;
    if (old.estado_preparacion, new.estado_preparacion) not in
       (('borrador','revisado'), ('revisado','borrador'), ('borrador','archivado'), ('revisado','archivado'), ('archivado','borrador')) then
      raise exception 'FEL_REGLA: transición de preparación no permitida (% → %)', old.estado_preparacion, new.estado_preparacion;
    end if;
  end if;
  if v_fiscal_cambia then
    if coalesce(current_setting('fel.op_fiscal', true), '') <> 'on' then
      raise exception 'FEL_REGLA: el estado fiscal solo cambia mediante las operaciones fiscales';
    end if;
    if not public.fel__transicion_fiscal_valida(old.estado_fiscal, new.estado_fiscal) then
      raise exception 'FEL_REGLA: transición fiscal no permitida (% → %)', old.estado_fiscal, new.estado_fiscal;
    end if;
  end if;
  if old.estado_fiscal in ('certificado','anulacion_solicitada','anulado') and
     (new.serie is distinct from old.serie or new.numero_fiscal is distinct from old.numero_fiscal
      or new.autorizacion_sat is distinct from old.autorizacion_sat
      or new.certificacion_verificada_en is distinct from old.certificacion_verificada_en) then
    raise exception 'FEL_REGLA: serie, número y autorización de un DTE certificado son inmutables';
  end if;
  if old.estado_fiscal in ('anulado') then
    raise exception 'FEL_REGLA: un documento anulado es definitivo';
  end if;
  return new;
end $$;

-- Operación: se añaden los campos nuevos (canal y ambiente inmutables; el envío se marca una sola vez).
create or replace function public.fel_operacion_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.estado <> 'iniciada' then raise exception 'FEL_REGLA: una operación nace en estado iniciada'; end if;
    return new;
  end if;
  if new.id <> old.id or new.empresa_id <> old.empresa_id or new.documento_id <> old.documento_id or new.tipo <> old.tipo
     or new.clave_idempotencia <> old.clave_idempotencia or new.hash_contenido <> old.hash_contenido
     or new.iniciada_en <> old.iniciada_en or new.iniciada_por is distinct from old.iniciada_por
     or new.canal_id is distinct from old.canal_id or new.ambiente is distinct from old.ambiente then
    raise exception 'FEL_REGLA: los datos de la operación fiscal son inmutables';
  end if;
  if old.enviada_en is not null and new.enviada_en is distinct from old.enviada_en then
    raise exception 'FEL_REGLA: el instante de envío no se modifica';
  end if;
  if new.estado <> old.estado and (old.estado, new.estado) not in
     (('iniciada','confirmada_exitosa'), ('iniciada','confirmada_fallida'), ('iniciada','desconocida'),
      ('desconocida','confirmada_exitosa'), ('desconocida','confirmada_fallida')) then
    raise exception 'FEL_REGLA: transición de operación no permitida (% → %)', old.estado, new.estado;
  end if;
  if old.estado in ('confirmada_exitosa','confirmada_fallida') and new is distinct from old then
    raise exception 'FEL_REGLA: una operación confirmada no se modifica';
  end if;
  if new.resolucion = 'conciliacion_manual' and (new.evidencia is null or new.resuelta_por is null) then
    raise exception 'FEL_REGLA: la conciliación manual exige evidencia y responsable';
  end if;
  return new;
end $$;

-- ============================================================ utilidades internas
create or replace function public.fel__cerrar_certificacion(
  p_op uuid, p_exitosa boolean, p_resolucion text, p_evidencia jsonb, p_actor uuid,
  p_serie text default null, p_numero text default null, p_autorizacion text default null, p_reintento_desde timestamptz default null) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.operaciones_fiscales;
begin
  select * into o from public.operaciones_fiscales where id = p_op for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: operación no encontrada'; end if;
  if o.tipo <> 'certificacion' then raise exception 'FEL_REGLA: solo certificaciones'; end if;
  if o.estado not in ('iniciada','desconocida') then raise exception 'FEL_REGLA: la operación ya está confirmada'; end if;
  perform 1 from public.documentos where id = o.documento_id and empresa_id = o.empresa_id for update;
  if p_exitosa then
    if coalesce(btrim(p_serie), '') = '' or coalesce(btrim(p_numero), '') = '' or coalesce(btrim(p_autorizacion), '') = '' then
      raise exception 'FEL_REGLA: serie, número y autorización son obligatorios para confirmar una certificación';
    end if;
    -- simulación y realidad nunca se mezclan: lo simulado lleva el prefijo SIM y lo demás no puede llevarlo
    if (coalesce(o.ambiente, 'real') = 'simulado') <> (upper(btrim(p_autorizacion)) like 'SIM-%') then
      raise exception 'FEL_REGLA: la autorización no corresponde al ambiente de la operación (%)', coalesce(o.ambiente, 'sin ambiente');
    end if;
    if exists (select 1 from public.documentos d where d.empresa_id = o.empresa_id and d.autorizacion_sat = btrim(p_autorizacion) and d.id <> o.documento_id) then
      raise exception 'FEL_CONFLICTO: la autorización ya pertenece a otro documento';
    end if;
  end if;
  update public.operaciones_fiscales
     set estado = case when p_exitosa then 'confirmada_exitosa' else 'confirmada_fallida' end,
         resolucion = p_resolucion, evidencia = p_evidencia, resuelta_por = p_actor, resuelta_en = clock_timestamp(), reintento_desde = p_reintento_desde
   where id = p_op;
  if p_exitosa then
    perform public.fel__fiscal_cambiar(o.documento_id, o.empresa_id, 'certificado', p_actor, p_op, p_resolucion, btrim(p_serie), btrim(p_numero), btrim(p_autorizacion));
  else
    perform public.fel__fiscal_cambiar(o.documento_id, o.empresa_id, 'rechazado', p_actor, p_op, p_resolucion);
  end if;
end $$;

-- Autorización de contexto: un documento no puede certificarse si hay una alerta fiscal abierta.
create or replace function public.fel__sin_alertas(p_doc uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if exists (select 1 from public.alertas_fiscales where documento_id = p_doc and resuelta_en is null) then
    raise exception 'FEL_ALERTA_ABIERTA: hay una alerta fiscal abierta en este documento; resuélvela antes de continuar';
  end if;
end $$;

-- Toda NUEVA certificación (por cualquier ruta, también la antigua) pasa por aquí: sin alertas abiertas y, tras una conciliación manual
-- «fallida», solo cuando vence la espera de respuestas tardías Y el proveedor fue consultado después sin devolver «certificado».
create or replace function public.fel_operacion_nueva_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare prev public.operaciones_fiscales;
begin
  if new.tipo <> 'certificacion' then return new; end if;
  perform public.fel__sin_alertas(new.documento_id);
  select * into prev from public.operaciones_fiscales
   where documento_id = new.documento_id and tipo = 'certificacion' and resolucion = 'conciliacion_manual' and estado = 'confirmada_fallida'
   order by resuelta_en desc limit 1;
  if found then
    if prev.reintento_desde is not null and clock_timestamp() < prev.reintento_desde then
      raise exception 'FEL_ESPERA_TARDIA: aún no vence la espera de respuestas tardías (hasta %)', prev.reintento_desde;
    end if;
    if not exists (select 1 from public.eventos_proveedor e where e.operacion_id = prev.id and e.tipo = 'conciliacion' and e.creado_en >= prev.resuelta_en and e.resultado <> 'certificado') then
      raise exception 'FEL_AUDITORIA_PENDIENTE: falta la comprobación del proveedor posterior a la conciliación manual';
    end if;
  end if;
  return new;
end $$;
create trigger operaciones_nueva_guard before insert on public.operaciones_fiscales
  for each row execute function public.fel_operacion_nueva_guard();

-- ============================================================ establecimientos y canales (escritura atómica)
create or replace function public.fel_op_establecimiento_guardar(
  p_actor uuid, p_empresa uuid, p_id uuid, p_codigo text, p_nombre text, p_direccion text, p_estado text) returns public.establecimientos
language plpgsql security definer set search_path = '' as $$
declare e public.establecimientos;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'establecimientos.gestionar');
  if p_estado not in ('activo','inactivo') then raise exception 'FEL_REGLA: estado no válido'; end if;
  if p_id is null then
    insert into public.establecimientos (empresa_id, codigo_sat, nombre, direccion, estado, creado_por)
    values (p_empresa, btrim(p_codigo), btrim(p_nombre), nullif(btrim(p_direccion), ''), p_estado, p_actor) returning * into e;
  else
    update public.establecimientos set codigo_sat = btrim(p_codigo), nombre = btrim(p_nombre), direccion = nullif(btrim(p_direccion), ''), estado = p_estado, actualizado_en = now()
     where id = p_id and empresa_id = p_empresa returning * into e;
    if not found then raise exception 'FEL_NO_ENCONTRADO: establecimiento no encontrado'; end if;
  end if;
  perform public.fel_auditar(p_empresa, p_actor, 'establecimiento.guardar', 'establecimiento', e.id::text, jsonb_build_object('codigo', e.codigo_sat));
  return e;
end $$;

create or replace function public.fel_op_canal_configurar(
  p_actor uuid, p_empresa uuid, p_establecimiento uuid, p_proveedor text, p_ambiente text, p_habilitado boolean) returns public.empresa_canales
language plpgsql security definer set search_path = '' as $$
declare c public.empresa_canales; pr public.proveedores_emision;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'canales.configurar');
  select * into pr from public.proveedores_emision where id = p_proveedor;
  if not found then raise exception 'FEL_REGLA: proveedor desconocido'; end if;
  if not (p_ambiente = any (pr.ambientes)) then raise exception 'FEL_REGLA: el proveedor % no admite el ambiente %', p_proveedor, p_ambiente; end if;
  if p_habilitado and (not pr.habilitado or p_ambiente <> 'simulado') then
    raise exception 'FEL_REGLA: solo los canales simulados del proveedor simulado pueden habilitarse en esta versión';
  end if;
  insert into public.empresa_canales (empresa_id, establecimiento_id, proveedor_id, ambiente, habilitado, creado_por)
  values (p_empresa, p_establecimiento, p_proveedor, p_ambiente, p_habilitado, p_actor)
  on conflict (empresa_id, coalesce(establecimiento_id, '00000000-0000-0000-0000-000000000000'::uuid), proveedor_id, ambiente)
  do update set habilitado = excluded.habilitado
  returning * into c;
  perform public.fel_auditar(p_empresa, p_actor, 'canal.configurar', 'canal', c.id::text, jsonb_build_object('proveedor', p_proveedor, 'ambiente', p_ambiente, 'habilitado', p_habilitado));
  return c;
end $$;

create or replace function public.fel_op_documento_establecimiento(p_actor uuid, p_empresa uuid, p_doc uuid, p_est uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'borradores.editar');
  if not exists (select 1 from public.establecimientos where id = p_est and empresa_id = p_empresa and estado = 'activo') then
    raise exception 'FEL_REGLA: establecimiento no válido para esta empresa';
  end if;
  if not exists (select 1 from public.documentos where id = p_doc and empresa_id = p_empresa) then raise exception 'FEL_NO_ENCONTRADO: documento no encontrado'; end if;
  update public.documentos set establecimiento_id = p_est, actualizado_por = p_actor, version = version + 1
   where id = p_doc and empresa_id = p_empresa and estado_preparacion = 'borrador' and estado_fiscal = 'ninguno';
  if not found then raise exception 'FEL_REGLA: el establecimiento solo se asigna a un borrador sin estado fiscal'; end if;
  perform public.fel_auditar(p_empresa, p_actor, 'documento.establecimiento', 'documento', p_doc::text, jsonb_build_object('establecimiento', p_est));
end $$;

-- Corregir tras un rechazo confirmado: rechazado → ninguno y de vuelta a borrador (el contenido vuelve a ser editable y hay que revisarlo de nuevo).
create or replace function public.fel_op_documento_reabrir(p_actor uuid, p_empresa uuid, p_doc uuid, p_version integer) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.documentos;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'borradores.editar');
  select * into v from public.documentos where id = p_doc and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: documento no encontrado'; end if;
  if p_version is null or p_version <> v.version then raise exception 'FEL_CONFLICTO: el documento cambió; recarga e intenta de nuevo'; end if;
  if v.estado_fiscal <> 'rechazado' then raise exception 'FEL_REGLA: solo un documento con rechazo confirmado vuelve a borrador'; end if;
  if exists (select 1 from public.operaciones_fiscales where documento_id = p_doc and estado in ('iniciada','desconocida')) then raise exception 'FEL_OPERACION_ABIERTA: hay una operación sin confirmar'; end if;
  perform set_config('fel.op_fiscal', 'on', true);
  update public.documentos set estado_fiscal = 'ninguno', estado_preparacion = 'borrador', version = version + 1, actualizado_por = p_actor where id = p_doc;
  perform set_config('fel.op_fiscal', 'off', true);
  insert into public.documento_estados (documento_id, empresa_id, eje, anterior, nuevo, motivo, user_id) values
    (p_doc, p_empresa, 'fiscal', 'rechazado', 'ninguno', 'corrección tras rechazo confirmado', p_actor),
    (p_doc, p_empresa, 'preparacion', v.estado_preparacion, 'borrador', 'corrección tras rechazo confirmado', p_actor);
  perform public.fel_auditar(p_empresa, p_actor, 'documento.reabrir', 'documento', p_doc::text, '{}');
end $$;

-- Contenido congelado que se envía al proveedor y su hash (SHA-256 del texto canónico de jsonb). El hash lo calcula la BASE: nadie puede inventarlo.
create or replace function public.fel__instantanea_documento(p_empresa uuid, p_doc uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'documento_id', d.id, 'empresa_id', d.empresa_id, 'tipo_documento', d.tipo_documento, 'moneda', d.moneda,
    'fecha_emision_prevista', d.fecha_emision_prevista,
    'establecimiento', (select jsonb_build_object('id', e.id, 'codigo_sat', e.codigo_sat) from public.establecimientos e where e.id = d.establecimiento_id and e.empresa_id = d.empresa_id),
    'cliente', (select jsonb_build_object('tipo_identificacion', c.tipo_identificacion, 'numero_identificacion', c.numero_identificacion, 'nombre', c.nombre) from public.clientes c where c.id = d.cliente_id and c.empresa_id = d.empresa_id),
    'lineas', coalesce((select jsonb_agg(jsonb_build_object('orden', l.orden, 'descripcion', l.descripcion, 'cantidad', l.cantidad, 'precio_unitario', l.precio_unitario,
                'descuento_tipo', l.descuento_tipo, 'descuento_valor', l.descuento_valor, 'importes', l.importes) order by l.orden)
                from public.documento_lineas l where l.documento_id = d.id and l.empresa_id = d.empresa_id), '[]'::jsonb),
    'subtotal', d.subtotal, 'descuento_total', d.descuento_total, 'base_imponible', d.base_imponible, 'oficial', false)
    from public.documentos d where d.id = p_doc and d.empresa_id = p_empresa
$$;
create or replace function public.fel_sys_documento_instantanea(p_empresa uuid, p_doc uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  v := public.fel__instantanea_documento(p_empresa, p_doc);
  if v is null then raise exception 'FEL_NO_ENCONTRADO: documento no encontrado'; end if;
  return jsonb_build_object('instantanea', v, 'hash', encode(sha256(convert_to(v::text, 'UTF8')), 'hex'));
end $$;
create or replace function public.fel_sys_hash_documento(p_empresa uuid, p_doc uuid) returns text
language sql stable security definer set search_path = '' as $$ select public.fel_sys_documento_instantanea(p_empresa, p_doc) ->> 'hash' $$;
create or replace function public.fel_sys_operacion(p_empresa uuid, p_op uuid) returns public.operaciones_fiscales
language plpgsql stable security definer set search_path = '' as $$
declare o public.operaciones_fiscales;
begin
  select * into o from public.operaciones_fiscales where id = p_op and empresa_id = p_empresa;
  if not found then raise exception 'FEL_NO_ENCONTRADO: operación no encontrada'; end if;
  return o;
end $$;

-- ============================================================ certificación simulada: solicitar (persistir ANTES de enviar)
-- Idempotente por (documento, clave). Una sola operación abierta por documento. Nunca por encima de un por_verificar ni de una alerta abierta.
create or replace function public.fel_op_certificacion_solicitar(
  p_actor uuid, p_empresa uuid, p_doc uuid, p_clave text, p_hash text, p_canal uuid) returns public.operaciones_fiscales
language plpgsql security definer set search_path = '' as $$
declare v public.documentos; o public.operaciones_fiscales; c public.empresa_canales; pr public.proveedores_emision;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'fiscal.certificar');
  select * into c from public.empresa_canales where id = p_canal and empresa_id = p_empresa;
  if not found or not c.habilitado then raise exception 'FEL_REGLA: el canal no existe o no está habilitado'; end if;
  select * into pr from public.proveedores_emision where id = c.proveedor_id;
  if not pr.habilitado then raise exception 'FEL_REGLA: el proveedor no está habilitado'; end if;
  if c.ambiente <> 'simulado' then perform public.fel__emision_real_activa(p_empresa); end if;   -- (los canales no simulados no pueden habilitarse, pero la guarda se mantiene)
  if not exists (select 1 from public.empresas where id = p_empresa and estado = 'habilitada') then raise exception 'FEL_REGLA: la empresa no está habilitada'; end if;
  select * into v from public.documentos where id = p_doc and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: documento no encontrado'; end if;
  select * into o from public.operaciones_fiscales where documento_id = p_doc and clave_idempotencia = p_clave;
  if found then
    if o.hash_contenido <> p_hash or o.tipo <> 'certificacion' then raise exception 'FEL_CONFLICTO: la clave de idempotencia ya se usó con otro contenido'; end if;
    return o;
  end if;
  if v.estado_fiscal = 'por_verificar' then raise exception 'FEL_POR_VERIFICAR: resultado desconocido; concilia antes de cualquier operación nueva'; end if;
  if p_hash is distinct from public.fel_sys_hash_documento(p_empresa, p_doc) then raise exception 'FEL_REGLA: el hash no corresponde al contenido revisado del documento'; end if;
  if exists (select 1 from public.operaciones_fiscales where documento_id = p_doc and estado in ('iniciada','desconocida')) then
    raise exception 'FEL_OPERACION_ABIERTA: hay una operación sin confirmar; concílala antes de reintentar';
  end if;
  if v.estado_preparacion <> 'revisado' or v.estado_fiscal not in ('ninguno','rechazado') then
    raise exception 'FEL_REGLA: el documento no está en condiciones de certificarse (revisado, sin estado fiscal o con un rechazo confirmado)';
  end if;
  if v.establecimiento_id is null then raise exception 'FEL_REGLA: el documento no tiene establecimiento'; end if;
  if c.establecimiento_id is not null and c.establecimiento_id <> v.establecimiento_id then raise exception 'FEL_REGLA: el canal no corresponde al establecimiento del documento'; end if;
  -- (la espera tras una conciliación manual «fallida», la comprobación posterior del proveedor y las alertas abiertas las exige el disparador fel_operacion_nueva_guard)
  insert into public.operaciones_fiscales (empresa_id, documento_id, tipo, clave_idempotencia, hash_contenido, proveedor, iniciada_por, canal_id, ambiente)
  values (p_empresa, p_doc, 'certificacion', p_clave, p_hash, c.proveedor_id, p_actor, c.id, c.ambiente) returning * into o;
  perform public.fel__fiscal_cambiar(p_doc, p_empresa, 'pendiente_certificacion', p_actor, o.id, 'certificación solicitada (' || c.proveedor_id || '/' || c.ambiente || ')');
  perform public.fel_auditar(p_empresa, p_actor, 'fiscal.certificacion_solicitada', 'documento', p_doc::text, jsonb_build_object('operacion', o.id, 'canal', c.id, 'ambiente', c.ambiente));
  return o;
end $$;

-- Marca el envío ANTES de salir (en su propia transacción). Si el proceso muere antes de esta marca, se prueba que NO se envió nada.
create or replace function public.fel_sys_operacion_marcar_envio(p_empresa uuid, p_op uuid) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare o public.operaciones_fiscales;
begin
  select * into o from public.operaciones_fiscales where id = p_op and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: operación no encontrada'; end if;
  if o.estado <> 'iniciada' then raise exception 'FEL_REGLA: solo una operación iniciada se envía'; end if;
  if o.enviada_en is not null then raise exception 'FEL_YA_ENVIADA: la operación ya se envió; nunca se reenvía'; end if;   -- un solo envío por operación
  update public.operaciones_fiscales set enviada_en = clock_timestamp() where id = p_op returning enviada_en into o.enviada_en;
  return o.enviada_en;
end $$;

-- Evento verificable del proveedor (envío, conciliación o recuperación).
create or replace function public.fel_sys_evento_registrar(
  p_empresa uuid, p_op uuid, p_tipo text, p_resultado text, p_motivo text, p_serie text, p_numero text, p_autorizacion text, p_hash text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  insert into public.eventos_proveedor (empresa_id, operacion_id, tipo, resultado, motivo, serie, numero, autorizacion, hash_respuesta)
  values (p_empresa, p_op, p_tipo, p_resultado, p_motivo, p_serie, p_numero, p_autorizacion, p_hash) returning id into v_id;
  return v_id;
end $$;

-- Resultado desconocido (o proceso caído tras marcar el envío): el documento queda por_verificar. NO se reintenta.
create or replace function public.fel_sys_operacion_desconocida(p_empresa uuid, p_op uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.operaciones_fiscales;
begin
  select * into o from public.operaciones_fiscales where id = p_op and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: operación no encontrada'; end if;
  if o.estado = 'desconocida' then return; end if;   -- idempotente
  if o.estado <> 'iniciada' then raise exception 'FEL_REGLA: solo una operación iniciada puede quedar desconocida'; end if;
  perform 1 from public.documentos where id = o.documento_id and empresa_id = p_empresa for update;
  update public.operaciones_fiscales set estado = 'desconocida', motivo_desconocido = left(p_motivo, 80) where id = p_op;
  perform public.fel__fiscal_cambiar(o.documento_id, p_empresa, 'por_verificar', null, p_op, 'resultado desconocido: ' || left(p_motivo, 80));
  perform public.fel_auditar(p_empresa, null, 'fiscal.operacion_desconocida', 'documento', o.documento_id::text, jsonb_build_object('operacion', p_op, 'motivo', left(p_motivo, 80)), 'sistema');
end $$;

-- Orden de canal asistido pendiente de acción humana (la operación sigue abierta).
create or replace function public.fel_sys_operacion_orden(p_empresa uuid, p_op uuid, p_orden text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.operaciones_fiscales set orden_externa = left(p_orden, 80) where id = p_op and empresa_id = p_empresa and estado = 'iniciada' and orden_externa is null;
  if not found then raise exception 'FEL_REGLA: la operación no admite una orden'; end if;
end $$;

-- Resolver a partir de un EVENTO verificable del proveedor (no de la palabra de nadie).
create or replace function public.fel_sys_operacion_resolver_evento(p_empresa uuid, p_op uuid, p_evento bigint) returns text
language plpgsql security definer set search_path = '' as $$
declare o public.operaciones_fiscales; ev public.eventos_proveedor;
begin
  select * into o from public.operaciones_fiscales where id = p_op and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: operación no encontrada'; end if;
  select * into ev from public.eventos_proveedor where id = p_evento and operacion_id = p_op and empresa_id = p_empresa;
  if not found then raise exception 'FEL_REGLA: el evento no pertenece a esta operación'; end if;
  if o.enviada_en is null or ev.creado_en < o.enviada_en then raise exception 'FEL_REGLA: el evento es anterior al envío'; end if;
  if o.estado in ('confirmada_exitosa','confirmada_fallida') then
    -- Respuesta TARDÍA sobre una operación ya cerrada: nunca se reabre; si dice «certificado» tras darla por fallida, es una certificación huérfana.
    if ev.resultado = 'certificado' and o.estado = 'confirmada_fallida' then
      insert into public.alertas_fiscales (empresa_id, documento_id, operacion_id, tipo, detalle)
      values (p_empresa, o.documento_id, p_op, 'certificacion_huerfana', jsonb_build_object('evento', p_evento, 'resolucion_previa', o.resolucion))
      on conflict (operacion_id, tipo) where resuelta_en is null do nothing;
      perform public.fel_auditar(p_empresa, null, 'fiscal.certificacion_huerfana', 'documento', o.documento_id::text, jsonb_build_object('operacion', p_op, 'evento', p_evento), 'sistema');
      return 'alerta';
    end if;
    return 'sin_cambio';
  end if;
  if ev.resultado = 'certificado' then
    perform public.fel__cerrar_certificacion(p_op, true, 'proveedor', jsonb_build_object('evento', p_evento, 'tipo', ev.tipo), null, ev.serie, ev.numero, ev.autorizacion);
    perform public.fel_auditar(p_empresa, null, 'fiscal.operacion_resuelta', 'documento', o.documento_id::text, jsonb_build_object('operacion', p_op, 'resultado', 'certificado', 'evento', p_evento), 'sistema');
    return 'certificado';
  elsif ev.resultado in ('rechazado_confirmado','no_existe_confirmado') then
    if o.orden_externa is not null and ev.resultado = 'no_existe_confirmado' then return 'sin_cambio'; end if;   -- con una orden humana pendiente, «no existe» no libera nada
    perform public.fel__cerrar_certificacion(p_op, false, 'proveedor', jsonb_build_object('evento', p_evento, 'tipo', ev.tipo, 'resultado', ev.resultado), null);
    perform public.fel_auditar(p_empresa, null, 'fiscal.operacion_resuelta', 'documento', o.documento_id::text, jsonb_build_object('operacion', p_op, 'resultado', ev.resultado, 'evento', p_evento), 'sistema');
    return 'rechazado';
  end if;
  return 'sin_cambio';   -- desconocido / indeterminado / acción humana: no libera nada
end $$;

-- Proceso caído ANTES de marcar el envío: se PRUEBA que nunca salió nada; se libera sin intervención del proveedor.
create or replace function public.fel_sys_operacion_no_enviada(p_empresa uuid, p_op uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.operaciones_fiscales;
begin
  select * into o from public.operaciones_fiscales where id = p_op and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: operación no encontrada'; end if;
  if o.estado <> 'iniciada' or o.enviada_en is not null or o.orden_externa is not null then
    raise exception 'FEL_REGLA: solo se libera una operación iniciada, sin marca de envío y sin orden asistida';
  end if;
  perform public.fel__cerrar_certificacion(p_op, false, 'sistema_no_enviada', jsonb_build_object('enviada_en', null, 'motivo', 'proceso caído antes de marcar el envío'), null);
  perform public.fel_auditar(p_empresa, null, 'fiscal.operacion_no_enviada', 'documento', o.documento_id::text, jsonb_build_object('operacion', p_op), 'sistema');
end $$;

-- Candidatos de recuperación: operaciones sin resolver (más antiguas que el umbral) y conciliables.
create or replace function public.fel_sys_operaciones_pendientes(p_umbral_min integer default null)
returns table (operacion_id uuid, empresa_id uuid, documento_id uuid, estado text, enviada boolean, orden_externa text, clave_idempotencia text, ambiente text)
language sql stable security definer set search_path = '' as $$
  select o.id, o.empresa_id, o.documento_id, o.estado, o.enviada_en is not null, o.orden_externa, o.clave_idempotencia, o.ambiente
    from public.operaciones_fiscales o
   where o.tipo = 'certificacion' and o.estado in ('iniciada','desconocida')
     and o.iniciada_en <= now() - make_interval(mins => coalesce(p_umbral_min, public.fel__parametro('umbral_recuperacion_min')::integer))
   order by o.iniciada_en
$$;
-- Operaciones dadas por fallidas a mano dentro de la ventana de respuestas tardías (para la auditoría de huérfanas).
create or replace function public.fel_sys_fallidas_manuales_recientes()
returns table (operacion_id uuid, empresa_id uuid, documento_id uuid, clave_idempotencia text, ambiente text)
language sql stable security definer set search_path = '' as $$
  select o.id, o.empresa_id, o.documento_id, o.clave_idempotencia, o.ambiente
    from public.operaciones_fiscales o
   where o.tipo = 'certificacion' and o.estado = 'confirmada_fallida' and o.resolucion = 'conciliacion_manual'
     and o.resuelta_en >= clock_timestamp() - make_interval(mins => public.fel__parametro('ventana_auditoria_min')::integer)
$$;
-- Certificaciones exitosas a las que aún les faltan artefactos (caída entre certificar y guardar PDF/XML).
create or replace function public.fel_sys_artefactos_faltantes()
returns table (operacion_id uuid, empresa_id uuid, documento_id uuid, clave_idempotencia text, ambiente text)
language sql stable security definer set search_path = '' as $$
  select o.id, o.empresa_id, o.documento_id, o.clave_idempotencia, o.ambiente
    from public.operaciones_fiscales o
   where o.tipo = 'certificacion' and o.estado = 'confirmada_exitosa'
     and (select count(*) from public.artefactos_documento a where a.operacion_id = o.id) < 2
$$;

create or replace function public.fel_sys_artefacto_guardar(p_empresa uuid, p_op uuid, p_tipo text, p_nombre text, p_mime text, p_contenido bytea) returns uuid
language plpgsql security definer set search_path = '' as $$
declare o public.operaciones_fiscales; v_id uuid;
begin
  select * into o from public.operaciones_fiscales where id = p_op and empresa_id = p_empresa;
  if not found or o.estado <> 'confirmada_exitosa' then raise exception 'FEL_REGLA: solo se guardan artefactos de una certificación confirmada'; end if;
  insert into public.artefactos_documento (empresa_id, documento_id, operacion_id, tipo, nombre, mime, sha256, tamano, contenido)
  values (p_empresa, o.documento_id, p_op, p_tipo, p_nombre, p_mime, encode(sha256(p_contenido), 'hex'), octet_length(p_contenido), p_contenido)
  on conflict (operacion_id, tipo) do nothing returning id into v_id;
  return v_id;   -- nulo si ya existía (idempotente)
end $$;

-- ============================================================ conciliación manual: propuesta → espera → aprobación de OTRA persona
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
  if o.orden_externa is not null then raise exception 'FEL_REGLA: hay una orden asistida pendiente; resuélvela con el canal'; end if;
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

create or replace function public.fel_op_conciliacion_decidir(p_actor uuid, p_empresa uuid, p_conciliacion uuid, p_aprobar boolean, p_nota text) returns public.conciliaciones
language plpgsql security definer set search_path = '' as $$
declare c public.conciliaciones; o public.operaciones_fiscales; v_ventana integer;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'conciliacion.aprobar');
  select * into c from public.conciliaciones where id = p_conciliacion and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: conciliación no encontrada'; end if;
  if c.estado <> 'propuesta' then raise exception 'FEL_REGLA: la conciliación ya fue decidida'; end if;
  if c.propuesta_por = p_actor then raise exception 'FEL_REGLA: la aprueba otra persona, no quien la propuso'; end if;
  select * into o from public.operaciones_fiscales where id = c.operacion_id and empresa_id = p_empresa for update;
  if o.estado <> 'desconocida' then raise exception 'FEL_REGLA: la operación ya no está pendiente'; end if;
  if not p_aprobar then
    update public.conciliaciones set estado = 'rechazada', decidida_por = p_actor, decidida_en = now(), nota = left(p_nota, 300) where id = c.id returning * into c;
    perform public.fel_auditar(p_empresa, p_actor, 'fiscal.conciliacion_rechazada', 'documento', o.documento_id::text, jsonb_build_object('conciliacion', c.id));
    return c;
  end if;
  update public.conciliaciones set estado = 'aprobada', decidida_por = p_actor, decidida_en = now(), nota = left(p_nota, 300) where id = c.id returning * into c;
  if c.tipo = 'manual_certificada' then
    perform public.fel__cerrar_certificacion(o.id, true, 'conciliacion_manual', c.evidencia || jsonb_build_object('conciliacion', c.id), p_actor, c.datos ->> 'serie', c.datos ->> 'numero', c.datos ->> 'autorizacion');
  else
    v_ventana := public.fel__parametro('ventana_tardia_min')::integer;
    perform public.fel__cerrar_certificacion(o.id, false, 'conciliacion_manual', c.evidencia || jsonb_build_object('conciliacion', c.id), p_actor,
                                             null, null, null, clock_timestamp() + make_interval(mins => v_ventana));
  end if;
  perform public.fel_auditar(p_empresa, p_actor, 'fiscal.conciliacion_aprobada', 'documento', o.documento_id::text, jsonb_build_object('conciliacion', c.id, 'tipo', c.tipo));
  return c;
end $$;

-- Una alerta abierta se resuelve con nota y persona responsable (no cambia estados fiscales).
create or replace function public.fel_op_alerta_resolver(p_actor uuid, p_empresa uuid, p_alerta uuid, p_nota text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'conciliacion.aprobar');
  if length(btrim(coalesce(p_nota, ''))) < 10 then raise exception 'FEL_REGLA: la nota de resolución debe describir la acción tomada (mínimo 10 caracteres)'; end if;
  update public.alertas_fiscales set resuelta_en = now(), resuelta_por = p_actor, nota = left(p_nota, 500) where id = p_alerta and empresa_id = p_empresa and resuelta_en is null;
  if not found then raise exception 'FEL_NO_ENCONTRADO: alerta no encontrada o ya resuelta'; end if;
  perform public.fel_auditar(p_empresa, p_actor, 'fiscal.alerta_resuelta', 'alerta', p_alerta::text, '{}');
end $$;

-- ============================================================ la resolución genérica deja de servir para certificaciones
-- Marcar «fallida» (o «exitosa») con una frase ya no libera nada: las certificaciones se resuelven con eventos del proveedor
-- (fel_sys_operacion_resolver_evento) o con conciliación manual propuesta, esperada, evidenciada y aprobada por otra persona.
create or replace function public.fel_op_operacion_resolver(
  p_actor uuid, p_empresa uuid, p_op uuid, p_exitosa boolean, p_resolucion text, p_evidencia jsonb,
  p_serie text, p_numero text, p_autorizacion text) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.operaciones_fiscales; v public.documentos;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, case when p_resolucion = 'conciliacion_manual' then 'fiscal.conciliar' else 'fiscal.certificar' end);
  if p_resolucion not in ('proveedor','conciliacion_manual') then raise exception 'FEL_REGLA: resolución no válida'; end if;
  if p_resolucion = 'conciliacion_manual' and (p_evidencia is null or p_evidencia = '{}'::jsonb) then
    raise exception 'FEL_REGLA: la conciliación manual exige evidencia';
  end if;
  select * into o from public.operaciones_fiscales where id = p_op and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: operación no encontrada'; end if;
  if o.estado not in ('iniciada','desconocida') then raise exception 'FEL_REGLA: la operación ya está confirmada'; end if;
  if o.tipo = 'certificacion' then
    raise exception 'FEL_REGLA: una certificación no se resuelve marcándola; usa un evento verificable del proveedor o la conciliación manual aprobada por otra persona';
  end if;
  select * into v from public.documentos where id = o.documento_id and empresa_id = p_empresa for update;
  update public.operaciones_fiscales
     set estado = case when p_exitosa then 'confirmada_exitosa' else 'confirmada_fallida' end,
         resolucion = p_resolucion, evidencia = p_evidencia, resuelta_por = p_actor, resuelta_en = now()
   where id = p_op;
  perform public.fel__fiscal_cambiar(o.documento_id, p_empresa, case when p_exitosa then 'anulado' else 'certificado' end, p_actor, p_op, p_resolucion);
  perform public.fel_auditar(p_empresa, p_actor, 'fiscal.operacion_resuelta', 'documento', o.documento_id::text,
    jsonb_build_object('operacion', p_op, 'exitosa', p_exitosa, 'resolucion', p_resolucion));
end $$;

-- La función antigua de «desconocida» por usuario tampoco debe usarse con certificaciones del flujo nuevo; se mantiene para compatibilidad.

-- ============================================================ privilegios: las funciones nuevas solo para service_role
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like 'fel\_op\_%' or p.proname like 'fel\_sys\_%' or p.proname in ('fel__cerrar_certificacion','fel__sin_alertas','fel__parametro','fel__instantanea_documento')) loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
  revoke all on function public.fel_solo_insertar() from public, anon, authenticated, service_role;
  revoke all on function public.fel_operacion_nueva_guard() from public, anon, authenticated, service_role;
end $$;
