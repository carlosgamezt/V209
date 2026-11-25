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
M30=supabase/migrations/20261115000100_fel_tipos_documento.sql
for f in supabase/migrations/*.sql; do [ "$f" = "$M30" ] && continue; "${PSQL[@]}" -f "$f" >/dev/null; done   # primero las 29 (el estado de nexa-demo ANTES de la etapa 4)
echo "migraciones previas: $(ls supabase/migrations/*.sql | grep -vc 20261115000100) (estado previo a la etapa 4); la 30 es $M30"
Q() { "$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d postgres -X -At -c "$1"; }
# precondiciones de la ETAPA 4 del procedimiento hospedado (mismas consultas que supabase-hospedado.sh): propuesta ausente y dependencias presentes
[ "$(Q "select to_regclass('public.fel_tipos_dte') is null and to_regclass('public.empresa_tipos_documento') is null and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'documentos' and column_name in ('tipo_dte','documento_origen_id','referencia_origen','motivo_ajuste','tipo_recibo'))")" = t ] && echo "OK    etapa 4: propuesta ausente antes de aplicar"
[ "$(Q "select to_regclass('public.documentos') is not null and to_regprocedure('public.fel_auditar(uuid,uuid,text,text,text,jsonb,text)') is not null and to_regclass('public.digifact_operaciones') is not null")" = t ] && echo "OK    etapa 4: dependencias presentes (documentos, fel_auditar, tabla de la 29)"
V29() { printf '%s\n' '\set ON_ERROR_STOP on' 'begin transaction read only;' "\i docs/migracion-29/verificacion-posterior-29.sql" > /tmp/v29_$$.sql; "$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -f /tmp/v29_$$.sql 2>&1; rm -f /tmp/v29_$$.sql; }
V29 | grep -q "VERIFICACION POSTERIOR 29 OK" && echo "OK    antes de la etapa 4: el catálogo de la 29 está sano (69 tablas, 49 políticas, 185 funciones, 61 disparadores)" || { echo "FALLO: el catálogo de la 29 no está sano antes de la 30"; exit 1; }
# aplicación como la etapa 4: UNA transacción
"${PSQL[@]}" --single-transaction -f $M30 >/dev/null; echo "propuesta aplicada (una transacción)"
# verificación como la etapa 4: transacción de solo lectura + tabla alineada; ninguna fila con ok = f
printf '%s\n' '\set ON_ERROR_STOP on' 'begin transaction read only;' "\i $D/verificacion-tipos.sql" > /tmp/ver4_$$.sql
SAL=$("$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -f /tmp/ver4_$$.sql); rm -f /tmp/ver4_$$.sql
if grep -Eq '\| +f *$' <<< "$SAL"; then echo "FALLO: verificación de la etapa 4 con filas ok = f"; exit 1; fi; grep -Eq '\| +t *$' <<< "$SAL" && echo "OK    etapa 4: verificación en solo lectura sin filas ok = f"
V29 | grep -q "VERIFICACION POSTERIOR 29 OK" && echo "OK    tras la etapa 4: el catálogo de la 29 sigue sano con las cifras de la 30 (71 tablas, 51 políticas, 195 funciones, 66 disparadores)" || { echo "FALLO: el catálogo de la 29 no es compatible con la 30"; exit 1; }
CIF=$(Q "select (select count(*) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p')) || ' ' || (select count(*) from pg_policies where schemaname='public') || ' ' || (select count(*) from pg_proc where pronamespace='public'::regnamespace) || ' ' || (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal)")
[ "$CIF" = "71 51 195 66" ] && echo "OK    cifras de la 30 medidas: 71 tablas, 51 políticas, 195 funciones, 66 disparadores" || { echo "FALLO: cifras $CIF (se esperaban 71 51 195 66)"; exit 1; }
# la verificación de la 29 sigue DETECTANDO una función ajena (la tolerancia de la 30 es exacta, no un margen)
"${PSQL[@]}" -c "create function public.zz_ajena() returns int language sql as 'select 1'"; V29 | grep -q "funciones propias en public" && echo "OK    una función ajena de más sigue haciendo fallar el catálogo de la 29" || { echo "FALLO: la verificación de la 29 ya no detecta una función ajena"; exit 1; }
"${PSQL[@]}" -c "drop function public.zz_ajena()"
# una segunda aplicación debe fallar sin cambiar nada (la propuesta ya existe)
if "${PSQL[@]}" --single-transaction -f $M30 >/dev/null 2>&1; then echo "FALLO: la propuesta se aplicó dos veces"; exit 1; else echo "OK    etapa 4: reaplicar sobre una base que ya la tiene falla y no cambia nada"; fi
echo "prueba: supabase/tests/30_tipos_documento.sql"; "${PSQL[@]}" -f supabase/tests/30_tipos_documento.sql | tail -1
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
"${PSQL[@]}" -c "create schema if not exists supabase_migrations" -c "create table if not exists supabase_migrations.schema_migrations (version text primary key, name text, statements text[])" -c "insert into supabase_migrations.schema_migrations (version, name) values ('20261114000100', 'fel_digifact_operaciones'), ('20261115000100', 'fel_tipos_documento')"
"${PSQL[@]}" -f $D/reversion-tipos.sql && echo "OK    reversión en limpio"
[ "$(Q "select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations")" = "20261114000100" ] && echo "OK    la reversión retiró la versión 20261115000100 del historial y dejó la de la 29" || { echo "FALLO: la reversión no retiró la versión 30 del historial (o tocó otra)"; exit 1; }
[ "$("$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d postgres -X -At -c "select to_regclass('public.fel_tipos_dte') is null and not exists (select 1 from information_schema.columns where table_name = 'documentos' and column_name = 'tipo_dte')")" = t ] && echo "OK    tras la reversión no queda nada de la propuesta"
"${PSQL[@]}" -f $M30 >/dev/null && echo "OK    se puede volver a aplicar"
echo "TIPOS DE DOCUMENTO (SQL) OK"
