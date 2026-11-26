-- Verificación posterior de M-A a M-D (SOLO LECTURA; se ejecuta dentro de una transacción de solo lectura). Cada fila lleva `ok`: cualquier `f` es un fallo.
select 'tablas nuevas con RLS activado' as comprobacion,
       (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
          and c.relname in ('empresa_emisor_versiones','empresa_digifact_config','empresa_digifact_eventos','acceso_maestro_datos')) = 4 as ok
union all select 'anon y authenticated sin privilegios sobre la configuración de Digifact y los accesos del maestro',
       not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name in ('empresa_digifact_config','acceso_maestro_datos') and grantee in ('anon','authenticated','PUBLIC'))
union all select 'anon sin privilegios sobre las demás tablas nuevas y la vista',
       not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name in ('empresa_emisor_versiones','empresa_digifact_eventos','v_empresa_digifact_estado') and grantee in ('anon','PUBLIC'))
union all select 'ninguna columna de credencial es legible por authenticated',
       not exists (select 1 from information_schema.column_privileges where table_schema = 'public' and table_name = 'empresa_digifact_config' and grantee = 'authenticated')
union all select 'la vista de estado no expone credencial ni versión de llave',
       not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'v_empresa_digifact_estado' and column_name in ('credencial_cifrada','llave_version','digifact_nit'))
union all select 'funciones de escritura y de servicio: SECURITY DEFINER con search_path vacío y solo service_role puede ejecutarlas',
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in
          ('fel_op_emisor_guardar','fel_op_emisor_aprobar','fel_sys_emisor_vigente','fel_op_digifact_conectar','fel_op_digifact_registrar_prueba','fel_op_digifact_interruptores',
           'fel_op_digifact_suspender','fel_sys_digifact_credencial','fel_admin_acceso_solicitar','fel_admin_acceso_revocar','fel_admin_datos_excepcionales_documentos',
           'fel_admin_datos_excepcionales_configuracion','fel_admin_empresas_resumen')
          and p.prosecdef and coalesce(p.proconfig, '{}') @> array['search_path=""']
          and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and has_function_privilege('service_role', p.oid, 'execute')) = 13
union all select 'ambiente fijado a pruebas por restricción',
       exists (select 1 from pg_constraint where conrelid = 'public.empresa_digifact_config'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%ambiente%pruebas%')
union all select 'NIT de Digifact único por empresa',
       exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'empresa_digifact_nit_uq')
union all select 'cuatro permisos nuevos y solo el propietario puede conectar y aprobar',
       (select count(*) from public.permisos_catalogo where codigo in ('fiscal.configurar','fiscal.aprobar_emisor','digifact.conectar','digifact.probar')) = 4
       and (select array_agg(rol order by rol) from public.rol_permisos where permiso in ('digifact.conectar','fiscal.aprobar_emisor')) = array['propietario','propietario']
       and not exists (select 1 from public.rol_permisos where rol in ('emisor','lector') and permiso in ('fiscal.configurar','fiscal.aprobar_emisor','digifact.conectar','digifact.probar'));
