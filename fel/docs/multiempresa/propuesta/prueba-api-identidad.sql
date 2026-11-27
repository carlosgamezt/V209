-- W1+W2 · Pruebas de la identidad de Supabase Auth y del esquema `api`, imitando a PostgREST (rol `authenticated`/`anon` + claims en `request.jwt.claims`). Superusuario; todo dentro de una transacción que se deshace.
-- Cada rechazo se comprueba por su MENSAJE (la defensa prevista), no por «cualquier error».
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
  ('91000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c3', 'aal1'), ('91000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d1', 'aal1'), ('91000000-0100-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d1', 'aal2'),
  ('91000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', 'aal1'), ('91000000-0100-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', 'aal2'), ('91000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c2', 'aal1'),
  ('91000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'aal1'), ('91000000-0100-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'aal2');
-- 1) la identidad y la empresa salen de Supabase Auth (membresía), nunca de un parámetro; cada empresa queda en la suya
select pg_temp.como('00000000-0000-0000-0000-0000000000c3', '91000000-0000-0000-0000-0000000000c3');
do $$ declare c jsonb; a jsonb; begin
  c := api.contexto(); assert c ->> 'empresa_id' = '10000000-0000-0000-0000-00000000000a' and c ->> 'user_id' = '00000000-0000-0000-0000-0000000000c3', 'contexto: persona y empresa derivadas de la membresía';
  a := to_jsonb(api.cliente_guardar(null, 'NIT', '7100001-1', 'Cliente API A', null, null, null, null)); assert a ->> 'empresa_id' = '10000000-0000-0000-0000-00000000000a', 'el cliente queda en la empresa de la persona';
end $$;
select pg_temp.como('00000000-0000-0000-0000-0000000000d1', '91000000-0000-0000-0000-0000000000d1');
do $$ declare b jsonb; begin b := to_jsonb(api.cliente_guardar(null, 'NIT', '7100001-1', 'Cliente API B', null, null, null, null)); assert b ->> 'empresa_id' = '10000000-0000-0000-0000-00000000000b', 'la misma llamada con otra persona queda en SU empresa'; end $$;
-- 2) sin sesión viva, nada: sin identidad, sesión cerrada, ajena, inexistente, sin session_id, anónimo
select pg_temp.root(); select set_config('role', 'authenticated', true);
select pg_temp.espera($$select api.contexto()$$, 'sin identidad');
select pg_temp.root(); select pg_temp.como('00000000-0000-0000-0000-0000000000c3', '91000000-0000-0000-0000-0000000000d1');
select pg_temp.espera($$select api.contexto()$$, 'sesión no válida');   -- el session_id de otra persona
select pg_temp.root(); select pg_temp.como('00000000-0000-0000-0000-0000000000c3', '99999999-0000-0000-0000-000000000000');
select pg_temp.espera($$select api.cliente_guardar(null, 'NIT', '7100002-2', 'x', null, null, null, null)$$, 'sesión no válida');
select pg_temp.root(); select pg_temp.como('00000000-0000-0000-0000-0000000000c3', '');
select pg_temp.espera($$select api.contexto()$$, 'sesión no válida');
select pg_temp.root(); select set_config('role', 'anon', true);
select pg_temp.espera($$select api.contexto()$$, 'permission denied');
-- revocación inmediata: se cierra la sesión y la MISMA llamada deja de funcionar
select pg_temp.root(); select pg_temp.como('00000000-0000-0000-0000-0000000000c3', '91000000-0000-0000-0000-0000000000c3');
do $$ begin perform api.contexto(); end $$;
select pg_temp.root(); delete from auth.sessions where id = '91000000-0000-0000-0000-0000000000c3'; select pg_temp.como('00000000-0000-0000-0000-0000000000c3', '91000000-0000-0000-0000-0000000000c3');
select pg_temp.espera($$select api.contexto()$$, 'sesión no válida');
-- 3) permisos efectivos (rol, extras y revocados) y cuentas desactivadas: los decide la base
select pg_temp.root(); select pg_temp.como('00000000-0000-0000-0000-0000000000c2', '91000000-0000-0000-0000-0000000000c2');
select pg_temp.espera($$select api.cliente_guardar(null, 'NIT', '7100003-3', 'x', null, null, null, null)$$, 'permiso|FEL_NO_AUTORIZADO');   -- el lector no escribe clientes
select pg_temp.root(); update public.miembros set permisos_extra = array['clientes.escribir'] where user_id = '00000000-0000-0000-0000-0000000000c2'; select pg_temp.como('00000000-0000-0000-0000-0000000000c2', '91000000-0000-0000-0000-0000000000c2');
do $$ begin perform api.cliente_guardar(null, 'NIT', '7100003-3', 'Con permiso extra', null, null, null, null); end $$;   -- un permiso EXTRA lo habilita
select pg_temp.root(); update public.miembros set permisos_revocados = array['clientes.escribir'] where user_id = '00000000-0000-0000-0000-0000000000c2'; select pg_temp.como('00000000-0000-0000-0000-0000000000c2', '91000000-0000-0000-0000-0000000000c2');
select pg_temp.espera($$select api.cliente_guardar(null, 'NIT', '7100004-4', 'x', null, null, null, null)$$, 'permiso|FEL_NO_AUTORIZADO');   -- un permiso REVOCADO se lo quita
select pg_temp.root(); update public.perfiles set activo = false where user_id = '00000000-0000-0000-0000-0000000000c2'; select pg_temp.como('00000000-0000-0000-0000-0000000000c2', '91000000-0000-0000-0000-0000000000c2');
select pg_temp.espera($$select api.contexto()$$, 'sesión no válida|cuenta desactivada');
-- 4) varias empresas: el claim solo SELECCIONA entre las suyas; uno ajeno falla
select pg_temp.root(); insert into public.miembros (empresa_id, user_id, rol) values ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000c1', 'lector');
select pg_temp.como('00000000-0000-0000-0000-0000000000c1', '91000000-0000-0000-0000-0000000000c1');
select pg_temp.espera($$select api.contexto()$$, 'varias empresas');
select pg_temp.root(); select pg_temp.como('00000000-0000-0000-0000-0000000000c1', '91000000-0000-0000-0000-0000000000c1', 'aal1', '10000000-0000-0000-0000-00000000000a');
do $$ begin assert api.contexto() ->> 'empresa_id' = '10000000-0000-0000-0000-00000000000a', 'el claim elige la empresa A'; end $$;
select pg_temp.root(); select pg_temp.como('00000000-0000-0000-0000-0000000000c1', '91000000-0000-0000-0000-0000000000c1', 'aal1', '10000000-0000-0000-0000-0000000000ff');
select pg_temp.espera($$select api.contexto()$$, 'no eres miembro activo');
-- 5) MFA real: las operaciones sensibles exigen aal2 en el token Y en la sesión guardada
select pg_temp.root(); select pg_temp.como('00000000-0000-0000-0000-0000000000c1', '91000000-0000-0000-0000-0000000000c1', 'aal1', '10000000-0000-0000-0000-00000000000a');
select pg_temp.espera($$select api.establecimiento_guardar(null, '555', 'Sucursal MFA', null, 'activo')$$, 'aal2');
select pg_temp.root(); select pg_temp.como('00000000-0000-0000-0000-0000000000c1', '91000000-0000-0000-0000-0000000000c1', 'aal2', '10000000-0000-0000-0000-00000000000a');   -- el token dice aal2 pero la sesión guardada es aal1: no vale
select pg_temp.espera($$select api.establecimiento_guardar(null, '555', 'Sucursal MFA', null, 'activo')$$, 'aal2');
select pg_temp.root(); select pg_temp.como('00000000-0000-0000-0000-0000000000c1', '91000000-0100-0000-0000-0000000000c1', 'aal2', '10000000-0000-0000-0000-00000000000a');
do $$ begin perform api.establecimiento_guardar(null, '555', 'Sucursal MFA', null, 'activo'); end $$;
select pg_temp.root(); update public.plataforma_parametros set valor = 0 where clave = 'mfa_operaciones_sensibles'; select pg_temp.como('00000000-0000-0000-0000-0000000000c1', '91000000-0000-0000-0000-0000000000c1', 'aal1', '10000000-0000-0000-0000-00000000000a');
do $$ begin perform api.establecimiento_guardar(null, '556', 'Sucursal sin MFA (parámetro 0)', null, 'activo'); end $$;
select pg_temp.root(); update public.plataforma_parametros set valor = 1 where clave = 'mfa_operaciones_sensibles';
-- 6) plataforma: solo plataforma_admins, sin empresa; una sesión de empresa no entra y la de plataforma no entra por la puerta de empresa; aal2 si es obligatorio
select pg_temp.root(); select pg_temp.como('00000000-0000-0000-0000-0000000000c1', '91000000-0100-0000-0000-0000000000c1', 'aal2', '10000000-0000-0000-0000-00000000000a');
select pg_temp.espera($$select * from api.pla_mfa_recuperacion_listar()$$, 'solo el administrador de la plataforma');
select pg_temp.root(); select pg_temp.como('00000000-0000-0000-0000-0000000000a1', '91000000-0000-0000-0000-0000000000a1');
do $$ begin perform count(*) from api.pla_mfa_recuperacion_listar(); end $$;
select pg_temp.espera($$select api.cliente_guardar(null, 'NIT', '7100005-5', 'x', null, null, null, null)$$, 'es de una empresa|plataforma');
select pg_temp.root(); update public.plataforma_parametros set valor = 1 where clave = 'plataforma_mfa_obligatoria'; select pg_temp.como('00000000-0000-0000-0000-0000000000a1', '91000000-0000-0000-0000-0000000000a1');
select pg_temp.espera($$select * from api.pla_mfa_recuperacion_listar()$$, 'dos pasos');
select pg_temp.root(); select pg_temp.como('00000000-0000-0000-0000-0000000000a1', '91000000-0100-0000-0000-0000000000a1', 'aal2');
do $$ begin perform count(*) from api.pla_mfa_recuperacion_listar(); end $$;
select pg_temp.root(); update public.plataforma_parametros set valor = 0 where clave = 'plataforma_mfa_obligatoria';
-- 7) EXPOSICIÓN: lo que la Data API puede alcanzar y con qué privilegios (catálogo)
select pg_temp.root();
do $$ declare n int; r text; begin
  select count(*) into n from pg_proc where pronamespace = 'api'::regnamespace; assert n >= 80, 'api tiene sus funciones (' || n || ')';
  assert not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.pronamespace = 'api'::regnamespace and a.grantee = 0 and a.privilege_type = 'EXECUTE'), 'PUBLIC no ejecuta ninguna función de api';
  assert not exists (select 1 from pg_proc p where p.pronamespace = 'api'::regnamespace and has_function_privilege('anon', p.oid, 'execute')), 'anon no ejecuta ninguna función de api';
  assert (select count(*) from pg_proc p where p.pronamespace = 'api'::regnamespace and has_function_privilege('authenticated', p.oid, 'execute')) = n, 'authenticated ejecuta todas las de api';
  assert not has_schema_privilege('anon', 'api', 'usage') and has_schema_privilege('authenticated', 'api', 'usage'), 'uso del esquema api: solo authenticated';
  -- ninguna función de api recibe identidad o empresa como parámetro
  select string_agg(p.proname, ',') into r from pg_proc p where p.pronamespace = 'api'::regnamespace and pg_get_function_arguments(p.oid) ~ case when p.proname like 'pla\_%' then '(^|, )(p_sesion|p_actor) ' else '(^|, )(p_sesion|p_actor|p_empresa) ' end;
  assert r is null, 'funciones de api con parámetro de identidad: ' || coalesce(r, '');
  -- todas SECURITY DEFINER con search_path vacío; ninguna de sistema ni de auditoría
  select string_agg(p.proname, ',') into r from pg_proc p where p.pronamespace = 'api'::regnamespace and ((not p.prosecdef and p.proname not in ('clientes_listar', 'conceptos_listar', 'establecimientos_listar', 'estado_catalogos')) or p.proconfig is null or not (p.proconfig::text ~ 'search_path='));   -- las 4 lecturas de M-O son INVOKER a propósito (lo exige prueba-api-lecturas)
  assert r is null, 'api sin definer/search_path fijo: ' || coalesce(r, '');
  assert not exists (select 1 from pg_proc p where p.pronamespace = 'api'::regnamespace and (p.proname ~ '^(sys_|pla_sys_|auditar|aud_)' or p.proname like '%operacion_marcar_envio%' or p.proname like '%evento_registrar%' or p.proname like '%artefacto_guardar%')), 'api NO expone pasos del sistema ni auditoría';
  -- authenticated/anon NO ejecutan nada de public (salvo los predicados de RLS) ni leen tablas de sesiones, auditoría o credenciales
  select string_agg(p.proname, ',') into r from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname ~ '^fel_(ses|pla|adm|op|admin|sys|aud|auditar)' and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'));
  assert r is null, 'authenticated/anon ejecutan funciones de public que no deben: ' || coalesce(r, '');
  select string_agg(g.grantee || ':' || g.table_name || ':' || g.privilege_type, ', ') into r from information_schema.role_table_grants g where g.grantee in ('anon', 'authenticated') and g.table_schema = 'public' and g.table_name in ('demo_sesiones', 'demo_credenciales', 'empresa_digifact_config', 'sesion_establecimiento_activo', 'acceso_maestro_datos');
  assert r is null, 'privilegios indebidos sobre sesiones, auditoría o credenciales: ' || coalesce(r, '');
  -- auditoría: heredada de las migraciones originales, solo lectura y SIEMPRE bajo RLS (la restringe M-L y la política por permiso); jamás escritura
  assert not exists (select 1 from information_schema.role_table_grants g where g.grantee in ('anon', 'authenticated') and g.table_schema = 'public' and g.table_name = 'auditoria' and g.privilege_type <> 'SELECT'), 'auditoria: authenticated solo lee';
  assert not exists (select 1 from information_schema.role_table_grants g where g.grantee = 'anon' and g.table_schema = 'public' and g.table_name = 'auditoria'), 'auditoria: anon nada';
  assert (select relrowsecurity from pg_class where oid = 'public.auditoria'::regclass), 'auditoria con RLS activa';
end $$;
select 'PRUEBAS DE IDENTIDAD DE AUTH Y ESQUEMA API OK';
rollback;
