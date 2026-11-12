#!/usr/bin/env bash
# Pruebas de la demostración contra PostgreSQL REAL (las migraciones del proyecto, sin Docker ni Supabase): cada servidor de prueba recibe una base nueva creada desde una plantilla.
#   bash tools/test-demo-pg.sh [archivos de prueba…]     pruebas de API/seguridad/persistencia
#   bash tools/test-demo-pg.sh --e2e                       recorrido completo en navegador sobre datos persistentes
# Con FEL_PG_ADMIN_URL (p. ej. el servicio PostgreSQL de GitHub Actions: postgres://postgres:postgres@127.0.0.1:5432/postgres) se usa ese servidor; si no, se levanta uno temporal.
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
if [ -n "${FEL_PG_ADMIN_URL:-}" ]; then
  ADMIN="$FEL_PG_ADMIN_URL"; BASE="${ADMIN%/*}"; PSQLB=${PSQLB:-psql}; psq() { "$PSQLB" "$BASE/$1" -v ON_ERROR_STOP=1 -q -X "${@:2}"; }
else
  DATA=${FEL_PGDATA:-/tmp/fel-pgdata-demo}; PORT=${FEL_PGPORT:-54396}
  as_pg() { if [ "$(id -u)" = 0 ]; then su pgtest -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
  if [ "$(id -u)" = 0 ] && ! id pgtest >/dev/null 2>&1; then useradd -m pgtest; fi
  as_pg "rm -rf '$DATA' && mkdir -p '$DATA' && '$PGBIN/initdb' -D '$DATA' -A trust -U postgres >/dev/null"
  as_pg "'$PGBIN/pg_ctl' -D '$DATA' -o '-p $PORT -k /tmp -c listen_addresses=127.0.0.1 -c max_connections=300' -w -l '$DATA/log' start >/dev/null"
  parar() { as_pg "$PGBIN/pg_ctl -D $DATA -m immediate stop >/dev/null" || true; }; trap parar EXIT
  ADMIN="postgres://postgres@127.0.0.1:$PORT/postgres"; BASE="postgres://postgres@127.0.0.1:$PORT"; psq() { "$PGBIN/psql" "$BASE/$1" -v ON_ERROR_STOP=1 -q -X "${@:2}"; }
fi
psq postgres -c "drop database if exists nexa_plantilla with (force)"; psq postgres -c "create database nexa_plantilla"
psq nexa_plantilla -f tools/shim_supabase.sql
for f in supabase/migrations/*.sql; do psq nexa_plantilla -f "$f" >/dev/null; done
echo "plantilla lista; ejecutando las pruebas de la demostración contra PostgreSQL real…"
cd demo-facturacion
if [ "${1:-}" = "--e2e" ]; then
  psq postgres -c "drop database if exists demo_e2e with (force)"; psq postgres -c "create database demo_e2e template nexa_plantilla"
  FEL_DEMO_BD_URL="$BASE/demo_e2e" node tests/e2e_practico.cjs
  echo "DEMO PG E2E OK"; exit 0
fi
FEL_TEST_PG_ADMIN="$ADMIN" deno test -A ${@:-tests/}
echo "DEMO PG OK"
