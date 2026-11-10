-- Revocación de acceso: un JWT todavía vigente NO basta; cada consulta y cada operación revalidan membresía, perfil y empresa.
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_ok boolean := false;
begin
  begin execute p_sql; exception when others then v_ok := (sqlerrm ~ p_patron) or (sqlstate ~ p_patron); end;
  if not v_ok then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'maestro@fel.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'propA@fel.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'emisorA@fel.test'),
  ('00000000-0000-0000-0000-0000000000c4', 'emisor2A@fel.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'propB@fel.test');
insert into public.perfiles (user_id) select id from auth.users on conflict (user_id) do nothing;
insert into public.plataforma_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1');
insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id, estado)
select e.id, e.n, e.n || ' S.A.', e.nit, r.id, 'habilitada'
  from (values ('10000000-0000-0000-0000-00000000000a'::uuid, 'Empresa A', '1111111-1'),
               ('10000000-0000-0000-0000-00000000000b'::uuid, 'Empresa B', '2222222-2')) e(id, n, nit),
       public.regimenes_fiscales r where r.codigo = 'general';
insert into public.miembros (empresa_id, user_id, rol) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 'propietario'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', 'emisor'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c4', 'emisor'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000d1', 'propietario');
select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, 'NIT', '3333333-3', 'Cliente A', null, null, null, null);

-- ---- baseline: el emisor ve 1 cliente y puede escribir
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}', true) as _cfg \gset
do $$ begin assert (select count(*) from public.clientes) = 1, 'baseline: debe ver el cliente'; end $$;
reset role;
select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', null, 'NIT', '4444444-4', 'Otro', null, null, null, null);

-- ---- 1. membresía desactivada, JWT vigente: no lee y no escribe
update public.miembros set activo = false where user_id = '00000000-0000-0000-0000-0000000000c3';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}', true) as _cfg \gset
do $$ begin assert (select count(*) from public.clientes) = 0, 'miembro desactivado aún lee clientes'; assert (select count(*) from public.empresas) = 0, 'aún ve la empresa'; end $$;
reset role;
select pg_temp.espera_error($$select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', null, 'NIT', '5555555-5', 'X', null, null, null, null)$$, 'FEL_NO_AUTORIZADO');

-- ---- 2. perfil desactivado (cuenta bloqueada), JWT vigente
update public.perfiles set activo = false where user_id = '00000000-0000-0000-0000-0000000000c4';
insert into public.perfiles (user_id, activo) values ('00000000-0000-0000-0000-0000000000c4', false) on conflict (user_id) do update set activo = false;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c4","role":"authenticated"}', true) as _cfg \gset
do $$ begin assert (select count(*) from public.clientes) = 0, 'perfil desactivado aún lee'; end $$;
reset role;
select pg_temp.espera_error($$select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000c4', '10000000-0000-0000-0000-00000000000a', null, 'NIT', '5555555-5', 'X', null, null, null, null)$$, 'FEL_NO_AUTORIZADO');

-- ---- 3. administrador maestro con perfil desactivado pierde sus poderes
insert into public.perfiles (user_id, activo) values ('00000000-0000-0000-0000-0000000000a1', false) on conflict (user_id) do update set activo = false;
select pg_temp.espera_error($$select public.fel_admin_empresa_estado('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'suspendida', 'Motivo válido')$$, 'FEL_NO_AUTORIZADO');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true) as _cfg \gset
do $$ begin assert not public.fel_es_admin_plataforma(), 'maestro desactivado sigue siendo maestro'; assert (select count(*) from public.empresas) = 0; end $$;
reset role;
update public.perfiles set activo = true where user_id = '00000000-0000-0000-0000-0000000000a1';
select public.fel_admin_empresa_estado('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000b', 'suspendida', 'Prueba de suspensión');  -- vuelve a funcionar

-- ---- 4. permiso revocado: efecto inmediato
update public.miembros set permisos_revocados = array['clientes.escribir'] where user_id = '00000000-0000-0000-0000-0000000000c1' and empresa_id = '10000000-0000-0000-0000-00000000000a';
select pg_temp.espera_error($$select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, 'NIT', '6666666-6', 'X', null, null, null, null)$$, 'FEL_NO_AUTORIZADO');
update public.miembros set permisos_revocados = '{}' where user_id = '00000000-0000-0000-0000-0000000000c1' and empresa_id = '10000000-0000-0000-0000-00000000000a';

-- ---- 5. empresa suspendida: nadie de esa empresa lee ni escribe
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true) as _cfg \gset
do $$ begin assert (select count(*) from public.empresas) = 0, 'empresa suspendida visible'; end $$;
reset role;
select pg_temp.espera_error($$select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000b', null, 'NIT', '7777777-7', 'X', null, null, null, null)$$, 'FEL_NO_AUTORIZADO');

-- ---- 6. acceso entre empresas: pertenecer a A no da nada en B (ni por id de recurso ni por id de empresa)
select pg_temp.espera_error($$select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000b', null, 'NIT', '8888888-8', 'X', null, null, null, null)$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_cliente_estado('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000b', (select id from public.clientes limit 1), false)$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_cliente_estado('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', gen_random_uuid(), false)$$, 'FEL_NO_ENCONTRADO');
select pg_temp.espera_error($$select public.fel_op_documento_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000b', null, null, null, null, '[]'::jsonb, 0, 0, 0, '{}'::jsonb, null)$$, 'FEL_NO_AUTORIZADO');
-- un cliente de A no se puede asignar a un documento de B (ni cuando el actor es válido en ambas)
select pg_temp.espera_error($$select public.fel_op_documento_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, gen_random_uuid(), null, null, '[]'::jsonb, 0, 0, 0, '{}'::jsonb, null)$$, 'FEL_NO_ENCONTRADO');

-- ---- 7. actor nulo o inexistente nunca opera
select pg_temp.espera_error($$select public.fel_op_cliente_guardar(null, '10000000-0000-0000-0000-00000000000a', null, 'NIT', '9999999-9', 'X', null, null, null, null)$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_cliente_guardar(gen_random_uuid(), '10000000-0000-0000-0000-00000000000a', null, 'NIT', '9999999-9', 'X', null, null, null, null)$$, 'FEL_NO_AUTORIZADO');

rollback;
\echo 'OK 05_revocacion'
