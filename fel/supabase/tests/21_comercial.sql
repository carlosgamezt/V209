-- D2-3 · Capa comercial: planes, contratos, monedero, pagos SIMULADOS, cobertura atómica (bolsón + monedero), política de cargos, cobros, suscripción y aislamiento (RLS real).
-- Todo SIMULADO: el único medio de pago es «simulado»; no hay pasarela ni cobro real.
\set ON_ERROR_STOP on
begin;
create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_ok boolean := false;
begin
  begin execute p_sql; exception when others then v_ok := (sqlerrm ~ p_patron) or (sqlstate ~ p_patron); end;
  if not v_ok then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if;
end $$;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'maestro@fel.test'), ('00000000-0000-0000-0000-0000000000c1', 'propA@fel.test'), ('00000000-0000-0000-0000-0000000000c2', 'lectorA@fel.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'emisorA@fel.test'), ('00000000-0000-0000-0000-0000000000d1', 'propB@fel.test'), ('00000000-0000-0000-0000-0000000000e1', 'sinempresa@fel.test');
insert into public.perfiles (user_id) select id from auth.users on conflict (user_id) do nothing;
insert into public.plataforma_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1');
insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id, estado)
select e.id, e.n, e.n || ' S.A.', e.nit, r.id, 'habilitada'
  from (values ('10000000-0000-0000-0000-00000000000a'::uuid, 'Empresa A', '1111111-1'), ('10000000-0000-0000-0000-00000000000b'::uuid, 'Empresa B', '2222222-2'),
               ('10000000-0000-0000-0000-00000000000c'::uuid, 'Empresa C', '3333333-3'), ('10000000-0000-0000-0000-00000000000d'::uuid, 'Empresa D', '4444444-4'), ('10000000-0000-0000-0000-00000000000e'::uuid, 'Empresa E', '5555555-5')) e(id, n, nit),
       public.regimenes_fiscales r where r.codigo = 'general';
insert into public.miembros (empresa_id, user_id, rol) values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 'propietario'), ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c2', 'lector'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', 'emisor'), ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000d1', 'propietario');

create temp table t_n (n int not null); insert into t_n values (0);
create or replace function pg_temp.nuevo_doc(p_emp uuid) returns uuid language plpgsql as $$ declare v uuid; begin update t_n set n = n + 1; insert into public.documentos (empresa_id, numero_borrador) values (p_emp, (select n from t_n) + 1000) returning id into v; return v; end $$;
create or replace function pg_temp.nueva_op(p_emp uuid, p_tipo text default 'certificacion') returns uuid language plpgsql as $$ declare v uuid; begin
  insert into public.operaciones_fiscales (empresa_id, documento_id, tipo, clave_idempotencia, hash_contenido, proveedor, ambiente) values (p_emp, pg_temp.nuevo_doc(p_emp), p_tipo, 'op-' || gen_random_uuid(), repeat('a', 64), 'digifact', 'simulado') returning id into v; return v; end $$;
create or replace function pg_temp.cerrar_op(p_op uuid, p_estado text) returns void language plpgsql as $$ begin
  update public.operaciones_fiscales set estado = p_estado, resolucion = 'proveedor', resuelta_en = clock_timestamp() where id = p_op; end $$;
create or replace function pg_temp.cob(p_emp uuid, p_ev text, p_op uuid, p_clave text) returns public.consumos language sql as $$
  select public.fel_sys_cobertura_reservar(p_emp, current_setting('fel.sim')::uuid, p_ev, p_op, null, rpad(p_clave, 16, '_'), repeat('b', 64)) $$;
create or replace function pg_temp.ok() returns boolean language sql as $$ select not exists (select 1 from public.fel_sys_verificar_saldos() where not ok) and not exists (select 1 from public.fel_sys_verificar_monederos() where not ok) $$;
create or replace function pg_temp.disponible(p_emp uuid) returns numeric language sql as $$ select recargado + ajustado - consumido - reservado - reembolsado + sobregiro from public.monedero_saldos where empresa_id = p_emp $$;

-- ================= 1. estructura y barreras de tabla
do $$ begin
  assert (select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('planes','plan_versiones','tarifas','cuentas_comerciales','contratos_plan','monedero_saldos','monedero_movimientos','pagos','cargos','cobros') and data_type in ('real','double precision')) = 0, 'sin coma flotante';
  assert (select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('monedero_saldos','monedero_movimientos','pagos','cargos','cobros','tarifas','plan_versiones') and column_name ~ '(monto|precio|saldo|recargado|consumido|reservado|reembolsado|ajustado|cuota|sobregiro|limite)' and column_name <> 'permite_sobregiro'
          and not (data_type = 'numeric' and numeric_scale = 6)) = 0, 'importes en numeric(*,6)';
  assert (select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('planes','plan_versiones','tarifas','cuentas_comerciales','contratos_plan','monedero_saldos','monedero_movimientos','pagos','cargos','cobros') and column_name ~* '(password|contrase|token|secret|credencial|api_?key|tarjeta|card|cvv|iban)') = 0, 'sin datos de pago sensibles';
  -- el consumo del proveedor no referencia nada comercial; lo comercial sí referencia consumos (nunca al revés)
  assert exists (select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid where c.contype = 'f' and t.relname = 'cargos' and pg_get_constraintdef(c.oid) ~ 'REFERENCES consumos');
  assert not exists (select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid join pg_class r on r.oid = c.confrelid where c.contype = 'f' and t.relname in ('consumos','bolson_movimientos','bolson_alertas','bolson_saldos','bolson_lotes') and r.relname in ('cargos','pagos','cobros','monedero_movimientos','monedero_saldos','tarifas','cuentas_comerciales'));
end $$;
select pg_temp.espera_error($$insert into public.planes (codigo, nombre, modalidad) values ('mal codigo', 'Plan inválido', 'prepago')$$, 'check');
select pg_temp.espera_error($$insert into public.planes (codigo, nombre, modalidad) values ('plan_x', 'Plan inválido', 'tarjeta')$$, 'check');

-- ================= 2. catálogo: planes, versiones y tarifas (solo el maestro; solo inserción)
create temp table t_pv (prepago1 uuid, prepago2 uuid); create temp table t_pv2 (mensual uuid, suscripcion uuid);
select set_config('fel.sim', (public.fel_admin_bolson_cuenta_crear('00000000-0000-0000-0000-0000000000a1', 'digifact', 'simulado', 'SIM-COMERCIAL')).id::text, false) as _s \gset
do $$
declare a1 uuid := '00000000-0000-0000-0000-0000000000a1'; v public.plan_versiones; v2 public.plan_versiones;
        tar jsonb := '[{"evento":"certificacion","precio":"2.5","cargable":true},{"evento":"anulacion","precio":"0","cargable":false},{"evento":"rechazo_proveedor","precio":"0","cargable":false},{"evento":"consulta","precio":"0","cargable":false}]';
begin
  perform public.fel_admin_bolson_lote_registrar(a1, current_setting('fel.sim')::uuid, 1000, 0, 'LOTE-COM-1');
  perform pg_temp.espera_error(format($q$select public.fel_admin_plan_crear('%s','prepago_basico','Prepago básico','prepago')$q$, '00000000-0000-0000-0000-0000000000c1'), 'FEL_NO_AUTORIZADO');
  perform public.fel_admin_plan_crear(a1, 'prepago_basico', 'Prepago básico', 'prepago'); perform public.fel_admin_plan_crear(a1, 'prepago_basico', 'Prepago básico', 'prepago');   -- idempotente
  assert (select count(*) from public.planes where codigo = 'prepago_basico') = 1;
  perform pg_temp.espera_error($q$select public.fel_admin_plan_crear('00000000-0000-0000-0000-0000000000a1','prepago_basico','Prepago básico','consumo_mensual')$q$, 'FEL_IDEMPOTENCIA');
  perform public.fel_admin_plan_crear(a1, 'mensual_basico', 'Consumo mensual', 'consumo_mensual'); perform public.fel_admin_plan_crear(a1, 'suscripcion_basica', 'Suscripción', 'suscripcion');
  perform pg_temp.espera_error($q$select public.fel_admin_plan_version_crear('00000000-0000-0000-0000-0000000000c1','prepago_basico', current_date, 0, 0, false, 0, '[]')$q$, 'FEL_NO_AUTORIZADO');
  perform pg_temp.espera_error($q$select public.fel_admin_plan_version_crear('00000000-0000-0000-0000-0000000000a1','no_existe', current_date, 0, 0, false, 0, '[]')$q$, 'plan no encontrado');
  perform pg_temp.espera_error($q$select public.fel_admin_plan_version_crear('00000000-0000-0000-0000-0000000000a1','prepago_basico', current_date, -1, 0, false, 0, '[]')$q$, 'check');
  perform pg_temp.espera_error($q$select public.fel_admin_plan_version_crear('00000000-0000-0000-0000-0000000000a1','prepago_basico', current_date, 0, 0, false, 5, '[]')$q$, 'check');      -- sobregiro sin permitirlo
  perform pg_temp.espera_error($q$select public.fel_admin_plan_version_crear('00000000-0000-0000-0000-0000000000a1','prepago_basico', current_date, 0, 0, false, 0, '[{"evento":"certificacion","precio":"-1","cargable":true}]')$q$, 'check');
  perform pg_temp.espera_error($q$select public.fel_admin_plan_version_crear('00000000-0000-0000-0000-0000000000a1','prepago_basico', current_date, 0, 0, false, 0, '[{"evento":"certificacion","precio":"2","cargable":false}]')$q$, 'check');     -- no cargable ⇒ precio 0
  perform pg_temp.espera_error($q$select public.fel_admin_plan_version_crear('00000000-0000-0000-0000-0000000000a1','prepago_basico', current_date, 0, 0, false, 0, '[{"evento":"inexistente","precio":"1","cargable":true}]')$q$, 'foreign key|violates');
  assert (select count(*) from public.plan_versiones) = 0, 'los intentos fallidos no dejaron versiones';
  v := public.fel_admin_plan_version_crear(a1, 'prepago_basico', current_date - 1, 0, 0, false, 0, tar);
  assert v.version = 1 and (select count(*) from public.tarifas where plan_version_id = v.id) = 4;
  v2 := public.fel_admin_plan_version_crear(a1, 'prepago_basico', current_date, 0, 0, true, 5, tar); assert v2.version = 2, 'versión 2';
  insert into t_pv values (v.id, v2.id);
  perform pg_temp.espera_error(format($q$update public.plan_versiones set cuota_fija = 1 where id = '%s'$q$, v.id), 'FEL_APPEND_ONLY');
  perform pg_temp.espera_error(format($q$update public.tarifas set precio_unitario = 0 where plan_version_id = '%s'$q$, v.id), 'FEL_APPEND_ONLY');
  perform pg_temp.espera_error(format($q$delete from public.plan_versiones where id = '%s'$q$, v.id), 'FEL_APPEND_ONLY');
  perform pg_temp.espera_error($q$delete from public.planes where codigo = 'prepago_basico'$q$, 'FEL_APPEND_ONLY');
  perform pg_temp.espera_error($q$update public.planes set modalidad = 'suscripcion' where codigo = 'prepago_basico'$q$, 'solo cambian el nombre');
  -- mensual y suscripción
  insert into t_pv2 values (
    (public.fel_admin_plan_version_crear(a1, 'mensual_basico', current_date - 1, 0, 0, false, 0, '[{"evento":"certificacion","precio":"1.333333","cargable":true},{"evento":"anulacion","precio":"0","cargable":false}]')).id,
    (public.fel_admin_plan_version_crear(a1, 'suscripcion_basica', current_date - 1, 100, 2, false, 0, '[{"evento":"certificacion","precio":"3","cargable":true}]')).id);
end $$;

-- ================= 3. contratos: asignación idempotente, cambio sin solapes, cuenta y monedero automáticos
do $$
declare a1 uuid := '00000000-0000-0000-0000-0000000000a1'; A uuid := '10000000-0000-0000-0000-00000000000a'; B uuid := '10000000-0000-0000-0000-00000000000b'; c public.contratos_plan;
begin
  perform pg_temp.espera_error(format($q$select public.fel_admin_contrato_asignar('%s','%s','%s', current_date - 1)$q$, '00000000-0000-0000-0000-0000000000c1', A, (select prepago1 from t_pv)), 'FEL_NO_AUTORIZADO');
  perform pg_temp.espera_error(format($q$select public.fel_admin_contrato_asignar('%s','99999999-0000-0000-0000-000000000000','%s', current_date - 1)$q$, a1, (select prepago1 from t_pv)), 'empresa no encontrada');
  perform pg_temp.espera_error(format($q$select public.fel_admin_contrato_asignar('%s','%s','99999999-0000-0000-0000-000000000000', current_date - 1)$q$, a1, A), 'versión de plan no encontrada');
  c := public.fel_admin_contrato_asignar(a1, A, (select prepago1 from t_pv), current_date - 1);
  assert c.hasta is null and (select count(*) from public.cuentas_comerciales where empresa_id = A) = 1 and (select count(*) from public.monedero_saldos where empresa_id = A) = 1, 'cuenta y monedero creados';
  assert (public.fel_admin_contrato_asignar(a1, A, (select prepago1 from t_pv), current_date - 1)).id = c.id, 'repetición idéntica: el mismo contrato';
  assert (select sobregiro from public.monedero_saldos where empresa_id = A) = 0, 'v1 no permite sobregiro';
  perform pg_temp.espera_error(format($q$select public.fel_admin_contrato_asignar('%s','%s','%s', current_date - 5)$q$, a1, A, (select prepago2 from t_pv)), 'después del vigente');
  -- cambio de versión: cierra el anterior sin huecos ni solapes y actualiza el sobregiro permitido
  perform public.fel_admin_contrato_asignar(a1, A, (select prepago2 from t_pv), current_date);
  assert (select count(*) from public.contratos_plan where empresa_id = A) = 2 and (select count(*) from public.contratos_plan where empresa_id = A and hasta is null) = 1, 'un solo contrato vigente';
  assert (select hasta from public.contratos_plan where id = c.id) = current_date, 'el anterior termina donde empieza el nuevo';
  assert (select sobregiro from public.monedero_saldos where empresa_id = A) = 5, 'el sobregiro lo fija el contrato (v2: 5)';
  perform pg_temp.espera_error(format($q$update public.contratos_plan set plan_version_id = '%s' where id = '%s'$q$, (select prepago1 from t_pv), c.id), 'solo puede cerrarse');
  perform pg_temp.espera_error(format($q$delete from public.contratos_plan where id = '%s'$q$, c.id), 'no se borra');
  perform pg_temp.espera_error(format($q$insert into public.contratos_plan (cuenta_comercial_id, empresa_id, plan_version_id, desde) select cuenta_comercial_id, empresa_id, plan_version_id, current_date - 3 from public.contratos_plan where id = '%s'$q$, c.id), 'solapa|duplicate|unique');
  -- empresa B: mensual; C: suscripción; D: sin plan (para probar FEL_SIN_PLAN) y E: prepago con cupo
  perform public.fel_admin_contrato_asignar(a1, B, (select mensual from t_pv2), current_date - 1);
  perform public.fel_admin_contrato_asignar(a1, '10000000-0000-0000-0000-00000000000c', (select suscripcion from t_pv2), current_date - 1);
  perform public.fel_admin_contrato_asignar(a1, '10000000-0000-0000-0000-00000000000e', (select prepago1 from t_pv), current_date - 1);
  -- ajustes de la cuenta: motivo obligatorio; cerrada es definitiva
  perform pg_temp.espera_error(format($q$select public.fel_admin_cuenta_comercial_ajustar('%s','%s','suspendida',null,'x')$q$, a1, A), 'motivo es obligatorio');
  perform pg_temp.espera_error(format($q$select public.fel_admin_cuenta_comercial_ajustar('%s','%s','suspendida',null,'Prueba de suspensión')$q$, '00000000-0000-0000-0000-0000000000c1', A), 'FEL_NO_AUTORIZADO');
  assert pg_temp.ok();
end $$;

-- ================= 4. pagos SIMULADOS: recarga exacta, idempotencia, nada de medios reales, saldo solo por libro
do $$
declare a1 uuid := '00000000-0000-0000-0000-0000000000a1'; A uuid := '10000000-0000-0000-0000-00000000000a'; p public.pagos; m text; cc uuid := (select id from public.cuentas_comerciales where empresa_id = '10000000-0000-0000-0000-00000000000a');
begin
  perform pg_temp.espera_error(format($q$select public.fel_admin_pago_simulado_registrar('%s','%s',10,'PAGO-1','clave-pago-0000001')$q$, '00000000-0000-0000-0000-0000000000c1', A), 'FEL_NO_AUTORIZADO');
  perform pg_temp.espera_error(format($q$select public.fel_admin_pago_simulado_registrar('%s','%s',0,'PAGO-1','clave-pago-0000001')$q$, a1, A), 'check');
  perform pg_temp.espera_error(format($q$select public.fel_admin_pago_simulado_registrar('%s','%s',-5,'PAGO-1','clave-pago-0000001')$q$, a1, A), 'check');
  perform pg_temp.espera_error(format($q$select public.fel_admin_pago_simulado_registrar('%s','%s',10,'PAGO-1','corta')$q$, a1, A), 'check');
  perform pg_temp.espera_error(format($q$select public.fel_admin_pago_simulado_registrar('%s','10000000-0000-0000-0000-00000000000d',10,'PAGO-1','clave-pago-0000001')$q$, a1), 'no tiene cuenta comercial');
  p := public.fel_admin_pago_simulado_registrar(a1, A, 10, 'PAGO-1', 'clave-pago-0000001'); assert p.medio = 'simulado' and p.estado = 'confirmado' and p.monto = 10;
  assert (select recargado from public.monedero_saldos where empresa_id = A) = 10 and (select count(*) from public.monedero_movimientos where pago_id = p.id and tipo = 'recarga' and monto = 10) = 1, 'la recarga está en el libro';
  assert (public.fel_admin_pago_simulado_registrar(a1, A, 10, 'PAGO-1', 'clave-pago-0000001')).id = p.id and (select recargado from public.monedero_saldos where empresa_id = A) = 10, 'repetición idéntica sin efectos';
  perform pg_temp.espera_error(format($q$select public.fel_admin_pago_simulado_registrar('%s','%s',11,'PAGO-1','clave-pago-0000001')$q$, a1, A), 'FEL_IDEMPOTENCIA');
  perform pg_temp.espera_error(format($q$select public.fel_admin_pago_simulado_registrar('%s','%s',10,'PAGO-1','clave-pago-0000002')$q$, a1, A), 'unique|duplicate');    -- misma referencia, otra clave
  -- NINGÚN medio real
  foreach m in array array['tarjeta','transferencia','paypal','stripe',''] loop
    perform pg_temp.espera_error(format($q$insert into public.pagos (cuenta_comercial_id, empresa_id, monto, medio, referencia_pago, clave_idempotencia) values ('%s','%s',1,'%s','R-%s','clave-medio-0000000001')$q$, cc, A, m, m), 'check|violates');
  end loop;
  -- decimales exactos
  perform public.fel_admin_pago_simulado_registrar(a1, A, 0.1, 'PAGO-D1', 'clave-pago-decimal-1'); perform public.fel_admin_pago_simulado_registrar(a1, A, 0.2, 'PAGO-D2', 'clave-pago-decimal-2');
  assert (select recargado from public.monedero_saldos where empresa_id = A) = 10.3, '10 + 0,1 + 0,2 = 10,3 exacto';
  -- el saldo solo cambia por el libro
  perform pg_temp.espera_error(format($q$update public.monedero_saldos set recargado = 999 where empresa_id = '%s'$q$, A), 'solo cambia por movimientos');
  perform pg_temp.espera_error(format($q$update public.monedero_saldos set sobregiro = 999 where empresa_id = '%s'$q$, A), 'solo cambia por movimientos');
  perform pg_temp.espera_error(format($q$delete from public.monedero_saldos where empresa_id = '%s'$q$, A), 'no se borran');
  perform pg_temp.espera_error($q$update public.monedero_movimientos set monto = 1$q$, 'FEL_APPEND_ONLY');
  perform pg_temp.espera_error($q$delete from public.monedero_movimientos$q$, 'FEL_APPEND_ONLY');
  perform pg_temp.espera_error(format($q$update public.pagos set monto = 1 where id = '%s'$q$, p.id) , 'solo cambia el estado');
  assert pg_temp.ok();
end $$;

-- ================= 5. cobertura PREPAGO (empresa E: sin sobregiro): reserva atómica bolsón + monedero, sin saldo, confirmar, política de cargos, liberar
do $$
declare a1 uuid := '00000000-0000-0000-0000-0000000000a1'; E uuid := '10000000-0000-0000-0000-00000000000e'; sim uuid := current_setting('fel.sim')::uuid;
        op1 uuid; op2 uuid; op3 uuid; op4 uuid; opA uuid; c1 public.consumos; c2 public.consumos; c4 public.consumos; cA public.consumos; n_cons int; n_mov int; bres numeric; cc uuid; carg public.cargos; n_carg int;
begin
  perform public.fel_admin_pago_simulado_registrar(a1, E, 5, 'PAGO-E1', 'clave-pago-e-0000001'); cc := (select id from public.cuentas_comerciales where empresa_id = E);
  assert pg_temp.disponible(E) = 5;
  op1 := pg_temp.nueva_op(E); c1 := pg_temp.cob(E, 'certificacion', op1, 'k-e-1');
  assert c1.estado = 'reservado' and c1.unidades_reservadas = 1, 'bolsón reservado';
  assert pg_temp.disponible(E) = 2.5 and (select count(*) from public.monedero_movimientos where consumo_id = c1.id and tipo = 'reserva' and monto = 2.5) = 1, 'monedero retiene 2,5 (tarifa 2,5 × 1 unidad)';
  select count(*) into n_mov from public.monedero_movimientos;
  assert (pg_temp.cob(E, 'certificacion', op1, 'k-e-1')).id = c1.id and (select count(*) from public.monedero_movimientos) = n_mov and pg_temp.disponible(E) = 2.5, 'la repetición no retiene dos veces';
  op2 := pg_temp.nueva_op(E); c2 := pg_temp.cob(E, 'certificacion', op2, 'k-e-2'); assert pg_temp.disponible(E) = 0;
  -- sin saldo: no se reserva NADA (ni bolsón ni monedero)
  op3 := pg_temp.nueva_op(E); select count(*) into n_cons from public.consumos; select reservado into bres from public.bolson_saldos where cuenta_id = sim; select count(*) into n_mov from public.monedero_movimientos;
  perform pg_temp.espera_error(format($q$select pg_temp.cob('%s','certificacion','%s','k-e-3')$q$, E, op3), 'FEL_SIN_SALDO');
  assert (select count(*) from public.consumos) = n_cons and (select reservado from public.bolson_saldos where cuenta_id = sim) = bres and (select count(*) from public.monedero_movimientos) = n_mov, 'sin saldo no deja rastro';
  -- confirmar: solo con el resultado fiscal confirmado; el cargo copia la tarifa y liquida lo retenido
  perform pg_temp.espera_error(format($q$select public.fel_sys_cobertura_confirmar('%s','%s')$q$, E, c1.id), 'FEL_INCIERTO');
  assert (select estado from public.consumos where id = c1.id) = 'reservado' and pg_temp.disponible(E) = 0, 'nada cambió';
  perform pg_temp.cerrar_op(op1, 'confirmada_exitosa'); perform public.fel_sys_cobertura_confirmar(E, c1.id, null, 'AUT-E-1', '{"x":1}');
  select * into carg from public.cargos where consumo_id = c1.id;
  assert carg.monto = 2.5 and carg.cantidad = 1 and carg.precio_unitario = 2.5 and carg.concepto = 'evento' and carg.naturaleza = 'cargo' and carg.estado = 'pendiente' and carg.periodo = public.fel__periodo(clock_timestamp()), 'cargo exacto con tarifa copiada';
  assert carg.plan_version_id = (select prepago1 from t_pv), 'versión del plan vigente al reservar';
  assert (select consumido from public.monedero_saldos where empresa_id = E) = 2.5 and (select reservado from public.monedero_saldos where empresa_id = E) = 2.5, 'consumo 2,5; sigue retenido lo de la operación 2';
  select count(*) into n_carg from public.cargos; select count(*) into n_mov from public.monedero_movimientos;
  perform public.fel_sys_cobertura_confirmar(E, c1.id);
  assert (select count(*) from public.cargos) = n_carg and (select count(*) from public.monedero_movimientos) = n_mov, 'confirmar dos veces no cobra dos veces';
  -- POLÍTICA: un rechazo confirmado NO se cobra aunque el proveedor haya consumido unidades (separación proveedor / cliente)
  perform pg_temp.cerrar_op(op2, 'confirmada_fallida'); perform public.fel_sys_cobertura_confirmar(E, c2.id, 1, 'REF-RECHAZO', '{"proveedor":"consumió al rechazar"}');
  assert (select estado from public.consumos where id = c2.id) = 'confirmado' and (select unidades_consumidas from public.consumos where id = c2.id) = 1, 'el proveedor consumió 1 unidad';
  assert not exists (select 1 from public.cargos where consumo_id = c2.id), 'pero NO se cobra al cliente';
  assert pg_temp.disponible(E) = 2.5, 'lo retenido vuelve al monedero';
  -- liberar: libera bolsón y monedero, sin cargo
  op4 := pg_temp.nueva_op(E); c4 := pg_temp.cob(E, 'certificacion', op4, 'k-e-4'); assert pg_temp.disponible(E) = 0;
  perform pg_temp.espera_error(format($q$select public.fel_sys_cobertura_liberar('%s','%s','proveedor_confirma_sin_consumo','{"x":1}')$q$, E, c4.id), 'FEL_INCIERTO');   -- operación abierta: no se libera
  assert pg_temp.disponible(E) = 0, 'sigue retenido';
  perform pg_temp.cerrar_op(op4, 'confirmada_fallida'); perform public.fel_sys_cobertura_liberar(E, c4.id, 'proveedor_confirma_sin_consumo', '{"x":1}');
  assert pg_temp.disponible(E) = 2.5 and not exists (select 1 from public.cargos where consumo_id = c4.id) and (select estado from public.consumos where id = c4.id) = 'liberado';
  -- anulación: tarifa NO cargable ⇒ no se cobra (hasta confirmación escrita) y no retiene monedero
  opA := pg_temp.nueva_op(E, 'anulacion'); cA := pg_temp.cob(E, 'anulacion', opA, 'k-e-anu'); assert pg_temp.disponible(E) = 2.5, 'la anulación no retiene monedero';
  perform pg_temp.cerrar_op(opA, 'confirmada_exitosa'); perform public.fel_sys_cobertura_confirmar(E, cA.id);
  assert not exists (select 1 from public.cargos where consumo_id = cA.id), 'la anulación no se traslada al cliente';
  assert pg_temp.ok(), 'bolsón y monedero reproducen su libro';
  -- un cargo por evento NO puede nacer de un consumo no confirmado (ni por inserción directa)
  perform pg_temp.espera_error(format($q$insert into public.cargos (cuenta_comercial_id, empresa_id, concepto, consumo_id, plan_version_id, cantidad, precio_unitario, monto, periodo, clave_idempotencia) values ('%s','%s','evento','%s','%s',1,1,1,current_date,'cargo-directo-0000000001')$q$, cc, E, c4.id, (select prepago1 from t_pv)), 'consumo confirmado|FEL_REGLA');   -- c4 está liberado
  perform pg_temp.espera_error(format($q$insert into public.cargos (cuenta_comercial_id, empresa_id, concepto, plan_version_id, cantidad, precio_unitario, monto, periodo, clave_idempotencia) values ('%s','%s','evento','%s',1,1,1,current_date,'cargo-directo-0000000002')$q$, cc, E, (select prepago1 from t_pv)), 'consumo confirmado|FEL_REGLA');
  perform pg_temp.espera_error(format($q$update public.cargos set monto = 0 where consumo_id = '%s'$q$, c1.id), 'solo puede asignarse a un cobro');
  perform pg_temp.espera_error(format($q$delete from public.cargos where consumo_id = '%s'$q$, c1.id), 'no se borra');
  perform pg_temp.espera_error(format($q$insert into public.cargos (cuenta_comercial_id, empresa_id, concepto, consumo_id, plan_version_id, cantidad, precio_unitario, monto, periodo, clave_idempotencia) values ('%s','%s','evento','%s','%s',1,1,1,current_date,'cargo-duplicado-000000001')$q$, cc, E, c1.id, (select prepago1 from t_pv)), 'unique|duplicate');   -- un cargo por consumo
  -- separación: una corrección del lado del proveedor (ajuste del bolsón) NO modifica ningún cargo
  select count(*), coalesce(sum(monto), 0) into n_carg, bres from public.cargos;
  insert into public.bolson_movimientos (cuenta_id, tipo, unidades, sentido, motivo) values (sim, 'ajuste', 3, -1, 'corrección del proveedor (prueba)');
  assert (select count(*) from public.cargos) = n_carg and (select coalesce(sum(monto), 0) from public.cargos) = bres, 'los cargos no cambian por un ajuste del bolsón';
end $$;

-- ================= 6. sin plan, cuenta suspendida y cupo mensual (nada se reserva)
do $$
declare a1 uuid := '00000000-0000-0000-0000-0000000000a1'; D uuid := '10000000-0000-0000-0000-00000000000d'; A uuid := '10000000-0000-0000-0000-00000000000a'; sim uuid := current_setting('fel.sim')::uuid; n_cons int; n_mov int; opx uuid;
begin
  select count(*) into n_cons from public.consumos; select count(*) into n_mov from public.bolson_movimientos;
  perform pg_temp.espera_error(format($q$select pg_temp.cob('%s','consulta',null,'k-d-0')$q$, D), 'FEL_SIN_PLAN');
  perform public.fel_admin_cuenta_comercial_ajustar(a1, A, 'suspendida', null, 'Prueba de suspensión'); perform pg_temp.espera_error(format($q$select pg_temp.cob('%s','consulta',null,'k-a-susp')$q$, A), 'no está activa');
  perform public.fel_admin_cuenta_comercial_ajustar(a1, A, 'activa', null, 'Reactivación de prueba');
  assert (select count(*) from public.consumos) = n_cons and (select count(*) from public.bolson_movimientos) = n_mov, 'sin plan o suspendida no deja rastro';
  -- cupo mensual de 1 unidad (prepago con saldo): la primera pasa, la segunda no
  perform public.fel_admin_contrato_asignar(a1, D, (select prepago1 from t_pv), current_date - 1); perform public.fel_admin_pago_simulado_registrar(a1, D, 100, 'PAGO-D', 'clave-pago-d-0000001');
  perform public.fel_admin_cuenta_comercial_ajustar(a1, D, 'activa', 1, 'Cupo mensual de prueba');
  opx := pg_temp.nueva_op(D); perform pg_temp.cob(D, 'certificacion', opx, 'k-d-1');
  perform pg_temp.espera_error(format($q$select pg_temp.cob('%s','certificacion','%s','k-d-2')$q$, D, pg_temp.nueva_op(D)), 'FEL_CUPO_EXCEDIDO');
  perform public.fel_admin_cuenta_comercial_ajustar(a1, D, 'activa', null, 'Sin cupo de prueba'); perform pg_temp.cob(D, 'certificacion', pg_temp.nueva_op(D), 'k-d-3');   -- sin cupo vuelve a pasar
  assert pg_temp.ok();
end $$;

-- ================= 7. CONSUMO MENSUAL (empresa B): sin monedero; cargos pendientes exactos; cobro por periodo sin impuestos
do $$
declare a1 uuid := '00000000-0000-0000-0000-0000000000a1'; B uuid := '10000000-0000-0000-0000-00000000000b'; op uuid; c public.consumos; i int; cobro public.cobros; per date := public.fel__periodo(clock_timestamp()); n int;
begin
  for i in 1..3 loop
    op := pg_temp.nueva_op(B); c := pg_temp.cob(B, 'certificacion', op, 'k-b-' || i);
    assert not exists (select 1 from public.monedero_movimientos where consumo_id = c.id), 'consumo mensual: sin monedero';
    perform pg_temp.cerrar_op(op, 'confirmada_exitosa'); perform public.fel_sys_cobertura_confirmar(B, c.id);
  end loop;
  assert (select count(*) from public.cargos where empresa_id = B) = 3 and (select sum(monto) from public.cargos where empresa_id = B) = 3.999999, '3 × 1,333333 = 3,999999 exacto';
  assert (select count(*) from public.cargos where empresa_id = B and estado = 'pendiente') = 3;
  perform pg_temp.espera_error(format($q$select public.fel_admin_cobro_generar('%s','%s', current_date)$q$, '00000000-0000-0000-0000-0000000000c1', B), 'FEL_NO_AUTORIZADO');
  perform pg_temp.espera_error(format($q$select public.fel_admin_cobro_generar('%s','10000000-0000-0000-0000-00000000000d', current_date)$q$, a1), 'no hay cargos pendientes|FEL_SIN_PLAN');
  cobro := public.fel_admin_cobro_generar(a1, B, current_date);
  assert cobro.estado = 'borrador' and cobro.monto_neto = 3.999999 and cobro.periodo = per and cobro.referencia_documento is null and cobro.monto_total_documento is null, 'cobro borrador: monto neto, sin impuestos ni referencia';
  assert (select count(*) from public.cargos where cobro_id = cobro.id and estado = 'incluido_en_cobro') = 3, 'los tres cargos quedan asignados';
  assert (public.fel_admin_cobro_generar(a1, B, current_date)).id = cobro.id, 'repetir no crea otro cobro';
  perform pg_temp.espera_error(format($q$select public.fel_admin_cobro_emitir('%s','%s','xx',1)$q$, a1, cobro.id), 'referencia del documento');
  cobro := public.fel_admin_cobro_emitir(a1, cobro.id, 'DOC-EXTERNO-0001', 4.47);
  assert cobro.estado = 'emitido' and cobro.referencia_documento = 'DOC-EXTERNO-0001' and cobro.monto_total_documento = 4.47 and cobro.monto_neto = 3.999999, 'NEXA no calcula impuestos: guarda la referencia y el total tal como figura en el documento externo';
  assert (public.fel_admin_cobro_emitir(a1, cobro.id, 'DOC-EXTERNO-0001', 4.47)).id = cobro.id, 'repetición idéntica';
  perform pg_temp.espera_error(format($q$select public.fel_admin_cobro_emitir('%s','%s','OTRO-DOC',1)$q$, a1, cobro.id), 'FEL_ESTADO');
  perform pg_temp.espera_error(format($q$update public.cobros set monto_neto = 1 where id = '%s'$q$, cobro.id), 'solo avanza');
  perform pg_temp.espera_error(format($q$update public.cargos set estado = 'pendiente', cobro_id = null where empresa_id = '%s'$q$, B), 'solo puede asignarse');
  perform pg_temp.espera_error(format($q$delete from public.cobros where id = '%s'$q$, cobro.id), 'no se borra');
  assert pg_temp.ok();
end $$;

-- ================= 8. SUSCRIPCIÓN (empresa C): las unidades incluidas no se cobran; el resto, a la tarifa
do $$
declare C uuid := '10000000-0000-0000-0000-00000000000c'; op uuid; cx public.consumos; i int;
begin
  for i in 1..4 loop
    op := pg_temp.nueva_op(C); cx := pg_temp.cob(C, 'certificacion', op, 'k-c-' || i); perform pg_temp.cerrar_op(op, 'confirmada_exitosa'); perform public.fel_sys_cobertura_confirmar(C, cx.id);
  end loop;
  assert (select count(*) from public.cargos where empresa_id = C) = 2 and (select sum(monto) from public.cargos where empresa_id = C) = 6, 'las 2 primeras están incluidas; la 3.ª y la 4.ª cuestan 3 cada una';
  assert (select count(*) from public.consumos where empresa_id = C and estado = 'confirmado') = 4, 'las cuatro consumieron bolsón';
  assert pg_temp.ok();
end $$;

-- ================= 9. permisos y aislamiento con RLS real
do $$ begin
  assert (select count(*) from public.rol_permisos where permiso in ('consumo.ver','facturacion.ver') and rol in ('propietario','administrador')) = 4, 'propietario y administrador ven consumo y facturación';
  assert (select count(*) from public.rol_permisos where permiso in ('consumo.ver','facturacion.ver') and rol in ('emisor','lector')) = 0, 'emisor y lector no ven información comercial';
end $$;
do $$ declare t text; begin
  foreach t in array array['planes','plan_versiones','tarifas','cuentas_comerciales','contratos_plan','monedero_saldos','monedero_movimientos','pagos','cargos','cobros'] loop
    assert not has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'), 'anon con permisos en ' || t;
    assert not has_table_privilege('authenticated', 'public.' || t, 'INSERT,UPDATE,DELETE,TRUNCATE'), 'authenticated escribe en ' || t;
    assert not has_table_privilege('service_role', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'), 'service_role con acceso directo a ' || t;
    assert (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass), 'sin RLS: ' || t;
  end loop;
  for t in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
            and (p.proname like 'fel\_admin\_plan%' or p.proname in ('fel_admin_contrato_asignar','fel_admin_cuenta_comercial_ajustar','fel_admin_pago_simulado_registrar','fel_admin_cobro_generar','fel_admin_cobro_emitir','fel_sys_cobertura_reservar','fel_sys_cobertura_confirmar','fel_sys_cobertura_liberar','fel_sys_verificar_monederos')) loop
    assert not has_function_privilege('anon', t, 'EXECUTE') and not has_function_privilege('authenticated', t, 'EXECUTE'), 'ejecutable por usuarios: ' || t;
    assert has_function_privilege('service_role', t, 'EXECUTE'), 'service_role no ejecuta ' || t;
  end loop;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true) as _cfg \gset
do $$ declare A uuid := '10000000-0000-0000-0000-00000000000a'; begin   -- propietario de A
  assert (select count(*) from public.cuentas_comerciales) = 1 and (select empresa_id from public.cuentas_comerciales) = A, 'A ve solo su cuenta';
  assert (select count(*) from public.contratos_plan) = 2 and (select count(*) from public.monedero_saldos where empresa_id = A) = 1 and (select count(*) from public.pagos) >= 3 and (select count(*) from public.monedero_movimientos) >= 3, 'A ve su contrato, monedero y pagos';
  assert (select count(*) from public.cargos where empresa_id <> A) = 0 and (select count(*) from public.pagos where empresa_id <> A) = 0 and (select count(*) from public.cobros where empresa_id <> A) = 0, 'A no ve lo de otras empresas';
  assert (select count(*) from public.planes) = 1 and (select codigo from public.planes) = 'prepago_basico', 'A ve solo el plan que tiene contratado';
  assert (select count(*) from public.plan_versiones) = 2 and (select count(*) from public.tarifas) = 8, 'y sus versiones y tarifas (las dos versiones contratadas)';
  assert (select count(*) from public.bolson_saldos) = 0 and (select count(*) from public.bolson_movimientos) = 0, 'nada del bolsón';
end $$;
do $$ begin
  begin insert into public.pagos (cuenta_comercial_id, empresa_id, monto, medio, referencia_pago, clave_idempotencia) values (gen_random_uuid(), gen_random_uuid(), 1, 'simulado', 'X', repeat('k', 20)); raise exception 'NO DEBIÓ PERMITIR'; exception when insufficient_privilege then null; end;
  begin update public.monedero_saldos set recargado = 1000; raise exception 'NO DEBIÓ PERMITIR'; exception when insufficient_privilege then null; end;
  begin delete from public.cargos; raise exception 'NO DEBIÓ PERMITIR'; exception when insufficient_privilege then null; end;
  begin perform public.fel_admin_pago_simulado_registrar('00000000-0000-0000-0000-0000000000c1', gen_random_uuid(), 1, 'X', repeat('k', 20)); raise exception 'NO DEBIÓ EJECUTAR'; exception when insufficient_privilege then null; end;
  begin perform public.fel_admin_contrato_asignar('00000000-0000-0000-0000-0000000000c1', gen_random_uuid(), gen_random_uuid(), current_date); raise exception 'NO DEBIÓ EJECUTAR'; exception when insufficient_privilege then null; end;
  begin perform public.fel_sys_cobertura_reservar(gen_random_uuid(), gen_random_uuid(), 'consulta', null, null, repeat('k', 20), repeat('b', 64)); raise exception 'NO DEBIÓ EJECUTAR'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true) as _cfg \gset
do $$ declare B uuid := '10000000-0000-0000-0000-00000000000b'; begin   -- propietario de B (consumo mensual)
  assert (select count(*) from public.cargos) = 3 and (select count(*) from public.cargos where empresa_id <> B) = 0 and (select count(*) from public.cobros where empresa_id = B) = 1, 'B ve sus 3 cargos y su cobro';
  assert (select count(*) from public.monedero_movimientos) = 0 and (select count(*) from public.pagos) = 0, 'B no tiene monedero ni pagos';
  assert (select count(*) from public.planes) = 1 and (select codigo from public.planes) = 'mensual_basico' and (select count(*) from public.tarifas) = 2, 'B ve solo su plan';
end $$;
reset role;
-- lector y emisor de A (sin facturacion.ver) y usuario sin empresa: nada
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true) as _cfg \gset
do $$ begin assert (select count(*) from public.cuentas_comerciales) + (select count(*) from public.cargos) + (select count(*) from public.pagos) + (select count(*) from public.planes) + (select count(*) from public.tarifas) = 0, 'el lector no ve información comercial'; end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}', true) as _cfg \gset
do $$ begin assert (select count(*) from public.cuentas_comerciales) + (select count(*) from public.monedero_saldos) + (select count(*) from public.cobros) + (select count(*) from public.plan_versiones) = 0, 'el emisor no ve información comercial'; end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true) as _cfg \gset
do $$ begin assert (select count(*) from public.cuentas_comerciales) + (select count(*) from public.planes) + (select count(*) from public.pagos) = 0, 'sin empresa: nada'; end $$;
reset role;
set local role anon;
do $$ begin begin perform count(*) from public.cargos; raise exception 'NO DEBIÓ PERMITIR'; exception when insufficient_privilege then null; end; end $$;
reset role;
set local role service_role;
do $$ begin
  begin perform count(*) from public.monedero_saldos; raise exception 'NO DEBIÓ PERMITIR'; exception when insufficient_privilege then null; end;
  begin insert into public.cargos (cuenta_comercial_id, empresa_id, concepto, plan_version_id, cantidad, precio_unitario, monto, periodo, clave_idempotencia) values (gen_random_uuid(), gen_random_uuid(), 'ajuste', gen_random_uuid(), 1, 1, 1, current_date, repeat('k', 20)); raise exception 'NO DEBIÓ PERMITIR'; exception when insufficient_privilege then null; end;
  perform public.fel_sys_verificar_monederos();
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}', true) as _cfg \gset
do $$ begin assert (select count(*) from public.cargos) + (select count(*) from public.planes) + (select count(*) from public.monedero_movimientos) = 0, 'el maestro sin MFA no ve nada'; end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true) as _cfg \gset
do $$ begin
  assert (select count(*) from public.cuentas_comerciales) >= 5 and (select count(*) from public.planes) = 3 and (select count(*) from public.cargos) = 6 and (select count(*) from public.pagos) = 5, 'el maestro con MFA ve todo';
end $$;
reset role;

-- ================= 10. verificación final
do $$ begin
  assert pg_temp.ok(), 'bolsón y monederos reproducen su libro';
  assert (select count(*) from public.fel_sys_verificar_monederos()) = 5 * (select count(*) from public.monedero_saldos), 'cinco comprobaciones por monedero';
  assert not exists (select 1 from public.monedero_saldos where recargado + ajustado - consumido - reservado - reembolsado + sobregiro < 0), 'ningún monedero por debajo de su límite';
  assert not exists (select 1 from public.cargos c where c.concepto = 'evento' and not exists (select 1 from public.consumos x where x.id = c.consumo_id and x.estado = 'confirmado')), 'todo cargo nace de un consumo confirmado';
  assert (select coalesce(sum(m.monto), 0) from public.monedero_movimientos m where m.tipo = 'consumo') = (select coalesce(sum(c.monto), 0) from public.cargos c where c.naturaleza = 'cargo' and exists (select 1 from public.monedero_movimientos m where m.consumo_id = c.consumo_id and m.tipo = 'consumo')), 'lo consumido del monedero = suma de los cargos de empresas con monedero';
end $$;
rollback;
\echo OK 21_comercial
