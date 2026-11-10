#!/usr/bin/env bash
# Operaciones concurrentes reales (dos sesiones psql a la vez) sobre una base DESECHABLE (deja datos de prueba).
# Uso: PSQL_CMD="psql -h ... -U postgres -d postgres" bash concurrencia.sh
set -euo pipefail
P=${PSQL_CMD:?define PSQL_CMD}
q() { $P -v ON_ERROR_STOP=1 -q -X -t -A -c "$1"; }
A=00000000-0000-0000-0000-0000000000a1; U=00000000-0000-0000-0000-0000000000b1
E=10000000-0000-0000-0000-0000000000c1
q "insert into auth.users (id,email) values ('$A','m-conc@fel.test'),('$U','p-conc@fel.test');
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
echo "CONCURRENCIA OK"
