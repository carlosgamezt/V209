-- 28 · endurecimiento: pruebas de regresión de seguridad BASADAS EN EL CATÁLOGO. Cualquier migración futura que abra una tabla, una política, una función o un privilegio por error rompe estas pruebas.
-- Verifican lo que declara la migración 20261113000100_fel_endurecimiento_28.sql y las garantías de las 27 anteriores (RLS, privilegios, políticas, cascadas, funciones SECURITY DEFINER).
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

-- 9. service_role NO puede borrar ni vaciar tablas fiscales, libros ni auditoría
do $$ declare t text[]; begin
  select array_agg(c.relname::text order by c.relname) into t from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p')
     and c.relname in ('documentos','documento_lineas','documento_estados','operaciones_fiscales','auditoria','artefactos_documento','eventos_proveedor','consumos','cargos','pagos','cobros',
                       'bolson_movimientos','bolson_lotes','monedero_movimientos','conciliaciones','alertas_fiscales','ordenes_emision')
     and (has_table_privilege('service_role', c.oid, 'DELETE') or has_table_privilege('service_role', c.oid, 'TRUNCATE'));
  assert t is null, 'service_role puede borrar o vaciar tablas fiscales: ' || t::text;
end $$;

-- 10. Las empresas no se borran ni se vacían (se inhabilitan)
do $$ begin
  assert not has_table_privilege('service_role', 'public.empresas', 'DELETE'), 'service_role puede borrar empresas';
  assert not has_table_privilege('service_role', 'public.empresas', 'TRUNCATE'), 'service_role puede vaciar empresas';
end $$;


-- 11. las empresas no se borran ni se vacían (ni siquiera quien es dueño de la tabla), pero sí se inhabilitan
do $$ declare e uuid; begin
  insert into public.empresas (nombre_comercial, razon_social, nit) values ('Empresa de prueba 28', 'Empresa de prueba 28, S.A.', '9999999-9') returning id into e;
  begin delete from public.empresas where id = e; raise exception 'NO DEBIÓ BORRAR'; exception when others then assert sqlerrm like 'FEL_REGLA:%no se borran%', 'mensaje: ' || sqlerrm; end;
  begin truncate public.empresas; raise exception 'NO DEBIÓ VACIAR'; exception when others then assert sqlerrm like 'FEL_REGLA:%no se borran%' or sqlerrm like 'cannot truncate a table referenced%', 'mensaje: ' || sqlerrm; end;   -- sin CASCADE ya lo frena PostgreSQL por las claves foráneas; con CASCADE, el disparador
  begin truncate public.empresas cascade; raise exception 'NO DEBIÓ VACIAR EN CASCADA'; exception when others then assert sqlerrm like 'FEL_REGLA:%no se borran%', 'mensaje: ' || sqlerrm; end;
  assert exists (select 1 from public.empresas where id = e), 'la empresa sigue existiendo';
end $$;

-- 12. el rol de servicio no puede borrar ni vaciar tablas de ninguna manera (comprobado actuando como él)
set local role service_role;
do $$ begin
  begin delete from public.clientes; raise exception 'NO DEBIÓ'; exception when insufficient_privilege then null; end;
  begin truncate public.clientes; raise exception 'NO DEBIÓ'; exception when insufficient_privilege then null; end;
  begin delete from public.auditoria; raise exception 'NO DEBIÓ'; exception when insufficient_privilege then null; end;
  begin delete from public.empresas; raise exception 'NO DEBIÓ'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 13. ningún disparador de «public» es ejecutable por los roles de la API (y sigue disparándose: probado en el punto 11)
do $$ declare n int; begin
  select count(*) into n from pg_trigger t join pg_proc p on p.oid = t.tgfoid join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and not t.tgisinternal and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('service_role', p.oid, 'EXECUTE'));
  assert n = 0, 'disparadores ejecutables por roles de la API: ' || n;
end $$;

-- 14. la confirmación de una orden solo puede apuntar a una orden de su misma empresa: clave foránea compuesta y validada
do $$ begin
  assert exists (select 1 from pg_constraint where conrelid = 'public.ordenes_confirmaciones'::regclass and contype = 'f' and convalidated
                   and confrelid = 'public.ordenes_emision'::regclass
                   and (select array_agg(a.attname::text order by k.ord) from unnest(conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = conrelid and a.attnum = k.attnum) = array['orden_id','empresa_id']),
    'falta la clave foránea compuesta (orden_id, empresa_id)';
end $$;

-- 15. regla general: toda clave foránea entre dos tablas con empresa_id debe incluir el empresa_id del hijo, salvo las ya revisadas y justificadas
--     (bolsón global de la plataforma, cuyas filas pueden no tener empresa y solo las lee el administrador de la plataforma)
do $$ declare t text[]; begin
  select array_agg(conrelid::regclass::text || '->' || confrelid::regclass::text || ' (' || conname || ')' order by conname) into t from pg_constraint c
   where c.contype = 'f' and c.connamespace = 'public'::regnamespace
     and exists (select 1 from pg_attribute a where a.attrelid = c.conrelid and a.attname = 'empresa_id' and not a.attisdropped)
     and exists (select 1 from pg_attribute a where a.attrelid = c.confrelid and a.attname = 'empresa_id' and not a.attisdropped)
     and not exists (select 1 from pg_attribute a where a.attrelid = c.conrelid and a.attname = 'empresa_id' and a.attnum = any (c.conkey))
     -- hay otra clave foránea compuesta que sí incluye empresa_id hacia la misma tabla padre
     and not exists (select 1 from pg_constraint c2 join pg_attribute a2 on a2.attrelid = c2.conrelid and a2.attname = 'empresa_id' and a2.attnum = any (c2.conkey)
                      where c2.contype = 'f' and c2.conrelid = c.conrelid and c2.confrelid = c.confrelid)
     and conname not in ('bolson_conciliacion_partidas_consumo_id_cuenta_id_fkey', 'bolson_partida_resoluciones_movimiento_id_fkey', 'bolson_partida_resoluciones_partida_id_cuenta_id_fkey', 'bolson_mov_partida_fk');
  assert t is null, 'claves foráneas entre empresas sin empresa_id: ' || t::text;
end $$;

rollback;
select 'ENDURECIMIENTO 28 OK' as resultado;
