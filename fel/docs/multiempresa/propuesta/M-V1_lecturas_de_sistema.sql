-- M-V1 · Lecturas de los SERVICIOS DEL SISTEMA (Digifact, correo) y privilegios mínimos de nexa_sys (PROPUESTA; fuera de supabase/migrations; NO se aplica sin autorización). SIN dependencias de Supabase Auth: solo tablas del núcleo.
-- Siete funciones `fel_sys_*` que reciben la empresa YA VERIFICADA por quien llama (la frontera de confianza es `nexa-sys`; ver FRONTERA-DE-CONFIANZA.md), con `search_path` vacío, sin escritura y ejecutables solo por `nexa_sys`.
-- Más los privilegios de `nexa_sys` SOLO sobre las tablas propias de los servicios (lista cerrada). Las bases de prueba cargan este archivo como cargan las migraciones: los servicios ya no leen tablas de datos de empresa con SQL propio.
-- B) servicios del sistema (la empresa llega YA verificada; solo nexa_sys) -----------------------------------------------------------------------------------------------------------------------------
create or replace function public.fel_sys_doc_fel(p_empresa uuid, p_doc uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_d jsonb; v_tipos boolean := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'documentos' and column_name = 'tipo_dte');
begin
  select to_jsonb(t) into v_d from (select d.id, d.empresa_id, d.estado_preparacion, d.estado_fiscal, d.establecimiento_id, es.codigo_sat as est_codigo, d.fecha_emision_prevista::text as fecha_emision_prevista,
         case when v_tipos then to_jsonb(d) ->> 'tipo_dte' end as tipo_dte, case when v_tipos then to_jsonb(d) -> 'referencia_origen' end as referencia_origen, case when v_tipos then to_jsonb(d) ->> 'motivo_ajuste' end as motivo_ajuste, case when v_tipos then to_jsonb(d) ->> 'tipo_recibo' end as tipo_recibo,
         c.tipo_identificacion as c_tipo, c.numero_identificacion as c_num, c.nombre as c_nombre
    from public.documentos d left join public.clientes c on c.id = d.cliente_id and c.empresa_id = d.empresa_id left join public.establecimientos es on es.id = d.establecimiento_id and es.empresa_id = d.empresa_id where d.id = p_doc and d.empresa_id = p_empresa) t;
  if v_d is null then return null; end if;
  return jsonb_build_object('documento', v_d, 'lineas', coalesce((select jsonb_agg(to_jsonb(x) order by x.orden) from (select l.orden, l.descripcion, l.cantidad::text as cantidad, l.precio_unitario::text as precio_unitario, l.importes ->> 'descuento' as descuento, k.tipo as concepto_tipo, k.unidad_medida
      from public.documento_lineas l left join public.conceptos k on k.id = l.concepto_id and k.empresa_id = l.empresa_id where l.documento_id = p_doc and l.empresa_id = p_empresa) x), '[]'::jsonb));
end $$;
create or replace function public.fel_sys_doc_cliente(p_empresa uuid, p_doc uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select (select to_jsonb(t) from (select c.id as cliente_id, c.tipo_identificacion, c.email from public.documentos d left join public.clientes c on c.id = d.cliente_id and c.empresa_id = d.empresa_id where d.id = p_doc and d.empresa_id = p_empresa) t)
$$;
create or replace function public.fel_sys_doc_correo(p_empresa uuid, p_doc uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select (select to_jsonb(t) from (select d.id, d.estado_fiscal, d.serie, d.numero_fiscal, d.autorizacion_sat, d.fecha_emision_prevista::text as fecha_emision_prevista, coalesce(d.total, d.base_imponible)::text as total, d.moneda, c.nombre as cliente_nombre, c.email as cliente_email, e.nombre_comercial, e.razon_social
    from public.documentos d join public.empresas e on e.id = d.empresa_id left join public.clientes c on c.id = d.cliente_id and c.empresa_id = d.empresa_id where d.id = p_doc and d.empresa_id = p_empresa) t)
$$;
create or replace function public.fel_sys_op_certificada(p_empresa uuid, p_doc uuid) returns uuid language sql stable security definer set search_path = '' as $$
  select o.id from public.operaciones_fiscales o where o.documento_id = p_doc and o.empresa_id = p_empresa and o.tipo = 'certificacion' and o.estado = 'confirmada_exitosa' order by o.iniciada_en desc limit 1
$$;
create or replace function public.fel_sys_auditoria_ultima(p_empresa uuid, p_accion text, p_entidad text, p_entidad_id text) returns jsonb language sql stable security definer set search_path = '' as $$
  select (select to_jsonb(t) from (select a.ocurrido_en, a.datos from public.auditoria a where a.empresa_id = p_empresa and a.accion = p_accion and a.entidad = p_entidad and a.entidad_id = p_entidad_id order by a.id desc limit 1) t)
$$;
create or replace function public.fel_sys_auditoria_contar(p_empresa uuid, p_accion text, p_entidad text, p_entidad_id text) returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.auditoria a where a.empresa_id = p_empresa and a.accion = p_accion and a.entidad = p_entidad and a.entidad_id = p_entidad_id
$$;
create or replace function public.fel_sys_artefactos_op(p_empresa uuid, p_doc uuid, p_op uuid) returns table (tipo text, nombre text, mime text, sha256 text, contenido bytea) language sql stable security definer set search_path = '' as $$
  select a.tipo, a.nombre, a.mime, a.sha256, a.contenido from public.artefactos_documento a where a.documento_id = p_doc and a.empresa_id = p_empresa and a.operacion_id = p_op
$$;
revoke all on function public.fel_sys_doc_fel(uuid, uuid), public.fel_sys_doc_cliente(uuid, uuid), public.fel_sys_doc_correo(uuid, uuid), public.fel_sys_op_certificada(uuid, uuid), public.fel_sys_auditoria_ultima(uuid, text, text, text),
  public.fel_sys_auditoria_contar(uuid, text, text, text), public.fel_sys_artefactos_op(uuid, uuid, uuid) from public, anon, authenticated;
-- C) nexa_sys: solo las tablas propias de los servicios (lista cerrada)
do $$ declare v_t text; v_p text;
begin
  if not exists (select 1 from pg_roles where rolname = 'nexa_sys') then return; end if;
  grant execute on function public.fel_sys_doc_fel(uuid, uuid), public.fel_sys_doc_cliente(uuid, uuid), public.fel_sys_doc_correo(uuid, uuid), public.fel_sys_op_certificada(uuid, uuid), public.fel_sys_auditoria_ultima(uuid, text, text, text),
    public.fel_sys_auditoria_contar(uuid, text, text, text), public.fel_sys_artefactos_op(uuid, uuid, uuid) to nexa_sys;
  for v_t, v_p in select * from (values ('digifact_operaciones', 'select, insert, update'), ('digifact_artefactos', 'select, insert'), ('envios_correo', 'select, insert, update'), ('demo_limites', 'select, insert, update, delete')) x(t, p) loop
    if to_regclass('public.' || v_t) is not null then execute format('grant %s on public.%I to nexa_sys', v_p, v_t); end if;
  end loop;
end $$;
