-- Verificacion de solo lectura: prueba la funcion DESPLEGADA nexa_foto_acceso con cada una de las fotos referenciadas por los planes existentes, tal como la app arma los argumentos desde el nombre del archivo.
-- Se ejecuta sin sesion de persona, por eso mide el RECONOCIMIENTO de cada foto (¿algun plan la referencia o existe el plan de su nombre?) y no los permisos por persona (esos los comprueba la propia migracion con los 55 perfiles reales).
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
    regexp_replace(nombre, '^(.+)_ev([0-9]+)_([0-9]{10,})$', '\1#ev\2#\3') as k_arg
  from n
), r as (
  select c.*,
    case clase when 'ev' then public.nexa_foto_acceso('ev', plan_del_nombre, k_arg, false) when 'ref' then public.nexa_foto_acceso('ref', null, 'ref#' || substring(nombre from 5), false) else false end as lectura_ok,
    case clase when 'ev' then public.nexa_foto_acceso('ev', plan_del_nombre, null, true) else null end as escritura_plan_ok
  from c
)
select json_build_object(
  'fotos_en_planes', count(*),
  'reconocidas_para_lectura', count(*) filter (where lectura_ok),
  'no_reconocidas_para_lectura', count(*) filter (where not lectura_ok),
  'evidencias', count(*) filter (where clase = 'ev'),
  'evidencias_con_escritura_resuelta_por_el_nombre', count(*) filter (where clase = 'ev' and escritura_plan_ok),
  'referencias', count(*) filter (where clase = 'ref'),
  'las_tres_automaticas', (select json_agg(json_build_object('plan_con_espacios', plan like '% %', 'lectura', lectura_ok, 'escritura', escritura_plan_ok)) from r where plan like '% - AUTO%'),
  'planes_cuyo_numero_saneado_se_repite', (select count(*) from (select regexp_replace(id, '[^A-Za-z0-9_.-]', '_', 'g') as s from public.pa_docs where col = 'plans' group by 1 having count(*) > 1) d),
  'planes_totales', (select count(*) from public.pa_docs where col = 'plans'),
  'planes_con_espacios_o_simbolos_en_el_numero', (select count(*) from public.pa_docs where col = 'plans' and id <> regexp_replace(id, '[^A-Za-z0-9_.-]', '_', 'g'))
) as fotos_funcion from r;
