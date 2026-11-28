-- Medición de volumen para el diagnóstico de Egress (SOLO LECTURA; una sola sentencia). Se ejecuta con el flujo «Consulta Supabase» (archivo: medicion_egress.sql) o en el editor SQL.
-- Entrega: tamaño de pa_docs por tipo, peso de las miniaturas Base64 dentro de los planes, planes más pesados, avisos, tablas más grandes, arqueos, tareas programadas (cron),
-- publicación de Realtime y las políticas/disparadores de pa_docs (necesarios para validar la migración de miniaturas). No modifica nada.
select json_build_object(
  'pa_docs_por_col', (select json_agg(x) from (select col, count(*) as filas, round(avg(octet_length(data::text))) as bytes_medio, max(octet_length(data::text)) as bytes_max, round(sum(octet_length(data::text)) / 1048576.0, 2) as mb_total from public.pa_docs group by col order by 5 desc) x),
  'planes_miniaturas', (select json_build_object('planes', count(*), 'con_imagen_embebida', count(*) filter (where data::text like '%data:image/%'),
        'mb_planes', round(sum(octet_length(data::text)) / 1048576.0, 2),
        'mb_sin_imagenes', round(sum(octet_length(regexp_replace(data::text, '"t": ?"data:image/[^"]*"', '"t": ""', 'g'))) / 1048576.0, 2),
        'miniaturas_total', (select coalesce(sum((length(data::text) - length(replace(data::text, '"data:image/', ''))) / 12), 0) from public.pa_docs where col = 'plans')) from public.pa_docs where col = 'plans'),
  'planes_mas_pesados', (select json_agg(x) from (select id, round(octet_length(data::text) / 1024.0) as kb, jsonb_array_length(coalesce(data -> 'acts', '[]'::jsonb)) as actividades from public.pa_docs where col = 'plans' order by octet_length(data::text) desc limit 10) x),
  'avisos', (select json_build_object('total', count(*), 'leidos_por_todos', count(*) filter (where (data -> 'to') <@ (data -> 'read')), 'leidos_y_con_mas_de_45_dias', count(*) filter (where updated_at < now() - interval '45 days' and (data -> 'to') <@ (data -> 'read'))) from public.pa_docs where col = 'notifs'),
  'tablas_mas_grandes', (select json_agg(x) from (select relname, n_live_tup as filas, pg_total_relation_size(relid) as bytes from pg_stat_user_tables order by 3 desc limit 15) x),
  'arqueos', (select json_build_object('versiones', count(*), 'bytes_data_medio', round(avg(octet_length(data::text))), 'mb_data', round(sum(octet_length(data::text)) / 1048576.0, 2)) from public.pa_arqueos),
  'descargas', (select count(*) from public.pa_descargas),
  'supervision_mensual', (select count(*) from public.supervision_mensual),
  'cron', (select json_agg(x) from (select jobid, jobname, schedule, active from cron.job order by jobid) x),
  'realtime_tablas', (select json_agg(x) from (select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime') x),
  'pa_docs_politicas', (select json_agg(x) from (select policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'pa_docs') x),
  'pa_docs_disparadores', (select json_agg(x) from (select tgname, pg_get_triggerdef(oid) as definicion from pg_trigger where tgrelid = 'public.pa_docs'::regclass and not tgisinternal) x),
  'pa_docs_columnas', (select json_agg(x) from (select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = 'pa_docs' order by ordinal_position) x)
) as medicion;
