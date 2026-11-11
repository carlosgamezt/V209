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
echo "CONCURRENCIA OK"
