-- NEXA CORE · C03 · planes comerciales, suscripciones por empresa y activación de módulos por empresa (solo definición comercial; el cobro queda fuera de CORE hasta decidir la pasarela).
begin;
create table if not exists core.planes (
  codigo text primary key check (codigo ~ '^[a-z][a-z0-9_]{1,29}$'), nombre text not null, descripcion text,
  periodo text not null default 'mensual' check (periodo in ('mensual', 'anual', 'unico')),
  precio_centavos int check (precio_centavos is null or precio_centavos >= 0), moneda char(3) not null default 'GTQ',
  limites jsonb not null default '{}'::jsonb, activo boolean not null default true, creado_en timestamptz not null default now()
);
create table if not exists core.plan_modulos (
  plan_codigo text not null references core.planes (codigo) on delete cascade, modulo text not null references core.modulos (codigo) on delete cascade,
  limites jsonb not null default '{}'::jsonb, primary key (plan_codigo, modulo)
);
create table if not exists core.suscripciones (
  id uuid primary key default gen_random_uuid(), empresa_id uuid not null references core.empresas (id) on delete cascade,
  plan_codigo text not null references core.planes (codigo),
  estado text not null default 'activa' check (estado in ('prueba', 'activa', 'vencida', 'suspendida', 'cancelada')),
  inicia_en timestamptz not null default now(), vence_en timestamptz, renueva boolean not null default false,
  creado_por uuid references auth.users (id), creado_en timestamptz not null default now()
);
create unique index if not exists suscripciones_vigente_uq on core.suscripciones (empresa_id) where estado in ('prueba', 'activa');
create table if not exists core.empresa_modulos (
  empresa_id uuid not null references core.empresas (id) on delete cascade, modulo text not null references core.modulos (codigo),
  estado text not null default 'solicitado' check (estado in ('solicitado', 'aprovisionando', 'activo', 'suspendido', 'desactivado', 'error')),
  origen text not null default 'plan' check (origen in ('plan', 'manual')),
  config jsonb not null default '{}'::jsonb, activado_en timestamptz, desactivado_en timestamptz, actualizado_en timestamptz not null default now(),
  primary key (empresa_id, modulo)
);
create index if not exists empresa_modulos_modulo_idx on core.empresa_modulos (modulo, estado);
create table if not exists core.configuracion (
  id bigint generated always as identity primary key,
  ambito text not null check (ambito in ('plataforma', 'empresa', 'modulo')),
  empresa_id uuid references core.empresas (id) on delete cascade, modulo text references core.modulos (codigo),
  clave text not null check (clave ~ '^[a-z][a-z0-9_.]{1,59}$'), valor jsonb not null,
  actualizado_por uuid, actualizado_en timestamptz not null default now(),
  check ((ambito = 'plataforma' and empresa_id is null and modulo is null) or (ambito = 'empresa' and empresa_id is not null and modulo is null) or (ambito = 'modulo' and empresa_id is not null and modulo is not null))
);
create unique index if not exists configuracion_uq on core.configuracion (ambito, coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(modulo, ''), clave);
alter table core.planes enable row level security;
alter table core.plan_modulos enable row level security;
alter table core.suscripciones enable row level security;
alter table core.empresa_modulos enable row level security;
alter table core.configuracion enable row level security;
commit;
