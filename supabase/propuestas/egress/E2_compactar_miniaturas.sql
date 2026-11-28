-- E2 · COMPACTAR (requiere autorización expresa; ejecutar fuera de horas de uso). Quita las miniaturas embebidas de los planes ya existentes.
-- Seguridad: (1) respaldo completo de los planes en pa_docs_respaldo_e2; (2) comprueba que CADA miniatura embebida esté en pa_thumbs con el mismo contenido, o se detiene; (3) no cambia updated_at.
begin;
create table if not exists public.pa_docs_respaldo_e2 as select col, id, data, updated_at, now() as respaldado_en from public.pa_docs where col = 'plans';
insert into public.pa_thumbs (k, plan_id, t) select x.k, d.id, x.t from public.pa_docs d, lateral public.pa_extract_thumbs(d.data) x where d.col = 'plans' on conflict (k) do nothing;
do $$ declare faltan int; begin
  select count(*) into faltan from public.pa_docs d, lateral public.pa_extract_thumbs(d.data) x where d.col = 'plans' and not exists (select 1 from public.pa_thumbs p where p.k = x.k and p.t = x.t);
  if faltan > 0 then raise exception 'E2 detenido: % miniaturas embebidas sin copia idéntica en pa_thumbs', faltan; end if;
  raise notice 'E2: verificación OK; planes con miniaturas embebidas: %', (select count(*) from public.pa_docs where col = 'plans' and data::text like '%"t": "data:image/%');
end $$;
-- el disparador de E1 también puede hacerlo, pero aquí se hace explícito y sin tocar updated_at
alter table public.pa_docs disable trigger pa_docs_split_thumbs_t;
update public.pa_docs set data = public.pa_strip_thumbs(data) where col = 'plans' and data::text like '%data:image/%';
alter table public.pa_docs enable trigger pa_docs_split_thumbs_t;
commit;
