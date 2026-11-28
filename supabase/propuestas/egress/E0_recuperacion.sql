-- E0 · RECUPERACIÓN desde el respaldo E0 (solo con autorización; no se usa salvo que algo salga mal). No borra nada y no pisa cambios posteriores salvo los planes que se indiquen.
--   1) Repone las filas de pa_docs que ya no existen y estaban en el respaldo (planes, usuarios, avisos, configuración).
--   2) Repone en pa_thumbs TODAS las miniaturas del respaldo (si falta alguna; no pisa las existentes).
--   3) Repone las descargas que falten.
--   4) OPCIONAL, plan por plan: restaura el contenido completo del respaldo (con sus miniaturas embebidas) de los planes listados. Uso: psql -v planes="'{PA-2026-001,PA-2026-002}'" -f E0_recuperacion.sql
--      (sin esa variable no se pisa ningún plan). Sobrescribe lo editado después del respaldo en esos planes.
\if :{?planes}
\else
\set planes '''{}'''
\endif
begin;
insert into public.pa_docs (col, id, data, updated_at) select r.col, r.id, r.data, r.updated_at from public.pa_docs_respaldo_e0 r where not exists (select 1 from public.pa_docs d where d.col = r.col and d.id = r.id);
do $$ begin if to_regclass('public.pa_thumbs') is not null then
  insert into public.pa_thumbs (k, plan_id, t) select x.k, r.id, x.t from public.pa_docs_respaldo_e0 r, lateral public.pa_extract_thumbs(r.data) x where r.col = 'plans' on conflict (k) do nothing;
end if; end $$;
insert into public.pa_descargas (plan_id, user_id, user_name, role, manual, created_at) select r.plan_id, r.user_id, r.user_name, r.role, r.manual, r.created_at from public.pa_descargas_respaldo_e0 r where not exists (select 1 from public.pa_descargas d where d.id = r.id);
update public.pa_docs d set data = r.data, updated_at = r.updated_at from public.pa_docs_respaldo_e0 r where r.col = d.col and r.id = d.id and d.col = 'plans' and d.id = any (:planes::text[]);
commit;
