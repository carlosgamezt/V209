-- E1 (versión para el flujo automático): separación de miniaturas + vista + RPC de descargas, en UNA transacción con comprobaciones que la DESHACEN por completo si algo no coincide.
-- Requisitos (si faltan, se detiene sin cambiar nada): respaldo E0, vista E1a y la matriz de escritura de referencia de V1.
-- Comprobaciones posteriores con los perfiles REALES y las funciones/políticas REALES: (1) integridad: cada miniatura embebida está en pa_thumbs con contenido idéntico y pa_docs no cambió; (2) escritura: la matriz perfil × plan es idéntica a la de V1
-- (incluye disparar el nuevo disparador con «set data = data», deshecho en subtransacción); (3) lectura: la vista ligera = la tabla para cada perfil y pa_thumbs solo muestra miniaturas de planes visibles.
begin;
do $pre$
begin
  if to_regclass('public.pa_docs_respaldo_e0') is null then raise exception 'E1 detenido: falta el respaldo E0'; end if;
  if to_regclass('public.pa_docs_lite') is null then raise exception 'E1 detenido: falta la vista E1a'; end if;
  if to_regclass('public.pa_e1_matriz_ref') is null or not exists (select 1 from public.pa_e1_matriz_ref where fase = 'antes') then raise exception 'E1 detenido: falta la matriz de referencia de V1'; end if;
  if (select md5(coalesce(string_agg(d.data::text, '' order by d.col, d.id), '')) from public.pa_docs d) is distinct from (select md5(coalesce(string_agg(r.data::text, '' order by r.col, r.id), '')) from public.pa_docs_respaldo_e0 r) then raise exception 'E1 detenido: pa_docs cambió desde el respaldo E0 (repetir E0/V1 antes de aplicar E1)'; end if;
end $pre$;
-- E1 · Optimización de Egress (PROPUESTA; NO está en supabase/auto: no se ejecuta sola). Idempotente. NO borra ni cambia datos existentes.
-- 1) pa_thumbs: las miniaturas dejan de viajar dentro del JSON del plan. Un disparador (SECURITY DEFINER) las separa en cada escritura de un plan y,
--    ANTES de quitarlas, copia a pa_thumbs las que traía la fila anterior (así una app que aún no conoce la separación nunca pierde una foto).
-- 2) pa_docs_lite: vista (security_invoker = las MISMAS reglas de acceso de pa_docs) que entrega los planes sin miniaturas y deja fuera avisos viejos ya leídos por todos.
-- 3) pa_descargas_resumen(): agregación en la base (última descarga relevante por plan) en lugar de bajar hasta 5 000 filas.
-- Las filas existentes siguen con sus miniaturas embebidas (la vista las oculta) hasta que, con autorización aparte, se ejecute E2_compactar_miniaturas.sql.

create table if not exists public.pa_thumbs (
  k          text primary key,                      -- llave de la foto (la misma que usa la app: «ref#…»/«ev#…»)
  plan_id    text not null,
  t          text not null check (t like 'data:image/%'),
  created_at timestamptz not null default now()
);
create index if not exists pa_thumbs_plan_idx on public.pa_thumbs (plan_id);
alter table public.pa_thumbs enable row level security;
drop policy if exists pa_thumbs_sel on public.pa_thumbs;
-- visible solo si el plan es visible para quien pregunta (la subconsulta aplica las reglas de pa_docs)
create policy pa_thumbs_sel on public.pa_thumbs for select to authenticated
  using (exists (select 1 from public.pa_docs d where d.col = 'plans' and d.id = pa_thumbs.plan_id));
revoke all on public.pa_thumbs from anon, authenticated;
grant select on public.pa_thumbs to authenticated;          -- sin INSERT/UPDATE/DELETE: solo escribe el disparador

-- quita SOLO el campo t de objetos «foto» (tienen k y t con una imagen data:); cualquier otro t (fechas, cronología) se conserva
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

create or replace function public.pa_extract_thumbs(j jsonb) returns table (k text, t text) language plpgsql immutable set search_path = '' as $$
declare e record;
begin
  if j is null then return; end if;
  if jsonb_typeof(j) = 'array' then
    for e in select value from jsonb_array_elements(j) loop return query select * from public.pa_extract_thumbs(e.value); end loop;
  elsif jsonb_typeof(j) = 'object' then
    if j ? 'k' and jsonb_typeof(j -> 'k') = 'string' and jsonb_typeof(j -> 't') = 'string' and (j ->> 't') like 'data:image/%' then k := j ->> 'k'; t := j ->> 't'; return next; end if;
    for e in select value from jsonb_each(j) loop if jsonb_typeof(e.value) in ('object', 'array') then return query select * from public.pa_extract_thumbs(e.value); end if; end loop;
  end if;
end $$;

create or replace function public.pa_docs_split_thumbs() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.col <> 'plans' then return new; end if;
  if tg_op = 'UPDATE' then   -- 1.º lo que ya traía la fila (miniaturas embebidas de antes): se conserva en pa_thumbs
    insert into public.pa_thumbs (k, plan_id, t) select x.k, new.id, x.t from public.pa_extract_thumbs(old.data) x on conflict (k) do nothing;
  end if;
  insert into public.pa_thumbs (k, plan_id, t) select x.k, new.id, x.t from public.pa_extract_thumbs(new.data) x on conflict (k) do nothing;
  new.data := public.pa_strip_thumbs(new.data);
  return new;
end $$;
revoke all on function public.pa_docs_split_thumbs(), public.pa_strip_thumbs(jsonb), public.pa_extract_thumbs(jsonb) from public, anon, authenticated;
grant execute on function public.pa_strip_thumbs(jsonb) to authenticated;     -- usada por la vista (invoker)
-- paso 1 (seguro): copiar a pa_thumbs lo ya embebido, sin tocar pa_docs
insert into public.pa_thumbs (k, plan_id, t) select x.k, d.id, x.t from public.pa_docs d, lateral public.pa_extract_thumbs(d.data) x where d.col = 'plans' on conflict (k) do nothing;
drop trigger if exists pa_docs_split_thumbs_t on public.pa_docs;
create trigger pa_docs_split_thumbs_t before insert or update of data on public.pa_docs for each row execute function public.pa_docs_split_thumbs();

create or replace view public.pa_docs_lite with (security_invoker = true) as
  select d.col, d.id, d.updated_at,
         case when d.col = 'plans' then public.pa_strip_thumbs(d.data) else d.data end as data
    from public.pa_docs d
   where not (d.col = 'notifs' and d.updated_at < now() - interval '45 days' and d.data ? 'to' and d.data ? 'read' and (d.data -> 'to') <@ (d.data -> 'read'));
revoke all on public.pa_docs_lite from anon;
grant select on public.pa_docs_lite to authenticated;

create or replace function public.pa_descargas_resumen() returns table (plan_id text, user_name text, role text, manual boolean, created_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select distinct on (d.plan_id) d.plan_id, d.user_name, d.role, d.manual, d.created_at
    from public.pa_descargas d where d.role = 'inventarios' or d.manual order by d.plan_id, d.created_at desc
$$;
revoke all on function public.pa_descargas_resumen() from public, anon; grant execute on function public.pa_descargas_resumen() to authenticated;

-- ===== comprobaciones posteriores (cualquier fallo deshace TODO) =====
create temp table e1_esc (perfil uuid, plan text, filas int) on commit preserve rows;
create or replace function pg_temp.e1_intento(p_plan text) returns int language plpgsql as $f$
declare n int := 0;
begin
  begin
    update public.pa_docs set data = data, updated_at = updated_at where col = 'plans' and id = p_plan;
    get diagnostics n = row_count; raise exception using errcode = 'P0001', message = 'deshacer';
  exception when sqlstate 'P0001' then null; when others then n := -1; end;
  return n;
end $f$;
do $post$
declare p record; pl record; esc jsonb; n int; dif int; ajenas int; faltan int; distintas int; malos int;
begin
  -- (1) integridad de miniaturas
  select count(*) into faltan from public.pa_docs d, lateral public.pa_extract_thumbs(d.data) x where d.col = 'plans' and not exists (select 1 from public.pa_thumbs t where t.k = x.k);
  select count(*) into distintas from public.pa_docs d, lateral public.pa_extract_thumbs(d.data) x join public.pa_thumbs t on t.k = x.k where d.col = 'plans' and t.t <> x.t;
  if faltan <> 0 or distintas <> 0 then raise exception 'E1 DESHECHA: % miniaturas sin copia y % distintas', faltan, distintas; end if;
  if exists (select 1 from public.pa_docs_respaldo_e0 r, lateral public.pa_extract_thumbs(r.data) x where r.col = 'plans' and not exists (select 1 from public.pa_thumbs t where t.k = x.k and t.t = x.t)) then raise exception 'E1 DESHECHA: una miniatura del respaldo no está en pa_thumbs'; end if;
  -- (2) escritura y (3) lectura por perfil real
  for p in select auth_id from public.pa_profiles where auth_id is not null loop
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', p.auth_id::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', p.auth_id, 'role', 'authenticated')::text, true);
    esc := '[]'::jsonb;
    for pl in select id from public.pa_docs where col = 'plans' loop esc := esc || jsonb_build_array(jsonb_build_array(pl.id, pg_temp.e1_intento(pl.id))); end loop;
    select count(*) into dif from ((select col, id from public.pa_docs_lite except select col, id from public.pa_docs) union all (select col, id from public.pa_docs where not (col = 'notifs' and updated_at < now() - interval '45 days' and data ? 'to' and data ? 'read' and (data -> 'to') <@ (data -> 'read')) except select col, id from public.pa_docs_lite)) x;
    select count(*) into ajenas from public.pa_thumbs t where not exists (select 1 from public.pa_docs d where d.col = 'plans' and d.id = t.plan_id);
    execute 'reset role';
    insert into e1_esc select p.auth_id, e ->> 0, (e ->> 1)::int from jsonb_array_elements(esc) e;
    if dif <> 0 then raise exception 'E1 DESHECHA: la vista ligera difiere de la tabla para un perfil real'; end if;
    -- las miniaturas que esta persona puede leer pertenecen SOLO a planes que esta persona puede ver
    if ajenas <> 0 then raise exception 'E1 DESHECHA: pa_thumbs deja ver % miniaturas de planes no visibles para un perfil real', ajenas; end if;
  end loop;
  select count(*) into malos from public.pa_e1_matriz_ref a full join e1_esc b on a.perfil = b.perfil and a.plan = b.plan where a.fase = 'antes' and (a.filas is distinct from b.filas);
  if malos <> 0 or (select count(*) from public.pa_e1_matriz_ref where fase = 'antes') <> (select count(*) from e1_esc) then raise exception 'E1 DESHECHA: cambió quién puede escribir (% casos distintos)', malos; end if;
end $post$;
delete from public.pa_e1_matriz_ref where fase = 'despues';
insert into public.pa_e1_matriz_ref (perfil, plan, filas, fase) select perfil, plan, filas, 'despues' from e1_esc;
commit;
select json_build_object(
  'paso', 'E1 miniaturas',
  'miniaturas_embebidas_en_pa_docs', (select count(*) from public.pa_docs d, lateral public.pa_extract_thumbs(d.data) x where d.col = 'plans'),
  'llaves_distintas', (select count(distinct x.k) from public.pa_docs d, lateral public.pa_extract_thumbs(d.data) x where d.col = 'plans'),
  'miniaturas_en_pa_thumbs', (select count(*) from public.pa_thumbs),
  'faltan_en_pa_thumbs', 0, 'distintas', 0,
  'respaldo_miniaturas', (select count(*) from public.pa_docs_respaldo_e0 r, lateral public.pa_extract_thumbs(r.data) x where r.col = 'plans'),
  'pa_docs_intacto_vs_respaldo', (select md5(coalesce(string_agg(d.data::text, '' order by d.col, d.id), '')) = (select md5(coalesce(string_agg(r.data::text, '' order by r.col, r.id), '')) from public.pa_docs_respaldo_e0 r) from public.pa_docs d),
  'matriz_escritura_identica_casos', (select count(*) from public.pa_e1_matriz_ref where fase = 'despues'),
  'disparadores_en_pa_docs', (select count(*) from pg_trigger where tgrelid = 'public.pa_docs'::regclass and not tgisinternal),
  'mb_pa_thumbs', (select round(pg_total_relation_size('public.pa_thumbs') / 1048576.0, 2)),
  'mb_pa_docs', (select round(pg_total_relation_size('public.pa_docs') / 1048576.0, 2)),
  'base_mb', (select round(pg_database_size(current_database()) / 1048576.0, 1))
) as e1;
