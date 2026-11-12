-- Ajustes de interfaz (Fase 2): datos de contacto de la empresa, clientes frecuentes, aislamiento por empresa y canales reales bloqueados.
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_ok boolean := false;
begin
  begin execute p_sql; exception when others then v_ok := (sqlerrm ~ p_patron) or (sqlstate ~ p_patron); end;
  if not v_ok then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'propA@fel.test'), ('00000000-0000-0000-0000-0000000000c2', 'lectorA@fel.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'emisorA@fel.test'), ('00000000-0000-0000-0000-0000000000c4', 'adminA@fel.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'propB@fel.test');
insert into public.perfiles (user_id) select id from auth.users on conflict (user_id) do nothing;
insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id, estado)
select e.id, e.n, e.n || ' S.A.', e.nit, r.id, 'habilitada'
  from (values ('10000000-0000-0000-0000-00000000000a'::uuid, 'Empresa A', '1111111-1'), ('10000000-0000-0000-0000-00000000000b'::uuid, 'Empresa B', '2222222-2')) e(id, n, nit),
       public.regimenes_fiscales r where r.codigo = 'general';
insert into public.miembros (empresa_id, user_id, rol) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 'propietario'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c2', 'lector'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', 'emisor'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c4', 'administrador'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000d1', 'propietario');

-- ================= datos de la empresa: permiso, validación, aislamiento, auditoría y campos fiscales intactos
select pg_temp.espera_error($$select public.fel_op_empresa_datos_guardar('00000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-00000000000a', 'X', null, null, null)$$, 'FEL_NO_AUTORIZADO');   -- lector
select pg_temp.espera_error($$select public.fel_op_empresa_datos_guardar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', 'X', null, null, null)$$, 'FEL_NO_AUTORIZADO');   -- emisor
select pg_temp.espera_error($$select public.fel_op_empresa_datos_guardar('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000a', 'X', null, null, null)$$, 'FEL_NO_AUTORIZADO');   -- propietario de OTRA empresa
select pg_temp.espera_error($$select public.fel_op_empresa_datos_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', '   ', null, null, null)$$, 'FEL_REGLA');
select pg_temp.espera_error($$select public.fel_op_empresa_datos_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', 'Empresa A', null, null, 'no-es-correo')$$, 'FEL_REGLA');
select public.fel_op_empresa_datos_guardar('00000000-0000-0000-0000-0000000000c4', '10000000-0000-0000-0000-00000000000a', 'Empresa A Comercial', 'Dirección de prueba 1', '2200-0001', 'fact@a.test');   -- el administrador sí
do $$ declare a public.empresas; b public.empresas; begin
  select * into a from public.empresas where id = '10000000-0000-0000-0000-00000000000a';
  select * into b from public.empresas where id = '10000000-0000-0000-0000-00000000000b';
  assert a.nombre_comercial = 'Empresa A Comercial' and a.direccion_fiscal = 'Dirección de prueba 1' and a.telefono = '2200-0001' and a.correo_facturacion = 'fact@a.test', 'datos de A no guardados';
  assert a.razon_social = 'Empresa A S.A.' and a.nit = '1111111-1' and a.estado = 'habilitada' and not a.emision_real_habilitada, 'los datos fiscales críticos no deben cambiar';
  assert b.nombre_comercial = 'Empresa B' and b.direccion_fiscal is null and b.telefono is null and b.correo_facturacion is null, 'la empresa B no debe cambiar';
  assert (select count(*) from public.auditoria where empresa_id = a.id and accion = 'empresa.datos_editar') = 1, 'falta la auditoría';
end $$;
select public.fel_op_empresa_datos_guardar('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000b', 'Empresa B Comercial', null, null, null);
do $$ begin
  assert (select nombre_comercial from public.empresas where id = '10000000-0000-0000-0000-00000000000b') = 'Empresa B Comercial', 'B debe poder editar lo suyo';
  assert (select nombre_comercial from public.empresas where id = '10000000-0000-0000-0000-00000000000a') = 'Empresa A Comercial', 'editar B no debe tocar A';
end $$;

-- ================= clientes frecuentes: marca por empresa, con permiso y aislamiento
create temp table t_cli as select (public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', null, 'NIT', '7000001-1', 'Cliente de A', null, null, null, null)).id as id;
create temp table t_cf as select (public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', null, 'CF', 'CF', 'Consumidor final', null, null, null, null)).id as id;
do $$ begin assert not (select frecuente from public.clientes where id = (select id from t_cli)), 'por defecto no es frecuente'; end $$;
select pg_temp.espera_error($$select public.fel_op_cliente_frecuente('00000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-00000000000a', (select id from t_cli), true)$$, 'FEL_NO_AUTORIZADO');   -- lector
select pg_temp.espera_error($$select public.fel_op_cliente_frecuente('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000b', (select id from t_cli), true)$$, 'FEL_NO_ENCONTRADO');   -- cliente de otra empresa
select pg_temp.espera_error($$select public.fel_op_cliente_frecuente('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select id from t_cf), true)$$, 'FEL_REGLA');   -- consumidor final
select public.fel_op_cliente_frecuente('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select id from t_cli), true);
select public.fel_op_cliente_frecuente('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select id from t_cli), true);   -- idempotente: no duplica la auditoría
do $$ begin
  assert (select frecuente from public.clientes where id = (select id from t_cli)), 'debe quedar frecuente';
  assert (select version from public.clientes where id = (select id from t_cli)) = 1, 'marcar frecuente no cambia la versión (no provoca conflictos de edición)';
  assert (select count(*) from public.auditoria where accion = 'cliente.frecuente') = 1, 'una sola auditoría por cambio real';
end $$;
select public.fel_op_cliente_frecuente('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select id from t_cli), false);
do $$ begin assert not (select frecuente from public.clientes where id = (select id from t_cli)), 'debe dejar de ser frecuente'; end $$;
-- aislamiento (RLS) con las columnas nuevas: el propietario B no ve clientes ni datos de A
set local role authenticated; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.clientes where empresa_id = '10000000-0000-0000-0000-00000000000a') = 0, 'B no debe ver clientes de A';
  assert (select count(*) from public.empresas where id = '10000000-0000-0000-0000-00000000000a') = 0, 'B no debe ver los datos de A';
end $$;
select pg_temp.espera_error($$select public.fel_op_empresa_datos_guardar('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000b', 'X', null, null, null)$$, '42501|permission denied');   -- las funciones no se llaman desde la app
select pg_temp.espera_error($$update public.empresas set telefono = '1' where id = '10000000-0000-0000-0000-00000000000b'$$, '42501|permission denied');
reset role;

-- ================= canales reales siguen bloqueados (no se habilita ninguno, ni siquiera con permiso)
select pg_temp.espera_error($$select public.fel_op_canal_configurar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, 'portal_playwright', 'produccion', true)$$, 'FEL_REGLA|23514|check');
select pg_temp.espera_error($$select public.fel_op_canal_configurar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, 'digifact', 'pruebas', true)$$, 'FEL_REGLA|23514|check');
-- (D3-1) Digifact solo puede habilitarse contra el SIMULADOR: el ambiente simulado es válido; pruebas y producción siguen cerrados (línea anterior y restricciones de tabla)
select public.fel_op_canal_configurar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, 'digifact', 'simulado', false);
select pg_temp.espera_error($$update public.proveedores_emision set ambientes = '{simulado,pruebas}' where id = 'digifact'$$, '23514|check');
select pg_temp.espera_error($$insert into public.empresa_canales (empresa_id, proveedor_id, ambiente, habilitado) values ('10000000-0000-0000-0000-00000000000a', 'digifact', 'pruebas', true)$$, '23514|check');
do $$ begin assert not exists (select 1 from public.empresa_canales where habilitado and proveedor_id <> 'mock'), 'ningún canal real habilitado'; assert not exists (select 1 from public.empresas where emision_real_habilitada), 'sin emisión real'; end $$;

rollback;
\echo 16_ajustes_configuracion OK
