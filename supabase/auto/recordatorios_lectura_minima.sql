-- Egress/CPU de las tareas programadas: en vez de bajar cada plan completo (aunque sea por la vista ligera, 296 KB), la función pide SOLO los campos que usa
-- (id, estado, región, sucursal, tipo, envío, y por actividad: estado, fecha límite, entregada y marcas 'a'/'e' de su línea de tiempo) y SOLO los planes que pueden generar un aviso o contador en ese modo.
-- SECURITY INVOKER: la ejecuta la función con la llave de servicio (RLS no se debilita); nadie más puede ejecutarla.
create or replace function public.nexa_recordatorios_planes(p_modo text default 'badge') returns jsonb
language sql stable security invoker set search_path = '' as $f$
  select coalesce(jsonb_agg(x.m order by x.id), '[]'::jsonb) from (
    select d.id,
      jsonb_build_object(
        'id', d.data -> 'id', 'status', d.data -> 'status', 'region', d.data -> 'region', 'branch', d.data -> 'branch',
        'type', d.data -> 'type', 'sent', d.data -> 'sent', 'sentAt', d.data -> 'sentAt',
        'acts', (select coalesce(jsonb_agg(jsonb_build_object(
                    'st', a.v -> 'st', 'deadline', a.v -> 'deadline', 'dr', a.v -> 'dr',
                    'tl', (select coalesce(jsonb_agg(e.v), '[]'::jsonb)
                           from jsonb_array_elements(case when jsonb_typeof(a.v -> 'tl') = 'array' then a.v -> 'tl' else '[]'::jsonb end) as e(v)
                           where jsonb_typeof(e.v) = 'array' and e.v ->> 0 in ('a', 'e'))
                  )), '[]'::jsonb)
                 from jsonb_array_elements(case when jsonb_typeof(d.data -> 'acts') = 'array' then d.data -> 'acts' else '[]'::jsonb end) as a(v)
                 where jsonb_typeof(a.v) = 'object')
      ) as m
    from public.pa_docs d
    where d.col = 'plans' and jsonb_typeof(d.data) = 'object' and (
      d.data ->> 'status' = 'En proceso'
      or (p_modo <> 'recordatorios' and d.data ->> 'type' = 'Inventarios' and d.data ->> 'status' = 'Completado')
      or (p_modo = 'badge' and exists (
            select 1 from jsonb_array_elements(case when jsonb_typeof(d.data -> 'acts') = 'array' then d.data -> 'acts' else '[]'::jsonb end) as q(v)
            where q.v ->> 'st' = 'Enviada'))
    )
  ) x
$f$;
revoke all on function public.nexa_recordatorios_planes(text) from public, anon, authenticated;
grant execute on function public.nexa_recordatorios_planes(text) to service_role;
select json_build_object(
  'paso', 'lectura minima para tareas programadas',
  'anon_puede_ejecutar', has_function_privilege('anon', 'public.nexa_recordatorios_planes(text)', 'execute'),
  'authenticated_puede_ejecutar', has_function_privilege('authenticated', 'public.nexa_recordatorios_planes(text)', 'execute'),
  'service_role_puede_ejecutar', has_function_privilege('service_role', 'public.nexa_recordatorios_planes(text)', 'execute')
) as lectura_minima;
