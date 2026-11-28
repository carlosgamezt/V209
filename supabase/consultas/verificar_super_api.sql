-- Verificacion de solo lectura tras publicar super-api: respuestas de la prueba de humo, permisos de las funciones SQL y contadores del aviso fijo calculados en la base.
select json_build_object(
  'respuestas_humo', (select json_agg(r) from (select id, status_code, timed_out, left(content, 120) as respuesta from net._http_response order by id desc limit 3) r),
  'foto_acceso', json_build_object('existe', to_regprocedure('public.nexa_foto_acceso(text,text,text,boolean)') is not null,
     'anon_ejecuta', has_function_privilege('anon', 'public.nexa_foto_acceso(text,text,text,boolean)', 'execute'), 'authenticated_ejecuta', has_function_privilege('authenticated', 'public.nexa_foto_acceso(text,text,text,boolean)', 'execute')),
  'push_pendientes', json_build_object('existe', to_regprocedure('public.nexa_push_pendientes(text[])') is not null,
     'anon_ejecuta', has_function_privilege('anon', 'public.nexa_push_pendientes(text[])', 'execute'), 'authenticated_ejecuta', has_function_privilege('authenticated', 'public.nexa_push_pendientes(text[])', 'execute'), 'service_role_ejecuta', has_function_privilege('service_role', 'public.nexa_push_pendientes(text[])', 'execute')),
  'contadores_del_aviso_fijo', (select json_build_object('usuarios_con_contador', count(*), 'con_pendientes', count(*) filter (where v::int > 0), 'suma', coalesce(sum(v::int), 0))
     from jsonb_each_text(public.nexa_push_pendientes((select array_agg(id) from public.pa_docs where col = 'users'))) as t(k, v)),
  'planes_leidos_por_la_funcion_sql_kb', (select round(sum(pg_column_size(data)) / 1024.0) from public.pa_docs where col = 'plans')
) as verificacion;
