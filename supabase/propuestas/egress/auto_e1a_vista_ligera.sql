-- E1a (versión para el flujo automático): SOLO la vista ligera. IDEMPOTENTE. No crea tablas ni disparadores, no modifica datos, no cambia nada para los clientes de Nexa.
-- Comprobaciones previas que DETIENEN la aplicación si fallan: existe pa_docs, existe el respaldo E0, PostgreSQL ≥ 15 (vistas «security_invoker»).
-- Comprobación posterior que DETIENE la aplicación (y deshace todo) si la vista permitiera eludir RLS: un rol «authenticated» sin sesión no debe ver ninguna fila.
begin;
do $$
begin
  if to_regclass('public.pa_docs') is null then raise exception 'E1a detenido: no existe public.pa_docs'; end if;
  if to_regclass('public.pa_docs_respaldo_e0') is null then raise exception 'E1a detenido: falta el respaldo E0 (aplicar E0 primero)'; end if;
  if current_setting('server_version_num')::int < 150000 then raise exception 'E1a detenido: se necesita PostgreSQL 15 o superior para vistas security_invoker'; end if;
end $$;
create or replace function public.pa_strip_thumbs(j jsonb) returns jsonb language plpgsql immutable set search_path = '' as $f$
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
end $f$;
revoke all on function public.pa_strip_thumbs(jsonb) from public, anon;
grant execute on function public.pa_strip_thumbs(jsonb) to authenticated, service_role;
create or replace view public.pa_docs_lite with (security_invoker = true) as
  select d.col, d.id, d.updated_at,
         case when d.col = 'plans' then public.pa_strip_thumbs(d.data) else d.data end as data
    from public.pa_docs d
   where not (d.col = 'notifs' and d.updated_at < now() - interval '45 days' and d.data ? 'to' and d.data ? 'read' and (d.data -> 'to') <@ (d.data -> 'read'));
revoke all on public.pa_docs_lite from anon;
grant select on public.pa_docs_lite to authenticated, service_role;
do $$
declare n int;
begin
  set local role authenticated;
  select count(*) into n from public.pa_docs_lite;                 -- sin sesión de Auth: las políticas reales de pa_docs no deben dejar pasar ninguna fila
  reset role;
  if n <> 0 then raise exception 'E1a DESHECHA: la vista dejó ver % filas a un rol sin sesión (podría eludir RLS)', n; end if;
end $$;
commit;
select json_build_object(
  'paso', 'E1a vista ligera',
  'vista_con_security_invoker', (select coalesce(c.reloptions::text like '%security_invoker=true%', false) from pg_class c where c.oid = 'public.pa_docs_lite'::regclass),
  'filas_vista_total', (select count(*) from public.pa_docs_lite),
  'filas_tabla_total', (select count(*) from public.pa_docs),
  'avisos_omitidos_por_antiguos_y_leidos', (select count(*) from public.pa_docs where col = 'notifs') - (select count(*) from public.pa_docs_lite where col = 'notifs'),
  'planes_en_vista', (select count(*) from public.pa_docs_lite where col = 'plans'),
  'planes_con_imagenes_en_vista', (select count(*) from public.pa_docs_lite where col = 'plans' and data::text like '%data:image/%'),
  'kb_planes_tabla', (select round(sum(octet_length(data::text)) / 1024.0) from public.pa_docs where col = 'plans'),
  'kb_planes_vista', (select round(sum(octet_length(data::text)) / 1024.0) from public.pa_docs_lite where col = 'plans'),
  'datos_intactos_vs_respaldo', (select md5(coalesce(string_agg(d.data::text, '' order by d.col, d.id), '')) = (select md5(coalesce(string_agg(r.data::text, '' order by r.col, r.id), '')) from public.pa_docs_respaldo_e0 r) from public.pa_docs d),
  'filas_visibles_sin_sesion', 0,
  'disparadores_en_pa_docs', (select count(*) from pg_trigger where tgrelid = 'public.pa_docs'::regclass and not tgisinternal)
) as e1a;
