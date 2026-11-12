-- D2-4 · conciliación del bolsón: extractos, partidas, aprobación por dos personas, ajustes auditables, aislamiento.
\set ON_ERROR_STOP on
begin;
create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_ok boolean := false;
begin begin execute p_sql; exception when others then v_ok := (sqlerrm ~ p_patron) or (sqlstate ~ p_patron); end;
  if not v_ok then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if; end $$;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1','m1@fel.test'), ('00000000-0000-0000-0000-0000000000a2','m2@fel.test'), ('00000000-0000-0000-0000-0000000000c1','propA@fel.test');
insert into public.perfiles (user_id) select id from auth.users on conflict (user_id) do nothing;
insert into public.plataforma_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000a2');
insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id, estado)
select e.id, e.n, e.n || ' S.A.', e.nit, r.id, 'habilitada' from (values ('10000000-0000-0000-0000-00000000000a'::uuid,'Empresa A','1111111-1'), ('10000000-0000-0000-0000-00000000000b'::uuid,'Empresa B','2222222-2')) e(id,n,nit), public.regimenes_fiscales r where r.codigo = 'general';
insert into public.miembros (empresa_id, user_id, rol) values ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000c1','propietario');
create temp table t_n (n int not null); insert into t_n values (0);
create or replace function pg_temp.nueva_op(p_emp uuid) returns uuid language plpgsql as $$ declare v uuid; d uuid; begin
  update t_n set n = n + 1; insert into public.documentos (empresa_id, numero_borrador) values (p_emp, (select n from t_n) + 3000) returning id into d;
  insert into public.operaciones_fiscales (empresa_id, documento_id, tipo, clave_idempotencia, hash_contenido, proveedor, ambiente) values (p_emp, d, 'certificacion', 'op-' || gen_random_uuid(), repeat('a', 64), 'digifact', 'simulado') returning id into v; return v; end $$;
-- consumo confirmado con una referencia del proveedor
create or replace function pg_temp.consumo(p_emp uuid, p_ref text) returns uuid language plpgsql as $$ declare op uuid := pg_temp.nueva_op(p_emp); c public.consumos; begin
  c := public.fel_sys_cobertura_reservar(p_emp, public.fel_sys_bolson_cuenta_simulada(), 'certificacion', op, null, rpad('cons-' || p_ref, 16, '_'), repeat('b', 64));
  update public.operaciones_fiscales set estado = 'confirmada_exitosa', resolucion = 'proveedor', resuelta_en = clock_timestamp() where id = op;
  c := public.fel_sys_cobertura_confirmar(p_emp, c.id, null, p_ref, '{"x":1}'); return c.id; end $$;
create or replace function pg_temp.disp(c uuid) returns numeric language sql as $$ select comprado + ajustado - consumido - reservado from public.bolson_saldos where cuenta_id = c $$;
create temp table t_ids (x uuid, c1 uuid, c2 uuid, c3 uuid);

do $$
declare m1 uuid := '00000000-0000-0000-0000-0000000000a1'; m2 uuid := '00000000-0000-0000-0000-0000000000a2'; A uuid := '10000000-0000-0000-0000-00000000000a'; B uuid := '10000000-0000-0000-0000-00000000000b';
        cta uuid; v public.plan_versiones; x public.bolson_extractos; x2 public.bolson_extractos; cn public.bolson_conciliaciones; cn2 public.bolson_conciliaciones; l jsonb; n int; r public.bolson_partida_resoluciones; pf uuid; pd uuid; ps uuid; pc uuid; d0 numeric;
begin
  cta := (public.fel_admin_bolson_cuenta_crear(m1, 'digifact', 'simulado', 'SIM-CONC')).id; perform public.fel_admin_bolson_lote_registrar(m1, cta, 100, 0, 'LOTE-CONC');
  perform public.fel_admin_plan_crear(m1, 'prepago_conc', 'Prepago', 'prepago'); v := public.fel_admin_plan_version_crear(m1, 'prepago_conc', current_date - 1, 0, 0, false, 0, '[{"evento":"certificacion","precio":"1","cargable":true}]');
  perform public.fel_admin_contrato_asignar(m1, A, v.id, current_date - 1); perform public.fel_admin_contrato_asignar(m1, B, v.id, current_date - 1);
  perform public.fel_admin_pago_simulado_registrar(m1, A, 50, 'PAGO-A', 'clave-pago-a-0000000001'); perform public.fel_admin_pago_simulado_registrar(m1, B, 50, 'PAGO-B', 'clave-pago-b-0000000001');
  insert into t_ids values (null, pg_temp.consumo(A, 'AUT-1'), pg_temp.consumo(A, 'AUT-2'), pg_temp.consumo(B, 'AUT-3'));
  d0 := pg_temp.disp(cta); assert d0 = 97;
  -- extracto: AUT-1 coincide; AUT-2 el proveedor cobró 2; AUT-9 NEXA no lo midió; AUT-3 no aparece (sobrante en NEXA)
  l := jsonb_build_array(jsonb_build_object('referencia','AUT-1','evento','CERTIFICACION','unidades','1','ocurrido_en', now()), jsonb_build_object('referencia','AUT-2','evento','CERTIFICACION','unidades','2','ocurrido_en', now()),
                         jsonb_build_object('referencia','AUT-9','evento','CERTIFICACION','unidades','1','ocurrido_en', now()));
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_extracto_importar('%s','%s',current_date,current_date,'api',0,0,'[]')$q$, '00000000-0000-0000-0000-0000000000c1', cta), 'FEL_NO_AUTORIZADO');
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_extracto_importar('%s','%s',current_date,current_date - 1,'api',0,0,'[]')$q$, m1, cta), 'periodo');
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_extracto_importar('%s','%s',current_date,current_date,'api',0,0,'[{"referencia":"X","evento":"E","unidades":"-1","ocurrido_en":"2026-01-01T00:00:00Z"}]')$q$, m1, cta), 'no válida');
  x := public.fel_admin_bolson_extracto_importar(m1, cta, current_date - 1, current_date, 'api', 100, 96, l);
  assert (select count(*) from public.bolson_extracto_lineas where extracto_id = x.id) = 3 and (public.fel_admin_bolson_extracto_importar(m1, cta, current_date - 1, current_date, 'api', 100, 96, l)).id = x.id, 'importar es idempotente';
  -- un extracto solapado no duplica líneas ya importadas
  x2 := public.fel_admin_bolson_extracto_importar(m1, cta, current_date - 1, current_date, 'api', 100, 96, l || jsonb_build_array(jsonb_build_object('referencia','AUT-NUEVO','evento','CERTIFICACION','unidades','1','ocurrido_en', now())));
  assert x2.id <> x.id and (select count(*) from public.bolson_extracto_lineas where extracto_id = x2.id) = 1 and (select count(*) from public.bolson_extracto_lineas where cuenta_id = cta) = 4, 'solo la línea nueva';
  perform pg_temp.espera_error(format($q$update public.bolson_extractos set saldo_final = 0 where id = '%s'$q$, x.id), 'FEL_APPEND_ONLY');
  -- proponer
  cn := public.fel_admin_bolson_conciliar_proponer(m1, x.id); assert cn.estado = 'propuesta' and (public.fel_admin_bolson_conciliar_proponer(m1, x.id)).id = cn.id, 'idempotente';
  assert (cn.resumen->>'coinciden')::int = 1 and (cn.resumen->>'faltantes_en_nexa')::int = 1 and (cn.resumen->>'sobrantes_en_nexa')::int = 1 and (cn.resumen->>'diferencias_unidades')::int = 1, 'clasificación: ' || cn.resumen::text;
  assert (cn.resumen->>'diferencia_neta')::numeric = 1 + 1 - 1, 'extracto 4 u. contra NEXA 3 u. (+1 +1 -1)';
  select id into pf from public.bolson_conciliacion_partidas where conciliacion_id = cn.id and clasificacion = 'faltante_en_nexa';
  select id into pd from public.bolson_conciliacion_partidas where conciliacion_id = cn.id and clasificacion = 'diferencia_unidades';
  select id into ps from public.bolson_conciliacion_partidas where conciliacion_id = cn.id and clasificacion = 'sobrante_en_nexa';
  select id into pc from public.bolson_conciliacion_partidas where conciliacion_id = cn.id and clasificacion = 'coincide';
  assert (select diferencia from public.bolson_conciliacion_partidas where id = pd) = 1 and (select empresa_id from public.bolson_conciliacion_partidas where id = ps) = B and (select referencia from public.bolson_conciliacion_partidas where id = ps) = 'AUT-3';
  assert exists (select 1 from public.bolson_alertas where cuenta_id = cta and tipo = 'diferencia_conciliacion' and resuelta_en is null), 'alerta de diferencia';
  assert pg_temp.disp(cta) = d0, 'proponer no cambia saldos';
  -- una línea no se concilia contra un consumo ya conciliado en otra propuesta vigente
  cn2 := public.fel_admin_bolson_conciliar_proponer(m1, x2.id); assert (cn2.resumen->>'sobrantes_en_nexa')::int = 0 and (cn2.resumen->>'faltantes_en_nexa')::int = 1, 'AUT-3 ya está en otra conciliación; AUT-NUEVO falta en NEXA';
  -- aprobación por OTRA persona
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_conciliar_decidir('%s','%s',true,'Revisado')$q$, m1, cn.id), 'otra persona');
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_conciliar_decidir('%s','%s',true,'x')$q$, m2, cn.id), 'nota');
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_partida_resolver('%s','%s','ajustar_saldo',null,'Antes de aprobar no se puede')$q$, m2, pd), 'FEL_ESTADO');
  cn := public.fel_admin_bolson_conciliar_decidir(m2, cn.id, true, 'Revisado contra el extracto'); assert cn.estado = 'aprobada' and cn.decidida_por = m2;
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_conciliar_decidir('%s','%s',false,'Cambio de opinión')$q$, m2, cn.id), 'FEL_ESTADO');
  perform pg_temp.espera_error(format($q$update public.bolson_conciliaciones set nota = 'otra' where id = '%s'$q$, cn.id), 'FEL_APPEND_ONLY');
  perform pg_temp.espera_error(format($q$update public.bolson_conciliacion_partidas set referencia = 'x' where id = '%s'$q$, pd), 'FEL_APPEND_ONLY');
  perform pg_temp.espera_error(format($q$delete from public.bolson_conciliacion_partidas where id = '%s'$q$, pd), 'FEL_APPEND_ONLY');
  -- resoluciones
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_partida_resolver('%s','%s','ajustar_saldo',null,'motivo largo suficiente')$q$, '00000000-0000-0000-0000-0000000000c1', pd), 'FEL_NO_AUTORIZADO');
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_partida_resolver('%s','%s','ajustar_saldo',null,'corto')$q$, m1, pd), 'motivo');
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_partida_resolver('%s','%s','justificar',null,'una partida que coincide no se resuelve')$q$, m1, pc), 'coincide');
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_partida_resolver('%s','%s','atribuir_empresa',null,'sin empresa no se puede atribuir')$q$, m1, pf), 'empresa');
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_partida_resolver('%s','%s','atribuir_empresa','%s','el sobrante no se atribuye a nadie')$q$, m1, ps, A), 'no midió');
  -- diferencia de unidades: el proveedor cobró 1 de más → el saldo de NEXA baja 1
  r := public.fel_admin_bolson_partida_resolver(m1, pd, 'ajustar_saldo', null, 'El proveedor cobró 2 unidades por AUT-2'); assert r.unidades = 1 and r.movimiento_id is not null and pg_temp.disp(cta) = d0 - 1;
  assert (select tipo || sentido::text || unidades::text from public.bolson_movimientos where id = r.movimiento_id) = 'ajuste-11.000000' and (select conciliacion_partida_id from public.bolson_movimientos where id = r.movimiento_id) = pd, 'movimiento ligado a la partida';
  assert (public.fel_admin_bolson_partida_resolver(m1, pd, 'ajustar_saldo', null, 'El proveedor cobró 2 unidades por AUT-2')).id = r.id and pg_temp.disp(cta) = d0 - 1, 'repetir no ajusta dos veces';
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_partida_resolver('%s','%s','justificar',null,'Cambiar de parecer no está permitido')$q$, m1, pd), 'FEL_CONFLICTO');
  -- consumo extraordinario: lo registró el proveedor y NEXA no lo midió → se atribuye a una empresa (movimiento con empresa)
  r := public.fel_admin_bolson_partida_resolver(m2, pf, 'atribuir_empresa', B, 'Consumo extraordinario de la empresa B informado por el proveedor'); assert pg_temp.disp(cta) = d0 - 2 and (select empresa_id from public.bolson_movimientos where id = r.movimiento_id) = B;
  -- sobrante en NEXA: el proveedor no lo cobró → NEXA devuelve la unidad a su saldo
  r := public.fel_admin_bolson_partida_resolver(m1, ps, 'ajustar_saldo', null, 'El proveedor no cobró AUT-3 (confirmado en su portal)'); assert pg_temp.disp(cta) = d0 - 1;
  perform pg_temp.espera_error(format($q$update public.bolson_partida_resoluciones set motivo = 'cambio no permitido de motivo' where id = '%s'$q$, r.id), 'FEL_APPEND_ONLY');
  assert not exists (select 1 from public.fel_sys_verificar_saldos() where not ok), 'el libro reproduce los saldos';
  -- justificar no mueve saldo
  select id into pf from public.bolson_conciliacion_partidas where conciliacion_id = cn2.id and clasificacion = 'faltante_en_nexa';
  cn2 := public.fel_admin_bolson_conciliar_decidir(m2, cn2.id, false, 'Extracto incompleto, se rechaza'); assert cn2.estado = 'rechazada';
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_partida_resolver('%s','%s','justificar',null,'Conciliación rechazada: no se resuelve')$q$, m1, pf), 'FEL_ESTADO');
  -- privilegios
  assert not has_function_privilege('authenticated', 'public.fel_admin_bolson_conciliar_decidir(uuid,uuid,boolean,text)', 'EXECUTE') and has_function_privilege('service_role', 'public.fel_admin_bolson_partida_resolver(uuid,uuid,text,uuid,text)', 'EXECUTE');
  assert not has_table_privilege('authenticated', 'public.bolson_conciliaciones', 'INSERT,UPDATE,DELETE') and not has_table_privilege('anon', 'public.bolson_conciliacion_partidas', 'SELECT') and not has_table_privilege('service_role', 'public.bolson_partida_resoluciones', 'SELECT,INSERT');
end $$;
-- aislamiento: ninguna empresa ve nada de la conciliación; el maestro con MFA sí
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true) as _c \gset
do $$ begin assert (select count(*) from public.bolson_conciliaciones) + (select count(*) from public.bolson_conciliacion_partidas) + (select count(*) from public.bolson_partida_resoluciones) + (select count(*) from public.bolson_extractos) = 0, 'la empresa no ve conciliaciones';
  begin insert into public.bolson_conciliaciones (cuenta_id, extracto_id, propuesta_por, resumen) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), '{}'); raise exception 'NO DEBIÓ'; exception when insufficient_privilege then null; end; end $$;
reset role; set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true) as _c \gset
do $$ begin assert (select count(*) from public.bolson_conciliaciones) = 2 and (select count(*) from public.bolson_conciliacion_partidas) = 5 and (select count(*) from public.bolson_partida_resoluciones) = 3, 'el maestro con MFA ve todo'; end $$;
reset role; set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}', true) as _c \gset
do $$ begin assert (select count(*) from public.bolson_conciliaciones) = 0, 'sin MFA no ve nada'; end $$;
reset role;
rollback;
\echo OK 23_bolson_conciliacion
