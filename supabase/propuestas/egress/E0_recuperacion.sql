-- E0 · RECUPERACIÓN desde el respaldo E0 que PRESERVA las modificaciones legítimas hechas después del respaldo. Solo con autorización; no se usa salvo que algo salga mal.
-- Siempre y sin riesgo (solo agrega): repone en pa_thumbs las miniaturas del respaldo que falten (no pisa ninguna) y las descargas que falten (tabla de solo agregar).
-- Con variables (todas opcionales; sin ellas NO se toca pa_docs):
--   -v planes="'{PA-2026-001,PA-2026-002}'"   FUSIONA esos planes: conserva lo que hoy tienen y agrega SOLO las claves del respaldo que hoy faltan (una edición posterior nunca se pisa; un plan vaciado o dañado recupera todas sus claves).
--   -v modo=reemplazar                          con «planes»: sustituye el contenido por el del respaldo (descarta ediciones posteriores de esos planes; usar solo si el plan quedó corrupto).
--   -v faltantes=true                           repone las filas de pa_docs que existían en el respaldo y hoy no existen. OJO: también repondría lo que alguien eliminó legítimamente después del respaldo; usar con la lista de ids:
--   -v ids="'{PA-2026-010,n123}'"               limita «faltantes» a esos ids (recomendado).
\if :{?planes}
\else
\set planes '''{}'''
\endif
\if :{?modo}
\else
\set modo fusionar
\endif
\if :{?faltantes}
\else
\set faltantes false
\endif
\if :{?ids}
\else
\set ids '''{}'''
\endif
begin;
do $$ begin if to_regclass('public.pa_thumbs') is not null then
  insert into public.pa_thumbs (k, plan_id, t) select x.k, r.id, x.t from public.pa_docs_respaldo_e0 r, lateral public.pa_extract_thumbs(r.data) x where r.col = 'plans' on conflict (k) do nothing;
end if; end $$;
insert into public.pa_descargas (plan_id, user_id, user_name, role, manual, created_at) select r.plan_id, r.user_id, r.user_name, r.role, r.manual, r.created_at from public.pa_descargas_respaldo_e0 r where not exists (select 1 from public.pa_descargas d where d.id = r.id);
insert into public.pa_docs (col, id, data, updated_at) select r.col, r.id, r.data, r.updated_at from public.pa_docs_respaldo_e0 r
  where :faltantes::boolean and (cardinality(:ids::text[]) = 0 or r.id = any (:ids::text[])) and not exists (select 1 from public.pa_docs d where d.col = r.col and d.id = r.id);
update public.pa_docs d set data = case when :'modo' = 'reemplazar' then r.data else r.data || d.data end, updated_at = case when :'modo' = 'reemplazar' then r.updated_at else greatest(d.updated_at, r.updated_at) end
  from public.pa_docs_respaldo_e0 r where r.col = d.col and r.id = d.id and d.col = 'plans' and d.id = any (:planes::text[]);
commit;
