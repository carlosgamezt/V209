#!/usr/bin/env bash
# Pruebas locales de NEXA FEL en un PostgreSQL temporal (sin Docker, sin tocar ningún proyecto de Supabase).
# En GitHub Actions se usan las mismas pruebas contra Supabase local real (ver .github/workflows/fel-tests.yml).
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DATA=${FEL_PGDATA:-/tmp/fel-pgdata}
PORT=${FEL_PGPORT:-54399}
SOCK=/tmp
as_pg() { if [ "$(id -u)" = 0 ]; then su pgtest -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
if [ "$(id -u)" = 0 ] && ! id pgtest >/dev/null 2>&1; then useradd -m pgtest; fi
rm -rf "$DATA"
as_pg "mkdir -p '$DATA' && '$PGBIN/initdb' -D '$DATA' -A trust -U postgres >/dev/null"
as_pg "'$PGBIN/pg_ctl' -D '$DATA' -o '-p $PORT -k $SOCK -c listen_addresses=' -w -l '$DATA/log' start >/dev/null"
trap 'as_pg "'"$PGBIN"'/pg_ctl -D '"$DATA"' -m immediate stop >/dev/null" || true' EXIT
PSQL=("$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -f tools/shim_supabase.sql
for f in supabase/migrations/*.sql; do echo "migración: $(basename "$f")"; "${PSQL[@]}" -f "$f"; done
for f in supabase/tests/*.sql; do echo "prueba:    $(basename "$f")"; "${PSQL[@]}" -f "$f"; done
echo "TODO OK"
