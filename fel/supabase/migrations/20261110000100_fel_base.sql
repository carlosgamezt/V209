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
  nit                     text not null check (nit ~ '^[0-9]{2,12}-?[0-9K]$'),
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

-- ============================================================ clientes y conceptos (por empresa)
create table public.clientes (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references public.empresas (id),
  nit             text not null check (nit = 'CF' or nit ~ '^[0-9]{2,12}-?[0-9K]$'),
  nombre          text not null check (length(btrim(nombre)) between 1 and 200),
  direccion       text,
  email           text,
  telefono        text,
  activo          boolean not null default true,
  version         integer not null default 1,
  creado_por      uuid references auth.users (id),
  creado_en       timestamptz not null default now(),
  actualizado_por uuid references auth.users (id),
  actualizado_en  timestamptz not null default now(),
  unique (id, empresa_id)
);
create unique index clientes_nit_uq on public.clientes (empresa_id, nit) where nit <> 'CF';

create table public.conceptos (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references public.empresas (id),
  codigo           text not null check (length(btrim(codigo)) between 1 and 40),
  descripcion      text not null check (length(btrim(descripcion)) between 1 and 300),
  tipo             text not null check (tipo in ('bien','servicio')),
  unidad_medida    text not null default 'UND',
  precio_unitario  numeric(18,6) not null default 0 check (precio_unitario >= 0),
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

-- ============================================================ documentos (estructura; el motor de estados y cálculo va en la siguiente etapa)
create table public.documentos (
  id                        uuid primary key default gen_random_uuid(),
  empresa_id                uuid not null references public.empresas (id),
  tipo_documento            text not null default 'factura' check (tipo_documento in ('factura')),
  estado                    text not null default 'borrador' check (estado in
                              ('borrador','revisado','pendiente_certificacion','por_verificar','certificada','rechazada','archivada')),
  numero_borrador           integer not null,             -- número INTERNO del borrador; no es un número fiscal
  cliente_id                uuid,
  cliente_snapshot          jsonb,
  regimen_id                uuid references public.regimenes_fiscales (id),
  regimen_snapshot          jsonb,                        -- copia de las reglas usadas, para reproducir el cálculo
  moneda                    char(3) not null default 'GTQ' check (moneda = 'GTQ'),
  fecha_emision_prevista    date,
  subtotal                  numeric(18,6) not null default 0,
  descuento_total           numeric(18,6) not null default 0,
  base_imponible            numeric(18,6) not null default 0,
  impuestos                 jsonb not null default '[]'::jsonb,
  total                     numeric(18,6) not null default 0,
  observaciones             text,
  version                   integer not null default 1,
  -- Datos fiscales: SIEMPRE vacíos hasta una confirmación verificable (ver restricción abajo).
  serie                     text,
  numero_fiscal             text,
  autorizacion_sat          text,
  certificacion_verificada_en timestamptz,
  creado_por                uuid references auth.users (id),
  creado_en                 timestamptz not null default now(),
  actualizado_por           uuid references auth.users (id),
  actualizado_en            timestamptz not null default now(),
  unique (id, empresa_id),
  unique (empresa_id, numero_borrador),
  foreign key (cliente_id, empresa_id) references public.clientes (id, empresa_id),
  constraint documentos_datos_fiscales_chk check (
    (estado = 'certificada'
       and serie is not null and numero_fiscal is not null and autorizacion_sat is not null
       and certificacion_verificada_en is not null)
    or
    (estado <> 'certificada'
       and serie is null and numero_fiscal is null and autorizacion_sat is null
       and certificacion_verificada_en is null)
  )
);

create table public.documento_lineas (
  id              uuid primary key default gen_random_uuid(),
  documento_id    uuid not null,
  empresa_id      uuid not null,
  orden           integer not null check (orden >= 1),
  concepto_id     uuid,
  descripcion     text not null,
  cantidad        numeric(18,6) not null check (cantidad > 0),
  precio_unitario numeric(18,6) not null check (precio_unitario >= 0),
  descuento_tipo  text not null default 'ninguno' check (descuento_tipo in ('ninguno','monto','porcentaje')),
  descuento_valor numeric(18,6) not null default 0 check (descuento_valor >= 0),
  importes        jsonb not null default '{}'::jsonb,
  unique (documento_id, orden),
  foreign key (documento_id, empresa_id) references public.documentos (id, empresa_id) on delete cascade,
  foreign key (concepto_id, empresa_id) references public.conceptos (id, empresa_id)
);

create table public.documento_estados (
  id              bigint generated always as identity primary key,
  documento_id    uuid not null,
  empresa_id      uuid not null,
  estado_anterior text,
  estado_nuevo    text not null,
  motivo          text,
  user_id         uuid references auth.users (id),
  creado_en       timestamptz not null default now(),
  foreign key (documento_id, empresa_id) references public.documentos (id, empresa_id)
);

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
