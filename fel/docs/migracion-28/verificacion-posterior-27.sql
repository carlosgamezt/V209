-- VERIFICACIÓN POSTERIOR A LA ETAPA 1 (V1 reforzada) · SOLO LECTURA (catálogo y conteos): se ejecuta con default_transaction_read_only=on.
-- Comprueba, además de «27 registradas / RLS / Auth» (lo hace supabase-hospedado.sh), lo que declara EVALUACION-RIESGOS-Y-PLAN-ETAPA-1.md §2: 67 tablas, 49 políticas, 182 funciones propias, 57 disparadores,
-- privilegios efectivos (anon sin nada, authenticated solo lee, solo 3 funciones ejecutables), CERO filas de negocio (solo semillas conocidas) y semillas «falla cerrado». Los puntos 1–8 son los de la verificación de la 28.
\set ON_ERROR_STOP on
begin;

-- 1. Toda tabla de public tiene RLS activado
do $$ declare t text[]; begin
  select array_agg(c.relname::text order by c.relname) into t from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity;
  assert t is null, 'tablas sin RLS: ' || t::text;
end $$;

-- 2. anon no tiene NINGÚN privilegio (tabla, columna ni secuencia)
do $$ declare n int; begin
  select count(*) into n from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon';
  assert n = 0, 'anon tiene privilegios de tabla: ' || n;
  select count(*) into n from information_schema.column_privileges where table_schema = 'public' and grantee = 'anon';
  assert n = 0, 'anon tiene privilegios de columna: ' || n;
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'S' and (has_sequence_privilege('anon', c.oid, 'USAGE') or has_sequence_privilege('authenticated', c.oid, 'USAGE'));
  assert n = 0, 'anon o authenticated pueden usar secuencias: ' || n;
end $$;

-- 3. authenticated solo LEE (ningún INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER, ni por tabla ni por columna)
do $$ declare n int; begin
  select count(*) into n from information_schema.role_table_grants where table_schema = 'public' and grantee = 'authenticated' and privilege_type <> 'SELECT';
  assert n = 0, 'authenticated tiene privilegios de escritura sobre tablas: ' || n;
  select count(*) into n from information_schema.column_privileges where table_schema = 'public' and grantee = 'authenticated' and privilege_type <> 'SELECT';
  assert n = 0, 'authenticated tiene privilegios de escritura sobre columnas: ' || n;
end $$;

-- 4. Toda política es SOLO de lectura, solo para authenticated, sin WITH CHECK, con condición; «true» únicamente en los catálogos públicos permitidos
do $$ declare t text[]; begin
  select array_agg(tablename||'.'||policyname) into t from pg_policies where schemaname = 'public' and (cmd <> 'SELECT' or roles <> '{authenticated}' or with_check is not null or qual is null);
  assert t is null, 'políticas no permitidas: ' || t::text;
  select array_agg(tablename order by tablename) into t from pg_policies where schemaname = 'public' and qual = 'true'
     and tablename not in ('evento_tipos','identificaciones_tipos','permisos_catalogo','proveedores_emision','rol_permisos');
  assert t is null, 'políticas abiertas («true») fuera de la lista de catálogos: ' || t::text;
end $$;

-- 5. Toda tabla con columna empresa_id y política: la condición mira empresa_id (o es solo de la plataforma)
do $$ declare t text[]; begin
  select array_agg(p.tablename order by p.tablename) into t from pg_policies p
   where p.schemaname = 'public'
     and exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = p.tablename and c.column_name = 'empresa_id')
     and p.qual !~* 'empresa_id' and p.qual !~* 'fel_es_admin_plataforma\(\)$';
  assert t is null, 'tablas con empresa_id cuya política no filtra por empresa: ' || t::text;
end $$;

-- 6. Sin vistas (una vista salta RLS salvo security_invoker)
do $$ declare n int; begin
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind in ('v','m');
  assert n = 0, 'hay vistas en public: ' || n;
end $$;

-- 7. Toda función SECURITY DEFINER tiene search_path fijado y ninguna es ejecutable por PUBLIC o anon
do $$ declare t text[]; begin
  select array_agg(p.proname::text order by p.proname) into t from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and not exists (select 1 from pg_options_to_table(p.proconfig) o where o.option_name = 'search_path');
  assert t is null, 'SECURITY DEFINER sin search_path: ' || t::text;
end $$;

-- 8. ON DELETE CASCADE solo en la lista conocida (ninguno alcanza datos fiscales)
do $$ declare t text[]; begin
  select array_agg(conrelid::regclass::text||'->'||confrelid::regclass::text order by 1) into t from pg_constraint
   where contype = 'f' and connamespace = 'public'::regnamespace and confdeltype in ('c','n','d')
     and conrelid::regclass::text||'->'||confrelid::regclass::text not in (
       'plataforma_admins->auth.users','perfiles->auth.users','miembros->auth.users','documento_lineas->documentos','solicitudes_recuperacion_mfa->auth.users','revocaciones_sesion->auth.users','demo_sesiones->demo_credenciales');
  assert t is null, 'cascadas no previstas: ' || t::text;
end $$;


-- 9. cifras exactas de la etapa 1
do $$ declare n int; f text; begin
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind in ('r','p');
  assert n = 67, 'tablas en public: ' || n || ' (se esperaban 67)';
  select count(*) into n from pg_policies where schemaname = 'public';
  assert n = 49, 'políticas en public: ' || n || ' (se esperaban 49)';
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public';
  assert n = 182, 'funciones propias en public: ' || n || ' (se esperaban 182)';
  select count(*) into n from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and not t.tgisinternal;
  assert n = 57, 'disparadores en public: ' || n || ' (se esperaban 57)';
  -- 10. privilegios efectivos sobre funciones: anon ninguna; authenticated solo las 3 de pertenencia/permiso
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE');
  assert n = 0, 'anon puede ejecutar ' || n || ' funciones de public';
  select string_agg(p.proname::text, ',' order by p.proname) into f from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'EXECUTE');
  assert f = 'fel_es_admin_plataforma,fel_es_miembro,fel_tiene_permiso', 'funciones ejecutables por authenticated: ' || coalesce(f, '(ninguna)');
  -- 11. el esquema vault no es usable por los roles de la API salvo service_role (conocido y registrado)
  assert to_regnamespace('vault') is null or (not has_schema_privilege('anon', 'vault', 'USAGE') and not has_schema_privilege('authenticated', 'vault', 'USAGE')), 'anon/authenticated pueden usar el esquema vault';
end $$;

-- 12. CERO filas de negocio: solo las semillas conocidas (catálogos y parámetros) tienen filas, con su número exacto
do $$ declare r record; esperado jsonb := '{"evento_tipos":10,"identificaciones_tipos":4,"permisos_catalogo":28,"plataforma_config":1,"plataforma_parametros":13,"proveedores_emision":4,"regimenes_fiscales":2,"reglas_normativas":1,"rol_permisos":78}'; malas text[] := '{}'; n int; begin
  for r in select c.relname::text as t from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind in ('r','p') order by 1 loop
    n := (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', r.t), false, true, '')))[1]::text::int;
    if n <> coalesce((esperado ->> r.t)::int, 0) then malas := malas || (r.t || '=' || n); end if;
  end loop;
  assert cardinality(malas) = 0, 'tablas con filas distintas de las semillas esperadas: ' || malas::text;
  assert (select count(*) from public.empresas) = 0, 'hay empresas';
end $$;

-- 13. semillas «falla cerrado»
do $$ begin
  assert (select valor from public.plataforma_config where clave = 'emision_real_disponible') is false, 'emision_real_disponible no es falso';
  assert not exists (select 1 from public.proveedores_emision where ambientes <> '{simulado}'::text[]), 'hay proveedores con ambientes distintos de simulado';
  assert not exists (select 1 from public.regimenes_fiscales where estado <> 'sin_verificar'), 'hay regímenes verificados';
end $$;

rollback;
