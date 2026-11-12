-- D3-1 · Digifact SIMULADO: el proveedor solo existe contra el simulador; el bolsón simulado no se mezcla con el real; anulación simulada (idempotente, con desconocido y rechazo).
-- Todo SIMULADO: sin credenciales ni red; nada de esto certifica ni anula ante SAT.
\set ON_ERROR_STOP on
begin;
create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_ok boolean := false;
begin
  begin execute p_sql; exception when others then v_ok := (sqlerrm ~ p_patron) or (sqlstate ~ p_patron); end;
  if not v_ok then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if;
end $$;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'maestro@fel.test'), ('00000000-0000-0000-0000-0000000000c1', 'propA@fel.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'emisorA@fel.test'), ('00000000-0000-0000-0000-0000000000d1', 'propB@fel.test');
insert into public.perfiles (user_id) select id from auth.users on conflict (user_id) do nothing;
insert into public.plataforma_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1');
insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id, estado)
select e.id, e.n, e.n || ' S.A.', e.nit, r.id, 'habilitada'
  from (values ('10000000-0000-0000-0000-00000000000a'::uuid, 'Empresa A', '1111111-1'), ('10000000-0000-0000-0000-00000000000b'::uuid, 'Empresa B', '2222222-2')) e(id, n, nit),
       public.regimenes_fiscales r where r.codigo = 'general';
insert into public.miembros (empresa_id, user_id, rol) values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 'propietario'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', 'emisor'), ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000d1', 'propietario');

-- ================= 1. el proveedor: solo simulado, con la barrera de tabla
do $$ begin
  assert (select habilitado and ambientes = '{simulado}' from public.proveedores_emision where id = 'digifact'), 'digifact habilitado solo en simulado';
  assert (select count(*) from pg_constraint where conname = 'proveedores_digifact_solo_simulado_chk') = 1 and (select count(*) from pg_constraint where conname = 'proveedores_digifact_bloqueado_chk') = 0, 'la barrera nueva reemplaza a la anterior';
end $$;
select pg_temp.espera_error($$update public.proveedores_emision set ambientes = '{simulado,pruebas}' where id = 'digifact'$$, '23514|check');
select pg_temp.espera_error($$update public.proveedores_emision set ambientes = '{simulado,produccion}' where id = 'digifact'$$, '23514|check');
select pg_temp.espera_error($$update public.proveedores_emision set ambientes = '{pruebas}' where id = 'digifact'$$, '23514|check');
do $$ begin assert (select habilitado and ambientes = '{simulado}' from public.proveedores_emision where id = 'portal_playwright'), 'el portal sigue igual'; end $$;
-- canales: simulado sí; pruebas y producción, nunca
create temp table t_e as select (public.fel_op_establecimiento_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, '1', 'Casa matriz A', 'Dirección de prueba', 'activo')).id as id;
create temp table t_c as select (public.fel_op_canal_configurar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, 'digifact', 'simulado', true)).id as id;
create temp table t_cm as select (public.fel_op_canal_configurar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, 'mock', 'simulado', true)).id as id;
select pg_temp.espera_error($$select public.fel_op_canal_configurar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, 'digifact', 'pruebas', true)$$, 'FEL_REGLA');
select pg_temp.espera_error($$select public.fel_op_canal_configurar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, 'digifact', 'produccion', true)$$, 'FEL_REGLA');
select pg_temp.espera_error($$insert into public.empresa_canales (empresa_id, proveedor_id, ambiente, habilitado) values ('10000000-0000-0000-0000-00000000000a', 'digifact', 'produccion', true)$$, '23514|check');
select pg_temp.espera_error($$select public.fel_op_canal_configurar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', null, 'digifact', 'simulado', true)$$, 'FEL_NO_AUTORIZADO');

-- ================= 2. bolsón simulado
select set_config('fel.sim', (public.fel_admin_bolson_cuenta_crear('00000000-0000-0000-0000-0000000000a1', 'digifact', 'simulado', 'SIMULADOR-DIGIFACT')).id::text, false) as _a \gset
select set_config('fel.prb', (public.fel_admin_bolson_cuenta_crear('00000000-0000-0000-0000-0000000000a1', 'digifact', 'pruebas', 'CUENTA-TEST')).id::text, false) as _b \gset
do $$ declare a1 uuid := '00000000-0000-0000-0000-0000000000a1';
begin
  perform pg_temp.espera_error($q$select public.fel_admin_bolson_cuenta_crear('00000000-0000-0000-0000-0000000000a1','mock','simulado','X')$q$, 'solo el simulador de Digifact');
  perform pg_temp.espera_error($q$insert into public.bolson_cuentas (proveedor_id, ambiente, referencia_externa) values ('mock','simulado','X')$q$, 'check|violates');
  perform pg_temp.espera_error($q$select public.fel_admin_bolson_cuenta_crear('00000000-0000-0000-0000-0000000000a1','digifact','produccion','PROD')$q$, 'cuentas de producción');
  assert (select ambiente from public.bolson_cuentas where id = current_setting('fel.sim')::uuid) = 'simulado' and (select count(*) from public.bolson_reglas_consumo where cuenta_id = current_setting('fel.sim')::uuid and vigente_hasta is null) = 10, 'cuenta simulada con sus reglas conservadoras';
  perform public.fel_admin_bolson_lote_registrar(a1, current_setting('fel.sim')::uuid, 100, 0, 'LOTE-SIM-1');
  perform public.fel_admin_bolson_lote_registrar(a1, current_setting('fel.prb')::uuid, 100, 1, 'LOTE-PRB-1');
end $$;

-- ================= 3. un documento certificado EN SIMULACIÓN (canal Digifact simulado) para probar la anulación
create or replace function pg_temp.doc_certificado(p_aut text) returns uuid language plpgsql as $$
declare v_id uuid; v_ver int; o public.operaciones_fiscales; h text; c uuid := (select id from t_c); e uuid := (select id from t_e);
        A uuid := '10000000-0000-0000-0000-00000000000a';
begin
  v_id := (public.fel_op_documento_guardar('00000000-0000-0000-0000-0000000000c3', A, null, (select id from public.clientes where empresa_id = A limit 1), current_date, 'prueba',
           '[{"orden":1,"descripcion":"Servicio de prueba","cantidad":2,"precio_unitario":10.5}]'::jsonb, 21, 0, 21, '{"oficial":false}'::jsonb, null)).id;
  perform public.fel_op_documento_establecimiento('00000000-0000-0000-0000-0000000000c3', A, v_id, e);
  select version into v_ver from public.documentos where id = v_id;
  perform public.fel_op_documento_preparacion('00000000-0000-0000-0000-0000000000c1', A, v_id, 'revisado', null, v_ver);
  h := public.fel_sys_hash_documento(A, v_id);
  o := public.fel_op_certificacion_solicitar('00000000-0000-0000-0000-0000000000c1', A, v_id, 'clave-cert-' || p_aut || '-0001', h, c);
  assert o.ambiente = 'simulado' and o.proveedor = 'digifact', 'la certificación nace simulada y de digifact';
  perform public.fel__cerrar_certificacion(o.id, true, 'proveedor', '{"simulado":true}'::jsonb, null, 'SIMA', '0000' || p_aut, 'SIM-' || p_aut);
  return v_id;
end $$;
select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', null, 'NIT', '3333333-3', 'Cliente A', null, null, null, null);
create temp table t_d as select pg_temp.doc_certificado('1') as d1, pg_temp.doc_certificado('2') as d2, pg_temp.doc_certificado('3') as d3, pg_temp.doc_certificado('4') as d4;

-- ================= 4. el consumo simulado: simulado↔simulado sí; simulado↔pruebas no (y al revés)
do $$ declare A uuid := '10000000-0000-0000-0000-00000000000a'; sim uuid := current_setting('fel.sim')::uuid; prb uuid := current_setting('fel.prb')::uuid; op uuid; c public.consumos;
begin
  select id into op from public.operaciones_fiscales where documento_id = (select d1 from t_d) and tipo = 'certificacion';
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_reservar('%s','%s','certificacion','%s',null,'k-sim-0000000001',repeat('b',64))$q$, A, prb, op), 'no corresponde a la cuenta');   -- simulada ↔ cuenta de pruebas
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_reservar('%s','%s','certificacion','%s',null,'k-sim-0000000001',repeat('b',64))$q$, A, sim, op), 'ya está confirmada');                 -- la operación ya está cerrada (es del paso 3)
  -- operación simulada abierta: se reserva en la cuenta simulada
  insert into public.operaciones_fiscales (empresa_id, documento_id, tipo, clave_idempotencia, hash_contenido, proveedor, ambiente)
  values (A, (select d4 from t_d), 'anulacion', 'op-sim-anu-00000001', repeat('a', 64), 'digifact', 'simulado') returning id into op;
  c := public.fel_sys_consumo_reservar(A, sim, 'anulacion', op, null, 'k-sim-anu-0000001', repeat('b', 64));
  assert c.estado = 'reservado' and c.cuenta_id = sim, 'una operación simulada reserva en la cuenta simulada';
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_reservar('%s','%s','anulacion','%s',null,'k-sim-anu-0000002',repeat('b',64))$q$, A, prb, op), 'no corresponde a la cuenta');
end $$;

-- ================= 5. anulación SIMULADA: permisos, idempotencia, límites y ciclo completo
do $$
declare A uuid := '10000000-0000-0000-0000-00000000000a'; c1 uuid := '00000000-0000-0000-0000-0000000000c1'; c3 uuid := '00000000-0000-0000-0000-0000000000c3'; canal uuid := (select id from t_c); canalm uuid := (select id from t_cm);
        d1 uuid := (select d1 from t_d); d2 uuid := (select d2 from t_d); d3 uuid := (select d3 from t_d); o public.operaciones_fiscales; o2 public.operaciones_fiscales; borrador uuid;
begin
  perform pg_temp.espera_error(format($q$select public.fel_op_anulacion_simulada_iniciar('%s','%s','%s','clave-anu-0000000001',repeat('c',64),'Motivo de prueba','%s')$q$, c3, A, d1, canal), 'FEL_NO_AUTORIZADO');   -- el emisor no anula
  perform pg_temp.espera_error(format($q$select public.fel_op_anulacion_simulada_iniciar('%s','%s','%s','clave-anu-0000000001',repeat('c',64),'abc','%s')$q$, c1, A, d1, canal), 'motivo es obligatorio');
  perform pg_temp.espera_error(format($q$select public.fel_op_anulacion_simulada_iniciar('%s','%s','%s','clave-anu-0000000001',repeat('c',64),'Motivo de prueba','%s')$q$, c1, A, d1, canalm), 'canal simulado habilitado de Digifact');   -- el mock no anula
  perform pg_temp.espera_error(format($q$select public.fel_op_anulacion_simulada_iniciar('%s','%s','%s','clave-anu-0000000001',repeat('c',64),'Motivo de prueba','99999999-0000-0000-0000-000000000000')$q$, c1, A, d1), 'canal simulado habilitado');
  perform pg_temp.espera_error(format($q$select public.fel_op_anulacion_simulada_iniciar('%s','10000000-0000-0000-0000-00000000000b','%s','clave-anu-0000000001',repeat('c',64),'Motivo de prueba','%s')$q$, '00000000-0000-0000-0000-0000000000d1', d1, canal), 'canal simulado habilitado|NO_ENCONTRADO');   -- otra empresa
  -- un documento que NO está certificado no se anula
  borrador := (public.fel_op_documento_guardar(c3, A, null, (select id from public.clientes where empresa_id = A limit 1), current_date, 'borrador', '[]'::jsonb, 0, 0, 0, '{}'::jsonb, null)).id;
  perform pg_temp.espera_error(format($q$select public.fel_op_anulacion_simulada_iniciar('%s','%s','%s','clave-anu-0000000002',repeat('c',64),'Motivo de prueba','%s')$q$, c1, A, borrador, canal), 'solo se anula un DTE certificado');
  -- inicio, repetición idéntica, contenido distinto, operación abierta
  o := public.fel_op_anulacion_simulada_iniciar(c1, A, d1, 'clave-anu-0000000001', repeat('c', 64), 'Motivo de prueba', canal);
  assert o.tipo = 'anulacion' and o.estado = 'iniciada' and o.ambiente = 'simulado' and o.proveedor = 'digifact' and o.canal_id = canal and o.motivo = 'Motivo de prueba' and o.regla_id is null, 'operación de anulación simulada';
  assert (select estado_fiscal from public.documentos where id = d1) = 'anulacion_solicitada', 'el documento queda en anulación solicitada';
  assert (public.fel_op_anulacion_simulada_iniciar(c1, A, d1, 'clave-anu-0000000001', repeat('c', 64), 'Motivo de prueba', canal)).id = o.id, 'repetición idéntica: la misma operación';
  perform pg_temp.espera_error(format($q$select public.fel_op_anulacion_simulada_iniciar('%s','%s','%s','clave-anu-0000000001',repeat('d',64),'Motivo de prueba','%s')$q$, c1, A, d1, canal), 'FEL_CONFLICTO');
  perform pg_temp.espera_error(format($q$select public.fel_op_anulacion_simulada_iniciar('%s','%s','%s','clave-anu-0000000009',repeat('c',64),'Motivo de prueba','%s')$q$, c1, A, d1, canal), 'FEL_OPERACION_ABIERTA');
  assert (select count(*) from public.auditoria where accion = 'fiscal.anulacion_simulada_iniciada' and entidad_id = d1::text) = 1, 'auditada una sola vez';
  -- un solo envío (marca de envío genérica) y cierre exitoso
  perform public.fel_sys_operacion_marcar_envio(A, o.id);
  perform pg_temp.espera_error(format($q$select public.fel_sys_operacion_marcar_envio('%s','%s')$q$, A, o.id), 'FEL_YA_ENVIADA');
  perform pg_temp.espera_error(format($q$select public.fel_sys_anulacion_cerrar('%s','%s',true,null)$q$, A, o.id), 'exige la evidencia');
  perform pg_temp.espera_error(format($q$select public.fel_sys_anulacion_cerrar('%s','%s',true,'{}')$q$, A, o.id), 'exige la evidencia');
  perform pg_temp.espera_error(format($q$select public.fel_sys_anulacion_cerrar('10000000-0000-0000-0000-00000000000b','%s',true,'{"x":1}')$q$, o.id), 'anulación no encontrada');
  perform pg_temp.espera_error(format($q$select public.fel_sys_anulacion_cerrar('%s','%s',true,'{"x":1}')$q$, A, (select id from public.operaciones_fiscales where documento_id = d1 and tipo = 'certificacion')), 'anulación no encontrada');   -- no cierra certificaciones
  perform public.fel_sys_anulacion_cerrar(A, o.id, true, '{"respuesta":"anulado (simulado)"}');
  assert (select estado from public.operaciones_fiscales where id = o.id) = 'confirmada_exitosa' and (select resolucion from public.operaciones_fiscales where id = o.id) = 'proveedor';
  assert (select estado_fiscal = 'anulado' and anulado_en is not null from public.documentos where id = d1), 'documento anulado';
  perform pg_temp.espera_error(format($q$select public.fel_sys_anulacion_cerrar('%s','%s',true,'{"x":1}')$q$, A, o.id), 'ya está confirmada');
  perform pg_temp.espera_error(format($q$select public.fel_op_anulacion_simulada_iniciar('%s','%s','%s','clave-anu-0000000003',repeat('c',64),'Motivo de prueba','%s')$q$, c1, A, d1, canal), 'solo se anula un DTE certificado');   -- ya anulado
  perform pg_temp.espera_error(format($q$update public.documentos set estado_fiscal = 'certificado' where id = '%s'$q$, d1), 'FEL_|check|violates|definitivo');   -- un anulado es definitivo
  -- desconocido: no se asume nada, no se reintenta, y se resuelve después con la respuesta confirmada
  o2 := public.fel_op_anulacion_simulada_iniciar(c1, A, d2, 'clave-anu-0000000004', repeat('c', 64), 'Anulación con tiempo agotado', canal);
  perform public.fel_sys_operacion_marcar_envio(A, o2.id);
  perform public.fel_sys_anulacion_desconocida(A, o2.id, 'tiempo agotado');
  perform public.fel_sys_anulacion_desconocida(A, o2.id, 'otra vez');   -- idempotente
  assert (select estado from public.operaciones_fiscales where id = o2.id) = 'desconocida' and (select estado_fiscal from public.documentos where id = d2) = 'anulacion_solicitada', 'desconocida: el documento no cambia';
  perform pg_temp.espera_error(format($q$select public.fel_op_anulacion_simulada_iniciar('%s','%s','%s','clave-anu-0000000005',repeat('c',64),'Motivo de prueba','%s')$q$, c1, A, d2, canal), 'FEL_OPERACION_ABIERTA');
  perform pg_temp.espera_error(format($q$select public.fel_sys_anulacion_desconocida('%s','%s','x')$q$, A, (select id from public.operaciones_fiscales where documento_id = d2 and tipo = 'certificacion')), 'anulación no encontrada');
  perform public.fel_sys_anulacion_cerrar(A, o2.id, true, '{"consulta":"anulado (simulado)"}');
  assert (select estado_fiscal from public.documentos where id = d2) = 'anulado', 'resuelta tras consultar';
  perform pg_temp.espera_error(format($q$select public.fel_sys_anulacion_desconocida('%s','%s','x')$q$, A, o2.id), 'solo una anulación iniciada');   -- ya confirmada
  -- rechazada: el documento vuelve a certificado y puede intentarse de nuevo
  o := public.fel_op_anulacion_simulada_iniciar(c1, A, d3, 'clave-anu-0000000006', repeat('c', 64), 'Anulación que será rechazada', canal);
  perform public.fel_sys_anulacion_cerrar(A, o.id, false, '{"respuesta":"rechazada (simulada)"}');
  assert (select estado from public.operaciones_fiscales where id = o.id) = 'confirmada_fallida' and (select estado_fiscal from public.documentos where id = d3) = 'certificado', 'rechazada: vuelve a certificado';
  o := public.fel_op_anulacion_simulada_iniciar(c1, A, d3, 'clave-anu-0000000007', repeat('e', 64), 'Segundo intento de anulación', canal);
  assert o.estado = 'iniciada', 'puede volver a intentarse tras un rechazo confirmado';
  -- consumo del bolsón SIMULADO asociado a la anulación (regla conservadora: consume 1 hasta que haya contrato) y su ciclo
  declare c public.consumos; sim uuid := current_setting('fel.sim')::uuid; begin
    c := public.fel_sys_consumo_reservar(A, sim, 'anulacion', o.id, d3, 'k-anu-consumo-0001', repeat('b', 64));
    assert c.estado = 'reservado' and c.operacion_id = o.id;
    perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_confirmar('%s','%s')$q$, A, c.id), 'FEL_INCIERTO');            -- operación aún abierta
    perform public.fel_sys_anulacion_cerrar(A, o.id, false, '{"respuesta":"rechazada (simulada)"}');
    assert (public.fel_sys_consumo_liberar(A, c.id, 'proveedor_confirma_sin_consumo', '{"evento":"anulación rechazada"}')).estado = 'liberado', 'anulación fallida confirmada: la reserva se libera';
  end;
  assert (select count(*) from public.fel_sys_verificar_saldos() where not ok) = 0, 'el libro sigue exacto';
end $$;

-- ================= 5b. la anulación simulada NO alcanza lo que no es simulado (defensa por partida doble)
do $$
declare A uuid := '10000000-0000-0000-0000-00000000000a'; c1 uuid := '00000000-0000-0000-0000-0000000000c1'; c3 uuid := '00000000-0000-0000-0000-0000000000c3'; canal uuid := (select id from t_c); e uuid := (select id from t_e);
        v_id uuid; v_ver int; op uuid; opx uuid;
begin
  -- (a) un documento certificado en «pruebas» (no simulado): la anulación simulada lo rechaza
  v_id := (public.fel_op_documento_guardar(c3, A, null, (select id from public.clientes where empresa_id = A limit 1), current_date, 'prueba',
           '[{"orden":1,"descripcion":"Servicio","cantidad":1,"precio_unitario":10}]'::jsonb, 10, 0, 10, '{"oficial":false}'::jsonb, null)).id;
  perform public.fel_op_documento_establecimiento(c3, A, v_id, e);
  select version into v_ver from public.documentos where id = v_id;
  perform public.fel_op_documento_preparacion(c1, A, v_id, 'revisado', null, v_ver);
  insert into public.operaciones_fiscales (empresa_id, documento_id, tipo, clave_idempotencia, hash_contenido, proveedor, ambiente)
  values (A, v_id, 'certificacion', 'clave-pruebas-000001', public.fel_sys_hash_documento(A, v_id), 'digifact', 'pruebas') returning id into op;
  perform public.fel__fiscal_cambiar(v_id, A, 'pendiente_certificacion', c1, op, 'prueba');
  perform public.fel__cerrar_certificacion(op, true, 'proveedor', '{"x":1}'::jsonb, null, 'REAL', '00000001', 'AUT-0001-REAL');
  assert (select estado_fiscal from public.documentos where id = v_id) = 'certificado';
  perform pg_temp.espera_error(format($q$select public.fel_op_anulacion_simulada_iniciar('%s','%s','%s','clave-anu-0000000020',repeat('c',64),'Motivo de prueba','%s')$q$, c1, A, v_id, canal), 'solo aplica a documentos certificados en simulación');
  -- (b) una anulación de «pruebas» no se cierra con la función simulada
  insert into public.operaciones_fiscales (empresa_id, documento_id, tipo, clave_idempotencia, hash_contenido, proveedor, ambiente, motivo)
  values (A, v_id, 'anulacion', 'clave-anu-pruebas-0001', repeat('c', 64), 'digifact', 'pruebas', 'prueba') returning id into opx;
  perform pg_temp.espera_error(format($q$select public.fel_sys_anulacion_cerrar('%s','%s',true,'{"x":1}')$q$, A, opx), 'solo aplica a anulaciones simuladas');
  assert (select estado from public.operaciones_fiscales where id = opx) = 'iniciada', 'no se tocó';
end $$;

-- ================= 5c. cuentas de producción: tres cerrojos independientes (proveedor habilitado, ambiente permitido, interruptor de plataforma)
do $$ declare a1 uuid := '00000000-0000-0000-0000-0000000000a1';
begin
  perform pg_temp.espera_error($q$select public.fel_admin_bolson_cuenta_crear('00000000-0000-0000-0000-0000000000a1','digifact','produccion','PROD-1')$q$, 'cuentas de producción');
  -- aun si (por una migración futura) el proveedor admitiera producción, falta el interruptor de plataforma: solo se cambia con SQL de propietario
  alter table public.proveedores_emision drop constraint proveedores_digifact_solo_simulado_chk;
  update public.proveedores_emision set ambientes = '{simulado,produccion}' where id = 'digifact';
  perform pg_temp.espera_error($q$select public.fel_admin_bolson_cuenta_crear('00000000-0000-0000-0000-0000000000a1','digifact','produccion','PROD-2')$q$, 'cuentas de producción');
  update public.plataforma_config set valor = true where clave = 'emision_real_disponible';
  assert (public.fel_admin_bolson_cuenta_crear(a1, 'digifact', 'produccion', 'PROD-3')).ambiente = 'produccion', 'con los tres cerrojos abiertos sí (solo dentro de esta prueba, que se revierte)';
end $$;

-- ================= 6. privilegios
do $$ declare t text; begin
  for t in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('fel_op_anulacion_simulada_iniciar','fel_sys_anulacion_desconocida','fel_sys_anulacion_cerrar') loop
    assert not has_function_privilege('anon', t, 'EXECUTE') and not has_function_privilege('authenticated', t, 'EXECUTE'), 'ejecutable por usuarios: ' || t;
    assert has_function_privilege('service_role', t, 'EXECUTE'), 'service_role no ejecuta ' || t;
  end loop;
end $$;

rollback;
\echo OK 20_digifact_simulado
