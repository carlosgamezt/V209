-- D3-2 · fel_sys_bolson_cuenta_simulada y fel_sys_cobertura_cerrar (cierre de cobertura según el resultado de la operación).
\set ON_ERROR_STOP on
begin;
create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_ok boolean := false;
begin begin execute p_sql; exception when others then v_ok := (sqlerrm ~ p_patron) or (sqlstate ~ p_patron); end;
  if not v_ok then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if; end $$;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'maestro@fel.test');
insert into public.perfiles (user_id) select id from auth.users on conflict (user_id) do nothing;
insert into public.plataforma_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1');
insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id, estado)
select '10000000-0000-0000-0000-00000000000a', 'Empresa A', 'Empresa A S.A.', '1111111-1', r.id, 'habilitada' from public.regimenes_fiscales r where r.codigo = 'general';
create temp table t_n (n int not null); insert into t_n values (0);
create or replace function pg_temp.nueva_op(p_emp uuid, p_tipo text default 'certificacion') returns uuid language plpgsql as $$ declare v uuid; d uuid; begin
  update t_n set n = n + 1; insert into public.documentos (empresa_id, numero_borrador) values (p_emp, (select n from t_n) + 2000) returning id into d;
  insert into public.operaciones_fiscales (empresa_id, documento_id, tipo, clave_idempotencia, hash_contenido, proveedor, ambiente) values (p_emp, d, p_tipo, 'op-' || gen_random_uuid(), repeat('a', 64), 'digifact', 'simulado') returning id into v; return v; end $$;
do $$
declare a1 uuid := '00000000-0000-0000-0000-0000000000a1'; A uuid := '10000000-0000-0000-0000-00000000000a'; cta uuid; v public.plan_versiones; op uuid; op2 uuid; c public.consumos; n int;
  tar jsonb := '[{"evento":"certificacion","precio":"2.5","cargable":true},{"evento":"anulacion","precio":"0","cargable":false}]';
begin
  assert public.fel_sys_bolson_cuenta_simulada('digifact') is null, 'sin cuenta todavía';
  cta := (public.fel_admin_bolson_cuenta_crear(a1, 'digifact', 'simulado', 'SIM-ORQ')).id;
  assert public.fel_sys_bolson_cuenta_simulada('digifact') = cta and public.fel_sys_bolson_cuenta_simulada() = cta, 'devuelve la cuenta simulada';
  assert public.fel_sys_bolson_cuenta_simulada('portal_playwright') is null;
  perform public.fel_admin_bolson_lote_registrar(a1, cta, 100, 0, 'LOTE-ORQ');
  perform public.fel_admin_plan_crear(a1, 'prepago_orq', 'Prepago', 'prepago'); v := public.fel_admin_plan_version_crear(a1, 'prepago_orq', current_date - 1, 0, 0, false, 0, tar);
  perform public.fel_admin_contrato_asignar(a1, A, v.id, current_date - 1); perform public.fel_admin_pago_simulado_registrar(a1, A, 10, 'PAGO-ORQ', 'clave-pago-orq-00001');
  -- iniciada: reservar y cerrar no cambia nada
  op := pg_temp.nueva_op(A); c := public.fel_sys_cobertura_reservar(A, cta, 'certificacion', op, null, 'cert-orq-0000000001', repeat('b', 64));
  assert c.estado = 'reservado'; c := public.fel_sys_cobertura_cerrar(A, op); assert c.estado = 'reservado' and c.id is not null, 'operación abierta: sigue reservado';
  update public.operaciones_fiscales set estado = 'desconocida', motivo_desconocido = 'timeout' where id = op; c := public.fel_sys_cobertura_cerrar(A, op); assert c.estado = 'reservado', 'desconocida: sigue reservado';
  -- exitosa: confirma y cobra; repetir no cobra dos veces
  update public.operaciones_fiscales set estado = 'confirmada_exitosa', resolucion = 'proveedor', resuelta_en = clock_timestamp() where id = op;
  c := public.fel_sys_cobertura_cerrar(A, op); assert c.estado = 'confirmado' and c.unidades_consumidas = 1;
  assert (select count(*) from public.cargos where consumo_id = c.id) = 1 and (select monto from public.cargos where consumo_id = c.id) = 2.5;
  select count(*) into n from public.cargos; perform public.fel_sys_cobertura_cerrar(A, op); assert (select count(*) from public.cargos) = n, 'idempotente';
  -- rechazo confirmado: el consumo se confirma (prudencia) pero NO se cobra
  op2 := pg_temp.nueva_op(A); perform public.fel_sys_cobertura_reservar(A, cta, 'certificacion', op2, null, 'cert-orq-0000000002', repeat('b', 64));
  update public.operaciones_fiscales set estado = 'confirmada_fallida', resolucion = 'proveedor', resuelta_en = clock_timestamp() where id = op2;
  c := public.fel_sys_cobertura_cerrar(A, op2); assert c.estado = 'confirmado'; assert not exists (select 1 from public.cargos where consumo_id = c.id), 'rechazo no se cobra';
  -- operación sin consumo: null; operación de otra empresa: error
  assert public.fel_sys_cobertura_cerrar(A, pg_temp.nueva_op(A)) is null;
  perform pg_temp.espera_error(format($q$select public.fel_sys_cobertura_cerrar('10000000-0000-0000-0000-0000000000ff','%s')$q$, op), 'FEL_NO_ENCONTRADO');
  assert not exists (select 1 from public.fel_sys_verificar_saldos() where not ok) and not exists (select 1 from public.fel_sys_verificar_monederos() where not ok);
  assert not has_function_privilege('authenticated', 'public.fel_sys_cobertura_cerrar(uuid,uuid)', 'EXECUTE') and not has_function_privilege('anon', 'public.fel_sys_bolson_cuenta_simulada(text)', 'EXECUTE')
     and has_function_privilege('service_role', 'public.fel_sys_cobertura_cerrar(uuid,uuid)', 'EXECUTE');
end $$;
rollback;
\echo OK 22_cobertura_orquestacion
