-- D2-2 · Consumos, libro de movimientos y alertas del bolsón: estructura = diseño, idempotencia estricta, validaciones, agotamiento, exactitud decimal,
-- confirmar / liberar / vigilar contra operaciones fiscales reales (nunca se libera con resultado incierto), libro como única vía de cambio de saldos,
-- separación entre consumo del proveedor y cobros comerciales, auditoría y aislamiento multiempresa (RLS real). Todo SIMULADO: sin proveedor real.
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_ok boolean := false;
begin
  begin execute p_sql; exception when others then v_ok := (sqlerrm ~ p_patron) or (sqlstate ~ p_patron); end;
  if not v_ok then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'maestro@fel.test'), ('00000000-0000-0000-0000-0000000000c1', 'propA@fel.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'lectorA@fel.test'), ('00000000-0000-0000-0000-0000000000c4', 'adminA@fel.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'propB@fel.test'),   ('00000000-0000-0000-0000-0000000000e1', 'sinempresa@fel.test');
insert into public.perfiles (user_id) select id from auth.users on conflict (user_id) do nothing;
insert into public.plataforma_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1');
insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id, estado)
select e.id, e.n, e.n || ' S.A.', e.nit, r.id, e.est
  from (values ('10000000-0000-0000-0000-00000000000a'::uuid, 'Empresa A', '1111111-1', 'habilitada'), ('10000000-0000-0000-0000-00000000000b'::uuid, 'Empresa B', '2222222-2', 'habilitada'),
               ('10000000-0000-0000-0000-00000000000c'::uuid, 'Empresa C', '3333333-3', 'pendiente')) e(id, n, nit, est),
       public.regimenes_fiscales r where r.codigo = 'general';
insert into public.miembros (empresa_id, user_id, rol, permisos_extra) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 'propietario', '{consumo.ver}'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c2', 'lector', '{}'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c4', 'administrador', '{}'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000d1', 'propietario', '{consumo.ver}');

-- ----------------------------------------------------------------- utilidades de la prueba
create temp table t_n (n int not null);  insert into t_n values (0);
create temp table t_id (k text primary key, v uuid not null);
create or replace function pg_temp.g(p_k text) returns uuid language sql as $$ select v from t_id where k = p_k $$;
create or replace function pg_temp.nuevo_doc(p_emp uuid) returns uuid language plpgsql as $$
declare v uuid; begin
  update t_n set n = n + 1;
  insert into public.documentos (empresa_id, numero_borrador) values (p_emp, (select n from t_n) + 1000) returning id into v; return v; end $$;
create or replace function pg_temp.nueva_op(p_emp uuid, p_tipo text default 'certificacion', p_amb text default 'pruebas', p_prov text default 'digifact') returns uuid language plpgsql as $$
declare v uuid; begin
  insert into public.operaciones_fiscales (empresa_id, documento_id, tipo, clave_idempotencia, hash_contenido, proveedor, ambiente)
  values (p_emp, pg_temp.nuevo_doc(p_emp), p_tipo, 'op-' || gen_random_uuid(), repeat('a', 64), p_prov, p_amb) returning id into v; return v; end $$;
create or replace function pg_temp.cerrar_op(p_op uuid, p_estado text, p_resolucion text default 'proveedor', p_reintento timestamptz default null, p_resuelta timestamptz default null) returns void language plpgsql as $$
begin
  if p_estado = 'desconocida' then update public.operaciones_fiscales set estado = 'desconocida', motivo_desconocido = 'prueba' where id = p_op;
  else update public.operaciones_fiscales set estado = p_estado, resolucion = p_resolucion, resuelta_en = coalesce(p_resuelta, clock_timestamp()), reintento_desde = p_reintento,
         evidencia = case when p_resolucion = 'conciliacion_manual' then '{"prueba":1}'::jsonb end,
         resuelta_por = case when p_resolucion = 'conciliacion_manual' then '00000000-0000-0000-0000-0000000000c1'::uuid end where id = p_op; end if;
end $$;
create or replace function pg_temp.sin_diferencias() returns boolean language sql as $$ select not exists (select 1 from public.fel_sys_verificar_saldos() where not ok) $$;
create or replace function pg_temp.res(p_emp uuid, p_cta uuid, p_ev text, p_op uuid, p_doc uuid, p_clave text, p_hash text default null) returns public.consumos language sql as $$
  select public.fel_sys_consumo_reservar(p_emp, p_cta, p_ev, p_op, p_doc, rpad(p_clave, 16, '_'), coalesce(p_hash, repeat('b', 64))) $$;

-- ================= 1. estructura = diseño aprobado (columnas, precisión, sin coma flotante, sin secretos, sin nada comercial)
do $$
declare t record;
begin
  for t in select * from (values
    ('consumos', array['clave_idempotencia','consumo_origen_id','cuenta_id','documento_id','empresa_id','en_vigilancia','estado','evento_tipo','evidencia','extracto_linea_id','hash_contenido','id','operacion_id','referencia_externa','regla_id','reservado_en','resuelto_en','resuelto_por','unidades_consumidas','unidades_reservadas']),
    ('bolson_movimientos', array['conciliacion_partida_id','consumo_id','creado_en','creado_por','cuenta_id','empresa_id','id','lote_id','motivo','sentido','tipo','unidades']),
    ('bolson_alertas', array['consumo_id','creada_en','cuenta_id','detalle','empresa_id','id','nota','resuelta_en','resuelta_por','tipo'])) v(tabla, columnas) loop
    assert (select array_agg(column_name::text order by column_name::text collate "C") from information_schema.columns where table_schema = 'public' and table_name = t.tabla) = t.columnas,
      'columnas distintas del diseño en ' || t.tabla;
  end loop;
  assert (select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('consumos','bolson_movimientos','bolson_alertas') and data_type in ('real','double precision')) = 0, 'hay columnas de coma flotante';
  assert (select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('consumos','bolson_movimientos') and column_name like 'unidades%'
          and not (data_type = 'numeric' and numeric_precision = 20 and numeric_scale = 6)) = 0, 'las unidades deben ser numeric(20,6)';
  assert (select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('consumos','bolson_movimientos','bolson_alertas')
          and column_name ~* '(password|contrase|token|secret|credencial|api_?key)') = 0, 'columnas de secretos';
  -- SEPARACIÓN: el consumo del proveedor no contiene ni referencia nada comercial
  assert (select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('consumos','bolson_movimientos','bolson_alertas')
          and column_name ~* '(precio|tarifa|monto|cargo|cobro|pago|monedero|plan|factur|importe|total|costo)') = 0, 'las tablas de consumo no pueden contener nada comercial';
  -- (D2-3) la capa comercial existe, pero las tablas de consumo del proveedor NO la referencian en ningún sentido (la referencia va de lo comercial hacia el consumo, nunca al revés)
  assert not exists (select 1 from pg_constraint c join pg_class tc on tc.oid = c.conrelid join pg_class rc on rc.oid = c.confrelid
                      where c.contype = 'f' and tc.relname in ('consumos','bolson_movimientos','bolson_alertas') and rc.relname ~* '(cargo|cobro|pago|monedero|tarifa|plan|contrato|cuenta_comercial)'), 'el consumo del proveedor no puede depender de lo comercial';
  assert (select count(*) from pg_constraint where conrelid = 'public.consumos'::regclass and contype = 'f') = 9, 'claves foráneas de consumos (cuenta, empresa, evento, regla, resuelto_por, extracto, y 3 compuestas)';
  assert (select count(*) from pg_constraint where conrelid = 'public.bolson_movimientos'::regclass and contype = 'f' and pg_get_constraintdef(oid) ~ '\(consumo_id, (cuenta_id|empresa_id)\)') = 2, 'FK compuestas del libro hacia consumos';
  assert exists (select 1 from pg_indexes where indexname = 'consumos_unico_por_operacion'), 'un consumo de certificación/anulación por operación';
  assert exists (select 1 from pg_constraint where conrelid = 'public.consumos'::regclass and contype = 'u' and pg_get_constraintdef(oid) = 'UNIQUE (empresa_id, clave_idempotencia)'), 'unicidad de la clave por empresa';
end $$;

-- ================= 2. preparación: cuentas, lote, reglas
select set_config('fel.cta', (public.fel_admin_bolson_cuenta_crear('00000000-0000-0000-0000-0000000000a1', 'digifact', 'pruebas', 'CTA-D22')).id::text, false) as _a \gset
select set_config('fel.ctm', (public.fel_admin_bolson_cuenta_crear('00000000-0000-0000-0000-0000000000a1', 'mock', 'pruebas', 'CTA-MOCK-D22')).id::text, false) as _b \gset
select set_config('fel.ctd', (public.fel_admin_bolson_cuenta_crear('00000000-0000-0000-0000-0000000000a1', 'digifact', 'pruebas', 'CTA-DEC-D22')).id::text, false) as _c \gset
do $$
declare cta uuid := current_setting('fel.cta')::uuid; ctd uuid := current_setting('fel.ctd')::uuid; a1 uuid := '00000000-0000-0000-0000-0000000000a1';
begin
  perform public.fel_admin_bolson_lote_registrar(a1, cta, 10, 5, 'LOTE-D22-1');
  assert (select comprado from public.bolson_saldos where cuenta_id = cta) = 10;
  assert (select count(*) from public.bolson_movimientos where cuenta_id = cta and tipo = 'recarga') = 1, 'la recarga está en el libro';
  perform public.fel_admin_bolson_lote_registrar(a1, cta, 10, 5, 'LOTE-D22-1');                                -- repetición idéntica: sin movimiento nuevo
  assert (select count(*) from public.bolson_movimientos where cuenta_id = cta and tipo = 'recarga') = 1 and (select comprado from public.bolson_saldos where cuenta_id = cta) = 10, 'la repetición no duplica la recarga';
  perform public.fel_admin_bolson_lote_registrar(a1, ctd, 1, 1, 'LOTE-DEC-1');
  perform public.fel_admin_bolson_lote_registrar(a1, current_setting('fel.ctm')::uuid, 5, 1, 'LOTE-MOCK-1');
  -- reglas de la cuenta decimal: consulta consume 0.1; descarga no consume pero se mide; «otro» no consume ni se mide
  perform public.fel_admin_bolson_regla_registrar(a1, ctd, 'consulta', 'si', 0.1, true, 'contrato_escrito', '{"doc":"contrato-prueba"}');
  perform public.fel_admin_bolson_regla_registrar(a1, ctd, 'descarga_artefacto', 'no', 0, true, 'observado_en_pruebas', '{"obs":"prueba"}');
  perform public.fel_admin_bolson_regla_registrar(a1, ctd, 'otro', 'no', 0, false, 'observado_en_pruebas', '{"obs":"prueba"}');
  assert pg_temp.sin_diferencias(), 'el libro reproduce los saldos tras las compras';
end $$;

-- ================= 3. reservar: caso básico (certificación sobre una operación iniciada)
do $$
declare A uuid := '10000000-0000-0000-0000-00000000000a'; cta uuid := current_setting('fel.cta')::uuid; op uuid; c public.consumos;
begin
  op := pg_temp.nueva_op(A); insert into t_id values ('op1', op);
  c := pg_temp.res(A, cta, 'certificacion', op, null, 'k-cert-1'); insert into t_id values ('c1', c.id);
  assert c.estado = 'reservado' and c.unidades_reservadas = 1 and c.unidades_consumidas = 0 and not c.en_vigilancia and c.resuelto_en is null, 'consumo reservado';
  assert (select consume = 'desconocido' and unidades = 1 from public.bolson_reglas_consumo where id = c.regla_id), 'se usó la regla vigente (desconocido ⇒ consume 1)';
  assert (select reservado from public.bolson_saldos where cuenta_id = cta) = 1 and (select count(*) from public.bolson_movimientos where consumo_id = c.id and tipo = 'reserva' and unidades = 1 and empresa_id = A) = 1, 'reserva en el libro y en el saldo';
  assert (select count(*) from public.auditoria where accion = 'bolson.consumo_reservado' and entidad_id = c.id::text and empresa_id = A) = 1, 'auditado';
  assert pg_temp.sin_diferencias();
end $$;

-- ================= 4. idempotencia ESTRICTA
do $$
declare A uuid := '10000000-0000-0000-0000-00000000000a'; B uuid := '10000000-0000-0000-0000-00000000000b'; cta uuid := current_setting('fel.cta')::uuid; ctm uuid := current_setting('fel.ctm')::uuid;
        op uuid := pg_temp.g('op1'); c public.consumos; n_mov int; n_cons int; sal numeric;
begin
  select count(*) into n_mov from public.bolson_movimientos; select count(*) into n_cons from public.consumos; select reservado into sal from public.bolson_saldos where cuenta_id = cta;
  c := pg_temp.res(A, cta, 'certificacion', op, null, 'k-cert-1');
  assert c.id = pg_temp.g('c1'), 'la repetición devuelve el mismo consumo';
  assert (select count(*) from public.bolson_movimientos) = n_mov and (select count(*) from public.consumos) = n_cons and (select reservado from public.bolson_saldos where cuenta_id = cta) = sal, 'la repetición no cambia nada';
  perform pg_temp.espera_error(format($q$select pg_temp.res('%s','%s','certificacion','%s',null,'k-cert-1', repeat('c',64))$q$, A, cta, op), 'FEL_IDEMPOTENCIA');                -- otro contenido
  perform pg_temp.espera_error(format($q$select pg_temp.res('%s','%s','certificacion','%s',null,'k-cert-1')$q$, A, ctm, op), 'FEL_IDEMPOTENCIA');                            -- otra cuenta
  perform pg_temp.espera_error(format($q$select pg_temp.res('%s','%s','anulacion','%s',null,'k-cert-1')$q$, A, cta, op), 'FEL_IDEMPOTENCIA');                                -- otro evento
  perform pg_temp.espera_error(format($q$select pg_temp.res('%s','%s','certificacion','%s',null,'k-cert-1')$q$, A, cta, pg_temp.nueva_op(A)), 'FEL_IDEMPOTENCIA');              -- otra operación
  -- la misma operación con OTRA clave no puede tener un segundo consumo de certificación
  perform pg_temp.espera_error(format($q$select pg_temp.res('%s','%s','certificacion','%s',null,'k-cert-otra')$q$, A, cta, op), 'FEL_OPERACION_CON_CONSUMO');
  -- la misma clave en OTRA empresa es independiente (la unicidad es por empresa)
  c := pg_temp.res(B, cta, 'consulta', null, null, 'k-cert-1'); insert into t_id values ('cB1', c.id);
  assert c.id <> pg_temp.g('c1') and c.empresa_id = B, 'misma clave en otra empresa = otro consumo';
  -- claves y hashes inválidos
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_reservar('%s','%s','consulta',null,null,'corta',repeat('b',64))$q$, A, cta), 'clave de idempotencia');
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_reservar('%s','%s','consulta',null,null,repeat('k',81),repeat('b',64))$q$, A, cta), 'clave de idempotencia');
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_reservar('%s','%s','consulta',null,null,repeat('k',20),'xyz')$q$, A, cta), 'SHA-256');
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_reservar('%s','%s','consulta',null,null,null,repeat('b',64))$q$, A, cta), 'clave de idempotencia');
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_reservar('%s','%s','consulta',null,null,repeat('k',20),repeat('B',64))$q$, A, cta), 'SHA-256');          -- mayúsculas: no es el formato
  assert pg_temp.sin_diferencias();
end $$;

-- ================= 5. validaciones de contexto (nada se reserva si algo no cuadra)
do $$
declare A uuid := '10000000-0000-0000-0000-00000000000a'; B uuid := '10000000-0000-0000-0000-00000000000b'; C uuid := '10000000-0000-0000-0000-00000000000c';
        cta uuid := current_setting('fel.cta')::uuid; ctm uuid := current_setting('fel.ctm')::uuid; a1 uuid := '00000000-0000-0000-0000-0000000000a1';
        n_cons int; n_mov int; opB uuid; opSim uuid; opMock uuid; opAnu uuid; opOk uuid; opCerrada uuid; docB uuid;
begin
  select count(*) into n_cons from public.consumos; select count(*) into n_mov from public.bolson_movimientos;
  opB := pg_temp.nueva_op(B); opSim := pg_temp.nueva_op(A, 'certificacion', 'simulado', 'mock'); opMock := pg_temp.nueva_op(A, 'certificacion', 'pruebas', 'mock');
  opAnu := pg_temp.nueva_op(A, 'anulacion'); opCerrada := pg_temp.nueva_op(A); perform pg_temp.cerrar_op(opCerrada, 'confirmada_exitosa');
  docB := pg_temp.nuevo_doc(B);
  perform pg_temp.espera_error(format($q$select pg_temp.res('99999999-0000-0000-0000-000000000000','%s','consulta',null,null,'k-v-1')$q$, cta), 'empresa no encontrada');
  perform pg_temp.espera_error(format($q$select pg_temp.res('%s','%s','consulta',null,null,'k-v-2')$q$, C, cta), 'no está habilitada');
  perform pg_temp.espera_error(format($q$select pg_temp.res('%s','%s','inexistente',null,null,'k-v-3')$q$, A, cta), 'tipo de evento desconocido');
  perform pg_temp.espera_error(format($q$select pg_temp.res('%s','%s','devolucion',null,null,'k-v-4')$q$, A, cta), 'devoluciones no se reservan');
  perform pg_temp.espera_error(format($q$select pg_temp.res('%s','99999999-0000-0000-0000-000000000000','consulta',null,null,'k-v-5')$q$, A), 'cuenta del bolsón no encontrada');
  perform pg_temp.espera_error(format($q$select pg_temp.res('%s','%s','certificacion',null,null,'k-v-6')$q$, A, cta), 'exige su operación');
  perform pg_temp.espera_error(format($q$select pg_temp.res('%s','%s','anulacion',null,null,'k-v-7')$q$, A, cta), 'exige su operación');
  -- aislamiento entre empresas: la operación o el documento de B no sirven para A
  perform pg_temp.espera_error(format($q$select pg_temp.res('%s','%s','certificacion','%s',null,'k-v-8')$q$, A, cta, opB), 'operación no encontrada');
  perform pg_temp.espera_error(format($q$select pg_temp.res('%s','%s','consulta',null,'%s','k-v-9')$q$, A, cta, docB), 'documento no encontrado');
  perform pg_temp.espera_error(format($q$select pg_temp.res('%s','%s','consulta','%s','%s','k-v-10')$q$, A, cta, pg_temp.nueva_op(A), pg_temp.nuevo_doc(A)), 'no corresponde a la operación');
  -- simulación y realidad no se mezclan; cuenta y operación deben ser del mismo proveedor y ambiente
  perform pg_temp.espera_error(format($q$select pg_temp.res('%s','%s','certificacion','%s',null,'k-v-11')$q$, A, cta, opSim), 'no corresponde a la cuenta');   -- (D3-1) una operación simulada (mock) no consume una cuenta de pruebas de Digifact
  perform pg_temp.espera_error(format($q$select pg_temp.res('%s','%s','certificacion','%s',null,'k-v-12')$q$, A, cta, opMock), 'no corresponde a la cuenta');
  perform pg_temp.espera_error(format($q$select pg_temp.res('%s','%s','certificacion','%s',null,'k-v-13')$q$, A, ctm, pg_temp.nueva_op(A)), 'no corresponde a la cuenta');
  -- el evento debe corresponder al tipo de la operación y esta no puede estar ya confirmada
  perform pg_temp.espera_error(format($q$select pg_temp.res('%s','%s','certificacion','%s',null,'k-v-14')$q$, A, cta, opAnu), 'no corresponde a una operación');
  perform pg_temp.espera_error(format($q$select pg_temp.res('%s','%s','certificacion','%s',null,'k-v-15')$q$, A, cta, opCerrada), 'ya está confirmada');
  -- cuenta pausada o cerrada: no reserva
  perform public.fel_admin_bolson_cuenta_estado(a1, ctm, 'pausada', 'Pausa de prueba D2-2');
  perform pg_temp.espera_error(format($q$select pg_temp.res('%s','%s','consulta',null,null,'k-v-16')$q$, A, ctm), 'no está activa');
  perform public.fel_admin_bolson_cuenta_estado(a1, ctm, 'activa', 'Reanudación de prueba D2-2');
  assert (select count(*) from public.consumos) = n_cons and (select count(*) from public.bolson_movimientos) = n_mov, 'ningún intento fallido dejó rastro';
  -- la operación de otra empresa no se vio afectada ni el saldo cambió
  assert pg_temp.sin_diferencias();
  -- una operación desconocida SÍ admite consumo (el envío pudo haber ocurrido) y una no medible no crea consumo
  opOk := pg_temp.nueva_op(A); perform pg_temp.cerrar_op(opOk, 'desconocida');
  assert (pg_temp.res(A, cta, 'certificacion', opOk, null, 'k-v-17')).estado = 'reservado', 'una operación desconocida admite su reserva';
end $$;

-- ================= 6. agotamiento y exactitud decimal (cuenta con 1 unidad; la consulta consume 0,1)
do $$
declare A uuid := '10000000-0000-0000-0000-00000000000a'; ctd uuid := current_setting('fel.ctd')::uuid; c public.consumos; i int; n_cons int; n_mov int; ids uuid[] := '{}';
begin
  for i in 1..10 loop c := pg_temp.res(A, ctd, 'consulta', null, null, 'k-dec-' || i); ids := ids || c.id; end loop;
  assert (select reservado from public.bolson_saldos where cuenta_id = ctd) = 1.0, '10 × 0,1 = 1,0 exacto (no 0,9999999…)';
  assert (select comprado + ajustado - consumido - reservado from public.bolson_saldos where cuenta_id = ctd) = 0, 'disponible exactamente cero';
  select count(*) into n_cons from public.consumos; select count(*) into n_mov from public.bolson_movimientos;
  perform pg_temp.espera_error(format($q$select pg_temp.res('%s','%s','consulta',null,null,'k-dec-11')$q$, A, ctd), 'FEL_BOLSON_AGOTADO');
  assert (select count(*) from public.consumos) = n_cons and (select count(*) from public.bolson_movimientos) = n_mov, 'el rechazo por agotamiento no deja rastro';
  assert (pg_temp.res(A, ctd, 'consulta', null, null, 'k-dec-1')).id = ids[1], 'una repetición sigue siendo idempotente aunque ya no haya unidades';
  -- eventos que no consumen: se miden con 0 unidades (no necesitan saldo) o no se miden
  c := pg_temp.res(A, ctd, 'descarga_artefacto', null, null, 'k-dec-desc'); assert c.unidades_reservadas = 0 and c.estado = 'reservado', 'medible sin consumo: 0 unidades';
  assert (select count(*) from public.bolson_movimientos where consumo_id = c.id) = 0, 'sin unidades no hay movimientos';
  assert pg_temp.res(A, ctd, 'otro', null, null, 'k-dec-otro') is null, 'ni consume ni se mide: no se crea consumo';
  -- confirmación parcial exacta: reservado 0,1; consumido 0,03; se libera 0,07
  c := public.fel_sys_consumo_confirmar(A, ids[1], 0.03, 'REF-EXT-1', '{"x":1}');
  assert c.estado = 'confirmado' and c.unidades_consumidas = 0.03 and c.referencia_externa = 'REF-EXT-1' and c.resuelto_en is not null and not c.en_vigilancia;
  assert (select consumido from public.bolson_saldos where cuenta_id = ctd) = 0.03 and (select reservado from public.bolson_saldos where cuenta_id = ctd) = 0.9, 'saldo exacto tras la confirmación parcial';
  assert (select count(*) from public.bolson_movimientos where consumo_id = ids[1] and tipo = 'consumo' and unidades = 0.03) = 1 and (select count(*) from public.bolson_movimientos where consumo_id = ids[1] and tipo = 'liberacion' and unidades = 0.07) = 1, 'consumo 0,03 y liberación 0,07 en el libro';
  assert (select comprado + ajustado - consumido - reservado from public.bolson_saldos where cuenta_id = ctd) = 0.07, 'lo liberado vuelve a estar disponible (0,07)';
  perform pg_temp.espera_error(format($q$select pg_temp.res('%s','%s','consulta',null,null,'k-dec-12')$q$, A, ctd), 'FEL_BOLSON_AGOTADO');   -- 0,07 disponibles < 0,1 necesarios
  assert pg_temp.sin_diferencias();
end $$;

-- ================= 7. confirmar: solo con el resultado fiscal confirmado; repetición idéntica; exceso y estados
do $$
declare A uuid := '10000000-0000-0000-0000-00000000000a'; cta uuid := current_setting('fel.cta')::uuid; op uuid := pg_temp.g('op1'); c uuid := pg_temp.g('c1'); r public.consumos; n_mov int;
begin
  -- la operación sigue «iniciada»: NO se confirma el consumo
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_confirmar('%s','%s')$q$, A, c), 'FEL_INCIERTO');
  perform pg_temp.cerrar_op(op, 'desconocida');
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_confirmar('%s','%s')$q$, A, c), 'FEL_INCIERTO');                      -- desconocida: tampoco
  assert (select estado from public.consumos where id = c) = 'reservado', 'sigue reservado';
  -- no se puede confirmar más de lo reservado ni con referencia inválida; ni consumos de otra empresa ni inexistentes
  perform pg_temp.cerrar_op(op, 'confirmada_exitosa');
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_confirmar('%s','%s', 1.000001)$q$, A, c), 'más de lo reservado');
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_confirmar('%s','%s', -1)$q$, A, c), 'más de lo reservado');
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_confirmar('%s','%s', 1, '')$q$, A, c), 'referencia externa');
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_confirmar('10000000-0000-0000-0000-00000000000b','%s')$q$, c), 'consumo no encontrado');
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_confirmar('%s','99999999-0000-0000-0000-000000000000')$q$, A), 'consumo no encontrado');
  r := public.fel_sys_consumo_confirmar(A, c, null, 'AUT-1234', '{"evento":"certificado"}');
  assert r.estado = 'confirmado' and r.unidades_consumidas = 1 and r.referencia_externa = 'AUT-1234', 'confirmado con todas las unidades reservadas';
  assert (select reservado = 1 and consumido = 1 from public.bolson_saldos where cuenta_id = cta) is not null;   -- (otras reservas de la cuenta siguen)
  select count(*) into n_mov from public.bolson_movimientos;
  -- repetición idéntica y contradictoria
  assert (public.fel_sys_consumo_confirmar(A, c)).id = c and (public.fel_sys_consumo_confirmar(A, c, 1, 'AUT-1234')).id = c, 'repetición idéntica';
  assert (select count(*) from public.bolson_movimientos) = n_mov, 'la repetición no crea movimientos';
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_confirmar('%s','%s', 0.5)$q$, A, c), 'FEL_IDEMPOTENCIA');
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_confirmar('%s','%s', 1, 'OTRA-REF')$q$, A, c), 'FEL_IDEMPOTENCIA');
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_liberar('%s','%s','no_enviado','{"x":1}')$q$, A, c), 'FEL_ESTADO');       -- confirmado no se libera
  assert (select count(*) from public.bolson_movimientos where consumo_id = c and tipo = 'consumo') = 1 and (select count(*) from public.bolson_movimientos where consumo_id = c and tipo = 'reserva') = 1;
  assert (select count(*) from public.auditoria where accion = 'bolson.consumo_confirmado' and entidad_id = c::text) = 1, 'auditado una sola vez';
  assert pg_temp.sin_diferencias();
end $$;

-- ================= 8. liberar: NUNCA con resultado incierto; solo con el resultado confirmado como fallido
do $$
declare A uuid := '10000000-0000-0000-0000-00000000000a'; cta uuid := current_setting('fel.cta')::uuid; op uuid; c public.consumos; r public.consumos; n_mov int; sal numeric;
begin
  -- (a) iniciada, (b) desconocida, (c) exitosa: ninguna admite liberar
  op := pg_temp.nueva_op(A); c := pg_temp.res(A, cta, 'certificacion', op, null, 'k-lib-1'); insert into t_id values ('cLib1', c.id), ('opLib1', op);
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_liberar('%s','%s','no_enviado','{"x":1}')$q$, A, c.id), 'FEL_INCIERTO');                              -- iniciada
  perform pg_temp.cerrar_op(op, 'desconocida');
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_liberar('%s','%s','proveedor_confirma_sin_consumo','{"x":1}')$q$, A, c.id), 'FEL_INCIERTO');           -- desconocida
  assert (select estado from public.consumos where id = c.id) = 'reservado' and (select count(*) from public.bolson_movimientos where consumo_id = c.id) = 1, 'sigue reservado, nada se movió';
  -- parámetros inválidos
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_liberar('%s','%s','por_tiempo','{"x":1}')$q$, A, c.id), 'origen de liberación');
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_liberar('%s','%s',null,'{"x":1}')$q$, A, c.id), 'origen de liberación');
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_liberar('%s','%s','conciliacion_aprobada','{"x":1}')$q$, A, c.id), 'origen de liberación');            -- llega con D2-4
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_liberar('%s','%s','no_enviado',null)$q$, A, c.id), 'exige evidencia');
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_liberar('%s','%s','no_enviado','{}')$q$, A, c.id), 'exige evidencia');
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_liberar('%s','%s','no_enviado','[1]')$q$, A, c.id), 'exige evidencia');
  -- exitosa: se certificó, no se libera
  perform pg_temp.cerrar_op(op, 'confirmada_exitosa');
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_liberar('%s','%s','proveedor_confirma_sin_consumo','{"x":1}')$q$, A, c.id), 'FEL_INCIERTO');
  -- fallida confirmada por el proveedor: sí se libera
  op := pg_temp.nueva_op(A); c := pg_temp.res(A, cta, 'certificacion', op, null, 'k-lib-2'); insert into t_id values ('cLib2', c.id);
  select reservado into sal from public.bolson_saldos where cuenta_id = cta;
  perform pg_temp.cerrar_op(op, 'confirmada_fallida', 'proveedor');
  r := public.fel_sys_consumo_liberar(A, c.id, 'proveedor_confirma_sin_consumo', '{"evento":"rechazado_confirmado"}');
  assert r.estado = 'liberado' and r.unidades_consumidas = 0 and r.resuelto_en is not null and r.evidencia ->> 'origen' = 'proveedor_confirma_sin_consumo', 'liberado con su evidencia y origen';
  assert (select reservado from public.bolson_saldos where cuenta_id = cta) = sal - 1, 'la reserva vuelve a estar disponible';
  assert (select count(*) from public.bolson_movimientos where consumo_id = c.id and tipo = 'liberacion' and unidades = 1) = 1;
  select count(*) into n_mov from public.bolson_movimientos;
  -- repetición idéntica; contradictoria; confirmar un liberado
  assert (public.fel_sys_consumo_liberar(A, c.id, 'proveedor_confirma_sin_consumo', '{"otra":"evidencia"}')).id = c.id and (select count(*) from public.bolson_movimientos) = n_mov, 'repetición idéntica sin efectos';
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_liberar('%s','%s','no_enviado','{"x":1}')$q$, A, c.id), 'FEL_IDEMPOTENCIA');
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_confirmar('%s','%s')$q$, A, c.id), 'FEL_ESTADO');
  -- «no enviado» del orquestador: resolución del sistema
  op := pg_temp.nueva_op(A); c := pg_temp.res(A, cta, 'certificacion', op, null, 'k-lib-3');
  perform pg_temp.cerrar_op(op, 'confirmada_fallida', 'sistema_no_enviada');
  assert (public.fel_sys_consumo_liberar(A, c.id, 'no_enviado', '{"enviada_en":null}')).estado = 'liberado';
  -- tras una conciliación MANUAL «fallida»: espera de respuestas tardías Y comprobación posterior del proveedor
  op := pg_temp.nueva_op(A); c := pg_temp.res(A, cta, 'certificacion', op, null, 'k-lib-4'); insert into t_id values ('cMan1', c.id), ('opMan1', op);
  perform pg_temp.cerrar_op(op, 'confirmada_fallida', 'conciliacion_manual', clock_timestamp() + interval '1 hour');
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_liberar('%s','%s','proveedor_confirma_sin_consumo','{"x":1}')$q$, A, c.id), 'espera de respuestas tardías');      -- dentro de la espera
  op := pg_temp.nueva_op(A); c := pg_temp.res(A, cta, 'certificacion', op, null, 'k-lib-5'); insert into t_id values ('cMan2', c.id), ('opMan2', op);
  perform pg_temp.cerrar_op(op, 'confirmada_fallida', 'conciliacion_manual', clock_timestamp() - interval '1 minute', clock_timestamp() - interval '2 minutes');
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_liberar('%s','%s','proveedor_confirma_sin_consumo','{"x":1}')$q$, A, c.id), 'espera de respuestas tardías');      -- vencida la espera, pero sin comprobar al proveedor
  insert into public.eventos_proveedor (empresa_id, operacion_id, tipo, resultado, motivo) values (A, op, 'conciliacion', 'no_existe_confirmado', 'comprobación posterior de prueba');
  assert (public.fel_sys_consumo_liberar(A, c.id, 'proveedor_confirma_sin_consumo', '{"comprobacion":"posterior"}')).estado = 'liberado', 'con espera vencida y comprobación del proveedor se libera';
  assert pg_temp.sin_diferencias();
end $$;

-- ================= 9. consumos sin operación (consultas, descargas): evidencia obligatoria; la vigilancia solo se levanta resolviendo
do $$
declare A uuid := '10000000-0000-0000-0000-00000000000a'; cta uuid := current_setting('fel.cta')::uuid; c public.consumos; c2 public.consumos;
begin
  c := pg_temp.res(A, cta, 'consulta', null, null, 'k-nof-1');
  assert (public.fel_sys_consumo_liberar(A, c.id, 'proveedor_confirma_sin_consumo', '{"respuesta":"sin cargo"}')).estado = 'liberado', 'una consulta sin operación se libera con evidencia';
  c := pg_temp.res(A, cta, 'consulta', null, null, 'k-nof-2');
  perform public.fel_sys_consumo_vigilar(A, c.id, 'respuesta ilegible');
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_liberar('%s','%s','no_enviado','{"x":1}')$q$, A, c.id), 'solo se resuelve por conciliación');   -- en vigilancia no se libera
  assert (select en_vigilancia from public.consumos where id = c.id), 'sigue en vigilancia';
  c2 := public.fel_sys_consumo_confirmar(A, c.id, 1, 'REF-CONSULTA', '{"hecho":"reportado"}');   -- un hecho confirmado sí resuelve la vigilancia
  assert c2.estado = 'confirmado' and not c2.en_vigilancia, 'confirmar resuelve la vigilancia';
  assert not exists (select 1 from public.bolson_alertas where consumo_id = c.id and resuelta_en is null), 'alerta resuelta automáticamente';
  assert (select resuelta_por is null and resuelta_en is not null and nota like 'resuelta al confirmarse%' from public.bolson_alertas where consumo_id = c.id), 'resolución del sistema';
end $$;

-- ================= 10. vigilar: resultado desconocido ⇒ la reserva se CONSERVA y se alerta (una sola alerta)
do $$
declare A uuid := '10000000-0000-0000-0000-00000000000a'; cta uuid := current_setting('fel.cta')::uuid; op uuid; c public.consumos; sal numeric;
begin
  op := pg_temp.nueva_op(A); c := pg_temp.res(A, cta, 'certificacion', op, null, 'k-vig-1'); insert into t_id values ('cVig', c.id);
  perform pg_temp.cerrar_op(op, 'desconocida');
  select reservado into sal from public.bolson_saldos where cuenta_id = cta;
  c := public.fel_sys_consumo_vigilar(A, c.id, 'tiempo de espera agotado');
  assert c.en_vigilancia and c.estado = 'reservado', 'en vigilancia y aún reservado';
  assert (select count(*) from public.bolson_alertas where consumo_id = c.id and tipo = 'consumo_incierto' and resuelta_en is null and detalle ->> 'motivo' = 'tiempo de espera agotado') = 1, 'una alerta abierta';
  assert (public.fel_sys_consumo_vigilar(A, c.id, 'otra vez')).id = c.id and (select count(*) from public.bolson_alertas where consumo_id = c.id) = 1, 'repetir no duplica la alerta';
  assert (select reservado from public.bolson_saldos where cuenta_id = cta) = sal, 'el saldo reservado no cambió';
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_liberar('%s','%s','no_enviado','{"x":1}')$q$, A, c.id), 'FEL_INCIERTO');
  perform pg_temp.espera_error(format($q$update public.consumos set en_vigilancia = false where id = '%s'$q$, c.id), 'vigilancia solo termina');
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_vigilar('10000000-0000-0000-0000-00000000000b','%s','x')$q$, c.id), 'consumo no encontrado');
  perform pg_temp.espera_error(format($q$select public.fel_sys_consumo_vigilar('%s','%s','x')$q$, A, pg_temp.g('c1')), 'solo un consumo reservado');          -- uno confirmado no se vigila
  -- ni el paso del tiempo ni una revisión libera nada
  assert public.fel_sys_bolson_revisar(1) >= 0;
  assert (select estado from public.consumos where id = c.id) = 'reservado' and (select reservado from public.bolson_saldos where cuenta_id = cta) = sal, 'la revisión no libera';
  -- cuando el resultado se confirma (exitoso), el consumo se confirma y la alerta se cierra
  perform pg_temp.cerrar_op(op, 'confirmada_exitosa');
  c := public.fel_sys_consumo_confirmar(A, c.id, null, 'AUT-VIG', '{"conciliado":true}');
  assert c.estado = 'confirmado' and not c.en_vigilancia, 'confirmado tras resolverse la operación';
  assert not exists (select 1 from public.bolson_alertas where consumo_id = c.id and resuelta_en is null), 'alerta cerrada';
  assert pg_temp.sin_diferencias();
end $$;

-- ================= 11. incoherencias, revisión periódica y alertas (nunca libera; umbral obligatorio)
do $$
declare A uuid := '10000000-0000-0000-0000-00000000000a'; ctd uuid := current_setting('fel.ctd')::uuid; cta uuid := current_setting('fel.cta')::uuid; op uuid; c public.consumos; n int; a1 uuid := '00000000-0000-0000-0000-0000000000a1'; al public.bolson_alertas;
begin
  -- operación resuelta (exitosa) con la reserva todavía pendiente ⇒ incoherente
  op := pg_temp.nueva_op(A); c := pg_temp.res(A, cta, 'certificacion', op, null, 'k-inc-1'); insert into t_id values ('cInc', c.id);
  assert not exists (select 1 from public.fel_sys_consumos_incoherentes() where consumo_id = c.id), 'iniciada: coherente';
  perform pg_temp.cerrar_op(op, 'confirmada_exitosa');
  assert exists (select 1 from public.fel_sys_consumos_incoherentes() where consumo_id = c.id and motivo = 'operacion_resuelta_con_reserva_pendiente' and empresa_id = A), 'resuelta con reserva pendiente: incoherente';
  -- reservas envejecidas: un consumo de 0 unidades reservado hace 2 horas (insertado directo: reservado_en es inmutable)
  insert into public.consumos (cuenta_id, empresa_id, evento_tipo, clave_idempotencia, hash_contenido, unidades_reservadas, regla_id, reservado_en)
  select ctd, A, 'descarga_artefacto', 'k-viejo-000000000001', repeat('d', 64), 0, id, clock_timestamp() - interval '2 hours'
    from public.bolson_reglas_consumo where cuenta_id = ctd and evento_tipo = 'descarga_artefacto' and vigente_hasta is null;
  perform pg_temp.espera_error($q$select public.fel_sys_bolson_revisar(null)$q$, 'umbral');
  perform pg_temp.espera_error($q$select public.fel_sys_bolson_revisar(0)$q$, 'umbral');
  perform pg_temp.espera_error($q$select public.fel_sys_bolson_revisar(-5)$q$, 'umbral');
  n := public.fel_sys_bolson_revisar(60);
  assert n >= 2, 'una alerta por la reserva envejecida y otra por la incoherencia (' || n || ')';
  assert exists (select 1 from public.bolson_alertas where tipo = 'reserva_envejecida' and resuelta_en is null and empresa_id = A), 'alerta de reserva envejecida';
  assert exists (select 1 from public.bolson_alertas where tipo = 'consumo_sin_operacion_resuelta' and consumo_id = c.id and resuelta_en is null), 'alerta de incoherencia';
  assert public.fel_sys_bolson_revisar(60) = 0, 'repetir la revisión no duplica alertas';
  assert (select estado from public.consumos where id = c.id) = 'reservado', 'la revisión NO resolvió nada';
  -- resolver alertas: solo el administrador maestro, con nota; repetición idempotente; las alertas no se editan
  select * into al from public.bolson_alertas where consumo_id = c.id and tipo = 'consumo_sin_operacion_resuelta';
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_alerta_resolver('00000000-0000-0000-0000-0000000000c1','%s','nota suficiente')$q$, al.id), 'FEL_NO_AUTORIZADO');
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_alerta_resolver('%s','%s','x')$q$, a1, al.id), 'nota es obligatoria');
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_alerta_resolver('%s','99999999-0000-0000-0000-000000000000','nota suficiente')$q$, a1), 'alerta no encontrada');
  al := public.fel_admin_bolson_alerta_resolver(a1, al.id, 'Revisada por el maestro');
  assert al.resuelta_en is not null and al.resuelta_por = a1 and al.nota = 'Revisada por el maestro';
  assert (public.fel_admin_bolson_alerta_resolver(a1, al.id, 'otra nota distinta')).nota = 'Revisada por el maestro', 'repetición idempotente';
  perform pg_temp.espera_error(format($q$update public.bolson_alertas set nota = 'x' where id = '%s'$q$, al.id), 'solo puede cerrarse');
  perform pg_temp.espera_error(format($q$update public.bolson_alertas set tipo = 'bolson_bajo' where id = '%s'$q$, al.id), 'solo puede cerrarse');
  perform pg_temp.espera_error(format($q$delete from public.bolson_alertas where id = '%s'$q$, al.id), 'no se borran');
  perform pg_temp.espera_error($q$insert into public.bolson_alertas (cuenta_id, tipo) values (gen_random_uuid(), 'otra_cosa')$q$, 'check|foreign key');
  -- se resuelve el consumo incoherente y desaparece de la lista
  c := public.fel_sys_consumo_confirmar(A, c.id, null, 'AUT-INC', '{"x":1}');
  assert not exists (select 1 from public.fel_sys_consumos_incoherentes() where consumo_id = c.id), 'resuelto: ya no es incoherente';
  assert pg_temp.sin_diferencias();
end $$;

-- ================= 12. el libro: solo inserción, única vía para cambiar saldos, defensa final contra el sobreconsumo
do $$
declare A uuid := '10000000-0000-0000-0000-00000000000a'; cta uuid := current_setting('fel.cta')::uuid; c uuid := pg_temp.g('c1'); lote uuid; sal public.bolson_saldos; a1 uuid := '00000000-0000-0000-0000-0000000000a1'; cc public.consumos; n int;
begin
  perform pg_temp.espera_error($q$update public.bolson_movimientos set unidades = 1$q$, 'FEL_APPEND_ONLY');
  perform pg_temp.espera_error($q$delete from public.bolson_movimientos$q$, 'FEL_APPEND_ONLY');
  perform pg_temp.espera_error(format($q$update public.bolson_saldos set consumido = 0 where cuenta_id = '%s'$q$, cta), 'solo cambia por movimientos');
  perform pg_temp.espera_error(format($q$update public.bolson_saldos set reservado = reservado + 1 where cuenta_id = '%s'$q$, cta), 'solo cambia por movimientos');
  -- el saldo es siempre la suma del libro; cada movimiento se aplica en la misma transacción
  assert pg_temp.sin_diferencias();
  select * into sal from public.bolson_saldos where cuenta_id = cta;
  -- defensa final: aunque alguien inserte un movimiento a mano, el saldo no puede quedar negativo
  perform pg_temp.espera_error(format($q$insert into public.bolson_movimientos (cuenta_id, empresa_id, consumo_id, tipo, unidades) values ('%s','%s','%s','reserva', 1000000)$q$, cta, A, c), 'check|violates');
  assert (select row(comprado, consumido, reservado, ajustado) from public.bolson_saldos where cuenta_id = cta) = row(sal.comprado, sal.consumido, sal.reservado, sal.ajustado), 'el intento fallido no dejó rastro';
  -- restricciones del libro
  perform pg_temp.espera_error(format($q$insert into public.bolson_movimientos (cuenta_id, tipo, unidades) values ('%s','reserva', 1)$q$, cta), 'check|violates');                       -- reserva sin consumo
  perform pg_temp.espera_error(format($q$insert into public.bolson_movimientos (cuenta_id, empresa_id, consumo_id, tipo, unidades) values ('%s','%s','%s','consumo', 0)$q$, cta, A, c), 'check|violates');
  perform pg_temp.espera_error(format($q$insert into public.bolson_movimientos (cuenta_id, empresa_id, consumo_id, tipo, unidades) values ('%s','%s','%s','consumo', -1)$q$, cta, A, c), 'check|violates');
  perform pg_temp.espera_error(format($q$insert into public.bolson_movimientos (cuenta_id, tipo, unidades) values ('%s','recarga', 1)$q$, cta), 'check|violates');                        -- recarga sin lote
  perform pg_temp.espera_error(format($q$insert into public.bolson_movimientos (cuenta_id, tipo, unidades) values ('%s','ajuste', 1)$q$, cta), 'check|violates');                         -- ajuste sin motivo
  perform pg_temp.espera_error(format($q$insert into public.bolson_movimientos (cuenta_id, tipo, unidades, sentido, motivo) values ('%s','caducidad', 1, -1, 'x')$q$, cta), 'check|violates'); -- solo el ajuste resta por sentido
  perform pg_temp.espera_error(format($q$insert into public.bolson_movimientos (cuenta_id, tipo, unidades) values ('%s','invento', 1)$q$, cta), 'check|violates');
  -- el consumo de otra cuenta o de otra empresa no puede referenciarse
  perform pg_temp.espera_error(format($q$insert into public.bolson_movimientos (cuenta_id, empresa_id, consumo_id, tipo, unidades) values ('%s','%s','%s','liberacion', 0.1)$q$, current_setting('fel.ctm'), A, c), 'foreign key|violates');
  perform pg_temp.espera_error(format($q$insert into public.bolson_movimientos (cuenta_id, empresa_id, consumo_id, tipo, unidades) values ('%s','10000000-0000-0000-0000-00000000000b','%s','liberacion', 0.1)$q$, cta, c), 'foreign key|violates');
  -- ajustes, caducidad y devolución: por el libro y con efecto exacto en «ajustado»
  insert into public.bolson_movimientos (cuenta_id, tipo, unidades, sentido, motivo, creado_por) values (cta, 'ajuste', 2.5, 1, 'ajuste de prueba (+)', a1);
  insert into public.bolson_movimientos (cuenta_id, tipo, unidades, sentido, motivo, creado_por) values (cta, 'ajuste', 0.5, -1, 'ajuste de prueba (−)', a1);
  insert into public.bolson_movimientos (cuenta_id, tipo, unidades, motivo) values (cta, 'caducidad', 0.25, 'caducidad de prueba');
  insert into public.bolson_movimientos (cuenta_id, tipo, unidades, motivo) values (cta, 'devolucion', 0.125, 'devolución de prueba');
  assert (select ajustado from public.bolson_saldos where cuenta_id = cta) = sal.ajustado + 2.5 - 0.5 - 0.25 + 0.125, 'ajustado exacto: +2,5 −0,5 −0,25 +0,125';
  assert pg_temp.sin_diferencias();
  -- un ajuste negativo que dejaría el disponible por debajo de cero se rechaza
  perform pg_temp.espera_error(format($q$insert into public.bolson_movimientos (cuenta_id, tipo, unidades, sentido, motivo) values ('%s','ajuste', 1000000, -1, 'exceso')$q$, cta), 'check|violates');
  -- la recarga de un lote siempre pasa por el libro y se ata a su cuenta
  lote := (select id from public.bolson_lotes where cuenta_id = cta limit 1);
  perform pg_temp.espera_error(format($q$insert into public.bolson_movimientos (cuenta_id, lote_id, tipo, unidades) values ('%s','%s','recarga', 1)$q$, current_setting('fel.ctm'), lote), 'foreign key|violates');
  -- inmutabilidad de los consumos
  select * into cc from public.consumos where id = c;
  perform pg_temp.espera_error(format($q$update public.consumos set unidades_reservadas = 99 where id = '%s'$q$, c), 'inmutables');
  perform pg_temp.espera_error(format($q$update public.consumos set cuenta_id = '%s' where id = '%s'$q$, current_setting('fel.ctm'), c), 'inmutables');
  perform pg_temp.espera_error(format($q$update public.consumos set empresa_id = '10000000-0000-0000-0000-00000000000b' where id = '%s'$q$, c), 'inmutables');
  perform pg_temp.espera_error(format($q$update public.consumos set clave_idempotencia = 'otra-clave-0000000' where id = '%s'$q$, c), 'inmutables');
  perform pg_temp.espera_error(format($q$update public.consumos set unidades_consumidas = 0 where id = '%s'$q$, c), 'no se modifica');                       -- resuelto
  perform pg_temp.espera_error(format($q$update public.consumos set estado = 'liberado', unidades_consumidas = 0 where id = '%s'$q$, c), 'no se modifica');
  perform pg_temp.espera_error(format($q$delete from public.consumos where id = '%s'$q$, c), 'no se borran');
  perform pg_temp.espera_error(format($q$update public.consumos set extracto_linea_id = gen_random_uuid() where id = '%s'$q$, pg_temp.g('cVig')), 'inmutables|foreign key');
  perform pg_temp.espera_error(format($q$update public.consumos set unidades_consumidas = 0.5 where id = '%s'$q$, (select id from public.consumos where estado = 'reservado' limit 1)), 'solo puede cambiar la marca');
  perform pg_temp.espera_error(format($q$update public.consumos set evidencia = '{"x":1}' where id = '%s'$q$, (select id from public.consumos where estado = 'reservado' limit 1)), 'solo puede cambiar la marca');
  -- restricciones de la tabla
  perform pg_temp.espera_error(format($q$update public.consumos set estado = 'confirmado' where id = '%s'$q$, (select id from public.consumos where estado = 'reservado' limit 1)), 'check|violates');   -- confirmado sin resuelto_en
  perform pg_temp.espera_error(format($q$insert into public.consumos (cuenta_id, empresa_id, evento_tipo, consumo_origen_id, clave_idempotencia, hash_contenido, unidades_reservadas, regla_id)
    select cuenta_id, empresa_id, 'consulta', id, 'k-origen-00000000001', repeat('e',64), 0, regla_id from public.consumos where id = '%s'$q$, c), 'check|violates');     -- origen solo en devoluciones
  perform pg_temp.espera_error(format($q$insert into public.consumos (cuenta_id, empresa_id, evento_tipo, clave_idempotencia, hash_contenido, unidades_reservadas, unidades_consumidas, regla_id, estado, resuelto_en)
    select cuenta_id, empresa_id, 'consulta', 'k-exceso-0000000001', repeat('e',64), 1, 2, regla_id, 'confirmado', now() from public.consumos where id = '%s'$q$, c), 'check|violates');   -- más de lo reservado
  assert pg_temp.sin_diferencias();
end $$;

-- ================= 13. auditoría: cada hecho queda auditado y todo consumo resuelto tiene su rastro en el libro
do $$
begin
  assert (select count(*) from public.auditoria where accion = 'bolson.consumo_reservado') = (select count(*) from public.consumos where unidades_reservadas >= 0 and clave_idempotencia !~ '^k-viejo'), 'una auditoría de reserva por consumo creado por la función';
  assert (select count(*) from public.auditoria where accion = 'bolson.consumo_confirmado') = (select count(*) from public.consumos where estado = 'confirmado'), 'una auditoría por consumo confirmado';
  assert (select count(*) from public.auditoria where accion = 'bolson.consumo_liberado') = (select count(*) from public.consumos where estado = 'liberado'), 'una auditoría por consumo liberado';
  assert (select count(*) from public.auditoria where accion = 'bolson.consumo_en_vigilancia') >= 2;
  assert (select count(*) from public.auditoria where accion like 'bolson.consumo_%' and origen = 'sistema' and actor_user_id is null) = (select count(*) from public.auditoria where accion like 'bolson.consumo_%'), 'origen «sistema»';
  -- consumos y su libro: reservado = una reserva; confirmado = un consumo (si >0); liberado = una liberación (si reservó >0); nada de más
  assert not exists (select 1 from public.consumos c where c.unidades_reservadas > 0 and (select count(*) from public.bolson_movimientos m where m.consumo_id = c.id and m.tipo = 'reserva') <> 1), 'toda reserva con unidades tiene exactamente un movimiento de reserva';
  assert not exists (select 1 from public.consumos c where c.estado = 'confirmado' and c.unidades_consumidas > 0 and (select sum(m.unidades) from public.bolson_movimientos m where m.consumo_id = c.id and m.tipo = 'consumo') is distinct from c.unidades_consumidas), 'consumos confirmados = movimientos de consumo';
  assert not exists (select 1 from public.consumos c where c.estado = 'liberado' and c.unidades_reservadas > 0 and (select sum(m.unidades) from public.bolson_movimientos m where m.consumo_id = c.id and m.tipo = 'liberacion') is distinct from c.unidades_reservadas), 'liberados = movimientos de liberación';
  assert not exists (select 1 from public.consumos c where c.estado = 'reservado' and exists (select 1 from public.bolson_movimientos m where m.consumo_id = c.id and m.tipo in ('consumo','liberacion'))), 'un consumo reservado no tiene movimientos de cierre';
  assert (select count(*) from public.bolson_movimientos where creado_en is null or tipo is null) = 0;
end $$;

-- ================= 14. privilegios y aislamiento con RLS real (rol authenticated + claims JWT)
do $$
declare t text;
begin
  foreach t in array array['consumos','bolson_movimientos','bolson_alertas'] loop
    assert not has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'), 'anon con permisos en ' || t;
    assert not has_table_privilege('authenticated', 'public.' || t, 'INSERT,UPDATE,DELETE,TRUNCATE'), 'authenticated escribe en ' || t;
    assert not has_table_privilege('service_role', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'), 'service_role con acceso directo a ' || t;
    assert (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass), 'sin RLS: ' || t;
  end loop;
  assert not has_column_privilege('authenticated', 'public.consumos', 'cuenta_id', 'SELECT'), 'la empresa no debe leer la cuenta del bolsón';
  assert not has_column_privilege('authenticated', 'public.consumos', 'regla_id', 'SELECT'), 'ni la regla';
  assert not has_column_privilege('authenticated', 'public.consumos', 'evidencia', 'SELECT'), 'ni la evidencia del proveedor';
  assert not has_column_privilege('authenticated', 'public.consumos', 'extracto_linea_id', 'SELECT'), 'ni los extractos';
  assert not has_column_privilege('authenticated', 'public.consumos', 'hash_contenido', 'SELECT') and not has_column_privilege('authenticated', 'public.consumos', 'clave_idempotencia', 'SELECT'), 'ni claves ni hashes';
  assert has_column_privilege('authenticated', 'public.consumos', 'unidades_consumidas', 'SELECT'), 'sí su propio consumo';
  for t in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like 'fel\_sys\_consumo%' or p.proname in ('fel_sys_verificar_saldos','fel_sys_bolson_revisar','fel_admin_bolson_alerta_resolver','fel__bolson_alertar','fel__bolson_consumo_repetido')) loop
    assert not has_function_privilege('anon', t, 'EXECUTE') and not has_function_privilege('authenticated', t, 'EXECUTE'), 'ejecutable por usuarios: ' || t;
    assert has_function_privilege('service_role', t, 'EXECUTE'), 'service_role no ejecuta ' || t;
  end loop;
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('fel_sys_consumo_reservar','fel_sys_consumo_confirmar','fel_sys_consumo_liberar','fel_sys_consumo_vigilar')) = 4, 'las cuatro funciones de ciclo de vida';
  foreach t in array array['fel__bolson_aplicar_movimiento','fel_bolson_consumo_guard','fel_bolson_alerta_guard','fel_bolson_saldo_guard'] loop
    assert not has_function_privilege('service_role', ('public.' || t || '()')::regprocedure, 'EXECUTE') and not has_function_privilege('authenticated', ('public.' || t || '()')::regprocedure, 'EXECUTE'), 'disparador ejecutable: ' || t;
  end loop;
end $$;

-- propietario de A (con consumo.ver): ve SOLO consumos de A y solo las columnas permitidas; nada del bolsón
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true) as _cfg \gset
do $$
declare n int;
begin
  assert (select count(*) from public.consumos) = (select count(*) from public.consumos where empresa_id = '10000000-0000-0000-0000-00000000000a') and (select count(*) from public.consumos) > 5, 'A ve sus consumos';
  assert (select count(*) from public.consumos where empresa_id <> '10000000-0000-0000-0000-00000000000a') = 0, 'A no ve consumos de B';
  assert (select count(*) from public.consumos where empresa_id = '10000000-0000-0000-0000-00000000000b') = 0;
  perform id, estado, unidades_reservadas, unidades_consumidas, referencia_externa, en_vigilancia, evento_tipo, operacion_id, documento_id, reservado_en, resuelto_en from public.consumos limit 1;
  assert (select count(*) from public.bolson_movimientos) = 0 and (select count(*) from public.bolson_alertas) = 0, 'A no ve el libro ni las alertas';
  assert (select count(*) from public.bolson_cuentas) = 0 and (select count(*) from public.bolson_saldos) = 0 and (select count(*) from public.bolson_lotes) = 0 and (select count(*) from public.bolson_reglas_consumo) = 0, 'A no ve nada del bolsón';
  assert (select coalesce(sum(comprado), 0) from public.bolson_saldos) = 0, 'ni totales';
end $$;
do $$ begin begin perform * from public.consumos limit 1; raise exception 'NO DEBIÓ PERMITIR select *'; exception when insufficient_privilege then null; end; end $$;      -- select * incluye columnas ocultas
do $$ begin begin perform cuenta_id from public.consumos limit 1; raise exception 'NO DEBIÓ PERMITIR'; exception when insufficient_privilege then null; end; end $$;
do $$ begin begin perform evidencia from public.consumos limit 1; raise exception 'NO DEBIÓ PERMITIR'; exception when insufficient_privilege then null; end; end $$;
do $$ begin begin perform regla_id from public.consumos limit 1; raise exception 'NO DEBIÓ PERMITIR'; exception when insufficient_privilege then null; end; end $$;
do $$ begin
  begin insert into public.consumos (cuenta_id, empresa_id, evento_tipo, clave_idempotencia, hash_contenido, unidades_reservadas, regla_id) values (gen_random_uuid(), gen_random_uuid(), 'consulta', repeat('k', 20), repeat('b', 64), 0, gen_random_uuid()); raise exception 'NO DEBIÓ PERMITIR insert'; exception when insufficient_privilege then null; end;
  begin update public.consumos set estado = 'liberado'; raise exception 'NO DEBIÓ PERMITIR update'; exception when insufficient_privilege then null; end;
  begin delete from public.consumos; raise exception 'NO DEBIÓ PERMITIR delete'; exception when insufficient_privilege then null; end;
  begin insert into public.bolson_movimientos (cuenta_id, tipo, unidades) values (gen_random_uuid(), 'ajuste', 1); raise exception 'NO DEBIÓ PERMITIR'; exception when insufficient_privilege then null; end;
  begin perform public.fel_sys_consumo_reservar(gen_random_uuid(), gen_random_uuid(), 'consulta', null, null, repeat('k', 20), repeat('b', 64)); raise exception 'NO DEBIÓ EJECUTAR'; exception when insufficient_privilege then null; end;
  begin perform public.fel_sys_consumo_confirmar(gen_random_uuid(), gen_random_uuid()); raise exception 'NO DEBIÓ EJECUTAR'; exception when insufficient_privilege then null; end;
  begin perform public.fel_sys_consumo_liberar(gen_random_uuid(), gen_random_uuid(), 'no_enviado', '{"x":1}'); raise exception 'NO DEBIÓ EJECUTAR'; exception when insufficient_privilege then null; end;
  begin perform public.fel_sys_verificar_saldos(); raise exception 'NO DEBIÓ EJECUTAR'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- propietario de B (con consumo.ver): solo lo de B
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true) as _cfg \gset
do $$ begin
  assert (select count(*) from public.consumos) >= 1 and (select count(*) from public.consumos where empresa_id <> '10000000-0000-0000-0000-00000000000b') = 0, 'B ve solo sus consumos';
  assert (select count(*) from public.bolson_movimientos) = 0 and (select count(*) from public.bolson_cuentas) = 0, 'B no ve el bolsón';
end $$;
reset role;
-- lector y administrador de A SIN consumo.ver, y un usuario sin empresa: nada
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true) as _cfg \gset
do $$ begin assert (select count(*) from public.consumos) = 0, 'el lector (sin consumo.ver) ve consumos'; end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c4","role":"authenticated"}', true) as _cfg \gset
do $$ begin   -- (D2-3) el rol administrador recibe consumo.ver: ve los consumos de SU empresa y nada de otras ni del bolsón
  assert (select count(*) from public.consumos) > 5 and (select count(*) from public.consumos where empresa_id <> '10000000-0000-0000-0000-00000000000a') = 0, 'el administrador ve los consumos de su empresa y solo de ella';
  assert (select count(*) from public.bolson_movimientos) = 0 and (select count(*) from public.bolson_cuentas) = 0, 'el administrador no ve el bolsón';
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true) as _cfg \gset
do $$ begin assert (select count(*) from public.consumos) = 0 and (select count(*) from public.bolson_alertas) = 0, 'un usuario sin empresa ve consumos'; end $$;
reset role;
-- sin sesión y con la clave de servicio: sin acceso directo
set local role anon;
do $$ begin begin perform count(*) from public.consumos; raise exception 'NO DEBIÓ PERMITIR'; exception when insufficient_privilege then null; end; end $$;
reset role;
set local role service_role;
do $$ begin
  begin perform count(*) from public.consumos; raise exception 'NO DEBIÓ PERMITIR select'; exception when insufficient_privilege then null; end;
  begin update public.bolson_saldos set reservado = 0; raise exception 'NO DEBIÓ PERMITIR update'; exception when insufficient_privilege then null; end;
  begin insert into public.bolson_movimientos (cuenta_id, tipo, unidades) values (gen_random_uuid(), 'ajuste', 1); raise exception 'NO DEBIÓ PERMITIR insert'; exception when insufficient_privilege then null; end;
  perform public.fel_sys_verificar_saldos();     -- sí puede por la función
end $$;
reset role;
-- administrador maestro SIN segundo factor: nada de otras empresas; CON segundo factor: ve todo (consumos con columnas limitadas; libro y alertas completos)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}', true) as _cfg \gset
do $$ begin assert (select count(*) from public.consumos) = 0 and (select count(*) from public.bolson_movimientos) = 0 and (select count(*) from public.bolson_alertas) = 0, 'el maestro sin MFA ve el bolsón'; end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true) as _cfg \gset
do $$ begin
  assert (select count(*) from public.consumos where empresa_id = '10000000-0000-0000-0000-00000000000a') > 5 and (select count(*) from public.consumos where empresa_id = '10000000-0000-0000-0000-00000000000b') >= 1, 'el maestro ve los consumos de todas las empresas';
  assert (select count(*) from public.bolson_movimientos) > 20 and (select count(*) from public.bolson_alertas) >= 2, 'el maestro ve el libro y las alertas';
  assert (select count(*) from public.bolson_movimientos where cuenta_id is not null and consumo_id is not null) > 10, 'con todas sus columnas';
end $$;
reset role;

-- ================= 15. verificación final del libro
do $$ begin
  assert pg_temp.sin_diferencias(), 'el libro debe reproducir todos los saldos';
  assert (select count(*) from public.fel_sys_verificar_saldos()) = 6 * (select count(*) from public.bolson_saldos), 'seis comprobaciones por cuenta';
  assert not exists (select 1 from public.bolson_saldos where comprado + ajustado - consumido - reservado < 0), 'ninguna cuenta con disponible negativo';
end $$;

rollback;
\echo OK 19_bolson_consumos
