-- Reversión de M-U: retira las RPC paginadas y restituye `api.estado_catalogos` de M-O (sin tope ni totales).
\set ON_ERROR_STOP on
begin;
drop function if exists api.clientes_pagina(jsonb), api.conceptos_pagina(jsonb);
create or replace function api.estado_catalogos() returns jsonb language sql stable security invoker set search_path = '' as $$
  with e as (select public.fel__empresa_actual() as id)
  select jsonb_build_object(
    'establecimientos', (select coalesce(jsonb_agg(to_jsonb(t) order by t.codigo_sat), '[]'::jsonb) from (select x.id, x.codigo_sat, x.nombre from public.establecimientos x, e where x.empresa_id = e.id and x.estado = 'activo') t),
    'clientes', (select coalesce(jsonb_agg(to_jsonb(t) order by t.frecuente desc, t.nombre), '[]'::jsonb) from (select c.id, c.tipo_identificacion, c.numero_identificacion, c.nombre, c.direccion, c.email, c.telefono, c.frecuente from public.clientes c, e where c.empresa_id = e.id and c.activo) t),
    'conceptos', (select coalesce(jsonb_agg(to_jsonb(t) order by t.descripcion), '[]'::jsonb) from (select c.id, c.codigo, c.descripcion, c.tipo, c.unidad_medida, c.precio_unitario::text as precio_unitario from public.conceptos c, e where c.empresa_id = e.id and c.activo) t),
    'parametros', public.fel__parametros_lista())
$$;
commit;
