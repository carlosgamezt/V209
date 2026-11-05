select json_build_object(
 'asignaciones', (select coalesce(json_agg(x), '[]'::json) from (select branch_user_id, encargado_nombre, monto, desde, hasta, creado_por from pa_ff_asignaciones order by desde desc) x),
 'sucursales_r2', (select coalesce(json_agg(y), '[]'::json) from (select id, data->>'branch' as sucursal, data->>'name' as nombre, data->>'region' as region from pa_docs where col = 'users' and data->>'role' = 'sucursal' and data->>'region' = '2' order by 2) y)
) as r;
