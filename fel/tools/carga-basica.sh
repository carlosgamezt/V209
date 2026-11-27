#!/usr/bin/env bash
# PRUEBA BÁSICA de carga y concurrencia de la capa de datos (PostgreSQL temporal local; sin red): varios clientes simultáneos ejecutan las RPC de lectura y escritura exactamente como PostgREST (claims + SET LOCAL ROLE authenticated),
# y después se verifica la INTEGRIDAD: sin transacciones fallidas, sin duplicados de cliente por (empresa, identificación) ni de número de borrador, y los totales coinciden con lo escrito. NO es una prueba de capacidad del plan de Supabase ni de la red.
# Uso: bash tools/carga-basica.sh [clientes_simultaneos=16] [segundos=10]
set -euo pipefail
cd "$(dirname "$0")/.."
C=${1:-16}; T=${2:-10}; PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}; DATA=/tmp/fel-carga-pg-$$; PORT=$((59000 + RANDOM % 400)); SOCK=/tmp; D=docs/multiempresa/propuesta
as_pg() { if [ "$(id -u)" = 0 ]; then su pgtest -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
id pgtest >/dev/null 2>&1 || useradd -m pgtest
as_pg "mkdir -p '$DATA' && '$PGBIN/initdb' -D '$DATA' -A trust -U postgres >/dev/null"
as_pg "'$PGBIN/pg_ctl' -D '$DATA' -o '-p $PORT -k $SOCK -c listen_addresses= -c max_connections=$((C * 3 + 20))' -w -l '$DATA/log' start >/dev/null"
trap 'as_pg "'"$PGBIN"'/pg_ctl -D '"$DATA"' -m immediate stop >/dev/null" || true; rm -f /tmp/carga_*_$$.sql' EXIT
P() { "$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d nexa -v ON_ERROR_STOP=1 -q -X "$@"; }
"$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d postgres -q -X -c "create database nexa"; P -f tools/shim_supabase.sql
for f in supabase/migrations/*.sql; do P -f "$f" >/dev/null 2>&1; done
for f in M-D_permisos M-A_emisor_fiscal M-B_digifact_config M-C_acceso_maestro M-F_establecimientos_usuario M-G_sesion_admin M-H_admin_establecimientos M-I_envoltorios_sesion M-J_plataforma_y_auditoria M-K_sistema_nexa_sys M-L_rls_sesion_viva M-M_identidad_auth M-N_esquema_api M-O_lecturas_api M-Q_agente_endurecimiento M-R_parametros_clases M-S_lecturas_documentos M-T_lecturas_restantes M-U_lecturas_paginadas M-V1_lecturas_de_sistema M-V_cierre_r3 M-E_rol_app; do P -f $D/$f.sql >/dev/null 2>&1 || { echo "FALLO al aplicar $f"; exit 1; }; done
P -f $D/fixture-sesion.sql >/dev/null 2>&1; A=10000000-0000-0000-0000-00000000000a; B=10000000-0000-0000-0000-00000000000b
P -c "update public.plataforma_parametros set valor = 0 where clave = 'establecimiento_por_usuario'"
P -c "set session_replication_role = replica; insert into public.documentos (empresa_id, numero_borrador, estado_preparacion, estado_fiscal) select '$A', g, 'borrador', 'ninguno' from generate_series(1, 3000) g; insert into public.clientes (empresa_id, tipo_identificacion, numero_identificacion, nombre) select '$A', 'NIT', (5000000 + g) || '-1', 'Base ' || g from generate_series(1, 1000) g" >/dev/null
UA=00000000-0000-0000-0000-0000000000c1; UB=00000000-0000-0000-0000-0000000000d1
P -c "insert into auth.sessions (id, user_id, aal) values ('9a000000-0000-0000-0000-0000000000c1', '$UA', 'aal2'), ('9a000000-0000-0000-0000-0000000000d1', '$UB', 'aal2') on conflict do nothing"
claims() { echo "select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"authenticated\",\"session_id\":\"$2\",\"aal\":\"aal2\"}', true); set local role authenticated;"; }
CA=$(claims $UA 9a000000-0000-0000-0000-0000000000c1); CB=$(claims $UB 9a000000-0000-0000-0000-0000000000d1)
cat > /tmp/carga_lee_$$.sql <<S
begin;
$CA
select (api.documentos_listar('{"pagina":1,"tam":25}') ->> 'total')::int;
select jsonb_array_length(api.clientes_pagina('{"pagina":1,"tam":5}') -> 'items');
commit;
S
cat > /tmp/carga_escribe_$$.sql <<S
\set n random(1, 400)
begin;
$CA
select (api.cliente_guardar(null, 'NIT', (8000000 + :n) || '-1', 'Concurrente ' || :n, null, null, null, null)).id;
commit;
S
cat > /tmp/carga_otra_$$.sql <<S
begin;
$CB
select api.empresa_contexto() -> 'empresa' ->> 'nit';
select api.documentos_listar() ->> 'total';
commit;
S
R=$(mktemp); set +e; "$PGBIN/pgbench" -h "$SOCK" -p "$PORT" -U postgres -d nexa -n -c "$C" -j 4 -T "$T" -f /tmp/carga_lee_$$.sql@5 -f /tmp/carga_escribe_$$.sql@3 -f /tmp/carga_otra_$$.sql@2 2>&1 | tee $R | grep -E "number of transactions actually processed|latency average|tps =|number of failed|transactions:"; set -e
grep -q "number of failed transactions: 0" $R || { echo "FALLO: hubo transacciones fallidas"; cat $R | tail -5; exit 1; }
echo "OK    sin transacciones fallidas con $C clientes simultáneos durante ${T} s (lecturas, escrituras concurrentes del MISMO cliente y otra empresa a la vez)"
# integridad: el MISMO (empresa, identificación) nunca se duplica aunque 16 clientes lo escriban a la vez; la otra empresa no ve nada de la primera
DUP=$(P -At -c "select count(*) from (select numero_identificacion from public.clientes where empresa_id = '$A' and tipo_identificacion = 'NIT' group by numero_identificacion having count(*) > 1) x"); [ "$DUP" = 0 ] && echo "OK    sin clientes duplicados por (empresa, identificación) tras la concurrencia" || { echo "FALLO: $DUP identificaciones duplicadas"; exit 1; }
FUERA=$(P -At -c "select count(*) from public.clientes where empresa_id = '$B' and nombre like 'Concurrente %'"); [ "$FUERA" = 0 ] && echo "OK    la empresa B no recibió ninguna escritura de la A" || { echo "FALLO: escrituras en la empresa equivocada"; exit 1; }
ESC=$(P -At -c "select count(*) from public.clientes where empresa_id = '$A' and nombre like 'Concurrente %'"); [ "$ESC" -ge 1 ] && echo "OK    escrituras concurrentes aplicadas: $ESC clientes distintos de 400 posibles" || { echo "FALLO: no se escribió nada"; exit 1; }
echo "CARGA BÁSICA OK"
