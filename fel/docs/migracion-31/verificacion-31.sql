-- NEXA FEL · VERIFICACIÓN POSTERIOR de la propuesta 31. SOLO LECTURA (un solo SELECT). Todas las filas deben tener ok = true. No devuelve datos de documentos ni empresas.
select control, valor, esperado, (valor is not distinct from esperado) as ok from (
  select 'columna certificacion_test' as control, (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'fel_tipos_dte' and column_name = 'certificacion_test') as valor, '1' as esperado
  union all select 'certifican en TEST: FACT, NCRE', (select string_agg(codigo, ',' order by codigo) from public.fel_tipos_dte where certificacion_test), 'FACT,NCRE'
  union all select 'certifican «de verdad»: solo FACT (sin cambios)', (select string_agg(codigo, ',' order by codigo) from public.fel_tipos_dte where certificacion_habilitada), 'FACT'
  union all select 'catálogo sigue con 17 tipos', (select count(*)::text from public.fel_tipos_dte), '17'
  union all select 'ningún pendiente certifica en TEST', (select count(*)::text from public.fel_tipos_dte where certificacion_test and disponibilidad = 'pendiente'), '0'
  union all select 'protección de inmutabilidad activa', (select count(*)::text from pg_trigger where tgrelid = 'public.fel_tipos_dte'::regclass and tgname in ('fel_tipos_dte_no_cambiar','fel_tipos_dte_no_insertar') and tgenabled = 'O'), '2'
  union all select 'guardián de Digifact usa la función nueva', (select p.proname from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'public.digifact_operaciones'::regclass and t.tgname = 'fel_digifact_tipo_guard_t'), 'fel_digifact_tipo_guard'
  union all select 'guardián de operaciones_fiscales sin cambios', (select p.proname from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'public.operaciones_fiscales'::regclass and t.tgname = 'fel_operacion_tipo_guard_t'), 'fel_operacion_tipo_guard'
  union all select 'authenticated no escribe el catálogo', (has_table_privilege('authenticated', 'public.fel_tipos_dte', 'update') or has_table_privilege('authenticated', 'public.fel_tipos_dte', 'insert'))::text, 'false'
  union all select 'funciones nuevas fuera del alcance de anon/authenticated', (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('fel_digifact_tipo_guard','fel_tipos_certificacion_test') and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), '0'
  union all select 'service_role lee la lista de TEST', has_function_privilege('service_role', 'public.fel_tipos_certificacion_test()', 'execute')::text, 'true'
  union all select 'ninguna operación de Digifact sobre tipos que no certifican', (select count(*)::text from public.digifact_operaciones o join public.documentos d on d.id = o.documento_id and d.empresa_id = o.empresa_id join public.fel_tipos_dte t on t.codigo = d.tipo_dte where not (t.certificacion_habilitada or t.certificacion_test)), '0'
) c order by 1;
