-- D2-1 · Bolsón global (mundo A): estructura = diseño aprobado, restricciones, solo inserción, reglas versionadas, aislamiento (RLS real) y privilegios.
-- Todo SIMULADO: sin proveedor real, sin credenciales; las cuentas de producción están rechazadas.
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
  ('00000000-0000-0000-0000-0000000000c4', 'adminA@fel.test'),  ('00000000-0000-0000-0000-0000000000d1', 'propB@fel.test'),
  ('00000000-0000-0000-0000-0000000000e1', 'sinempresa@fel.test');
insert into public.perfiles (user_id) select id from auth.users on conflict (user_id) do nothing;
insert into public.plataforma_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1');
insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id, estado)
select e.id, e.n, e.n || ' S.A.', e.nit, r.id, 'habilitada'
  from (values ('10000000-0000-0000-0000-00000000000a'::uuid, 'Empresa A', '1111111-1'), ('10000000-0000-0000-0000-00000000000b'::uuid, 'Empresa B', '2222222-2')) e(id, n, nit),
       public.regimenes_fiscales r where r.codigo = 'general';
insert into public.miembros (empresa_id, user_id, rol) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 'propietario'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c4', 'administrador'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000d1', 'propietario');

-- ================= 1. la estructura coincide EXACTAMENTE con el diseño aprobado (columnas, precisión, sin coma flotante)
do $$
declare t record;
begin
  for t in select * from (values
    ('evento_tipos',           array['codigo','creado_en','descripcion','fiscal']),
    ('bolson_cuentas',         array['ambiente','creada_en','creada_por','estado','id','proveedor_id','referencia_externa','unidad']),
    ('bolson_lotes',           array['costo_total','cuenta_id','id','moneda','referencia_proveedor','registrado_en','registrado_por','unidades','vence_en','vigente_desde']),
    ('bolson_reglas_consumo',  array['consume','cuenta_id','evento_tipo','evidencia','fuente','id','medible','registrada_en','registrada_por','unidades','vigente_desde','vigente_hasta']),
    ('bolson_extractos',       array['cuenta_id','fuente','hash_contenido','id','importado_en','importado_por','periodo_desde','periodo_hasta','saldo_final','saldo_inicial']),
    ('bolson_extracto_lineas', array['cuenta_id','evento_externo','extracto_id','hash_linea','id','nit_declarado','numero_linea','ocurrido_en','referencia_externa','unidades']),
    ('bolson_saldos',          array['actualizado_en','ajustado','comprado','consumido','cuenta_id','reservado'])) v(tabla, columnas) loop
    assert (select array_agg(column_name::text order by column_name::text collate "C") from information_schema.columns where table_schema = 'public' and table_name = t.tabla) = t.columnas,
      'columnas distintas del diseño en ' || t.tabla;
  end loop;
  assert (select count(*) from information_schema.columns where table_schema = 'public' and (table_name like 'bolson\_%' or table_name = 'evento_tipos')
          and data_type in ('real','double precision')) = 0, 'hay columnas de coma flotante';
  assert (select count(*) from information_schema.columns where table_schema = 'public' and table_name like 'bolson\_%' and column_name in ('unidades','saldo_inicial','saldo_final','comprado','consumido','reservado','ajustado')
          and not (data_type = 'numeric' and numeric_precision = 20 and numeric_scale = 6)) = 0, 'unidades y saldos deben ser numeric(20,6)';
  assert (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'bolson_lotes' and column_name = 'costo_total' and data_type = 'numeric' and numeric_precision = 18 and numeric_scale = 6) = 1, 'costo_total numeric(18,6)';
  -- sin credenciales ni secretos: ninguna columna se llama como un secreto
  assert (select count(*) from information_schema.columns where table_schema = 'public' and (table_name like 'bolson\_%' or table_name = 'evento_tipos')
          and column_name ~* '(clave|password|contrase|token|secret|credencial|api_?key)') = 0, 'una tabla del bolsón tiene columnas de secretos';
  -- claves y restricciones del diseño
  assert exists (select 1 from pg_constraint where conrelid = 'public.bolson_cuentas'::regclass and contype = 'u'), 'unique de cuenta';
  assert exists (select 1 from pg_indexes where indexname = 'bolson_reglas_una_vigente'), 'una regla vigente por cuenta y evento';
  assert (select count(*) from pg_constraint where conrelid = 'public.bolson_extracto_lineas'::regclass and contype = 'f') = 1, 'FK compuesta (extracto, cuenta) de las líneas';
  assert (select count(*) from pg_constraint where conrelid = 'public.bolson_saldos'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ 'comprado.*ajustado.*consumido.*reservado') = 1, 'restricción de no sobreconsumo';
  assert (select count(*) from public.evento_tipos) = 10, 'diez tipos de evento iniciales';
end $$;

-- ================= 2. cuentas: creación, idempotencia, producción bloqueada, reglas iniciales conservadoras
select set_config('fel.cuenta1', (public.fel_admin_bolson_cuenta_crear('00000000-0000-0000-0000-0000000000a1', 'digifact', 'pruebas', 'CUENTA-PRUEBAS-1')).id::text, false) as _c \gset
do $$
declare c uuid := current_setting('fel.cuenta1')::uuid; c2 uuid; n int;
begin
  assert (select estado from public.bolson_cuentas where id = c) = 'activa';
  assert (select comprado = 0 and consumido = 0 and reservado = 0 and ajustado = 0 from public.bolson_saldos where cuenta_id = c), 'saldo inicial en cero';
  -- una regla vigente por cada tipo de evento, TODAS conservadoras salvo la validación local
  assert (select count(*) from public.bolson_reglas_consumo where cuenta_id = c and vigente_hasta is null) = 10, 'una regla vigente por tipo';
  assert (select count(*) from public.bolson_reglas_consumo where cuenta_id = c and consume = 'desconocido' and fuente = 'pendiente') = 9, 'nueve reglas desconocidas/pendientes';
  assert (select consume = 'no' and unidades = 0 and fuente = 'definicion_interna' from public.bolson_reglas_consumo where cuenta_id = c and evento_tipo = 'rechazo_validacion_local'), 'la validación local no llega al proveedor';
  assert (select unidades = 1 from public.bolson_reglas_consumo where cuenta_id = c and evento_tipo = 'certificacion'), 'lo desconocido se trata como que consume 1 unidad';
  assert (select unidades = 0 from public.bolson_reglas_consumo where cuenta_id = c and evento_tipo = 'devolucion'), 'una devolución desconocida no devuelve nada';
  -- idempotente: misma cuenta, nada duplicado
  c2 := (public.fel_admin_bolson_cuenta_crear('00000000-0000-0000-0000-0000000000a1', 'digifact', 'pruebas', 'CUENTA-PRUEBAS-1')).id;
  assert c2 = c, 'crear dos veces devuelve la misma cuenta';
  assert (select count(*) from public.bolson_cuentas where referencia_externa = 'CUENTA-PRUEBAS-1') = 1 and (select count(*) from public.bolson_saldos where cuenta_id = c) = 1;
  assert (select count(*) from public.bolson_reglas_consumo where cuenta_id = c) = 10, 'sin reglas duplicadas';
  -- producción rechazada (proveedor no habilitado) y por restricción para otros proveedores
  perform pg_temp.espera_error($q$select public.fel_admin_bolson_cuenta_crear('00000000-0000-0000-0000-0000000000a1','digifact','produccion','PROD-1')$q$, 'no se pueden crear cuentas de producción');
  perform pg_temp.espera_error($q$insert into public.bolson_cuentas (proveedor_id, ambiente, referencia_externa) values ('mock','produccion','X')$q$, 'check');
  perform pg_temp.espera_error($q$select public.fel_admin_bolson_cuenta_crear('00000000-0000-0000-0000-0000000000a1','inexistente','pruebas','X')$q$, 'proveedor desconocido');
  perform pg_temp.espera_error($q$select public.fel_admin_bolson_cuenta_crear('00000000-0000-0000-0000-0000000000a1','digifact','otro','X')$q$, 'check');
  perform pg_temp.espera_error($q$select public.fel_admin_bolson_cuenta_crear('00000000-0000-0000-0000-0000000000a1','digifact','pruebas','   ')$q$, 'check');
  -- solo el administrador maestro (no un usuario común ni un nulo)
  perform pg_temp.espera_error($q$select public.fel_admin_bolson_cuenta_crear('00000000-0000-0000-0000-0000000000c1','digifact','pruebas','X2')$q$, 'FEL_NO_AUTORIZADO');
  perform pg_temp.espera_error($q$select public.fel_admin_bolson_cuenta_crear(null,'digifact','pruebas','X3')$q$, 'FEL_NO_AUTORIZADO');
  assert (select count(*) from public.auditoria where accion = 'bolson.cuenta_creada' and empresa_id is null) = 1, 'auditada una sola vez (la repetición no audita)';
end $$;

-- ================= 3. estado de la cuenta
do $$
declare c uuid := current_setting('fel.cuenta1')::uuid;
begin
  perform public.fel_admin_bolson_cuenta_estado('00000000-0000-0000-0000-0000000000a1', c, 'pausada', 'Revisión de prueba');
  assert (select estado from public.bolson_cuentas where id = c) = 'pausada';
  perform public.fel_admin_bolson_cuenta_estado('00000000-0000-0000-0000-0000000000a1', c, 'activa', 'Reanudación de prueba');
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_cuenta_estado('00000000-0000-0000-0000-0000000000a1','%s','pausada','x')$q$, c), 'motivo');
  perform pg_temp.espera_error(format($q$update public.bolson_cuentas set referencia_externa = 'otra' where id = '%s'$q$, c), 'solo puede cambiar el estado');
  perform pg_temp.espera_error(format($q$update public.bolson_cuentas set unidad = 'otra' where id = '%s'$q$, c), 'solo puede cambiar el estado');
  perform pg_temp.espera_error(format($q$delete from public.bolson_cuentas where id = '%s'$q$, c), 'no se borran');
  perform pg_temp.espera_error(format($q$update public.bolson_cuentas set estado = 'invalido' where id = '%s'$q$, c), '(check|transición)');
end $$;

-- ================= 4. lotes: compra, saldo, idempotencia, restricciones y solo inserción
do $$
declare c uuid := current_setting('fel.cuenta1')::uuid; l1 public.bolson_lotes; l2 public.bolson_lotes;
begin
  l1 := public.fel_admin_bolson_lote_registrar('00000000-0000-0000-0000-0000000000a1', c, 1000, 500.5, 'FACT-PROV-0001');
  assert (select comprado from public.bolson_saldos where cuenta_id = c) = 1000, 'el saldo comprado refleja el lote';
  -- repetición idéntica: idempotente (mismo lote, saldo sin cambio, una sola auditoría)
  l2 := public.fel_admin_bolson_lote_registrar('00000000-0000-0000-0000-0000000000a1', c, 1000, 500.5, 'FACT-PROV-0001');
  assert l2.id = l1.id and (select comprado from public.bolson_saldos where cuenta_id = c) = 1000, 'repetición idéntica no duplica';
  assert (select count(*) from public.auditoria where accion = 'bolson.lote_registrado') = 1, 'solo una auditoría';
  -- misma referencia con datos distintos: error, nada cambia
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_lote_registrar('00000000-0000-0000-0000-0000000000a1','%s',999,500.5,'FACT-PROV-0001')$q$, c), 'FEL_IDEMPOTENCIA');
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_lote_registrar('00000000-0000-0000-0000-0000000000a1','%s',1000,1,'FACT-PROV-0001')$q$, c), 'FEL_IDEMPOTENCIA');
  assert (select comprado from public.bolson_saldos where cuenta_id = c) = 1000;
  -- defensa de la propia tabla: un duplicado directo (sin pasar por la función) también se rechaza
  perform pg_temp.espera_error(format($q$insert into public.bolson_lotes (cuenta_id, unidades, costo_total, referencia_proveedor) values ('%s',1,1,'FACT-PROV-0001')$q$, c), 'unique|duplicate');
  -- otro lote suma exactamente (decimales exactos)
  perform public.fel_admin_bolson_lote_registrar('00000000-0000-0000-0000-0000000000a1', c, 0.1, 0.05, 'FACT-PROV-0002');
  perform public.fel_admin_bolson_lote_registrar('00000000-0000-0000-0000-0000000000a1', c, 0.2, 0.05, 'FACT-PROV-0003');
  assert (select comprado from public.bolson_saldos where cuenta_id = c) = 1000.3, 'suma decimal exacta (0.1 + 0.2 = 0.3)';
  assert (select comprado from public.bolson_saldos where cuenta_id = c) = (select sum(unidades) from public.bolson_lotes where cuenta_id = c), 'saldo = suma del libro';
  -- restricciones
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_lote_registrar('00000000-0000-0000-0000-0000000000a1','%s',0,1,'R-0')$q$, c), 'check');
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_lote_registrar('00000000-0000-0000-0000-0000000000a1','%s',-5,1,'R-1')$q$, c), 'check');
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_lote_registrar('00000000-0000-0000-0000-0000000000a1','%s',5,-1,'R-2')$q$, c), 'check');
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_lote_registrar('00000000-0000-0000-0000-0000000000a1','%s',5,1,'')$q$, c), 'check');
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_lote_registrar('00000000-0000-0000-0000-0000000000a1','%s',5,1,'R-3', now(), now() - interval '1 day')$q$, c), 'check');
  perform pg_temp.espera_error($q$select public.fel_admin_bolson_lote_registrar('00000000-0000-0000-0000-0000000000a1','99999999-0000-0000-0000-000000000000',5,1,'R-4')$q$, 'no encontrada');
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_lote_registrar('00000000-0000-0000-0000-0000000000c1','%s',5,1,'R-5')$q$, c), 'FEL_NO_AUTORIZADO');
  perform pg_temp.espera_error(format($q$insert into public.bolson_lotes (cuenta_id, unidades, costo_total, moneda, referencia_proveedor) values ('%s',1,1,'USD','R-6')$q$, c), 'check');
  assert (select comprado from public.bolson_saldos where cuenta_id = c) = 1000.3, 'ningún intento fallido cambió el saldo';
  -- solo inserción (incluso para el propietario de la tabla)
  perform pg_temp.espera_error(format($q$update public.bolson_lotes set unidades = 1 where cuenta_id = '%s'$q$, c), 'FEL_APPEND_ONLY');
  perform pg_temp.espera_error(format($q$delete from public.bolson_lotes where cuenta_id = '%s'$q$, c), 'FEL_APPEND_ONLY');
  -- saldo (desde D2-2): solo cambia por movimientos del libro; cualquier actualización directa se rechaza, incluso para el propietario de la tabla
  perform pg_temp.espera_error(format($q$update public.bolson_saldos set consumido = 2000 where cuenta_id = '%s'$q$, c), 'solo cambia por movimientos');
  perform pg_temp.espera_error(format($q$update public.bolson_saldos set reservado = 1001 where cuenta_id = '%s'$q$, c), 'solo cambia por movimientos');
  perform pg_temp.espera_error(format($q$update public.bolson_saldos set comprado = 1 where cuenta_id = '%s'$q$, c), 'solo cambia por movimientos');
  perform pg_temp.espera_error(format($q$update public.bolson_saldos set consumido = -1 where cuenta_id = '%s'$q$, c), 'solo cambia por movimientos');
  perform pg_temp.espera_error(format($q$delete from public.bolson_saldos where cuenta_id = '%s'$q$, c), 'no se borran');
  assert (select comprado from public.bolson_saldos where cuenta_id = c) = (select sum(unidades) from public.bolson_movimientos where cuenta_id = c and tipo = 'recarga'), 'lo comprado coincide con las recargas del libro';
  assert (select count(*) from public.bolson_movimientos where cuenta_id = c and tipo = 'recarga') = 3, 'cada lote tiene su recarga en el libro (la repetición idéntica no duplica)';
end $$;

-- cuenta cerrada: no acepta lotes y es terminal
do $$
declare c2 uuid;
begin
  c2 := (public.fel_admin_bolson_cuenta_crear('00000000-0000-0000-0000-0000000000a1', 'digifact', 'pruebas', 'CUENTA-CERRADA')).id;
  perform public.fel_admin_bolson_cuenta_estado('00000000-0000-0000-0000-0000000000a1', c2, 'cerrada', 'Cierre de prueba');
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_lote_registrar('00000000-0000-0000-0000-0000000000a1','%s',5,1,'R-C')$q$, c2), 'cerrada');
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_cuenta_estado('00000000-0000-0000-0000-0000000000a1','%s','activa','Reabrir cerrada')$q$, c2), 'transición');
end $$;

-- ================= 5. reglas de consumo: versionado, sin solapamiento, evidencia, solo inserción
do $$
declare c uuid := current_setting('fel.cuenta1')::uuid; r1 public.bolson_reglas_consumo; r2 public.bolson_reglas_consumo; n int;
begin
  -- una regla firme exige fuente y evidencia
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_regla_registrar('00000000-0000-0000-0000-0000000000a1','%s','consulta','no',0,true,'pendiente',null)$q$, c), 'check');
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_regla_registrar('00000000-0000-0000-0000-0000000000a1','%s','consulta','no',0,true,'contrato_escrito',null)$q$, c), 'check');
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_regla_registrar('00000000-0000-0000-0000-0000000000a1','%s','consulta','no',1,true,'contrato_escrito','{"doc":"x"}')$q$, c), 'check');     -- «no» exige 0 unidades
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_regla_registrar('00000000-0000-0000-0000-0000000000a1','%s','consulta','si',0,true,'contrato_escrito','{"doc":"x"}')$q$, c), 'check');     -- «si» exige > 0
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_regla_registrar('00000000-0000-0000-0000-0000000000a1','%s','consulta','quizas',1,true,'contrato_escrito','{"doc":"x"}')$q$, c), 'check');
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_regla_registrar('00000000-0000-0000-0000-0000000000a1','%s','inexistente','si',1,true,'contrato_escrito','{"doc":"x"}')$q$, c), 'evento desconocido');
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_regla_registrar('00000000-0000-0000-0000-0000000000c1','%s','consulta','si',1,true,'contrato_escrito','{"doc":"x"}')$q$, c), 'FEL_NO_AUTORIZADO');
  assert (select count(*) from public.bolson_reglas_consumo where cuenta_id = c) = 10, 'los intentos fallidos no dejan reglas';
  -- versionado: la nueva cierra la anterior; siempre una sola vigente
  r1 := public.fel_admin_bolson_regla_registrar('00000000-0000-0000-0000-0000000000a1', c, 'consulta', 'no', 0, true, 'contrato_escrito', '{"doc":"carta-1"}');
  assert (select count(*) from public.bolson_reglas_consumo where cuenta_id = c and evento_tipo = 'consulta') = 2, 'dos versiones';
  assert (select count(*) from public.bolson_reglas_consumo where cuenta_id = c and evento_tipo = 'consulta' and vigente_hasta is null) = 1, 'una sola vigente';
  assert (select vigente_hasta from public.bolson_reglas_consumo where cuenta_id = c and evento_tipo = 'consulta' and fuente = 'pendiente') = r1.vigente_desde, 'la anterior termina donde empieza la nueva (sin huecos ni solapes)';
  r2 := public.fel_admin_bolson_regla_registrar('00000000-0000-0000-0000-0000000000a1', c, 'consulta', 'si', 0.5, false, 'observado_en_pruebas', '{"obs":"prueba-2"}');
  assert (select count(*) from public.bolson_reglas_consumo where cuenta_id = c and evento_tipo = 'consulta' and vigente_hasta is null) = 1;
  -- vigencia anterior o igual a la actual: rechazada
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_regla_registrar('00000000-0000-0000-0000-0000000000a1','%s','consulta','no',0,true,'contrato_escrito','{"d":1}', '%s')$q$, c, r2.vigente_desde), 'posterior al inicio');
  perform pg_temp.espera_error(format($q$select public.fel_admin_bolson_regla_registrar('00000000-0000-0000-0000-0000000000a1','%s','consulta','no',0,true,'contrato_escrito','{"d":1}', '%s')$q$, c, r2.vigente_desde - interval '1 hour'), 'posterior al inicio');
  -- solapamiento por inserción directa: rechazado
  perform pg_temp.espera_error(format($q$insert into public.bolson_reglas_consumo (cuenta_id, evento_tipo, consume, unidades, medible, fuente, evidencia, vigente_desde, vigente_hasta)
    values ('%s','consulta','no',0,true,'contrato_escrito','{"d":1}', '%s', '%s')$q$, c, r1.vigente_desde - interval '1 minute', r1.vigente_desde + interval '1 minute'), 'solapa');
  perform pg_temp.espera_error(format($q$insert into public.bolson_reglas_consumo (cuenta_id, evento_tipo, consume, unidades, medible, fuente, evidencia, vigente_desde)
    values ('%s','consulta','no',0,true,'contrato_escrito','{"d":1}', now() + interval '1 day')$q$, c), '(solapa|duplicate|unique)');                       -- dos vigentes: índice único
  -- vigencia vacía o invertida
  perform pg_temp.espera_error(format($q$insert into public.bolson_reglas_consumo (cuenta_id, evento_tipo, consume, unidades, medible, fuente, evidencia, vigente_desde, vigente_hasta)
    values ('%s','otro','no',0,true,'contrato_escrito','{"d":1}', now(), now() - interval '1 day')$q$, c), '(check|range)');
  -- solo inserción: lo único modificable es cerrar la vigencia, una vez
  perform pg_temp.espera_error(format($q$update public.bolson_reglas_consumo set consume = 'no', unidades = 0 where id = '%s'$q$, r2.id), 'solo puede cerrarse la vigencia');
  perform pg_temp.espera_error(format($q$update public.bolson_reglas_consumo set vigente_hasta = null where cuenta_id = '%s' and evento_tipo = 'consulta' and vigente_hasta is not null$q$, c), 'solo puede cerrarse la vigencia');
  perform pg_temp.espera_error(format($q$update public.bolson_reglas_consumo set vigente_hasta = vigente_hasta + interval '1 day' where cuenta_id = '%s' and evento_tipo = 'consulta' and vigente_hasta is not null$q$, c), 'solo puede cerrarse la vigencia');
  perform pg_temp.espera_error(format($q$delete from public.bolson_reglas_consumo where id = '%s'$q$, r2.id), 'no se borran');
  -- un tipo de evento nuevo siembra una regla desconocida en TODAS las cuentas existentes
  n := (select count(*) from public.bolson_cuentas);
  perform public.fel_admin_bolson_evento_tipo_crear('00000000-0000-0000-0000-0000000000a1', 'evento_de_prueba', 'Evento creado por la prueba', false);
  assert (select count(*) from public.bolson_reglas_consumo where evento_tipo = 'evento_de_prueba' and vigente_hasta is null and consume = 'desconocido' and fuente = 'pendiente') = n, 'regla sembrada en cada cuenta';
  perform public.fel_admin_bolson_evento_tipo_crear('00000000-0000-0000-0000-0000000000a1', 'evento_de_prueba', 'Evento creado por la prueba', false);   -- idempotente
  assert (select count(*) from public.bolson_reglas_consumo where evento_tipo = 'evento_de_prueba') = n, 'sin duplicados';
  perform pg_temp.espera_error($q$select public.fel_admin_bolson_evento_tipo_crear('00000000-0000-0000-0000-0000000000c1','otro_evento','Otro evento de prueba',false)$q$, 'FEL_NO_AUTORIZADO');
  perform pg_temp.espera_error($q$select public.fel_admin_bolson_evento_tipo_crear('00000000-0000-0000-0000-0000000000a1','Mal Codigo','Evento con mal código',false)$q$, 'check');
  perform pg_temp.espera_error($q$update public.evento_tipos set fiscal = true where codigo = 'otro'$q$, 'FEL_APPEND_ONLY');
  perform pg_temp.espera_error($q$delete from public.evento_tipos where codigo = 'otro'$q$, 'FEL_APPEND_ONLY');
  -- una cuenta creada DESPUÉS recibe también el tipo nuevo
  perform public.fel_admin_bolson_cuenta_crear('00000000-0000-0000-0000-0000000000a1', 'mock', 'pruebas', 'CUENTA-POSTERIOR');
  assert (select count(*) from public.bolson_reglas_consumo r join public.bolson_cuentas c2 on c2.id = r.cuenta_id where c2.referencia_externa = 'CUENTA-POSTERIOR' and r.vigente_hasta is null) = 11, 'once reglas vigentes';
end $$;

-- ================= 6. extractos y líneas: sin duplicados, ni siquiera solapados; FK compuesta; solo inserción
do $$
declare c uuid := current_setting('fel.cuenta1')::uuid; cb uuid; e1 uuid; e2 uuid;
begin
  cb := (select id from public.bolson_cuentas where referencia_externa = 'CUENTA-POSTERIOR');
  insert into public.bolson_extractos (cuenta_id, periodo_desde, periodo_hasta, fuente, hash_contenido, saldo_inicial, saldo_final)
    values (c, '2026-11-01', '2026-11-15', 'archivo', repeat('a', 64), 1000, 990) returning id into e1;
  insert into public.bolson_extracto_lineas (extracto_id, cuenta_id, numero_linea, referencia_externa, evento_externo, unidades, ocurrido_en, hash_linea)
    values (e1, c, 1, 'UUID-1', 'CERT', 1, now(), repeat('1', 64)), (e1, c, 2, 'UUID-2', 'CERT', 1, now(), repeat('2', 64));
  perform pg_temp.espera_error(format($q$insert into public.bolson_extractos (cuenta_id, periodo_desde, periodo_hasta, fuente, hash_contenido, saldo_inicial, saldo_final) values ('%s','2026-11-01','2026-11-15','api',repeat('a',64),1,1)$q$, c), 'unique|duplicate');
  insert into public.bolson_extractos (cuenta_id, periodo_desde, periodo_hasta, fuente, hash_contenido, saldo_inicial, saldo_final)
    values (c, '2026-11-10', '2026-11-30', 'archivo', repeat('b', 64), 990, 980) returning id into e2;
  -- extracto solapado: la línea ya conocida (mismo hash) no se vuelve a aceptar para la misma cuenta
  perform pg_temp.espera_error(format($q$insert into public.bolson_extracto_lineas (extracto_id, cuenta_id, numero_linea, referencia_externa, evento_externo, unidades, ocurrido_en, hash_linea) values ('%s','%s',1,'UUID-2','CERT',1,now(),repeat('2',64))$q$, e2, c), 'unique|duplicate');
  insert into public.bolson_extracto_lineas (extracto_id, cuenta_id, numero_linea, referencia_externa, evento_externo, unidades, ocurrido_en, hash_linea) values (e2, c, 1, 'UUID-3', 'CERT', 1, now(), repeat('3', 64));
  -- el mismo hash en OTRA cuenta es legítimo (no hay cruce entre cuentas)
  insert into public.bolson_extractos (cuenta_id, periodo_desde, periodo_hasta, fuente, hash_contenido, saldo_inicial, saldo_final) values (cb, '2026-11-01', '2026-11-15', 'archivo', repeat('a', 64), 0, 0) returning id into e1;
  insert into public.bolson_extracto_lineas (extracto_id, cuenta_id, numero_linea, referencia_externa, evento_externo, unidades, ocurrido_en, hash_linea) values (e1, cb, 1, 'UUID-1', 'CERT', 1, now(), repeat('1', 64));
  -- FK compuesta: una línea no puede declararse de otra cuenta distinta a la de su extracto
  perform pg_temp.espera_error(format($q$insert into public.bolson_extracto_lineas (extracto_id, cuenta_id, numero_linea, referencia_externa, evento_externo, unidades, ocurrido_en, hash_linea) values ('%s','%s',9,'UUID-9','CERT',1,now(),repeat('9',64))$q$, e2, cb), 'foreign key|violates');
  -- restricciones de valores
  perform pg_temp.espera_error(format($q$insert into public.bolson_extractos (cuenta_id, periodo_desde, periodo_hasta, fuente, hash_contenido, saldo_inicial, saldo_final) values ('%s','2026-12-01','2026-11-01','api',repeat('c',64),1,1)$q$, c), 'check');
  perform pg_temp.espera_error(format($q$insert into public.bolson_extractos (cuenta_id, periodo_desde, periodo_hasta, fuente, hash_contenido, saldo_inicial, saldo_final) values ('%s','2026-12-01','2026-12-02','api','no-es-hash',1,1)$q$, c), 'check');
  perform pg_temp.espera_error(format($q$insert into public.bolson_extractos (cuenta_id, periodo_desde, periodo_hasta, fuente, hash_contenido, saldo_inicial, saldo_final) values ('%s','2026-12-01','2026-12-02','otra',repeat('d',64),1,1)$q$, c), 'check');
  perform pg_temp.espera_error(format($q$insert into public.bolson_extracto_lineas (extracto_id, cuenta_id, numero_linea, referencia_externa, evento_externo, unidades, ocurrido_en, hash_linea) values ('%s','%s',0,'U','CERT',1,now(),repeat('e',64))$q$, e2, c), 'check');
  -- solo inserción
  perform pg_temp.espera_error(format($q$update public.bolson_extractos set saldo_final = 0 where id = '%s'$q$, e2), 'FEL_APPEND_ONLY');
  perform pg_temp.espera_error(format($q$delete from public.bolson_extractos where id = '%s'$q$, e2), 'FEL_APPEND_ONLY');
  perform pg_temp.espera_error($q$update public.bolson_extracto_lineas set unidades = 0$q$, 'FEL_APPEND_ONLY');
  perform pg_temp.espera_error($q$delete from public.bolson_extracto_lineas$q$, 'FEL_APPEND_ONLY');
end $$;

-- ================= 7. privilegios: nadie escribe directo; las funciones solo para service_role
do $$
declare t text;
begin
  foreach t in array array['evento_tipos','bolson_cuentas','bolson_lotes','bolson_reglas_consumo','bolson_extractos','bolson_extracto_lineas','bolson_saldos'] loop
    assert not has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'), 'anon con permisos en ' || t;
    assert not has_table_privilege('authenticated', 'public.' || t, 'INSERT,UPDATE,DELETE,TRUNCATE'), 'authenticated escribe en ' || t;
    assert not has_table_privilege('service_role', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'), 'service_role con acceso directo a ' || t;
    assert (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass), 'sin RLS: ' || t;
  end loop;
  for t in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like 'fel\_admin\_bolson\_%' or p.proname = 'fel__bolson_sembrar_reglas') loop
    assert not has_function_privilege('anon', t, 'EXECUTE') and not has_function_privilege('authenticated', t, 'EXECUTE'), 'ejecutable por usuarios: ' || t;
    assert has_function_privilege('service_role', t, 'EXECUTE'), 'service_role no ejecuta ' || t;
  end loop;
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
          and p.proname in ('fel_admin_bolson_cuenta_crear','fel_admin_bolson_cuenta_estado','fel_admin_bolson_evento_tipo_crear','fel_admin_bolson_regla_registrar','fel_admin_bolson_lote_registrar')) = 5, 'las cinco funciones fel_admin_bolson_* de D2-1';
  for t in select unnest(array['fel_bolson_cuenta_guard','fel_bolson_regla_guard','fel_bolson_saldo_guard']) loop
    assert not has_function_privilege('service_role', ('public.' || t || '()')::regprocedure, 'EXECUTE') and not has_function_privilege('authenticated', ('public.' || t || '()')::regprocedure, 'EXECUTE'), 'guard ejecutable: ' || t;
  end loop;
end $$;

-- ================= 8. aislamiento con RLS real (rol authenticated + claims JWT)
-- propietario de la empresa A: NO ve nada del bolsón (ni conteos); sí ve el catálogo de eventos; no escribe; no ejecuta funciones
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true) as _cfg \gset
do $$ begin
  assert (select count(*) from public.bolson_cuentas) = 0, 'el propietario ve cuentas del bolsón';
  assert (select count(*) from public.bolson_lotes) = 0, 'el propietario ve lotes';
  assert (select count(*) from public.bolson_reglas_consumo) = 0, 'el propietario ve reglas';
  assert (select count(*) from public.bolson_extractos) = 0, 'el propietario ve extractos';
  assert (select count(*) from public.bolson_extracto_lineas) = 0, 'el propietario ve líneas';
  assert (select count(*) from public.bolson_saldos) = 0, 'el propietario ve saldos (ni sumas ni conteos)';
  assert (select coalesce(sum(comprado), 0) from public.bolson_saldos) = 0, 'el propietario ve totales del bolsón';
  assert (select count(*) from public.evento_tipos) >= 10, 'el catálogo de eventos es legible';
  assert not public.fel_es_admin_plataforma();
end $$;
do $$ begin
  begin insert into public.bolson_lotes (cuenta_id, unidades, costo_total, referencia_proveedor) values (gen_random_uuid(), 1, 1, 'X'); raise exception 'NO DEBIÓ PERMITIR insert'; exception when insufficient_privilege then null; end;
  begin update public.bolson_saldos set comprado = 1; raise exception 'NO DEBIÓ PERMITIR update'; exception when insufficient_privilege then null; end;
  begin delete from public.bolson_reglas_consumo; raise exception 'NO DEBIÓ PERMITIR delete'; exception when insufficient_privilege then null; end;
  begin insert into public.evento_tipos (codigo, descripcion, fiscal) values ('intruso', 'Evento intruso de prueba', false); raise exception 'NO DEBIÓ PERMITIR insert'; exception when insufficient_privilege then null; end;
  begin perform public.fel_admin_bolson_cuenta_crear('00000000-0000-0000-0000-0000000000c1', 'digifact', 'pruebas', 'INTRUSA'); raise exception 'NO DEBIÓ EJECUTAR'; exception when insufficient_privilege then null; end;
  begin perform public.fel_admin_bolson_lote_registrar('00000000-0000-0000-0000-0000000000c1', gen_random_uuid(), 1, 1, 'X'); raise exception 'NO DEBIÓ EJECUTAR'; exception when insufficient_privilege then null; end;
  begin perform public.fel__bolson_sembrar_reglas('00000000-0000-0000-0000-0000000000c1', gen_random_uuid()); raise exception 'NO DEBIÓ EJECUTAR'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- administrador de la empresa A (otro rol): tampoco
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c4","role":"authenticated"}', true) as _cfg \gset
do $$ begin assert (select count(*) from public.bolson_cuentas) = 0 and (select count(*) from public.bolson_saldos) = 0 and (select count(*) from public.bolson_lotes) = 0, 'el administrador de empresa ve el bolsón'; end $$;
reset role;
-- propietario de la empresa B y usuario sin empresa: tampoco
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true) as _cfg \gset
do $$ begin assert (select count(*) from public.bolson_cuentas) = 0 and (select count(*) from public.bolson_reglas_consumo) = 0, 'otra empresa ve el bolsón'; end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true) as _cfg \gset
do $$ begin assert (select count(*) from public.bolson_cuentas) = 0 and (select count(*) from public.bolson_extractos) = 0, 'un usuario sin empresa ve el bolsón'; end $$;
reset role;
-- sin sesión (anon): ni siquiera puede consultar
set local role anon;
do $$ begin begin perform count(*) from public.bolson_cuentas; raise exception 'NO DEBIÓ PERMITIR'; exception when insufficient_privilege then null; end; end $$;
reset role;
-- service_role (clave de servicio): sin acceso directo a las tablas; solo por funciones
set local role service_role;
do $$ begin
  begin perform count(*) from public.bolson_saldos; raise exception 'NO DEBIÓ PERMITIR select'; exception when insufficient_privilege then null; end;
  begin insert into public.bolson_lotes (cuenta_id, unidades, costo_total, referencia_proveedor) values (gen_random_uuid(), 1, 1, 'X'); raise exception 'NO DEBIÓ PERMITIR insert'; exception when insufficient_privilege then null; end;
  begin update public.bolson_saldos set comprado = 99999; raise exception 'NO DEBIÓ PERMITIR update'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- administrador maestro SIN segundo factor (aal1): tampoco ve nada
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}', true) as _cfg \gset
do $$ begin assert not public.fel_es_admin_plataforma() and (select count(*) from public.bolson_cuentas) = 0 and (select count(*) from public.bolson_saldos) = 0, 'el maestro sin MFA ve el bolsón'; end $$;
reset role;
-- administrador maestro con segundo factor (aal2): sí ve todo el mundo A (vía RLS)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true) as _cfg \gset
do $$ begin
  assert public.fel_es_admin_plataforma();
  assert (select count(*) from public.bolson_cuentas) >= 3 and (select count(*) from public.bolson_lotes) = 3 and (select count(*) from public.bolson_saldos) >= 3, 'el maestro debe ver el bolsón';
  assert (select count(*) from public.bolson_reglas_consumo) > 30 and (select count(*) from public.bolson_extractos) = 3, 'el maestro debe ver reglas y extractos';
end $$;
reset role;

-- ================= 9. ningún dato de empresa se mezcla: el mundo A no referencia empresas ni documentos
do $$ begin
  assert (select count(*) from information_schema.columns where table_schema = 'public'
          and table_name in ('evento_tipos','bolson_cuentas','bolson_lotes','bolson_reglas_consumo','bolson_extractos','bolson_extracto_lineas','bolson_saldos')
          and column_name in ('empresa_id','documento_id','operacion_id')) = 0,
    'las tablas de hechos del proveedor (D2-1) no deben referenciar empresas, documentos ni operaciones: la atribución vive en consumos y movimientos (D2-2)';
end $$;

rollback;
\echo OK 18_bolson_global
