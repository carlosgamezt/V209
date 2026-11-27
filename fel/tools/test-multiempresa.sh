#!/usr/bin/env bash
# Prueba SQL de la PROPUESTA multiempresa (M-D, M-A, M-B, M-C) en un PostgreSQL temporal (no toca ningún proyecto de Supabase): shim + migraciones 1-30, propuesta, verificación de solo lectura,
# pruebas funcionales (permisos, aislamiento, RLS, secretos, acceso excepcional del maestro), reversión (se niega con datos; funciona limpia) y reaplicación.
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}; DATA=${FEL_PGDATA:-/tmp/fel-multi-pg-$$}; PORT=${FEL_PGPORT:-$((55000 + RANDOM % 900))}; SOCK=/tmp
as_pg() { if [ "$(id -u)" = 0 ]; then su pgtest -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
if [ "$(id -u)" = 0 ] && ! id pgtest >/dev/null 2>&1; then useradd -m pgtest; fi
as_pg "mkdir -p '$DATA' && '$PGBIN/initdb' -D '$DATA' -A trust -U postgres >/dev/null"
as_pg "'$PGBIN/pg_ctl' -D '$DATA' -o '-p $PORT -k $SOCK -c listen_addresses=' -w -l '$DATA/log' start >/dev/null"
trap 'as_pg "'"$PGBIN"'/pg_ctl -D '"$DATA"' -m immediate stop >/dev/null" || true; rm -f /tmp/multi_$$.sql' EXIT
PSQL=("$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
Q() { "$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d postgres -X -At -c "$1"; }
D=${FEL_PROPUESTA:-docs/multiempresa/propuesta}
"${PSQL[@]}" -f tools/shim_supabase.sql
for f in supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f" >/dev/null; done
echo "migraciones aplicadas: $(ls supabase/migrations/*.sql | wc -l)"
[ "$(Q "select count(*) from pg_tables where schemaname='public' and tablename in ('empresa_digifact_config','empresa_emisor_versiones','empresa_digifact_eventos','acceso_maestro_datos')")" = 0 ] && echo "OK    antes: sin tablas multiempresa"
aplicar() { for f in M-D_permisos M-A_emisor_fiscal M-B_digifact_config M-C_acceso_maestro M-F_establecimientos_usuario M-G_sesion_admin M-H_admin_establecimientos M-I_envoltorios_sesion M-J_plataforma_y_auditoria M-K_sistema_nexa_sys M-L_rls_sesion_viva; do "${PSQL[@]}" --single-transaction -f $D/$f.sql >/dev/null || { echo "FALLO: no se aplicó $f"; exit 1; }; done; }
aplicar; echo "OK    M-D, M-A, M-B, M-C, M-F y M-G aplicadas (una transacción cada una)"
if "${PSQL[@]}" --single-transaction -f $D/M-A_emisor_fiscal.sql >/dev/null 2>&1; then echo "FALLO: M-A se aplicó dos veces"; exit 1; else echo "OK    reaplicar falla sin cambiar nada"; fi
printf '%s\n' '\set ON_ERROR_STOP on' 'begin transaction read only;' "\i $D/verificacion.sql" > /tmp/multi_$$.sql
SAL=$("$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -f /tmp/multi_$$.sql)
if grep -Eq '\| +f *$' <<< "$SAL"; then echo "$SAL"; echo "FALLO: verificación con filas ok = f"; exit 1; fi; echo "OK    verificación posterior (solo lectura): todas las filas ok"
"${PSQL[@]}" -f $D/prueba-multiempresa.sql | grep -q "PRUEBAS MULTIEMPRESA OK" && echo "OK    pruebas funcionales (PRUEBAS MULTIEMPRESA OK)" || { echo "FALLO: pruebas funcionales"; exit 1; }
"${PSQL[@]}" -f $D/prueba-establecimientos.sql | grep -q "PRUEBAS ESTABLECIMIENTOS OK" && echo "OK    pruebas del establecimiento por usuario (PRUEBAS ESTABLECIMIENTOS OK)" || { echo "FALLO: pruebas de establecimientos"; exit 1; }
# la prueba termina con ROLLBACK: no deja datos. Para probar la reversión CON datos se crea una conexión y se vuelve a ejecutar.
"${PSQL[@]}" -c "insert into auth.users (id,email) values ('00000000-0000-0000-0000-0000000000f1','u@fel.test'); insert into public.empresas (id,nombre_comercial,razon_social,nit,regimen_id,estado) select '10000000-0000-0000-0000-0000000000f1','E','E S.A.','9999999-9',id,'habilitada' from public.regimenes_fiscales where codigo='general'; insert into public.empresa_digifact_config (empresa_id) values ('10000000-0000-0000-0000-0000000000f1');" >/dev/null
if "${PSQL[@]}" -f $D/reversion.sql >/dev/null 2>&1; then echo "FALLO: la reversión no se negó con datos"; exit 1; else echo "OK    reversión se niega con datos de configuración"; fi
"${PSQL[@]}" -c "delete from public.empresa_digifact_config;" >/dev/null
"${PSQL[@]}" -f $D/reversion.sql >/dev/null && echo "OK    reversión en limpio"
[ "$(Q "select count(*) from pg_tables where schemaname='public' and tablename in ('empresa_digifact_config','empresa_emisor_versiones','empresa_digifact_eventos','acceso_maestro_datos')")" = 0 ] \
 && [ "$(Q "select count(*) from public.permisos_catalogo where codigo in ('fiscal.configurar','fiscal.aprobar_emisor','digifact.conectar','digifact.probar')")" = 0 ] \
 && [ "$(Q "select count(*) from information_schema.columns where table_name='establecimientos' and column_name in ('codigo_postal','municipio','departamento')")" = 0 ] && echo "OK    la reversión dejó el esquema como antes"
aplicar && echo "OK    se puede volver a aplicar"
echo "MULTIEMPRESA (SQL) OK"
