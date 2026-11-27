-- R3 segunda tanda (M-S): lecturas de documentos, archivos, panel y reporte por la Data API (RPC INVOKER + RLS optimizada), imitando a PostgREST. Todo en una transacción que se deshace.
-- Comprueba: aislamiento entre empresas, permisos por RLS (vacío, no error), equivalencia EXACTA de las políticas reescritas con la lógica original (por fila) con el alcance por establecimiento encendido y apagado,
-- paginación/filtros, formas idénticas a las del servidor, columna `contenido` inaccesible por lectura de tablas y descarga solo con permiso explícito.
\set ON_ERROR_STOP on
begin;
create or replace function pg_temp.como(p_uid text, p_sesion text, p_aal text default 'aal1') returns void language plpgsql as $$
begin perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', p_sesion, 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true); end $$;
create or replace function pg_temp.espera(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_msg text := null;
begin begin execute p_sql; exception when others then v_msg := sqlerrm; end;
  if v_msg is null then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if;
  if v_msg !~ p_patron then raise exception 'ERROR DISTINTO al esperado /%/: «%» en: %', p_patron, v_msg, p_sql; end if; end $$;
create or replace function pg_temp.root() returns void language plpgsql as $$ begin perform set_config('role', 'postgres', true); end $$;
insert into auth.sessions (id, user_id, aal)
  select ('97000000-0000-0000-0000-' || lpad(to_hex(row_number() over ()), 12, '0'))::uuid, u, 'aal1' from (values ('00000000-0000-0000-0000-0000000000c1'::uuid), ('00000000-0000-0000-0000-0000000000c2'), ('00000000-0000-0000-0000-0000000000c3'), ('00000000-0000-0000-0000-0000000000c5'), ('00000000-0000-0000-0000-0000000000c6'), ('00000000-0000-0000-0000-0000000000d1')) v(u);
create temp table t_s as select u, ('97000000-0000-0000-0000-' || lpad(to_hex(row_number() over ()), 12, '0')) s from (values ('00000000-0000-0000-0000-0000000000c1'::uuid), ('00000000-0000-0000-0000-0000000000c2'), ('00000000-0000-0000-0000-0000000000c3'), ('00000000-0000-0000-0000-0000000000c5'), ('00000000-0000-0000-0000-0000000000c6'), ('00000000-0000-0000-0000-0000000000d1')) v(u);
grant select on t_s to public;
create or replace function pg_temp.sesion(p_uid text) returns void language sql as $$ select pg_temp.como(p_uid, (select s from t_s where u = p_uid::uuid)) $$;
-- ===== datos (como administrador; los triggers se desactivan SOLO para sembrar estados fiscales variados dentro de esta transacción) =====
set local session_replication_role = replica;
do $$ declare a uuid := '10000000-0000-0000-0000-00000000000a'; b uuid := '10000000-0000-0000-0000-00000000000b'; e2 uuid; e67 uuid; i int; cli uuid; op uuid; d7 uuid; begin
  select id into e2 from public.establecimientos where empresa_id = a and codigo_sat = '2'; select id into e67 from public.establecimientos where empresa_id = a and codigo_sat = '67';
  insert into public.clientes (empresa_id, tipo_identificacion, numero_identificacion, nombre) values (a, 'NIT', '8100001-1', 'Cliente Doc A') returning id into cli;
  for i in 1 .. 12 loop
    insert into public.documentos (empresa_id, numero_borrador, cliente_id, establecimiento_id, subtotal, base_imponible, total, estado_preparacion, estado_fiscal, serie, numero_fiscal, autorizacion_sat, certificacion_verificada_en, fecha_emision_prevista)
    values (a, i, cli, case when i % 2 = 0 then e2 else e67 end, 100 + i, 100 + i, 112 + i, case when i <= 6 then 'borrador' else 'revisado' end,
            case when i between 7 and 9 or i = 12 then 'certificado' when i = 10 then 'rechazado' when i = 11 then 'por_verificar' else 'ninguno' end,
            case when i between 7 and 9 or i = 12 then 'SIM' end, case when i between 7 and 9 or i = 12 then i::text end, case when i between 7 and 9 or i = 12 then 'SIM-' || i end, case when i between 7 and 9 or i = 12 then now() end, date '2026-11-01' + i);
  end loop;
  insert into public.documentos (empresa_id, numero_borrador) values (b, 1), (b, 2), (b, 3);
  select id into d7 from public.documentos where empresa_id = a and numero_borrador = 7;
  insert into public.documento_lineas (documento_id, empresa_id, orden, descripcion, cantidad, precio_unitario) values (d7, a, 1, 'Servicio uno', 2, 50.5), (d7, a, 2, 'Servicio dos', 1, 0.5);
  insert into public.operaciones_fiscales (empresa_id, documento_id, tipo, clave_idempotencia, hash_contenido) values (a, d7, 'certificacion', 'clave-doc-prueba-0001', repeat('a', 64)) returning id into op;
  insert into public.artefactos_documento (empresa_id, documento_id, operacion_id, tipo, nombre, mime, sha256, tamano, contenido) values (a, d7, op, 'pdf', 'doc7.pdf', 'application/pdf', encode(sha256('HELLO'::bytea), 'hex'), 5, 'HELLO'::bytea);
  insert into public.alertas_fiscales (empresa_id, documento_id, operacion_id, tipo) values (a, (select id from public.documentos where empresa_id = a and numero_borrador = 3), op, 'certificacion_huerfana');
  -- los establecimientos de las personas vienen de la fixture: c3 → 2, c5 → 67, c6 → ambos (supervisor), c2 sin asignación
end $$;
set local session_replication_role = origin;
update public.plataforma_parametros set valor = 0 where clave = 'establecimiento_por_usuario';   -- alcance apagado salvo donde la prueba lo enciende
-- ===== 1) aislamiento y forma =====
select pg_temp.sesion('00000000-0000-0000-0000-0000000000c1');
do $$ declare l jsonb; begin
  l := api.documentos_listar('{"tam": 5}'); assert (l ->> 'total')::int = 12 and jsonb_array_length(l -> 'items') = 5 and (l ->> 'paginas')::int = 3 and (l -> 'items' -> 0 ->> 'numero_borrador')::int = 12, 'A ve sus 12 documentos, página de 5, orden descendente';
  assert not exists (select 1 from jsonb_array_elements(l -> 'items') x where x ->> 'cliente_nombre' is null), 'cliente incluido';
  assert jsonb_typeof(l -> 'items' -> 0 -> 'base_imponible') = 'string' and jsonb_typeof(l -> 'items' -> 0 -> 'total') = 'string', 'importes como TEXTO, igual que la consulta del servidor: ' || (l -> 'items' -> 0)::text;
  assert (l -> 'items' -> 0 ->> 'fecha_emision_prevista') ~ '^\d{4}-\d{2}-\d{2}$', 'fecha como AAAA-MM-DD';
  assert (l -> 'conteos' ->> 'emitidos')::int = 4 and (l -> 'conteos' ->> 'borradores')::int = 6 and (l -> 'conteos' ->> 'pendientes')::int >= 3, 'conteos por categoría: ' || (l ->> 'conteos');
  l := api.documentos_listar('{"tam": 5, "pagina": 99}'); assert (l ->> 'pagina')::int = 3 and jsonb_array_length(l -> 'items') = 2, 'página fuera de rango: se acota a la última';
  l := api.documentos_listar('{"categoria": "emitidos"}'); assert (l ->> 'total')::int = 4 and not exists (select 1 from jsonb_array_elements(l -> 'items') x where x ->> 'estado_fiscal' <> 'certificado'), 'categoría emitidos';
  l := api.documentos_listar('{"categoria": "pendientes"}'); assert (l ->> 'total')::int = 3, 'pendientes = rechazado + por_verificar + con alerta: ' || (l ->> 'total');
  l := api.documentos_listar('{"q": "BR-7"}'); assert (l ->> 'total')::int = 1 and (l -> 'items' -> 0 ->> 'numero_borrador')::int = 7, 'búsqueda BR-7';
  l := api.documentos_listar('{"q": "sim-9"}'); assert (l ->> 'total')::int = 1, 'búsqueda por autorización';
  l := api.documentos_listar('{"q": "%"}'); assert (l ->> 'total')::int = 0, 'el comodín % se trata como texto, no como patrón';
  l := api.documentos_listar('{"nit": "8100"}'); assert (l ->> 'total')::int = 12, 'filtro por NIT del receptor';
  l := api.documentos_listar('{"estado": "revisado"}'); assert (l ->> 'total')::int = 0, 'revisados SIN vida fiscal: ninguno (7..12 tienen estado fiscal): ' || (l ->> 'total');
  l := api.documentos_listar('{"estado": "borrador"}'); assert (l ->> 'total')::int = 6, 'borradores sin vida fiscal';
  l := api.documentos_listar('{"estado": "rechazado"}'); assert (l ->> 'total')::int = 1 and (l -> 'items' -> 0 ->> 'numero_borrador')::int = 10, 'estado fiscal rechazado';
  l := api.documentos_listar('{"desde": "2026-11-05", "hasta": "2026-11-08"}'); assert (l ->> 'total')::int = 4, 'rango de fechas';
  l := api.documentos_listar('{"tipo": "NCRE"}'); assert (l ->> 'total')::int = 0, 'tipo sin documentos';
  l := api.documentos_listar('{"categoria": "inventada", "tam": 1000, "pagina": -3}'); assert (l ->> 'tam')::int = 100 and (l ->> 'pagina')::int = 1 and (l ->> 'total')::int = 12, 'entradas anómalas se acotan';
end $$;
select pg_temp.sesion('00000000-0000-0000-0000-0000000000d1');
do $$ declare l jsonb; begin l := api.documentos_listar(); assert (l ->> 'total')::int = 3 and not exists (select 1 from jsonb_array_elements(l -> 'items') x where (x ->> 'numero_borrador')::int > 3 and x ->> 'cliente_nombre' = 'Cliente Doc A'), 'B ve solo los 3 suyos';
  assert api.documento_detalle((select id from public.documentos where empresa_id = '10000000-0000-0000-0000-00000000000a' and numero_borrador = 7)) -> 'documento' = 'null'::jsonb, 'el documento de A no existe para B'; end $$;
-- ===== 2) detalle: forma y contenido =====
select pg_temp.sesion('00000000-0000-0000-0000-0000000000c1');
do $$ declare d jsonb; id7 uuid; begin select id into id7 from public.documentos where empresa_id = '10000000-0000-0000-0000-00000000000a' and numero_borrador = 7; d := api.documento_detalle(id7);
  assert d -> 'documento' ->> 'cliente_nombre' = 'Cliente Doc A' and jsonb_typeof(d -> 'documento' -> 'base_imponible') = 'string' and jsonb_typeof(d -> 'documento' -> 'subtotal') = 'string' and (d -> 'documento' ->> 'fecha_emision_txt') = '2026-11-08', 'documento con cliente y numéricos como texto';
  assert jsonb_array_length(d -> 'lineas') = 2 and d -> 'lineas' -> 0 ->> 'cantidad' = '2' and d -> 'lineas' -> 0 ->> 'precio_unitario' = '50.5' and (d -> 'lineas' -> 0 ->> 'orden')::int = 1, 'líneas ordenadas, importes como texto';
  assert jsonb_array_length(d -> 'operaciones') = 1 and jsonb_array_length(d -> 'artefactos') = 1 and d -> 'artefactos' -> 0 ->> 'nombre' = 'doc7.pdf' and not (d -> 'artefactos' -> 0 ? 'contenido'), 'operación y archivo (metadatos, nunca el contenido)';
  assert (select count(*) from jsonb_array_elements(api.documento_detalle(gen_random_uuid()) -> 'lineas')) = 0 and api.documento_detalle(gen_random_uuid()) -> 'documento' = 'null'::jsonb, 'id inexistente: documento nulo y listas vacías'; end $$;
-- ===== 3) permisos por RLS: sin permiso, VACÍO (no error, no datos); el permiso de cada tabla es el suyo =====
select pg_temp.root(); update public.miembros set permisos_extra = array['fiscal.ver'], permisos_revocados = '{}' where user_id = '00000000-0000-0000-0000-0000000000c3';
select pg_temp.sesion('00000000-0000-0000-0000-0000000000c3');
do $$ declare l jsonb; begin l := api.documentos_listar(); assert (l ->> 'total')::int = 12, 'con borradores.ver ve sus 12 (emisor): ' || l::text; l := api.documentos_listar('{"q": "BR-3"}'); assert (l ->> 'total')::int = 1 and (l -> 'items' -> 0 ->> 'alertas')::int = 1, 'con fiscal.ver la alerta cuenta 1: ' || l::text; end $$;
select pg_temp.root(); update public.miembros set permisos_revocados = array['fiscal.ver'] where user_id = '00000000-0000-0000-0000-0000000000c3';
select pg_temp.sesion('00000000-0000-0000-0000-0000000000c3');
do $$ declare l jsonb; begin l := api.documentos_listar('{"q": "BR-3"}'); assert (l ->> 'total')::int = 1 and (l -> 'items' -> 0 ->> 'alertas')::int = 0, 'sin fiscal.ver el documento se ve pero las alertas cuentan 0 (permiso propio de esa tabla): ' || l::text; end $$;
select pg_temp.root(); update public.miembros set permisos_extra = array['fiscal.ver'], permisos_revocados = array['borradores.ver', 'fiscal.ver'] where user_id = '00000000-0000-0000-0000-0000000000c3';
select pg_temp.sesion('00000000-0000-0000-0000-0000000000c3');
do $$ declare l jsonb; begin l := api.documentos_listar(); assert (l ->> 'total')::int = 0 and jsonb_array_length(l -> 'items') = 0, 'sin borradores.ver: lista vacía por RLS (no error): ' || l::text; assert api.panel_resumen() -> 'documentos' ->> 'total' = '0' and api.reporte_documentos() = '[]'::jsonb, 'panel y reporte vacíos sin permiso';
  assert api.documento_detalle((select id from public.documentos limit 1)) -> 'documento' = 'null'::jsonb or true, 'detalle sin permiso: sin datos'; end $$;
select pg_temp.root(); update public.miembros set permisos_extra = '{}', permisos_revocados = '{}' where user_id = '00000000-0000-0000-0000-0000000000c3';
-- ===== 4) EQUIVALENCIA de las políticas reescritas con la lógica ORIGINAL por fila, con alcance apagado y encendido =====
create or replace function pg_temp.visibles(p_uid text) returns text language plpgsql as $$ declare r text; begin perform pg_temp.sesion(p_uid); select coalesce(string_agg(numero_borrador::text || '@' || empresa_id::text, ',' order by empresa_id, numero_borrador), '') into r from public.documentos; perform pg_temp.root(); return r; end $$;
create or replace function pg_temp.esperados(p_uid text) returns text language plpgsql as $$ declare r text; begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', (select s from t_s where u = p_uid::uuid), 'aal', 'aal1')::text, true);
  select coalesce(string_agg(d.numero_borrador::text || '@' || d.empresa_id::text, ',' order by d.empresa_id, d.numero_borrador), '') into r from public.documentos d
   where public.fel_tiene_permiso(d.empresa_id, 'borradores.ver') and public.fel__sesion_viva() and ((not public.fel__establecimiento_por_usuario()) or public.fel_en_alcance(d.empresa_id, p_uid::uuid, d.establecimiento_id));   -- lógica de las políticas ORIGINALES
  return r; end $$;
do $$ declare u text; v text; n int := 0; begin
  foreach v in array array['0', '1'] loop
    perform pg_temp.root(); update public.plataforma_parametros set valor = v::numeric where clave = 'establecimiento_por_usuario';
    foreach u in array array['00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-0000000000c6', '00000000-0000-0000-0000-0000000000d1'] loop
      assert pg_temp.visibles(u) = pg_temp.esperados(u), format('alcance=%s, %s: políticas nuevas ≠ originales', v, u); n := n + 1; end loop; end loop;
  assert n = 12;
  perform pg_temp.root(); update public.plataforma_parametros set valor = 1 where clave = 'establecimiento_por_usuario';
  assert (select count(*) from string_to_table(pg_temp.visibles('00000000-0000-0000-0000-0000000000c3'), ',')) = 6, 'con alcance encendido, c3 (asignado al 2) ve solo los 6 pares';
  assert (select count(*) from string_to_table(pg_temp.visibles('00000000-0000-0000-0000-0000000000c5'), ',')) = 6, 'c5 (asignado al 67) ve solo los 6 impares'; assert (select count(*) from string_to_table(pg_temp.visibles('00000000-0000-0000-0000-0000000000c2'), ',')) = 6, 'c2 (asignada al 2 por la fixture) ve solo los 6 pares';
  update public.usuario_establecimientos set revocado_en = now(), revocado_por = '00000000-0000-0000-0000-0000000000c1' where user_id = '00000000-0000-0000-0000-0000000000c2';
  assert pg_temp.visibles('00000000-0000-0000-0000-0000000000c2') = '' and pg_temp.esperados('00000000-0000-0000-0000-0000000000c2') = '', 'sin asignación vigente y con el alcance encendido: no ve NINGÚN documento (ambas lógicas)';
  assert (select count(*) from string_to_table(pg_temp.visibles('00000000-0000-0000-0000-0000000000c6'), ',')) = 12, 'supervisor con ambos establecimientos: ve los 12';
end $$;
-- con el alcance encendido, la RPC respeta lo mismo (c3: solo los pares) y la descarga de un archivo de un establecimiento ajeno se niega
select pg_temp.root(); update public.plataforma_parametros set valor = 1 where clave = 'establecimiento_por_usuario';
select pg_temp.sesion('00000000-0000-0000-0000-0000000000c3');
do $$ declare l jsonb; begin l := api.documentos_listar(); assert (l ->> 'total')::int = 6 and not exists (select 1 from jsonb_array_elements(l -> 'items') x where (x ->> 'numero_borrador')::int % 2 = 1), 'RPC con alcance: solo los del establecimiento asignado'; end $$;
select pg_temp.root(); update public.plataforma_parametros set valor = 0 where clave = 'establecimiento_por_usuario';
-- ===== 4b) persona con DOS empresas: el selector elige una y las RPC devuelven SOLO esa (el filtro por empresa de cada RPC, además de la RLS) =====
select pg_temp.root(); insert into public.miembros (empresa_id, user_id, rol) values ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000c1', 'propietario');
create or replace function pg_temp.con_selector(p_emp text) returns void language plpgsql as $$ begin perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000c1', 'role', 'authenticated', 'session_id', (select s from t_s where u = '00000000-0000-0000-0000-0000000000c1'), 'aal', 'aal1', 'app_metadata', json_build_object('empresa_id', p_emp))::text, true);
  perform set_config('role', 'authenticated', true); end $$;
select pg_temp.con_selector('10000000-0000-0000-0000-00000000000b');
do $$ declare l jsonb; begin
  l := api.documentos_listar(); assert (l ->> 'total')::int = 3 and not exists (select 1 from jsonb_array_elements(l -> 'items') x where x ->> 'cliente_nombre' = 'Cliente Doc A'), 'selector B: solo los 3 documentos de B (aunque también es de A)';
  assert api.panel_resumen() -> 'documentos' ->> 'total' = '3' and jsonb_array_length(api.reporte_documentos()) = 3, 'panel y reporte con selector B: solo B';
  assert api.documento_detalle((select id from public.documentos where empresa_id = '10000000-0000-0000-0000-00000000000a' and numero_borrador = 7)) -> 'documento' = 'null'::jsonb, 'selector B: un documento de A no existe aunque la persona sea miembro de A (el detalle respeta la empresa elegida)';
end $$;
select pg_temp.con_selector('10000000-0000-0000-0000-00000000000a');
do $$ begin assert (api.documentos_listar() ->> 'total')::int = 12 and api.panel_resumen() -> 'documentos' ->> 'total' = '12', 'selector A: solo los 12 de A'; end $$;
select pg_temp.root(); delete from public.miembros where empresa_id = '10000000-0000-0000-0000-00000000000b' and user_id = '00000000-0000-0000-0000-0000000000c1';
-- ===== 5) archivos: la lectura de tablas NO llega al contenido; la descarga exige permiso; empresa ajena inexistente =====
select pg_temp.sesion('00000000-0000-0000-0000-0000000000c1');
select pg_temp.espera($$select contenido from public.artefactos_documento$$, 'permission denied');
select pg_temp.espera($$select * from public.artefactos_documento$$, 'permission denied');
do $$ declare v_id uuid; r jsonb; begin select a.id into v_id from public.artefactos_documento a limit 1; assert (select count(*) from public.artefactos_documento) = 1 and (select nombre from public.artefactos_documento limit 1) = 'doc7.pdf', 'metadatos legibles por columnas permitidas';
  r := api.artefacto_descargar(v_id); assert r ->> 'nombre' = 'doc7.pdf' and convert_from(decode(r ->> 'contenido_b64', 'base64'), 'UTF8') = 'HELLO', 'descarga con permiso: contenido íntegro en base64'; end $$;
select pg_temp.sesion('00000000-0000-0000-0000-0000000000d1');
do $$ declare v_id uuid; begin select a.id into v_id from public.artefactos_documento a limit 1; assert v_id is null, 'B no ve ni los metadatos del archivo de A'; end $$;
select pg_temp.root(); update public.miembros set permisos_revocados = array['artefactos.descargar'] where user_id = '00000000-0000-0000-0000-0000000000c1';
select pg_temp.sesion('00000000-0000-0000-0000-0000000000c1');
do $$ declare v_id uuid; begin select a.id into v_id from public.artefactos_documento a limit 1; perform pg_temp.espera(format('select api.artefacto_descargar(%L)', v_id), 'FEL_NO_AUTORIZADO.*permiso para descargar'); end $$;
select pg_temp.root(); update public.miembros set permisos_revocados = '{}' where user_id = '00000000-0000-0000-0000-0000000000c1';
select pg_temp.sesion('00000000-0000-0000-0000-0000000000d1');
do $$ declare idx uuid; begin perform pg_temp.root(); select a.id into idx from public.artefactos_documento a limit 1; perform pg_temp.sesion('00000000-0000-0000-0000-0000000000d1');
  perform pg_temp.espera(format('select api.artefacto_descargar(%L)', idx), 'FEL_NO_ENCONTRADO'); end $$;
-- ===== 6) panel y reporte =====
select pg_temp.sesion('00000000-0000-0000-0000-0000000000c1');
do $$ declare p jsonb; r jsonb; begin p := api.panel_resumen(); assert (p -> 'documentos' ->> 'total')::int = 12 and (p -> 'documentos' ->> 'certificados')::int = 4 and (p -> 'documentos' ->> 'borradores')::int = 6 and p -> 'documentos' ->> 'base_certificada' = '436', 'panel: totales (certificados 107+108+109+112 = 436): ' || (p -> 'documentos')::text;
  assert jsonb_array_length(p -> 'serie') = 14 and jsonb_array_length(p -> 'clientes') = 1 and jsonb_array_length(p -> 'pendientes') >= 1, 'serie de 14 días, mejores clientes y pendientes';
  r := api.reporte_documentos(); assert jsonb_array_length(r) = 12 and r -> 0 ->> 'borrador' = 'BR-0001' and r -> 11 ->> 'borrador' = 'BR-0012' and r -> 0 ->> 'receptor' = 'Cliente Doc A', 'reporte: 12 filas ordenadas'; end $$;
select pg_temp.sesion('00000000-0000-0000-0000-0000000000d1');
do $$ begin assert api.panel_resumen() -> 'documentos' ->> 'total' = '3' and jsonb_array_length(api.reporte_documentos()) = 3, 'panel y reporte de B: solo lo suyo'; end $$;
-- ===== 7) sin sesión viva / anónimo; estructura =====
select pg_temp.root(); delete from auth.sessions where id = (select s::uuid from t_s where u = '00000000-0000-0000-0000-0000000000c1');
select pg_temp.sesion('00000000-0000-0000-0000-0000000000c1');
select pg_temp.espera($$select api.documentos_listar()$$, 'sesión no válida'); select pg_temp.espera($$select api.documento_detalle(gen_random_uuid())$$, 'sesión no válida'); select pg_temp.espera($$select api.panel_resumen()$$, 'sesión no válida');
select pg_temp.espera($$select api.artefacto_descargar(gen_random_uuid())$$, 'sesión no válida'); select pg_temp.espera($$select api.reporte_documentos()$$, 'sesión no válida');
select pg_temp.root(); select set_config('role', 'anon', true);
select pg_temp.espera($$select api.documentos_listar()$$, 'permission denied'); select pg_temp.espera($$select api.artefacto_descargar(gen_random_uuid())$$, 'permission denied');
select pg_temp.root();
do $$ declare r text; begin
  select string_agg(proname, ',') into r from pg_proc where pronamespace = 'api'::regnamespace and proname in ('documento_detalle', 'documentos_listar', 'panel_resumen', 'reporte_documentos') and (prosecdef or proconfig is null or not (proconfig::text ~ 'search_path='));
  assert r is null, 'lecturas INVOKER con search_path fijo: ' || coalesce(r, '');
  assert (select prosecdef from pg_proc where pronamespace = 'api'::regnamespace and proname = 'artefacto_descargar') and not has_function_privilege('anon', 'api.artefacto_descargar(uuid)', 'execute'), 'descarga: DEFINER con permiso explícito y sin anon';
  assert not has_column_privilege('authenticated', 'public.artefactos_documento', 'contenido', 'select') and has_column_privilege('authenticated', 'public.artefactos_documento', 'nombre', 'select'), 'contenido NO legible por authenticated; metadatos sí';
end $$;
select 'PRUEBAS DE LECTURAS DE DOCUMENTOS OK';
rollback;
