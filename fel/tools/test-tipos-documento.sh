#!/usr/bin/env bash
# Prueba SQL de la PROPUESTA de tipos de documento en un PostgreSQL temporal (sin Docker, sin tocar ningún proyecto de Supabase): shim + las migraciones aprobadas + la propuesta,
# luego la prueba, la verificación posterior (todas las filas ok), la reversión (debe negarse con datos; debe funcionar en limpio) y la reaplicación.
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}; DATA=${FEL_PGDATA:-/tmp/fel-tipos-pg-$$}; PORT=${FEL_PGPORT:-$((55000 + RANDOM % 900))}; SOCK=/tmp
as_pg() { if [ "$(id -u)" = 0 ]; then su pgtest -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
if [ "$(id -u)" = 0 ] && ! id pgtest >/dev/null 2>&1; then useradd -m pgtest; fi
as_pg "mkdir -p '$DATA' && '$PGBIN/initdb' -D '$DATA' -A trust -U postgres >/dev/null"
as_pg "'$PGBIN/pg_ctl' -D '$DATA' -o '-p $PORT -k $SOCK -c listen_addresses=' -w -l '$DATA/log' start >/dev/null"
trap 'as_pg "'"$PGBIN"'/pg_ctl -D '"$DATA"' -m immediate stop >/dev/null" || true' EXIT
PSQL=("$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
D=docs/migracion-tipos-documento
"${PSQL[@]}" -f tools/shim_supabase.sql
for f in supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f" >/dev/null; done
echo "migraciones aprobadas: $(ls supabase/migrations/*.sql | wc -l) (el conjunto no cambia)"
Q() { "$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d postgres -X -At -c "$1"; }
# precondiciones de la ETAPA 4 del procedimiento hospedado (mismas consultas que supabase-hospedado.sh): propuesta ausente y dependencias presentes
[ "$(Q "select to_regclass('public.fel_tipos_dte') is null and to_regclass('public.empresa_tipos_documento') is null and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'documentos' and column_name in ('tipo_dte','documento_origen_id','referencia_origen','motivo_ajuste','tipo_recibo'))")" = t ] && echo "OK    etapa 4: propuesta ausente antes de aplicar"
[ "$(Q "select to_regclass('public.documentos') is not null and to_regprocedure('public.fel_auditar(uuid,uuid,text,text,text,jsonb,text)') is not null and to_regclass('public.digifact_operaciones') is not null")" = t ] && echo "OK    etapa 4: dependencias presentes (documentos, fel_auditar, tabla de la 29)"
# aplicación como la etapa 4: UNA transacción
"${PSQL[@]}" --single-transaction -f $D/20261115000100_fel_tipos_documento.sql >/dev/null; echo "propuesta aplicada (una transacción)"
# verificación como la etapa 4: transacción de solo lectura + tabla alineada; ninguna fila con ok = f
printf '%s\n' '\set ON_ERROR_STOP on' 'begin transaction read only;' "\i $D/verificacion-tipos.sql" > /tmp/ver4_$$.sql
SAL=$("$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -f /tmp/ver4_$$.sql); rm -f /tmp/ver4_$$.sql
if grep -Eq '\| +f *$' <<< "$SAL"; then echo "FALLO: verificación de la etapa 4 con filas ok = f"; exit 1; fi; grep -Eq '\| +t *$' <<< "$SAL" && echo "OK    etapa 4: verificación en solo lectura sin filas ok = f"
# una segunda aplicación debe fallar sin cambiar nada (la propuesta ya existe)
if "${PSQL[@]}" --single-transaction -f $D/20261115000100_fel_tipos_documento.sql >/dev/null 2>&1; then echo "FALLO: la propuesta se aplicó dos veces"; exit 1; else echo "OK    etapa 4: reaplicar sobre una base que ya la tiene falla y no cambia nada"; fi
echo "prueba: $D/prueba-tipos-documento.sql"; "${PSQL[@]}" -f $D/prueba-tipos-documento.sql | tail -1
V=$("$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d postgres -X -At -F '|' -f $D/verificacion-tipos.sql); echo "$V" | awk -F'|' '{print "  " ($4=="t"?"OK   ":"FALLO") " " $1}'
echo "$V" | awk -F'|' '$4!="t"{bad=1} END{exit bad}' || { echo "verificación posterior FALLÓ"; exit 1; }
# la reversión se niega con datos (una empresa con un tipo habilitado)…
"${PSQL[@]}" -c "insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id, estado) select '10000000-0000-0000-0000-00000000000a', 'E', 'E S.A.', '1111111-1', id, 'habilitada' from public.regimenes_fiscales where codigo = 'general'"
"${PSQL[@]}" -c "insert into public.empresa_tipos_documento (empresa_id, tipo_dte, habilitado) values ('10000000-0000-0000-0000-00000000000a', 'NCRE', true)"
if "${PSQL[@]}" -f $D/reversion-tipos.sql 2>/tmp/rev_$$.err; then echo "FALLO: la reversión debió negarse con datos"; exit 1; fi
grep -q "REVERSIÓN TIPOS RECHAZADA" /tmp/rev_$$.err && echo "OK    la reversión se niega si hay configuración o documentos que no son FACT"
[ "$("$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d postgres -X -At -c "select count(*) from public.empresa_tipos_documento")" = 1 ] && echo "OK    y no borró nada"
# …y funciona en limpio, y se puede volver a aplicar
"${PSQL[@]}" -c "delete from public.empresa_tipos_documento" >/dev/null
"${PSQL[@]}" -f $D/reversion-tipos.sql && echo "OK    reversión en limpio"
[ "$("$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d postgres -X -At -c "select to_regclass('public.fel_tipos_dte') is null and not exists (select 1 from information_schema.columns where table_name = 'documentos' and column_name = 'tipo_dte')")" = t ] && echo "OK    tras la reversión no queda nada de la propuesta"
"${PSQL[@]}" -f $D/20261115000100_fel_tipos_documento.sql >/dev/null && echo "OK    se puede volver a aplicar"
echo "TIPOS DE DOCUMENTO (SQL) OK"
