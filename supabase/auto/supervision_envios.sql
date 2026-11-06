-- Nexa v478 · Datos del mes: estado de envío por sucursal y mes (la función supervision-sucursal es la única que lo toca).
create table if not exists public.supervision_envios (
  sucursal_codigo text not null,
  mes date not null,
  estado text not null default 'enviado' check (estado in ('enviado','solicitado','abierto')),
  motivo text,
  nota text,
  enviado_en timestamptz,
  solicitado_en timestamptz,
  resuelto_por text,
  resuelto_en timestamptz,
  primary key (sucursal_codigo, mes)
);
alter table public.supervision_envios enable row level security;
grant all on public.supervision_envios to service_role;
