-- E1a · SOLO la vista ligera (la parte más segura de E1). Idempotente. NO crea tablas, NO crea disparadores, NO modifica ni mueve ningún dato, NO cambia nada para ningún cliente de Nexa.
-- Efecto: la función programada «recordatorios-de-nexa» (que ya lee por esta vista si existe, v513 desplegada) deja de leer cada vez los 13.78 MB de planes con miniaturas (≈ 71 corridas al día) y lee ~0.3 MB.
-- Los clientes v512/v513/v514 no se enteran: la lectura ligera del cliente exige además la tabla pa_thumbs (E1 completa), que no existe todavía, así que siguen leyendo pa_docs como hoy.
-- La vista es «security_invoker»: cada persona ve EXACTAMENTE las filas que ya ve en pa_docs (políticas reales pa_sel y pa_rev_sel); el rol de servicio de las funciones ve todo, igual que con la tabla.
create or replace function public.pa_strip_thumbs(j jsonb) returns jsonb language plpgsql immutable set search_path = '' as $$
declare r jsonb; base jsonb;
begin
  if j is null then return null; end if;
  if jsonb_typeof(j) = 'array' then
    select coalesce(jsonb_agg(public.pa_strip_thumbs(x.v) order by x.n), '[]'::jsonb) into r from jsonb_array_elements(j) with ordinality as x(v, n); return r;
  elsif jsonb_typeof(j) = 'object' then
    base := j;
    if base ? 'k' and jsonb_typeof(base -> 'k') = 'string' and jsonb_typeof(base -> 't') = 'string' and (base ->> 't') like 'data:image/%' then base := base - 't'; end if;
    select coalesce(jsonb_object_agg(e.key, public.pa_strip_thumbs(e.value)), '{}'::jsonb) into r from jsonb_each(base) as e; return r;
  end if;
  return j;
end $$;
revoke all on function public.pa_strip_thumbs(jsonb) from public, anon;
grant execute on function public.pa_strip_thumbs(jsonb) to authenticated, service_role;
create or replace view public.pa_docs_lite with (security_invoker = true) as
  select d.col, d.id, d.updated_at,
         case when d.col = 'plans' then public.pa_strip_thumbs(d.data) else d.data end as data
    from public.pa_docs d
   where not (d.col = 'notifs' and d.updated_at < now() - interval '45 days' and d.data ? 'to' and d.data ? 'read' and (d.data -> 'to') <@ (d.data -> 'read'));
revoke all on public.pa_docs_lite from anon;
grant select on public.pa_docs_lite to authenticated, service_role;
