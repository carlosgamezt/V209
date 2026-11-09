-- Nexa v502 · Siguiente número de plan sin repetir.
-- Los usuarios de una región o sucursal solo ven sus planes, así que no podían saber el último número global (PA-AAAA-NNN)
-- y chocaban con "pa_docs_pkey". Esta función consulta el máximo real sin pasar por las reglas de visibilidad.
create or replace function public.pa_next_seq(y text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(max(((regexp_match(id, '^PA-' || y || '-(\d+)'))[1])::int), 0) + 1
  from public.pa_docs
  where col = 'plans'
$$;
revoke all on function public.pa_next_seq(text) from public;
grant execute on function public.pa_next_seq(text) to authenticated;
