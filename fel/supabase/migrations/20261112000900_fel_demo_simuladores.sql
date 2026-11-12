-- DEMOSTRACIÓN · estado de los certificadores SIMULADOS (lo que «recordaría» el servidor de cada certificador: certificaciones, consumos, saldo, escenarios).
-- Sin esto, tras reiniciar NEXA una anulación o conciliación de un documento ya certificado fallaría. Solo contiene datos simulados (SIM-). Aditiva, sin tocar datos existentes.
create table if not exists public.demo_simulador_estado (
  clave text primary key check (clave ~ '^[a-z][a-z0-9_]{1,30}$'),
  estado text not null,
  version bigint not null default 1,
  actualizado_en timestamptz not null default now()
);
alter table public.demo_simulador_estado enable row level security;
revoke all on public.demo_simulador_estado from public, anon, authenticated;
