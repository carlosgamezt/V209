-- NEXA CORE · C01 · esquema, parámetros, identidad (perfiles, administradores de plataforma), empresas, membresías e invitaciones.
-- Aditiva e idempotente. Las tablas NO se exponen por la Data API: todo acceso es por funciones del esquema `api` (SECURITY DEFINER, search_path vacío) con identidad real (auth.uid() + sesión viva).
-- Patrones reutilizados de NEXA FEL (empresas, perfiles, miembros con permisos extra/revocados, invitaciones, parámetros de plataforma, sesión viva y aal2); aquí se generalizan a varias empresas Y varios módulos.
begin;
create schema if not exists core;
create schema if not exists api;
revoke all on schema core from public, anon, authenticated;
revoke all on schema api from public, anon;
grant usage on schema api to authenticated;

create table if not exists core.parametros (
  clave text primary key, valor numeric not null check (valor >= 0), descripcion text not null, actualizado_en timestamptz not null default now()
);
insert into core.parametros (clave, valor, descripcion) values
  ('plataforma_mfa_obligatoria', 1, 'Las operaciones de plataforma exigen sesión aal2 (verificación en dos pasos)'),
  ('registro_publico', 0, 'Permite que una persona cree su propia empresa (0 = solo plataforma)'),
  ('invitacion_dias', 7, 'Días de vigencia de una invitación'),
  ('suscripcion_gracia_dias', 3, 'Días de gracia tras vencer una suscripción antes de bloquear módulos'),
  ('eventos_retencion_dias', 90, 'Días que se conservan los eventos ya consumidos')
on conflict (clave) do nothing;

create table if not exists core.perfiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nombre text, activo boolean not null default true, creado_en timestamptz not null default now()
);
create table if not exists core.plataforma_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nivel text not null default 'maestro' check (nivel in ('maestro', 'soporte')),
  activo boolean not null default true, creado_en timestamptz not null default now()
);
create table if not exists core.empresas (
  id uuid primary key default gen_random_uuid(),
  nombre_comercial text not null check (length(btrim(nombre_comercial)) between 2 and 120),
  razon_social text, nit text check (nit is null or nit ~ '^[0-9A-Z-]{2,20}$'),
  pais char(2) not null default 'GT', moneda char(3) not null default 'GTQ', zona_horaria text not null default 'America/Guatemala',
  estado text not null default 'activa' check (estado in ('activa', 'suspendida', 'baja')),
  creado_por uuid references auth.users (id), creado_en timestamptz not null default now(), actualizado_en timestamptz not null default now()
);
create unique index if not exists empresas_nit_uq on core.empresas (nit) where nit is not null and estado <> 'baja';
create table if not exists core.membresias (
  empresa_id uuid not null references core.empresas (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  estado text not null default 'activa' check (estado in ('activa', 'suspendida')),
  invitado_por uuid references auth.users (id), creado_en timestamptz not null default now(), actualizado_en timestamptz not null default now(),
  primary key (empresa_id, user_id)
);
create index if not exists membresias_user_idx on core.membresias (user_id) where estado = 'activa';
create table if not exists core.invitaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references core.empresas (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  roles jsonb not null default '[]'::jsonb,   -- [{modulo, codigo}] que se asignan al aceptar
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aceptada', 'revocada', 'vencida')),
  invitado_por uuid references auth.users (id), user_id uuid references auth.users (id),
  expira_en timestamptz not null, creado_en timestamptz not null default now(), aceptada_en timestamptz
);
create index if not exists invitaciones_email_idx on core.invitaciones (email) where estado = 'pendiente';
alter table core.parametros enable row level security;
alter table core.perfiles enable row level security;
alter table core.plataforma_admins enable row level security;
alter table core.empresas enable row level security;
alter table core.membresias enable row level security;
alter table core.invitaciones enable row level security;
commit;
