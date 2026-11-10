-- NEXA FEL · Fase 1.0 · estructura base (proyecto Supabase INDEPENDIENTE de NEXA).
-- Tablas GLOBALES (sin empresa_id): plataforma_admins, perfiles, permisos_catalogo, rol_permisos, regimenes_fiscales, empresas.
-- Tablas POR EMPRESA (empresa_id obligatorio): miembros, invitaciones, clientes, conceptos, documentos, documento_lineas,
--   documento_estados, contadores_borrador. Auditoría: empresa_id opcional (hay eventos de plataforma).
-- Esta migración NO se ejecuta sola en ningún proyecto: se aplica con "supabase db push" cuando se autorice.

-- ============================================================ catálogo global de permisos
create table public.permisos_catalogo (
  codigo      text primary key,
  descripcion text not null
);

create table public.rol_permisos (
  rol     text not null check (rol in ('propietario','administrador','emisor','lector')),
  permiso text not null references public.permisos_catalogo (codigo),
  primary key (rol, permiso)
);

-- ============================================================ identidad (Supabase Auth: auth.users)
-- Administradores maestros de NEXA. Solo se llenan con clave de servicio / SQL; la app nunca escribe aquí.
create table public.plataforma_admins (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  creado_en timestamptz not null default now()
);

create table public.perfiles (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  nombre    text,
  activo    boolean not null default true,
  creado_en timestamptz not null default now()
);

-- ============================================================ régimen fiscal (global, versionado)
-- Las reglas NO tienen valores por defecto: nacen vacías y "sin_verificar". Una versión verificada es inmutable.
create table public.regimenes_fiscales (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null check (codigo ~ '^[a-z][a-z0-9_]{2,40}$'),
  version        integer not null check (version >= 1),
  nombre         text not null,
  estado         text not null default 'sin_verificar' check (estado in ('sin_verificar','verificado','obsoleto')),
  reglas         jsonb not null default '{}'::jsonb,
  fuente         text,                       -- referencia normativa o documento que respalda la regla
  vigente_desde  date,
  vigente_hasta  date,
  verificado_por uuid references auth.users (id),
  verificado_en  timestamptz,
  creado_por     uuid references auth.users (id),
  creado_en      timestamptz not null default now(),
  unique (codigo, version),
  check (vigente_hasta is null or vigente_desde is null or vigente_hasta >= vigente_desde)
);

-- ============================================================ empresas (globales: las crea el administrador maestro)
create table public.empresas (
  id                      uuid primary key default gen_random_uuid(),
  nombre_comercial        text not null,
  razon_social            text not null,
  nit                     text not null check (nit ~ '^[0-9A-Z-]{2,20}$'),   -- solo juego de caracteres; el formato oficial se valida con reglas verificadas
  regimen_id              uuid references public.regimenes_fiscales (id),
  estado                  text not null default 'pendiente' check (estado in ('pendiente','habilitada','suspendida')),
  moneda                  char(3) not null default 'GTQ' check (moneda = 'GTQ'),
  emision_real_habilitada boolean not null default false,
  emision_autorizada_por  uuid references auth.users (id),
  emision_autorizada_en   timestamptz,
  habilitada_por          uuid references auth.users (id),
  habilitada_en           timestamptz,
  creado_por              uuid references auth.users (id),
  creado_en               timestamptz not null default now(),
  actualizado_en          timestamptz not null default now(),
  unique (nit)
);

-- ============================================================ miembros e invitaciones (por empresa)
create table public.miembros (
  empresa_id          uuid not null references public.empresas (id),
  user_id             uuid not null references auth.users (id) on delete cascade,
  rol                 text not null check (rol in ('propietario','administrador','emisor','lector')),
  permisos_extra      text[] not null default '{}',     -- permisos concedidos además de los del rol
  permisos_revocados  text[] not null default '{}',     -- permisos del rol que se le quitan
  activo              boolean not null default true,
  invitado_por        uuid references auth.users (id),
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),
  primary key (empresa_id, user_id)
);
create index miembros_user_idx on public.miembros (user_id);

-- Las invitaciones usan el flujo NATIVO de Supabase Auth (inviteUserByEmail). Aquí solo se guarda el registro; no hay tokens propios.
create table public.invitaciones (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas (id),
  email          text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  rol            text not null check (rol in ('propietario','administrador','emisor','lector')),
  permisos_extra text[] not null default '{}',
  estado         text not null default 'pendiente' check (estado in ('pendiente','aceptada','revocada','vencida')),
  invitado_por   uuid references auth.users (id),
  user_id        uuid references auth.users (id),
  expira_en      timestamptz not null default (now() + interval '7 days'),
  creado_en      timestamptz not null default now(),
  aceptada_en    timestamptz
);
create unique index invitaciones_pendiente_uq on public.invitaciones (empresa_id, email) where estado = 'pendiente';

-- ============================================================ catálogo de identificaciones del comprador (global, configurable)
-- Los formatos NO se fijan en el código: cada tipo trae un patrón opcional y un indicador "verificado".
-- Hasta que el administrador maestro verifique un tipo contra la normativa vigente de SAT, no se puede usar para emisión real.
create table public.identificaciones_tipos (
  codigo         text primary key check (codigo ~ '^[A-Z][A-Z0-9_]{1,11}$'),
  nombre         text not null,
  patron         text,                        -- expresión regular (opcional); solo se aplica si verificado = true
  verificado     boolean not null default false,
  fuente         text,
  verificado_por uuid references auth.users (id),
  verificado_en  timestamptz,
  activo         boolean not null default true,
  notas          text,
  check (not verificado or (fuente is not null and verificado_por is not null and verificado_en is not null))
);

-- ============================================================ reglas normativas versionadas (global): anulación de DTE y otras
create table public.reglas_normativas (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null check (codigo ~ '^[a-z][a-z0-9_]{2,40}$'),
  version        integer not null check (version >= 1),
  nombre         text not null,
  estado         text not null default 'sin_verificar' check (estado in ('sin_verificar','verificado','obsoleto')),
  reglas         jsonb not null default '{}'::jsonb,
  fuente         text,
  vigente_desde  date,
  vigente_hasta  date,
  verificado_por uuid references auth.users (id),
  verificado_en  timestamptz,
  creado_por     uuid references auth.users (id),
  creado_en      timestamptz not null default now(),
  unique (codigo, version),
  check (vigente_hasta is null or vigente_desde is null or vigente_hasta >= vigente_desde)
);

-- ============================================================ clientes y conceptos (por empresa)
create table public.clientes (
  id                    uuid primary key default gen_random_uuid(),
  empresa_id            uuid not null references public.empresas (id),
  tipo_identificacion   text not null references public.identificaciones_tipos (codigo),
  numero_identificacion text not null check (length(numero_identificacion) between 1 and 30 and numero_identificacion ~ '^[0-9A-Za-z-]+$'),
  nombre                text not null check (length(btrim(nombre)) between 1 and 200),
  direccion             text,
  email                 text,
  telefono              text,
  activo                boolean not null default true,
  version               integer not null default 1,
  creado_por            uuid references auth.users (id),
  creado_en             timestamptz not null default now(),
  actualizado_por       uuid references auth.users (id),
  actualizado_en        timestamptz not null default now(),
  unique (id, empresa_id),
  check (tipo_identificacion <> 'CF' or numero_identificacion = 'CF')
);
create unique index clientes_identificacion_uq on public.clientes (empresa_id, tipo_identificacion, numero_identificacion)
  where tipo_identificacion <> 'CF';

create table public.conceptos (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references public.empresas (id),
  codigo           text not null check (length(btrim(codigo)) between 1 and 40),
  descripcion      text not null check (length(btrim(descripcion)) between 1 and 300),
  tipo             text not null check (tipo in ('bien','servicio')),
  unidad_medida    text not null default 'UND',
  precio_unitario  numeric not null default 0 check (precio_unitario >= 0 and scale(precio_unitario) <= 6),
  categoria_fiscal text,                       -- clave definida por las reglas del régimen (pendiente de validación)
  activo           boolean not null default true,
  version          integer not null default 1,
  creado_por       uuid references auth.users (id),
  creado_en        timestamptz not null default now(),
  actualizado_por  uuid references auth.users (id),
  actualizado_en   timestamptz not null default now(),
  unique (id, empresa_id),
  unique (empresa_id, codigo)
);

-- ============================================================ documentos
-- DOS ejes de estado, para no confundir preparación interna con estado fiscal oficial:
--   estado_preparacion (interno de NEXA):   borrador | revisado | archivado
--   estado_fiscal (refleja lo oficial):     ninguno | pendiente_certificacion | por_verificar | certificado | rechazado
--                                           | anulacion_solicitada | anulado
-- "archivado" es solo interno y solo existe si el documento nunca tuvo vida fiscal; "anulado" es un hecho fiscal.
create table public.documentos (
  id                          uuid primary key default gen_random_uuid(),
  empresa_id                  uuid not null references public.empresas (id),
  tipo_documento              text not null default 'factura' check (tipo_documento in ('factura')),
  estado_preparacion          text not null default 'borrador' check (estado_preparacion in ('borrador','revisado','archivado')),
  estado_fiscal               text not null default 'ninguno' check (estado_fiscal in
                                ('ninguno','pendiente_certificacion','por_verificar','certificado','rechazado','anulacion_solicitada','anulado')),
  numero_borrador             integer not null,         -- número INTERNO del borrador; no es un número fiscal
  cliente_id                  uuid,
  cliente_snapshot            jsonb,
  regimen_id                  uuid references public.regimenes_fiscales (id),
  regimen_snapshot            jsonb,                    -- copia de las reglas vigentes al guardar, para reproducir el cálculo
  moneda                      char(3) not null default 'GTQ' check (moneda = 'GTQ'),
  fecha_emision_prevista      date,
  -- Importes en numeric SIN precisión fija: ningún redondeo implícito. Impuestos y total quedan nulos hasta tener reglas verificadas.
  subtotal                    numeric,
  descuento_total             numeric,
  base_imponible              numeric,
  impuestos                   jsonb,
  total                       numeric,
  calculo                     jsonb,                    -- metadatos: versión del motor, si es oficial y qué está pendiente
  observaciones               text,
  version                     integer not null default 1,
  -- Datos fiscales: vacíos salvo confirmación verificable (ver restricciones).
  serie                       text,
  numero_fiscal               text,
  autorizacion_sat            text,
  certificacion_verificada_en timestamptz,
  anulacion_solicitada_en     timestamptz,
  anulado_en                  timestamptz,
  anulacion_motivo            text,
  creado_por                  uuid references auth.users (id),
  creado_en                   timestamptz not null default now(),
  actualizado_por             uuid references auth.users (id),
  actualizado_en              timestamptz not null default now(),
  unique (id, empresa_id),
  unique (empresa_id, numero_borrador),
  foreign key (cliente_id, empresa_id) references public.clientes (id, empresa_id),
  -- Cualquier avance fiscal exige que el documento esté revisado; archivado solo sin vida fiscal.
  constraint documentos_ejes_chk check (
    (estado_fiscal = 'ninguno' or estado_preparacion = 'revisado')
    and (estado_preparacion <> 'archivado' or estado_fiscal = 'ninguno')
  ),
  -- Serie, número y autorización SOLO con DTE certificado (o su anulación) y verificación registrada.
  constraint documentos_datos_fiscales_chk check (
    (estado_fiscal in ('certificado','anulacion_solicitada','anulado')
       and serie is not null and numero_fiscal is not null and autorizacion_sat is not null and certificacion_verificada_en is not null)
    or
    (estado_fiscal not in ('certificado','anulacion_solicitada','anulado')
       and serie is null and numero_fiscal is null and autorizacion_sat is null and certificacion_verificada_en is null)
  ),
  constraint documentos_anulacion_chk check (
    ((estado_fiscal in ('anulacion_solicitada','anulado')) = (anulacion_solicitada_en is not null))
    and ((estado_fiscal = 'anulado') = (anulado_en is not null))
  )
);

create table public.documento_lineas (
  id              uuid primary key default gen_random_uuid(),
  documento_id    uuid not null,
  empresa_id      uuid not null,
  orden           integer not null check (orden >= 1),
  concepto_id     uuid,
  descripcion     text not null check (length(btrim(descripcion)) between 1 and 300),
  cantidad        numeric not null check (cantidad > 0 and scale(cantidad) <= 6),
  precio_unitario numeric not null check (precio_unitario >= 0 and scale(precio_unitario) <= 6),
  descuento_tipo  text not null default 'ninguno' check (descuento_tipo in ('ninguno','monto','porcentaje')),
  descuento_valor numeric not null default 0 check (descuento_valor >= 0 and scale(descuento_valor) <= 6
                    and (descuento_tipo <> 'porcentaje' or descuento_valor <= 100)),
  importes        jsonb not null default '{}'::jsonb,
  unique (documento_id, orden),
  foreign key (documento_id, empresa_id) references public.documentos (id, empresa_id) on delete cascade,
  foreign key (concepto_id, empresa_id) references public.conceptos (id, empresa_id)
);

create table public.documento_estados (
  id           bigint generated always as identity primary key,
  documento_id uuid not null,
  empresa_id   uuid not null,
  eje          text not null check (eje in ('preparacion','fiscal')),
  anterior     text,
  nuevo        text not null,
  motivo       text,
  user_id      uuid references auth.users (id),
  operacion_id uuid,
  creado_en    timestamptz not null default now(),
  foreign key (documento_id, empresa_id) references public.documentos (id, empresa_id)
);

-- ============================================================ operaciones fiscales: idempotencia y conciliación
-- Una fila por intento de certificación o anulación. Solo puede haber UNA operación abierta por documento
-- (iniciada o desconocida): así no hay dos intentos simultáneos ni reintentos mientras no se concilie el resultado.
create table public.operaciones_fiscales (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null,
  documento_id       uuid not null,
  tipo               text not null check (tipo in ('certificacion','anulacion')),
  clave_idempotencia text not null check (length(clave_idempotencia) between 16 and 80),
  hash_contenido     text not null check (hash_contenido ~ '^[0-9a-f]{64}$'),  -- SHA-256 del contenido enviado
  estado             text not null default 'iniciada' check (estado in ('iniciada','confirmada_exitosa','confirmada_fallida','desconocida')),
  proveedor          text,
  referencia_externa text,
  regla_id           uuid references public.reglas_normativas (id),
  motivo             text,
  iniciada_por       uuid references auth.users (id),
  iniciada_en        timestamptz not null default now(),
  resuelta_por       uuid references auth.users (id),
  resuelta_en        timestamptz,
  resolucion         text check (resolucion in ('proveedor','conciliacion_manual')),
  evidencia          jsonb,
  foreign key (documento_id, empresa_id) references public.documentos (id, empresa_id),
  unique (documento_id, clave_idempotencia),
  check ((estado in ('confirmada_exitosa','confirmada_fallida')) = (resuelta_en is not null and resolucion is not null))
);
create unique index operaciones_abierta_uq on public.operaciones_fiscales (documento_id) where estado in ('iniciada','desconocida');

create table public.contadores_borrador (
  empresa_id uuid primary key references public.empresas (id),
  ultimo     integer not null default 0
);

-- ============================================================ auditoría (solo agregar)
create table public.auditoria (
  id            bigint generated always as identity primary key,
  ocurrido_en   timestamptz not null default now(),
  empresa_id    uuid references public.empresas (id),
  actor_user_id uuid,
  actor_email   text,
  accion        text not null,
  entidad       text not null,
  entidad_id    text,
  datos         jsonb not null default '{}'::jsonb,
  origen        text not null default 'fel-api'
);
create index auditoria_empresa_idx on public.auditoria (empresa_id, ocurrido_en desc);
-- NEXA FEL · Fase 1.0 · funciones, protecciones y operaciones administrativas atómicas.
-- Todas las funciones usan search_path vacío y nombres calificados. Las que escriben solo las puede ejecutar service_role
-- (la Edge Function "fel-api"), y aun así validan al actor por su cuenta (defensa en profundidad).

-- ============================================================ utilidades
create or replace function public.fel__rango(p_rol text) returns integer
language sql immutable set search_path = '' as $$
  select case p_rol when 'propietario' then 4 when 'administrador' then 3 when 'emisor' then 2 when 'lector' then 1 else 0 end
$$;

create or replace function public.fel_es_admin_plataforma() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.plataforma_admins pa where pa.user_id = auth.uid())
     and not exists (select 1 from public.perfiles pf where pf.user_id = auth.uid() and not pf.activo)
$$;

-- Permisos efectivos = permisos del rol + extras - revocados. Solo si la membresía y la empresa están activas/habilitadas.
create or replace function public.fel_permisos_efectivos(p_empresa uuid, p_user uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select array(
      select distinct x.p from (
        select rp.permiso as p from public.rol_permisos rp where rp.rol = m.rol
        union
        select unnest(m.permisos_extra)
      ) x
      where x.p <> all (m.permisos_revocados)
      order by 1)
    from public.miembros m
    join public.empresas e on e.id = m.empresa_id and e.estado = 'habilitada'
    where m.empresa_id = p_empresa and m.user_id = p_user and m.activo
      and not exists (select 1 from public.perfiles pf where pf.user_id = m.user_id and not pf.activo)
  ), '{}'::text[])
$$;

create or replace function public.fel_tiene_permiso(p_empresa uuid, p_permiso text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_permiso = any (public.fel_permisos_efectivos(p_empresa, auth.uid()))
$$;

create or replace function public.fel_es_miembro(p_empresa uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.miembros m
    join public.empresas e on e.id = m.empresa_id and e.estado = 'habilitada'
    where m.empresa_id = p_empresa and m.user_id = auth.uid() and m.activo
      and not exists (select 1 from public.perfiles pf where pf.user_id = m.user_id and not pf.activo))
$$;

-- Auditoría: única vía de escritura. Registra usuario, empresa, acción, fecha y hora (servidor) y datos relevantes.
create or replace function public.fel_auditar(
  p_empresa uuid, p_actor uuid, p_accion text, p_entidad text, p_entidad_id text,
  p_datos jsonb default '{}'::jsonb, p_origen text default 'fel-api') returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_email text;
begin
  select email into v_email from auth.users where id = p_actor;
  insert into public.auditoria (empresa_id, actor_user_id, actor_email, accion, entidad, entidad_id, datos, origen)
  values (p_empresa, p_actor, v_email, p_accion, p_entidad, p_entidad_id, coalesce(p_datos, '{}'::jsonb), p_origen)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.fel_siguiente_borrador(p_empresa uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare v integer;
begin
  insert into public.contadores_borrador (empresa_id, ultimo) values (p_empresa, 1)
  on conflict (empresa_id) do update set ultimo = public.contadores_borrador.ultimo + 1
  returning ultimo into v;
  return v;
end $$;

create or replace function public.fel__exigir_plataforma(p_actor uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_actor is null or not exists (select 1 from public.plataforma_admins where user_id = p_actor)
     or exists (select 1 from public.perfiles where user_id = p_actor and not activo) then
    raise exception 'FEL_NO_AUTORIZADO: solo el administrador maestro puede hacer esto';
  end if;
end $$;

-- ============================================================ protecciones (triggers)
create or replace function public.fel_bloquear_modificacion() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'FEL_APPEND_ONLY: la tabla % solo permite agregar registros', tg_table_name;
end $$;

create trigger auditoria_solo_agregar before update or delete on public.auditoria
  for each row execute function public.fel_bloquear_modificacion();
create trigger auditoria_sin_truncate before truncate on public.auditoria
  for each statement execute function public.fel_bloquear_modificacion();
create trigger doc_estados_solo_agregar before update or delete on public.documento_estados
  for each row execute function public.fel_bloquear_modificacion();
create trigger doc_estados_sin_truncate before truncate on public.documento_estados
  for each statement execute function public.fel_bloquear_modificacion();

-- Tablas con historia fiscal: nunca se vacían (ni con la clave de servicio).
create trigger documentos_sin_truncate before truncate on public.documentos
  for each statement execute function public.fel_bloquear_modificacion();
create trigger doc_lineas_sin_truncate before truncate on public.documento_lineas
  for each statement execute function public.fel_bloquear_modificacion();
create trigger operaciones_sin_truncate before truncate on public.operaciones_fiscales
  for each statement execute function public.fel_bloquear_modificacion();
create trigger operaciones_sin_borrar before delete on public.operaciones_fiscales
  for each row execute function public.fel_bloquear_modificacion();

-- Régimen fiscal: una versión verificada no se puede cambiar; para verificar hay que tener las reglas completas.
create or replace function public.fel_regimen_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.estado <> 'sin_verificar' then
      raise exception 'FEL_REGLA: un régimen verificado u obsoleto no se puede borrar';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if old.estado = 'obsoleto' then
      raise exception 'FEL_REGLA: un régimen obsoleto no se puede modificar';
    end if;
    if old.estado = 'verificado' then
      if new.estado not in ('verificado', 'obsoleto')
         or new.codigo <> old.codigo or new.version <> old.version or new.nombre <> old.nombre
         or new.reglas is distinct from old.reglas or new.fuente is distinct from old.fuente
         or new.vigente_desde is distinct from old.vigente_desde
         or new.verificado_por is distinct from old.verificado_por
         or new.verificado_en is distinct from old.verificado_en then
        raise exception 'FEL_REGLA: un régimen verificado es inmutable; crea una versión nueva';
      end if;
      if new.estado = 'obsoleto' and exists (
           select 1 from public.empresas e where e.regimen_id = old.id and e.emision_real_habilitada) then
        raise exception 'FEL_REGLA: hay empresas con emisión real que usan este régimen';
      end if;
    end if;
  end if;
  if new.estado = 'verificado' and (tg_op = 'INSERT' or old.estado <> 'verificado') then
    if new.verificado_por is null or new.verificado_en is null then
      raise exception 'FEL_REGLA: falta quién y cuándo verificó el régimen';
    end if;
    if new.fuente is null or length(btrim(new.fuente)) < 5 then
      raise exception 'FEL_REGLA: falta la referencia normativa del régimen';
    end if;
    if new.vigente_desde is null then
      raise exception 'FEL_REGLA: falta la fecha de inicio de vigencia';
    end if;
    if coalesce(new.reglas ->> 'esquema', '') <> '1'
       or jsonb_typeof(new.reglas -> 'impuestos') is distinct from 'array'
       or jsonb_typeof(new.reglas -> 'precios_incluyen_impuesto') is distinct from 'boolean'
       or jsonb_typeof(new.reglas -> 'redondeo') is distinct from 'object' then
      raise exception 'FEL_REGLA: las reglas del régimen están incompletas; no se puede verificar';
    end if;
  end if;
  return new;
end $$;

create trigger regimenes_guard before insert or update or delete on public.regimenes_fiscales
  for each row execute function public.fel_regimen_guard();

-- Empresa: la emisión real exige empresa habilitada, régimen verificado y autorización específica.
create or replace function public.fel_empresa_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.actualizado_en := now();
  if new.estado = 'habilitada' and new.regimen_id is null then
    raise exception 'FEL_REGLA: una empresa habilitada necesita un régimen asignado';
  end if;
  if tg_op = 'UPDATE' and old.emision_real_habilitada and new.regimen_id is distinct from old.regimen_id then
    raise exception 'FEL_REGLA: no se puede cambiar el régimen con la emisión real habilitada; deshabilítala primero';
  end if;
  if new.emision_real_habilitada then
    if new.estado <> 'habilitada' then
      raise exception 'FEL_REGLA: la emisión real exige una empresa habilitada';
    end if;
    if not exists (select 1 from public.regimenes_fiscales r where r.id = new.regimen_id and r.estado = 'verificado') then
      raise exception 'FEL_REGLA: el régimen de la empresa no está verificado';
    end if;
    if new.emision_autorizada_por is null or new.emision_autorizada_en is null then
      raise exception 'FEL_REGLA: falta la autorización específica de la emisión real';
    end if;
  end if;
  return new;
end $$;

create trigger empresas_guard before insert or update on public.empresas
  for each row execute function public.fel_empresa_guard();

-- Miembros: siempre debe quedar al menos un propietario activo.
create or replace function public.fel_miembro_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then new.actualizado_en := now(); end if;
  if old.rol = 'propietario' and old.activo
     and (tg_op = 'DELETE' or new.rol <> 'propietario' or not new.activo) then
    if not exists (select 1 from public.miembros m
                   where m.empresa_id = old.empresa_id and m.user_id <> old.user_id and m.rol = 'propietario' and m.activo) then
      raise exception 'FEL_REGLA: la empresa debe conservar al menos un propietario activo';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger miembros_guard before update or delete on public.miembros
  for each row execute function public.fel_miembro_guard();

create or replace function public.fel_tocar_actualizado() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.actualizado_en := now();
  return new;
end $$;

-- ============================================================ documentos: matriz de estados y contenido inmutable
-- Ejes: estado_preparacion (borrador|revisado|archivado) y estado_fiscal (ninguno|pendiente_certificacion|por_verificar|
-- certificado|rechazado|anulacion_solicitada|anulado). Los cambios del eje fiscal solo los hacen las funciones fiscales
-- (marcan la sesión con fel.op_fiscal); un UPDATE directo, aunque sea con service_role, es rechazado.
create or replace function public.fel__transicion_fiscal_valida(p_de text, p_a text) returns boolean
language sql immutable set search_path = '' as $$
  select (p_de, p_a) in (
    ('ninguno','pendiente_certificacion'),
    ('pendiente_certificacion','certificado'), ('pendiente_certificacion','rechazado'), ('pendiente_certificacion','por_verificar'),
    ('por_verificar','certificado'), ('por_verificar','rechazado'),
    ('rechazado','pendiente_certificacion'), ('rechazado','ninguno'),
    ('certificado','anulacion_solicitada'),
    ('anulacion_solicitada','anulado'), ('anulacion_solicitada','certificado'))
$$;

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
  -- identidad inmutable
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
    or new.observaciones is distinct from old.observaciones;
  -- contenido: solo editable como borrador sin vida fiscal. Un DTE certificado jamás se modifica.
  if v_contenido_cambia and not (old.estado_preparacion = 'borrador' and old.estado_fiscal = 'ninguno') then
    raise exception 'FEL_REGLA: el contenido solo se edita en un borrador sin estado fiscal; un documento certificado es inmutable';
  end if;
  -- preparación
  if v_prep_cambia then
    if old.estado_fiscal <> 'ninguno' and not (old.estado_fiscal = 'rechazado' and new.estado_fiscal = 'ninguno') then
      raise exception 'FEL_REGLA: un documento con vida fiscal no cambia su estado de preparación';
    end if;
    if (old.estado_preparacion, new.estado_preparacion) not in
       (('borrador','revisado'), ('revisado','borrador'), ('borrador','archivado'), ('revisado','archivado'), ('archivado','borrador')) then
      raise exception 'FEL_REGLA: transición de preparación no permitida (% → %)', old.estado_preparacion, new.estado_preparacion;
    end if;
  end if;
  -- fiscal
  if v_fiscal_cambia then
    if coalesce(current_setting('fel.op_fiscal', true), '') <> 'on' then
      raise exception 'FEL_REGLA: el estado fiscal solo cambia mediante las operaciones fiscales';
    end if;
    if not public.fel__transicion_fiscal_valida(old.estado_fiscal, new.estado_fiscal) then
      raise exception 'FEL_REGLA: transición fiscal no permitida (% → %)', old.estado_fiscal, new.estado_fiscal;
    end if;
  end if;
  -- datos fiscales: se fijan solo al certificar y luego no cambian jamás
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

create trigger documentos_guard before insert or update or delete on public.documentos
  for each row execute function public.fel_documento_guard();

-- Líneas: solo se tocan mientras el documento es un borrador sin estado fiscal.
create or replace function public.fel_documento_linea_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_doc uuid := case when tg_op = 'DELETE' then old.documento_id else new.documento_id end;
        v_prep text; v_fiscal text;
begin
  select estado_preparacion, estado_fiscal into v_prep, v_fiscal from public.documentos where id = v_doc;
  if v_prep is distinct from 'borrador' or v_fiscal is distinct from 'ninguno' then
    raise exception 'FEL_REGLA: las líneas solo se modifican en un borrador sin estado fiscal';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger doc_lineas_guard before insert or update or delete on public.documento_lineas
  for each row execute function public.fel_documento_linea_guard();

-- Operaciones fiscales: inmutables salvo su resolución; una operación confirmada no se reabre.
create or replace function public.fel_operacion_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.estado <> 'iniciada' then raise exception 'FEL_REGLA: una operación nace en estado iniciada'; end if;
    return new;
  end if;
  if new.id <> old.id or new.empresa_id <> old.empresa_id or new.documento_id <> old.documento_id or new.tipo <> old.tipo
     or new.clave_idempotencia <> old.clave_idempotencia or new.hash_contenido <> old.hash_contenido
     or new.iniciada_en <> old.iniciada_en or new.iniciada_por is distinct from old.iniciada_por then
    raise exception 'FEL_REGLA: los datos de la operación fiscal son inmutables';
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

create trigger operaciones_guard before insert or update on public.operaciones_fiscales
  for each row execute function public.fel_operacion_guard();

-- Reglas normativas versionadas (anulación, etc.): verificada = inmutable. Solo se verifica con estructura completa y plazo soportado.
create or replace function public.fel_regla_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.estado <> 'sin_verificar' then raise exception 'FEL_REGLA: una regla verificada u obsoleta no se borra'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if old.estado = 'obsoleto' then raise exception 'FEL_REGLA: una regla obsoleta no se modifica'; end if;
    if old.estado = 'verificado' and (new.estado not in ('verificado','obsoleto') or new.codigo <> old.codigo
       or new.version <> old.version or new.reglas is distinct from old.reglas or new.fuente is distinct from old.fuente
       or new.vigente_desde is distinct from old.vigente_desde or new.verificado_por is distinct from old.verificado_por
       or new.verificado_en is distinct from old.verificado_en) then
      raise exception 'FEL_REGLA: una regla verificada es inmutable; crea una versión nueva';
    end if;
  end if;
  if new.estado = 'verificado' and (tg_op = 'INSERT' or old.estado <> 'verificado') then
    if new.verificado_por is null or new.verificado_en is null or new.vigente_desde is null
       or new.fuente is null or length(btrim(new.fuente)) < 5 then
      raise exception 'FEL_REGLA: falta responsable, fecha, vigencia o referencia normativa de la regla';
    end if;
    if new.codigo = 'anulacion_dte' then
      if coalesce(new.reglas ->> 'esquema', '') <> '1'
         or jsonb_typeof(new.reglas -> 'requiere_confirmacion_receptor') is distinct from 'boolean'
         or coalesce(new.reglas ->> 'plazo_tipo', '') not in ('sin_plazo', 'dias_calendario')
         or (new.reglas ->> 'plazo_tipo' = 'dias_calendario'
             and (jsonb_typeof(new.reglas -> 'dias') is distinct from 'number' or (new.reglas ->> 'dias')::numeric < 0)) then
        raise exception 'FEL_REGLA: reglas de anulación incompletas o con un plazo aún no soportado (requiere validación manual)';
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger reglas_normativas_guard before insert or update or delete on public.reglas_normativas
  for each row execute function public.fel_regla_guard();

-- Tipos de identificación: un tipo verificado no cambia su patrón ni su código.
create or replace function public.fel_identificacion_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'FEL_REGLA: los tipos de identificación no se borran; se desactivan'; end if;
  if tg_op = 'UPDATE' and old.verificado and
     (new.patron is distinct from old.patron or new.codigo <> old.codigo or not new.verificado
      or new.fuente is distinct from old.fuente) then
    raise exception 'FEL_REGLA: un tipo de identificación verificado es inmutable';
  end if;
  if new.patron is not null then
    begin
      perform '' ~ new.patron;
    exception when others then
      raise exception 'FEL_REGLA: el patrón de identificación no es una expresión regular válida';
    end;
  end if;
  return new;
end $$;

create trigger identificaciones_guard before insert or update or delete on public.identificaciones_tipos
  for each row execute function public.fel_identificacion_guard();

-- Valida tipo y número de identificación. El patrón SOLO se aplica si el tipo fue verificado contra normativa vigente.
create or replace function public.fel_identificacion_validar(p_tipo text, p_numero text) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v public.identificaciones_tipos;
begin
  select * into v from public.identificaciones_tipos where codigo = p_tipo and activo;
  if not found then raise exception 'FEL_REGLA: tipo de identificación no permitido'; end if;
  if p_tipo = 'CF' and p_numero <> 'CF' then raise exception 'FEL_REGLA: el consumidor final se registra como CF'; end if;
  if v.verificado and v.patron is not null and p_numero !~ v.patron then
    raise exception 'FEL_REGLA: el número no cumple el formato del tipo de identificación %', p_tipo;
  end if;
end $$;

create trigger clientes_tocar before update on public.clientes for each row execute function public.fel_tocar_actualizado();
create trigger conceptos_tocar before update on public.conceptos for each row execute function public.fel_tocar_actualizado();
create trigger documentos_tocar before update on public.documentos for each row execute function public.fel_tocar_actualizado();

-- ============================================================ operaciones del administrador maestro (atómicas: dato + auditoría)
create or replace function public.fel_admin_empresa_crear(
  p_actor uuid, p_nombre_comercial text, p_razon_social text, p_nit text, p_regimen_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform public.fel__exigir_plataforma(p_actor);
  if not exists (select 1 from public.regimenes_fiscales where id = p_regimen_id and estado <> 'obsoleto') then
    raise exception 'FEL_NO_ENCONTRADO: el régimen indicado no existe o está obsoleto';
  end if;
  insert into public.empresas (nombre_comercial, razon_social, nit, regimen_id, creado_por)
  values (btrim(p_nombre_comercial), btrim(p_razon_social), upper(btrim(p_nit)), p_regimen_id, p_actor)
  returning id into v_id;
  perform public.fel_auditar(v_id, p_actor, 'empresa.crear', 'empresa', v_id::text,
    jsonb_build_object('nombre_comercial', p_nombre_comercial, 'razon_social', p_razon_social, 'nit', upper(btrim(p_nit)), 'regimen_id', p_regimen_id));
  return v_id;
end $$;

create or replace function public.fel_admin_empresa_estado(
  p_actor uuid, p_empresa uuid, p_estado text, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old public.empresas;
begin
  perform public.fel__exigir_plataforma(p_actor);
  if p_estado not in ('habilitada', 'suspendida') then raise exception 'FEL_REGLA: estado no válido'; end if;
  if p_motivo is null or length(btrim(p_motivo)) < 5 then raise exception 'FEL_REGLA: el motivo es obligatorio (mínimo 5 caracteres)'; end if;
  select * into v_old from public.empresas where id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: empresa no encontrada'; end if;
  if p_estado = 'suspendida' and v_old.emision_real_habilitada then
    update public.empresas set emision_real_habilitada = false, emision_autorizada_por = null, emision_autorizada_en = null where id = p_empresa;
    perform public.fel_auditar(p_empresa, p_actor, 'empresa.emision_deshabilitada', 'empresa', p_empresa::text,
      jsonb_build_object('motivo', 'suspensión de la empresa'));
  end if;
  update public.empresas
     set estado = p_estado,
         habilitada_por = case when p_estado = 'habilitada' then p_actor else habilitada_por end,
         habilitada_en  = case when p_estado = 'habilitada' then now() else habilitada_en end
   where id = p_empresa;
  perform public.fel_auditar(p_empresa, p_actor, 'empresa.' || p_estado, 'empresa', p_empresa::text,
    jsonb_build_object('antes', v_old.estado, 'despues', p_estado, 'motivo', p_motivo));
end $$;

-- Cambio fiscal crítico: régimen de la empresa.
create or replace function public.fel_admin_empresa_regimen(
  p_actor uuid, p_empresa uuid, p_regimen uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old uuid;
begin
  perform public.fel__exigir_plataforma(p_actor);
  if p_motivo is null or length(btrim(p_motivo)) < 5 then raise exception 'FEL_REGLA: el motivo es obligatorio (mínimo 5 caracteres)'; end if;
  if not exists (select 1 from public.regimenes_fiscales where id = p_regimen and estado <> 'obsoleto') then
    raise exception 'FEL_NO_ENCONTRADO: el régimen indicado no existe o está obsoleto';
  end if;
  select regimen_id into v_old from public.empresas where id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: empresa no encontrada'; end if;
  update public.empresas set regimen_id = p_regimen where id = p_empresa;
  perform public.fel_auditar(p_empresa, p_actor, 'empresa.regimen_asignar', 'empresa', p_empresa::text,
    jsonb_build_object('antes', v_old, 'despues', p_regimen, 'motivo', p_motivo));
end $$;

create or replace function public.fel_admin_regimen_crear_version(
  p_actor uuid, p_codigo text, p_nombre text, p_reglas jsonb, p_fuente text, p_vigente_desde date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_ver integer;
begin
  perform public.fel__exigir_plataforma(p_actor);
  select coalesce(max(version), 0) + 1 into v_ver from public.regimenes_fiscales where codigo = p_codigo;
  insert into public.regimenes_fiscales (codigo, version, nombre, reglas, fuente, vigente_desde, creado_por)
  values (p_codigo, v_ver, btrim(p_nombre), coalesce(p_reglas, '{}'::jsonb), p_fuente, p_vigente_desde, p_actor)
  returning id into v_id;
  perform public.fel_auditar(null, p_actor, 'regimen.crear_version', 'regimen', v_id::text,
    jsonb_build_object('codigo', p_codigo, 'version', v_ver, 'reglas', coalesce(p_reglas, '{}'::jsonb), 'fuente', p_fuente));
  return v_id;
end $$;

-- Cambio fiscal crítico: verificar un régimen (el trigger exige reglas completas).
create or replace function public.fel_admin_regimen_verificar(
  p_actor uuid, p_regimen uuid, p_referencia text, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old public.regimenes_fiscales;
begin
  perform public.fel__exigir_plataforma(p_actor);
  if p_motivo is null or length(btrim(p_motivo)) < 5 then raise exception 'FEL_REGLA: el motivo es obligatorio (mínimo 5 caracteres)'; end if;
  select * into v_old from public.regimenes_fiscales where id = p_regimen for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: régimen no encontrado'; end if;
  if v_old.estado <> 'sin_verificar' then raise exception 'FEL_REGLA: solo se verifica un régimen sin verificar'; end if;
  update public.regimenes_fiscales
     set estado = 'verificado', verificado_por = p_actor, verificado_en = now(), fuente = coalesce(nullif(btrim(p_referencia), ''), fuente)
   where id = p_regimen;
  perform public.fel_auditar(null, p_actor, 'regimen.verificar', 'regimen', p_regimen::text,
    jsonb_build_object('codigo', v_old.codigo, 'version', v_old.version, 'reglas', v_old.reglas, 'referencia', p_referencia, 'motivo', p_motivo));
end $$;

-- Cambio fiscal crítico: habilitar/deshabilitar emisión real (en Fase 1 la Edge Function la mantiene bloqueada).
create or replace function public.fel_admin_emision(
  p_actor uuid, p_empresa uuid, p_habilitar boolean, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old boolean;
begin
  perform public.fel__exigir_plataforma(p_actor);
  if p_motivo is null or length(btrim(p_motivo)) < 5 then raise exception 'FEL_REGLA: el motivo es obligatorio (mínimo 5 caracteres)'; end if;
  select emision_real_habilitada into v_old from public.empresas where id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: empresa no encontrada'; end if;
  update public.empresas
     set emision_real_habilitada = p_habilitar,
         emision_autorizada_por = case when p_habilitar then p_actor else null end,
         emision_autorizada_en  = case when p_habilitar then now() else null end
   where id = p_empresa;
  perform public.fel_auditar(p_empresa, p_actor, case when p_habilitar then 'empresa.emision_habilitada' else 'empresa.emision_deshabilitada' end,
    'empresa', p_empresa::text, jsonb_build_object('antes', v_old, 'despues', p_habilitar, 'motivo', p_motivo));
end $$;

create or replace function public.fel_admin_invitar_propietario(p_actor uuid, p_empresa uuid, p_email text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform public.fel__exigir_plataforma(p_actor);
  if not exists (select 1 from public.empresas where id = p_empresa) then raise exception 'FEL_NO_ENCONTRADO: empresa no encontrada'; end if;
  insert into public.invitaciones (empresa_id, email, rol, invitado_por)
  values (p_empresa, lower(btrim(p_email)), 'propietario', p_actor) returning id into v_id;
  perform public.fel_auditar(p_empresa, p_actor, 'invitacion.crear', 'invitacion', v_id::text,
    jsonb_build_object('email', lower(btrim(p_email)), 'rol', 'propietario'));
  return v_id;
end $$;

-- ============================================================ gestión de usuarios de una empresa (jerarquía validada en la base)
create or replace function public.fel__chequear_gestion(
  p_actor uuid, p_empresa uuid, p_rol_objetivo text, p_permisos text[]) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_rol text; v_perm text[];
begin
  select m.rol into v_rol from public.miembros m
    join public.empresas e on e.id = m.empresa_id and e.estado = 'habilitada'
   where m.empresa_id = p_empresa and m.user_id = p_actor and m.activo;
  v_perm := public.fel_permisos_efectivos(p_empresa, p_actor);
  if v_rol is null or not ('usuarios.gestionar' = any (v_perm)) then
    raise exception 'FEL_NO_AUTORIZADO: no puedes gestionar usuarios de esta empresa';
  end if;
  if p_rol_objetivo is not null and v_rol <> 'propietario'
     and public.fel__rango(p_rol_objetivo) >= public.fel__rango(v_rol) then
    raise exception 'FEL_NO_AUTORIZADO: no puedes asignar ese rol';
  end if;
  if p_permisos is not null then
    if exists (select 1 from unnest(p_permisos) x where not exists (select 1 from public.permisos_catalogo c where c.codigo = x)) then
      raise exception 'FEL_REGLA: hay permisos que no existen';
    end if;
    if exists (select 1 from unnest(p_permisos) x where x <> all (v_perm)) then
      raise exception 'FEL_NO_AUTORIZADO: no puedes conceder permisos que tú no tienes';
    end if;
  end if;
  return v_rol;
end $$;

create or replace function public.fel_op_invitacion_registrar(
  p_actor uuid, p_empresa uuid, p_email text, p_rol text, p_permisos_extra text[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_email text := lower(btrim(p_email));
begin
  perform public.fel__chequear_gestion(p_actor, p_empresa, p_rol, p_permisos_extra);
  insert into public.invitaciones (empresa_id, email, rol, permisos_extra, invitado_por)
  values (p_empresa, v_email, p_rol, coalesce(p_permisos_extra, '{}'), p_actor) returning id into v_id;
  perform public.fel_auditar(p_empresa, p_actor, 'invitacion.crear', 'invitacion', v_id::text,
    jsonb_build_object('email', v_email, 'rol', p_rol, 'permisos_extra', coalesce(p_permisos_extra, '{}')));
  return v_id;
end $$;

create or replace function public.fel_op_invitacion_revocar(p_actor uuid, p_empresa uuid, p_invitacion uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.invitaciones;
begin
  perform public.fel__chequear_gestion(p_actor, p_empresa, null, null);
  select * into v from public.invitaciones where id = p_invitacion and empresa_id = p_empresa and estado = 'pendiente' for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: invitación pendiente no encontrada'; end if;
  update public.invitaciones set estado = 'revocada' where id = p_invitacion;
  perform public.fel_auditar(p_empresa, p_actor, 'invitacion.revocar', 'invitacion', p_invitacion::text, jsonb_build_object('email', v.email));
end $$;

-- La persona ya inició sesión (invitación nativa de Supabase Auth): se convierten sus invitaciones vigentes en membresías.
create or replace function public.fel_op_invitacion_aceptar(p_user uuid, p_email text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v public.invitaciones; n integer := 0; v_email text := lower(btrim(p_email));
begin
  update public.invitaciones set estado = 'vencida' where email = v_email and estado = 'pendiente' and expira_en <= now();
  insert into public.perfiles (user_id) values (p_user) on conflict (user_id) do nothing;
  for v in select * from public.invitaciones where email = v_email and estado = 'pendiente' and expira_en > now() for update loop
    insert into public.miembros (empresa_id, user_id, rol, permisos_extra, invitado_por)
    values (v.empresa_id, p_user, v.rol, v.permisos_extra, v.invitado_por)
    on conflict (empresa_id, user_id) do update
      set rol = excluded.rol, permisos_extra = excluded.permisos_extra, permisos_revocados = '{}', activo = true;
    update public.invitaciones set estado = 'aceptada', aceptada_en = now(), user_id = p_user where id = v.id;
    perform public.fel_auditar(v.empresa_id, p_user, 'invitacion.aceptar', 'invitacion', v.id::text,
      jsonb_build_object('rol', v.rol, 'email', v_email));
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.fel_op_miembro_actualizar(
  p_actor uuid, p_empresa uuid, p_user uuid,
  p_rol text default null, p_permisos_extra text[] default null,
  p_permisos_revocados text[] default null, p_activo boolean default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_obj public.miembros; v_actor_rol text;
begin
  if p_user = p_actor then raise exception 'FEL_NO_AUTORIZADO: no puedes modificar tu propia membresía'; end if;
  select * into v_obj from public.miembros where empresa_id = p_empresa and user_id = p_user for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: miembro no encontrado'; end if;
  v_actor_rol := public.fel__chequear_gestion(p_actor, p_empresa, coalesce(p_rol, v_obj.rol), p_permisos_extra);
  if v_actor_rol <> 'propietario' and public.fel__rango(v_obj.rol) >= public.fel__rango(v_actor_rol) then
    raise exception 'FEL_NO_AUTORIZADO: no puedes modificar a un usuario de rol igual o superior';
  end if;
  if p_permisos_revocados is not null and exists (
       select 1 from unnest(p_permisos_revocados) x where not exists (select 1 from public.permisos_catalogo c where c.codigo = x)) then
    raise exception 'FEL_REGLA: hay permisos que no existen';
  end if;
  update public.miembros
     set rol = coalesce(p_rol, rol),
         permisos_extra = coalesce(p_permisos_extra, permisos_extra),
         permisos_revocados = coalesce(p_permisos_revocados, permisos_revocados),
         activo = coalesce(p_activo, activo)
   where empresa_id = p_empresa and user_id = p_user;
  perform public.fel_auditar(p_empresa, p_actor, 'miembro.actualizar', 'miembro', p_user::text,
    jsonb_build_object(
      'antes', jsonb_build_object('rol', v_obj.rol, 'permisos_extra', v_obj.permisos_extra, 'permisos_revocados', v_obj.permisos_revocados, 'activo', v_obj.activo),
      'despues', jsonb_build_object('rol', coalesce(p_rol, v_obj.rol), 'permisos_extra', coalesce(p_permisos_extra, v_obj.permisos_extra),
                                    'permisos_revocados', coalesce(p_permisos_revocados, v_obj.permisos_revocados), 'activo', coalesce(p_activo, v_obj.activo))));
end $$;
-- NEXA FEL · Fase 1.0 · RLS, permisos de la base y datos iniciales.
-- Principio: la app (rol authenticated) SOLO LEE, y solo lo que le corresponde. Toda escritura pasa por la Edge Function "fel-api".
-- Las tablas de negocio no se exponen al administrador maestro: él administra empresas y regímenes, no los datos fiscales de los clientes.

-- ============================================================ RLS en TODAS las tablas
alter table public.permisos_catalogo   enable row level security;
alter table public.rol_permisos        enable row level security;
alter table public.plataforma_admins   enable row level security;
alter table public.perfiles            enable row level security;
alter table public.regimenes_fiscales  enable row level security;
alter table public.empresas            enable row level security;
alter table public.miembros            enable row level security;
alter table public.invitaciones        enable row level security;
alter table public.clientes            enable row level security;
alter table public.conceptos           enable row level security;
alter table public.documentos          enable row level security;
alter table public.documento_lineas    enable row level security;
alter table public.documento_estados   enable row level security;
alter table public.contadores_borrador enable row level security;
alter table public.auditoria           enable row level security;
alter table public.identificaciones_tipos enable row level security;
alter table public.reglas_normativas   enable row level security;
alter table public.operaciones_fiscales enable row level security;

-- ============================================================ permisos de tabla: nada para anon; lectura puntual para authenticated
revoke all on all tables    in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant select on public.permisos_catalogo, public.rol_permisos, public.plataforma_admins, public.perfiles,
                public.regimenes_fiscales, public.empresas, public.miembros, public.invitaciones,
                public.clientes, public.conceptos, public.documentos, public.documento_lineas,
                public.documento_estados, public.auditoria, public.identificaciones_tipos, public.reglas_normativas,
                public.operaciones_fiscales
  to authenticated;
-- contadores_borrador: sin acceso para authenticated (solo la función de servicio).

-- Objetos nuevos que se creen después NO quedan abiertos por defecto.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- Las políticas de RLS llaman a estas funciones con los permisos de quien consulta.
grant execute on function public.fel_es_admin_plataforma() to authenticated;
grant execute on function public.fel_es_miembro(uuid)      to authenticated;
grant execute on function public.fel_tiene_permiso(uuid, text) to authenticated;

-- Funciones de escritura y de servicio: solo service_role.
grant execute on all functions in schema public to service_role;
revoke execute on function public.fel_es_admin_plataforma(), public.fel_es_miembro(uuid), public.fel_tiene_permiso(uuid, text) from anon;

-- La auditoría no se puede modificar ni borrar ni con la clave de servicio.
revoke update, delete, truncate on public.auditoria from service_role;
revoke update, delete, truncate on public.documento_estados from service_role;
-- Documentos y operaciones fiscales: nunca se borran (ni con la clave de servicio). Se modifican solo con las funciones.
revoke delete, truncate on public.documentos, public.documento_lineas, public.operaciones_fiscales from service_role;

-- ============================================================ políticas (solo SELECT; sin políticas de escritura)
create policy permisos_catalogo_leer on public.permisos_catalogo for select to authenticated using (true);
create policy rol_permisos_leer      on public.rol_permisos      for select to authenticated using (true);

create policy plataforma_admins_leer on public.plataforma_admins for select to authenticated
  using (public.fel_es_admin_plataforma());

create policy perfiles_leer on public.perfiles for select to authenticated
  using (
    user_id = auth.uid()
    or public.fel_es_admin_plataforma()
    or exists (
      select 1 from public.miembros mi
      where mi.user_id = perfiles.user_id and public.fel_tiene_permiso(mi.empresa_id, 'usuarios.ver'))
  );

-- Régimen: lo verificado lo ve cualquier usuario; lo no verificado, el maestro y los miembros de la empresa que lo usa.
create policy regimenes_leer on public.regimenes_fiscales for select to authenticated
  using (
    estado = 'verificado'
    or public.fel_es_admin_plataforma()
    or exists (select 1 from public.empresas e where e.regimen_id = regimenes_fiscales.id and public.fel_es_miembro(e.id))
  );

create policy empresas_leer on public.empresas for select to authenticated
  using (public.fel_es_admin_plataforma() or public.fel_es_miembro(id));

create policy miembros_leer on public.miembros for select to authenticated
  using (
    user_id = auth.uid()
    or public.fel_es_admin_plataforma()
    or public.fel_tiene_permiso(empresa_id, 'usuarios.ver')
  );

create policy invitaciones_leer on public.invitaciones for select to authenticated
  using (public.fel_es_admin_plataforma() or public.fel_tiene_permiso(empresa_id, 'usuarios.gestionar'));

create policy clientes_leer  on public.clientes  for select to authenticated using (public.fel_tiene_permiso(empresa_id, 'clientes.ver'));
create policy conceptos_leer on public.conceptos for select to authenticated using (public.fel_tiene_permiso(empresa_id, 'conceptos.ver'));
create policy documentos_leer on public.documentos for select to authenticated using (public.fel_tiene_permiso(empresa_id, 'borradores.ver'));
create policy doc_lineas_leer on public.documento_lineas for select to authenticated using (public.fel_tiene_permiso(empresa_id, 'borradores.ver'));
create policy doc_estados_leer on public.documento_estados for select to authenticated using (public.fel_tiene_permiso(empresa_id, 'historial.ver'));

create policy identificaciones_leer on public.identificaciones_tipos for select to authenticated using (true);
create policy reglas_normativas_leer on public.reglas_normativas for select to authenticated
  using (estado = 'verificado' or public.fel_es_admin_plataforma());
create policy operaciones_leer on public.operaciones_fiscales for select to authenticated
  using (public.fel_tiene_permiso(empresa_id, 'historial.ver'));

-- Auditoría: la empresa ve la suya con 'auditoria.ver'; el maestro ve solo eventos administrativos, no datos de negocio.
create policy auditoria_leer on public.auditoria for select to authenticated
  using (
    (empresa_id is not null and public.fel_tiene_permiso(empresa_id, 'auditoria.ver'))
    or (public.fel_es_admin_plataforma()
        and entidad in ('empresa', 'regimen', 'miembro', 'invitacion', 'plataforma'))
  );

-- ============================================================ datos iniciales
insert into public.permisos_catalogo (codigo, descripcion) values
  ('empresa.ver',          'Ver los datos de la empresa'),
  ('usuarios.ver',         'Ver los usuarios de la empresa'),
  ('usuarios.gestionar',   'Invitar, cambiar rol o permisos y desactivar usuarios'),
  ('clientes.ver',         'Ver clientes'),
  ('clientes.escribir',    'Crear y editar clientes'),
  ('conceptos.ver',        'Ver conceptos'),
  ('conceptos.escribir',   'Crear y editar conceptos'),
  ('borradores.ver',       'Ver borradores'),
  ('borradores.crear',     'Crear borradores'),
  ('borradores.editar',    'Editar borradores'),
  ('borradores.revisar',   'Marcar borradores como revisados'),
  ('borradores.archivar',  'Archivar borradores'),
  ('historial.ver',        'Ver el historial de estados de un documento'),
  ('auditoria.ver',        'Ver la auditoría de la empresa'),
  ('fiscal.ver',           'Ver la configuración fiscal de la empresa'),
  ('fiscal.certificar',    'Iniciar la certificación de un documento (bloqueado hasta autorizar la emisión real)'),
  ('fiscal.anular',        'Solicitar la anulación de un DTE certificado (bloqueado hasta autorizar la emisión real)'),
  ('fiscal.conciliar',     'Conciliar manualmente una operación fiscal de resultado desconocido');

insert into public.rol_permisos (rol, permiso)
select 'propietario', codigo from public.permisos_catalogo;

insert into public.rol_permisos (rol, permiso)
select 'administrador', codigo from public.permisos_catalogo;

insert into public.rol_permisos (rol, permiso) values
  ('emisor', 'empresa.ver'), ('emisor', 'clientes.ver'), ('emisor', 'clientes.escribir'),
  ('emisor', 'conceptos.ver'), ('emisor', 'conceptos.escribir'),
  ('emisor', 'borradores.ver'), ('emisor', 'borradores.crear'), ('emisor', 'borradores.editar'),
  ('emisor', 'historial.ver'), ('emisor', 'fiscal.ver'),
  ('lector', 'empresa.ver'), ('lector', 'clientes.ver'), ('lector', 'conceptos.ver'),
  ('lector', 'borradores.ver'), ('lector', 'historial.ver'), ('lector', 'fiscal.ver');

-- Regímenes: SOLO la estructura. Sin tasas ni reglas hasta que las valide tu contador.
insert into public.regimenes_fiscales (codigo, version, nombre, estado, reglas, fuente) values
  ('general', 1, 'Régimen General', 'sin_verificar',
   '{"esquema":1,"pendiente_de_validacion":true,"nota":"Sin tasas ni reglas. Completar y verificar antes de usar."}'::jsonb, null),
  ('pequeno_contribuyente', 1, 'Pequeño Contribuyente', 'sin_verificar',
   '{"esquema":1,"pendiente_de_validacion":true,"nota":"Sin tasas ni reglas. Completar y verificar antes de usar."}'::jsonb, null);

-- Identificaciones del comprador: SIN patrón y SIN verificar. El formato oficial lo fija el administrador maestro con respaldo normativo.
insert into public.identificaciones_tipos (codigo, nombre, notas) values
  ('NIT', 'Número de Identificación Tributaria', 'Pendiente de validar el formato y la regla vigente de SAT.'),
  ('CUI', 'Código Único de Identificación (DPI)', 'Pendiente de validar si SAT lo admite como identificador del comprador y su formato vigente.'),
  ('CF',  'Consumidor final', 'Se registra siempre como CF. Pendiente de validar topes y condiciones vigentes de SAT.'),
  ('EXT', 'Identificación de extranjero / otro', 'Pendiente de validar los identificadores admitidos por SAT (pasaporte u otros).');

-- Reglas de anulación de DTE: estructura y versión, SIN plazos ni condiciones hasta que se validen documentalmente.
insert into public.reglas_normativas (codigo, version, nombre, estado, reglas, fuente) values
  ('anulacion_dte', 1, 'Anulación de DTE', 'sin_verificar',
   '{"esquema":1,"pendiente_de_validacion":true,"nota":"Sin plazo ni condiciones. Completar y verificar antes de permitir anulaciones."}'::jsonb, null);
-- NEXA FEL · Fase 1.0 · escritura atómica de clientes y conceptos (dato + auditoría en una sola transacción).
-- Cada función valida el permiso del actor por su cuenta, aunque la llame la Edge Function con service_role.

create or replace function public.fel__exigir_permiso(p_actor uuid, p_empresa uuid, p_permiso text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_actor is null or not (p_permiso = any (public.fel_permisos_efectivos(p_empresa, p_actor))) then
    raise exception 'FEL_NO_AUTORIZADO: no tienes permiso para esta operación';
  end if;
end $$;

-- ---------------------------------------------------------------- clientes
create or replace function public.fel_op_cliente_guardar(
  p_actor uuid, p_empresa uuid, p_id uuid, p_tipo_identificacion text, p_numero_identificacion text, p_nombre text,
  p_direccion text, p_email text, p_telefono text, p_version integer) returns public.clientes
language plpgsql security definer set search_path = '' as $$
declare v_old public.clientes; v_new public.clientes;
        v_tipo text := upper(btrim(p_tipo_identificacion));
        v_num  text := case when upper(btrim(p_tipo_identificacion)) = 'CF' then 'CF' else upper(btrim(p_numero_identificacion)) end;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'clientes.escribir');
  perform public.fel_identificacion_validar(v_tipo, v_num);
  if p_id is null then
    insert into public.clientes (empresa_id, tipo_identificacion, numero_identificacion, nombre, direccion, email, telefono, creado_por, actualizado_por)
    values (p_empresa, v_tipo, v_num, btrim(p_nombre), nullif(btrim(p_direccion), ''), nullif(btrim(p_email), ''), nullif(btrim(p_telefono), ''), p_actor, p_actor)
    returning * into v_new;
    perform public.fel_auditar(p_empresa, p_actor, 'cliente.crear', 'cliente', v_new.id::text,
      jsonb_build_object('tipo_identificacion', v_new.tipo_identificacion, 'numero_identificacion', v_new.numero_identificacion, 'nombre', v_new.nombre));
  else
    select * into v_old from public.clientes where id = p_id and empresa_id = p_empresa for update;
    if not found then raise exception 'FEL_NO_ENCONTRADO: cliente no encontrado'; end if;
    if p_version is null or p_version <> v_old.version then
      raise exception 'FEL_CONFLICTO: el cliente cambió mientras lo editabas; recarga e intenta de nuevo';
    end if;
    update public.clientes
       set tipo_identificacion = v_tipo, numero_identificacion = v_num, nombre = btrim(p_nombre), direccion = nullif(btrim(p_direccion), ''),
           email = nullif(btrim(p_email), ''), telefono = nullif(btrim(p_telefono), ''),
           version = version + 1, actualizado_por = p_actor
     where id = p_id and empresa_id = p_empresa returning * into v_new;
    perform public.fel_auditar(p_empresa, p_actor, 'cliente.editar', 'cliente', p_id::text,
      jsonb_build_object('antes', jsonb_build_object('tipo_identificacion', v_old.tipo_identificacion, 'numero_identificacion', v_old.numero_identificacion, 'nombre', v_old.nombre, 'direccion', v_old.direccion, 'email', v_old.email, 'telefono', v_old.telefono),
                         'despues', jsonb_build_object('tipo_identificacion', v_new.tipo_identificacion, 'numero_identificacion', v_new.numero_identificacion, 'nombre', v_new.nombre, 'direccion', v_new.direccion, 'email', v_new.email, 'telefono', v_new.telefono)));
  end if;
  return v_new;
end $$;

create or replace function public.fel_op_cliente_estado(p_actor uuid, p_empresa uuid, p_id uuid, p_activo boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old public.clientes;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'clientes.escribir');
  select * into v_old from public.clientes where id = p_id and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: cliente no encontrado'; end if;
  update public.clientes set activo = p_activo, version = version + 1, actualizado_por = p_actor where id = p_id and empresa_id = p_empresa;
  perform public.fel_auditar(p_empresa, p_actor, case when p_activo then 'cliente.reactivar' else 'cliente.baja' end, 'cliente', p_id::text,
    jsonb_build_object('tipo_identificacion', v_old.tipo_identificacion, 'numero_identificacion', v_old.numero_identificacion, 'nombre', v_old.nombre));
end $$;

-- ---------------------------------------------------------------- conceptos
create or replace function public.fel_op_concepto_guardar(
  p_actor uuid, p_empresa uuid, p_id uuid, p_codigo text, p_descripcion text, p_tipo text,
  p_unidad_medida text, p_precio_unitario numeric, p_categoria_fiscal text, p_version integer) returns public.conceptos
language plpgsql security definer set search_path = '' as $$
declare v_old public.conceptos; v_new public.conceptos;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'conceptos.escribir');
  if p_id is null then
    insert into public.conceptos (empresa_id, codigo, descripcion, tipo, unidad_medida, precio_unitario, categoria_fiscal, creado_por, actualizado_por)
    values (p_empresa, btrim(p_codigo), btrim(p_descripcion), p_tipo, coalesce(nullif(btrim(p_unidad_medida), ''), 'UND'),
            p_precio_unitario, nullif(btrim(p_categoria_fiscal), ''), p_actor, p_actor)
    returning * into v_new;
    perform public.fel_auditar(p_empresa, p_actor, 'concepto.crear', 'concepto', v_new.id::text,
      jsonb_build_object('codigo', v_new.codigo, 'descripcion', v_new.descripcion, 'precio_unitario', v_new.precio_unitario));
  else
    select * into v_old from public.conceptos where id = p_id and empresa_id = p_empresa for update;
    if not found then raise exception 'FEL_NO_ENCONTRADO: concepto no encontrado'; end if;
    if p_version is null or p_version <> v_old.version then
      raise exception 'FEL_CONFLICTO: el concepto cambió mientras lo editabas; recarga e intenta de nuevo';
    end if;
    update public.conceptos
       set codigo = btrim(p_codigo), descripcion = btrim(p_descripcion), tipo = p_tipo,
           unidad_medida = coalesce(nullif(btrim(p_unidad_medida), ''), 'UND'), precio_unitario = p_precio_unitario,
           categoria_fiscal = nullif(btrim(p_categoria_fiscal), ''), version = version + 1, actualizado_por = p_actor
     where id = p_id and empresa_id = p_empresa returning * into v_new;
    perform public.fel_auditar(p_empresa, p_actor, 'concepto.editar', 'concepto', p_id::text,
      jsonb_build_object('antes', jsonb_build_object('codigo', v_old.codigo, 'descripcion', v_old.descripcion, 'tipo', v_old.tipo, 'precio_unitario', v_old.precio_unitario, 'categoria_fiscal', v_old.categoria_fiscal),
                         'despues', jsonb_build_object('codigo', v_new.codigo, 'descripcion', v_new.descripcion, 'tipo', v_new.tipo, 'precio_unitario', v_new.precio_unitario, 'categoria_fiscal', v_new.categoria_fiscal)));
  end if;
  return v_new;
end $$;

create or replace function public.fel_op_concepto_estado(p_actor uuid, p_empresa uuid, p_id uuid, p_activo boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old public.conceptos;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'conceptos.escribir');
  select * into v_old from public.conceptos where id = p_id and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: concepto no encontrado'; end if;
  update public.conceptos set activo = p_activo, version = version + 1, actualizado_por = p_actor where id = p_id and empresa_id = p_empresa;
  perform public.fel_auditar(p_empresa, p_actor, case when p_activo then 'concepto.reactivar' else 'concepto.baja' end, 'concepto', p_id::text,
    jsonb_build_object('codigo', v_old.codigo, 'descripcion', v_old.descripcion));
end $$;

-- Estas funciones nuevas heredan el cierre por defecto (solo service_role las ejecuta).
revoke all on function public.fel__exigir_permiso(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.fel_op_cliente_guardar(uuid, uuid, uuid, text, text, text, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.fel_op_cliente_estado(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.fel_op_concepto_guardar(uuid, uuid, uuid, text, text, text, text, numeric, text, integer) from public, anon, authenticated;
revoke all on function public.fel_op_concepto_estado(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.fel__exigir_permiso(uuid, uuid, text) to service_role;
grant execute on function public.fel_op_cliente_guardar(uuid, uuid, uuid, text, text, text, text, text, text, integer) to service_role;
grant execute on function public.fel_op_cliente_estado(uuid, uuid, uuid, boolean) to service_role;
grant execute on function public.fel_op_concepto_guardar(uuid, uuid, uuid, text, text, text, text, numeric, text, integer) to service_role;
grant execute on function public.fel_op_concepto_estado(uuid, uuid, uuid, boolean) to service_role;
-- NEXA FEL · Fase 1.0 · documentos (borradores), operaciones fiscales con idempotencia y conciliación, anulación con reglas versionadas.
-- Las funciones fiscales (certificación/anulación) existen y están probadas, pero la Edge Function NO las expone en Fase 1:
-- además exigen empresa con emisión real habilitada (que a su vez exige régimen verificado y autorización específica).

-- ---------------------------------------------------------------- borradores
create or replace function public.fel__documento_lineas(p_doc uuid, p_empresa uuid, p_lineas jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if jsonb_typeof(p_lineas) is distinct from 'array' then raise exception 'FEL_REGLA: las líneas deben ser una lista'; end if;
  delete from public.documento_lineas where documento_id = p_doc and empresa_id = p_empresa;
  insert into public.documento_lineas (documento_id, empresa_id, orden, concepto_id, descripcion, cantidad, precio_unitario,
                                       descuento_tipo, descuento_valor, importes)
  select p_doc, p_empresa, x.orden, x.concepto_id, x.descripcion, x.cantidad, x.precio_unitario,
         coalesce(x.descuento_tipo, 'ninguno'), coalesce(x.descuento_valor, 0), coalesce(x.importes, '{}'::jsonb)
    from jsonb_to_recordset(p_lineas) as x(orden integer, concepto_id uuid, descripcion text, cantidad numeric,
         precio_unitario numeric, descuento_tipo text, descuento_valor numeric, importes jsonb);
end $$;

create or replace function public.fel__documento_datos(p_empresa uuid, p_cliente uuid, out v_snap jsonb, out v_reg uuid, out v_regsnap jsonb)
language plpgsql security definer set search_path = '' as $$
declare c public.clientes; r public.regimenes_fiscales;
begin
  if p_cliente is not null then
    select * into c from public.clientes where id = p_cliente and empresa_id = p_empresa and activo;
    if not found then raise exception 'FEL_NO_ENCONTRADO: cliente no encontrado o inactivo'; end if;
    v_snap := jsonb_build_object('id', c.id, 'tipo_identificacion', c.tipo_identificacion, 'numero_identificacion', c.numero_identificacion,
                                 'nombre', c.nombre, 'direccion', c.direccion, 'email', c.email);
  end if;
  select r2.* into r from public.empresas e join public.regimenes_fiscales r2 on r2.id = e.regimen_id where e.id = p_empresa;
  if found then
    v_reg := r.id;
    v_regsnap := jsonb_build_object('codigo', r.codigo, 'version', r.version, 'estado', r.estado, 'reglas', r.reglas);
  end if;
end $$;

create or replace function public.fel_op_documento_guardar(
  p_actor uuid, p_empresa uuid, p_id uuid, p_cliente uuid, p_fecha date, p_observaciones text, p_lineas jsonb,
  p_subtotal numeric, p_descuento_total numeric, p_base numeric, p_calculo jsonb, p_version integer) returns public.documentos
language plpgsql security definer set search_path = '' as $$
declare v_old public.documentos; v_new public.documentos; d record;
begin
  if p_id is null then
    perform public.fel__exigir_permiso(p_actor, p_empresa, 'borradores.crear');
    select * into d from public.fel__documento_datos(p_empresa, p_cliente);
    insert into public.documentos (empresa_id, numero_borrador, cliente_id, cliente_snapshot, regimen_id, regimen_snapshot,
                                   fecha_emision_prevista, observaciones, subtotal, descuento_total, base_imponible, calculo,
                                   creado_por, actualizado_por)
    values (p_empresa, public.fel_siguiente_borrador(p_empresa), p_cliente, d.v_snap, d.v_reg, d.v_regsnap,
            p_fecha, nullif(btrim(p_observaciones), ''), p_subtotal, p_descuento_total, p_base, p_calculo, p_actor, p_actor)
    returning * into v_new;
    perform public.fel__documento_lineas(v_new.id, p_empresa, p_lineas);
    perform public.fel_auditar(p_empresa, p_actor, 'documento.crear_borrador', 'documento', v_new.id::text,
      jsonb_build_object('numero_borrador', v_new.numero_borrador));
  else
    perform public.fel__exigir_permiso(p_actor, p_empresa, 'borradores.editar');
    select * into v_old from public.documentos where id = p_id and empresa_id = p_empresa for update;
    if not found then raise exception 'FEL_NO_ENCONTRADO: documento no encontrado'; end if;
    if p_version is null or p_version <> v_old.version then
      raise exception 'FEL_CONFLICTO: el documento cambió mientras lo editabas; recarga e intenta de nuevo';
    end if;
    if v_old.estado_preparacion <> 'borrador' or v_old.estado_fiscal <> 'ninguno' then
      raise exception 'FEL_REGLA: solo se edita un borrador sin estado fiscal';
    end if;
    select * into d from public.fel__documento_datos(p_empresa, p_cliente);
    update public.documentos
       set cliente_id = p_cliente, cliente_snapshot = d.v_snap, regimen_id = d.v_reg, regimen_snapshot = d.v_regsnap,
           fecha_emision_prevista = p_fecha, observaciones = nullif(btrim(p_observaciones), ''),
           subtotal = p_subtotal, descuento_total = p_descuento_total, base_imponible = p_base, calculo = p_calculo,
           version = version + 1, actualizado_por = p_actor
     where id = p_id and empresa_id = p_empresa returning * into v_new;
    perform public.fel__documento_lineas(p_id, p_empresa, p_lineas);
    perform public.fel_auditar(p_empresa, p_actor, 'documento.editar_borrador', 'documento', p_id::text,
      jsonb_build_object('numero_borrador', v_new.numero_borrador, 'version', v_new.version));
  end if;
  return v_new;
end $$;

-- Cambios del eje de PREPARACIÓN (interno). Nunca toca el eje fiscal.
create or replace function public.fel_op_documento_preparacion(
  p_actor uuid, p_empresa uuid, p_id uuid, p_nuevo text, p_motivo text, p_version integer) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.documentos;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa,
    case p_nuevo when 'revisado' then 'borradores.revisar' when 'archivado' then 'borradores.archivar' else 'borradores.editar' end);
  select * into v from public.documentos where id = p_id and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: documento no encontrado'; end if;
  if p_version is null or p_version <> v.version then raise exception 'FEL_CONFLICTO: el documento cambió; recarga e intenta de nuevo'; end if;
  if v.estado_fiscal <> 'ninguno' then raise exception 'FEL_REGLA: un documento con vida fiscal no cambia su estado de preparación'; end if;
  if p_nuevo = 'revisado' and (v.cliente_id is null or not exists (select 1 from public.documento_lineas where documento_id = p_id)) then
    raise exception 'FEL_REGLA: para revisar hace falta cliente y al menos una línea';
  end if;
  if p_nuevo = 'archivado' and (p_motivo is null or length(btrim(p_motivo)) < 5) then
    raise exception 'FEL_REGLA: el motivo es obligatorio (mínimo 5 caracteres)';
  end if;
  update public.documentos set estado_preparacion = p_nuevo, version = version + 1, actualizado_por = p_actor where id = p_id;
  insert into public.documento_estados (documento_id, empresa_id, eje, anterior, nuevo, motivo, user_id)
  values (p_id, p_empresa, 'preparacion', v.estado_preparacion, p_nuevo, nullif(btrim(p_motivo), ''), p_actor);
  perform public.fel_auditar(p_empresa, p_actor, 'documento.preparacion', 'documento', p_id::text,
    jsonb_build_object('antes', v.estado_preparacion, 'despues', p_nuevo, 'motivo', p_motivo));
end $$;

-- ---------------------------------------------------------------- operaciones fiscales (NO expuestas por la API en Fase 1)
create or replace function public.fel__fiscal_cambiar(
  p_doc uuid, p_empresa uuid, p_estado text, p_actor uuid, p_op uuid, p_motivo text,
  p_serie text default null, p_numero text default null, p_autorizacion text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ant text;
begin
  select estado_fiscal into v_ant from public.documentos where id = p_doc and empresa_id = p_empresa;
  -- una sola sentencia: estado y datos fiscales cambian juntos (las restricciones de la tabla lo exigen)
  perform set_config('fel.op_fiscal', 'on', true);
  update public.documentos
     set estado_fiscal = p_estado, actualizado_por = p_actor, version = version + 1,
         serie = coalesce(p_serie, serie), numero_fiscal = coalesce(p_numero, numero_fiscal),
         autorizacion_sat = coalesce(p_autorizacion, autorizacion_sat),
         certificacion_verificada_en = case when p_estado = 'certificado' and v_ant <> 'anulacion_solicitada' then now() else certificacion_verificada_en end,
         anulacion_solicitada_en = case p_estado when 'anulacion_solicitada' then now() when 'certificado' then null else anulacion_solicitada_en end,
         anulacion_motivo = case p_estado when 'anulacion_solicitada' then p_motivo when 'certificado' then null else anulacion_motivo end,
         anulado_en = case p_estado when 'anulado' then now() else anulado_en end
   where id = p_doc and empresa_id = p_empresa;
  perform set_config('fel.op_fiscal', 'off', true);
  insert into public.documento_estados (documento_id, empresa_id, eje, anterior, nuevo, motivo, user_id, operacion_id)
  values (p_doc, p_empresa, 'fiscal', v_ant, p_estado, p_motivo, p_actor, p_op);
end $$;

create or replace function public.fel__emision_real_activa(p_empresa uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.empresas e join public.regimenes_fiscales r on r.id = e.regimen_id
                  where e.id = p_empresa and e.estado = 'habilitada' and e.emision_real_habilitada and r.estado = 'verificado') then
    raise exception 'FEL_EMISION_BLOQUEADA: la emisión real no está habilitada para esta empresa';
  end if;
end $$;

-- Inicia una certificación. Idempotente por (documento, clave): repetir la misma clave devuelve la misma operación.
-- Si hay una operación abierta (iniciada o desconocida) NO se permite otra: primero hay que conciliar.
create or replace function public.fel_op_certificacion_iniciar(
  p_actor uuid, p_empresa uuid, p_doc uuid, p_clave text, p_hash text, p_proveedor text) returns public.operaciones_fiscales
language plpgsql security definer set search_path = '' as $$
declare v public.documentos; o public.operaciones_fiscales;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'fiscal.certificar');
  perform public.fel__emision_real_activa(p_empresa);
  select * into v from public.documentos where id = p_doc and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: documento no encontrado'; end if;
  select * into o from public.operaciones_fiscales where documento_id = p_doc and clave_idempotencia = p_clave;
  if found then
    if o.hash_contenido <> p_hash or o.tipo <> 'certificacion' then
      raise exception 'FEL_CONFLICTO: la clave de idempotencia ya se usó con otro contenido';
    end if;
    return o;
  end if;
  if exists (select 1 from public.operaciones_fiscales where documento_id = p_doc and estado in ('iniciada','desconocida')) then
    raise exception 'FEL_OPERACION_ABIERTA: hay una operación sin confirmar; concílala antes de reintentar';
  end if;
  if v.estado_preparacion <> 'revisado' or v.estado_fiscal not in ('ninguno','rechazado') then
    raise exception 'FEL_REGLA: el documento no está en condiciones de certificarse';
  end if;
  insert into public.operaciones_fiscales (empresa_id, documento_id, tipo, clave_idempotencia, hash_contenido, proveedor, iniciada_por)
  values (p_empresa, p_doc, 'certificacion', p_clave, p_hash, p_proveedor, p_actor) returning * into o;
  perform public.fel__fiscal_cambiar(p_doc, p_empresa, 'pendiente_certificacion', p_actor, o.id, 'certificación iniciada');
  perform public.fel_auditar(p_empresa, p_actor, 'fiscal.certificacion_iniciada', 'documento', p_doc::text, jsonb_build_object('operacion', o.id));
  return o;
end $$;

-- Anulación: exige regla verificada y vigente; el plazo se aplica solo si la regla es de tipo soportado.
create or replace function public.fel_op_anulacion_iniciar(
  p_actor uuid, p_empresa uuid, p_doc uuid, p_clave text, p_hash text, p_motivo text, p_proveedor text) returns public.operaciones_fiscales
language plpgsql security definer set search_path = '' as $$
declare v public.documentos; o public.operaciones_fiscales; g public.reglas_normativas;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'fiscal.anular');
  perform public.fel__emision_real_activa(p_empresa);
  if p_motivo is null or length(btrim(p_motivo)) < 5 then raise exception 'FEL_REGLA: el motivo es obligatorio (mínimo 5 caracteres)'; end if;
  select * into v from public.documentos where id = p_doc and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: documento no encontrado'; end if;
  select * into o from public.operaciones_fiscales where documento_id = p_doc and clave_idempotencia = p_clave;
  if found then
    if o.hash_contenido <> p_hash or o.tipo <> 'anulacion' then
      raise exception 'FEL_CONFLICTO: la clave de idempotencia ya se usó con otro contenido';
    end if;
    return o;
  end if;
  if exists (select 1 from public.operaciones_fiscales where documento_id = p_doc and estado in ('iniciada','desconocida')) then
    raise exception 'FEL_OPERACION_ABIERTA: hay una operación sin confirmar; concílala antes de reintentar';
  end if;
  if v.estado_fiscal <> 'certificado' then raise exception 'FEL_REGLA: solo se anula un DTE certificado'; end if;
  select * into g from public.reglas_normativas
   where codigo = 'anulacion_dte' and estado = 'verificado'
     and (vigente_desde is null or vigente_desde <= current_date) and (vigente_hasta is null or vigente_hasta >= current_date)
   order by version desc limit 1;
  if not found then raise exception 'FEL_REGLA: no hay reglas de anulación verificadas y vigentes'; end if;
  if g.reglas ->> 'plazo_tipo' = 'dias_calendario'
     and current_date - v.certificacion_verificada_en::date > (g.reglas ->> 'dias')::integer then
    raise exception 'FEL_REGLA: fuera del plazo de anulación';
  end if;
  insert into public.operaciones_fiscales (empresa_id, documento_id, tipo, clave_idempotencia, hash_contenido, proveedor, regla_id, motivo, iniciada_por)
  values (p_empresa, p_doc, 'anulacion', p_clave, p_hash, p_proveedor, g.id, btrim(p_motivo), p_actor) returning * into o;
  perform public.fel__fiscal_cambiar(p_doc, p_empresa, 'anulacion_solicitada', p_actor, o.id, btrim(p_motivo));
  perform public.fel_auditar(p_empresa, p_actor, 'fiscal.anulacion_iniciada', 'documento', p_doc::text,
    jsonb_build_object('operacion', o.id, 'regla', g.id, 'motivo', btrim(p_motivo)));
  return o;
end $$;

-- Resultado desconocido (tiempo agotado, corte, respuesta ilegible): el documento queda por verificar y NO se reintenta.
create or replace function public.fel_op_operacion_desconocida(p_actor uuid, p_empresa uuid, p_op uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.operaciones_fiscales;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'fiscal.certificar');
  select * into o from public.operaciones_fiscales where id = p_op and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: operación no encontrada'; end if;
  if o.estado <> 'iniciada' then raise exception 'FEL_REGLA: solo una operación iniciada puede quedar con resultado desconocido'; end if;
  update public.operaciones_fiscales set estado = 'desconocida' where id = p_op;
  if o.tipo = 'certificacion' then
    perform public.fel__fiscal_cambiar(o.documento_id, p_empresa, 'por_verificar', p_actor, p_op, 'resultado desconocido');
  end if;  -- una anulación desconocida deja el documento en anulacion_solicitada (no se asume ni éxito ni fallo)
  perform public.fel_auditar(p_empresa, p_actor, 'fiscal.operacion_desconocida', 'documento', o.documento_id::text, jsonb_build_object('operacion', p_op));
end $$;

-- Resolución de una operación: por respuesta del proveedor o por conciliación manual (con evidencia y permiso aparte).
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
  select * into v from public.documentos where id = o.documento_id and empresa_id = p_empresa for update;
  update public.operaciones_fiscales
     set estado = case when p_exitosa then 'confirmada_exitosa' else 'confirmada_fallida' end,
         resolucion = p_resolucion, evidencia = p_evidencia, resuelta_por = p_actor, resuelta_en = now()
   where id = p_op;
  if o.tipo = 'certificacion' then
    if p_exitosa then
      if coalesce(btrim(p_serie), '') = '' or coalesce(btrim(p_numero), '') = '' or coalesce(btrim(p_autorizacion), '') = '' then
        raise exception 'FEL_REGLA: serie, número y autorización son obligatorios para confirmar una certificación';
      end if;
      perform public.fel__fiscal_cambiar(o.documento_id, p_empresa, 'certificado', p_actor, p_op, p_resolucion,
                                         btrim(p_serie), btrim(p_numero), btrim(p_autorizacion));
    else
      perform public.fel__fiscal_cambiar(o.documento_id, p_empresa, 'rechazado', p_actor, p_op, p_resolucion);
    end if;
  else
    perform public.fel__fiscal_cambiar(o.documento_id, p_empresa, case when p_exitosa then 'anulado' else 'certificado' end,
                                       p_actor, p_op, p_resolucion);
  end if;
  perform public.fel_auditar(p_empresa, p_actor, 'fiscal.operacion_resuelta', 'documento', o.documento_id::text,
    jsonb_build_object('operacion', p_op, 'exitosa', p_exitosa, 'resolucion', p_resolucion));
end $$;

-- ---------------------------------------------------------------- administración de reglas e identificaciones (administrador maestro)
create or replace function public.fel_admin_regla_crear_version(
  p_actor uuid, p_codigo text, p_nombre text, p_reglas jsonb, p_fuente text, p_vigente_desde date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_ver integer;
begin
  perform public.fel__exigir_plataforma(p_actor);
  select coalesce(max(version), 0) + 1 into v_ver from public.reglas_normativas where codigo = p_codigo;
  insert into public.reglas_normativas (codigo, version, nombre, reglas, fuente, vigente_desde, creado_por)
  values (p_codigo, v_ver, btrim(p_nombre), coalesce(p_reglas, '{}'::jsonb), p_fuente, p_vigente_desde, p_actor) returning id into v_id;
  perform public.fel_auditar(null, p_actor, 'regla.crear_version', 'regimen', v_id::text,
    jsonb_build_object('codigo', p_codigo, 'version', v_ver, 'reglas', coalesce(p_reglas, '{}'::jsonb), 'fuente', p_fuente));
  return v_id;
end $$;

create or replace function public.fel_admin_regla_verificar(p_actor uuid, p_regla uuid, p_referencia text, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.reglas_normativas;
begin
  perform public.fel__exigir_plataforma(p_actor);
  if p_motivo is null or length(btrim(p_motivo)) < 5 then raise exception 'FEL_REGLA: el motivo es obligatorio (mínimo 5 caracteres)'; end if;
  select * into v from public.reglas_normativas where id = p_regla for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: regla no encontrada'; end if;
  if v.estado <> 'sin_verificar' then raise exception 'FEL_REGLA: solo se verifica una regla sin verificar'; end if;
  update public.reglas_normativas set estado = 'verificado', verificado_por = p_actor, verificado_en = now(),
         fuente = coalesce(nullif(btrim(p_referencia), ''), fuente) where id = p_regla;
  perform public.fel_auditar(null, p_actor, 'regla.verificar', 'regimen', p_regla::text,
    jsonb_build_object('codigo', v.codigo, 'version', v.version, 'reglas', v.reglas, 'referencia', p_referencia, 'motivo', p_motivo));
end $$;

create or replace function public.fel_admin_identificacion_verificar(
  p_actor uuid, p_codigo text, p_patron text, p_fuente text, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.identificaciones_tipos;
begin
  perform public.fel__exigir_plataforma(p_actor);
  if p_motivo is null or length(btrim(p_motivo)) < 5 or p_fuente is null or length(btrim(p_fuente)) < 5 then
    raise exception 'FEL_REGLA: motivo y fuente normativa son obligatorios';
  end if;
  select * into v from public.identificaciones_tipos where codigo = p_codigo for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: tipo de identificación no encontrado'; end if;
  if v.verificado then raise exception 'FEL_REGLA: el tipo ya está verificado'; end if;
  update public.identificaciones_tipos set patron = nullif(btrim(p_patron), ''), fuente = btrim(p_fuente), verificado = true,
         verificado_por = p_actor, verificado_en = now() where codigo = p_codigo;
  perform public.fel_auditar(null, p_actor, 'identificacion.verificar', 'regimen', p_codigo,
    jsonb_build_object('patron', p_patron, 'fuente', p_fuente, 'motivo', p_motivo));
end $$;

-- ---------------------------------------------------------------- permisos de ejecución: solo service_role
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like 'fel\_op\_documento%' or p.proname like 'fel\_op\_certificacion%'
               or p.proname like 'fel\_op\_anulacion%' or p.proname like 'fel\_op\_operacion%' or p.proname like 'fel\_admin\_regla%'
               or p.proname like 'fel\_admin\_identificacion%' or p.proname like 'fel\_\_documento%' or p.proname like 'fel\_\_fiscal%'
               or p.proname like 'fel\_\_emision%' or p.proname like 'fel\_identificacion\_validar')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
-- NEXA FEL · Fase 1.0 · corrección controlada de seguridad.
--  (1) Cuenta activa y administrador maestro activo, como funciones únicas para la API.
--  (2) Interruptor de emisión real A NIVEL DE BASE DE DATOS: ninguna acción, función ni cambio de configuración de la
--      Edge Function puede habilitarla; solo se cambia con SQL de propietario de la base (migración/consola), no con service_role.
--  (3) Limitador de peticiones atómico y persistente (ventana fija) compartido por todas las instancias de la Edge Function.

-- ---------------------------------------------------------------- (1) cuenta activa
-- Sin fila en perfiles = activa (todavía no aceptó invitaciones); con perfiles.activo = false = bloqueada.
create or replace function public.fel_usuario_activo(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user is not null and not exists (select 1 from public.perfiles pf where pf.user_id = p_user and not pf.activo)
$$;

create or replace function public.fel_es_plataforma(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.fel_usuario_activo(p_user)
     and exists (select 1 from public.plataforma_admins pa where pa.user_id = p_user)
$$;

-- ---------------------------------------------------------------- (2) interruptor de emisión real
create table public.plataforma_config (
  clave          text primary key,
  valor          boolean not null,
  actualizado_en timestamptz not null default now()
);
alter table public.plataforma_config enable row level security;
revoke all on public.plataforma_config from public, anon, authenticated, service_role;
insert into public.plataforma_config (clave, valor) values ('emision_real_disponible', false);

-- Cualquier cambio del interruptor queda en la auditoría.
create or replace function public.fel_config_auditar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'FEL_REGLA: la configuración de plataforma no se borra'; end if;
  new.actualizado_en := now();
  perform public.fel_auditar(null, null, 'plataforma.config_cambiada', 'plataforma', new.clave,
    jsonb_build_object('antes', case when tg_op = 'UPDATE' then old.valor end, 'despues', new.valor), 'sql');
  return new;
end $$;
create trigger plataforma_config_auditar before insert or update or delete on public.plataforma_config
  for each row execute function public.fel_config_auditar();

create or replace function public.fel__emision_real_disponible() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select valor from public.plataforma_config where clave = 'emision_real_disponible'), false)
$$;

-- Empresa: se agrega el interruptor global a la regla existente (empresa habilitada + régimen verificado + autorización).
create or replace function public.fel_empresa_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.actualizado_en := now();
  if new.estado = 'habilitada' and new.regimen_id is null then
    raise exception 'FEL_REGLA: una empresa habilitada necesita un régimen asignado';
  end if;
  if tg_op = 'UPDATE' and old.emision_real_habilitada and new.regimen_id is distinct from old.regimen_id then
    raise exception 'FEL_REGLA: no se puede cambiar el régimen con la emisión real habilitada; deshabilítala primero';
  end if;
  if new.emision_real_habilitada then
    if tg_op = 'INSERT' or not old.emision_real_habilitada then
      if not public.fel__emision_real_disponible() then
        raise exception 'FEL_EMISION_BLOQUEADA: la emisión real no está disponible en esta plataforma';
      end if;
    end if;
    if new.estado <> 'habilitada' then
      raise exception 'FEL_REGLA: la emisión real exige una empresa habilitada';
    end if;
    if not exists (select 1 from public.regimenes_fiscales r where r.id = new.regimen_id and r.estado = 'verificado') then
      raise exception 'FEL_REGLA: el régimen de la empresa no está verificado';
    end if;
    if new.emision_autorizada_por is null or new.emision_autorizada_en is null then
      raise exception 'FEL_REGLA: falta la autorización específica de la emisión real';
    end if;
  end if;
  return new;
end $$;

-- Las operaciones fiscales (certificar/anular) también exigen el interruptor global en CADA llamada.
create or replace function public.fel__emision_real_activa(p_empresa uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.fel__emision_real_disponible()
     or not exists (select 1 from public.empresas e join public.regimenes_fiscales r on r.id = e.regimen_id
                     where e.id = p_empresa and e.estado = 'habilitada' and e.emision_real_habilitada and r.estado = 'verificado') then
    raise exception 'FEL_EMISION_BLOQUEADA: la emisión real no está habilitada para esta empresa';
  end if;
end $$;

-- ---------------------------------------------------------------- (3) limitador de peticiones
-- Ventana fija por clave. El UPSERT condicionado es atómico: la fila queda bloqueada durante el conflicto, así que
-- N sesiones simultáneas nunca superan el máximo. Las peticiones rechazadas no incrementan el contador.
create table public.limites_peticiones (
  clave         text not null check (length(clave) between 1 and 200),
  ventana_inicio timestamptz not null,
  contador      integer not null check (contador >= 0),
  primary key (clave, ventana_inicio)
);
create index limites_peticiones_ventana_idx on public.limites_peticiones (ventana_inicio);
alter table public.limites_peticiones enable row level security;
revoke all on public.limites_peticiones from public, anon, authenticated, service_role;

create or replace function public.fel_limite_consumir(p_clave text, p_ventana_seg integer, p_max integer)
returns table (permitido boolean, reintentar_en integer)
language plpgsql security definer set search_path = '' as $$
declare v_ini timestamptz; v_fin timestamptz; v_c integer;
begin
  if p_clave is null or length(p_clave) not between 1 and 200 or p_ventana_seg is null or p_ventana_seg not between 1 and 86400
     or p_max is null or p_max not between 1 and 1000000 then
    raise exception 'FEL_REGLA: parámetros de límite no válidos';
  end if;
  v_ini := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_ventana_seg) * p_ventana_seg);
  v_fin := v_ini + make_interval(secs => p_ventana_seg);
  insert into public.limites_peticiones as l (clave, ventana_inicio, contador) values (p_clave, v_ini, 1)
  on conflict (clave, ventana_inicio) do update set contador = l.contador + 1 where l.contador < p_max
  returning l.contador into v_c;
  -- Expiración: las ventanas viejas ya no cuentan (la clave incluye la ventana); además se purgan de forma oportunista.
  if random() < 0.02 then
    delete from public.limites_peticiones where ventana_inicio < clock_timestamp() - interval '2 days';
  end if;
  permitido := v_c is not null;
  reintentar_en := greatest(1, ceil(extract(epoch from (v_fin - clock_timestamp())))::integer);
  return next;
end $$;

-- ---------------------------------------------------------------- permisos de ejecución: solo service_role
revoke all on function public.fel_usuario_activo(uuid), public.fel_es_plataforma(uuid), public.fel__emision_real_disponible(),
  public.fel_limite_consumir(text, integer, integer), public.fel_config_auditar() from public, anon, authenticated;
grant execute on function public.fel_usuario_activo(uuid), public.fel_es_plataforma(uuid), public.fel__emision_real_disponible(),
  public.fel_limite_consumir(text, integer, integer) to service_role;
-- NEXA FEL · Fase 1.0 · cuenta sin perfil = SIN acceso.
-- Antes, una cuenta sin fila en perfiles se consideraba activa. Ahora una cuenta solo está "activa" si tiene perfil activo.
-- La ÚNICA excepción es aceptar una invitación vigente: esa operación (fel_op_invitacion_aceptar) es la que crea el perfil,
-- y solo si la cuenta tiene un correo confirmado que coincide con una invitación pendiente y no vencida.
-- Primer administrador maestro: debe crearse su usuario en Auth, su fila en perfiles y su fila en plataforma_admins.

create or replace function public.fel_estado_cuenta(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when p_user is null then 'sin_perfil'
         else coalesce((select case when pf.activo then 'activa' else 'bloqueada' end
                          from public.perfiles pf where pf.user_id = p_user), 'sin_perfil') end
$$;

create or replace function public.fel_usuario_activo(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.fel_estado_cuenta(p_user) = 'activa'
$$;

-- Las funciones que usan las políticas RLS y las operaciones exigen cuenta activa (con perfil).
create or replace function public.fel_es_admin_plataforma() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.fel_usuario_activo(auth.uid())
     and exists (select 1 from public.plataforma_admins pa where pa.user_id = auth.uid())
$$;

create or replace function public.fel_permisos_efectivos(p_empresa uuid, p_user uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select array(
      select distinct x.p from (
        select rp.permiso as p from public.rol_permisos rp where rp.rol = m.rol
        union
        select unnest(m.permisos_extra)
      ) x
      where x.p <> all (m.permisos_revocados)
      order by 1)
    from public.miembros m
    join public.empresas e on e.id = m.empresa_id and e.estado = 'habilitada'
    where m.empresa_id = p_empresa and m.user_id = p_user and m.activo
      and public.fel_usuario_activo(m.user_id)
  ), '{}'::text[])
$$;

create or replace function public.fel_es_miembro(p_empresa uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.miembros m
    join public.empresas e on e.id = m.empresa_id and e.estado = 'habilitada'
    where m.empresa_id = p_empresa and m.user_id = auth.uid() and m.activo
      and public.fel_usuario_activo(m.user_id))
$$;

create or replace function public.fel__exigir_plataforma(p_actor uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_actor is null or not public.fel_es_plataforma(p_actor) then
    raise exception 'FEL_NO_AUTORIZADO: solo el administrador maestro puede hacer esto';
  end if;
end $$;

-- Aceptar invitaciones: única operación que puede ejecutar una cuenta sin perfil.
--  · El correo se toma de Auth (no del cliente) y debe estar confirmado; p_email solo se contrasta.
--  · Sin perfil, exige al menos una invitación pendiente y no vencida; si no, no crea nada.
--  · Una cuenta bloqueada nunca se reactiva por esta vía.
create or replace function public.fel_op_invitacion_aceptar(p_user uuid, p_email text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v public.invitaciones; n integer := 0; v_mail text; v_conf timestamptz; v_estado text; v_validas integer;
begin
  if p_user is null then raise exception 'FEL_NO_AUTORIZADO: no tienes una invitación vigente'; end if;
  select lower(btrim(u.email)), u.email_confirmed_at into v_mail, v_conf from auth.users u where u.id = p_user;
  if v_mail is null or v_conf is null or v_mail <> lower(btrim(coalesce(p_email, ''))) then
    raise exception 'FEL_NO_AUTORIZADO: no tienes una invitación vigente';
  end if;
  v_estado := public.fel_estado_cuenta(p_user);
  if v_estado = 'bloqueada' then raise exception 'FEL_NO_AUTORIZADO: la cuenta está desactivada'; end if;
  select count(*) into v_validas from public.invitaciones where email = v_mail and estado = 'pendiente' and expira_en > now();
  if v_validas = 0 and v_estado = 'sin_perfil' then
    raise exception 'FEL_NO_AUTORIZADO: no tienes una invitación vigente';
  end if;
  update public.invitaciones set estado = 'vencida' where email = v_mail and estado = 'pendiente' and expira_en <= now();
  if v_validas = 0 then return 0; end if;
  insert into public.perfiles (user_id) values (p_user) on conflict (user_id) do nothing;
  for v in select * from public.invitaciones where email = v_mail and estado = 'pendiente' and expira_en > now() for update loop
    insert into public.miembros (empresa_id, user_id, rol, permisos_extra, invitado_por)
    values (v.empresa_id, p_user, v.rol, v.permisos_extra, v.invitado_por)
    on conflict (empresa_id, user_id) do update
      set rol = excluded.rol, permisos_extra = excluded.permisos_extra, permisos_revocados = '{}', activo = true;
    update public.invitaciones set estado = 'aceptada', aceptada_en = now(), user_id = p_user where id = v.id;
    perform public.fel_auditar(v.empresa_id, p_user, 'invitacion.aceptar', 'invitacion', v.id::text,
      jsonb_build_object('rol', v.rol, 'email', v_mail));
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.fel_estado_cuenta(uuid) from public, anon, authenticated;
grant execute on function public.fel_estado_cuenta(uuid) to service_role;
