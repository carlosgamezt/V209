-- Nexa v510 · Siguiente número de plan que NUNCA se repite (reserva atómica en el servidor).
-- Antes (v502) la función solo devolvía el máximo + 1 sin reservarlo: dos usuarios que creaban un plan a la vez recibían el mismo número y
-- el segundo chocaba con "pa_docs_pkey". Ahora cada llamada RESERVA su número con un contador por año (bloqueo de fila), y nunca baja del máximo real
-- de pa_docs (por si algún plan se creó con una versión vieja de la app). Pueden quedar huecos si una creación falla; los números no se repiten.
-- Se puede correr más de una vez. Los usuarios de una sola región o sucursal no ven todos los planes: por eso se consulta aquí, no en la app.
create table if not exists public.pa_plan_seq (
  anio text primary key check (anio ~ '^[0-9]{4}$'),
  n    integer not null default 0
);
alter table public.pa_plan_seq enable row level security;   -- sin políticas: solo la función (security definer) la toca
revoke all on public.pa_plan_seq from public, anon, authenticated;

drop function if exists public.pa_next_seq(text);            -- se reemplaza por la versión con reserva (acepta pedir varios números)
create or replace function public.pa_next_seq(y text, cnt integer default 1)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare mx integer; k integer; c integer := greatest(1, least(coalesce(cnt, 1), 500));
begin
  if y is null or y !~ '^[0-9]{4}$' then raise exception 'Año no válido'; end if;
  select coalesce(max(((regexp_match(id, '^PA-' || y || '-(\d+)'))[1])::int), 0) into mx from public.pa_docs where col = 'plans';
  insert into public.pa_plan_seq as s (anio, n) values (y, mx + c)
  on conflict (anio) do update set n = greatest(s.n, mx) + c
  returning n into k;
  return k - c + 1;                                           -- primer número del bloque reservado
end $$;
revoke all on function public.pa_next_seq(text, integer) from public;
grant execute on function public.pa_next_seq(text, integer) to authenticated;
