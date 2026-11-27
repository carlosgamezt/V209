-- M-T · R3 tanda final (PROPUESTA; fuera de supabase/migrations; NO se aplica sin autorización). Lecturas que tocan tablas financieras y de plataforma (`consumos`, `cargos`, `monedero_*`, `bolson_*`, planes) a las que `authenticated` NO tiene ni debe tener SELECT.
-- Por eso son RPC `SECURITY DEFINER` con verificación EXPLÍCITA e inicial: identidad de Supabase Auth con sesión viva (`fel__ctx` / `fel__sesion_maestro(null)`), permiso (`facturacion.ver`, `usuarios.ver`) o administrador de plataforma con MFA real, y la empresa sale de la sesión (jamás de un parámetro, salvo la empresa OBJETIVO del administrador de plataforma).
-- Devuelven las mismas formas que las consultas del servidor (numéricos como texto). Ninguna escribe. Ninguna concede privilegios sobre tablas.
create or replace function public.fel__plan_json(p_empresa uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_contratos jsonb; v_vigente jsonb; v_version uuid;
begin
  select coalesce(jsonb_agg(to_jsonb(t) order by t.desde desc), '[]'::jsonb) into v_contratos from (
    select ct.id, ct.desde, ct.hasta, pv.id as version_id, pv.version, pl.codigo, pl.nombre, pl.modalidad, pv.cuota_fija::text as cuota_fija, pv.unidades_incluidas::text as unidades_incluidas, pv.permite_sobregiro, pv.limite_sobregiro::text as limite_sobregiro
      from public.contratos_plan ct join public.plan_versiones pv on pv.id = ct.plan_version_id join public.planes pl on pl.codigo = pv.plan_codigo where ct.empresa_id = p_empresa) t;
  v_vigente := coalesce((select c from jsonb_array_elements(v_contratos) c where c -> 'hasta' = 'null'::jsonb limit 1), v_contratos -> 0);
  v_version := nullif(v_vigente ->> 'version_id', '')::uuid;
  return jsonb_build_object(
    'cuenta', (select to_jsonb(t) from (select id, estado, cupo_mensual_unidades::text as cupo from public.cuentas_comerciales where empresa_id = p_empresa) t),
    'contrato', v_vigente, 'contratos', v_contratos,
    'tarifas', coalesce((select jsonb_agg(to_jsonb(t) order by t.evento_tipo) from (select evento_tipo, precio_unitario::text as precio_unitario, cargable from public.tarifas where plan_version_id = v_version) t), '[]'::jsonb),
    'monedero', (select to_jsonb(t) from (select recargado::text, consumido::text, reservado::text, reembolsado::text, ajustado::text, sobregiro::text, (recargado + ajustado - consumido - reservado - reembolsado + sobregiro)::text as disponible from public.monedero_saldos where empresa_id = p_empresa) t),
    'pagos', coalesce((select jsonb_agg(to_jsonb(t) order by t.confirmado_en desc) from (select id, monto::text as monto, referencia_pago, estado, confirmado_en from public.pagos where empresa_id = p_empresa order by confirmado_en desc limit 30) t), '[]'::jsonb),
    'consumos', coalesce((select jsonb_agg(to_jsonb(t) order by t.reservado_en desc) from (select c.id, c.evento_tipo, c.estado, c.unidades_reservadas::text as unidades_reservadas, c.unidades_consumidas::text as unidades_consumidas, c.reservado_en, c.resuelto_en, c.documento_id, b.proveedor_id as certificador,
        d.numero_borrador, (select coalesce(sum(g.monto), 0)::text from public.cargos g where g.consumo_id = c.id) as cargado
      from public.consumos c join public.bolson_cuentas b on b.id = c.cuenta_id left join public.documentos d on d.id = c.documento_id and d.empresa_id = c.empresa_id where c.empresa_id = p_empresa order by c.reservado_en desc limit 50) t), '[]'::jsonb),
    'porCertificador', coalesce((select jsonb_agg(to_jsonb(t) order by t.certificador) from (select b.proveedor_id as certificador, (count(*) filter (where c.estado = 'confirmado'))::int as confirmados, (count(*) filter (where c.estado = 'reservado'))::int as retenidos, (count(*) filter (where c.estado = 'liberado'))::int as liberados,
        coalesce(sum(c.unidades_consumidas) filter (where c.estado = 'confirmado'), 0)::text as unidades, coalesce(sum(g.monto), 0)::text as cargado
      from public.consumos c join public.bolson_cuentas b on b.id = c.cuenta_id left join (select consumo_id, sum(monto) as monto from public.cargos where naturaleza = 'cargo' group by consumo_id) g on g.consumo_id = c.id
      where c.empresa_id = p_empresa group by b.proveedor_id) t), '[]'::jsonb),
    'cargos', coalesce((select jsonb_agg(to_jsonb(t) order by t.creado_en desc) from (select id, concepto, naturaleza, cantidad::text as cantidad, precio_unitario::text as precio_unitario, monto::text as monto, periodo, estado, creado_en from public.cargos where empresa_id = p_empresa order by creado_en desc limit 50) t), '[]'::jsonb),
    'cobros', coalesce((select jsonb_agg(to_jsonb(t) order by t.periodo desc) from (select id, tipo, periodo, monto_neto::text as monto_neto, referencia_documento, monto_total_documento::text as monto_total_documento, estado from public.cobros where empresa_id = p_empresa) t), '[]'::jsonb),
    'resumen', (select to_jsonb(t) from (select (count(*) filter (where estado = 'confirmado' and evento_tipo = 'certificacion'))::int as certificaciones, (count(*) filter (where estado = 'reservado'))::int as reservadas, coalesce(sum(unidades_consumidas) filter (where estado = 'confirmado'), 0)::text as unidades from public.consumos where empresa_id = p_empresa) t));
end $$;
revoke all on function public.fel__plan_json(uuid) from public, anon, authenticated;   -- solo la usan las RPC de abajo
-- 1) empresa: plan y consumos de SU empresa; exige `facturacion.ver`
create or replace function api.plan_resumen() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := (select c.o_empresa from public.fel__ctx() c);
begin
  if not public.fel_tiene_permiso(v_emp, 'facturacion.ver') then raise exception 'FEL_NO_AUTORIZADO: no tienes permiso para ver el plan y el consumo'; end if;
  return public.fel__plan_json(v_emp);
end $$;
create or replace function api.reporte_consumos() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := (select c.o_empresa from public.fel__ctx() c);
begin
  if not public.fel_tiene_permiso(v_emp, 'facturacion.ver') then raise exception 'FEL_NO_AUTORIZADO: no tienes permiso para este reporte'; end if;
  return coalesce((select jsonb_agg(to_jsonb(t) order by t.n) from (
    select c.reservado_en as n, to_char(c.reservado_en at time zone 'America/Guatemala', 'YYYY-MM-DD HH24:MI') as fecha, b.proveedor_id as certificador, c.evento_tipo as evento, 'BR-' || lpad(d.numero_borrador::text, 4, '0') as documento, c.estado,
           case when c.estado = 'confirmado' then c.unidades_consumidas else c.unidades_reservadas end::text as unidades, (select coalesce(sum(g.monto), 0) from public.cargos g where g.consumo_id = c.id)::text as cargado
      from public.consumos c join public.bolson_cuentas b on b.id = c.cuenta_id left join public.documentos d on d.id = c.documento_id and d.empresa_id = c.empresa_id where c.empresa_id = v_emp) t), '[]'::jsonb);
end $$;
create or replace function api.usuarios_resumen() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := (select c.o_empresa from public.fel__ctx() c);
begin
  if not public.fel_tiene_permiso(v_emp, 'usuarios.ver') then raise exception 'FEL_NO_AUTORIZADO: no tienes permiso para ver los usuarios'; end if;
  return jsonb_build_object(
    'invitaciones', coalesce((select jsonb_agg(to_jsonb(t) order by t.creado_en desc) from (select id, email, rol, estado, expira_en, creado_en from public.invitaciones where empresa_id = v_emp and estado = 'pendiente') t), '[]'::jsonb),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('rol', t.rol, 'permisos', t.permisos) order by case t.rol when 'propietario' then 0 when 'administrador' then 1 when 'emisor' then 2 else 3 end) from (select rol, array_agg(permiso order by permiso) as permisos from public.rol_permisos group by rol) t), '[]'::jsonb),
    'catalogo', coalesce((select jsonb_agg(to_jsonb(t) order by t.codigo) from (select codigo, descripcion from public.permisos_catalogo) t), '[]'::jsonb));
end $$;
-- 2) plataforma: administrador con sesión viva y MFA real (fel__sesion_maestro(null)); la empresa objetivo del plan sí es parámetro (es del administrador), pero se comprueba que exista
create or replace function api.pla_lectura_resumen() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin perform public.fel__sesion_maestro(null);
  return jsonb_build_object('empresas', coalesce((select jsonb_agg(to_jsonb(t) order by t.nombre_comercial) from (
    select e.id, e.nombre_comercial, e.razon_social, e.nit, e.estado,
      (select pl.nombre from public.contratos_plan ct join public.plan_versiones pv on pv.id = ct.plan_version_id join public.planes pl on pl.codigo = pv.plan_codigo where ct.empresa_id = e.id and ct.hasta is null limit 1) as plan,
      (select pl.modalidad from public.contratos_plan ct join public.plan_versiones pv on pv.id = ct.plan_version_id join public.planes pl on pl.codigo = pv.plan_codigo where ct.empresa_id = e.id and ct.hasta is null limit 1) as modalidad,
      (select (s.recargado + s.ajustado - s.consumido - s.reservado - s.reembolsado + s.sobregiro)::text from public.monedero_saldos s where s.empresa_id = e.id) as disponible,
      (select count(*)::int from public.consumos c where c.empresa_id = e.id and c.estado = 'confirmado' and c.evento_tipo = 'certificacion') as certificaciones,
      (select coalesce(sum(c.unidades_consumidas), 0)::text from public.consumos c where c.empresa_id = e.id and c.estado = 'confirmado') as unidades,
      (select coalesce(sum(g.monto), 0)::text from public.cargos g where g.empresa_id = e.id and g.estado = 'pendiente') as pendiente
    from public.empresas e) t), '[]'::jsonb));
end $$;
create or replace function api.pla_lectura_planes() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin perform public.fel__sesion_maestro(null);
  return jsonb_build_object('planes', coalesce((select jsonb_agg(to_jsonb(t) order by t.codigo) from (select codigo, nombre, modalidad, activo from public.planes) t), '[]'::jsonb),
    'versiones', coalesce((select jsonb_agg(to_jsonb(t) order by t.plan_codigo, t.version desc) from (select pv.id, pv.plan_codigo, pv.version, pv.vigente_desde, pv.cuota_fija::text as cuota_fija, pv.unidades_incluidas::text as unidades_incluidas, pv.permite_sobregiro, pv.limite_sobregiro::text as limite_sobregiro,
        (select json_agg(json_build_object('evento', x.evento_tipo, 'precio', x.precio_unitario::text, 'cargable', x.cargable) order by x.evento_tipo) from public.tarifas x where x.plan_version_id = pv.id) as tarifas from public.plan_versiones pv) t), '[]'::jsonb),
    'eventos', coalesce((select jsonb_agg(to_jsonb(t) order by t.codigo) from (select codigo from public.evento_tipos) t), '[]'::jsonb));
end $$;
create or replace function api.pla_lectura_plan_empresa(p_empresa uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin perform public.fel__sesion_maestro(null);
  if not exists (select 1 from public.empresas where id = p_empresa) then raise exception 'FEL_NO_ENCONTRADO: empresa no encontrada'; end if;
  return public.fel__plan_json(p_empresa);
end $$;
create or replace function api.pla_lectura_bolson() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin perform public.fel__sesion_maestro(null);
  return jsonb_build_object(
    'cuentas', coalesce((select jsonb_agg(to_jsonb(t) order by t.creada_en) from (select (select case when sum(l.unidades) > 0 then (sum(l.costo_total) / sum(l.unidades))::numeric(18,6)::text end from public.bolson_lotes l where l.cuenta_id = c.id) as costo_unitario, c.id, c.proveedor_id, c.ambiente, c.referencia_externa, c.estado,
        s.comprado::text as comprado, s.consumido::text as consumido, s.reservado::text as reservado, s.ajustado::text as ajustado, (s.comprado + s.ajustado - s.consumido - s.reservado)::text as disponible, c.creada_en from public.bolson_cuentas c join public.bolson_saldos s on s.cuenta_id = c.id) t), '[]'::jsonb),
    'lotes', coalesce((select jsonb_agg(to_jsonb(t) order by t.registrado_en desc) from (select l.id, l.cuenta_id, l.unidades::text as unidades, l.costo_total::text as costo_total, l.referencia_proveedor, l.registrado_en from public.bolson_lotes l order by l.registrado_en desc limit 20) t), '[]'::jsonb),
    'porEmpresa', coalesce((select jsonb_agg(to_jsonb(t) order by t.nombre_comercial, t.certificador) from (
      with costo as (select b.id as cuenta_id, case when sum(l.unidades) > 0 then sum(l.costo_total) / sum(l.unidades) else 0 end as unitario from public.bolson_cuentas b left join public.bolson_lotes l on l.cuenta_id = b.id group by b.id),
           cargado as (select consumo_id, sum(monto) as monto from public.cargos where naturaleza = 'cargo' group by consumo_id)
      select e.id, e.nombre_comercial, b.proveedor_id as certificador, (count(*) filter (where c.estado = 'confirmado'))::int as confirmados, (count(*) filter (where c.estado = 'reservado'))::int as reservados, (count(*) filter (where c.estado = 'liberado'))::int as liberados,
        coalesce(sum(c.unidades_consumidas) filter (where c.estado = 'confirmado'), 0)::text as unidades, coalesce(sum(g.monto), 0)::text as cargado, coalesce(sum(c.unidades_consumidas * k.unitario) filter (where c.estado = 'confirmado'), 0)::numeric(18,6)::text as costo_estimado
      from public.empresas e left join public.consumos c on c.empresa_id = e.id left join public.bolson_cuentas b on b.id = c.cuenta_id left join costo k on k.cuenta_id = c.cuenta_id left join cargado g on g.consumo_id = c.id group by e.id, e.nombre_comercial, b.proveedor_id) t), '[]'::jsonb),
    'reglas', coalesce((select jsonb_agg(to_jsonb(t) order by t.evento_tipo) from (select r.cuenta_id, r.evento_tipo, r.consume, r.unidades::text as unidades from public.bolson_reglas_consumo r where r.vigente_hasta is null) t), '[]'::jsonb),
    'alertas', coalesce((select jsonb_agg(to_jsonb(t) order by t.creada_en desc) from (select a.id, a.tipo, a.detalle, a.creada_en, a.resuelta_en, e.nombre_comercial from public.bolson_alertas a left join public.empresas e on e.id = a.empresa_id order by a.creada_en desc limit 20) t), '[]'::jsonb));
end $$;
create or replace function api.pla_lectura_conciliaciones() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin perform public.fel__sesion_maestro(null);
  return jsonb_build_object(
    'extractos', coalesce((select jsonb_agg(to_jsonb(t) order by t.importado_en desc) from (select x.id, x.periodo_desde, x.periodo_hasta, x.saldo_final::text as saldo_final, x.importado_en, (select count(*)::int from public.bolson_extracto_lineas l where l.extracto_id = x.id) as lineas, c.id as conciliacion_id
        from public.bolson_extractos x left join public.bolson_conciliaciones c on c.extracto_id = x.id order by x.importado_en desc limit 20) t), '[]'::jsonb),
    'conciliaciones', coalesce((select jsonb_agg(to_jsonb(t) order by t.propuesta_en desc) from (select id, extracto_id, estado, propuesta_por, propuesta_en, decidida_por, decidida_en, nota, resumen from public.bolson_conciliaciones order by propuesta_en desc limit 20) t), '[]'::jsonb),
    'partidas', coalesce((select jsonb_agg(to_jsonb(t) order by (t.clasificacion = 'coincide'), t.referencia) from (select p.id, p.conciliacion_id, p.clasificacion, p.referencia, p.unidades_extracto::text as unidades_extracto, p.unidades_nexa::text as unidades_nexa, p.diferencia::text as diferencia, e.nombre_comercial,
        r.accion, r.motivo as resolucion_motivo, r.unidades::text as resolucion_unidades, re.nombre_comercial as resolucion_empresa
      from public.bolson_conciliacion_partidas p left join public.empresas e on e.id = p.empresa_id left join public.bolson_partida_resoluciones r on r.partida_id = p.id left join public.empresas re on re.id = r.empresa_id) t), '[]'::jsonb),
    'empresas', coalesce((select jsonb_agg(to_jsonb(t) order by t.nombre_comercial) from (select id, nombre_comercial from public.empresas) t), '[]'::jsonb));
end $$;
create or replace function api.pla_lectura_verificacion() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_s int; v_f int;
begin perform public.fel__sesion_maestro(null);
  select count(*), count(*) filter (where not ok) into v_s, v_f from (select ok from public.fel_sys_verificar_saldos() union all select ok from public.fel_sys_verificar_monederos()) x;
  return jsonb_build_object('comprobaciones', v_s, 'fallos', v_f);
end $$;
revoke all on function api.plan_resumen(), api.reporte_consumos(), api.usuarios_resumen(), api.pla_lectura_resumen(), api.pla_lectura_planes(), api.pla_lectura_plan_empresa(uuid), api.pla_lectura_bolson(), api.pla_lectura_conciliaciones(), api.pla_lectura_verificacion() from public, anon;
grant execute on function api.plan_resumen(), api.reporte_consumos(), api.usuarios_resumen(), api.pla_lectura_resumen(), api.pla_lectura_planes(), api.pla_lectura_plan_empresa(uuid), api.pla_lectura_bolson(), api.pla_lectura_conciliaciones(), api.pla_lectura_verificacion() to authenticated;
