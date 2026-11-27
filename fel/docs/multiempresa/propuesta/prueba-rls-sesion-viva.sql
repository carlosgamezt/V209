-- R3/F5 · pruebas de lectura por la ruta de la Data API: se imita lo que hace PostgREST (rol `authenticated` + claims en `request.jwt.claims`). Se ejecuta como superusuario; todo dentro de una transacción que se deshace.
\set ON_ERROR_STOP on
begin;
create or replace function pg_temp.como(p_uid text, p_sesion text, p_aal text default 'aal1') returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', p_sesion, 'aal', p_aal)::text, true); perform set_config('role', 'authenticated', true); end $$;
create or replace function pg_temp.root() returns void language plpgsql as $$ begin perform set_config('role', 'postgres', true); perform set_config('request.jwt.claims', '', true); end $$;
-- (M-L NO concede privilegios: la exposición de la Data API la decide F5-3. Aquí, y solo dentro de esta transacción, se concede SELECT sobre `clientes` para probar lo que decidirían las políticas)
grant select on public.clientes to authenticated;
-- datos: dos empresas con un cliente cada una (clientes ya tiene RLS por permiso y empresa) y sesiones de Auth
insert into public.clientes (empresa_id, tipo_identificacion, numero_identificacion, nombre) values ('10000000-0000-0000-0000-00000000000a', 'NIT', '8000001-1', 'Cliente RLS A'), ('10000000-0000-0000-0000-00000000000b', 'NIT', '8000002-2', 'Cliente RLS B');
insert into auth.sessions (id, user_id, aal) values ('90000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', 'aal1'), ('90000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000d1', 'aal2'), ('90000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000c1', 'aal1');
create or replace function pg_temp.n(p_nombre text) returns int language sql as $$ select count(*)::int from public.clientes where nombre = p_nombre $$;
-- 1) con sesión viva ve SOLO su empresa
select pg_temp.como('00000000-0000-0000-0000-0000000000c3', '90000000-0000-0000-0000-00000000000a');
do $$ begin assert pg_temp.n('Cliente RLS A') = 1 and pg_temp.n('Cliente RLS B') = 0, 'facta (A) ve a su cliente y no al de B'; end $$;
select pg_temp.root(); select pg_temp.como('00000000-0000-0000-0000-0000000000d1', '90000000-0000-0000-0000-00000000000b', 'aal2');
do $$ begin assert pg_temp.n('Cliente RLS B') = 1 and pg_temp.n('Cliente RLS A') = 0, 'propb (B) ve solo lo de B'; end $$;
-- 2) misma identidad, token con una sesión que NO es suya, que no existe o sin session_id: nada
select pg_temp.root(); select pg_temp.como('00000000-0000-0000-0000-0000000000c3', '90000000-0000-0000-0000-00000000000b');
do $$ begin assert pg_temp.n('Cliente RLS A') = 0, 'sesión de otra persona: nada'; end $$;
select pg_temp.root(); select pg_temp.como('00000000-0000-0000-0000-0000000000c3', '99999999-0000-0000-0000-000000000000');
do $$ begin assert pg_temp.n('Cliente RLS A') = 0, 'sesión inexistente: nada'; end $$;
select pg_temp.root(); select pg_temp.como('00000000-0000-0000-0000-0000000000c3', '');
do $$ begin assert pg_temp.n('Cliente RLS A') = 0, 'sin session_id: nada'; end $$;
-- 3) REVOCACIÓN INMEDIATA: se cierra la sesión (se borra de auth.sessions) y el MISMO token deja de leer, sin esperar su vencimiento
select pg_temp.root(); select pg_temp.como('00000000-0000-0000-0000-0000000000c3', '90000000-0000-0000-0000-00000000000a');
do $$ begin assert pg_temp.n('Cliente RLS A') = 1, 'antes del cierre lee'; end $$;
select pg_temp.root(); delete from auth.sessions where id = '90000000-0000-0000-0000-00000000000a'; select pg_temp.como('00000000-0000-0000-0000-0000000000c3', '90000000-0000-0000-0000-00000000000a');
do $$ begin assert pg_temp.n('Cliente RLS A') = 0, 'tras cerrar la sesión, el mismo token no lee'; end $$;
-- 4) usuario dado de baja o sin membresía: lo decide la política permisiva existente (permiso y empresa), no el token
select pg_temp.root(); update public.miembros set activo = false where user_id = '00000000-0000-0000-0000-0000000000c1';
select pg_temp.como('00000000-0000-0000-0000-0000000000c1', '90000000-0000-0000-0000-00000000000c');
do $$ begin assert pg_temp.n('Cliente RLS A') = 0, 'una persona desactivada no lee aunque su sesión viva'; end $$;
-- 5) anónimo y claims inventados
select pg_temp.root(); select set_config('request.jwt.claims', '', true); select set_config('role', 'anon', true);
do $$ declare v int := 0; begin begin v := pg_temp.n('Cliente RLS A'); exception when insufficient_privilege then v := 0; end; assert v = 0, 'anon: nada (ni filas ni privilegio)'; end $$;
-- 6) MFA: aal2 exige token Y sesión
select pg_temp.root(); select pg_temp.como('00000000-0000-0000-0000-0000000000d1', '90000000-0000-0000-0000-00000000000b', 'aal2');
do $$ begin assert public.fel__aal2(), 'aal2 en el token y en la sesión: vale'; end $$;
select pg_temp.root(); select pg_temp.como('00000000-0000-0000-0000-0000000000d1', '90000000-0000-0000-0000-00000000000b', 'aal1');
do $$ begin assert not public.fel__aal2(), 'el token dice aal1: no vale'; end $$;
select pg_temp.root(); select pg_temp.como('00000000-0000-0000-0000-0000000000c1', '90000000-0000-0000-0000-00000000000c', 'aal2');
do $$ begin assert not public.fel__aal2(), 'el token dice aal2 pero la sesión guardada es aal1 (claims desactualizados o falsificados): no vale'; end $$;
-- 7) cobertura: toda tabla de datos de empresa tiene la política de sesión viva
select pg_temp.root();
do $$ declare faltan text; begin
  select string_agg(c.relname, ',') into faltan from pg_class c join pg_namespace s on s.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attname = 'empresa_id' and not a.attisdropped
   where s.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity and c.relname not like 'zz\_%' and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.policyname = 'sesion_viva' and p.permissive = 'RESTRICTIVE');
  assert faltan is null, 'tablas sin política de sesión viva: ' || coalesce(faltan, '');
end $$;
select 'PRUEBAS RLS DE SESIÓN VIVA OK';
rollback;
