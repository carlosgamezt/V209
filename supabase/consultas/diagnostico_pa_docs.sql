-- Diagnóstico (solo lectura) del error pa_docs_pkey al crear planes: ¿existe pa_next_seq?, último número y últimos planes creados.
select json_build_object(
  'pa_next_seq_existe', exists(select 1 from pg_proc where proname = 'pa_next_seq'),
  'max_2026', (select max(((regexp_match(id, '^PA-2026-(\d+)'))[1])::int) from pa_docs where col = 'plans'),
  'planes_2026', (select count(*) from pa_docs where col = 'plans' and id like 'PA-2026-%'),
  'ultimos', (select json_agg(x) from (select id, data->>'by' as por, data->>'byId' as por_id, to_timestamp((data->>'created')::bigint/1000) as creado from pa_docs where col = 'plans' order by (data->>'created')::bigint desc limit 15) x),
  'perfiles_operaciones', (select json_agg(r) from (select user_id, role from pa_profiles where user_id ilike '%oper%') r)
) as diagnostico;
