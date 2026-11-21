-- 29 · almacén persistente de Digifact (operaciones, artefactos y aplicación al documento): pruebas de la propia base con roles reales.
-- Cubre: privilegios por rol, aislamiento por clave foránea compuesta, protección contra duplicados, máquina de estados, inmutabilidad de certificados y artefactos (SHA-256) e idempotencia de la aplicación.
\set ON_ERROR_STOP on
begin;

create function pg_temp.falla(q text, patron text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then
    if sqlerrm !~ patron then raise exception 'falló con otro mensaje: % (se esperaba /%/) · %', sqlerrm, patron, left(q, 90); end if;
    return;
  end;
  raise exception 'debía fallar y no falló: %', left(q, 110);
end $$;

-- datos de prueba: dos empresas, un actor y documentos revisados
insert into auth.users (id, email, email_confirmed_at) values ('30000000-0000-0000-0000-000000000029', 'actor29@prueba.local', now()) on conflict (id) do nothing;
insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id)
  select e.id, e.nom, e.nom || ' S.A.', e.nit, r.id from (values ('10000000-0000-0000-0000-0000000029a1'::uuid, 'Empresa 29-A', '2900001-1'), ('10000000-0000-0000-0000-0000000029b2'::uuid, 'Empresa 29-B', '2900002-2')) e(id, nom, nit),
       (select id from public.regimenes_fiscales where codigo = 'general') r;
insert into public.documentos (id, empresa_id, numero_borrador, estado_preparacion)
  select ('20000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, case when n = 900 then '10000000-0000-0000-0000-0000000029b2'::uuid else '10000000-0000-0000-0000-0000000029a1'::uuid end, n, 'borrador' from unnest(array[1,2,3,4,5,6,900]) n;
update public.documentos set estado_preparacion = 'revisado' where id::text like '20000000-0000-0000-0000-%';

create function pg_temp.doc(n int) returns uuid language sql as $$ select ('20000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.nueva(p_emp uuid, p_doc uuid, p_ref uuid default gen_random_uuid()) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); begin
  insert into public.digifact_operaciones (id, empresa_id, documento_id, referencia, hash, huella_emisor, fecha_emision, establecimiento, total, estado, creada_ms, actualizada_ms, actor_id, intento_del_documento)
  values (v, p_emp, p_doc, p_ref, repeat('a', 64), '0123456789abcdef', '2026-11-16', 1, '112.00', 'preparada', 1000, 1000, '30000000-0000-0000-0000-000000000029', 0);
  return v; end $$;
create function pg_temp.estado(p_op uuid, p_estado text, p_res jsonb default null, p_ms bigint default 2000) returns void language sql as $$
  update public.digifact_operaciones set estado = p_estado, actualizada_ms = p_ms, resultado = coalesce(p_res, resultado) where id = p_op $$;
create function pg_temp.certificada(p_emp uuid, p_doc uuid, p_aut text, p_serie text default 'A001', p_num text default '5') returns uuid language plpgsql as $$
declare v uuid := pg_temp.nueva(p_emp, p_doc); begin
  perform pg_temp.estado(v, 'enviando'); perform pg_temp.estado(v, 'certificada', jsonb_build_object('autorizacion', p_aut, 'serie', p_serie, 'numero', p_num, 'fechaCertificacion', '2026-11-16T10:00:05'), 3000); return v; end $$;

\set A '10000000-0000-0000-0000-0000000029a1'
\set B '10000000-0000-0000-0000-0000000029b2'

-- 1. existencia, RLS y privilegios: NADIE salvo el propietario (anon, authenticated, service_role y PUBLIC) toca las tablas ni las funciones
do $$ declare t text; r text; n int; f oid; begin
  foreach t in array array['digifact_operaciones', 'digifact_artefactos'] loop
    assert (select c.relrowsecurity from pg_class c where c.oid = ('public.' || t)::regclass), t || ' sin RLS';
    assert not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t), t || ' no debe tener políticas (sin acceso por la API)';
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      assert not (has_table_privilege(r, 'public.' || t, 'SELECT') or has_table_privilege(r, 'public.' || t, 'INSERT') or has_table_privilege(r, 'public.' || t, 'UPDATE') or has_table_privilege(r, 'public.' || t, 'DELETE')
               or has_table_privilege(r, 'public.' || t, 'TRUNCATE') or has_table_privilege(r, 'public.' || t, 'REFERENCES') or has_table_privilege(r, 'public.' || t, 'TRIGGER')), r || ' tiene privilegios sobre ' || t;
    end loop;
    select count(*) into n from pg_class c, aclexplode(c.relacl) a where c.oid = ('public.' || t)::regclass and a.grantee <> c.relowner; assert n = 0, 'privilegios ajenos al propietario (incluido PUBLIC) sobre ' || t;
  end loop;
  for f in select p.oid from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('fel_digifact_op_guarda', 'fel_digifact_art_guarda', 'fel_sys_digifact_aplicar') loop
    foreach r in array array['anon', 'authenticated', 'service_role'] loop assert not has_function_privilege(r, f, 'EXECUTE'), r || ' puede ejecutar ' || f::regproc::text; end loop;
    select count(*) into n from pg_proc p, aclexplode(p.proacl) a where p.oid = f and a.grantee <> p.proowner; assert n = 0, 'EXECUTE ajeno al propietario (incluido PUBLIC) en ' || f::regproc::text;
  end loop;
  assert (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('fel_digifact_op_guarda', 'fel_digifact_art_guarda', 'fel_sys_digifact_aplicar')) = 3, 'faltan funciones';
  -- la única función SECURITY DEFINER es la de aplicar, con search_path vacío; los disparadores son del invocador y también con search_path vacío
  assert (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like '%digifact%' and prosecdef) = 1, 'solo una función SECURITY DEFINER';
  assert (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('fel_digifact_op_guarda', 'fel_digifact_art_guarda', 'fel_sys_digifact_aplicar') and p.proconfig @> array['search_path=""']) = 3, 'search_path debe ser vacío en las tres';
end $$;

-- 1b. con los roles REALES de la API: acceso denegado a tablas y funciones
set local role anon;
do $$ begin perform pg_temp.falla('select 1 from public.digifact_operaciones', 'permission denied'); perform pg_temp.falla('select 1 from public.digifact_artefactos', 'permission denied'); end $$;
reset role;
do $$ declare r text; begin
  foreach r in array array['authenticated', 'service_role'] loop
    execute 'set local role ' || r;
    perform pg_temp.falla('select * from public.digifact_operaciones', 'permission denied');
    perform pg_temp.falla('select * from public.digifact_artefactos', 'permission denied');
    perform pg_temp.falla('insert into public.digifact_operaciones (id) values (gen_random_uuid())', 'permission denied');
    perform pg_temp.falla('delete from public.digifact_operaciones', 'permission denied');
    perform pg_temp.falla('truncate public.digifact_operaciones', 'permission denied');
    perform pg_temp.falla($f$select public.fel_sys_digifact_aplicar('10000000-0000-0000-0000-0000000029a1', gen_random_uuid())$f$, 'permission denied');
    reset role;
  end loop;
end $$;
reset role;

-- 2. la base ya no acepta crear una operación fuera de «preparada» ni con resultado, ni cambiarle la identidad
select pg_temp.falla($q$insert into public.digifact_operaciones (id, empresa_id, documento_id, referencia, hash, huella_emisor, fecha_emision, establecimiento, total, estado, creada_ms, actualizada_ms, actor_id, intento_del_documento)
  values (gen_random_uuid(), '10000000-0000-0000-0000-0000000029a1', pg_temp.doc(1), gen_random_uuid(), repeat('a', 64), '0123456789abcdef', '2026-11-16', 1, '1.00', 'certificada', 1, 1, '30000000-0000-0000-0000-000000000029', 0)$q$, 'solo puede crearse «preparada»');
select pg_temp.falla($q$insert into public.digifact_operaciones (id, empresa_id, documento_id, referencia, hash, huella_emisor, fecha_emision, establecimiento, total, estado, creada_ms, actualizada_ms, actor_id, intento_del_documento, resultado)
  values (gen_random_uuid(), '10000000-0000-0000-0000-0000000029a1', pg_temp.doc(1), gen_random_uuid(), repeat('a', 64), '0123456789abcdef', '2026-11-16', 1, '1.00', 'preparada', 1, 1, '30000000-0000-0000-0000-000000000029', 0, '{"autorizacion":"X"}')$q$, 'solo puede crearse «preparada»');

-- 3. aislamiento POR CLAVE FORÁNEA: una operación no puede apuntar al documento de otra empresa; un artefacto no puede apuntar a la operación de otra empresa
select pg_temp.falla(format($q$select pg_temp.nueva('10000000-0000-0000-0000-0000000029a1', %L)$q$, pg_temp.doc(900)), 'foreign key|llave foránea|violates');   -- documento 900 es de B
select pg_temp.falla(format($q$select pg_temp.nueva('10000000-0000-0000-0000-0000000029b2', %L)$q$, pg_temp.doc(1)), 'foreign key|llave foránea|violates');   -- documento 1 es de A
do $$ declare op_a uuid := pg_temp.certificada('10000000-0000-0000-0000-0000000029a1', pg_temp.doc(1), 'AAAAAAAA-0000-0000-0000-00000000A001'); begin
  perform pg_temp.falla(format($q$insert into public.digifact_artefactos (empresa_id, documento_id, operacion_id, tipo, nombre, mime, sha256, tamano, contenido) values ('10000000-0000-0000-0000-0000000029b2', %L, %L, 'xml', 'x.xml', 'application/xml', encode(sha256('<x/>'::bytea), 'hex'), 4, '<x/>'::bytea)$q$, pg_temp.doc(900), op_a), 'no corresponde a la operación|foreign key|violates');
  -- la clave foránea compuesta por SÍ SOLA también lo impide (con el disparador desactivado un momento, dentro de esta transacción)
  alter table public.digifact_artefactos disable trigger digifact_art_guarda;
  perform pg_temp.falla(format($q$insert into public.digifact_artefactos (empresa_id, documento_id, operacion_id, tipo, nombre, mime, sha256, tamano, contenido) values ('10000000-0000-0000-0000-0000000029b2', %L, %L, 'xml', 'x.xml', 'application/xml', encode(sha256('<x/>'::bytea), 'hex'), 4, '<x/>'::bytea)$q$, pg_temp.doc(900), op_a), 'digifact_artefactos_operacion_id_empresa_id_fkey|foreign key|violates');
  alter table public.digifact_artefactos enable trigger digifact_art_guarda;
  assert (select tgenabled from pg_trigger where tgname = 'digifact_art_guarda') = 'O', 'el disparador debe quedar activo';
end $$;

create function pg_temp.segunda_no_envia(p_emp uuid, p_doc uuid) returns void language plpgsql as $$
declare v uuid := pg_temp.nueva(p_emp, p_doc); begin
  perform pg_temp.falla(format($q$update public.digifact_operaciones set estado = 'enviando', actualizada_ms = 9000 where id = %L$q$, v), 'digifact_op_una_que_bloquea_uq|duplicate key');
  perform pg_temp.estado(v, 'enviando', null, 9100) where false; end $$;

-- 4. duplicados: una sola operación que bloquea por documento; misma referencia no se prepara dos veces; una autorización no se repite en la empresa (sí entre empresas)
do $$ declare a uuid; r uuid := gen_random_uuid(); b uuid; begin
  a := pg_temp.nueva('10000000-0000-0000-0000-0000000029a1', pg_temp.doc(2), r);
  perform pg_temp.falla(format($q$select pg_temp.nueva('10000000-0000-0000-0000-0000000029a1', %L, %L)$q$, pg_temp.doc(2), r), 'duplicate key|unique|digifact_op_preparada_uq');   -- misma referencia preparada dos veces
  perform pg_temp.estado(a, 'enviando');
  perform pg_temp.segunda_no_envia('10000000-0000-0000-0000-0000000029a1', pg_temp.doc(2));   -- ya hay una «enviando» para ese documento: otra jamás pasa a «enviando»
  perform pg_temp.estado(a, 'desconocida', '{"motivoDesconocido":"corte"}', 3000);
  perform pg_temp.segunda_no_envia('10000000-0000-0000-0000-0000000029a1', pg_temp.doc(2));   -- «desconocida» también bloquea: no se reenvía
  perform pg_temp.estado(a, 'certificada', '{"autorizacion":"AAAAAAAA-0000-0000-0000-00000000A002","serie":"A002","numero":"7"}', 4000);
  perform pg_temp.segunda_no_envia('10000000-0000-0000-0000-0000000029a1', pg_temp.doc(2));   -- «certificada» bloquea para siempre
  -- tras un rechazo confirmado SÍ se puede preparar otro intento (nunca antes)
  b := pg_temp.nueva('10000000-0000-0000-0000-0000000029a1', pg_temp.doc(3)); perform pg_temp.estado(b, 'enviando'); perform pg_temp.estado(b, 'rechazada', '{"codigo":"400"}', 3000);
  perform pg_temp.nueva('10000000-0000-0000-0000-0000000029a1', pg_temp.doc(3));
  -- autorización repetida: dentro de la empresa NO; en otra empresa SÍ es otra identidad
  perform pg_temp.falla(format($q$select pg_temp.certificada('10000000-0000-0000-0000-0000000029a1', %L, 'AAAAAAAA-0000-0000-0000-00000000A002')$q$, pg_temp.doc(4)), 'digifact_op_autorizacion_uq|duplicate key');
  perform pg_temp.certificada('10000000-0000-0000-0000-0000000029b2', pg_temp.doc(900), 'AAAAAAAA-0000-0000-0000-00000000A002');
end $$;

-- 5. máquina de estados e inmutabilidad: nada se borra, la identidad no cambia, solo transiciones válidas, el resultado certificado no se modifica
do $$ declare c uuid := pg_temp.certificada('10000000-0000-0000-0000-0000000029a1', pg_temp.doc(5), 'AAAAAAAA-0000-0000-0000-00000000A005'); p uuid := pg_temp.nueva('10000000-0000-0000-0000-0000000029a1', pg_temp.doc(6)); begin
  perform pg_temp.falla(format($q$delete from public.digifact_operaciones where id = %L$q$, c), 'no se borran');
  perform pg_temp.falla($q$truncate public.digifact_operaciones$q$, 'cannot truncate|referenced|truncate');   -- referenciada por los artefactos
  perform pg_temp.falla(format($q$update public.digifact_operaciones set hash = %L where id = %L$q$, repeat('b', 64), c), 'identidad de la operación');
  perform pg_temp.falla(format($q$update public.digifact_operaciones set referencia = gen_random_uuid() where id = %L$q$, c), 'identidad de la operación');
  perform pg_temp.falla(format($q$update public.digifact_operaciones set empresa_id = %L where id = %L$q$, '10000000-0000-0000-0000-0000000029b2', c), 'identidad de la operación|foreign key');
  perform pg_temp.falla(format($q$update public.digifact_operaciones set estado = 'enviando', actualizada_ms = 9000 where id = %L$q$, c), 'transición de estado no permitida');
  perform pg_temp.falla(format($q$update public.digifact_operaciones set resultado = '{"autorizacion":"OTRA"}', actualizada_ms = 9000 where id = %L$q$, c), 'ya no cambia|no se modifica');
  perform pg_temp.falla(format($q$update public.digifact_operaciones set estado = 'certificada', actualizada_ms = 9000 where id = %L$q$, p), 'transición de estado no permitida');   -- preparada → certificada: no existe
  perform pg_temp.falla(format($q$update public.digifact_operaciones set estado = 'desconocida', actualizada_ms = 9000 where id = %L$q$, p), 'transición de estado no permitida');
  perform pg_temp.estado(p, 'enviando', null, 5000);
  perform pg_temp.falla(format($q$update public.digifact_operaciones set actualizada_ms = 1 where id = %L$q$, p), 'ya no cambia|no retrocede');
  perform pg_temp.estado(p, 'no_enviada', '{"codigo":"autenticacion"}', 6000);
  perform pg_temp.falla(format($q$update public.digifact_operaciones set estado = 'enviando', actualizada_ms = 9000 where id = %L$q$, p), 'transición de estado no permitida');   -- una no enviada es final
end $$;

-- 6. artefactos reales: solo inserción, solo de una operación certificada, con el SHA-256 y el tamaño verificados por la base
do $$ declare c uuid := (select id from public.digifact_operaciones where documento_id = pg_temp.doc(5) and estado = 'certificada'); p uuid := (select id from public.digifact_operaciones where documento_id = pg_temp.doc(6)); d uuid := pg_temp.doc(5); begin
  insert into public.digifact_artefactos (empresa_id, documento_id, operacion_id, tipo, nombre, mime, sha256, tamano, contenido) values ('10000000-0000-0000-0000-0000000029a1', d, c, 'xml', 'dte.xml', 'application/xml', encode(sha256('<dte/>'::bytea), 'hex'), 6, '<dte/>'::bytea);
  insert into public.digifact_artefactos (empresa_id, documento_id, operacion_id, tipo, nombre, mime, sha256, tamano, contenido) values ('10000000-0000-0000-0000-0000000029a1', d, c, 'pdf', 'dte.pdf', 'application/pdf', encode(sha256('%PDF-1.4'::bytea), 'hex'), 8, '%PDF-1.4'::bytea);
  perform pg_temp.falla(format($q$insert into public.digifact_artefactos (empresa_id, documento_id, operacion_id, tipo, nombre, mime, sha256, tamano, contenido) values ('10000000-0000-0000-0000-0000000029a1', %L, %L, 'xml', 'otro.xml', 'application/xml', encode(sha256('<dte/>'::bytea), 'hex'), 6, '<dte/>'::bytea)$q$, d, c), 'duplicate key|unique');   -- uno por tipo y operación
  perform pg_temp.falla(format($q$update public.digifact_artefactos set nombre = 'x.xml' where operacion_id = %L$q$, c), 'solo inserción|FEL_APPEND_ONLY');
  perform pg_temp.falla(format($q$delete from public.digifact_artefactos where operacion_id = %L$q$, c), 'solo inserción|FEL_APPEND_ONLY');
  perform pg_temp.falla(format($q$insert into public.digifact_artefactos (empresa_id, documento_id, operacion_id, tipo, nombre, mime, sha256, tamano, contenido) values ('10000000-0000-0000-0000-0000000029a1', %L, %L, 'xml', 'mal.xml', 'application/xml', %L, 6, '<dte/>'::bytea)$q$, d, c, repeat('0', 64)), 'check|sha256');   -- SHA-256 que no corresponde al contenido
  perform pg_temp.falla(format($q$insert into public.digifact_artefactos (empresa_id, documento_id, operacion_id, tipo, nombre, mime, sha256, tamano, contenido) values ('10000000-0000-0000-0000-0000000029a1', %L, %L, 'xml', 'x.xml', 'application/xml', encode(sha256('<dte/>'::bytea), 'hex'), 6, '<dte/>'::bytea)$q$, pg_temp.doc(6), p), 'solo una operación certificada');   -- operación no certificada
  perform pg_temp.falla(format($q$insert into public.digifact_artefactos (empresa_id, documento_id, operacion_id, tipo, nombre, mime, sha256, tamano, contenido) values ('10000000-0000-0000-0000-0000000029a1', %L, %L, 'xml', 'x.xml', 'application/xml', encode(sha256('<dte/>'::bytea), 'hex'), 6, '<dte/>'::bytea)$q$, pg_temp.doc(6), c), 'no corresponde a la operación');   -- artefacto de OTRO documento de la misma empresa
  perform pg_temp.falla(format($q$insert into public.digifact_artefactos (empresa_id, documento_id, operacion_id, tipo, nombre, mime, sha256, tamano, contenido) values ('10000000-0000-0000-0000-0000000029a1', %L, %L, 'xml', 'x.xml', 'application/pdf', encode(sha256('<dte/>'::bytea), 'hex'), 6, '<dte/>'::bytea)$q$, d, c), 'check|mime');   -- mime que no corresponde al tipo
  perform pg_temp.falla(format($q$insert into public.digifact_artefactos (empresa_id, documento_id, operacion_id, tipo, nombre, mime, sha256, tamano, contenido) values ('10000000-0000-0000-0000-0000000029a1', %L, %L, 'pdf', 'z.pdf', 'application/pdf', encode(sha256('<dte/>'::bytea), 'hex'), 99, '<dte/>'::bytea)$q$, d, c), 'check|tamano');   -- tamaño que no coincide con el contenido
end $$;

-- 7. aplicar la certificación al documento: exacta, idempotente, nunca inventa datos y protegida por empresa
do $$ declare c uuid := (select id from public.digifact_operaciones where documento_id = pg_temp.doc(5) and estado = 'certificada'); p uuid := (select id from public.digifact_operaciones where documento_id = pg_temp.doc(6)); r text; d public.documentos; begin
  perform pg_temp.falla(format($q$select public.fel_sys_digifact_aplicar('10000000-0000-0000-0000-0000000029b2', %L)$q$, c), 'no encontrada');   -- otra empresa no puede aplicar la operación
  perform pg_temp.falla(format($q$select public.fel_sys_digifact_aplicar('10000000-0000-0000-0000-0000000029a1', %L)$q$, p), 'no está certificada');
  perform pg_temp.falla($q$select public.fel_sys_digifact_aplicar('10000000-0000-0000-0000-0000000029a1', gen_random_uuid())$q$, 'no encontrada');
  r := public.fel_sys_digifact_aplicar('10000000-0000-0000-0000-0000000029a1', c); assert r = 'aplicada', 'primera aplicación: ' || r;
  select * into d from public.documentos where id = pg_temp.doc(5);
  assert d.estado_fiscal = 'certificado' and d.serie = 'A001' and d.numero_fiscal = '5' and d.autorizacion_sat = 'AAAAAAAA-0000-0000-0000-00000000A005', 'el documento no quedó con los datos del certificador';
  assert public.fel_sys_digifact_aplicar('10000000-0000-0000-0000-0000000029a1', c) = 'ya_aplicada', 'la segunda aplicación debe ser idempotente';
  assert (select count(*) from public.documento_estados where documento_id = pg_temp.doc(5) and eje = 'fiscal' and nuevo = 'certificado') = 1, 'un solo cambio de estado fiscal';
  -- el documento certificado queda inmutable (reglas de las migraciones 1–28)
  perform pg_temp.falla(format($q$update public.documentos set serie = 'ZZ' where id = %L$q$, pg_temp.doc(5)), 'inmutables|FEL_REGLA');
  perform pg_temp.falla(format($q$update public.documentos set observaciones = 'x' where id = %L$q$, pg_temp.doc(5)), 'inmutable|FEL_REGLA');
  -- una autorización simulada NUNCA se aplica como real
  perform pg_temp.falla(format($q$select public.fel_sys_digifact_aplicar('10000000-0000-0000-0000-0000000029a1', %L)$q$, pg_temp.certificada('10000000-0000-0000-0000-0000000029a1', pg_temp.doc(6), 'SIM-0001', 'S', '1')), 'simulada');
  -- un resultado sin serie/número no se aplica
  perform pg_temp.falla(format($q$select public.fel_sys_digifact_aplicar('10000000-0000-0000-0000-0000000029a1', %L)$q$, pg_temp.certificada('10000000-0000-0000-0000-0000000029a1', pg_temp.doc(4), 'AAAAAAAA-0000-0000-0000-00000000A044', ' ', ' ')), 'no trae serie, número y autorización');
end $$;

-- 8. el resto del esquema no cambió: toda tabla de public sigue con RLS y ninguna tabla/función nueva quedó abierta a la API
do $$ declare t text[]; begin
  select array_agg(c.relname::text order by c.relname) into t from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') and not c.relrowsecurity; assert t is null, 'tablas sin RLS: ' || t::text;
  assert (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p')) = 69, 'se esperaban 69 tablas (67 + 2)';
end $$;

rollback;
select 'PRUEBAS 29 OK' as resultado;
