-- D5 · Persistencia de la DEMOSTRACIÓN en línea: registro de cuentas de la demo, sesiones, intentos y marca de entorno, sobre el MISMO modelo de NEXA FEL (empresas, miembros, documentos, monederos…).
-- Solo tablas nuevas; ninguna política ni tabla existente cambia. Nada de esto lo ve ninguna persona usuaria desde el navegador: RLS activo y sin privilegios para anon/authenticated/service_role
-- (solo el servidor de la demostración, con el rol propietario de la base, las usa). Las contraseñas se guardan como PBKDF2-SHA256 con sal; las semillas MFA, cifradas (AES-GCM) con una clave que vive solo en el servidor;
-- los identificadores de sesión, solo como SHA-256.

-- Marca que identifica una base de datos como «de demostración». El servidor se niega a sembrar o a funcionar sobre una base con empresas que no sean de la demo.
create table public.demo_entorno (
  id        boolean primary key default true check (id),
  creado_en timestamptz not null default now(),
  version   text not null default '1'
);

create table public.demo_credenciales (
  usuario           text primary key check (usuario ~ '^[a-z][a-z0-9_]{2,19}$'),
  user_id           uuid not null unique references auth.users (id),
  nombre            text not null check (length(btrim(nombre)) between 3 and 80),
  descripcion       text not null default '' check (length(descripcion) <= 200),
  empresa_id        uuid references public.empresas (id),                       -- nulo = administrador de la plataforma
  sal               text not null check (sal ~ '^[0-9a-f]{32}$'),
  hash              text not null check (hash ~ '^[0-9a-f]{64}$'),
  mfa_semilla_cifrada text check (mfa_semilla_cifrada is null or length(mfa_semilla_cifrada) between 20 and 400),
  creada_en         timestamptz not null default now(),
  actualizada_en    timestamptz not null default now()
);
create table public.demo_sesiones (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),             -- SHA-256 del identificador de la cookie: robar la tabla no da sesiones
  usuario    text not null references public.demo_credenciales (usuario) on delete cascade,
  creada_en  timestamptz not null,
  ultima_en  timestamptz not null,
  recordar   boolean not null default false
);
create index demo_sesiones_usuario_idx on public.demo_sesiones (usuario);
create table public.demo_intentos (
  usuario text primary key,
  n       integer not null check (n >= 0),
  hasta   timestamptz not null
);

alter table public.demo_entorno enable row level security;
alter table public.demo_credenciales enable row level security;
alter table public.demo_sesiones enable row level security;
alter table public.demo_intentos enable row level security;
revoke all on public.demo_entorno, public.demo_credenciales, public.demo_sesiones, public.demo_intentos from public, anon, authenticated, service_role;
