-- W4 · Pruebas del piloto de lecturas por la Data API (M-O): RPC SECURITY INVOKER + RLS, imitando a PostgREST (rol `authenticated`/`anon` + claims). Superusuario; todo en una transacción que se deshace.
-- Cada rechazo se comprueba por su MENSAJE o por su efecto (filas vacías por RLS), no por «cualquier error».
\set ON_ERROR_STOP on
begin;
create or replace function pg_temp.root() returns void language plpgsql as $$ begin perform set_config('role', 'postgres', true); perform set_config('request.jwt.claims', '', true); end $$;
create or replace function pg_temp.como(p_uid text, p_sesion text, p_aal text default 'aal1', p_emp text default null) returns void language plpgsql as $$
begin perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', (json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', p_sesion, 'aal', p_aal) :: jsonb || case when p_emp is null then '{}'::jsonb else jsonb_build_object('app_metadata', jsonb_build_object('empresa_id', p_emp)) end)::text, true);
  perform set_config('role', 'authenticated', true); end $$;
create or replace function pg_temp.espera(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_msg text := null;
begin begin execute p_sql; exception when others then v_msg := sqlerrm; end;
  if v_msg is null then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if;
  if v_msg !~ p_patron then raise exception 'ERROR DISTINTO al esperado /%/: «%» en: %', p_patron, v_msg, p_sql; end if; end $$;
insert into auth.sessions (id, user_id, aal) values
  ('93000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c3', 'aal1'), ('93000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d1', 'aal1'),
  ('93000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', 'aal1'), ('93000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c2', 'aal1'), ('93000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'aal1');
-- datos de prueba (como administrador): dos empresas con clientes, conceptos y un cliente inactivo
insert into public.clientes (empresa_id, tipo_identificacion, numero_identificacion, nombre, activo) values
  ('10000000-0000-0000-0000-00000000000a', 'NIT', '7200001-1', 'Zeta A', true), ('10000000-0000-0000-0000-00000000000a', 'NIT', '7200002-2', 'Alfa A', true), ('10000000-0000-0000-0000-00000000000a', 'NIT', '7200003-3', 'Inactivo A', false),
  ('10000000-0000-0000-0000-00000000000b', 'NIT', '7200004-4', 'Solo B', true);
insert into public.conceptos (empresa_id, codigo, descripcion, tipo, unidad_medida, precio_unitario, activo) values
  ('10000000-0000-0000-0000-00000000000a', 'W4A', 'Concepto A', 'servicio', 'UNI', 10.50, true), ('10000000-0000-0000-0000-00000000000b', 'W4B', 'Concepto B', 'servicio', 'UNI', 20, true);
-- 1) cada persona ve SOLO su empresa; el orden y los campos son los de la consulta actual (equivalencia)
select pg_temp.como('00000000-0000-0000-0000-0000000000c3', '93000000-0000-0000-0000-0000000000c3');
do $$ declare c jsonb; k jsonb; begin
  c := api.clientes_listar(); assert (select count(*) from jsonb_array_elements(c) x where x ->> 'nombre' in ('Solo B')) = 0, 'A no ve clientes de B';
  assert exists (select 1 from jsonb_array_elements(c) x where x ->> 'nombre' = 'Zeta A') and exists (select 1 from jsonb_array_elements(c) x where x ->> 'nombre' = 'Inactivo A'), 'A ve los suyos (activos e inactivos en el listado completo)';
  k := api.conceptos_listar(); assert jsonb_array_length(k) >= 1 and not exists (select 1 from jsonb_array_elements(k) x where x ->> 'codigo' = 'W4B'), 'conceptos: solo los de A';
  assert (select x ->> 'precio_unitario' from jsonb_array_elements(k) x where x ->> 'codigo' = 'W4A') = '10.50', 'precio como texto, igual que la consulta actual';
end $$;
select pg_temp.como('00000000-0000-0000-0000-0000000000d1', '93000000-0000-0000-0000-0000000000d1');
do $$ declare c jsonb; begin c := api.clientes_listar(); assert exists (select 1 from jsonb_array_elements(c) x where x ->> 'nombre' = 'Solo B') and not exists (select 1 from jsonb_array_elements(c) x where x ->> 'nombre' like '%A'), 'B ve solo lo suyo'; end $$;
-- equivalencia exacta con las consultas del servidor (misma empresa, mismo orden y columnas) — comparación como administrador
select pg_temp.root();
do $$ declare a uuid := '10000000-0000-0000-0000-00000000000a'; e1 jsonb; e2 jsonb; begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated","session_id":"93000000-0000-0000-0000-0000000000c3","aal":"aal1"}', true); perform set_config('role', 'authenticated', true);
  e1 := api.estado_catalogos(); perform set_config('role', 'postgres', true);
  e2 := jsonb_build_object(
    'establecimientos', (select coalesce(jsonb_agg(to_jsonb(t) order by t.codigo_sat), '[]') from (select id, codigo_sat, nombre from public.establecimientos where empresa_id = a and estado = 'activo') t),
    'clientes', (select coalesce(jsonb_agg(to_jsonb(t) order by t.frecuente desc, t.nombre), '[]') from (select id, tipo_identificacion, numero_identificacion, nombre, direccion, email, telefono, frecuente from public.clientes where empresa_id = a and activo) t),
    'conceptos', (select coalesce(jsonb_agg(to_jsonb(t) order by t.descripcion), '[]') from (select id, codigo, descripcion, tipo, unidad_medida, precio_unitario::text as precio_unitario from public.conceptos where empresa_id = a and activo) t),
    'parametros', (select coalesce(jsonb_agg(to_jsonb(t) order by t.clave), '[]') from (select clave, valor::text as valor from public.plataforma_parametros) t));
  assert e1 = e2, 'api.estado_catalogos() = las cuatro consultas del servidor'; assert (select count(*) from jsonb_array_elements(e1 -> 'clientes')) = 2, 'solo clientes ACTIVOS en el estado';
  assert (e1 -> 'clientes' -> 0 ->> 'nombre') = 'Alfa A', 'orden por nombre';
end $$;
-- 2) sin sesión viva / sin identidad / anónimo: nada (mensaje de la defensa prevista)
select pg_temp.root(); select pg_temp.como('00000000-0000-0000-0000-0000000000c3', '99999999-0000-0000-0000-000000000000');
select pg_temp.espera($$select api.clientes_listar()$$, 'sesión no válida');
select pg_temp.espera($$select api.estado_catalogos()$$, 'sesión no válida');
select pg_temp.root(); select pg_temp.como('00000000-0000-0000-0000-0000000000c3', '93000000-0000-0000-0000-0000000000d1');
select pg_temp.espera($$select api.conceptos_listar()$$, 'sesión no válida');   -- sesión de otra persona
select pg_temp.root(); select set_config('role', 'anon', true);
select pg_temp.espera($$select api.clientes_listar()$$, 'permission denied');
select pg_temp.espera($$select * from public.clientes$$, 'permission denied');
select pg_temp.root(); delete from auth.sessions where id = '93000000-0000-0000-0000-0000000000c3'; select pg_temp.como('00000000-0000-0000-0000-0000000000c3', '93000000-0000-0000-0000-0000000000c3');
select pg_temp.espera($$select api.clientes_listar()$$, 'sesión no válida');   -- revocación inmediata
do $$ begin assert public.fel__parametros_lista() is null, 'el ayudante de parámetros devuelve NADA sin sesión viva (defensa propia, aunque la RPC ya falle antes)'; end $$;
-- 3) permisos: sin `clientes.ver` la política RLS devuelve vacío (no error, no datos); con él, los datos
select pg_temp.root(); update public.miembros set permisos_revocados = array['clientes.ver'] where user_id = '00000000-0000-0000-0000-0000000000c2'; select pg_temp.como('00000000-0000-0000-0000-0000000000c2', '93000000-0000-0000-0000-0000000000c2');
do $$ begin assert jsonb_array_length(api.clientes_listar()) = 0, 'sin permiso clientes.ver: lista vacía por RLS'; assert jsonb_array_length(api.conceptos_listar()) >= 1, 'el permiso de conceptos es otro: sigue viendo conceptos'; end $$;
select pg_temp.root(); update public.miembros set permisos_revocados = '{}' where user_id = '00000000-0000-0000-0000-0000000000c2'; select pg_temp.como('00000000-0000-0000-0000-0000000000c2', '93000000-0000-0000-0000-0000000000c2');
do $$ begin assert jsonb_array_length(api.clientes_listar()) >= 2, 'con el permiso restituido ve los datos'; end $$;
-- 4) varias empresas: sin selector falla; con selector ve SOLO esa empresa (el filtro por empresa de la RPC evita mezclar las dos)
select pg_temp.root(); insert into public.miembros (empresa_id, user_id, rol) values ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000c1', 'lector');
select pg_temp.como('00000000-0000-0000-0000-0000000000c1', '93000000-0000-0000-0000-0000000000c1');
select pg_temp.espera($$select api.clientes_listar()$$, 'varias empresas');
select pg_temp.root(); select pg_temp.como('00000000-0000-0000-0000-0000000000c1', '93000000-0000-0000-0000-0000000000c1', 'aal1', '10000000-0000-0000-0000-00000000000b');
do $$ declare c jsonb; begin c := api.clientes_listar(); assert jsonb_array_length(c) = 1 and c -> 0 ->> 'nombre' = 'Solo B', 'selector B: solo B (aunque la persona también es de A)'; end $$;
select pg_temp.root(); select pg_temp.como('00000000-0000-0000-0000-0000000000c1', '93000000-0000-0000-0000-0000000000c1', 'aal1', '10000000-0000-0000-0000-0000000000ff');
select pg_temp.espera($$select api.clientes_listar()$$, 'no eres miembro activo');
-- 5) plataforma: no tiene empresa; no lee datos de empresa por estas RPC
select pg_temp.root(); select pg_temp.como('00000000-0000-0000-0000-0000000000a1', '93000000-0000-0000-0000-0000000000a1');
select pg_temp.espera($$select api.clientes_listar()$$, 'plataforma|empresa|membres');
-- 6) estructura: SECURITY INVOKER (sin privilegios elevados), search_path fijo, ejecutables solo por authenticated, sin tablas nuevas concedidas
select pg_temp.root();
do $$ declare r text; begin
  select string_agg(proname, ',') into r from pg_proc where pronamespace = 'api'::regnamespace and proname in ('clientes_listar', 'conceptos_listar', 'establecimientos_listar', 'estado_catalogos') and (prosecdef or proconfig is null or not (proconfig::text ~ 'search_path='));
  assert r is null, 'las lecturas deben ser INVOKER con search_path fijo: ' || coalesce(r, '');
  assert (select count(*) from pg_proc where pronamespace = 'api'::regnamespace and proname in ('clientes_listar', 'conceptos_listar', 'establecimientos_listar', 'estado_catalogos') and has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('anon', oid, 'execute')) = 4, 'ejecutables solo por authenticated';
  assert not has_table_privilege('authenticated', 'public.plataforma_parametros', 'select'), 'authenticated NO lee plataforma_parametros: solo el ayudante devuelve la lista';
  assert has_function_privilege('authenticated', 'public.fel__parametros_lista()', 'execute') and not has_function_privilege('anon', 'public.fel__parametros_lista()', 'execute'), 'fel__parametros_lista: solo authenticated';
  assert has_function_privilege('authenticated', 'public.fel__empresa_actual()', 'execute') and not has_function_privilege('anon', 'public.fel__empresa_actual()', 'execute'), 'fel__empresa_actual: solo authenticated';
  assert not exists (select 1 from information_schema.role_table_grants g where g.grantee in ('anon', 'authenticated') and g.table_schema = 'public' and g.table_name in ('clientes', 'conceptos', 'establecimientos') and g.privilege_type <> 'SELECT'), 'authenticated solo LEE esas tablas';
  assert not exists (select 1 from information_schema.role_table_grants g where g.grantee = 'anon' and g.table_schema = 'public' and g.table_name in ('clientes', 'conceptos', 'establecimientos', 'documentos')), 'anon nada';
end $$;
select 'PRUEBAS DE LECTURAS POR LA DATA API OK';
rollback;
