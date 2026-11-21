-- VERIFICACIÓN POSTERIOR A LA PROPUESTA DEL CORREO · SOLO LECTURA (catálogo). Complementa a docs/migracion-28/verificacion-posterior-28.sql (que sigue valiendo sin cambios).
\set ON_ERROR_STOP on
begin;
do $$ declare n int; begin
  assert to_regclass('public.envios_correo') is not null, 'falta la tabla envios_correo';
  assert (select relrowsecurity from pg_class where oid = 'public.envios_correo'::regclass), 'envios_correo sin RLS';
  -- solo se LEE (authenticated) y nada para anon; el servicio escribe con su propio rol
  select count(*) into n from information_schema.role_table_grants where table_schema = 'public' and table_name = 'envios_correo' and grantee = 'anon'; assert n = 0, 'anon tiene privilegios';
  select count(*) into n from information_schema.role_table_grants where table_schema = 'public' and table_name = 'envios_correo' and grantee = 'authenticated' and privilege_type <> 'SELECT'; assert n = 0, 'authenticated escribe';
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'envios_correo'; assert n = 1, 'debe haber exactamente una política (lectura)';
  assert (select cmd from pg_policies where tablename = 'envios_correo') = 'SELECT', 'la única política es de lectura';
  assert (select qual from pg_policies where tablename = 'envios_correo') like '%fel_tiene_permiso%correos.ver%', 'la política exige correos.ver de la empresa';
  -- aislamiento multiempresa: claves COMPUESTAS (id, empresa_id) hacia documentos y operaciones; nada hacia tablas sin empresa
  select count(*) into n from pg_constraint where conrelid = 'public.envios_correo'::regclass and contype = 'f'; assert n = 2, 'deben ser 2 claves foráneas compuestas';
  select count(*) into n from pg_constraint where conrelid = 'public.envios_correo'::regclass and contype = 'f' and array_length(conkey, 1) = 2; assert n = 2, 'las claves foráneas deben ser compuestas con empresa_id';
  -- protecciones: trigger de solo cambio de estado, índice único por destinatario y unicidad de la clave
  assert exists (select 1 from pg_trigger where tgrelid = 'public.envios_correo'::regclass and tgname = 'envios_correo_guardia' and not tgisinternal), 'falta el trigger de guardia';
  assert exists (select 1 from pg_indexes where tablename = 'envios_correo' and indexname = 'envios_correo_uno_por_destinatario' and indexdef ilike '%unique%'), 'falta el índice único por destinatario';
  assert exists (select 1 from pg_constraint where conrelid = 'public.envios_correo'::regclass and contype = 'u'), 'falta la unicidad (empresa, clave)';
  -- service_role no puede borrar ni vaciar
  assert not has_table_privilege('service_role', 'public.envios_correo', 'DELETE') and not has_table_privilege('service_role', 'public.envios_correo', 'TRUNCATE'), 'service_role puede borrar';
  -- permisos
  select count(*) into n from public.permisos_catalogo where codigo in ('correos.ver', 'correos.enviar', 'correos.reenviar'); assert n = 3, 'faltan permisos en el catálogo';
  select count(*) into n from public.rol_permisos where permiso like 'correos.%'; assert n = 9, 'asignación de permisos por rol inesperada: ' || n;
  -- la función de guardia no queda ejecutable por los roles de la app
  assert not has_function_privilege('anon', 'public.fel_envios_correo_guardia()', 'EXECUTE') and not has_function_privilege('authenticated', 'public.fel_envios_correo_guardia()', 'EXECUTE') and not has_function_privilege('service_role', 'public.fel_envios_correo_guardia()', 'EXECUTE'), 'la función de guardia es ejecutable por un rol de la API';
end $$;
rollback;
select 'VERIFICACIÓN DEL CORREO OK' as resultado;
