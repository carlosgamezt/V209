-- M-U · Paginación de clientes y conceptos (PROPUESTA; fuera de supabase/migrations; NO se aplica sin autorización). Mismo patrón que M-O (RPC INVOKER + RLS + empresa de la sesión). Sin privilegios nuevos.
--  · `api.clientes_pagina` / `api.conceptos_pagina`: página y total en el servidor, con los MISMOS filtros que la interfaz (búsqueda por identificación+nombre o código+descripción, tipo, frecuentes, inactivos).
--  · `api.estado_catalogos` (reemplaza a la de M-O): entrega un CONJUNTO DE TRABAJO acotado (clientes: frecuentes primero y luego por nombre, máx. 500; conceptos: máx. 1 000) más los totales. Con menos registros que el tope la respuesta es idéntica a la de M-O.
create or replace function api.clientes_pagina(p_filtros jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_e uuid := public.fel__empresa_actual(); v_q text := nullif(btrim(coalesce(p_filtros ->> 'q', '')), ''); v_tipo text := coalesce(nullif(p_filtros ->> 'tipo', ''), 'todos'); v_frec boolean := coalesce((p_filtros ->> 'frecuentes')::boolean, false); v_inact boolean := coalesce((p_filtros ->> 'inactivos')::boolean, false);
  v_tam int := least(greatest(coalesce((p_filtros ->> 'tam')::int, 5), 1), 100); v_pag int := greatest(coalesce((p_filtros ->> 'pagina')::int, 1), 1); v_lk text; v_total int; v_paginas int; v_items jsonb; v_cont jsonb;
begin
  if v_tipo not in ('todos', 'empresa', 'persona', 'cf') then v_tipo := 'todos'; end if;
  if v_q is not null then v_lk := '%' || replace(replace(replace(lower(v_q), '\', '\\'), '%', '\%'), '_', '\_') || '%'; end if;
  select jsonb_build_object('registrados', count(*) filter (where activo)::int, 'frecuentes', count(*) filter (where activo and frecuente)::int, 'empresas', count(*) filter (where activo and tipo_identificacion = 'NIT')::int, 'personas', count(*) filter (where activo and tipo_identificacion <> 'NIT')::int)
    into v_cont from public.clientes where empresa_id = v_e;
  select count(*)::int into v_total from public.clientes c where c.empresa_id = v_e and (v_inact or c.activo) and (not v_frec or c.frecuente) and (v_lk is null or lower(c.numero_identificacion || ' ' || c.nombre) like v_lk)
     and case v_tipo when 'empresa' then c.tipo_identificacion = 'NIT' when 'persona' then c.tipo_identificacion not in ('NIT', 'CF') when 'cf' then c.tipo_identificacion = 'CF' else true end;
  v_paginas := greatest(1, ceil(v_total::numeric / v_tam)::int); v_pag := least(v_pag, v_paginas);
  select coalesce(jsonb_agg(to_jsonb(t) order by t.nombre), '[]'::jsonb) into v_items from (
    select c.id, c.tipo_identificacion, c.numero_identificacion, c.nombre, c.direccion, c.email, c.telefono, c.activo, c.version, c.frecuente,
           (select count(*)::int from public.documentos d where d.cliente_id = c.id and d.empresa_id = c.empresa_id) as facturas
      from public.clientes c where c.empresa_id = v_e and (v_inact or c.activo) and (not v_frec or c.frecuente) and (v_lk is null or lower(c.numero_identificacion || ' ' || c.nombre) like v_lk)
       and case v_tipo when 'empresa' then c.tipo_identificacion = 'NIT' when 'persona' then c.tipo_identificacion not in ('NIT', 'CF') when 'cf' then c.tipo_identificacion = 'CF' else true end
     order by c.nombre limit v_tam offset (v_pag - 1) * v_tam) t;
  return jsonb_build_object('items', v_items, 'total', v_total, 'pagina', v_pag, 'paginas', v_paginas, 'tam', v_tam, 'conteos', v_cont);
end $$;
create or replace function api.conceptos_pagina(p_filtros jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_e uuid := public.fel__empresa_actual(); v_q text := nullif(btrim(coalesce(p_filtros ->> 'q', '')), ''); v_tipo text := coalesce(nullif(p_filtros ->> 'tipo', ''), 'todos'); v_inact boolean := coalesce((p_filtros ->> 'inactivos')::boolean, false);
  v_tam int := least(greatest(coalesce((p_filtros ->> 'tam')::int, 50), 1), 100); v_pag int := greatest(coalesce((p_filtros ->> 'pagina')::int, 1), 1); v_lk text; v_total int; v_paginas int; v_items jsonb;
begin
  if v_tipo not in ('todos', 'bien', 'servicio') then v_tipo := 'todos'; end if;
  if v_q is not null then v_lk := '%' || replace(replace(replace(lower(v_q), '\', '\\'), '%', '\%'), '_', '\_') || '%'; end if;
  select count(*)::int into v_total from public.conceptos c where c.empresa_id = v_e and (v_inact or c.activo) and (v_tipo = 'todos' or c.tipo = v_tipo) and (v_lk is null or lower(c.codigo || ' ' || c.descripcion) like v_lk);
  v_paginas := greatest(1, ceil(v_total::numeric / v_tam)::int); v_pag := least(v_pag, v_paginas);
  select coalesce(jsonb_agg(to_jsonb(t) order by t.descripcion), '[]'::jsonb) into v_items from (
    select c.id, c.codigo, c.descripcion, c.tipo, c.unidad_medida, c.precio_unitario::text as precio_unitario, c.activo, c.version from public.conceptos c
     where c.empresa_id = v_e and (v_inact or c.activo) and (v_tipo = 'todos' or c.tipo = v_tipo) and (v_lk is null or lower(c.codigo || ' ' || c.descripcion) like v_lk) order by c.descripcion limit v_tam offset (v_pag - 1) * v_tam) t;
  return jsonb_build_object('items', v_items, 'total', v_total, 'pagina', v_pag, 'paginas', v_paginas, 'tam', v_tam);
end $$;
create or replace function api.estado_catalogos() returns jsonb language sql stable security invoker set search_path = '' as $$
  with e as (select public.fel__empresa_actual() as id)
  select jsonb_build_object(
    'establecimientos', (select coalesce(jsonb_agg(to_jsonb(t) order by t.codigo_sat), '[]'::jsonb) from (select x.id, x.codigo_sat, x.nombre from public.establecimientos x, e where x.empresa_id = e.id and x.estado = 'activo') t),
    'clientes', (select coalesce(jsonb_agg(to_jsonb(t) order by t.frecuente desc, t.nombre), '[]'::jsonb) from (select c.id, c.tipo_identificacion, c.numero_identificacion, c.nombre, c.direccion, c.email, c.telefono, c.frecuente from public.clientes c, e where c.empresa_id = e.id and c.activo order by c.frecuente desc, c.nombre limit 500) t),
    'clientes_total', (select count(*)::int from public.clientes c, e where c.empresa_id = e.id and c.activo),
    'conceptos', (select coalesce(jsonb_agg(to_jsonb(t) order by t.descripcion), '[]'::jsonb) from (select c.id, c.codigo, c.descripcion, c.tipo, c.unidad_medida, c.precio_unitario::text as precio_unitario from public.conceptos c, e where c.empresa_id = e.id and c.activo order by c.descripcion limit 1000) t),
    'conceptos_total', (select count(*)::int from public.conceptos c, e where c.empresa_id = e.id and c.activo),
    'parametros', public.fel__parametros_lista())
$$;
revoke all on function api.clientes_pagina(jsonb), api.conceptos_pagina(jsonb), api.estado_catalogos() from public, anon;
grant execute on function api.clientes_pagina(jsonb), api.conceptos_pagina(jsonb), api.estado_catalogos() to authenticated;
