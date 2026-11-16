#!/usr/bin/env bash
# Pruebas con la salvaguarda de la PLATAFORMA Supabase «rls_auto_enable» (DEFINICIÓN REAL leída de nexa-demo, supabase/tests/plataforma/rls_auto_enable_real.sql) y su disparador de evento «ensure_rls».
#  A) Reconocimiento (verificacion-inicial-nexa-demo.sql): la función EXACTA se reconoce como INFO; cualquier variante o cualquier otra función es REVISAR (falla cerrado). 12 escenarios, cada uno en una base nueva.
#  B) Compatibilidad: con la función y el disparador instalados, las 28 migraciones se aplican, las 67 tablas quedan con RLS, y pasan todas las suites SQL y los scripts de verificación.
# Necesita un PostgreSQL con SUPERUSUARIO (los disparadores de evento lo exigen). Con FEL_PG_ADMIN_URL usa ese servidor (p. ej. el servicio PostgreSQL del CI); si no, levanta uno temporal.
#   bash tools/test-plataforma-ensure-rls.sh
set -uo pipefail
cd "$(dirname "$0")/.."
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
if [ -n "${FEL_PG_ADMIN_URL:-}" ]; then
  BASE="${FEL_PG_ADMIN_URL%/*}"; PSQLB=${PSQLB:-psql}
else
  DATA=${FEL_PGDATA:-/tmp/fel-pgdata-ensure}; PORT=${FEL_PGPORT:-54395}; PSQLB="$PGBIN/psql"
  as_pg() { if [ "$(id -u)" = 0 ]; then su pgtest -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
  if [ "$(id -u)" = 0 ] && ! id pgtest >/dev/null 2>&1; then useradd -m pgtest; fi
  as_pg "rm -rf '$DATA' && mkdir -p '$DATA' && '$PGBIN/initdb' -D '$DATA' -A trust -U postgres >/dev/null"
  as_pg "'$PGBIN/pg_ctl' -D '$DATA' -o '-p $PORT -k /tmp -c listen_addresses=127.0.0.1 -c max_connections=100' -w -l '$DATA/log' start >/dev/null"
  parar() { as_pg "$PGBIN/pg_ctl -D $DATA -m immediate stop >/dev/null" || true; }; trap parar EXIT
  BASE="postgres://postgres@127.0.0.1:$PORT"
fi
psq() { "$PSQLB" "$BASE/$1" -v ON_ERROR_STOP=1 -q -X "${@:2}"; }
REAL=supabase/tests/plataforma/rls_auto_enable_real.sql; VERIF=docs/migracion-28/verificacion-inicial-nexa-demo.sql
fallos=0; ok() { echo "OK ensure-rls: $1"; }; mal() { echo "FALLO ensure-rls: $1"; fallos=$((fallos+1)); }
nueva() { psq postgres -c "drop database if exists $1 with (force)" -c "create database $1" >/dev/null 2>&1 && psq "$1" -f tools/shim_supabase.sql >/dev/null; }
verif() { PGOPTIONS="-c default_transaction_read_only=on" "$PSQLB" "$BASE/$1" -X -q -f "$VERIF" 2>&1; }
LINEA='funciones propias en public (no reconocidas)'

# ---------------------------------------------------------------- A) reconocimiento
escenario() { # $1 id, $2 descripción, $3 esperado (OK|REVISAR), $4... órdenes SQL previas tras instalar la función real
  local db="ens_$1" desc="$2" esp="$3"; shift 3
  nueva "$db" || { mal "no se pudo crear la base de «$desc»"; return; }
  if [ "${SIN_REAL:-}" != 1 ]; then psq "$db" -f "$REAL" >/dev/null 2>&1; fi
  for orden in "$@"; do psq "$db" -c "$orden" >/dev/null 2>&1 || { mal "«$desc»: falló la preparación: $orden"; return; }; done
  local out; out="$(verif "$db")"
  if [ "$esp" = OK ]; then grep -q "^$LINEA | 0 | 0 | OK$" <<<"$out" && ok "$desc → OK" || { mal "$desc: se esperaba OK"; grep "$LINEA" <<<"$out"; }
  else grep -q "^$LINEA | [1-9].* | 0 | REVISAR$" <<<"$out" && ok "$desc → REVISAR" || { mal "$desc: se esperaba REVISAR"; grep "$LINEA" <<<"$out"; }; fi
  LAST="$out"
}
escenario 1 "la función EXACTA con su disparador" OK
grep -q "^función de plataforma reconocida | public.rls_auto_enable() (huella SHA-256 coincide con la verificada) | informativo | INFO$" <<<"$LAST" && ok "…y se informa como función de plataforma reconocida (INFO)" || mal "no informa la función reconocida"
! grep -q "NO reconocida: huella" <<<"$LAST" && ok "…sin fila de «no reconocida»" || mal "fila de no reconocida inesperada"
SIN_REAL=1 escenario 2 "ninguna función propia" OK
# variante con el cuerpo cambiado (un solo texto de registro distinto): la huella ya no coincide
VAR="$(mktemp)"; sed "s/rls_auto_enable: skip/rls_auto_enable: omitido/" "$REAL" > "$VAR"; chmod 644 "$VAR"
nueva ens_3 || true; psq ens_3 -f "$VAR" >/dev/null 2>&1; out="$(verif ens_3)"; rm -f "$VAR"
grep -q "^$LINEA | 1 → rls_auto_enable | 0 | REVISAR$" <<<"$out" && grep -q "^función rls_auto_enable NO reconocida: huella SHA-256 real del cuerpo | [0-9a-f]\{64\} | huella verificada " <<<"$out" && ok "el cuerpo modificado → REVISAR (y se imprime la huella real para ajustar)" || { mal "cuerpo modificado"; echo "$out" | grep -E "rls_auto|$LINEA"; }
escenario 4 "la función exacta SIN disparador de evento" REVISAR "drop event trigger ensure_rls"
escenario 5 "disparador DESACTIVADO" REVISAR "alter event trigger ensure_rls disable"
escenario 6 "disparador con otras etiquetas" REVISAR "drop event trigger ensure_rls" "create event trigger ensure_rls on ddl_command_end when tag in ('CREATE TABLE') execute function public.rls_auto_enable()"
escenario 7 "función SECURITY INVOKER" REVISAR "alter function public.rls_auto_enable() security invoker"
escenario 8 "search_path distinto" REVISAR "alter function public.rls_auto_enable() set search_path = public"
escenario 9 "propietario distinto" REVISAR "create role otro_dueno_ensure" "alter function public.rls_auto_enable() owner to otro_dueno_ensure"
escenario 10 "la exacta MÁS otra función propia" REVISAR "create function public.otra_funcion() returns int language sql as 'select 1'"
escenario 11 "la exacta MÁS una sobrecarga con argumentos" REVISAR "create function public.rls_auto_enable(int) returns int language sql as 'select 1'"
escenario 12 "el disparador ensure_rls apunta a OTRA función" REVISAR "create function public.otro_evento() returns event_trigger language plpgsql as 'begin null; end'" "drop event trigger ensure_rls" "create event trigger ensure_rls on ddl_command_end when tag in ('CREATE TABLE','CREATE TABLE AS','SELECT INTO') execute function public.otro_evento()"

# ---------------------------------------------------------------- B) compatibilidad con la función real instalada
nueva ens_full && psq ens_full -f "$REAL" >/dev/null 2>&1 && ok "base de compatibilidad creada con la función real y su disparador"
psq ens_full -c "create table public.zz_prueba_rls (id int)" >/dev/null 2>&1
[ "$("$PSQLB" "$BASE/ens_full" -X -At -c "select relrowsecurity from pg_class where oid = 'public.zz_prueba_rls'::regclass")" = t ] && ok "el disparador está ACTIVO de verdad: una tabla creada sin activar RLS lo recibe activado" || mal "el disparador no activó RLS"
psq ens_full -c "drop table public.zz_prueba_rls" >/dev/null 2>&1
n=0; for f in supabase/migrations/*.sql; do n=$((n+1)); psq ens_full -f "$f" >/dev/null 2>"/tmp/ens_err.txt" || { mal "falló la migración $(basename "$f"): $(head -c 200 /tmp/ens_err.txt)"; break; }; done
[ "$n" = 28 ] && ok "las $n migraciones se aplican con la función real y su disparador instalados" || mal "solo se aplicaron $n migraciones"
res="$("$PSQLB" "$BASE/ens_full" -X -At -c "select count(*) || ' ' || count(*) filter (where relrowsecurity) from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind in ('r','p')")"
[ "$res" = "67 67" ] && ok "las 67 tablas de public tienen RLS" || mal "tablas y RLS: $res"
ns=0; for f in supabase/tests/*.sql; do ns=$((ns+1)); psq ens_full -f "$f" >/dev/null 2>"/tmp/ens_err.txt" || { mal "falló la suite $(basename "$f"): $(head -c 200 /tmp/ens_err.txt)"; break; }; done
[ "$ns" = 28 ] && ok "las $ns suites SQL pasan con la función real instalada" || mal "solo corrieron $ns suites"
for t in procedimiento_excepcional_empresas verificacion_inicial_solo_lectura; do
  PSQL_CMD="$PSQLB $BASE/ens_full" bash "supabase/tests/$t.sh" >/tmp/ens_out.txt 2>&1 && ok "$t.sh pasa con la función real instalada" || { mal "$t.sh falló"; tail -3 /tmp/ens_out.txt; }
done
[ "$fallos" = 0 ] && echo "PLATAFORMA ENSURE_RLS OK" || { echo "$fallos fallo(s)"; exit 1; }
