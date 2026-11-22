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
echo "prueba:    concurrencia.sh"
PSQL_CMD="$PGBIN/psql -h $SOCK -p $PORT -U postgres -d postgres" bash supabase/tests/concurrencia.sh
echo "prueba:    procedimiento_excepcional_empresas.sh"
PSQL_CMD="$PGBIN/psql -h $SOCK -p $PORT -U postgres -d postgres" bash supabase/tests/procedimiento_excepcional_empresas.sh
echo "prueba:    verificacion_inicial_solo_lectura.sh"
PSQL_CMD="$PGBIN/psql -h $SOCK -p $PORT -U postgres -d postgres" bash supabase/tests/verificacion_inicial_solo_lectura.sh
echo "prueba:    procedimiento_migracion_29.sh (aplicar dos veces, sin la 28, verificación ante manipulaciones, reversión segura, mejora con datos)"
PSQL_BIN="$PGBIN/psql" CONN="postgresql://postgres@/{DB}?host=$SOCK&port=$PORT" bash supabase/tests/procedimiento_migracion_29.sh
echo "prueba:    respaldo_restauracion_29.sh (respaldo lógico con pg_dump, restauración en una base aparte, catálogo de la 28 sano, 29 ausente, reversión rechazada con datos)"
PSQL_BIN="$PGBIN/psql" CONN="postgresql://postgres@/{DB}?host=$SOCK&port=$PORT" bash supabase/tests/respaldo_restauracion_29.sh
echo "prueba:    test-respaldo-nexa-demo.sh (verificar-respaldo con curl falso; ensayo de respaldo y restauración efímera con PostgreSQL real y todas sus protecciones)"
FEL_PGDATA=/tmp/fel-pgdata-respaldo FEL_PGPORT=54394 bash tools/test-respaldo-nexa-demo.sh
echo "prueba:    test-plataforma-ensure-rls.sh (función real de la plataforma; su propio PostgreSQL temporal)"
FEL_PGDATA=/tmp/fel-pgdata-ensure FEL_PGPORT=54395 bash tools/test-plataforma-ensure-rls.sh
echo "TODO OK"
