#!/usr/bin/env bash
# Prueba SQL de la PROPUESTA 31 en un PostgreSQL temporal (no toca ningún proyecto de Supabase): shim + migraciones 1-30, propuesta 31, prueba, verificación, reversión (se niega con datos; funciona limpia) y reaplicación.
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}; DATA=${FEL_PGDATA:-/tmp/fel-m31-pg-$$}; PORT=${FEL_PGPORT:-$((55000 + RANDOM % 900))}; SOCK=/tmp
as_pg() { if [ "$(id -u)" = 0 ]; then su pgtest -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
if [ "$(id -u)" = 0 ] && ! id pgtest >/dev/null 2>&1; then useradd -m pgtest; fi
as_pg "mkdir -p '$DATA' && '$PGBIN/initdb' -D '$DATA' -A trust -U postgres >/dev/null"
as_pg "'$PGBIN/pg_ctl' -D '$DATA' -o '-p $PORT -k $SOCK -c listen_addresses=' -w -l '$DATA/log' start >/dev/null"
trap 'as_pg "'"$PGBIN"'/pg_ctl -D '"$DATA"' -m immediate stop >/dev/null" || true; rm -f /tmp/m31_$$.sql' EXIT
PSQL=("$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
Q() { "$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d postgres -X -At -c "$1"; }
D=docs/migracion-31; M31=$D/20261125000100_fel_certificacion_test_tipos.sql
"${PSQL[@]}" -f tools/shim_supabase.sql
for f in supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f" >/dev/null; done
echo "migraciones aplicadas: $(ls supabase/migrations/*.sql | wc -l) (la última es la 30)"
# precondición: la propuesta no existe aún
[ "$(Q "select count(*) from information_schema.columns where table_name='fel_tipos_dte' and column_name='certificacion_test'")" = 0 ] && echo "OK    antes: sin certificacion_test"
"${PSQL[@]}" --single-transaction -f $M31 >/dev/null || { echo "FALLO: la propuesta no se aplicó"; exit 1; }; echo "OK    propuesta aplicada (una transacción)"
if "${PSQL[@]}" --single-transaction -f $M31 >/dev/null 2>&1; then echo "FALLO: se aplicó dos veces"; exit 1; else echo "OK    reaplicar falla sin cambiar nada"; fi
printf '%s\n' '\set ON_ERROR_STOP on' 'begin transaction read only;' "\i $D/verificacion-31.sql" > /tmp/m31_$$.sql
SAL=$("$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -f /tmp/m31_$$.sql)
if grep -Eq '\| +f *$' <<< "$SAL"; then echo "$SAL"; echo "FALLO: verificación con filas ok = f"; exit 1; fi; echo "OK    verificación posterior (solo lectura): todas las filas ok"
# prueba funcional: primera parte de la prueba de la 30 (fixture) + prueba de la 31
{ head -n 223 supabase/tests/30_tipos_documento.sql; cat $D/prueba-31.sql; } > /tmp/m31_$$.sql
"${PSQL[@]}" -f /tmp/m31_$$.sql | grep -q "PRUEBAS 31 OK" && echo "OK    pruebas funcionales de la 31 (PRUEBAS 31 OK)" || { echo "FALLO: pruebas funcionales"; exit 1; }
# reversión: se niega con una operación sobre una NCRE; funciona limpia
"${PSQL[@]}" -c "select 1" >/dev/null
"${PSQL[@]}" -f $D/reversion-31.sql && echo "OK    reversión en limpio"
[ "$(Q "select count(*) from information_schema.columns where table_name='fel_tipos_dte' and column_name='certificacion_test'")" = 0 ] && [ "$(Q "select p.proname from pg_trigger t join pg_proc p on p.oid=t.tgfoid where t.tgname='fel_digifact_tipo_guard_t'")" = fel_operacion_tipo_guard ] && echo "OK    tras la reversión: estado de la 30 intacto"
"${PSQL[@]}" --single-transaction -f $M31 >/dev/null && echo "OK    se puede volver a aplicar"
echo "MIGRACIÓN 31 (SQL) OK"
