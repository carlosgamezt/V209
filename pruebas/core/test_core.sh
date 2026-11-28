#!/usr/bin/env bash
# Prueba LOCAL de NEXA CORE (PostgreSQL efímero + simulación mínima de Supabase). Nunca toca un proyecto real.
set -euo pipefail
cd "$(dirname "$0")/../.."
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}; D=/tmp/core-pg-$$; PORT=$((58100 + RANDOM % 300)); M=${MIGDIR:-core/supabase/migraciones}
id pgtest >/dev/null 2>&1 || useradd -m pgtest
su pgtest -s /bin/bash -c "mkdir -p '$D' && '$PGBIN/initdb' -D '$D' -A trust -U postgres >/dev/null && '$PGBIN/pg_ctl' -D '$D' -o '-p $PORT -k /tmp -c listen_addresses=' -w -l '$D/log' start >/dev/null"
trap 'su pgtest -s /bin/bash -c "'"$PGBIN"'/pg_ctl -D '"$D"' -m immediate stop >/dev/null" || true; rm -rf "$D"' EXIT
"$PGBIN/psql" -h /tmp -p $PORT -U postgres -d postgres -q -X -c "create database nexa_core"
Q() { "$PGBIN/psql" -h /tmp -p $PORT -U postgres -d nexa_core -v ON_ERROR_STOP=1 -q -X "$@"; }
ok() { echo "OK    $1"; }; fallo() { echo "FALLO $1"; exit 1; }
Q -f pruebas/core/shim_supabase.sql >/dev/null
for f in C00_roles C01_base_empresas_identidad C02_catalogos_roles_permisos C03_planes_suscripciones_modulos C04_eventos_aprovisionamiento_auditoria C05_funciones_internas C06_api C07_semillas; do Q -f $M/$f.sql >/dev/null 2>$D/err.txt || { head -4 $D/err.txt; fallo "no carga $f"; }; done; ok "las 8 migraciones cargan en orden"
for f in C00_roles C01_base_empresas_identidad C02_catalogos_roles_permisos C03_planes_suscripciones_modulos C04_eventos_aprovisionamiento_auditoria C05_funciones_internas C06_api C07_semillas; do Q -f $M/$f.sql >/dev/null 2>$D/err.txt || { head -4 $D/err.txt; fallo "$f no es idempotente"; }; done; ok "las migraciones son idempotentes (segunda aplicación sin error)"
N1=$(Q -At -c "select (select count(*) from core.permisos)||'/'||(select count(*) from core.roles)||'/'||(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('core','api','core_sys'))")
Q -At -f pruebas/core/prueba_core.sql 2>$D/e.txt > $D/o.txt || { cat $D/e.txt | grep -E "FALLO|ERROR" | head -5; fallo "pruebas de comportamiento de CORE"; }
{ grep -E "NOTICE:  (OK|FALLO)" $D/e.txt || true; } | sed 's/^.*NOTICE:  //'
grep -q "PRUEBAS DE CORE OK" $D/o.txt && ok "pruebas de comportamiento de CORE: $(grep -c 'NOTICE:  OK' $D/e.txt) comprobaciones"
Q -f $M/reversion.sql >/dev/null 2>$D/err.txt || { head -3 $D/err.txt; fallo "reversión"; }
[ "$(Q -At -c "select count(*) from pg_namespace where nspname in ('core','api','core_sys')")" = 0 ] && ok "la reversión elimina por completo los esquemas de CORE (sin tocar auth)"
[ "$(Q -At -c "select count(*) from auth.users")" -ge 5 ] && ok "y no borra a las personas de Auth"
for f in C01_base_empresas_identidad C02_catalogos_roles_permisos C03_planes_suscripciones_modulos C04_eventos_aprovisionamiento_auditoria C05_funciones_internas C06_api C07_semillas; do Q -f $M/$f.sql >/dev/null 2>$D/err.txt || { head -4 $D/err.txt; fallo "no se reaplica $f tras la reversión"; }; done
[ "$(Q -At -c "select (select count(*) from core.permisos)||'/'||(select count(*) from core.roles)||'/'||(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('core','api','core_sys'))")" = "$N1" ] && ok "tras revertir se puede volver a aplicar con el mismo resultado"
echo "CORE SQL OK"
