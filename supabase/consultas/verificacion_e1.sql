-- Verificación de integridad de miniaturas (SOLO LECTURA; una sola sentencia). Ejecutar DESPUÉS de E1 (necesita las funciones de E1 y el respaldo E0). Referencia real de producción (medicion_egress.sql): 386 miniaturas embebidas; si hay llaves repetidas, llaves_distintas_embebidas es menor y pa_thumbs tendrá esa cantidad. Debe dar: faltan_en_pa_thumbs = 0, distintas = 0, respaldo_faltan_en_pa_thumbs = 0.
select json_build_object(
  'miniaturas_embebidas_en_pa_docs', (select count(*) from public.pa_docs d, lateral public.pa_extract_thumbs(d.data) x where d.col = 'plans'),
  'llaves_distintas_embebidas', (select count(distinct x.k) from public.pa_docs d, lateral public.pa_extract_thumbs(d.data) x where d.col = 'plans'),
  'miniaturas_en_pa_thumbs', (select count(*) from public.pa_thumbs),
  'faltan_en_pa_thumbs', (select count(*) from public.pa_docs d, lateral public.pa_extract_thumbs(d.data) x where d.col = 'plans' and not exists (select 1 from public.pa_thumbs p where p.k = x.k)),
  'distintas', (select count(*) from public.pa_docs d, lateral public.pa_extract_thumbs(d.data) x join public.pa_thumbs p on p.k = x.k where d.col = 'plans' and p.t <> x.t),
  'respaldo_miniaturas', (select count(*) from public.pa_docs_respaldo_e0 r, lateral public.pa_extract_thumbs(r.data) x where r.col = 'plans'),
  'respaldo_faltan_en_pa_thumbs', (select count(*) from public.pa_docs_respaldo_e0 r, lateral public.pa_extract_thumbs(r.data) x where r.col = 'plans' and not exists (select 1 from public.pa_thumbs p where p.k = x.k and p.t = x.t)),
  'huella_miniaturas_respaldo', (select md5(coalesce(string_agg(x.k || md5(x.t), '' order by x.k), '')) from public.pa_docs_respaldo_e0 r, lateral public.pa_extract_thumbs(r.data) x where r.col = 'plans'),
  'huella_pa_thumbs_de_esas_llaves', (select md5(coalesce(string_agg(p.k || md5(p.t), '' order by p.k), '')) from public.pa_thumbs p where p.k in (select x.k from public.pa_docs_respaldo_e0 r, lateral public.pa_extract_thumbs(r.data) x where r.col = 'plans')),
  'planes_sin_fotos_en_vista_ligera', (select count(*) from public.pa_docs_lite where col = 'plans' and data::text like '%data:image/%'),
  'planes', (select count(*) from public.pa_docs where col = 'plans'),
  'planes_respaldo', (select count(*) from public.pa_docs_respaldo_e0 where col = 'plans')
) as verificacion;
