#!/usr/bin/env bash
# Pruebas del flujo individual SIMULADO (orquestador TypeScript + proveedor mock) contra un PostgreSQL temporal con las migraciones reales.
# Sin Docker, sin red, sin credenciales, sin tocar ningún proyecto de Supabase. En GitHub Actions se usa el Supabase local efímero (puerto 54322).
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DATA=${FEL_PGDATA:-/tmp/fel-pgdata-flujo}
PORT=${FEL_PGPORT:-54398}
SOCK=/tmp
as_pg() { if [ "$(id -u)" = 0 ]; then su pgtest -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
if [ "$(id -u)" = 0 ] && ! id pgtest >/dev/null 2>&1; then useradd -m pgtest; fi
as_pg "rm -rf '$DATA' && mkdir -p '$DATA' && '$PGBIN/initdb' -D '$DATA' -A trust -U postgres >/dev/null"
as_pg "'$PGBIN/pg_ctl' -D '$DATA' -o '-p $PORT -k $SOCK -c listen_addresses=' -w -l '$DATA/log' start >/dev/null"
trap 'as_pg "'"$PGBIN"'/pg_ctl -D '"$DATA"' -m immediate stop >/dev/null" || true' EXIT
PSQL=("$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -f tools/shim_supabase.sql
for f in supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f" >/dev/null; done
echo "migraciones aplicadas; ejecutando las pruebas del flujo (Deno)…"
cd proveedores
FEL_PGHOST="$SOCK" FEL_PGPORT="$PORT" FEL_PGUSER=postgres FEL_PGDATABASE=postgres deno test -A pruebas_db/
echo "FLUJO OK"
