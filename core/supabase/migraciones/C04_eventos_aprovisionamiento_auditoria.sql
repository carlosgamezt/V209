-- NEXA CORE · C04 · auditoría de solo-añadir, catálogo y cola de eventos (integración) y cola de aprovisionamiento de módulos (con reintentos e idempotencia).
begin;
create table if not exists core.auditoria (
  id bigint generated always as identity primary key, ocurrido_en timestamptz not null default now(),
  empresa_id uuid, actor_user_id uuid, origen text not null default 'api', accion text not null, entidad text not null, entidad_id text,
  antes jsonb, despues jsonb
);
create index if not exists auditoria_empresa_idx on core.auditoria (empresa_id, id desc);
create or replace function core.auditoria_inmutable() returns trigger language plpgsql security definer set search_path = '' as $$
begin raise exception 'CORE_AUDITORIA_INMUTABLE: la auditoría solo admite inserciones' using errcode = '42501'; end $$;
drop trigger if exists auditoria_sin_cambios on core.auditoria;
create trigger auditoria_sin_cambios before update or delete on core.auditoria for each row execute function core.auditoria_inmutable();
drop trigger if exists auditoria_sin_truncar on core.auditoria;
create trigger auditoria_sin_truncar before truncate on core.auditoria for each statement execute function core.auditoria_inmutable();
create table if not exists core.evento_tipos (tipo text primary key check (tipo ~ '^[a-z][a-z0-9_]{2,59}$'), descripcion text not null, modulo text references core.modulos (codigo));
create table if not exists core.eventos (
  id bigint generated always as identity primary key, ocurrido_en timestamptz not null default now(),
  tipo text not null references core.evento_tipos (tipo), empresa_id uuid, modulo text,   -- modulo = destinatario (null = para todos los módulos de la empresa)
  version int not null default 1, payload jsonb not null default '{}'::jsonb
);
create index if not exists eventos_modulo_idx on core.eventos (modulo, id);
create table if not exists core.eventos_consumo (modulo text primary key, ultimo_id bigint not null default 0, actualizado_en timestamptz not null default now());
create table if not exists core.aprovisionamientos (
  id uuid primary key default gen_random_uuid(), empresa_id uuid not null references core.empresas (id) on delete cascade, modulo text not null references core.modulos (codigo),
  accion text not null check (accion in ('activar', 'desactivar', 'suspender', 'reanudar')),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'en_proceso', 'completado', 'fallido')),
  intentos int not null default 0, ultimo_error text, clave text not null unique,
  creado_en timestamptz not null default now(), tomado_en timestamptz, completado_en timestamptz
);
create index if not exists aprov_cola_idx on core.aprovisionamientos (modulo, creado_en) where estado in ('pendiente', 'en_proceso');
alter table core.auditoria enable row level security;
alter table core.evento_tipos enable row level security;
alter table core.eventos enable row level security;
alter table core.eventos_consumo enable row level security;
alter table core.aprovisionamientos enable row level security;
commit;
