#!/usr/bin/env bash
# Pruebas de seguridad del rol de conexión restringido `nexa_app` (PROPUESTA, etapa 1B-bis) en un PostgreSQL temporal (no toca ningún proyecto de Supabase): migraciones 1-30 + M-D, M-A, M-B, M-C, M-E;
# auditoría de las funciones SECURITY DEFINER; pruebas conectadas COMO nexa_app; compatibilidad con la aplicación (recorrido real de la nube con la base como nexa_app) y reversión de M-E.
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}; DATA=${FEL_PGDATA:-/tmp/fel-rolapp-pg-$$}; PORT=${FEL_PGPORT:-$((55000 + RANDOM % 900))}; SOCK=/tmp
as_pg() { if [ "$(id -u)" = 0 ]; then su pgtest -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
if [ "$(id -u)" = 0 ] && ! id pgtest >/dev/null 2>&1; then useradd -m pgtest; fi
as_pg "mkdir -p '$DATA' && '$PGBIN/initdb' -D '$DATA' -A trust -U postgres >/dev/null"
as_pg "'$PGBIN/pg_ctl' -D '$DATA' -o '-p $PORT -k $SOCK -c listen_addresses=127.0.0.1 -c max_connections=300' -w -l '$DATA/log' start >/dev/null"
trap 'as_pg "'"$PGBIN"'/pg_ctl -D '"$DATA"' -m immediate stop >/dev/null" || true' EXIT
D=${FEL_PROPUESTA:-docs/multiempresa/propuesta}
PSQL() { "$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d "$1" -v ON_ERROR_STOP=1 -q -X "${@:2}"; }
PSQLAPP() { "$PGBIN/psql" -h "$SOCK" -p "$PORT" -U nexa_app -d "$1" -v ON_ERROR_STOP=1 -q -X "${@:2}"; }
PSQL postgres -c "create database nexa_plantilla"
PSQL nexa_plantilla -f tools/shim_supabase.sql
for f in supabase/migrations/*.sql; do PSQL nexa_plantilla -f "$f" >/dev/null 2>&1; done
for f in M-D_permisos M-A_emisor_fiscal M-B_digifact_config M-C_acceso_maestro M-F_establecimientos_usuario M-G_sesion_admin M-H_admin_establecimientos M-E_rol_app; do PSQL nexa_plantilla --single-transaction -f $D/$f.sql >/dev/null || { echo "FALLO: no se aplicó $f"; exit 1; }; done
PSQL postgres -c "alter role nexa_app login password 'prueba-local'" ; echo "OK    M-D, M-A, M-B, M-C y M-E aplicadas; nexa_app habilitado SOLO en este PostgreSQL temporal"
PSQL postgres -c "create database nexa_sesion template nexa_plantilla"   # copia con los datos de prueba de sesiones; la plantilla queda limpia para la prueba de compatibilidad de la aplicación
# datos de prueba persistentes + pruebas COMO nexa_app con sesiones validadas (suplantación, otra empresa, MFA, permisos, establecimientos, maestro)
PSQL nexa_sesion -f $D/fixture-sesion.sql >/dev/null 2>&1 || { echo "FALLO: fixture de sesiones"; PSQL nexa_sesion -f $D/fixture-sesion.sql 2>&1 | tail -3; exit 1; }
# auditoría SECURITY DEFINER (como superusuario): todas con search_path vacío, nada ejecutable por anon/PUBLIC, solo 3 predicados por authenticated
SAL=$(PSQL nexa_plantilla -A -t -f $D/auditoria-definer.sql)
echo "$SAL" | sed 's/^/      /'
grep -q "DEFINER sin search_path fijo: ninguna" <<< "$SAL" && grep -q "DEFINER con search_path no vacío: ninguna" <<< "$SAL" && grep -q "DEFINER ejecutables por anon/PUBLIC: ninguna" <<< "$SAL" \
 && grep -q "DEFINER ejecutables por authenticated: fel__establecimiento_por_usuario, fel_en_alcance, fel_es_admin_plataforma, fel_es_miembro, fel_tiene_permiso$" <<< "$SAL" && echo "OK    auditoría de funciones SECURITY DEFINER" || { echo "FALLO: auditoría SECURITY DEFINER"; exit 1; }
# pruebas COMO nexa_app (conexión real)
PGPASSWORD=prueba-local PSQLAPP nexa_sesion -f $D/prueba-rol-app.sql | grep -q "PRUEBAS DEL ROL nexa_app OK" && echo "OK    pruebas de seguridad conectadas como nexa_app" || { echo "FALLO: pruebas como nexa_app"; exit 1; }
PGPASSWORD=prueba-local PSQLAPP nexa_sesion -f $D/prueba-sesion-admin.sql 2>&1 | tee /tmp/sesion_admin.log | grep -q "PRUEBAS DE SESIÓN VALIDADA OK" && echo "OK    pruebas conectadas como nexa_app con sesión validada (suplantación, MFA, establecimientos, maestro)" || { grep -E "ERROR|ESPERABA|CONTEXT" /tmp/sesion_admin.log | head -4; echo "FALLO: pruebas de sesión validada"; exit 1; }
PGPASSWORD=prueba-local PSQLAPP nexa_sesion -f $D/prueba-admin-establecimientos.sql 2>&1 | tee /tmp/admin_est.log | grep -q "PRUEBAS DE ADMINISTRACIÓN DE ESTABLECIMIENTOS OK" && echo "OK    administración de establecimientos como nexa_app (sesión validada, otra empresa, nombre interno, reasignación, supervisión)" || { echo "FALLO: administración de establecimientos"; tail -8 /tmp/admin_est.log; exit 1; }
PGPASSWORD=prueba-local PSQLAPP nexa_sesion -v esperado=${FEL_R2_ESPERADO:-abierto} -f $D/prueba-r2-suplantacion.sql 2>&1 | tee /tmp/r2.log | grep -q "SONDA R2 OK" && echo "OK    sonda R2 (suplantación por fel_op_*): $(grep -o 'R2 ESTADO: [a-z]*' /tmp/r2.log) — esperado ${FEL_R2_ESPERADO:-abierto}" || { echo "FALLO: sonda R2"; tail -12 /tmp/r2.log; exit 1; }
# una tabla nueva con RLS y sin política es invisible para nexa_app (falla cerrado)
PSQL nexa_sesion -c "create table public.zz_nueva (x int); alter table public.zz_nueva enable row level security; insert into public.zz_nueva values (1); grant select on public.zz_nueva to nexa_app;"
[ "$(PGPASSWORD=prueba-local PSQLAPP nexa_sesion -At -c 'select count(*) from public.zz_nueva')" = 0 ] && echo "OK    tabla nueva con RLS y sin política: nexa_app ve 0 filas (falla cerrado)"
PSQL nexa_sesion -c "drop table public.zz_nueva"
# compatibilidad: recorrido real de la nube con la base como nexa_app (aprovisiona el administrador; sirve nexa_app)
if [ "${FEL_SIN_DENO:-}" != 1 ]; then
  ( cd demo-facturacion && FEL_TEST_PG_ADMIN="postgres://postgres@127.0.0.1:$PORT/postgres" FEL_TEST_PG_ROL_APP="nexa_app:prueba-local" deno test -A tests/rol_app_pg_test.ts 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tail -45 ) | tee /tmp/rol_app_deno.log
  grep -q "ok | 1 passed | 0 failed" /tmp/rol_app_deno.log && echo "OK    compatibilidad de la aplicación con nexa_app" || { echo "FALLO: compatibilidad con nexa_app"; exit 1; }
fi
PSQL postgres -c "drop database if exists nexa_sesion with (force)"
# reversión de M-E
PSQL nexa_plantilla -f $D/reversion-M-E.sql >/dev/null 2>&1 || { PSQL postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where usename='nexa_app'" >/dev/null; PSQL nexa_plantilla -f $D/reversion-M-E.sql >/dev/null; }
[ "$(PSQL nexa_plantilla -At -c "select count(*) from pg_roles where rolname='nexa_app'")" = 0 ] && echo "OK    reversión de M-E: el rol y sus políticas desaparecen"
echo "ROL nexa_app (SQL) OK"
