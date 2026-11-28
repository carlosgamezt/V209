-- Auditoria de solo lectura (sin mostrar datos de personas): ¿cada foto referenciada por un plan existente se reconoce con las reglas de autorizacion de super-api y se reconstruye su clave exacta?
with k as (
  select p.id as plan, a.v -> 'ev' ->> 'k' as k, 'ev' as w from public.pa_docs p, jsonb_array_elements(case when jsonb_typeof(p.data -> 'acts') = 'array' then p.data -> 'acts' else '[]'::jsonb end) as a(v) where p.col = 'plans' and a.v -> 'ev' ->> 'k' is not null
  union all
  select p.id, a.v -> 'ref' ->> 'k', 'ref' from public.pa_docs p, jsonb_array_elements(case when jsonb_typeof(p.data -> 'acts') = 'array' then p.data -> 'acts' else '[]'::jsonb end) as a(v) where p.col = 'plans' and a.v -> 'ref' ->> 'k' is not null
), n as (
  select plan, w, k, regexp_replace(k, '[^A-Za-z0-9_.-]', '_', 'g') as nombre from k
), c as (
  select plan, w, k, nombre,
    case when nombre ~ '^.+_ev[0-9]+_[0-9]{10,}$' then 'ev' when nombre ~ '^ref_[0-9]{10,}$' then 'ref' else 'otro' end as clase,
    regexp_replace(nombre, '^(.+)_ev([0-9]+)_([0-9]{10,})$', '\1#ev\2#\3') as k_ev
  from n
)
select json_build_object(
  'claves_de_foto_en_planes', count(*),
  'por_clase', (select json_object_agg(clase, cuantas) from (select clase, count(*) as cuantas from c group by 1) t),
  'ev_total', count(*) filter (where clase = 'ev'),
  'ev_clave_reconstruida_exacta', count(*) filter (where clase = 'ev' and k_ev = k),
  'ev_plan_del_nombre_distinto_del_plan_actual', count(*) filter (where clase = 'ev' and regexp_replace(nombre, '^(.+)_ev[0-9]+_[0-9]{10,}$', '\1') <> plan),
  'ref_total', count(*) filter (where clase = 'ref'),
  'ref_clave_reconstruida_exacta', count(*) filter (where clase = 'ref' and 'ref#' || substring(nombre from 5) = k),
  'ejemplos_sin_clase', (select json_agg(left(k, 45)) from (select k from c where clase = 'otro' limit 5) x),
  'ejemplos_ev_no_exactas', (select json_agg(left(k, 45)) from (select k from c where clase = 'ev' and k_ev <> k limit 5) x)
) as auditoria_fotos from c;
