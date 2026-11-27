-- M-V · Cierre local de R3 (requiere M-V1 antes) (PROPUESTA; fuera de supabase/migrations; NO se aplica sin autorización). Sustituye las últimas lecturas directas del servidor por funciones con identidad, permisos y empresa verificados por la base.
-- Tres familias, todas con `search_path` vacío y privilegios mínimos:
--  A) `api.*` de PERSONA (JWT de Supabase Auth): pre-lecturas de validación (`documento_ref`, `cliente_ref`: INVOKER+RLS, la persona solo ve lo suyo), `referencia` y `empresa_contexto`, `documento_cobertura` (DEFINER; empresa de la sesión; sin parámetros de identidad).
--  B) `fel_sys_*` de SERVICIOS DEL SISTEMA (Digifact, correo): lecturas entre tablas que reciben la empresa YA VERIFICADA como parámetro; solo `nexa_sys` las ejecuta (la frontera de confianza es `nexa-sys`, ver FRONTERA-DE-CONFIANZA.md). Ninguna escribe.
--  C) Privilegios de `nexa_sys` SOLO sobre las tablas propias de los servicios (lista cerrada, sin DELETE salvo la purga de límites): digifact_operaciones, digifact_artefactos, envios_correo, demo_limites. Ningún privilegio sobre documentos, clientes, empresas, auditoría, sesiones ni personas.
-- A) personas -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function api.documento_ref(p_id uuid) returns jsonb language sql stable security invoker set search_path = '' as $$
  select (select to_jsonb(t) from (select d.tipo_dte, d.version, d.estado_fiscal, d.estado_preparacion, d.fecha_emision_prevista::text as fecha_emision_prevista, d.establecimiento_id, d.cliente_id
            from public.documentos d where d.id = p_id and d.empresa_id = public.fel__empresa_actual()) t)
$$;
create or replace function api.cliente_ref(p_id uuid default null, p_cf_nombre text default null) returns jsonb language sql stable security invoker set search_path = '' as $$
  select case when p_id is not null then (select to_jsonb(t) from (select c.tipo_identificacion from public.clientes c where c.id = p_id and c.empresa_id = public.fel__empresa_actual()) t)
              else (select to_jsonb(t) from (select c.id from public.clientes c where c.empresa_id = public.fel__empresa_actual() and c.tipo_identificacion = 'CF' and c.nombre = p_cf_nombre and c.activo order by c.creado_en limit 1) t) end
$$;
-- identificadores de SU empresa (ninguna permiso propio: la acción posterior —la escritura— exige el suyo)
create or replace function api.referencia(p_tipo text, p_id uuid) returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := (select c.o_empresa from public.fel__ctx() c);
begin
  return case p_tipo
    when 'operacion_certificada' then (select o.id from public.operaciones_fiscales o where o.documento_id = p_id and o.empresa_id = v_emp and o.tipo = 'certificacion' and o.estado = 'confirmada_exitosa' order by o.iniciada_en desc limit 1)
    when 'operacion_de_conciliacion' then (select k.operacion_id from public.conciliaciones k where k.id = p_id and k.empresa_id = v_emp)
    when 'documento_de_alerta' then (select a.documento_id from public.alertas_fiscales a where a.id = p_id and a.empresa_id = v_emp)
    else null end;
end $$;
create or replace function api.empresa_contexto() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := (select c.o_empresa from public.fel__ctx() c);
begin
  return jsonb_build_object(
    'empresa', (select to_jsonb(t) from (select e.id, e.razon_social, e.nombre_comercial, e.nit, e.direccion_fiscal, e.telefono, e.correo_facturacion, e.estado, e.moneda, e.emision_real_habilitada, r.nombre as regimen, r.estado as regimen_estado
                 from public.empresas e left join public.regimenes_fiscales r on r.id = e.regimen_id where e.id = v_emp) t),
    'canales', coalesce((select jsonb_agg(to_jsonb(t) order by t.prioridad, t.proveedor_id) from (select c.id, c.proveedor_id, c.ambiente, c.habilitado, c.prioridad from public.empresa_canales c where c.empresa_id = v_emp) t), '[]'::jsonb),
    'ultimo_borrador', (select coalesce(max(numero_borrador), 0)::int from public.documentos where empresa_id = v_emp));
end $$;
create or replace function api.documento_cobertura(p_doc uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := (select c.o_empresa from public.fel__ctx() c);
begin
  if not public.fel_tiene_permiso(v_emp, 'borradores.ver') or not exists (select 1 from public.documentos d where d.id = p_doc and d.empresa_id = v_emp
       and ((not public.fel__establecimiento_por_usuario()) or public.fel_en_alcance(d.empresa_id, auth.uid(), d.establecimiento_id))) then return '[]'::jsonb; end if;   -- sin permiso o fuera de alcance: nada (como la RLS)
  return coalesce((select jsonb_agg(to_jsonb(t) order by t.reservado_en) from (select c.id, c.evento_tipo, c.estado, c.unidades_reservadas::text as reservadas, c.unidades_consumidas::text as consumidas, c.operacion_id, c.reservado_en,
      (select coalesce(sum(g.monto), 0)::text from public.cargos g where g.consumo_id = c.id) as cargado from public.consumos c where c.documento_id = p_doc and c.empresa_id = v_emp) t), '[]'::jsonb);
end $$;
revoke all on function api.documento_ref(uuid), api.cliente_ref(uuid, text), api.referencia(text, uuid), api.empresa_contexto(), api.documento_cobertura(uuid) from public, anon;
grant execute on function api.documento_ref(uuid), api.cliente_ref(uuid, text), api.referencia(text, uuid), api.empresa_contexto(), api.documento_cobertura(uuid) to authenticated;
-- envoltorios de TRANSICIÓN `fel_ses_sys_*` (identidad por token de sesión, igual que M-K) para las siete: la empresa sale de la sesión; solo los ejecuta `nexa_app` (M-E). Con Auth/W6 desaparecen; los servicios pasan a `nexa-sys`.
do $$
declare r record; v_args text; v_call text; v_ret text; v_body text; n int := 0; i int; v_nombre text;
begin
  for r in select p.oid, p.proname, p.proretset, p.proargnames, p.proargmodes, pg_get_function_arguments(p.oid) as args from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname in ('fel_sys_doc_fel', 'fel_sys_doc_cliente', 'fel_sys_doc_correo', 'fel_sys_op_certificada', 'fel_sys_auditoria_ultima', 'fel_sys_auditoria_contar', 'fel_sys_artefactos_op') order by p.proname loop
    v_nombre := 'fel_ses_sys_' || substr(r.proname, 9); v_args := regexp_replace(r.args, '^p_empresa uuid(, )?', ''); v_call := 'p_empresa := e';
    for i in 2 .. array_length(r.proargnames, 1) loop
      if r.proargmodes is null or r.proargmodes[i] in ('i', 'b', 'v') then v_call := v_call || format(', %I := %I', r.proargnames[i], r.proargnames[i]); end if;
    end loop;
    v_ret := pg_get_function_result(r.oid);
    if r.proretset then v_body := format('return query select * from public.%I(%s);', r.proname, v_call); else v_body := format('return public.%I(%s);', r.proname, v_call); end if;
    execute format($fn$create or replace function public.%I(p_sesion text%s) returns %s language plpgsql security definer set search_path = '' as $body$
      declare e uuid;
      begin select o_empresa into e from public.fel__sesion_empresa(p_sesion); %s end $body$ $fn$, v_nombre, case when v_args = '' then '' else ', ' || v_args end, v_ret, v_body);
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', v_nombre, (select pg_get_function_identity_arguments(o.oid) from pg_proc o where o.proname = v_nombre and o.pronamespace = 'public'::regnamespace));
    n := n + 1;
  end loop;
  raise notice 'M-V: % envoltorios fel_ses_sys_* generados', n;
end $$;
