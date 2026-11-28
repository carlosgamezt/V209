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
