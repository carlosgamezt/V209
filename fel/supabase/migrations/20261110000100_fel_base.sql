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
