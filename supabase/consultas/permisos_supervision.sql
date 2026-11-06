select json_build_object(
 'politicas', (select coalesce(json_agg(x), '[]'::json) from (select policyname, cmd, roles::text as roles from pg_policies where schemaname = 'public' and tablename = 'supervision_mensual' order by 1) x),
 'permisos_authenticated', (select coalesce(json_agg(g), '[]'::json) from (select privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'supervision_mensual' and grantee = 'authenticated' order by 1) g)
) as r;
