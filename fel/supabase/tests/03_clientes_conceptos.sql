-- Escritura atómica de clientes y conceptos: permisos, versión (edición concurrente), aislamiento y auditoría.
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_ok boolean := false;
begin
  begin execute p_sql; exception when others then v_ok := (sqlerrm ~ p_patron) or (sqlstate ~ p_patron); end;
  if not v_ok then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c2', 'lectorA@fel.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'emisorA@fel.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'propB@fel.test');
insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id, estado)
select e.id, e.n, e.n || ' S.A.', e.nit, r.id, 'habilitada'
  from (values ('10000000-0000-0000-0000-00000000000a'::uuid, 'Empresa A', '1111111-1'),
               ('10000000-0000-0000-0000-00000000000b'::uuid, 'Empresa B', '2222222-2')) e(id, n, nit),
       public.regimenes_fiscales r where r.codigo = 'general';
insert into public.miembros (empresa_id, user_id, rol) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c2', 'lector'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', 'emisor'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000d1', 'propietario');

-- el lector no escribe; el emisor de A no escribe en B
select pg_temp.espera_error($$select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-00000000000a', null, 'NIT', '3333333-3', 'X', null, null, null, null)$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000b', null, 'NIT', '3333333-3', 'X', null, null, null, null)$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_concepto_guardar('00000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-00000000000a', null, 'C1', 'X', 'bien', 'UND', 1, null, null)$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_cliente_guardar(null, '10000000-0000-0000-0000-00000000000a', null, 'NIT', '3333333-3', 'X', null, null, null, null)$$, 'FEL_NO_AUTORIZADO');

-- el emisor crea, edita con versión correcta y falla con versión vieja
select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', null, 'NIT', '3333333-3', '  Cliente Uno  ', 'Zona 1', 'c@x.test', '5555-5555', null);
do $$ begin
  assert (select nombre from public.clientes where numero_identificacion = '3333333-3') = 'Cliente Uno', 'el nombre no se recortó';
  assert (select version from public.clientes where numero_identificacion = '3333333-3') = 1, 'versión inicial';
end $$;
select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a',
  (select id from public.clientes where numero_identificacion = '3333333-3'), 'NIT', '3333333-3', 'Cliente Uno Editado', null, null, null, 1);
do $$ begin
  assert (select version from public.clientes where numero_identificacion = '3333333-3') = 2, 'versión tras editar';
  assert exists (select 1 from public.auditoria where accion = 'cliente.editar' and datos ? 'antes' and datos ? 'despues' and actor_user_id = '00000000-0000-0000-0000-0000000000c3'), 'auditoría de edición incompleta';
end $$;
select pg_temp.espera_error($$select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select id from public.clientes where numero_identificacion = '3333333-3'), 'NIT', '3333333-3', 'Otra edición', null, null, null, 1)$$, 'FEL_CONFLICTO');
-- no se puede editar un cliente de otra empresa indicando su id
select pg_temp.espera_error($$select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'NIT', '4444444-4', 'X', null, null, null, 1)$$, 'FEL_NO_ENCONTRADO');
-- NIT duplicado y NIT inválido
select pg_temp.espera_error($$select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', null, 'NIT', '3333333-3', 'Repetido', null, null, null, null)$$, '23505');
select pg_temp.espera_error($$select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', null, 'NIT', 'AB C!', 'Inválido', null, null, null, null)$$, '23514');
-- baja lógica y reactivación auditadas
select public.fel_op_cliente_estado('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select id from public.clientes where numero_identificacion = '3333333-3'), false);
do $$ begin
  assert not (select activo from public.clientes where numero_identificacion = '3333333-3'), 'no quedó de baja';
  assert exists (select 1 from public.auditoria where accion = 'cliente.baja'), 'sin auditoría de baja';
end $$;

-- conceptos
select public.fel_op_concepto_guardar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', null, 'SRV-1', 'Servicio de prueba', 'servicio', null, 125.50, null, null);
do $$ begin
  assert (select unidad_medida from public.conceptos where codigo = 'SRV-1') = 'UND', 'unidad por defecto';
  assert (select precio_unitario from public.conceptos where codigo = 'SRV-1') = 125.50, 'precio exacto';
end $$;
select pg_temp.espera_error($$select public.fel_op_concepto_guardar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', null, 'SRV-2', 'Negativo', 'bien', 'UND', -1, null, null)$$, '23514');
select pg_temp.espera_error($$select public.fel_op_concepto_guardar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', null, 'SRV-1', 'Código repetido', 'bien', 'UND', 1, null, null)$$, '23505');

-- revocar un permiso al emisor lo deja sin escribir clientes
update public.miembros set permisos_revocados = array['clientes.escribir'] where user_id = '00000000-0000-0000-0000-0000000000c3';
select pg_temp.espera_error($$select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', null, 'NIT', '6666666-6', 'X', null, null, null, null)$$, 'FEL_NO_AUTORIZADO');
-- un miembro desactivado no escribe nada
update public.miembros set permisos_revocados = '{}', activo = false where user_id = '00000000-0000-0000-0000-0000000000c3';
select pg_temp.espera_error($$select public.fel_op_concepto_guardar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', null, 'SRV-9', 'X', 'bien', 'UND', 1, null, null)$$, 'FEL_NO_AUTORIZADO');

rollback;
\echo 'OK 03_clientes_conceptos'
