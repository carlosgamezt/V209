-- M-O · W4 (PROPUESTA; fuera de supabase/migrations; NO se aplica sin autorización). PILOTO de lecturas por la Data API: RPC de LECTURA que corren con los privilegios de la PERSONA (SECURITY INVOKER),
-- de modo que la base decide qué filas ve con las políticas RLS de siempre —por permiso (`fel_tiene_permiso`) y por sesión viva (M-L)— y además se acota a la empresa de la sesión (`fel__empresa_actual`).
-- Diferencia con los envoltorios de escritura (M-N, SECURITY DEFINER): aquí NO hay privilegios elevados; si una política o un privilegio faltara, la lectura fallaría o vendría vacía, nunca abriría datos.
-- No concede ningún privilegio nuevo sobre tablas: `authenticated` ya tenía SELECT (migración 3) sobre estas tablas, protegidas por RLS (por permiso + sesión viva).
-- Piloto: clientes, conceptos, establecimientos y las lecturas de «estado» en UNA sola RPC por pantalla (conserva #55: una vuelta en lugar de cuatro).
create or replace function public.fel__empresa_actual() returns uuid language sql stable security definer set search_path = '' as $$ select c.o_empresa from public.fel__ctx() c $$;
revoke all on function public.fel__empresa_actual() from public, anon;
grant execute on function public.fel__empresa_actual() to authenticated;

-- los parámetros de plataforma que la pantalla ya recibe hoy (todas las personas con sesión): `authenticated` NO tiene SELECT sobre la tabla y no se le concede; solo este ayudante devuelve esa lista, nada más
create or replace function public.fel__parametros_lista() returns jsonb language sql stable security definer set search_path = '' as $$
  select case when public.fel__sesion_viva() then (select coalesce(jsonb_agg(to_jsonb(t) order by t.clave), '[]'::jsonb) from (select p.clave, p.valor::text as valor from public.plataforma_parametros p) t) else null end
$$;
revoke all on function public.fel__parametros_lista() from public, anon;
grant execute on function public.fel__parametros_lista() to authenticated;

-- RENDIMIENTO de la RLS: `fel_tiene_permiso(empresa_id, …)` se evalúa POR FILA (varias lecturas de tablas cada vez). Para las tablas piloto la política pasa a un conjunto de empresas calculado UNA vez por consulta
-- (solo las membresías de la persona; misma semántica exacta: fel_permisos_efectivos solo concede por membresía activa de empresa habilitada). Mismos permisos, mismas filas; solo cambia el costo.
create or replace function public.fel__empresas_con_permiso(p_permiso text) returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.empresa_id from public.miembros m where m.user_id = auth.uid() and m.activo and public.fel_tiene_permiso(m.empresa_id, p_permiso)
$$;
revoke all on function public.fel__empresas_con_permiso(text) from public, anon;
grant execute on function public.fel__empresas_con_permiso(text) to authenticated;
drop policy if exists clientes_leer on public.clientes;
create policy clientes_leer on public.clientes for select to authenticated using (empresa_id in (select public.fel__empresas_con_permiso('clientes.ver')));
drop policy if exists conceptos_leer on public.conceptos;
create policy conceptos_leer on public.conceptos for select to authenticated using (empresa_id in (select public.fel__empresas_con_permiso('conceptos.ver')));
drop policy if exists establecimientos_leer on public.establecimientos;
create policy establecimientos_leer on public.establecimientos for select to authenticated using (empresa_id in (select public.fel__empresas_con_permiso('establecimientos.ver')));

create or replace function api.clientes_listar() returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.nombre), '[]'::jsonb) from (
    select c.id, c.tipo_identificacion, c.numero_identificacion, c.nombre, c.direccion, c.email, c.telefono, c.activo, c.version, c.frecuente,
           (select count(*)::int from public.documentos d where d.cliente_id = c.id and d.empresa_id = c.empresa_id) as facturas
      from public.clientes c where c.empresa_id = public.fel__empresa_actual()) t
$$;
create or replace function api.conceptos_listar() returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.descripcion), '[]'::jsonb) from (
    select c.id, c.codigo, c.descripcion, c.tipo, c.unidad_medida, c.precio_unitario::text as precio_unitario, c.activo, c.version
      from public.conceptos c where c.empresa_id = public.fel__empresa_actual()) t
$$;
create or replace function api.establecimientos_listar() returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.codigo_sat), '[]'::jsonb) from (
    select x.id, x.codigo_sat, x.nombre, x.direccion, x.estado,
           (select count(*)::int from public.documentos d where d.establecimiento_id = x.id and d.empresa_id = x.empresa_id) as documentos
      from public.establecimientos x where x.empresa_id = public.fel__empresa_actual()) t
$$;
-- «estado» de la pantalla de facturación en una sola vuelta: los mismos cuatro conjuntos que hoy se leen en lote por el pooler (activos y ordenados igual)
create or replace function api.estado_catalogos() returns jsonb language sql stable security invoker set search_path = '' as $$
  with e as (select public.fel__empresa_actual() as id)
  select jsonb_build_object(
    'establecimientos', (select coalesce(jsonb_agg(to_jsonb(t) order by t.codigo_sat), '[]'::jsonb) from (select x.id, x.codigo_sat, x.nombre from public.establecimientos x, e where x.empresa_id = e.id and x.estado = 'activo') t),
    'clientes', (select coalesce(jsonb_agg(to_jsonb(t) order by t.frecuente desc, t.nombre), '[]'::jsonb) from (select c.id, c.tipo_identificacion, c.numero_identificacion, c.nombre, c.direccion, c.email, c.telefono, c.frecuente from public.clientes c, e where c.empresa_id = e.id and c.activo) t),
    'conceptos', (select coalesce(jsonb_agg(to_jsonb(t) order by t.descripcion), '[]'::jsonb) from (select c.id, c.codigo, c.descripcion, c.tipo, c.unidad_medida, c.precio_unitario::text as precio_unitario from public.conceptos c, e where c.empresa_id = e.id and c.activo) t),
    'parametros', public.fel__parametros_lista())
$$;
revoke all on function api.clientes_listar(), api.conceptos_listar(), api.establecimientos_listar(), api.estado_catalogos() from public, anon;
grant execute on function api.clientes_listar(), api.conceptos_listar(), api.establecimientos_listar(), api.estado_catalogos() to authenticated;
