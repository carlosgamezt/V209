-- PROPUESTA · verificación inicial de «nexa-demo» ANTES de aplicar cualquier migración. SOLO LECTURA: únicamente SELECT sobre el catálogo del sistema; no lee datos de negocio, ni correos, ni contraseñas.
-- Se ejecutaría con la sesión forzada a solo lectura (PGOPTIONS="-c default_transaction_read_only=on"). Cada fila: comprobación | resultado | esperado | estado (OK / REVISAR / INFO). «INFO» nunca bloquea: solo informa.
\pset format unaligned
\pset fieldsep ' | '
\pset tuples_only on
select 'sesión de solo lectura' as comprobacion, current_setting('transaction_read_only') as resultado, 'on' as esperado, case when current_setting('transaction_read_only') = 'on' then 'OK' else 'REVISAR' end as estado
union all select 'versión de PostgreSQL', current_setting('server_version'), '15 o superior', case when current_setting('server_version_num')::int >= 150000 then 'OK' else 'REVISAR' end
union all select 'rol de la conexión puede crear en public', has_schema_privilege(current_user, 'public', 'CREATE')::text, 'true', case when has_schema_privilege(current_user, 'public', 'CREATE') then 'OK' else 'REVISAR' end
union all select 'rol «' || r || '» existe', exists (select 1 from pg_roles where rolname = r)::text, 'true', case when exists (select 1 from pg_roles where rolname = r) then 'OK' else 'REVISAR' end from unnest(array['anon', 'authenticated', 'service_role']) r
union all select 'rol service_role omite RLS (rolbypassrls)', coalesce((select rolbypassrls::text from pg_roles where rolname = 'service_role'), 'no existe'), 'true (así lo documenta Supabase)', 'INFO'
-- dependencias de Supabase Auth que usan las 27 migraciones (las mismas columnas que comprueba fel_verificar_dependencias_auth)
union all select 'auth.' || t || '.' || c || ' existe', exists (select 1 from information_schema.columns i where i.table_schema = 'auth' and i.table_name = t and i.column_name = c)::text, 'true',
       case when exists (select 1 from information_schema.columns i where i.table_schema = 'auth' and i.table_name = t and i.column_name = c) then 'OK' else 'REVISAR' end
  from (values ('users', 'id'), ('users', 'email'), ('users', 'email_confirmed_at'), ('mfa_factors', 'id'), ('mfa_factors', 'user_id'), ('mfa_factors', 'factor_type'), ('mfa_factors', 'status'), ('sessions', 'id'), ('sessions', 'user_id')) as d(t, c)
union all select 'función auth.uid() existe', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'auth' and p.proname = 'uid')::text, 'true',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'auth' and p.proname = 'uid') then 'OK' else 'REVISAR' end
-- la base debe estar VACÍA y sin historial (la etapa 1 lo exige)
union all select 'tablas en public', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm'))::text, '0', case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')) = 0 then 'OK' else 'REVISAR' end
-- funciones propias en public: SOLO se reconoce (como función de la plataforma) public.rls_auto_enable() cuando coincide TODO esto: propietario postgres/supabase_admin, SECURITY DEFINER, plpgsql, volátil, devuelve event_trigger,
-- configuración exactamente search_path=pg_catalog, huella SHA-256 del cuerpo = la de la definición verificada (supabase/tests/plataforma/rls_auto_enable_real.sql) y el disparador de evento «ensure_rls» activo en ddl_command_end con
-- exactamente las etiquetas CREATE TABLE / CREATE TABLE AS / SELECT INTO. Cualquier otra función, o esa misma modificada en algo, cuenta como REVISAR (falla cerrado).
union all select 'funciones propias en public (no reconocidas)', count(*) filter (where not f.reconocida)::text || coalesce(' → ' || left(string_agg(f.proname, ', ' order by f.proname) filter (where not f.reconocida), 200), ''), '0',
       case when count(*) filter (where not f.reconocida) = 0 then 'OK' else 'REVISAR' end
  from (select p.proname, p.oid, encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') as huella,
         (p.proname = 'rls_auto_enable' and p.pronargs = 0 and p.prorettype = 'event_trigger'::regtype and p.prosecdef and p.provolatile = 'v'
          and p.prolang = (select oid from pg_language where lanname = 'plpgsql') and pg_get_userbyid(p.proowner) in ('postgres', 'supabase_admin')
          and coalesce(p.proconfig, '{}'::text[]) = array['search_path=pg_catalog']
          and encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') = '325ae266d9b166715ef5230ceaf7ff9d523e483cf5610dfb9779ab3f183f4af9'
          and exists (select 1 from pg_event_trigger e where e.evtname = 'ensure_rls' and e.evtfoid = p.oid and e.evtevent = 'ddl_command_end' and e.evtenabled = 'O'
                       and e.evttags @> array['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO'] and e.evttags <@ array['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO'])) as reconocida
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')) f
union all select 'función de plataforma reconocida', coalesce(string_agg('public.' || f.proname || '() (huella SHA-256 coincide con la verificada)', ', '), '(ninguna)'), 'informativo', 'INFO'
  from (select p.proname, p.oid, encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') as huella,
         (p.proname = 'rls_auto_enable' and p.pronargs = 0 and p.prorettype = 'event_trigger'::regtype and p.prosecdef and p.provolatile = 'v'
          and p.prolang = (select oid from pg_language where lanname = 'plpgsql') and pg_get_userbyid(p.proowner) in ('postgres', 'supabase_admin')
          and coalesce(p.proconfig, '{}'::text[]) = array['search_path=pg_catalog']
          and encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') = '325ae266d9b166715ef5230ceaf7ff9d523e483cf5610dfb9779ab3f183f4af9'
          and exists (select 1 from pg_event_trigger e where e.evtname = 'ensure_rls' and e.evtfoid = p.oid and e.evtevent = 'ddl_command_end' and e.evtenabled = 'O'
                       and e.evttags @> array['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO'] and e.evttags <@ array['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO'])) as reconocida
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')) f where f.reconocida
union all select 'función rls_auto_enable NO reconocida: huella SHA-256 real del cuerpo', f.huella, 'huella verificada 325ae266d9b166715ef5230ceaf7ff9d523e483cf5610dfb9779ab3f183f4af9', 'INFO'
  from (select p.proname, p.oid, encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') as huella,
         (p.proname = 'rls_auto_enable' and p.pronargs = 0 and p.prorettype = 'event_trigger'::regtype and p.prosecdef and p.provolatile = 'v'
          and p.prolang = (select oid from pg_language where lanname = 'plpgsql') and pg_get_userbyid(p.proowner) in ('postgres', 'supabase_admin')
          and coalesce(p.proconfig, '{}'::text[]) = array['search_path=pg_catalog']
          and encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') = '325ae266d9b166715ef5230ceaf7ff9d523e483cf5610dfb9779ab3f183f4af9'
          and exists (select 1 from pg_event_trigger e where e.evtname = 'ensure_rls' and e.evtfoid = p.oid and e.evtevent = 'ddl_command_end' and e.evtenabled = 'O'
                       and e.evttags @> array['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO'] and e.evttags <@ array['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO'])) as reconocida
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')) f where f.proname = 'rls_auto_enable' and not f.reconocida
union all select 'historial de migraciones', case when to_regclass('supabase_migrations.schema_migrations') is null then 'no existe' else 'existe' end, 'no existe (o vacío)', case when to_regclass('supabase_migrations.schema_migrations') is null then 'OK' else 'REVISAR' end
-- extensiones: Vault y pgsodium (informativo; Vault no se usa todavía)
union all select 'extensión ' || e, coalesce((select 'disponible ' || default_version || ', instalada ' || coalesce(installed_version, 'no') from pg_available_extensions where name = e), 'no disponible'), 'informativo', 'INFO' from unnest(array['supabase_vault', 'pgsodium', 'pgcrypto']) e
union all select 'privilegio USAGE sobre el esquema vault: ' || r, case when to_regnamespace('vault') is null then 'el esquema vault no existe' else has_schema_privilege(r, 'vault', 'USAGE')::text end, 'false para los tres roles de la API', 'INFO' from unnest(array['anon', 'authenticated', 'service_role']) r
-- contexto del proyecto (informativo)
union all select 'esquemas no del sistema', coalesce((select string_agg(nspname, ', ' order by nspname) from pg_namespace where nspname not like 'pg\_%' and nspname <> 'information_schema'), '-'), 'informativo', 'INFO'
union all select 'privilegios por defecto del esquema public (roles con acceso)', coalesce((select string_agg(distinct coalesce((select rolname from pg_roles where oid = a.grantee), 'PUBLIC'), ', ') from pg_default_acl d, lateral aclexplode(d.defaclacl) a where d.defaclnamespace = 'public'::regnamespace), 'ninguno'), 'informativo (la 28 revoca DELETE/TRUNCATE a service_role en tablas ya creadas)', 'INFO'
union all select 'publicaciones de replicación', coalesce((select string_agg(pubname, ', ') from pg_publication), 'ninguna'), 'informativo', 'INFO'
union all select 'disparadores de evento', (select count(*) from pg_event_trigger)::text, 'informativo', 'INFO'
order by 4 desc, 1;
