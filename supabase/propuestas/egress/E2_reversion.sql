-- Reversión de E2: vuelve a incrustar en cada plan las miniaturas desde pa_thumbs (no depende del respaldo, así conserva también los cambios hechos después de E2).
create or replace function public.pa_embed_thumbs(j jsonb) returns jsonb language plpgsql stable set search_path = '' as $$
declare r jsonb; base jsonb; tt text;
begin
  if j is null then return null; end if;
  if jsonb_typeof(j) = 'array' then select coalesce(jsonb_agg(public.pa_embed_thumbs(x.v) order by x.n), '[]'::jsonb) into r from jsonb_array_elements(j) with ordinality as x(v, n); return r;
  elsif jsonb_typeof(j) = 'object' then
    base := j;
    if base ? 'k' and jsonb_typeof(base -> 'k') = 'string' and not base ? 't' then select p.t into tt from public.pa_thumbs p where p.k = base ->> 'k'; if tt is not null then base := base || jsonb_build_object('t', tt); end if; end if;
    select coalesce(jsonb_object_agg(e.key, public.pa_embed_thumbs(e.value)), '{}'::jsonb) into r from jsonb_each(base) as e; return r;
  end if;
  return j;
end $$;
begin;
alter table public.pa_docs disable trigger pa_docs_split_thumbs_t;
update public.pa_docs set data = public.pa_embed_thumbs(data) where col = 'plans';
alter table public.pa_docs enable trigger pa_docs_split_thumbs_t;
commit;
drop function public.pa_embed_thumbs(jsonb);
