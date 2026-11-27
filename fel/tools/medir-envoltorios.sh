#!/usr/bin/env bash
# MEDICIÓN del costo en la BASE de los envoltorios de identidad frente a la función interna (R2/F1…F4). PostgreSQL temporal LOCAL (sin red, sin Supabase). Compara con pgbench:
#   interna (superusuario)  vs  envoltorio (nexa_app con sesión)  vs  solo la validación de sesión.
# Es una medición de la base: NO incluye la red ni las optimizaciones de #55 (eso se mide en nexa-fel-test con tools de nube/medir_*.cjs). Uso: bash tools/medir-envoltorios.sh [segundos]
set -euo pipefail
cd "$(dirname "$0")/.."
T=${1:-5}; PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}; DATA=/tmp/fel-med-pg-$$; PORT=$((57000 + RANDOM % 900)); SOCK=/tmp
as_pg() { if [ "$(id -u)" = 0 ]; then su pgtest -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
id pgtest >/dev/null 2>&1 || useradd -m pgtest
as_pg "mkdir -p '$DATA' && '$PGBIN/initdb' -D '$DATA' -A trust -U postgres >/dev/null"
as_pg "'$PGBIN/pg_ctl' -D '$DATA' -o '-p $PORT -k $SOCK -c listen_addresses=127.0.0.1 -c max_connections=100' -w -l '$DATA/log' start >/dev/null"
trap 'as_pg "'"$PGBIN"'/pg_ctl -D '"$DATA"' -m immediate stop >/dev/null" || true' EXIT
D=docs/multiempresa/propuesta; export PGPASSWORD=prueba-local
P() { "$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d nexa -v ON_ERROR_STOP=1 -q -X "$@"; }
"$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d postgres -q -X -c "create database nexa" ; P -f tools/shim_supabase.sql
for f in supabase/migrations/*.sql; do P -f "$f" >/dev/null 2>&1; done
for f in M-D_permisos M-A_emisor_fiscal M-B_digifact_config M-C_acceso_maestro M-F_establecimientos_usuario M-G_sesion_admin M-H_admin_establecimientos M-I_envoltorios_sesion M-J_plataforma_y_auditoria M-K_sistema_nexa_sys M-L_rls_sesion_viva M-M_identidad_auth M-N_esquema_api M-O_lecturas_api M-Q_agente_endurecimiento M-R_parametros_clases M-S_lecturas_documentos M-T_lecturas_restantes M-U_lecturas_paginadas M-V1_lecturas_de_sistema M-V_cierre_r3 M-E_rol_app; do P --single-transaction -f $D/$f.sql >/dev/null; done
P -c "alter role nexa_app login password 'prueba-local'"; P -f $D/fixture-sesion.sql >/dev/null 2>&1
cat > /tmp/med_a_$$.sql <<'S1'
select count(*) from public.fel_op_miembros_listar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a');
S1
cat > /tmp/med_b_$$.sql <<'S2'
select count(*) from public.fel_ses_miembros_listar('tok-propa-0123456789abcdef');
S2
cat > /tmp/med_c_$$.sql <<'S3'
select o_user from public.fel__sesion_empresa('tok-propa-0123456789abcdef');
S3
cat > /tmp/med_d_$$.sql <<'S4'
\set n random(1, 100000000)
select (public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, 'NIT', :n || '-1', 'Cliente medición', null, null, null, null)).id;
S4
cat > /tmp/med_e_$$.sql <<'S5'
\set n random(1, 100000000)
select (public.fel_ses_cliente_guardar('tok-propa-0123456789abcdef', null, 'NIT', :n || '-1', 'Cliente medición', null, null, null, null)).id;
S5
P -c "insert into auth.sessions (id, user_id, aal) values ('95000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', 'aal2') on conflict do nothing"
CLAIMS="select set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-0000000000c1\",\"role\":\"authenticated\",\"session_id\":\"95000000-0000-0000-0000-0000000000c1\",\"aal\":\"aal2\"}', true); set local role authenticated;"
cat > /tmp/med_f_$$.sql <<S6
select (select count(*) from public.establecimientos where empresa_id = '10000000-0000-0000-0000-00000000000a' and estado = 'activo') + (select count(*) from public.clientes where empresa_id = '10000000-0000-0000-0000-00000000000a' and activo) + (select count(*) from public.conceptos where empresa_id = '10000000-0000-0000-0000-00000000000a' and activo);
S6
cat > /tmp/med_g_$$.sql <<S7
begin;
$CLAIMS
select jsonb_array_length(api.estado_catalogos() -> 'clientes');
commit;
S7
cat > /tmp/med_h_$$.sql <<S8
\set n random(1, 100000000)
begin;
$CLAIMS
select (api.cliente_guardar(null, 'NIT', :n || '-1', 'Cliente medición', null, null, null, null)).id;
commit;
S8
bench() { { "$PGBIN/pgbench" -h "$SOCK" -p "$PORT" -U "$2" -d nexa -n -f "$3" -c 1 -j 1 -T "$T" 2>&1 | awk -v r="$1" '/latency average/ {l=$4} /tps =/ {t=$3} END {printf "%-62s %8.3f ms  %9.0f tps\n", r, l, t}'; } || true; }
echo "Medición en la base local (1 conexión, ${T} s por caso; sin red):"
bench "LECTURA  interna fel_op_miembros_listar (superusuario)" postgres /tmp/med_a_$$.sql
bench "LECTURA  envoltorio fel_ses_miembros_listar (nexa_app + sesión)" nexa_app /tmp/med_b_$$.sql
bench "SOLO la validación de la sesión (fel__sesion_empresa, superusuario)" postgres /tmp/med_c_$$.sql
P -c "insert into public.clientes (empresa_id, tipo_identificacion, numero_identificacion, nombre) select '10000000-0000-0000-0000-00000000000a', 'NIT', (7000000 + g) || '-1', 'Cliente vol ' || g from generate_series(1, 300) g on conflict do nothing" >/dev/null
bench "LECTURA  «estado»: 3 consultas directas (superusuario; sin RLS)" postgres /tmp/med_f_$$.sql
bench "LECTURA  api.estado_catalogos (authenticated + RLS + sesión viva + claims)" postgres /tmp/med_g_$$.sql
bench "ESCRITURA interna fel_op_cliente_guardar (superusuario)" postgres /tmp/med_d_$$.sql
bench "ESCRITURA envoltorio fel_ses_cliente_guardar (nexa_app + sesión)" nexa_app /tmp/med_e_$$.sql
bench "ESCRITURA api.cliente_guardar (authenticated + sesión viva + aal2 + claims)" postgres /tmp/med_h_$$.sql
rm -f /tmp/med_?_$$.sql
