#!/usr/bin/env bash
# Prueba de punta a punta de la cadena de la nube (local, sin servicios externos): construye, aprovisiona una base de PostgreSQL real, levanta página + intermediario + función
# y ejecuta el recorrido completo en el navegador (PC y teléfono) a través de esa cadena.
#   bash tools/test-nube-local.sh      (con FEL_PG_ADMIN_URL usa ese servidor; si no, uno temporal, igual que test-demo-pg.sh)
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
if [ -n "${FEL_PG_ADMIN_URL:-}" ]; then
  BASE="${FEL_PG_ADMIN_URL%/*}"; PSQLB=${PSQLB:-psql}; psq() { "$PSQLB" "$BASE/$1" -v ON_ERROR_STOP=1 -q -X "${@:2}"; }
else
  DATA=${FEL_PGDATA:-/tmp/fel-pgdata-nube}; PORT=${FEL_PGPORT:-54397}
  as_pg() { if [ "$(id -u)" = 0 ]; then su pgtest -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
  if [ "$(id -u)" = 0 ] && ! id pgtest >/dev/null 2>&1; then useradd -m pgtest; fi
  as_pg "rm -rf '$DATA' && mkdir -p '$DATA' && '$PGBIN/initdb' -D '$DATA' -A trust -U postgres >/dev/null"
  as_pg "'$PGBIN/pg_ctl' -D '$DATA' -o '-p $PORT -k /tmp -c listen_addresses=127.0.0.1 -c max_connections=300' -w -l '$DATA/log' start >/dev/null"
  parar() { [ -n "${SRV_PID:-}" ] && kill "$SRV_PID" 2>/dev/null || true; as_pg "$PGBIN/pg_ctl -D $DATA -m immediate stop >/dev/null" || true; }; trap parar EXIT
  BASE="postgres://postgres@127.0.0.1:$PORT"; psq() { "$PGBIN/psql" "$BASE/$1" -v ON_ERROR_STOP=1 -q -X "${@:2}"; }
fi
psq postgres -c "drop database if exists demo_nube with (force)"; psq postgres -c "create database demo_nube"
psq demo_nube -f tools/shim_supabase.sql; for f in supabase/migrations/*.sql; do psq demo_nube -f "$f" >/dev/null; done
cd demo-facturacion
deno run -A nube/construir.ts
# secretos generados para esta prueba (no se imprimen)
eval "$(deno run -A -q nube/secretos_prueba.ts)"
export FEL_DEMO_BD_URL="$BASE/demo_nube" FEL_DEMO_HOSTS=nexa-demo.localhost FEL_DEMO_LIMITE_LOGIN=100000 FEL_DEMO_LIMITE_API=1000000
deno run -A nube/aprovisionar.ts
deno run -A nube/local.ts --puerto=8790 & SRV_PID=$!
for i in $(seq 1 60); do curl -fs -H "Host: nexa-demo.localhost" localhost:8790/robots.txt >/dev/null && break; sleep 1; done
# el recorrido también arranca servidores propios (en memoria) para otros escenarios: no deben heredar la base ni los secretos de la nube
E2E_CLAVES="$FEL_DEMO_CLAVES"; E2E_MFA="$FEL_DEMO_MFA_SEMILLAS"
env -u FEL_DEMO_BD_URL -u FEL_DEMO_HOSTS -u FEL_DEMO_CLAVES -u FEL_DEMO_MFA_SEMILLAS -u FEL_PROXY_SECRETO -u FEL_DEMO_LIMITE_LOGIN -u FEL_DEMO_LIMITE_API \
  FEL_DEMO_URL="http://nexa-demo.localhost:8790" FEL_E2E_CLAVES="$E2E_CLAVES" FEL_E2E_MFA="$E2E_MFA" node tests/e2e_practico.cjs
echo "NUBE LOCAL E2E OK"
