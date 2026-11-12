-- DEMOSTRACIÓN · contadores compartidos para limitar intentos de inicio de sesión por IP entre TODAS las instancias de la función (la memoria de una instancia no basta: cada una empezaría de cero).
-- Cerrada por RLS y sin privilegios para anon/authenticated. Aditiva. Solo guarda la clave de limitación (p. ej. «login:<IP>») y un contador por ventana de tiempo; se purga sola.
create table if not exists public.demo_limites (
  clave   text   not null check (length(clave) between 1 and 200),
  ventana bigint not null,
  n       integer not null check (n >= 1),
  expira  timestamptz not null,
  primary key (clave, ventana)
);
create index if not exists demo_limites_expira_idx on public.demo_limites (expira);
alter table public.demo_limites enable row level security;
revoke all on public.demo_limites from public, anon, authenticated;
