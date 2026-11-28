-- Verificacion de solo lectura de las 386 fotos con la logica de super-api: el servidor resuelve el numero REAL del plan desde el nombre del archivo y la funcion SQL desplegada (nexa_foto_acceso) recibe numero y clave exactos.
-- Sin sesion de persona mide el RECONOCIMIENTO (¿algun plan referencia la foto?); los permisos por persona los comprueba la migracion con los 55 perfiles reales.
with k as (
  select p.id as plan, a.v -> 'ev' ->> 'k' as k, 'ev' as w from public.pa_docs p, jsonb_array_elements(case when jsonb_typeof(p.data -> 'acts') = 'array' then p.data -> 'acts' else '[]'::jsonb end) as a(v) where p.col = 'plans' and a.v -> 'ev' ->> 'k' is not null
  union all
  select p.id, a.v -> 'ref' ->> 'k', 'ref' from public.pa_docs p, jsonb_array_elements(case when jsonb_typeof(p.data -> 'acts') = 'array' then p.data -> 'acts' else '[]'::jsonb end) as a(v) where p.col = 'plans' and a.v -> 'ref' ->> 'k' is not null
), n as (
  select plan, w, k, regexp_replace(k, '[^A-Za-z0-9_.-]', '_', 'g') as nombre from k
), c as (
  select plan, w, k, nombre,
    case when nombre ~ '^.+_ev[0-9]+_[0-9]{10,}$' then 'ev' when nombre ~ '^ref_[0-9]{10,}$' then 'ref' else 'otro' end as clase,
    regexp_replace(nombre, '^(.+)_ev([0-9]+)_([0-9]{10,})$', '\1') as plan_del_nombre,
    regexp_replace(nombre, '^.+_ev([0-9]+)_([0-9]{10,})$', '#ev\1#\2') as sufijo
  from n
), r as (
  select c.*,
    (select array_agg(id) from public.pa_docs where col = 'plans' and regexp_replace(id, '[^A-Za-z0-9_.-]', '_', 'g') = c.plan_del_nombre) as candidatos
  from c
), s as (
  select r.*,
    case when clase = 'ev' then coalesce((select bool_or(public.nexa_foto_acceso('ev', cid, cid || sufijo, false)) from unnest(candidatos) as cid), false)
         when clase = 'ref' then public.nexa_foto_acceso('ref', null, 'ref#' || substring(nombre from 5), false) else false end as lectura_ok,
    case when clase = 'ev' then coalesce((select bool_or(public.nexa_foto_acceso('ev', cid, null, true)) from unnest(candidatos) as cid), false) end as escritura_resuelta
  from r
)
select json_build_object(
  'fotos_en_planes', count(*),
  'reconocidas_para_lectura', count(*) filter (where lectura_ok),
  'no_reconocidas_para_lectura', count(*) filter (where not lectura_ok),
  'evidencias', count(*) filter (where clase = 'ev'),
  'evidencias_con_plan_resuelto_de_forma_unica', count(*) filter (where clase = 'ev' and cardinality(candidatos) = 1 and candidatos[1] = plan),
  'evidencias_con_plan_ambiguo_o_inexistente', count(*) filter (where clase = 'ev' and (candidatos is null or cardinality(candidatos) <> 1 or candidatos[1] <> plan)),
  'evidencias_con_escritura_resuelta', count(*) filter (where clase = 'ev' and escritura_resuelta),
  'referencias', count(*) filter (where clase = 'ref'),
  'las_tres_evidencias_de_planes_automaticos', (select json_agg(json_build_object('lectura', lectura_ok, 'plan_unico', cardinality(candidatos) = 1)) from s where clase = 'ev' and plan like '% - AUTO%'),
  'planes_cuyo_numero_saneado_se_repite', (select count(*) from (select regexp_replace(id, '[^A-Za-z0-9_.-]', '_', 'g') as x from public.pa_docs where col = 'plans' group by 1 having count(*) > 1) d),
  'planes_totales', (select count(*) from public.pa_docs where col = 'plans')
) as fotos_funcion from s;
