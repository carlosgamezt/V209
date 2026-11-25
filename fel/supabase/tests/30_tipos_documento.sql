-- Tipos de documento (DTE): catálogo, habilitación por empresa, notas con referencia, recibos y bloqueo de la certificación de los tipos que no están implementados.
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_ok boolean := false;
begin
  begin execute p_sql; exception when others then v_ok := (sqlerrm ~ p_patron) or (sqlstate ~ p_patron); end;
  if not v_ok then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'maestro@fel.test'), ('00000000-0000-0000-0000-0000000000c1', 'propA@fel.test'), ('00000000-0000-0000-0000-0000000000c2', 'lectorA@fel.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'emisorA@fel.test'), ('00000000-0000-0000-0000-0000000000d1', 'propB@fel.test');
insert into public.perfiles (user_id) select id from auth.users on conflict (user_id) do nothing;
insert into public.plataforma_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1');
insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id, estado)
select e.id, e.n, e.n || ' S.A.', e.nit, r.id, 'habilitada'
  from (values ('10000000-0000-0000-0000-00000000000a'::uuid, 'Empresa A', '1111111-1'), ('10000000-0000-0000-0000-00000000000b'::uuid, 'Empresa B', '2222222-2')) e(id, n, nit),
       public.regimenes_fiscales r where r.codigo = 'general';
insert into public.miembros (empresa_id, user_id, rol) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 'propietario'), ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c2', 'lector'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', 'emisor'), ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000d1', 'propietario');

-- ================= catálogo: 17 tipos, solo FACT certifica, inmutable
do $$ begin
  assert (select count(*) from public.fel_tipos_dte) = 17, 'catálogo incompleto';
  assert (select array_agg(codigo order by codigo) from public.fel_tipos_dte where certificacion_habilitada) = array['FACT'], 'solo FACT certifica';
  assert (select array_agg(codigo order by codigo) from public.fel_tipos_dte where disponibilidad = 'en_pruebas') = array['NCRE','NDEB','RECI'];
  assert (select count(*) from public.fel_tipos_dte where disponibilidad = 'pendiente') = 13;
  assert (select array_agg(codigo order by codigo) from public.fel_tipos_dte where requiere_origen and disponibilidad <> 'pendiente') = array['NCRE','NDEB'];
end $$;
select pg_temp.espera_error($$update public.fel_tipos_dte set certificacion_habilitada = true where codigo = 'NCRE'$$, 'FEL_REGLA');
select pg_temp.espera_error($$update public.fel_tipos_dte set disponibilidad = 'implementado' where codigo = 'RECI'$$, 'FEL_REGLA');
select pg_temp.espera_error($$delete from public.fel_tipos_dte where codigo = 'FACT'$$, 'FEL_REGLA');
select pg_temp.espera_error($$insert into public.fel_tipos_dte (codigo, nombre, familia, disponibilidad) values ('ZZZZ', 'x', 'factura', 'pendiente')$$, 'FEL_REGLA');
select pg_temp.espera_error($$truncate public.fel_tipos_dte$$, 'FEL_REGLA|0A000|referenced');
-- aunque el catálogo se pudiera cambiar, la restricción impide certificar un tipo no implementado
select pg_temp.espera_error($$alter table public.fel_tipos_dte disable trigger fel_tipos_dte_no_cambiar; update public.fel_tipos_dte set certificacion_habilitada = true where codigo = 'NDEB'$$, '23514|check');

-- ================= fixture
select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', null, 'NIT', '3333333-3', 'Cliente A1', null, null, null, null);
select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', null, 'NIT', '4444444-4', 'Cliente A2', null, null, null, null);
select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000b', null, 'NIT', '5555555-5', 'Cliente B', null, null, null, null);
create temp table t_cli as select
  (select id from public.clientes where empresa_id = '10000000-0000-0000-0000-00000000000a' and numero_identificacion = '3333333-3') as a1,
  (select id from public.clientes where empresa_id = '10000000-0000-0000-0000-00000000000a' and numero_identificacion = '4444444-4') as a2,
  (select id from public.clientes where empresa_id = '10000000-0000-0000-0000-00000000000b') as b1;
create temp table t_est as select (public.fel_op_establecimiento_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, '1', 'Casa matriz A', 'Dirección', 'activo')).id as id;
-- borrador (emisor lo crea) y revisado (propietario lo revisa)
create or replace function pg_temp.borrador(p_cli uuid, p_precio numeric default 10.5, p_fecha date default current_date) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  v_id := (public.fel_op_documento_guardar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', null, p_cli, p_fecha, 'prueba',
     jsonb_build_array(jsonb_build_object('orden', 1, 'descripcion', 'Servicio', 'cantidad', 2, 'precio_unitario', p_precio)), 2 * p_precio, 0, 2 * p_precio, '{"oficial":false}'::jsonb, null)).id;
  perform public.fel_op_documento_establecimiento('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', v_id, (select id from t_est));
  return v_id;
end $$;
create or replace function pg_temp.ver(p_doc uuid) returns int language sql as $$ select version from public.documentos where id = p_doc $$;
create or replace function pg_temp.revisar(p_doc uuid) returns void language sql as $$
  select public.fel_op_documento_preparacion('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', p_doc, 'revisado', null, pg_temp.ver(p_doc)) $$;
-- «certifica» sin proveedor: solo para preparar el documento de origen de las pruebas (mismas transiciones que usa el sistema)
create or replace function pg_temp.certificar_falso(p_doc uuid, p_serie text, p_num text, p_aut text) returns void language plpgsql as $$
begin
  perform set_config('fel.op_fiscal', 'on', true);
  update public.documentos set estado_fiscal = 'pendiente_certificacion' where id = p_doc;
  update public.documentos set estado_fiscal = 'certificado', serie = p_serie, numero_fiscal = p_num, autorizacion_sat = p_aut, certificacion_verificada_en = now() where id = p_doc;
  perform set_config('fel.op_fiscal', 'off', true);
end $$;

-- ================= un documento nuevo es FACT y todo lo anterior sigue igual
create temp table t_f1 as select pg_temp.borrador((select a1 from t_cli)) as id;
do $$ begin
  assert (select tipo_dte from public.documentos where id = (select id from t_f1)) = 'FACT', 'por defecto FACT';
  assert (select documento_origen_id is null and referencia_origen is null and motivo_ajuste is null and tipo_recibo is null from public.documentos where id = (select id from t_f1));
end $$;

-- ================= configuración por empresa
select pg_temp.espera_error($$select public.fel_op_tipos_empresa_guardar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', 'NCRE', true, null, false)$$, 'FEL_NO_AUTORIZADO');   -- el emisor no edita la empresa
select pg_temp.espera_error($$select public.fel_op_tipos_empresa_guardar('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000a', 'NCRE', true, null, false)$$, 'FEL_NO_AUTORIZADO');   -- otra empresa
select pg_temp.espera_error($$select public.fel_op_tipos_empresa_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', 'FCAM', true, null, false)$$, 'FEL_REGLA');       -- pendiente: no se habilita
select pg_temp.espera_error($$select public.fel_op_tipos_empresa_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', 'FPEQ', true, 'x', true)$$, 'FEL_REGLA');
select pg_temp.espera_error($$select public.fel_op_tipos_empresa_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', 'RECI', true, null, false)$$, 'FEL_REGLA');       -- recibo sin base
select pg_temp.espera_error($$select public.fel_op_tipos_empresa_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', 'RECI', true, '  ', false)$$, 'FEL_REGLA');
select pg_temp.espera_error($$select public.fel_op_tipos_empresa_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', 'NCRE', false, null, true)$$, 'FEL_REGLA');      -- predeterminado debe estar habilitado
select pg_temp.espera_error($$select public.fel_op_tipos_empresa_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', 'ZZZZ', true, null, false)$$, 'FEL_REGLA');
do $$ begin
  assert public.fel_tipos_empresa('00000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-00000000000a')->>'predeterminado' = 'FACT', 'el lector puede leer; predeterminado inicial FACT';
  assert (select (x->>'habilitado')::boolean from jsonb_array_elements(public.fel_tipos_empresa('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a')->'tipos') x where x->>'codigo' = 'FACT');
  assert not (select (x->>'habilitado')::boolean from jsonb_array_elements(public.fel_tipos_empresa('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a')->'tipos') x where x->>'codigo' = 'NCRE');
end $$;
select pg_temp.espera_error($$select public.fel_tipos_empresa('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000a')$$, 'FEL_NO_AUTORIZADO');
-- un tipo no habilitado no se puede poner en un borrador
select pg_temp.espera_error($$select public.fel_op_documento_tipo('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select id from t_f1), 'RECI', null, null, 'Colegio', pg_temp.ver((select id from t_f1)))$$, 'FEL_REGLA');
select pg_temp.espera_error($$select public.fel_op_documento_tipo('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select id from t_f1), 'FPEQ', null, null, null, pg_temp.ver((select id from t_f1)))$$, 'FEL_REGLA');
-- habilitar: NCRE, NDEB y RECI (con base) para la empresa A; B no cambia
select public.fel_op_tipos_empresa_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', 'NCRE', true, null, false);
select public.fel_op_tipos_empresa_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', 'NDEB', true, null, false);
select public.fel_op_tipos_empresa_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', 'RECI', true, 'Base de prueba (no es una resolución real)', true);
do $$ begin
  assert public.fel_tipos_empresa('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a')->>'predeterminado' = 'RECI', 'predeterminado configurado';
  assert public.fel_tipos_empresa('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000b')->>'predeterminado' = 'FACT', 'la otra empresa sigue con FACT';
  assert (select count(*) from public.empresa_tipos_documento where empresa_id = '10000000-0000-0000-0000-00000000000b') = 0, 'nada se filtró a la empresa B';
end $$;
select public.fel_op_tipos_empresa_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', 'NCRE', true, null, true);   -- cambia el predeterminado: queda uno solo
do $$ begin
  assert (select count(*) from public.empresa_tipos_documento where empresa_id = '10000000-0000-0000-0000-00000000000a' and predeterminado) = 1 and public.fel_tipos_empresa('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a')->>'predeterminado' = 'NCRE';
end $$;
select pg_temp.espera_error($$insert into public.empresa_tipos_documento (empresa_id, tipo_dte, predeterminado) values ('10000000-0000-0000-0000-00000000000a', 'NDEB', true) on conflict (empresa_id, tipo_dte) do update set predeterminado = true$$, '23505|duplicate');
-- deshabilitar el predeterminado: vuelve a FACT
select public.fel_op_tipos_empresa_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', 'NCRE', false, null, false);
do $$ begin assert public.fel_tipos_empresa('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a')->>'predeterminado' = 'FACT'; end $$;
select public.fel_op_tipos_empresa_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', 'NCRE', true, null, false);
do $$ begin assert (select count(*) from public.auditoria where empresa_id = '10000000-0000-0000-0000-00000000000a' and accion = 'empresa.tipo_documento') >= 4, 'cada cambio de configuración se audita'; end $$;
-- el cliente (authenticated) no escribe las tablas ni llama a las funciones
do $$ begin
  assert not has_table_privilege('authenticated', 'public.empresa_tipos_documento', 'insert') and not has_table_privilege('authenticated', 'public.fel_tipos_dte', 'update');
  assert not has_function_privilege('authenticated', 'public.fel_op_documento_tipo(uuid,uuid,uuid,text,uuid,text,text,integer)', 'execute') and not has_function_privilege('anon', 'public.fel_op_tipos_empresa_guardar(uuid,uuid,text,boolean,text,boolean)', 'execute');
  assert has_function_privilege('service_role', 'public.fel_op_documento_tipo(uuid,uuid,uuid,text,uuid,text,text,integer)', 'execute');
end $$;

-- ================= documento de origen certificado (FACT) y notas
create temp table t_o1 as select pg_temp.borrador((select a1 from t_cli), 100) as id;     -- total 200
select pg_temp.revisar((select id from t_o1));
select pg_temp.espera_error($$select public.fel_op_documento_origenes('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', 'FACT')$$, 'FEL_REGLA');   -- FACT no tiene origen
do $$ begin assert jsonb_array_length(public.fel_op_documento_origenes('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', 'NCRE')) = 0, 'sin certificados no hay candidatos'; end $$;
select pg_temp.certificar_falso((select id from t_o1), '62496FB5', '1974750325', '62496FB5-75B4-4C75-83FA-DFBEF92DE92D');
create temp table t_o1_antes as select version, actualizado_en, estado_fiscal, serie, numero_fiscal, autorizacion_sat, total, tipo_dte from public.documentos where id = (select id from t_o1);
do $$ declare j jsonb; begin
  j := public.fel_op_documento_origenes('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', 'NCRE');
  assert jsonb_array_length(j) = 1 and j->0->>'serie' = '62496FB5' and j->0->>'receptor_id' = '3333333' or j->0->>'receptor_id' = '33333333', 'candidato: ' || j::text;
  assert jsonb_array_length(public.fel_op_documento_origenes('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', 'NCRE', (select a2 from t_cli))) = 0, 'filtro por cliente';
  assert jsonb_array_length(public.fel_op_documento_origenes('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', 'NCRE', null, 'no-existe')) = 0, 'búsqueda';
end $$;
select pg_temp.espera_error($$select public.fel_op_documento_origenes('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000a', 'NCRE')$$, 'FEL_NO_AUTORIZADO');
do $$ begin assert jsonb_array_length(public.fel_op_documento_origenes('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000b', 'NCRE')) = 0, 'la empresa B no ve los documentos de A'; end $$;

-- nota de crédito sobre el origen certificado
create temp table t_n1 as select pg_temp.borrador((select a1 from t_cli), 20) as id;     -- total 40
select pg_temp.espera_error($$select public.fel_op_documento_tipo('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select id from t_n1), 'NCRE', null, 'Devolución', null, pg_temp.ver((select id from t_n1)))$$, 'FEL_REGLA');   -- sin origen
select pg_temp.espera_error($$select public.fel_op_documento_tipo('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select id from t_n1), 'NCRE', (select id from t_f1), 'Devolución', null, pg_temp.ver((select id from t_n1)))$$, 'FEL_REGLA');   -- origen no certificado
select pg_temp.espera_error($$select public.fel_op_documento_tipo('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select id from t_n1), 'NCRE', (select id from t_n1), 'Devolución', null, pg_temp.ver((select id from t_n1)))$$, 'FEL_REGLA|23514|check');   -- sobre sí misma
select pg_temp.espera_error($$select public.fel_op_documento_tipo('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select id from t_n1), 'NCRE', gen_random_uuid(), 'Devolución', null, pg_temp.ver((select id from t_n1)))$$, 'FEL_REGLA|23503|foreign');   -- origen inexistente
select pg_temp.espera_error($$select public.fel_op_documento_tipo('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select id from t_n1), 'NCRE', (select id from t_o1), 'Devolución', null, 1)$$, 'FEL_CONFLICTO');   -- versión vieja
select pg_temp.espera_error($$select public.fel_op_documento_tipo('00000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-00000000000a', (select id from t_n1), 'NCRE', (select id from t_o1), 'Devolución', null, pg_temp.ver((select id from t_n1)))$$, 'FEL_NO_AUTORIZADO');   -- lector
select public.fel_op_documento_tipo('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select id from t_n1), 'NCRE', (select id from t_o1), 'Devolución de mercadería', null, pg_temp.ver((select id from t_n1)));
do $$ declare r jsonb; begin
  select referencia_origen into r from public.documentos where id = (select id from t_n1);
  assert (select tipo_dte from public.documentos where id = (select id from t_n1)) = 'NCRE';
  assert r->>'autorizacion' = '62496FB5-75B4-4C75-83FA-DFBEF92DE92D' and r->>'serie' = '62496FB5' and r->>'numero' = '1974750325' and r->>'tipo' = 'FACT' and (r->>'total')::numeric = 200 and r->>'fecha_emision' ~ '^\d{4}-\d{2}-\d{2}$', 'referencia copiada: ' || r::text;
  assert (select cliente_id from public.documentos where id = (select id from t_n1)) = (select a1 from t_cli), 'receptor del origen';
  -- el documento de origen NO se tocó
  assert (select row(version, actualizado_en, estado_fiscal, serie, numero_fiscal, autorizacion_sat, total, tipo_dte) from public.documentos where id = (select id from t_o1)) is not distinct from (select row(version, actualizado_en, estado_fiscal, serie, numero_fiscal, autorizacion_sat, total, tipo_dte) from t_o1_antes), 'el origen cambió';
end $$;
-- la referencia no se puede falsear desde fuera: se recalcula del origen
update public.documentos set referencia_origen = jsonb_build_object('autorizacion', '00000000-0000-0000-0000-000000000000', 'serie', 'FALSA', 'numero', '0', 'tipo', 'FACT', 'documento_id', (select id from t_o1)) where id = (select id from t_n1);
do $$ begin assert (select referencia_origen->>'serie' from public.documentos where id = (select id from t_n1)) = '62496FB5', 'la referencia se recalcula del origen'; end $$;
-- revisar la nota: exige motivo, mismo receptor, importe
select pg_temp.espera_error($$update public.documentos set motivo_ajuste = 'ab' where id = (select id from t_n1)$$, '23514|check|FEL_REGLA');
select pg_temp.espera_error($$update public.documentos set cliente_id = (select a2 from t_cli) where id = (select id from t_n1); select pg_temp.revisar((select id from t_n1))$$, 'FEL_REGLA');
update public.documentos set cliente_id = (select a1 from t_cli) where id = (select id from t_n1);
select pg_temp.revisar((select id from t_n1));
do $$ begin assert (select estado_preparacion from public.documentos where id = (select id from t_n1)) = 'revisado', 'la nota válida se revisa'; end $$;
-- una nota revisada es inmutable en su tipo, origen y motivo
select pg_temp.espera_error($$update public.documentos set tipo_dte = 'NDEB' where id = (select id from t_n1)$$, 'FEL_REGLA');
select pg_temp.espera_error($$update public.documentos set motivo_ajuste = 'Otro motivo' where id = (select id from t_n1)$$, 'FEL_REGLA');
select pg_temp.espera_error($$update public.documentos set documento_origen_id = null, tipo_dte = 'FACT', referencia_origen = null where id = (select id from t_n1)$$, 'FEL_REGLA');
select pg_temp.espera_error($$select public.fel_op_documento_tipo('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select id from t_n1), 'FACT', null, null, null, pg_temp.ver((select id from t_n1)))$$, 'FEL_REGLA');
-- duplicado: otra nota idéntica activa
create temp table t_n2 as select pg_temp.borrador((select a1 from t_cli), 20) as id;
select public.fel_op_documento_tipo('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select id from t_n2), 'NCRE', (select id from t_o1), 'devolución de MERCADERÍA', null, pg_temp.ver((select id from t_n2)));
select pg_temp.espera_error($$select pg_temp.revisar((select id from t_n2))$$, 'duplicado');
-- tope (regla de proyecto): lo acreditado no supera el total del origen (200): ya hay 40; otra de 170 lo excedería
create temp table t_n3 as select pg_temp.borrador((select a1 from t_cli), 85) as id;      -- 170
select public.fel_op_documento_tipo('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select id from t_n3), 'NCRE', (select id from t_o1), 'Descuento posterior', null, pg_temp.ver((select id from t_n3)));
select pg_temp.espera_error($$select pg_temp.revisar((select id from t_n3))$$, 'superar');
-- una nota de débito no tiene ese tope y distinta importe/motivo no es duplicado
create temp table t_d1 as select pg_temp.borrador((select a1 from t_cli), 85) as id;
select public.fel_op_documento_tipo('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select id from t_d1), 'NDEB', (select id from t_o1), 'Cargo adicional', null, pg_temp.ver((select id from t_d1)));
select pg_temp.revisar((select id from t_d1));
do $$ begin assert (select estado_preparacion from public.documentos where id = (select id from t_d1)) = 'revisado'; end $$;
-- una nota no puede referenciar otra nota ni un recibo; el origen debe ser certificado (la nota revisada aún no lo está)
create temp table t_n4 as select pg_temp.borrador((select a1 from t_cli), 5) as id;
select pg_temp.espera_error($$select public.fel_op_documento_tipo('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select id from t_n4), 'NCRE', (select id from t_n1), 'Sobre otra nota', null, pg_temp.ver((select id from t_n4)))$$, 'FEL_REGLA');
-- otra empresa no puede referenciar el origen de A
select public.fel_op_establecimiento_guardar('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000b', null, '1', 'Casa B', null, 'activo');
select public.fel_op_tipos_empresa_guardar('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000b', 'NCRE', true, null, false);
create temp table t_nb as select (public.fel_op_documento_guardar('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000b', null, (select b1 from t_cli), current_date, 'p',
  '[{"orden":1,"descripcion":"S","cantidad":1,"precio_unitario":10}]'::jsonb, 10, 0, 10, '{"oficial":false}'::jsonb, null)).id as id;
select pg_temp.espera_error($$select public.fel_op_documento_tipo('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000b', (select id from t_nb), 'NCRE', (select id from t_o1), 'Cruce de empresas', null, pg_temp.ver((select id from t_nb)))$$, 'FEL_REGLA|23503|foreign');
-- check de tabla: una nota sin origen, un origen en una factura, motivo/recibo fuera de lugar
select pg_temp.espera_error($$update public.documentos set tipo_dte = 'NCRE' where id = (select id from t_n4)$$, '23514|check|FEL_REGLA');
select pg_temp.espera_error($$update public.documentos set motivo_ajuste = 'Un motivo' where id = (select id from t_f1)$$, '23514|check|FEL_REGLA');
select pg_temp.espera_error($$update public.documentos set tipo_recibo = 'Colegio' where id = (select id from t_f1)$$, '23514|check|FEL_REGLA');
select pg_temp.espera_error($$update public.documentos set documento_origen_id = (select id from t_o1) where id = (select id from t_f1)$$, '23514|check|FEL_REGLA');

-- ================= recibo
create temp table t_r1 as select pg_temp.borrador((select a2 from t_cli), 50) as id;
select pg_temp.espera_error($$select public.fel_op_documento_tipo('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select id from t_r1), 'RECI', null, null, 'Banco', pg_temp.ver((select id from t_r1)))$$, '23514|check');   -- tipo de recibo inválido
select public.fel_op_documento_tipo('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select id from t_r1), 'RECI', (select id from t_o1), 'no aplica', 'Colegio', pg_temp.ver((select id from t_r1)));
do $$ begin
  assert (select tipo_dte || coalesce(tipo_recibo, '-') || coalesce(documento_origen_id::text, '-') || coalesce(motivo_ajuste, '-') from public.documentos where id = (select id from t_r1)) = 'RECIColegio--', 'un recibo no lleva origen ni motivo: se descartan';
end $$;
-- sin tipo de recibo no se revisa
create temp table t_r2 as select pg_temp.borrador((select a2 from t_cli), 33) as id;
update public.documentos set tipo_dte = 'RECI' where id = (select id from t_r2);
select pg_temp.espera_error($$select pg_temp.revisar((select id from t_r2))$$, 'tipo');
update public.documentos set tipo_recibo = 'Universidad' where id = (select id from t_r2);
select pg_temp.revisar((select id from t_r2));
-- un recibo NO sustituye a una factura: misma factura activa (receptor, importe y fecha) → se rechaza
create temp table t_fx as select pg_temp.borrador((select a2 from t_cli), 50) as id;
select pg_temp.revisar((select id from t_fx));
select pg_temp.espera_error($$select pg_temp.revisar((select id from t_r1))$$, 'no sustituye a una factura');
-- si la empresa retira la habilitación, un borrador de ese tipo ya no se puede revisar
create temp table t_r3 as select pg_temp.borrador((select a2 from t_cli), 61) as id;
select public.fel_op_documento_tipo('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select id from t_r3), 'RECI', null, null, 'Inmobiliaria', pg_temp.ver((select id from t_r3)));
select public.fel_op_tipos_empresa_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', 'RECI', false, null, false);
select pg_temp.espera_error($$select pg_temp.revisar((select id from t_r3))$$, 'no está habilitado');
-- y se puede volver a Factura mientras sea borrador (cambiar el tipo mientras es editable)
select public.fel_op_documento_tipo('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', (select id from t_r3), 'FACT', null, null, null, pg_temp.ver((select id from t_r3)));
do $$ begin assert (select tipo_dte from public.documentos where id = (select id from t_r3)) = 'FACT' and (select tipo_recibo is null from public.documentos where id = (select id from t_r3)); end $$;
select pg_temp.revisar((select id from t_r3));

-- ================= la certificación de un tipo que no está implementado se BLOQUEA en la base (operaciones fiscales)
select pg_temp.espera_error($$insert into public.operaciones_fiscales (empresa_id, documento_id, tipo, clave_idempotencia, hash_contenido, proveedor, iniciada_por)
  values ('10000000-0000-0000-0000-00000000000a', (select id from t_d1), 'certificacion', repeat('a', 20), repeat('b', 64), 'mock', '00000000-0000-0000-0000-0000000000c1')$$, 'aún no está habilitada');   -- NDEB revisada
select pg_temp.espera_error($$insert into public.operaciones_fiscales (empresa_id, documento_id, tipo, clave_idempotencia, hash_contenido, proveedor, iniciada_por)
  values ('10000000-0000-0000-0000-00000000000a', (select id from t_n1), 'certificacion', repeat('c', 20), repeat('d', 64), 'mock', '00000000-0000-0000-0000-0000000000c1')$$, 'aún no está habilitada');   -- NCRE revisada
select pg_temp.espera_error($$insert into public.operaciones_fiscales (empresa_id, documento_id, tipo, clave_idempotencia, hash_contenido, proveedor, iniciada_por)
  values ('10000000-0000-0000-0000-00000000000a', (select id from t_r2), 'certificacion', repeat('e', 20), repeat('f', 64), 'mock', '00000000-0000-0000-0000-0000000000c1')$$, 'aún no está habilitada');   -- RECI revisado
do $$ begin assert (select count(*) from public.operaciones_fiscales where documento_id in (select id from t_d1 union all select id from t_n1 union all select id from t_r2)) = 0, 'no quedó ninguna operación'; end $$;
-- FACT conserva su camino: una operación sobre una factura revisada SÍ se puede crear
insert into public.operaciones_fiscales (empresa_id, documento_id, tipo, clave_idempotencia, hash_contenido, proveedor, iniciada_por)
  values ('10000000-0000-0000-0000-00000000000a', (select id from t_r3), 'certificacion', repeat('g', 20), repeat('9', 64), 'mock', '00000000-0000-0000-0000-0000000000c1');
-- COMPATIBILIDAD con la migración 29 (si su tabla existe): el guardián también cierra el almacén de Digifact a los tipos que no certifican; FACT conserva su camino
create or replace function pg_temp.op29(p_doc uuid, p_n int) returns void language plpgsql as $$
begin
  insert into public.digifact_operaciones (id, empresa_id, documento_id, referencia, hash, huella_emisor, fecha_emision, establecimiento, total, estado, creada_ms, actualizada_ms, actor_id, intento_del_documento)
  values (gen_random_uuid(), '10000000-0000-0000-0000-00000000000a', p_doc, gen_random_uuid(), repeat('a', 16), '0123456789abcdef', '2026-11-16', 1, '100', 'preparada', 1000 + p_n, 1000 + p_n, '00000000-0000-0000-0000-0000000000c1', 0);
end $$;
do $$ begin
  if to_regclass('public.digifact_operaciones') is not null then
    assert (select count(*) from pg_trigger where tgrelid = 'public.digifact_operaciones'::regclass and tgname = 'fel_digifact_tipo_guard_t') = 1, 'guardián instalado sobre la tabla de la 29';
    begin perform pg_temp.op29((select id from t_d1), 1); raise exception 'NO DEBIÓ'; exception when others then assert sqlerrm like '%aún no está habilitada%', 'NDEB en el almacén de Digifact: ' || sqlerrm; end;
    begin perform pg_temp.op29((select id from t_n1), 2); raise exception 'NO DEBIÓ'; exception when others then assert sqlerrm like '%aún no está habilitada%', 'NCRE en el almacén de Digifact: ' || sqlerrm; end;
    begin perform pg_temp.op29((select id from t_r2), 3); raise exception 'NO DEBIÓ'; exception when others then assert sqlerrm like '%aún no está habilitada%', 'RECI en el almacén de Digifact: ' || sqlerrm; end;
    perform pg_temp.op29((select id from t_r3), 4);   -- FACT revisada: la operación nace «preparada» como siempre
    assert (select count(*) from public.digifact_operaciones where documento_id in (select id from t_d1 union all select id from t_n1 union all select id from t_r2)) = 0;
    assert (select count(*) from public.digifact_operaciones where documento_id = (select id from t_r3) and estado = 'preparada') = 1;
    -- las transiciones propias de la 29 siguen intactas sobre una FACT (preparada → enviando)
    update public.digifact_operaciones set estado = 'enviando', actualizada_ms = actualizada_ms + 1 where documento_id = (select id from t_r3);
    assert (select estado from public.digifact_operaciones where documento_id = (select id from t_r3)) = 'enviando';
  end if;
end $$;
-- el guardián de la tabla de la migración 29 se instala solo cuando esa tabla existe (idempotente)
do $$ begin
  assert (select public.fel_tipos_instalar_guardian_digifact()) in ('sin tabla digifact_operaciones: nada que instalar', 'ya instalado', 'instalado');
  assert (select public.fel_tipos_instalar_guardian_digifact()) <> 'instalado', 'la segunda vez no instala otra vez';
end $$;
-- los documentos anteriores a esta migración y los FACT no cambian: ninguna nota/recibo huérfano
do $$ begin
  assert (select count(*) from public.documentos where tipo_dte = 'FACT' and (documento_origen_id is not null or referencia_origen is not null or motivo_ajuste is not null or tipo_recibo is not null)) = 0;
  assert (select count(*) from public.documentos where tipo_dte in ('NCRE','NDEB') and (documento_origen_id is null or referencia_origen is null)) = 0;
end $$;
rollback;
select 'PRUEBAS 30 OK' as resultado;
