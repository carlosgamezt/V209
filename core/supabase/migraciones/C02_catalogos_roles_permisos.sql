-- NEXA CORE · C02 · catálogo de módulos, permisos por módulo, roles (plantillas globales y propios por empresa) y permisos extra/revocados por persona.
begin;
create table if not exists core.modulos (
  codigo text primary key check (codigo ~ '^[a-z][a-z0-9_]{1,19}$'), nombre text not null, descripcion text,
  estado text not null default 'activo' check (estado in ('activo', 'beta', 'retirado')),
  version_api int not null default 1, aprovisionable boolean not null default true, creado_en timestamptz not null default now()
);
create table if not exists core.permisos (
  modulo text not null references core.modulos (codigo) on delete cascade, codigo text not null check (codigo ~ '^[a-z][a-z0-9_.]{1,59}$'),
  descripcion text not null, sensible boolean not null default false, solo_plataforma boolean not null default false,
  primary key (modulo, codigo)
);
create table if not exists core.roles (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references core.empresas (id) on delete cascade,        -- null = plantilla global
  modulo text not null references core.modulos (codigo) on delete cascade, codigo text not null check (codigo ~ '^[a-z][a-z0-9_]{1,29}$'),
  nombre text not null, sistema boolean not null default false, creado_en timestamptz not null default now()
);
create unique index if not exists roles_uq on core.roles (coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid), modulo, codigo);
create table if not exists core.rol_permisos (
  rol_id uuid not null references core.roles (id) on delete cascade, permiso_modulo text not null, permiso_codigo text not null,
  primary key (rol_id, permiso_modulo, permiso_codigo),
  foreign key (permiso_modulo, permiso_codigo) references core.permisos (modulo, codigo) on delete cascade
);
create table if not exists core.membresia_roles (
  empresa_id uuid not null, user_id uuid not null, rol_id uuid not null references core.roles (id) on delete cascade,
  primary key (empresa_id, user_id, rol_id),
  foreign key (empresa_id, user_id) references core.membresias (empresa_id, user_id) on delete cascade
);
create table if not exists core.membresia_permisos (
  empresa_id uuid not null, user_id uuid not null, modulo text not null, codigo text not null,
  efecto text not null check (efecto in ('conceder', 'revocar')),
  primary key (empresa_id, user_id, modulo, codigo),
  foreign key (empresa_id, user_id) references core.membresias (empresa_id, user_id) on delete cascade,
  foreign key (modulo, codigo) references core.permisos (modulo, codigo) on delete cascade
);
alter table core.modulos enable row level security;
alter table core.permisos enable row level security;
alter table core.roles enable row level security;
alter table core.rol_permisos enable row level security;
alter table core.membresia_roles enable row level security;
alter table core.membresia_permisos enable row level security;
commit;
