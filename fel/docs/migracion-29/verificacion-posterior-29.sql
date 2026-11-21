-- VERIFICACIÓN POSTERIOR A LA 29 · SOLO LECTURA (catálogo): se puede ejecutar contra la base hospedada con default_transaction_read_only=on.
-- Comprueba lo que declara 20261114000100_fel_digifact_operaciones.sql: tablas y funciones nuevas, RLS, privilegios (nadie salvo el propietario), claves foráneas compuestas con empresa_id, índices contra duplicados,
-- disparadores activos, funciones con search_path vacío y las cifras exactas del esquema (1–28 + 29). Además repite las garantías de la 28 que la 29 NO debe romper. No escribe nada.
\set ON_ERROR_STOP on
begin;

-- 1. existen las dos tablas, con RLS y sin políticas (no hay acceso por la API)
do $$ declare t text; begin
  foreach t in array array['digifact_operaciones', 'digifact_artefactos'] loop
    assert to_regclass('public.' || t) is not null, 'falta la tabla ' || t;
    assert (select c.relrowsecurity from pg_class c where c.oid = ('public.' || t)::regclass), t || ' sin RLS';
    assert not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t), t || ' tiene políticas';
  end loop;
end $$;

-- 2. privilegios: ningún rol de la API ni PUBLIC tiene nada sobre las tablas; solo el propietario
do $$ declare t text; r text; n int; begin
  foreach t in array array['digifact_operaciones', 'digifact_artefactos'] loop
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      assert not (has_table_privilege(r, 'public.' || t, 'SELECT') or has_table_privilege(r, 'public.' || t, 'INSERT') or has_table_privilege(r, 'public.' || t, 'UPDATE') or has_table_privilege(r, 'public.' || t, 'DELETE')
               or has_table_privilege(r, 'public.' || t, 'TRUNCATE') or has_table_privilege(r, 'public.' || t, 'REFERENCES') or has_table_privilege(r, 'public.' || t, 'TRIGGER')), r || ' tiene privilegios sobre ' || t;
      select count(*) into n from information_schema.column_privileges where table_schema = 'public' and table_name = t and grantee = r; assert n = 0, r || ' tiene privilegios de columna sobre ' || t;
    end loop;
    select count(*) into n from pg_class c, aclexplode(c.relacl) a where c.oid = ('public.' || t)::regclass and a.grantee <> c.relowner; assert n = 0, 'privilegios ajenos al propietario (incluido PUBLIC) sobre ' || t;
  end loop;
end $$;

-- 3. funciones: las tres existen, nadie salvo el propietario puede ejecutarlas, search_path vacío y una sola SECURITY DEFINER (la de aplicar)
do $$ declare f oid; r text; n int; begin
  assert (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('fel_digifact_op_guarda', 'fel_digifact_art_guarda', 'fel_sys_digifact_aplicar')) = 3, 'faltan funciones de la 29';
  for f in select p.oid from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('fel_digifact_op_guarda', 'fel_digifact_art_guarda', 'fel_sys_digifact_aplicar') loop
    foreach r in array array['anon', 'authenticated', 'service_role'] loop assert not has_function_privilege(r, f, 'EXECUTE'), r || ' puede ejecutar ' || f::regproc::text; end loop;
    select count(*) into n from pg_proc p, aclexplode(p.proacl) a where p.oid = f and a.grantee <> p.proowner; assert n = 0, 'EXECUTE ajeno al propietario (incluido PUBLIC) en ' || f::regproc::text;
    assert exists (select 1 from pg_proc p where p.oid = f and p.proconfig @> array['search_path=""']), 'search_path no vacío en ' || f::regproc::text;
  end loop;
  assert (select prosecdef from pg_proc where pronamespace = 'public'::regnamespace and proname = 'fel_sys_digifact_aplicar'), 'fel_sys_digifact_aplicar debe ser SECURITY DEFINER';
  assert not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('fel_digifact_op_guarda', 'fel_digifact_art_guarda') and prosecdef), 'los disparadores no deben ser SECURITY DEFINER';
end $$;

-- 4. disparadores presentes y ACTIVOS (O = origen), con los eventos que protegen
do $$ declare t record; begin
  select tgenabled, tgtype into t from pg_trigger where tgname = 'digifact_op_guarda' and tgrelid = 'public.digifact_operaciones'::regclass; assert found and t.tgenabled = 'O', 'digifact_op_guarda ausente o desactivado';
  assert (t.tgtype & 4) <> 0 and (t.tgtype & 8) <> 0 and (t.tgtype & 16) <> 0 and (t.tgtype & 2) <> 0 and (t.tgtype & 1) <> 0, 'digifact_op_guarda debe ser BEFORE ROW de INSERT, DELETE y UPDATE';
  select tgenabled, tgtype into t from pg_trigger where tgname = 'digifact_art_guarda' and tgrelid = 'public.digifact_artefactos'::regclass; assert found and t.tgenabled = 'O', 'digifact_art_guarda ausente o desactivado';
  assert (t.tgtype & 4) <> 0 and (t.tgtype & 8) <> 0 and (t.tgtype & 16) <> 0 and (t.tgtype & 2) <> 0 and (t.tgtype & 1) <> 0, 'digifact_art_guarda debe ser BEFORE ROW de INSERT, DELETE y UPDATE';
end $$;

-- 5. contra duplicados: los tres índices únicos parciales existen, son únicos y válidos, con el predicado esperado
do $$ declare i record; begin
  for i in select * from (values ('digifact_op_una_que_bloquea_uq', 'estado'), ('digifact_op_preparada_uq', 'preparada'), ('digifact_op_autorizacion_uq', 'autorizacion')) v(nombre, buscar) loop
    assert exists (select 1 from pg_index x join pg_class c on c.oid = x.indexrelid where c.relname = i.nombre and c.relnamespace = 'public'::regnamespace and x.indisunique and x.indisvalid and x.indpred is not null
                    and pg_get_indexdef(x.indexrelid) ilike '%' || i.buscar || '%'), 'índice único parcial ausente o inválido: ' || i.nombre;
  end loop;
  assert pg_get_indexdef('public.digifact_op_una_que_bloquea_uq'::regclass) ~* 'enviando' and pg_get_indexdef('public.digifact_op_una_que_bloquea_uq'::regclass) ~* 'certificada' and pg_get_indexdef('public.digifact_op_una_que_bloquea_uq'::regclass) ~* 'desconocida', 'el índice que bloquea debe cubrir enviando, certificada y desconocida';
end $$;

-- 6. aislamiento POR CLAVE FORÁNEA: toda clave foránea de las dos tablas hacia tablas con empresa_id incluye empresa_id; sin cascadas
do $$ declare t text[]; begin
  select array_agg(c.conrelid::regclass::text || '->' || c.confrelid::regclass::text || ' (' || c.conname || ')') into t from pg_constraint c
   where c.contype = 'f' and c.conrelid in ('public.digifact_operaciones'::regclass, 'public.digifact_artefactos'::regclass)
     and exists (select 1 from pg_attribute a where a.attrelid = c.confrelid and a.attname = 'empresa_id' and not a.attisdropped)
     and not exists (select 1 from pg_attribute a where a.attrelid = c.conrelid and a.attname = 'empresa_id' and a.attnum = any (c.conkey));
  assert t is null, 'claves foráneas sin empresa_id: ' || t::text;
  assert exists (select 1 from pg_constraint c where c.contype = 'f' and c.conrelid = 'public.digifact_artefactos'::regclass and c.confrelid = 'public.digifact_operaciones'::regclass and c.convalidated
                  and (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) = array['operacion_id', 'empresa_id']), 'falta la clave foránea compuesta artefacto→operación';
  assert exists (select 1 from pg_constraint c where c.contype = 'f' and c.conrelid = 'public.digifact_operaciones'::regclass and c.confrelid = 'public.documentos'::regclass and c.convalidated
                  and (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) = array['documento_id', 'empresa_id']), 'falta la clave foránea compuesta operación→documento';
  assert not exists (select 1 from pg_constraint c where c.contype = 'f' and c.conrelid in ('public.digifact_operaciones'::regclass, 'public.digifact_artefactos'::regclass) and c.confdeltype <> 'a'), 'las claves foráneas de la 29 no deben tener acciones en cascada';
end $$;

-- 7. cifras exactas del esquema 1–28 + 29: 69 tablas (todas con RLS), 49 políticas, 185 funciones, 61 disparadores; la 29 no abrió ningún privilegio a la API
do $$ declare n int; begin
  select count(*) into n from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p'); assert n = 69, 'tablas en public: ' || n || ' (se esperaban 69)';
  select count(*) into n from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') and not c.relrowsecurity; assert n = 0, 'tablas sin RLS: ' || n;
  select count(*) into n from pg_policies where schemaname = 'public'; assert n = 49, 'políticas en public: ' || n || ' (se esperaban 49)';
  select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace; assert n = 185, 'funciones propias en public: ' || n || ' (se esperaban 185)';
  select count(*) into n from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal; assert n = 61, 'disparadores en public: ' || n || ' (se esperaban 61)';
  assert not has_table_privilege('service_role', 'public.empresas', 'DELETE') and not has_table_privilege('service_role', 'public.empresas', 'TRUNCATE'), 'service_role puede borrar o vaciar empresas';
end $$;

-- 8. informativo (no falla): filas actuales
do $$ declare a bigint; b bigint; begin
  select count(*) into a from public.digifact_operaciones; select count(*) into b from public.digifact_artefactos;
  raise notice 'filas: digifact_operaciones = %, digifact_artefactos = %', a, b;
end $$;

rollback;
select 'VERIFICACION POSTERIOR 29 OK (solo lectura)' as resultado;
