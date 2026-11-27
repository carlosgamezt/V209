-- M-S · R3 segunda tanda (PROPUESTA; fuera de supabase/migrations; NO se aplica sin autorización; exige la migración 30 —columnas tipo_dte y referencia_origen— y M-O/M-R). Reutiliza el patrón de M-O: RPC de LECTURA con los privilegios de la persona
-- (SECURITY INVOKER) y RLS por permiso + sesión viva + alcance de establecimiento. Cubre: documentos fiscales (lista paginada y detalle), archivos (metadatos y descarga), reporte de documentos y resumen del panel.
-- NO cubre (queda por el pooler, documentado): reporte de consumos, plan y consumos del plan (necesitan tablas de plataforma como bolson_cuentas: exigen una RPC DEFINER con permiso explícito), operaciones de bolsón/monedero de plataforma.
-- 1) RENDIMIENTO DE LA RLS. Las políticas de lectura evaluaban `fel_tiene_permiso(empresa_id, …)` y `fel_en_alcance(…)` POR FILA (cada una lee varias tablas). Se sustituyen por conjuntos calculados UNA vez por consulta; misma semántica.
create or replace function public.fel__establecimientos_en_alcance() returns setof uuid language sql stable security definer set search_path = '' as $$
  select x::uuid from public.miembros m cross join lateral jsonb_array_elements_text(coalesce(public.fel_alcance(m.empresa_id, m.user_id) -> 'ids', '[]'::jsonb)) x where m.user_id = auth.uid() and m.activo
$$;
create or replace function public.fel__empresas_alcance_total() returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.empresa_id from public.miembros m where m.user_id = auth.uid() and m.activo and coalesce((public.fel_alcance(m.empresa_id, m.user_id) ->> 'todos')::boolean, false)
$$;
revoke all on function public.fel__establecimientos_en_alcance(), public.fel__empresas_alcance_total() from public, anon;
grant execute on function public.fel__establecimientos_en_alcance(), public.fel__empresas_alcance_total() to authenticated;
drop policy if exists documentos_leer on public.documentos;
create policy documentos_leer on public.documentos for select to authenticated using (empresa_id in (select public.fel__empresas_con_permiso('borradores.ver')));
drop policy if exists documentos_alcance_leer on public.documentos;
create policy documentos_alcance_leer on public.documentos as restrictive for select to authenticated using (
  (select not public.fel__establecimiento_por_usuario()) or empresa_id in (select public.fel__empresas_alcance_total()) or establecimiento_id in (select public.fel__establecimientos_en_alcance()));
drop policy if exists doc_lineas_leer on public.documento_lineas;
create policy doc_lineas_leer on public.documento_lineas for select to authenticated using (empresa_id in (select public.fel__empresas_con_permiso('borradores.ver')));
drop policy if exists operaciones_leer on public.operaciones_fiscales;
create policy operaciones_leer on public.operaciones_fiscales for select to authenticated using (empresa_id in (select public.fel__empresas_con_permiso('historial.ver')));
drop policy if exists eventos_leer on public.eventos_proveedor;
create policy eventos_leer on public.eventos_proveedor for select to authenticated using (empresa_id in (select public.fel__empresas_con_permiso('fiscal.ver')));
drop policy if exists conciliaciones_leer on public.conciliaciones;
create policy conciliaciones_leer on public.conciliaciones for select to authenticated using (empresa_id in (select public.fel__empresas_con_permiso('fiscal.ver')));
drop policy if exists alertas_leer on public.alertas_fiscales;
create policy alertas_leer on public.alertas_fiscales for select to authenticated using (empresa_id in (select public.fel__empresas_con_permiso('fiscal.ver')));
-- 2) ARCHIVOS: la persona puede leer los METADATOS (como hoy en el detalle) pero NUNCA la columna `contenido` por la Data API (grant por columnas); la descarga pasa por una RPC con permiso explícito.
revoke all on public.artefactos_documento from authenticated;
grant select (id, empresa_id, documento_id, operacion_id, tipo, nombre, mime, sha256, tamano, creado_en) on public.artefactos_documento to authenticated;
drop policy if exists artefactos_meta_leer on public.artefactos_documento;
create policy artefactos_meta_leer on public.artefactos_documento for select to authenticated using (empresa_id in (select public.fel__empresas_con_permiso('borradores.ver')));
-- 3) RPC de lectura (INVOKER: la RLS decide qué filas ve la persona y todo se acota a SU empresa). Formas idénticas a las consultas del servidor (numéricos como texto).
create or replace function api.documento_detalle(p_id uuid) returns jsonb language sql stable security invoker set search_path = '' as $$
  with e as (select public.fel__empresa_actual() as id)
  select jsonb_build_object(
    'documento', (select to_jsonb(d) || jsonb_build_object('subtotal', d.subtotal::text, 'descuento_total', d.descuento_total::text, 'base_imponible', d.base_imponible::text, 'total', d.total::text, 'fecha_emision_txt', d.fecha_emision_prevista::text,
        'cliente_nombre', c.nombre, 'cliente_email', c.email, 'cliente_tipo', c.tipo_identificacion, 'cliente_numero', c.numero_identificacion, 'establecimiento_nombre', es.nombre, 'establecimiento_codigo', es.codigo_sat)
      from public.documentos d left join public.clientes c on c.id = d.cliente_id and c.empresa_id = d.empresa_id left join public.establecimientos es on es.id = d.establecimiento_id and es.empresa_id = d.empresa_id, e where d.id = p_id and d.empresa_id = e.id),
    'lineas', (select coalesce(jsonb_agg(jsonb_build_object('orden', l.orden, 'descripcion', l.descripcion, 'cantidad', l.cantidad::text, 'precio_unitario', l.precio_unitario::text, 'descuento_tipo', l.descuento_tipo, 'descuento_valor', l.descuento_valor::text, 'importes', l.importes) order by l.orden), '[]'::jsonb)
      from public.documento_lineas l, e where l.documento_id = p_id and l.empresa_id = e.id),
    'operaciones', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'tipo', o.tipo, 'estado', o.estado, 'proveedor', o.proveedor, 'ambiente', o.ambiente, 'enviada_en', o.enviada_en, 'orden_externa', o.orden_externa, 'resolucion', o.resolucion, 'motivo_desconocido', o.motivo_desconocido, 'reintento_desde', o.reintento_desde, 'iniciada_en', o.iniciada_en, 'resuelta_en', o.resuelta_en, 'clave_idempotencia', o.clave_idempotencia) order by o.iniciada_en, o.id), '[]'::jsonb)
      from public.operaciones_fiscales o, e where o.documento_id = p_id and o.empresa_id = e.id),
    'eventos', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'operacion_id', v.operacion_id, 'tipo', v.tipo, 'resultado', v.resultado, 'motivo', v.motivo, 'serie', v.serie, 'numero', v.numero, 'autorizacion', v.autorizacion, 'creado_en', v.creado_en) order by v.id), '[]'::jsonb)
      from public.eventos_proveedor v, e where v.empresa_id = e.id and v.operacion_id in (select o.id from public.operaciones_fiscales o where o.documento_id = p_id and o.empresa_id = e.id)),
    'conciliaciones', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'operacion_id', k.operacion_id, 'tipo', k.tipo, 'estado', k.estado, 'evidencia', k.evidencia, 'propuesta_por', k.propuesta_por, 'propuesta_en', k.propuesta_en, 'decidida_por', k.decidida_por, 'decidida_en', k.decidida_en, 'nota', k.nota) order by k.propuesta_en), '[]'::jsonb)
      from public.conciliaciones k, e where k.empresa_id = e.id and k.operacion_id in (select o.id from public.operaciones_fiscales o where o.documento_id = p_id and o.empresa_id = e.id)),
    'alertas', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'operacion_id', a.operacion_id, 'tipo', a.tipo, 'detalle', a.detalle, 'creada_en', a.creada_en, 'resuelta_en', a.resuelta_en, 'nota', a.nota) order by a.creada_en), '[]'::jsonb)
      from public.alertas_fiscales a, e where a.documento_id = p_id and a.empresa_id = e.id),
    'artefactos', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'operacion_id', f.operacion_id, 'tipo', f.tipo, 'nombre', f.nombre, 'mime', f.mime, 'sha256', f.sha256, 'tamano', f.tamano) order by f.tipo), '[]'::jsonb)
      from public.artefactos_documento f, e where f.documento_id = p_id and f.empresa_id = e.id))
$$;
create or replace function api.documentos_listar(p_filtros jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_e uuid := public.fel__empresa_actual(); v_cat text := coalesce(nullif(p_filtros ->> 'categoria', ''), 'todos'); v_q text := nullif(btrim(coalesce(p_filtros ->> 'q', '')), ''); v_tipo text := nullif(p_filtros ->> 'tipo', ''); v_estado text := nullif(p_filtros ->> 'estado', '');
  v_desde date := nullif(p_filtros ->> 'desde', '')::date; v_hasta date := nullif(p_filtros ->> 'hasta', '')::date; v_nit text := nullif(p_filtros ->> 'nit', '');
  v_tam int := least(greatest(coalesce((p_filtros ->> 'tam')::int, 25), 1), 100); v_pagina int := greatest(coalesce((p_filtros ->> 'pagina')::int, 1), 1);
  v_ests uuid[] := case when p_filtros ? 'establecimientos' then array(select jsonb_array_elements_text(p_filtros -> 'establecimientos'))::uuid[] end;
  v_lk text; v_br int; v_nitlk text; n_todos int; n_em int; n_bo int; n_an int; n_pe int; v_total int; v_paginas int; v_items jsonb;
begin
  if v_cat not in ('todos', 'emitidos', 'borradores', 'anulados', 'pendientes') then v_cat := 'todos'; end if;
  if v_q is not null then v_lk := '%' || replace(replace(replace(lower(v_q), '\', '\\'), '%', '\%'), '_', '\_') || '%'; v_br := nullif((regexp_match(v_q, '^BR-?0*(\d{1,9})$', 'i'))[1], '')::int; end if;
  if v_nit is not null then v_nitlk := replace(replace(replace(v_nit, '\', '\\'), '%', '\%'), '_', '\_') || '%'; end if;
  -- conteos por categoría en UNA pasada (con todos los filtros salvo la categoría)
  select count(*)::int, count(*) filter (where d.estado_fiscal = 'certificado')::int, count(*) filter (where d.estado_fiscal = 'ninguno')::int, count(*) filter (where d.estado_fiscal = 'anulado')::int,
         count(*) filter (where d.estado_fiscal in ('pendiente_certificacion', 'por_verificar', 'anulacion_solicitada', 'rechazado') or exists (select 1 from public.alertas_fiscales a where a.documento_id = d.id and a.resuelta_en is null))::int
    into n_todos, n_em, n_bo, n_an, n_pe
    from public.documentos d left join public.clientes c on c.id = d.cliente_id and c.empresa_id = d.empresa_id
   where d.empresa_id = v_e and (v_ests is null or d.establecimiento_id = any (v_ests)) and (v_tipo is null or d.tipo_dte = v_tipo)
     and (v_estado is null or case when v_estado in ('borrador', 'revisado') then d.estado_preparacion = v_estado and d.estado_fiscal = 'ninguno' else d.estado_fiscal = v_estado end)
     and (v_desde is null or d.fecha_emision_prevista >= v_desde) and (v_hasta is null or d.fecha_emision_prevista <= v_hasta) and (v_nitlk is null or c.numero_identificacion like v_nitlk)
     and (v_q is null or lower(c.nombre) like v_lk or lower(coalesce(d.serie, '')) like v_lk or lower(coalesce(d.numero_fiscal, '')) like v_lk or lower(coalesce(d.autorizacion_sat, '')) like v_lk or (v_br is not null and d.numero_borrador = v_br));
  v_total := case v_cat when 'emitidos' then n_em when 'borradores' then n_bo when 'anulados' then n_an when 'pendientes' then n_pe else n_todos end;
  v_paginas := greatest(1, ceil(v_total::numeric / v_tam)::int); v_pagina := least(v_pagina, v_paginas);
  select coalesce(jsonb_agg(to_jsonb(t) order by t.numero_borrador desc), '[]'::jsonb) into v_items from (
    select d.id, d.numero_borrador, d.tipo_dte, d.documento_origen_id, d.referencia_origen ->> 'serie' as origen_serie, d.referencia_origen ->> 'numero' as origen_numero, d.estado_preparacion, d.estado_fiscal, d.fecha_emision_prevista::text as fecha_emision_prevista,
           d.base_imponible::text as base_imponible, d.total::text as total, d.serie, d.numero_fiscal, d.autorizacion_sat, d.version, d.actualizado_en, c.nombre as cliente_nombre, c.numero_identificacion as cliente_nit, es.nombre as establecimiento_nombre,
           (select count(*)::int from public.alertas_fiscales a where a.documento_id = d.id and a.resuelta_en is null) as alertas, uo.proveedor as canal_id, pe.nombre as canal_nombre, uo.ambiente as canal_ambiente, uo.estado as operacion_estado
      from public.documentos d left join public.clientes c on c.id = d.cliente_id and c.empresa_id = d.empresa_id
      left join lateral (select o.proveedor, o.ambiente, o.estado from public.operaciones_fiscales o where o.documento_id = d.id and o.tipo = 'certificacion' order by o.iniciada_en desc, o.id desc limit 1) uo on true
      left join public.proveedores_emision pe on pe.id = uo.proveedor left join public.establecimientos es on es.id = d.establecimiento_id and es.empresa_id = d.empresa_id
     where d.empresa_id = v_e and (v_ests is null or d.establecimiento_id = any (v_ests)) and (v_tipo is null or d.tipo_dte = v_tipo)
       and (v_estado is null or case when v_estado in ('borrador', 'revisado') then d.estado_preparacion = v_estado and d.estado_fiscal = 'ninguno' else d.estado_fiscal = v_estado end)
       and (v_desde is null or d.fecha_emision_prevista >= v_desde) and (v_hasta is null or d.fecha_emision_prevista <= v_hasta) and (v_nitlk is null or c.numero_identificacion like v_nitlk)
       and (v_q is null or lower(c.nombre) like v_lk or lower(coalesce(d.serie, '')) like v_lk or lower(coalesce(d.numero_fiscal, '')) like v_lk or lower(coalesce(d.autorizacion_sat, '')) like v_lk or (v_br is not null and d.numero_borrador = v_br))
       and case v_cat when 'emitidos' then d.estado_fiscal = 'certificado' when 'borradores' then d.estado_fiscal = 'ninguno' when 'anulados' then d.estado_fiscal = 'anulado'
                    when 'pendientes' then (d.estado_fiscal in ('pendiente_certificacion', 'por_verificar', 'anulacion_solicitada', 'rechazado') or exists (select 1 from public.alertas_fiscales a where a.documento_id = d.id and a.resuelta_en is null)) else true end
     order by d.numero_borrador desc limit v_tam offset (v_pagina - 1) * v_tam) t;
  return jsonb_build_object('items', v_items, 'total', v_total, 'pagina', v_pagina, 'paginas', v_paginas, 'tam', v_tam, 'conteos', jsonb_build_object('emitidos', n_em, 'borradores', n_bo, 'anulados', n_an, 'pendientes', n_pe));
end $$;
create or replace function api.panel_resumen() returns jsonb language sql stable security invoker set search_path = '' as $$
  with e as (select public.fel__empresa_actual() as id)
  select jsonb_build_object(
    'documentos', (select jsonb_build_object('total', count(*)::int, 'borradores', (count(*) filter (where estado_preparacion = 'borrador' and estado_fiscal = 'ninguno'))::int, 'revisados', (count(*) filter (where estado_preparacion = 'revisado' and estado_fiscal = 'ninguno'))::int,
        'certificados', (count(*) filter (where estado_fiscal = 'certificado'))::int, 'anulados', (count(*) filter (where estado_fiscal = 'anulado'))::int, 'por_verificar', (count(*) filter (where estado_fiscal = 'por_verificar'))::int,
        'rechazados', (count(*) filter (where estado_fiscal = 'rechazado'))::int, 'base_certificada', coalesce(sum(base_imponible) filter (where estado_fiscal = 'certificado'), 0)::text) from public.documentos, e where empresa_id = e.id),
    'serie', (select jsonb_agg(jsonb_build_object('dia', to_char(g.d, 'YYYY-MM-DD'), 'certificados', coalesce(x.n, 0)::int) order by g.d) from generate_series(current_date - 13, current_date, interval '1 day') as g(d)
        left join (select (resuelta_en at time zone 'America/Guatemala')::date as dia, count(*) as n from public.operaciones_fiscales, e where empresa_id = e.id and tipo = 'certificacion' and estado = 'confirmada_exitosa' group by 1) x on x.dia = g.d::date),
    'clientes', (select coalesce(jsonb_agg(to_jsonb(t) order by t.suma desc), '[]'::jsonb) from (select c.nombre, count(*)::int as documentos, sum(d.base_imponible)::text as base, sum(d.base_imponible) as suma from public.documentos d join public.clientes c on c.id = d.cliente_id and c.empresa_id = d.empresa_id, e
        where d.empresa_id = e.id and d.estado_fiscal = 'certificado' group by c.nombre order by sum(d.base_imponible) desc limit 5) t),
    'pendientes', (select coalesce(jsonb_agg(to_jsonb(t) order by t.actualizado_en desc), '[]'::jsonb) from (select d.id, d.numero_borrador, d.estado_fiscal, d.actualizado_en from public.documentos d, e where d.empresa_id = e.id and (d.estado_fiscal in ('por_verificar', 'pendiente_certificacion')
        or exists (select 1 from public.alertas_fiscales a where a.documento_id = d.id and a.resuelta_en is null)) order by d.actualizado_en desc limit 5) t))
$$;
create or replace function api.reporte_documentos() returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.n), '[]'::jsonb) from (
    select d.numero_borrador as n, 'BR-' || lpad(d.numero_borrador::text, 4, '0') as borrador, d.fecha_emision_prevista::text as fecha_prevista, cl.nombre as receptor, cl.numero_identificacion as identificacion, d.estado_preparacion as estado, d.estado_fiscal, d.base_imponible::text as base_imponible,
           d.serie, d.numero_fiscal as numero, d.autorizacion_sat as autorizacion_simulada
      from public.documentos d left join public.clientes cl on cl.id = d.cliente_id and cl.empresa_id = d.empresa_id where d.empresa_id = public.fel__empresa_actual()) t
$$;
-- 4) DESCARGA de archivos: DEFINER con permiso explícito (`artefactos.descargar`), empresa de la sesión y alcance de establecimiento; devuelve el contenido en base64 (nunca por la lectura de tablas)
create or replace function api.artefacto_descargar(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := (select c.o_empresa from public.fel__ctx() c); r record;
begin
  if not public.fel_tiene_permiso(v_emp, 'artefactos.descargar') then raise exception 'FEL_NO_AUTORIZADO: no tienes permiso para descargar'; end if;
  select a.nombre, a.mime, a.tipo, a.contenido, a.documento_id into r from public.artefactos_documento a where a.id = p_id and a.empresa_id = v_emp;
  if not found then raise exception 'FEL_NO_ENCONTRADO: archivo no encontrado'; end if;
  if r.documento_id is not null and public.fel__establecimiento_por_usuario() and not exists (select 1 from public.documentos d where d.id = r.documento_id and d.empresa_id = v_emp and public.fel_en_alcance(d.empresa_id, auth.uid(), d.establecimiento_id)) then
    raise exception 'FEL_NO_AUTORIZADO: el archivo es de un establecimiento fuera de tu alcance'; end if;
  return jsonb_build_object('nombre', r.nombre, 'mime', r.mime, 'tipo', r.tipo, 'contenido_b64', encode(r.contenido, 'base64'));
end $$;
revoke all on function api.documento_detalle(uuid), api.documentos_listar(jsonb), api.panel_resumen(), api.reporte_documentos(), api.artefacto_descargar(uuid) from public, anon;
grant execute on function api.documento_detalle(uuid), api.documentos_listar(jsonb), api.panel_resumen(), api.reporte_documentos(), api.artefacto_descargar(uuid) to authenticated;
