-- NEXA FEL · VERIFICACIÓN POSTERIOR de la propuesta de tipos de documento. SOLO LECTURA (un solo SELECT; sin DDL ni DML). Todas las filas deben tener ok = true.
-- No devuelve datos de documentos, clientes ni empresas: solo conteos y propiedades de objetos.
select control, valor, esperado, (valor is not distinct from esperado) as ok from (
  select 'catálogo: 17 tipos' as control, (select count(*)::text from public.fel_tipos_dte) as valor, '17' as esperado
  union all select 'solo FACT certifica', (select string_agg(codigo, ',' order by codigo) from public.fel_tipos_dte where certificacion_habilitada), 'FACT'
  union all select 'en pruebas: NCRE, NDEB, RECI', (select string_agg(codigo, ',' order by codigo) from public.fel_tipos_dte where disponibilidad = 'en_pruebas'), 'NCRE,NDEB,RECI'
  union all select 'pendientes: 13', (select count(*)::text from public.fel_tipos_dte where disponibilidad = 'pendiente'), '13'
  union all select 'RLS en las 2 tablas nuevas', (select count(*)::text from pg_class where oid in ('public.fel_tipos_dte'::regclass, 'public.empresa_tipos_documento'::regclass) and relrowsecurity), '2'
  union all select 'authenticated no escribe las tablas', (has_table_privilege('authenticated', 'public.fel_tipos_dte', 'insert') or has_table_privilege('authenticated', 'public.fel_tipos_dte', 'update')
        or has_table_privilege('authenticated', 'public.empresa_tipos_documento', 'insert') or has_table_privilege('authenticated', 'public.empresa_tipos_documento', 'update') or has_table_privilege('authenticated', 'public.empresa_tipos_documento', 'delete'))::text, 'false'
  union all select 'anon sin acceso a las tablas', (has_table_privilege('anon', 'public.fel_tipos_dte', 'select') or has_table_privilege('anon', 'public.empresa_tipos_documento', 'select'))::text, 'false'
  union all select 'ninguna función nueva ejecutable por anon/authenticated', (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname in ('fel_tipos_dte_inmutable','fel__tipo_no_habilitado','fel__receptor_id','fel_documento_tipo_guard','fel_operacion_tipo_guard','fel_tipos_instalar_guardian_digifact','fel_tipos_empresa','fel_op_tipos_empresa_guardar','fel_op_documento_origenes','fel_op_documento_tipo')
        and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), '0'
  union all select 'disparador del documento', (select count(*)::text from pg_trigger where tgrelid = 'public.documentos'::regclass and tgname = 'fel_documento_tipo_guard_t'), '1'
  union all select 'disparador de operaciones fiscales', (select count(*)::text from pg_trigger where tgrelid = 'public.operaciones_fiscales'::regclass and tgname = 'fel_operacion_tipo_guard_t'), '1'
  union all select 'disparador de las operaciones de la 29 (solo si existe su tabla)', case when to_regclass('public.digifact_operaciones') is null then 'n/a' else (select count(*)::text from pg_trigger where tgrelid = 'public.digifact_operaciones'::regclass and tgname = 'fel_digifact_tipo_guard_t') end,
        case when to_regclass('public.digifact_operaciones') is null then 'n/a' else '1' end
  union all select 'todos los documentos existentes siguen como FACT (sin notas ni recibos fuera de lo creado con la función)', (select count(*)::text from public.documentos where tipo_dte not in ('FACT','NCRE','NDEB','RECI')), '0'
  union all select 'ninguna operación fiscal sobre un tipo que no certifica', (select count(*)::text from public.operaciones_fiscales o join public.documentos d on d.id = o.documento_id and d.empresa_id = o.empresa_id join public.fel_tipos_dte t on t.codigo = d.tipo_dte where not t.certificacion_habilitada), '0'
) c order by 1;
