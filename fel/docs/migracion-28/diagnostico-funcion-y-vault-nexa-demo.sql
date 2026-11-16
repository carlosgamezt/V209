-- DIAGNÓSTICO de «nexa-demo» (SOLO LECTURA): función propia hallada en public, disparadores de evento y privilegios sobre Vault. SOLO SELECT sobre el catálogo del sistema.
-- No lee datos de negocio, ni secretos, ni correos, ni contraseñas (de Vault solo se miran PRIVILEGIOS y un conteo estimado del catálogo, nunca el contenido de vault.secrets ni vault.decrypted_secrets).
-- Cada fila: sección | clave | valor. Las definiciones de funciones se acotan a 3500 caracteres y se omiten si parecen contener texto sensible.
\pset format unaligned
\pset fieldsep ' | '
\pset tuples_only on
select '00 sesión' as seccion, 'transaction_read_only' as clave, current_setting('transaction_read_only') as valor
-- ---------------------------------------------------------------- A. funciones propias en public (no pertenecientes a una extensión)
union all select 'A1 función', 'identidad', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
union all select 'A1 función', 'propietario / tipo / lenguaje', pg_get_userbyid(p.proowner) || ' / ' || case p.prokind when 'f' then 'función' when 'p' then 'procedimiento' when 'a' then 'agregada' else 'ventana' end || ' / ' || l.lanname || ' / devuelve ' || pg_get_function_result(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
union all select 'A1 función', 'seguridad / configuración', case when p.prosecdef then 'SECURITY DEFINER' else 'SECURITY INVOKER' end || ' / ' || coalesce(array_to_string(p.proconfig, ', '), 'sin configuración propia') || ' / volatilidad ' || p.provolatile::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
union all select 'A1 función', 'comentario', coalesce(obj_description(p.oid, 'pg_proc'), '(sin comentario)')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
union all select 'A1 función', 'ACL (privilegios)', coalesce(p.proacl::text, '(por defecto: solo el propietario)')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
union all select 'A1 función', 'EXECUTE efectivo: ' || r, has_function_privilege(r, p.oid, 'EXECUTE')::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace, unnest(array['anon', 'authenticated', 'service_role']) r where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
union all select 'A1 función', 'definición (acotada)', case when pg_get_functiondef(p.oid) ~* '(password|passwd|secret|token|apikey|api_key|private_key)\s*(:=|=|:)\s*''' then '[definición omitida: parece contener texto sensible]'
                                                          else replace(left(pg_get_functiondef(p.oid), 3500), chr(10), ' ⏎ ') end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
-- A2: dependencias y usos de esa función
union all select 'A2 uso', 'disparador de evento que la ejecuta', coalesce(e.evtname || ' (' || e.evtevent || case when e.evttags is not null then ', etiquetas ' || array_to_string(e.evttags, '/') else '' end || ', activo=' || e.evtenabled::text || ')', '(ninguno)')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace left join pg_event_trigger e on e.evtfoid = p.oid where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
union all select 'A2 uso', 'disparadores de tabla que la usan', (select count(*)::text from pg_trigger t where t.tgfoid = p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
union all select 'A2 uso', 'objetos que dependen de ella (pg_depend)', coalesce((select string_agg(distinct d.classid::regclass::text || '/' || d.deptype::text, ', ') from pg_depend d where d.refobjid = p.oid and d.classid::regclass::text <> 'pg_event_trigger'), '(ninguno, aparte del disparador de evento)')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
union all select 'A2 uso', 'otras funciones que la mencionan por nombre', (select count(*)::text from pg_proc q join pg_namespace m on m.oid = q.pronamespace where q.oid <> p.oid and m.nspname not in ('pg_catalog', 'information_schema') and q.prosrc ~* ('\m' || p.proname || '\M'))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
union all select 'A2 uso', 'llamadas registradas (pg_stat_user_functions; vacío si track_functions está apagado)', coalesce((select calls::text from pg_stat_user_functions s where s.funcid = p.oid), '(sin estadística)')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
-- A3: todos los disparadores de evento del proyecto (¿cuál es el séptimo?)
union all select 'A3 disparadores de evento', e.evtname, e.evtevent || ' / etiquetas ' || coalesce(array_to_string(e.evttags, ','), 'todas') || ' / función ' || pn.nspname || '.' || pp.proname || ' / propietario ' || pg_get_userbyid(e.evtowner) || ' / activo=' || e.evtenabled::text
  from pg_event_trigger e join pg_proc pp on pp.oid = e.evtfoid join pg_namespace pn on pn.oid = pp.pronamespace
-- ---------------------------------------------------------------- B. Vault: existencia, objetos y privilegios EFECTIVOS
union all select 'B1 vault', 'extensión supabase_vault', coalesce((select 'instalada ' || extversion from pg_extension where extname = 'supabase_vault'), 'no instalada')
union all select 'B1 vault', 'extensión pgsodium', coalesce((select 'instalada ' || extversion from pg_extension where extname = 'pgsodium'), 'no instalada')
union all select 'B1 vault', 'esquema vault: propietario y ACL', coalesce((select pg_get_userbyid(nspowner) || ' / ' || coalesce(nspacl::text, '(sin ACL)') from pg_namespace where nspname = 'vault'), 'el esquema vault no existe')
union all select 'B1 vault', 'esquema vault: ' || r || ' USAGE / CREATE', case when to_regnamespace('vault') is null then 'n/a' else has_schema_privilege(r, 'vault', 'USAGE')::text || ' / ' || has_schema_privilege(r, 'vault', 'CREATE')::text end
  from unnest(array['anon', 'authenticated', 'authenticator', 'service_role', 'postgres', 'supabase_admin']) r where exists (select 1 from pg_roles where rolname = r)
union all select 'B2 vault relación', c.relname || ' (' || case c.relkind when 'r' then 'tabla' when 'v' then 'vista' when 'm' then 'vista materializada' else c.relkind::text end || ')', 'propietario ' || pg_get_userbyid(c.relowner) || ' / ACL ' || coalesce(c.relacl::text, '(por defecto)') || ' / reltuples estimado ' || c.reltuples::bigint::text || coalesce(' / security_invoker=' || (select split_part(o, '=', 2) from unnest(c.reloptions) o where o like 'security_invoker=%'), '')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'vault' and c.relkind in ('r', 'v', 'm')
union all select 'B2 vault privilegio efectivo', r || ' sobre ' || c.relname, 'SELECT=' || has_table_privilege(r, c.oid, 'SELECT')::text || ' INSERT=' || has_table_privilege(r, c.oid, 'INSERT')::text || ' UPDATE=' || has_table_privilege(r, c.oid, 'UPDATE')::text || ' DELETE=' || has_table_privilege(r, c.oid, 'DELETE')::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace, unnest(array['anon', 'authenticated', 'service_role']) r where n.nspname = 'vault' and c.relkind in ('r', 'v', 'm')
union all select 'B2 vault privilegio efectivo', r || ' sobre la columna decrypted_secret de decrypted_secrets (SELECT)', case when to_regclass('vault.decrypted_secrets') is null then 'n/a' else has_column_privilege(r, 'vault.decrypted_secrets', 'decrypted_secret', 'SELECT')::text end
  from unnest(array['anon', 'authenticated', 'service_role']) r
union all select 'B3 vault función', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', 'propietario ' || pg_get_userbyid(p.proowner) || ' / ' || case when p.prosecdef then 'SECURITY DEFINER' else 'SECURITY INVOKER' end || ' / EXECUTE: anon=' || has_function_privilege('anon', p.oid, 'EXECUTE')::text || ' authenticated=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text || ' service_role=' || has_function_privilege('service_role', p.oid, 'EXECUTE')::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'vault'
union all select 'B4 vault privilegios por defecto', coalesce(pg_get_userbyid(d.defaclrole), '?') || ' / ' || d.defaclobjtype::text, coalesce(d.defaclacl::text, '(ninguno)')
  from pg_default_acl d where d.defaclnamespace = to_regnamespace('vault')
union all select 'B5 pertenencia de service_role', 'es miembro de', coalesce((select string_agg(pg_get_userbyid(m.roleid) || case when m.inherit_option then ' (hereda)' else ' (no hereda)' end, ', ') from pg_auth_members m where m.member = (select oid from pg_roles where rolname = 'service_role')), '(ningún rol)')
union all select 'B5 pertenencia de service_role', 'rolbypassrls / rolsuper', coalesce((select rolbypassrls::text || ' / ' || rolsuper::text from pg_roles where rolname = 'service_role'), 'no existe')
union all select 'B6 API de datos', 'esquemas expuestos por PostgREST (pgrst.db_schemas del rol authenticator)', coalesce((select string_agg(c, '; ') from pg_roles r, unnest(r.rolconfig) c where r.rolname = 'authenticator' and c like 'pgrst.db_schemas=%'), '(no configurado en el rol authenticator)')
union all select 'B6 API de datos', 'esquemas expuestos (pgrst.db_extra_search_path)', coalesce((select string_agg(c, '; ') from pg_roles r, unnest(r.rolconfig) c where r.rolname = 'authenticator' and c like 'pgrst.db_extra_search_path=%'), '(no configurado)')
order by 1, 2, 3;
