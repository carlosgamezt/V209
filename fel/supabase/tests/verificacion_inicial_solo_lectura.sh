#!/usr/bin/env bash
# Contra PostgreSQL REAL: el envoltorio de solo lectura de «verificar-inicial» ejecuta la verificación y RECHAZA cualquier escritura que alguien intentara colar en el SQL (DML, DDL, permisos…).
# Usa EXACTAMENTE lo que usa la acción (tools/sql-solo-lectura.sh + PGOPTIONS de solo lectura). Base DESECHABLE.
# Uso: PSQL_CMD="psql -h ... -U postgres -d postgres" bash verificacion_inicial_solo_lectura.sh
set -uo pipefail
P=${PSQL_CMD:?define PSQL_CMD}; R="$(cd "$(dirname "$0")/../.." && pwd)"; W="$(mktemp -d)"; trap 'rm -rf -- "$W"' EXIT
source "$R/tools/sql-solo-lectura.sh"
q() { $P -v ON_ERROR_STOP=1 -q -X -t -A -c "$1"; }
corre() { # $1 archivo SQL → salida y código de psql, con el envoltorio y la sesión de solo lectura (como la acción)
  envolver_solo_lectura "$1" > "$W/env.sql"; PGOPTIONS="-c default_transaction_read_only=on" $P -X -q -f "$W/env.sql" 2>&1; }
fallos=0; ok() { echo "OK verificacion-inicial: $1"; }; mal() { echo "FALLO verificacion-inicial: $1"; fallos=$((fallos+1)); }
antes="$(q "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'")"
out="$(corre "$R/docs/migracion-28/verificacion-inicial-nexa-demo.sql")"; rc=$?
[ $rc = 0 ] && grep -qx 'sesión de solo lectura | on | on | OK' <<<"$out" && ok "el SQL real corre bien y la propia consulta confirma que la sesión es de solo lectura" || { mal "el SQL real no corrió"; echo "$out" | head -5; }
n=0; intento() { # $1 descripción, $2 SQL malicioso, $3 texto esperado en el error
  n=$((n+1)); printf '%s\n' "$2" > "$W/malo$n.sql"; local o; o="$(corre "$W/malo$n.sql")"; local c=$?
  if [ $c != 0 ] && grep -qiE "$3" <<<"$o"; then ok "se RECHAZA $1"; else mal "NO se rechazó $1 (rc=$c): $(head -c 160 <<<"$o")"; fi; }
intento "un CREATE TABLE" "select 1; create table public.zz_no_debe_existir (id int);" "read-only transaction"
intento "un INSERT" "select 1; insert into public.empresas (nombre_comercial, razon_social, nit) values ('X', 'X', '1');" "read-only transaction"
intento "un UPDATE" "select 1; update public.empresas set nombre_comercial = 'x';" "read-only transaction"
intento "un DELETE" "select 1; delete from public.empresas;" "read-only transaction"
intento "un TRUNCATE" "select 1; truncate public.clientes;" "read-only transaction"
intento "un DROP" "select 1; drop table public.clientes;" "read-only transaction"
intento "un ALTER" "select 1; alter table public.clientes add column zz int;" "read-only transaction"
intento "un GRANT" "select 1; grant all on public.clientes to anon;" "read-only transaction"
intento "un SELECT INTO (crea una tabla)" "select 1 into public.zz_copia;" "read-only transaction"
intento "una secuencia" "select nextval('public.documentos_numero_seq');" "read-only transaction|does not exist"
intento "un COMMIT seguido de escritura (la sesión de solo lectura sigue vigente)" "select 1; commit; create table public.zz_no_debe_existir2 (id int);" "read-only transaction"
intento "una función que escribe" "select public.fel_auditar(null, null, 'zz_verificacion_inicial_no_debe_existir', 'x', 'x');" "read-only transaction"
despues="$(q "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'")"
[ "$antes" = "$despues" ] && ! [ "$(q "select to_regclass('public.zz_no_debe_existir')")" ] && ok "tras todos los intentos NO cambió nada en la base (mismo número de objetos, ninguna tabla nueva)" || mal "la base cambió: $antes → $despues"
[ "$(q "select count(*) from public.auditoria where accion = 'zz_verificacion_inicial_no_debe_existir'")" = 0 ] && ok "tampoco quedó ninguna fila de auditoría" || mal "quedó una fila de auditoría"
[ "$fallos" = 0 ] && echo "VERIFICACION INICIAL SOLO LECTURA OK" || { echo "$fallos fallo(s)"; exit 1; }
