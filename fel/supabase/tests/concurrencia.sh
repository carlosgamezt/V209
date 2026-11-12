#!/usr/bin/env bash
# Operaciones concurrentes reales (dos sesiones psql a la vez) sobre una base DESECHABLE (deja datos de prueba).
# Uso: PSQL_CMD="psql -h ... -U postgres -d postgres" bash concurrencia.sh
set -euo pipefail
P=${PSQL_CMD:?define PSQL_CMD}
q() { $P -v ON_ERROR_STOP=1 -q -X -t -A -c "$1"; }
A=00000000-0000-0000-0000-0000000000a1; U=00000000-0000-0000-0000-0000000000b1
E=10000000-0000-0000-0000-0000000000c1
q "insert into auth.users (id,email) values ('$A','m-conc@fel.test'),('$U','p-conc@fel.test');
   insert into public.perfiles (user_id) values ('$A'),('$U') on conflict (user_id) do nothing;
   insert into public.plataforma_admins (user_id) values ('$A');
   insert into public.regimenes_fiscales (codigo,version,nombre,reglas,fuente,vigente_desde) values ('conc_reg',1,'Conc','{\"esquema\":1,\"impuestos\":[],\"precios_incluyen_impuesto\":false,\"redondeo\":{\"modo\":\"x\"}}','Referencia de prueba',current_date);
   update public.regimenes_fiscales set estado='verificado', verificado_por='$A', verificado_en=now() where codigo='conc_reg';
   insert into public.empresas (id,nombre_comercial,razon_social,nit,regimen_id,estado) select '$E','Conc','Conc S.A.','9999999-9',id,'habilitada' from public.regimenes_fiscales where codigo='conc_reg';
   insert into public.miembros (empresa_id,user_id,rol) values ('$E','$U','propietario');
   update public.plataforma_config set valor = true where clave = 'emision_real_disponible';
   select public.fel_admin_emision('$A','$E',true,'Prueba concurrencia');" >/dev/null
nuevo_doc() { # crea un documento revisado y devuelve su id
  q "select public.fel_op_cliente_guardar('$U','$E',null,'NIT','$RANDOM$RANDOM-1','Cli',null,null,null,null) is not null" >/dev/null 2>&1 || true
  local id; id=$(q "select (public.fel_op_documento_guardar('$U','$E',null,(select id from public.clientes where empresa_id='$E' limit 1),null,null,'[{\"orden\":1,\"descripcion\":\"x\",\"cantidad\":1,\"precio_unitario\":1}]'::jsonb,1,0,1,'{}'::jsonb,null)).id")
  q "select public.fel_op_documento_preparacion('$U','$E','$id','revisado',null,1)" >/dev/null
  echo "$id"
}
correr() { # $1=sql de la sesión; imprime OK o el error
  $P -v ON_ERROR_STOP=1 -q -X -t -A -c "begin; $1; select pg_sleep(1); commit;" >/tmp/conc_$2.out 2>&1 && echo OK > /tmp/conc_$2.res || echo ERR > /tmp/conc_$2.res
}
fallar() { echo "FALLO: $1"; exit 1; }
trap "q \"update public.plataforma_config set valor = false where clave = 'emision_real_disponible'\" >/dev/null 2>&1 || true" EXIT

# 1. dos certificaciones simultáneas con claves DISTINTAS: solo una puede existir
D1=$(nuevo_doc)
correr "select public.fel_op_certificacion_iniciar('$U','$E','$D1','clave-conc-000000A',repeat('a',64),'t')" 1a &
correr "select public.fel_op_certificacion_iniciar('$U','$E','$D1','clave-conc-000000B',repeat('a',64),'t')" 1b &
wait
[ "$(q "select count(*) from public.operaciones_fiscales where documento_id='$D1'")" = 1 ] || fallar "se crearon varias operaciones abiertas"
oks=$(cat /tmp/conc_1a.res /tmp/conc_1b.res | grep -c OK || true)
[ "$oks" = 1 ] || fallar "debía triunfar exactamente una sesión (triunfaron $oks)"
grep -q "FEL_OPERACION_ABIERTA" /tmp/conc_1a.out /tmp/conc_1b.out || fallar "la perdedora debía recibir FEL_OPERACION_ABIERTA"
echo "OK concurrencia: claves distintas → una sola operación"

# 2. dos certificaciones simultáneas con la MISMA clave: una operación, ambas ven la misma
D2=$(nuevo_doc)
correr "select public.fel_op_certificacion_iniciar('$U','$E','$D2','clave-conc-000000C',repeat('a',64),'t')" 2a &
correr "select public.fel_op_certificacion_iniciar('$U','$E','$D2','clave-conc-000000C',repeat('a',64),'t')" 2b &
wait
[ "$(q "select count(*) from public.operaciones_fiscales where documento_id='$D2'")" = 1 ] || fallar "misma clave creó varias operaciones"
[ "$(cat /tmp/conc_2a.res /tmp/conc_2b.res | grep -c OK)" = 2 ] || fallar "con la misma clave ambas debían recibir la misma operación"
echo "OK concurrencia: misma clave → idempotente"

# 3. dos ediciones simultáneas con la misma versión: una gana, la otra recibe conflicto (no se pierde ninguna en silencio)
D3=$(q "select (public.fel_op_documento_guardar('$U','$E',null,null,null,null,'[]'::jsonb,0,0,0,'{}'::jsonb,null)).id")
correr "select public.fel_op_documento_guardar('$U','$E','$D3',null,null,'edicion 1','[]'::jsonb,0,0,0,'{}'::jsonb,1)" 3a &
correr "select public.fel_op_documento_guardar('$U','$E','$D3',null,null,'edicion 2','[]'::jsonb,0,0,0,'{}'::jsonb,1)" 3b &
wait
[ "$(cat /tmp/conc_3a.res /tmp/conc_3b.res | grep -c OK)" = 1 ] || fallar "debía ganar exactamente una edición"
grep -q "FEL_CONFLICTO" /tmp/conc_3a.out /tmp/conc_3b.out || fallar "la perdedora debía recibir FEL_CONFLICTO"
echo "OK concurrencia: ediciones simultáneas → conflicto de versión"

# 4. revocar el acceso mientras otra sesión escribe: tras la revocación ninguna escritura nueva pasa
q "insert into public.perfiles (user_id, activo) values ('$U', false) on conflict (user_id) do update set activo=false" >/dev/null
$P -q -X -t -A -c "select public.fel_op_cliente_guardar('$U','$E',null,'NIT','1234567-1','Tarde',null,null,null,null)" >/tmp/conc_4.out 2>&1 && fallar "escribió con el acceso revocado" || grep -q FEL_NO_AUTORIZADO /tmp/conc_4.out || fallar "error inesperado"
echo "OK concurrencia: acceso revocado"
# 5. limitador: 12 llamadas simultáneas con máximo 5 → exactamente 5 permitidas (el contador es atómico)
K="conc:$RANDOM$RANDOM"
for i in $(seq 1 12); do
  ( $P -q -X -t -A -c "select permitido from public.fel_limite_consumir('$K', 3600, 5)" > /tmp/conc_lim_$i.out 2>&1 ) &
done
wait
permitidas=$(cat /tmp/conc_lim_*.out | grep -c '^t$' || true)
[ "$permitidas" = 5 ] || fallar "el limitador permitió $permitidas de 12 (debían ser 5)"
[ "$(q "select contador from public.limites_peticiones where clave='$K'")" = 5 ] || fallar "el contador superó el máximo"
echo "OK concurrencia: limitador atómico"

# ===================== Fase 2: flujo simulado (proveedor mock) bajo concurrencia real =====================
A2=00000000-0000-0000-0000-0000000000a2
q "insert into auth.users (id,email) values ('$A2','a2-conc@fel.test') on conflict do nothing;
   insert into public.perfiles (user_id, activo) values ('$A2', true) on conflict (user_id) do update set activo=true;
   update public.perfiles set activo=true where user_id='$U';
   insert into public.miembros (empresa_id,user_id,rol) values ('$E','$A2','administrador') on conflict do nothing;
   update public.plataforma_parametros set valor=0 where clave in ('espera_conciliacion_manual_min','ventana_tardia_min');" >/dev/null
EST=$(q "select (public.fel_op_establecimiento_guardar('$U','$E',null,'C1','Conc','x','activo')).id")
CAN=$(q "select (public.fel_op_canal_configurar('$U','$E',null,'mock','simulado',true)).id")
doc_sim() { # documento revisado con establecimiento (simulación)
  local id; id=$(q "select (public.fel_op_documento_guardar('$U','$E',null,(select id from public.clientes where empresa_id='$E' limit 1),null,null,'[{\"orden\":1,\"descripcion\":\"x\",\"cantidad\":1,\"precio_unitario\":1}]'::jsonb,1,0,1,'{}'::jsonb,null)).id")
  q "select public.fel_op_documento_establecimiento('$U','$E','$id','$EST')" >/dev/null
  q "select public.fel_op_documento_preparacion('$U','$E','$id','revisado',null,(select version from public.documentos where id='$id'))" >/dev/null
  echo "$id"
}
# 6. solicitudes simuladas simultáneas con claves distintas: una sola operación
D6=$(doc_sim)
correr "select public.fel_op_certificacion_solicitar('$U','$E','$D6','clave-sim-0000006A',public.fel_sys_hash_documento('$E','$D6'),'$CAN')" 6a &
correr "select public.fel_op_certificacion_solicitar('$U','$E','$D6','clave-sim-0000006B',public.fel_sys_hash_documento('$E','$D6'),'$CAN')" 6b &
wait
[ "$(q "select count(*) from public.operaciones_fiscales where documento_id='$D6'")" = 1 ] || fallar "flujo simulado: varias operaciones"
[ "$(cat /tmp/conc_6a.res /tmp/conc_6b.res | grep -c OK)" = 1 ] || fallar "flujo simulado: debía triunfar una sola solicitud"
grep -q "FEL_OPERACION_ABIERTA" /tmp/conc_6a.out /tmp/conc_6b.out || fallar "la perdedora debía recibir FEL_OPERACION_ABIERTA"
echo "OK concurrencia: solicitudes simuladas simultáneas → una sola operación"
# 7. dos procesos intentan MARCAR EL ENVÍO a la vez: solo uno sale (nunca dos envíos)
OP6=$(q "select id from public.operaciones_fiscales where documento_id='$D6'")
correr "select public.fel_sys_operacion_marcar_envio('$E','$OP6')" 7a &
correr "select public.fel_sys_operacion_marcar_envio('$E','$OP6')" 7b &
wait
[ "$(cat /tmp/conc_7a.res /tmp/conc_7b.res | grep -c OK)" = 1 ] || fallar "marcar envío: debía triunfar exactamente un proceso"
grep -q "FEL_YA_ENVIADA" /tmp/conc_7a.out /tmp/conc_7b.out || fallar "el segundo proceso debía recibir FEL_YA_ENVIADA"
echo "OK concurrencia: un solo envío por operación"
# 8. resultado desconocido, propuesta manual doble y aprobación doble: una sola de cada
q "select public.fel_sys_operacion_desconocida('$E','$OP6','corte')" >/dev/null
q "select public.fel_sys_evento_registrar('$E','$OP6','conciliacion','indeterminado','prueba',null,null,null,null)" >/dev/null
EV="jsonb_build_object('fuente','portal_sat_consulta','referencia','consulta-conc-1','fecha_consulta',clock_timestamp(),'conclusion','no_figura')"
correr "select public.fel_op_conciliacion_proponer('$U','$E','$OP6','manual_fallida',$EV,null)" 8a &
correr "select public.fel_op_conciliacion_proponer('$U','$E','$OP6','manual_fallida',$EV,null)" 8b &
wait
[ "$(cat /tmp/conc_8a.res /tmp/conc_8b.res | grep -c OK)" = 1 ] || fallar "propuestas: debía existir una sola propuesta abierta"
[ "$(q "select count(*) from public.conciliaciones where operacion_id='$OP6'")" = 1 ] || fallar "hay varias conciliaciones"
CON=$(q "select id from public.conciliaciones where operacion_id='$OP6'")
correr "select public.fel_op_conciliacion_decidir('$A2','$E','$CON',true,'aprobada por a2 en paralelo')" 9a &
correr "select public.fel_op_conciliacion_decidir('$A2','$E','$CON',true,'aprobada por a2 otra vez')" 9b &
wait
[ "$(cat /tmp/conc_9a.res /tmp/conc_9b.res | grep -c OK)" = 1 ] || fallar "aprobación: debía triunfar una sola"
[ "$(q "select estado_fiscal from public.documentos where id='$D6'")" = rechazado ] || fallar "el documento debía quedar rechazado"
echo "OK concurrencia: propuesta y aprobación únicas"
# 9. carrera entre una RESPUESTA DEL PROVEEDOR (certificado) y una conciliación manual «fallida»: el resultado siempre es coherente
D10=$(doc_sim)
OP10=$(q "select (public.fel_op_certificacion_solicitar('$U','$E','$D10','clave-sim-0000010A',public.fel_sys_hash_documento('$E','$D10'),'$CAN')).id")
q "select public.fel_sys_operacion_marcar_envio('$E','$OP10')" >/dev/null
q "select public.fel_sys_operacion_desconocida('$E','$OP10','timeout')" >/dev/null
q "select public.fel_sys_evento_registrar('$E','$OP10','conciliacion','indeterminado','prueba',null,null,null,null)" >/dev/null
CON10=$(q "select (public.fel_op_conciliacion_proponer('$U','$E','$OP10','manual_fallida',$EV,null)).id")
EVC=$(q "select public.fel_sys_evento_registrar('$E','$OP10','conciliacion','certificado',null,'SIMA','00000010','SIM-CONC-0010',null)")
correr "select public.fel_sys_operacion_resolver_evento('$E','$OP10',$EVC)" 10a &
correr "select public.fel_op_conciliacion_decidir('$A2','$E','$CON10',true,'carrera con el proveedor')" 10b &
wait
estado=$(q "select estado_fiscal from public.documentos where id='$D10'"); alertas=$(q "select count(*) from public.alertas_fiscales where operacion_id='$OP10'")
if [ "$estado" = certificado ]; then [ "$alertas" = 0 ] || fallar "certificado y con alerta"; elif [ "$estado" = rechazado ]; then
  # el proveedor llegó tarde: la certificación huérfana debe quedar registrada (se ejecuta de nuevo el evento: es idempotente)
  q "select public.fel_sys_operacion_resolver_evento('$E','$OP10',$EVC)" >/dev/null; [ "$(q "select count(*) from public.alertas_fiscales where operacion_id='$OP10'")" = 1 ] || fallar "falta la alerta de certificación huérfana"
else fallar "estado inesperado tras la carrera: $estado"; fi
[ "$(q "select count(*) from public.operaciones_fiscales where documento_id='$D10' and estado in ('confirmada_exitosa','confirmada_fallida')")" = 1 ] || fallar "la operación debía cerrarse exactamente una vez"
echo "OK concurrencia: respuesta del proveedor vs conciliación manual → estado coherente ($estado)"
# ===== Fase 4: agente local
CANP=$(q "select (public.fel_op_canal_configurar('$U','$E',null,'portal_playwright','simulado',true)).id")
vincular() { # $1 = letra de la clave; devuelve el id del agente
  local cod; cod=$(q "select public.fel_op_agente_codigo_crear('$U','$E') ->> 'codigo'")
  q "select public.fel_sys_agente_vincular('$cod', repeat('$1',43), 'agente $1', '1') ->> 'agente_id'"
}
AG1=$(vincular K); AG2=$(vincular L)
orden_lista() { # documento + operación con envío marcado + orden vinculada; devuelve «operación orden»
  local d op ord; d=$(doc_sim)
  op=$(q "select (public.fel_op_certificacion_solicitar('$U','$E','$d','clave-ag-$RANDOM$RANDOM$RANDOM',public.fel_sys_hash_documento('$E','$d'),'$CANP')).id")
  q "select public.fel_sys_operacion_marcar_envio('$E','$op')" >/dev/null
  ord=$(q "select public.fel_sys_orden_crear('$E','$op')")
  q "select public.fel_sys_operacion_orden('$E','$op','$ord')" >/dev/null
  echo "$op $ord"
}
# 11. dos agentes reclaman a la vez UNA orden: solo uno la recibe (SKIP LOCKED + token)
read -r OP11 ORD11 < <(orden_lista)
$P -v ON_ERROR_STOP=1 -q -X -t -A -c "begin; select public.fel_sys_orden_reclamar('$AG1'); select pg_sleep(1); commit;" >/tmp/conc_11a.out 2>&1 &
$P -v ON_ERROR_STOP=1 -q -X -t -A -c "begin; select public.fel_sys_orden_reclamar('$AG2'); select pg_sleep(1); commit;" >/tmp/conc_11b.out 2>&1 &
wait
[ "$(cat /tmp/conc_11a.out /tmp/conc_11b.out | grep -c "$ORD11")" = 1 ] || fallar "reclamo: debía recibir la orden exactamente un agente"
[ "$(q "select token from public.ordenes_emision where id='$ORD11'")" = 1 ] || fallar "el token debía ser 1"
echo "OK concurrencia: dos agentes, una orden → un solo reclamo"
# 12. dos creaciones simultáneas de la orden de la MISMA operación: una sola orden
DOC12=$(doc_sim)
OP12=$(q "select (public.fel_op_certificacion_solicitar('$U','$E','$DOC12','clave-ag-0000012A',public.fel_sys_hash_documento('$E','$DOC12'),'$CANP')).id")
q "select public.fel_sys_operacion_marcar_envio('$E','$OP12')" >/dev/null
correr "select public.fel_sys_orden_crear('$E','$OP12')" 12a &
correr "select public.fel_sys_orden_crear('$E','$OP12')" 12b &
wait
[ "$(cat /tmp/conc_12a.res /tmp/conc_12b.res | grep -c OK)" = 1 ] || fallar "orden: debía crearse exactamente una"
[ "$(q "select count(*) from public.ordenes_emision where operacion_id='$OP12'")" = 1 ] || fallar "hay órdenes duplicadas"
echo "OK concurrencia: una sola orden por operación"
# 13. carrera entre el RESULTADO del agente y el VENCIMIENTO del arrendamiento: el estado final es coherente y la operación nunca queda sin proteger
AG3=$(vincular M)   # agente libre (AG1/AG2 pueden conservar la orden del caso 11)
read -r OP13 ORD13 < <(orden_lista)
T13=$(q "select (public.fel_sys_orden_reclamar('$AG3') ->> 'token')")
q "select public.fel_sys_orden_progreso('$AG3','$ORD13',$T13,'detenido_en_vista_previa')" >/dev/null
q "update public.ordenes_emision set lease_hasta = clock_timestamp() - interval '1 second' where id='$ORD13'"
correr "select public.fel_sys_ordenes_vencer('$E')" 13a &
correr "select public.fel_sys_orden_resultado('$AG3','$ORD13',$T13,'emitido_simulado','SIMA','00000013','SIM-CONC-0013',null)" 13b &
wait
est=$(q "select estado from public.ordenes_emision where id='$ORD13'")
case "$est" in
  incierta) [ "$(q "select estado from public.operaciones_fiscales where id='$OP13'")" = desconocida ] || fallar "orden incierta pero la operación no está por verificar";;
  *) fallar "con el arrendamiento vencido el resultado no debía aceptarse (estado: $est)";;
esac
echo "OK concurrencia: resultado vs vencimiento → incierta y por_verificar (nunca se acepta un resultado vencido)"

# ===== D2-1 · bolsón global (mundo A): sesiones simultáneas reales =====
oks() { cat /tmp/conc_$1_*.res 2>/dev/null | grep -c OK || true; }
errs_con() { cat /tmp/conc_$1_*.out 2>/dev/null | grep -c "$2" || true; }
# 14. seis creaciones simultáneas de la MISMA cuenta: una sola cuenta, un solo saldo, reglas sin duplicar; todas reciben la misma
for i in 1 2 3 4 5 6; do correr "select public.fel_admin_bolson_cuenta_crear('$A','digifact','pruebas','CONC-CUENTA-14')" b14_$i & done
wait
[ "$(oks b14)" = 6 ] || fallar "bolsón: las 6 creaciones idénticas debían tener éxito (idempotentes), tuvieron $(oks b14)"
[ "$(q "select count(*) from public.bolson_cuentas where referencia_externa='CONC-CUENTA-14'")" = 1 ] || fallar "bolsón: se duplicó la cuenta"
C14=$(q "select id from public.bolson_cuentas where referencia_externa='CONC-CUENTA-14'")
[ "$(q "select count(*) from public.bolson_saldos where cuenta_id='$C14'")" = 1 ] || fallar "bolsón: saldo duplicado"
[ "$(q "select count(*) from public.bolson_reglas_consumo where cuenta_id='$C14' and vigente_hasta is null")" = "$(q "select count(*) from public.evento_tipos")" ] || fallar "bolsón: reglas iniciales duplicadas o faltantes"
echo "OK concurrencia: bolsón · cuenta creada una sola vez"
# 15. ocho compras simultáneas IDÉNTICAS (misma referencia): un solo lote y el saldo suma una sola vez
for i in 1 2 3 4 5 6 7 8; do correr "select public.fel_admin_bolson_lote_registrar('$A','$C14',100,50,'CONC-LOTE-15')" b15_$i & done
wait
[ "$(oks b15)" = 8 ] || fallar "bolsón: las compras idénticas debían ser idempotentes (éxito en todas), tuvieron $(oks b15)"
[ "$(q "select count(*) from public.bolson_lotes where cuenta_id='$C14' and referencia_proveedor='CONC-LOTE-15'")" = 1 ] || fallar "bolsón: lote duplicado"
[ "$(q "select comprado from public.bolson_saldos where cuenta_id='$C14'")" = 100.000000 ] || fallar "bolsón: el saldo no suma el lote exactamente una vez"
echo "OK concurrencia: bolsón · compras idénticas simultáneas → un solo lote y saldo exacto"
# 16. seis compras simultáneas con la MISMA referencia y datos DISTINTOS: gana una; las demás reciben FEL_IDEMPOTENCIA; saldo = la ganadora
for i in 1 2 3 4 5 6; do correr "select public.fel_admin_bolson_lote_registrar('$A','$C14',$((200+i)),10,'CONC-LOTE-16')" b16_$i & done
wait
[ "$(oks b16)" = 1 ] || fallar "bolsón: con datos distintos debía ganar exactamente una (ganaron $(oks b16))"
[ "$(errs_con b16 FEL_IDEMPOTENCIA)" = 5 ] || fallar "bolsón: las 5 perdedoras debían recibir FEL_IDEMPOTENCIA"
[ "$(q "select count(*) from public.bolson_lotes where cuenta_id='$C14' and referencia_proveedor='CONC-LOTE-16'")" = 1 ] || fallar "bolsón: hay más de un lote con la misma referencia"
[ "$(q "select comprado from public.bolson_saldos where cuenta_id='$C14'")" = "$(q "select sum(unidades) from public.bolson_lotes where cuenta_id='$C14'")" ] || fallar "bolsón: el saldo no coincide con el libro"
echo "OK concurrencia: bolsón · misma referencia con datos distintos → una sola ganadora"
# 17. diez compras simultáneas DISTINTAS en una cuenta nueva: el saldo es exactamente la suma (sin pérdidas por actualizaciones simultáneas)
q "select public.fel_admin_bolson_cuenta_crear('$A','digifact','pruebas','CONC-CUENTA-17')" >/dev/null
C17=$(q "select id from public.bolson_cuentas where referencia_externa='CONC-CUENTA-17'")
for i in 1 2 3 4 5 6 7 8 9 10; do correr "select public.fel_admin_bolson_lote_registrar('$A','$C17',$i,$i,'CONC-LOTE-17-$i')" b17_$i & done
wait
[ "$(oks b17)" = 10 ] || fallar "bolsón: las 10 compras distintas debían tener éxito (tuvieron $(oks b17))"
[ "$(q "select comprado from public.bolson_saldos where cuenta_id='$C17'")" = 55.000000 ] || fallar "bolsón: se perdió una actualización del saldo (esperado 55)"
echo "OK concurrencia: bolsón · compras simultáneas distintas → saldo exacto (55)"
# 18. seis registros simultáneos de regla para la misma cuenta y evento: todos terminan; una sola vigente y ninguna vigencia solapada
for i in 1 2 3 4 5 6; do correr "select public.fel_admin_bolson_regla_registrar('$A','$C17','consulta','si',$i,true,'observado_en_pruebas',jsonb_build_object('n',$i))" b18_$i & done
wait
[ "$(oks b18)" = 6 ] || fallar "bolsón: los 6 cambios de regla debían serializarse con éxito (tuvieron $(oks b18))"
[ "$(q "select count(*) from public.bolson_reglas_consumo where cuenta_id='$C17' and evento_tipo='consulta' and vigente_hasta is null")" = 1 ] || fallar "bolsón: debe haber exactamente una regla vigente"
[ "$(q "select count(*) from public.bolson_reglas_consumo where cuenta_id='$C17' and evento_tipo='consulta'")" = 7 ] || fallar "bolsón: debían existir 7 versiones (la inicial + 6)"
[ "$(q "select count(*) from public.bolson_reglas_consumo a join public.bolson_reglas_consumo b on a.cuenta_id=b.cuenta_id and a.evento_tipo=b.evento_tipo and a.id<b.id where a.cuenta_id='$C17' and a.evento_tipo='consulta' and tstzrange(a.vigente_desde,a.vigente_hasta,'[)') && tstzrange(b.vigente_desde,b.vigente_hasta,'[)')")" = 0 ] || fallar "bolsón: hay vigencias solapadas"
echo "OK concurrencia: bolsón · cambios de regla simultáneos → serializados, una sola vigente, sin solapes"
# 19. compras simultáneas mientras la cuenta se cierra: el saldo siempre coincide con el libro y la cuenta queda cerrada
q "select public.fel_admin_bolson_cuenta_crear('$A','digifact','pruebas','CONC-CUENTA-19')" >/dev/null
C19=$(q "select id from public.bolson_cuentas where referencia_externa='CONC-CUENTA-19'")
correr "select public.fel_admin_bolson_cuenta_estado('$A','$C19','cerrada','Cierre concurrente de prueba')" b19_c &
for i in 1 2 3 4; do correr "select public.fel_admin_bolson_lote_registrar('$A','$C19',$i,$i,'CONC-LOTE-19-$i')" b19_$i & done
wait
[ "$(q "select estado from public.bolson_cuentas where id='$C19'")" = cerrada ] || fallar "bolsón: la cuenta debía quedar cerrada"
[ "$(q "select comprado from public.bolson_saldos where cuenta_id='$C19'")" = "$(q "select coalesce(sum(unidades),0) from public.bolson_lotes where cuenta_id='$C19'")" ] || fallar "bolsón: el saldo no coincide con el libro tras el cierre concurrente"
echo "OK concurrencia: bolsón · compras vs cierre de cuenta → saldo = libro"
# 20. el mismo extracto importado por seis sesiones a la vez: uno solo; y la misma línea desde dos extractos a la vez: una sola
for i in 1 2 3 4 5 6; do correr "insert into public.bolson_extractos (cuenta_id,periodo_desde,periodo_hasta,fuente,hash_contenido,saldo_inicial,saldo_final) values ('$C14','2026-11-01','2026-11-30','archivo',repeat('f',64),1,1)" b20_$i & done
wait
[ "$(oks b20)" = 1 ] && [ "$(q "select count(*) from public.bolson_extractos where cuenta_id='$C14' and hash_contenido=repeat('f',64)")" = 1 ] || fallar "bolsón: el mismo extracto se importó más de una vez"
q "insert into public.bolson_extractos (cuenta_id,periodo_desde,periodo_hasta,fuente,hash_contenido,saldo_inicial,saldo_final) values ('$C14','2026-11-01','2026-11-30','archivo',repeat('e',64),1,1)" >/dev/null
EA=$(q "select id from public.bolson_extractos where cuenta_id='$C14' and hash_contenido=repeat('f',64)"); EB=$(q "select id from public.bolson_extractos where cuenta_id='$C14' and hash_contenido=repeat('e',64)")
correr "insert into public.bolson_extracto_lineas (extracto_id,cuenta_id,numero_linea,referencia_externa,evento_externo,unidades,ocurrido_en,hash_linea) values ('$EA','$C14',1,'U','CERT',1,now(),repeat('7',64))" b20l_a &
correr "insert into public.bolson_extracto_lineas (extracto_id,cuenta_id,numero_linea,referencia_externa,evento_externo,unidades,ocurrido_en,hash_linea) values ('$EB','$C14',1,'U','CERT',1,now(),repeat('7',64))" b20l_b &
wait
[ "$(oks b20l)" = 1 ] && [ "$(q "select count(*) from public.bolson_extracto_lineas where cuenta_id='$C14' and hash_linea=repeat('7',64)")" = 1 ] || fallar "bolsón: la misma línea se aceptó desde dos extractos"
echo "OK concurrencia: bolsón · extractos y líneas duplicados simultáneos → una sola"

# ===== D2-2 · consumos y libro del bolsón: sesiones simultáneas reales =====
NDOC=800000
nueva_cuenta() { # $1=referencia $2=unidades de la compra $3=unidades que consume «consulta»; imprime el id de la cuenta
  q "select public.fel_admin_bolson_cuenta_crear('$A','digifact','pruebas','$1')" >/dev/null
  local c; c=$(q "select id from public.bolson_cuentas where referencia_externa='$1'")
  q "select public.fel_admin_bolson_lote_registrar('$A','$c',$2,1,'LOTE-$1')" >/dev/null
  q "select public.fel_admin_bolson_regla_registrar('$A','$c','consulta','si',$3,true,'contrato_escrito',jsonb_build_object('doc','conc'))" >/dev/null
  echo "$c"
}
nuevo_consumo() { # $1=cuenta $2=clave; imprime el id del consumo (consulta, sin operación)
  q "select (public.fel_sys_consumo_reservar('$E','$1','consulta',null,null,rpad('$2',16,'_'),repeat('b',64))).id"
}
nueva_operacion_pruebas() { # imprime el id de una operación de certificación en «pruebas» de digifact
  NDOC=$((NDOC+1))
  q "with d as (insert into public.documentos (empresa_id, numero_borrador) values ('$E', $NDOC) returning id)
     insert into public.operaciones_fiscales (empresa_id, documento_id, tipo, clave_idempotencia, hash_contenido, proveedor, ambiente)
     select '$E', d.id, 'certificacion', 'op-conc-' || gen_random_uuid(), repeat('a',64), 'digifact', 'pruebas' from d returning id"
}
saldos_ok() { [ "$(q "select count(*) from public.fel_sys_verificar_saldos() where not ok")" = 0 ] && [ "$(q "select count(*) from public.bolson_saldos where comprado+ajustado-consumido-reservado < 0")" = 0 ]; }
# 21. ocho reservas simultáneas IDÉNTICAS: un solo consumo, todas lo reciben, la reserva cuenta una sola vez
C21=$(nueva_cuenta CONC-D22-21 10 1)
for i in 1 2 3 4 5 6 7 8; do correr "select public.fel_sys_consumo_reservar('$E','$C21','consulta',null,null,'k-c21-0000000001',repeat('b',64))" b21_$i & done
wait
[ "$(oks b21)" = 8 ] || fallar "consumos: las 8 reservas idénticas debían ser idempotentes (tuvieron $(oks b21))"
[ "$(q "select count(*) from public.consumos where cuenta_id='$C21'")" = 1 ] || fallar "consumos: se duplicó el consumo"
[ "$(q "select reservado from public.bolson_saldos where cuenta_id='$C21'")" = 1.000000 ] || fallar "consumos: la reserva no cuenta exactamente una vez"
[ "$(q "select count(*) from public.bolson_movimientos where cuenta_id='$C21' and tipo='reserva'")" = 1 ] || fallar "consumos: movimientos de reserva duplicados"
saldos_ok || fallar "consumos: el libro no reproduce los saldos (21)"
echo "OK concurrencia: consumos · reservas idénticas simultáneas → un solo consumo"
# 22. doce reservas simultáneas distintas por solo 5 unidades: exactamente 5 triunfan y 7 reciben FEL_BOLSON_AGOTADO (nunca se sobreasigna)
C22=$(nueva_cuenta CONC-D22-22 5 1)
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do correr "select public.fel_sys_consumo_reservar('$E','$C22','consulta',null,null,rpad('k-c22-$i',16,'_'),repeat('b',64))" b22_$i & done
wait
[ "$(oks b22)" = 5 ] || fallar "consumos: debían triunfar exactamente 5 reservas (triunfaron $(oks b22))"
[ "$(errs_con b22 FEL_BOLSON_AGOTADO)" = 7 ] || fallar "consumos: las 7 restantes debían recibir FEL_BOLSON_AGOTADO"
[ "$(q "select reservado from public.bolson_saldos where cuenta_id='$C22'")" = 5.000000 ] || fallar "consumos: lo reservado debía ser exactamente 5"
[ "$(q "select count(*) from public.consumos where cuenta_id='$C22'")" = 5 ] || fallar "consumos: debían existir 5 consumos"
saldos_ok || fallar "consumos: el libro no reproduce los saldos (22)"
echo "OK concurrencia: consumos · 12 reservas por 5 unidades → 5 triunfan, 7 agotado"
# 23. confirmar y liberar a la vez sobre el mismo consumo: exactamente uno gana; el otro recibe FEL_ESTADO; el saldo es coherente
C23=$(nueva_cuenta CONC-D22-23 10 1); K23=$(nuevo_consumo "$C23" k-c23-0000000001)
correr "select public.fel_sys_consumo_confirmar('$E','$K23')" b23_c &
correr "select public.fel_sys_consumo_liberar('$E','$K23','no_enviado',jsonb_build_object('x',1))" b23_l &
wait
[ "$(oks b23)" = 1 ] || fallar "consumos: confirmar y liberar simultáneos debían tener un único ganador (ganaron $(oks b23))"
[ "$(errs_con b23 FEL_ESTADO)" = 1 ] || fallar "consumos: el perdedor debía recibir FEL_ESTADO"
[ "$(q "select count(*) from public.bolson_movimientos where consumo_id='$K23' and tipo in ('consumo','liberacion')")" = 1 ] || fallar "consumos: debe existir un único movimiento de cierre"
[ "$(q "select reservado from public.bolson_saldos where cuenta_id='$C23'")" = 0.000000 ] || fallar "consumos: la reserva debía quedar resuelta"
saldos_ok || fallar "consumos: el libro no reproduce los saldos (23)"
echo "OK concurrencia: consumos · confirmar vs liberar → un solo ganador y saldo coherente"
# 24. seis confirmaciones idénticas simultáneas: todas responden igual y el consumo se registra una sola vez
K24=$(nuevo_consumo "$C23" k-c24-0000000001)
for i in 1 2 3 4 5 6; do correr "select public.fel_sys_consumo_confirmar('$E','$K24',1,'REF-C24')" b24_$i & done
wait
[ "$(oks b24)" = 6 ] || fallar "consumos: las 6 confirmaciones idénticas debían ser idempotentes (tuvieron $(oks b24))"
[ "$(q "select count(*) from public.bolson_movimientos where consumo_id='$K24' and tipo='consumo'")" = 1 ] || fallar "consumos: el consumo se registró más de una vez"
[ "$(q "select consumido from public.bolson_saldos where cuenta_id='$C23'")" = "$(q "select coalesce(sum(unidades_consumidas),0) from public.consumos where cuenta_id='$C23' and estado='confirmado'")" ] || fallar "consumos: lo consumido debía coincidir con la suma de los consumos confirmados"
[ "$(q "select unidades_consumidas from public.consumos where id='$K24'")" = 1.000000 ] || fallar "consumos: el consumo del caso 24 debía ser 1"
saldos_ok || fallar "consumos: el libro no reproduce los saldos (24)"
echo "OK concurrencia: consumos · confirmaciones idénticas simultáneas → un solo consumo"
# 25. seis reservas simultáneas de certificación para la MISMA operación con claves distintas: solo una triunfa
OP25=$(nueva_operacion_pruebas); C25=$(nueva_cuenta CONC-D22-25 10 1)
for i in 1 2 3 4 5 6; do correr "select public.fel_sys_consumo_reservar('$E','$C25','certificacion','$OP25',null,'k-c25-000000000$i',repeat('b',64))" b25_$i & done
wait
[ "$(oks b25)" = 1 ] || fallar "consumos: debía triunfar exactamente una reserva para la operación (triunfaron $(oks b25))"
[ "$(errs_con b25 FEL_OPERACION_CON_CONSUMO)" = 5 ] || fallar "consumos: las otras 5 debían recibir FEL_OPERACION_CON_CONSUMO"
[ "$(q "select count(*) from public.consumos where operacion_id='$OP25'")" = 1 ] || fallar "consumos: hay más de un consumo para la operación"
[ "$(q "select reservado from public.bolson_saldos where cuenta_id='$C25'")" = 1.000000 ] || fallar "consumos: lo reservado debía ser 1"
saldos_ok || fallar "consumos: el libro no reproduce los saldos (25)"
echo "OK concurrencia: consumos · una operación, un consumo (claves distintas)"
# 26. tormenta mezclada: confirmar, liberar, reservar y comprar a la vez sobre una misma cuenta; sin interbloqueos y con el libro exacto
C26=$(nueva_cuenta CONC-D22-26 40 1); declare -a K26=()
for i in $(seq 1 20); do K26+=("$(nuevo_consumo "$C26" "k-c26-pre-$i")"); done
for i in $(seq 0 19); do
  if [ $((i % 2)) = 0 ]; then correr "select public.fel_sys_consumo_confirmar('$E','${K26[$i]}')" b26_c$i & else correr "select public.fel_sys_consumo_liberar('$E','${K26[$i]}','no_enviado',jsonb_build_object('x',$i))" b26_l$i & fi
done
for i in $(seq 1 12); do correr "select public.fel_sys_consumo_reservar('$E','$C26','consulta',null,null,rpad('k-c26-nuevo-$i',16,'_'),repeat('b',64))" b26_n$i & done
for i in 1 2 3; do correr "select public.fel_admin_bolson_lote_registrar('$A','$C26',$((i*5)),1,'LOTE-C26-$i')" b26_p$i & done
wait
[ "$(oks b26)" = 35 ] || fallar "consumos: en la tormenta debían triunfar las 35 operaciones (triunfaron $(oks b26)); errores: $(cat /tmp/conc_b26_*.out | grep -c ERROR)"
[ "$(cat /tmp/conc_b26_*.out | grep -ci deadlock)" = 0 ] || fallar "consumos: hubo interbloqueos"
[ "$(q "select count(*) from public.consumos where cuenta_id='$C26' and estado='confirmado'")" = 10 ] && [ "$(q "select count(*) from public.consumos where cuenta_id='$C26' and estado='liberado'")" = 10 ] || fallar "consumos: debían quedar 10 confirmados y 10 liberados"
[ "$(q "select count(*) from public.consumos where cuenta_id='$C26' and estado='reservado'")" = 12 ] || fallar "consumos: debían quedar 12 reservados nuevos"
saldos_ok || fallar "consumos: el libro no reproduce los saldos tras la tormenta"
echo "OK concurrencia: consumos · tormenta mezclada → sin interbloqueos y libro exacto"
# 27. vigilancia simultánea (seis sesiones): una sola alerta y el consumo sigue reservado; revisiones simultáneas no duplican alertas ni liberan nada
K27=$(nuevo_consumo "$C26" k-c27-0000000001)
for i in 1 2 3 4 5 6; do correr "select public.fel_sys_consumo_vigilar('$E','$K27','tiempo agotado')" b27_$i & done
wait
[ "$(oks b27)" = 6 ] || fallar "consumos: las 6 vigilancias debían ser idempotentes (tuvieron $(oks b27))"
[ "$(q "select count(*) from public.bolson_alertas where consumo_id='$K27' and tipo='consumo_incierto'")" = 1 ] || fallar "consumos: alertas de vigilancia duplicadas"
[ "$(q "select estado||'/'||en_vigilancia from public.consumos where id='$K27'")" = "reservado/true" ] || fallar "consumos: debía seguir reservado y en vigilancia"
for i in 1 2 3 4; do correr "select public.fel_sys_bolson_revisar(1)" b27r_$i & done
wait
[ "$(oks b27r)" = 4 ] || fallar "consumos: las revisiones simultáneas debían terminar sin error (terminaron $(oks b27r))"
[ "$(q "select max(n) from (select count(*) n from public.bolson_alertas where resuelta_en is null and consumo_id is not null group by consumo_id, tipo) x")" = 1 ] || fallar "consumos: alertas duplicadas tras revisiones simultáneas"
[ "$(q "select estado from public.consumos where id='$K27'")" = reservado ] || fallar "consumos: la revisión no debe liberar"
saldos_ok || fallar "consumos: el libro no reproduce los saldos (27)"
echo "OK concurrencia: consumos · vigilancia y revisión simultáneas → una alerta y nada liberado"
echo "CONCURRENCIA OK"
