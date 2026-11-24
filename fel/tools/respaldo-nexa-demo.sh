#!/usr/bin/env bash
# Respaldo de «nexa-demo»: dos acciones MANUALES de SOLO LECTURA sobre el proyecto hospedado (las usa .github/workflows/respaldo-nube.yml, entorno protegido «demo-privada»).
#   bash tools/respaldo-nexa-demo.sh verificar-respaldo   ¿hay respaldos automáticos? (API de gestión, GET). Distingue: RESPALDO CONFIRMADO · SIN RESPALDOS AUTOMÁTICOS · NO VERIFICABLE.
#   bash tools/respaldo-nexa-demo.sh ensayo-respaldo      FASE 1: copia lógica de «public» y «supabase_migrations» → SHA-256 → pg_restore --list → restauración en un PostgreSQL EFÍMERO Y LOCAL → verificación → borrado de la copia.
# GARANTÍAS (cada una tiene su prueba en tools/test-respaldo-nexa-demo.sh y su guardián en tools/verificar-publicacion.py):
#   · Contra nexa-demo SOLO se LEE: GET a la API de gestión; pg_dump (que abre su propia transacción de solo lectura) y consultas dentro de «begin transaction read only». Ninguna restauración, DDL ni escritura va hacia nexa-demo.
#   · La restauración solo puede ir a un PostgreSQL LOCAL (127.0.0.1, localhost, ::1 o un socket Unix) indicado por FEL_ENSAYO_DESTINO_URL; se rechaza todo destino que parezca Supabase, que contenga la referencia del proyecto o que coincida con el origen.
#   · La copia vive en un directorio temporal FUERA del espacio de trabajo (no la puede recoger un artefacto), con permisos 700, y se sobrescribe y borra al terminar (también si falla). Nada se publica: ni artefactos, ni cachés, ni releases, ni registros.
#   · El informe solo trae tamaños, SHA-256 y totales; ni credenciales ni datos.
set -uo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=tools/destinos-demo.sh
source tools/destinos-demo.sh
ACCION="${1:-}"
REF="${FEL_DEMO_PROYECTO_REF:-}"
[[ "$REF" =~ ^[a-z0-9]{20}$ ]] && [ "$REF" = "$REF_ESPERADA" ] || { echo "PROHIBIDO: la referencia no es la del proyecto nexa-demo. No se hace nada."; exit 2; }
enmascarar() { [ -z "${GITHUB_ACTIONS:-}" ] || echo "::add-mask::$1"; }

case "$ACCION" in
# ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
verificar-respaldo)
  TOKEN="${SUPABASE_ACCESS_TOKEN:-}"
  [ -n "$TOKEN" ] || { echo "RESULTADO: NO VERIFICABLE (falta el secreto DEMO_SUPABASE_ACCESS_TOKEN). No se hizo ninguna consulta."; exit 3; }
  enmascarar "$TOKEN"
  command -v curl >/dev/null && command -v python3 >/dev/null || { echo "RESULTADO: NO VERIFICABLE (faltan curl o python3 en este ejecutor)."; exit 3; }
  CUERPO="$(mktemp)"; trap 'rm -f -- "$CUERPO"' EXIT
  echo "== NEXA FEL · ¿respaldos automáticos de nexa-demo? (SOLO LECTURA: un GET a la API de gestión; no se modifica ninguna configuración)"
  CODIGO="$(curl -sS -m 30 -o "$CUERPO" -w '%{http_code}' -H "Authorization: Bearer $TOKEN" -H "Accept: application/json" "https://api.supabase.com/v1/projects/$REF/database/backups" 2>/dev/null)"; RC=$?
  if [ "$RC" != "0" ]; then echo "RESULTADO: NO VERIFICABLE (no se pudo consultar la API de Supabase: error de red o tiempo agotado). Esto NO significa que haya respaldos."; exit 3; fi
  case "$CODIGO" in
    200) ;;
    401|403) echo "RESULTADO: NO VERIFICABLE (la API rechazó el token: ${CODIGO}). Renueva DEMO_SUPABASE_ACCESS_TOKEN; esto NO significa que haya o no respaldos."; exit 3;;
    *) echo "RESULTADO: NO VERIFICABLE (la API respondió HTTP ${CODIGO}). Esto NO significa que haya o no respaldos."; exit 3;;
  esac
  SAL="$(CUERPO="$CUERPO" python3 - <<'PY'
import json, os, sys, datetime
try:
    d = json.load(open(os.environ["CUERPO"], encoding="utf-8"))
    if not isinstance(d, dict) or not isinstance(d.get("backups"), list) or not isinstance(d.get("pitr_enabled"), bool): raise ValueError("estructura inesperada")
except Exception:
    print("INVALIDO"); sys.exit(0)
b = [x for x in d["backups"] if isinstance(x, dict)]
def gt(s):
    try: return datetime.datetime.fromisoformat(str(s).replace("Z", "+00:00")).astimezone(datetime.timezone(datetime.timedelta(hours=-6))).strftime("%d/%m/%Y %H:%M (hora de Guatemala)")
    except Exception: return "fecha no legible"
fechas = sorted([x.get("inserted_at") for x in b if x.get("inserted_at")])
ult = gt(fechas[-1]) if fechas else "sin fecha"
ph = d.get("physical_backup_data") if isinstance(d.get("physical_backup_data"), dict) else {}
print(f"OK|{len(b)}|{'si' if d['pitr_enabled'] else 'no'}|{'si' if d.get('walg_enabled') else 'no'}|{ult}|{'si' if ph.get('earliest_physical_backup_date_unix') or ph.get('latest_physical_backup_date_unix') else 'no'}|{str(d.get('region','?'))[:30]}")
PY
)"
  if [ "${SAL%%|*}" != "OK" ]; then echo "RESULTADO: NO VERIFICABLE (la respuesta de la API no tiene la estructura esperada)."; exit 3; fi
  IFS='|' read -r _ N PITR WALG ULT FIS REG <<<"$SAL"
  echo "  copias listadas por la API: $N · PITR activado: $PITR · WAL-G: $WALG · copia física registrada: $FIS · región: $REG"
  echo "  (el plan de Supabase no lo devuelve este endpoint: se deduce de lo anterior; si hay dudas, confírmalo en el panel)"
  if [ "$N" != "0" ] || [ "$PITR" = "si" ]; then
    echo "  última copia: $ULT"
    echo "RESULTADO: RESPALDO CONFIRMADO (la API informa $N copia(s) y PITR=$PITR). Falta comprobar que se pueda restaurar: usa la fase 1 (ensayo-respaldo)."; exit 0
  fi
  echo "RESULTADO: SIN RESPALDOS AUTOMÁTICOS (la API responde correctamente y no lista copias ni PITR; coherente con el plan Free). Hace falta una copia lógica propia."; exit 0;;

# ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
ensayo-respaldo)
  falla() { echo "FALLO: $1"; echo "ENSAYO DE RESPALDO Y RESTAURACIÓN: FALLÓ"; exit 1; }
  for h in psql pg_dump pg_restore python3 sha256sum; do command -v "$h" >/dev/null || falla "falta la herramienta $h en este ejecutor"; done
  # ---- 1. origen: la cadena del pooler COMPARTIDO de nexa-demo (solo se usa para leer)
  U="${FEL_DEMO_BD_URL:-}"; [ -n "$U" ] || { echo "PROHIBIDO: falta FEL_DEMO_BD_URL. No se hace nada."; exit 2; }
  RE="^postgres(ql)?://postgres\.${REF}:([^@/:?#[:space:]]+)@([a-z0-9-]+\.pooler\.supabase\.com):(6543|5432)/postgres$"
  [[ "$U" =~ $RE ]] || { echo "PROHIBIDO: FEL_DEMO_BD_URL no es la cadena del pooler compartido de nexa-demo (usuario postgres.<ref>, host *.pooler.supabase.com, base postgres). No se hace nada."; exit 2; }
  CLAVE_BD="${BASH_REMATCH[2]}"; HOST_BD="${BASH_REMATCH[3]}"
  CLAVE_URL="$(P="$CLAVE_BD" python3 -c 'import os,urllib.parse;print(urllib.parse.unquote(os.environ["P"]),end="")')"
  enmascarar "$CLAVE_URL"; enmascarar "$CLAVE_BD"
  ORIGEN="host=$HOST_BD port=5432 dbname=postgres user=postgres.$REF sslmode=require"     # Session Pooler (pg_dump no funciona por el puerto 6543)
  src() { PGPASSWORD="$CLAVE_URL" PGCONNECT_TIMEOUT=20 "$@"; }
  src_ro() { src psql "$ORIGEN" -X -q -tA -v ON_ERROR_STOP=1 -c "begin transaction read only" -c "$1" -c "rollback"; }   # TODA consulta al origen va en una transacción de solo lectura
  # ---- 2. destino de la restauración: SOLO un PostgreSQL local y efímero; una configuración incorrecta se RECHAZA antes de tocar nada
  D="${FEL_ENSAYO_DESTINO_URL:-}"; [ -n "$D" ] || { echo "PROHIBIDO: falta FEL_ENSAYO_DESTINO_URL (PostgreSQL local y efímero para restaurar). No se hace nada."; exit 2; }
  DEST_ADMIN=""; DEST_DB_URL=""
  DESTINO_PARTES="$(D="$D" python3 - <<'PY'
import os, re, sys, urllib.parse as u
d = os.environ["D"]
try: p = u.urlsplit(d)
except Exception: print("INVALIDO"); sys.exit(0)
if p.scheme not in ("postgres", "postgresql"): print("INVALIDO"); sys.exit(0)
q = dict(u.parse_qsl(p.query)); host = (p.hostname or q.get("host", "")).lower()
local = host in ("127.0.0.1", "localhost", "::1") or host.startswith("/")
if p.hostname and any(k in q for k in ("host", "hostaddr", "service")): print("INVALIDO"); sys.exit(0)   # un parámetro «host=» podría redirigir la conexión en libpq
if any(k in q for k in ("hostaddr", "service", "passfile", "sslrootcert", "options")): print("INVALIDO"); sys.exit(0)
if not local or p.path.strip("/") not in ("postgres", ""): print("INVALIDO"); sys.exit(0)
print("OK|" + host)
PY
)"
  [ "${DESTINO_PARTES%%|*}" = "OK" ] || { echo "PROHIBIDO: FEL_ENSAYO_DESTINO_URL no es un PostgreSQL LOCAL (127.0.0.1, localhost, ::1 o socket Unix, base postgres). Nunca se restaura en otro lugar. No se hace nada."; exit 2; }
  case "${D,,}" in *supabase*|*pooler*|*"$REF"*) echo "PROHIBIDO: el destino de la restauración parece Supabase o contiene la referencia de nexa-demo. No se hace nada."; exit 2;; esac
  [ "${DESTINO_PARTES#OK|}" != "$HOST_BD" ] || { echo "PROHIBIDO: el destino coincide con el origen. No se hace nada."; exit 2; }
  # ---- 3. directorio temporal: fuera del espacio de trabajo (ningún artefacto lo recoge), permisos 700, borrado controlado al terminar
  T="$(mktemp -d "${TMPDIR:-/tmp}/nexa-respaldo.XXXXXX")" || falla "no se pudo crear el directorio temporal"
  chmod 700 "$T"
  REPO="$(cd .. && pwd)"; case "$T/" in "$REPO"/*|"${GITHUB_WORKSPACE:-/nonexistent-ws}"/*) rm -rf -- "$T"; falla "el directorio temporal quedó dentro del espacio de trabajo; no se continúa";; esac
  NOMBRE_DB="nexa_ensayo_$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"; DB_CREADA=0
  limpiar() {
    if [ "$DB_CREADA" = 1 ]; then psql "$DEST_ADMIN" -X -q -c "drop database if exists $NOMBRE_DB with (force)" >/dev/null 2>&1; fi
    if [ -d "$T" ]; then find "$T" -type f -exec shred -u {} + 2>/dev/null; rm -rf -- "$T"; fi
    [ -d "$T" ] && echo "  AVISO: no se pudo borrar $T" || echo "  OK    copia temporal sobrescrita y eliminada"
  }
  trap limpiar EXIT
  echo "== NEXA FEL · ENSAYO DE RESPALDO Y RESTAURACIÓN de nexa-demo (FASE 1) · origen: SOLO LECTURA · destino: PostgreSQL local y efímero"
  # ---- 4. conexión al origen: solo lectura DEMOSTRADA (una escritura de prueba debe ser rechazada) y versión
  PRUEBA="$(src psql "$ORIGEN" -X -q -tA -v ON_ERROR_STOP=1 -c "begin transaction read only" -c "select 'tx=' || current_setting('transaction_read_only')" -c "create temp table zz_nexa_prueba_escritura (i int)" -c "rollback" 2>&1)"
  PRUEBA="${PRUEBA//"$CLAVE_URL"/***}"
  if printf '%s' "$PRUEBA" | grep -q '^tx=on$' && printf '%s' "$PRUEBA" | grep -qi 'read-only transaction'; then echo "  OK    origen en solo lectura: PostgreSQL RECHAZÓ una escritura de prueba"; else falla "no se pudo demostrar la solo lectura del origen (o no se pudo conectar)"; fi
  VS="$(src_ro "select current_setting('server_version_num')::int / 10000" 2>/dev/null)"; [[ "$VS" =~ ^[0-9]+$ ]] || falla "no se pudo leer la versión del servidor"
  VC="$(pg_dump --version | grep -oE '[0-9]+(\.[0-9]+)?' | head -1 | cut -d. -f1)"; [[ "$VC" =~ ^[0-9]+$ ]] || falla "no se pudo leer la versión de pg_dump"
  [ "$VC" -ge "$VS" ] || falla "pg_dump $VC no puede volcar un servidor PostgreSQL $VS (el cliente debe ser de la misma versión o más nueva)"
  echo "  OK    cliente compatible: pg_dump $VC · servidor PostgreSQL $VS"
  # ---- 5. SQL de comparación (solo SELECT; se ejecuta IGUAL en el origen —dentro de la instantánea— y en lo restaurado)
  FMT="set local datestyle = 'ISO, MDY'; set local timezone = 'UTC'; set local extra_float_digits = 3; set local bytea_output = 'hex'; set local intervalstyle = 'postgres'; set local lc_monetary = 'C'"
  # ORDEN DETERMINISTA E INDEPENDIENTE DE LA CONFIGURACIÓN: la huella de cada tabla ordena el texto de las filas con la ordenación binaria «C» (collate "C"), que NO depende de la ordenación (collation) de cada base.
  #   Sin esto, la misma tabla da huellas distintas en dos bases con otra ordenación (p. ej. «C.UTF-8» en el origen y «en_US.utf8» en el PostgreSQL efímero) cuando las filas empiezan por un identificador numérico de distinta longitud ((2,…) frente a (10,…)),
  #   aunque los datos sean idénticos: fallo real de la corrida 44982292038 en auditoria, bolson_movimientos, documento_estados y monedero_movimientos.
  read -r -d '' SQL_CONTENIDO <<'SQL'
select table_schema || '.' || table_name || '=' || (xpath('/row/n/text()', query_to_xml(format('select count(*)::text || %L || coalesce(md5(string_agg(t::text, %L order by t::text collate "C")), %L) as n from %I.%I t', ':', '|', '-', table_schema, table_name), false, true, '')))[1]::text
from information_schema.tables where table_schema in ('public', 'supabase_migrations') and table_type = 'BASE TABLE' order by table_schema collate "C", table_name collate "C";
SQL
  read -r -d '' SQL_ESTRUCTURA <<'SQL'
with rel as (select c.oid, n.nspname, c.relname, c.relkind, c.relowner, c.relacl, c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'supabase_migrations') and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')),
fn as (select p.oid, n.nspname, p.proname, p.prokind, p.proowner, p.prosecdef, p.proconfig, p.proacl, pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'supabase_migrations') and p.prokind in ('f', 'p') and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
rol(r) as (values ('anon'), ('authenticated'), ('service_role'))
select cat || '|' || clave || '|' || valor from (
  select 'esquema' cat, nspname::text clave, case when nspacl is null or (select string_agg(i::text, ',' order by i::text collate "C") from unnest(nspacl) i) = (select string_agg(i::text, ',' order by i::text collate "C") from unnest(acldefault('n', nspowner)) i) then '-' else (select string_agg(i::text, ',' order by i::text collate "C") from unnest(nspacl) i) end valor from pg_namespace where nspname in ('public', 'supabase_migrations')
  union all select 'propietario', 'esquema ' || nspname, pg_get_userbyid(nspowner) from pg_namespace where nspname in ('public', 'supabase_migrations')
  union all select 'relacion', nspname || '.' || relname, relkind::text || '|' || case when relacl is null or (select string_agg(i::text, ',' order by i::text collate "C") from unnest(relacl) i) = (select string_agg(i::text, ',' order by i::text collate "C") from unnest(acldefault((case when relkind = 'S' then 's' else 'r' end)::"char", relowner)) i) then '-' else (select string_agg(i::text, ',' order by i::text collate "C") from unnest(relacl) i) end || '|rls=' || relrowsecurity || '|force=' || relforcerowsecurity from rel
  union all select 'propietario', 'relacion ' || nspname || '.' || relname, pg_get_userbyid(relowner) from rel
  union all select 'funcion', nspname || '.' || proname || '(' || args || ')', prokind::text || '|secdef=' || prosecdef || '|' || coalesce(proconfig::text, '-') || '|' || case when proacl is null or (select string_agg(i::text, ',' order by i::text collate "C") from unnest(proacl) i) = (select string_agg(i::text, ',' order by i::text collate "C") from unnest(acldefault('f', proowner)) i) then '-' else (select string_agg(i::text, ',' order by i::text collate "C") from unnest(proacl) i) end || '|' || md5(pg_get_functiondef(oid)) from fn
  union all select 'propietario', 'funcion ' || nspname || '.' || proname || '(' || args || ')', pg_get_userbyid(proowner) from fn
  union all select 'columna', rel.nspname || '.' || rel.relname || '.' || a.attname, row_number() over (partition by a.attrelid order by a.attnum)::text || '|' || format_type(a.atttypid, a.atttypmod) || '|' || a.attnotnull || '|' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-') || '|' || coalesce((select string_agg(i::text, ',' order by i::text collate "C") from unnest(a.attacl) i), '-')
    from pg_attribute a join rel on rel.oid = a.attrelid left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attnum > 0 and not a.attisdropped
  union all select 'restriccion', rel.nspname || '.' || rel.relname || '.' || con.conname, con.contype::text || '|' || case when con.contype = 'c' then regexp_replace(pg_get_constraintdef(con.oid), '[()[:space:]]', '', 'g') else pg_get_constraintdef(con.oid) end from pg_constraint con join rel on rel.oid = con.conrelid
  union all select 'indice', schemaname || '.' || tablename || '.' || indexname, indexdef from pg_indexes where schemaname in ('public', 'supabase_migrations')
  union all select 'disparador', rel.nspname || '.' || rel.relname || '.' || t.tgname, t.tgenabled::text || '|' || pg_get_triggerdef(t.oid) from pg_trigger t join rel on rel.oid = t.tgrelid where not t.tgisinternal
  union all select 'politica', schemaname || '.' || tablename || '.' || policyname, cmd || '|' || permissive || '|' || roles::text || '|' || coalesce(regexp_replace(qual, '[()[:space:]]', '', 'g'), '-') || '|' || coalesce(regexp_replace(with_check, '[()[:space:]]', '', 'g'), '-') from pg_policies where schemaname in ('public', 'supabase_migrations')
  union all select 'acl_defecto', pg_get_userbyid(d.defaclrole) || '|' || coalesce(n.nspname, '*') || '|' || d.defaclobjtype::text, (select string_agg(i::text, ',' order by i::text collate "C") from unnest(d.defaclacl) i) from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace where n.nspname is null or n.nspname in ('public', 'supabase_migrations')
  union all select 'privilegio', r || '|' || nspname || '.' || relname, case when relkind = 'S' then coalesce((select string_agg(p, ',' order by p) from unnest(array['USAGE', 'SELECT', 'UPDATE']) p where has_sequence_privilege(r, rel.oid, p)), '-')
      else coalesce((select string_agg(p, ',' order by p) from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p where has_table_privilege(r, rel.oid, p)), '-') end from rol, rel
  union all select 'privilegio', r || '|' || nspname || '.' || proname || '(' || args || ')', case when has_function_privilege(r, fn.oid, 'EXECUTE') then 'EXECUTE' else '-' end from rol, fn
  union all select 'privilegio', r || '|esquema ' || n.nspname, coalesce((select string_agg(p, ',' order by p) from unnest(array['USAGE', 'CREATE']) p where has_schema_privilege(r, n.oid, p)), '-') from rol, pg_namespace n where n.nspname in ('public', 'supabase_migrations')
) x order by 1;
SQL
  # ACL: el ORDEN de los elementos de una lista de privilegios (aclitem[]) no tiene significado (depende del orden en que se concedieron); se comparan como CONJUNTO, ordenados con collate "C". Un privilegio de más, de menos o de otro rol SÍ cambia el conjunto y se detecta.
  #   Fallo real de la corrida 45014818622: public tenía los mismos 6 elementos en origen y destino, en distinto orden (postgres antes o después de anon).
  # NOTA: en las restricciones CHECK y en las políticas se compara el texto SIN paréntesis ni espacios: el volcado reanaliza la expresión y puede aplanar paréntesis (p. ej. ((a AND b) AND c) → (a AND b AND c)) sin cambiar su significado.
  #       Es una normalización deliberada y se declara como limitación en el informe.
  # ---- 6. INSTANTÁNEA CONSISTENTE: una sesión de solo lectura (REPEATABLE READ) EXPORTA una instantánea y la mantiene abierta; los conteos, el contenido, la estructura y el pg_dump leen EXACTAMENTE esa instantánea.
  #      Así no se comparan datos tomados en momentos distintos: lo que cambie en el origen después NO afecta ni a la copia ni a la comparación (y se informa aparte como modificación legítima).
  coproc SNAP { src psql "$ORIGEN" -X -q -tA -v ON_ERROR_STOP=1 2>"$T/snap.err"; }
  snap_q() { local l; printf '%s\n' "$1" "select '@@FIN@@';" >&"${SNAP[1]}" 2>/dev/null || return 1; while IFS= read -r -t 180 l <&"${SNAP[0]}"; do [ "$l" = "@@FIN@@" ] && return 0; printf '%s\n' "$l"; done; return 1; }
  cierra_snap() { printf 'rollback;\n\\q\n' >&"${SNAP[1]}" 2>/dev/null; wait "$SNAP_PID" 2>/dev/null; }
  snap_q "begin transaction isolation level repeatable read read only;" >/dev/null || falla "no se pudo abrir la sesión de solo lectura para la instantánea"
  SNAP_ID="$(snap_q "select pg_export_snapshot();")"; [[ "$SNAP_ID" =~ ^[0-9A-F]+(-[0-9A-F]+)+$ ]] || falla "no se pudo exportar una instantánea consistente del origen: no se puede garantizar la consistencia de la copia"
  snap_q "$FMT;" >/dev/null || falla "no se pudo fijar el formato de comparación"
  HORA_SNAP="$(snap_q "select to_char(now() at time zone 'America/Guatemala', 'DD/MM/YYYY HH24:MI:SS');")"
  N_MIG="$(snap_q "select count(*) from supabase_migrations.schema_migrations;")"
  # El ensayo vale para DOS estados del origen: las 28 migraciones (la 29 ausente) o las 29 (la 29 aplicada, con sus dos tablas). Cualquier otro estado se rechaza.
  case "$N_MIG" in 28) CON29=0; HASTA_V=20261113000100;; 29) CON29=1; HASTA_V=20261114000100;; *) falla "el origen NO tiene exactamente 28 migraciones registradas (ni las 29, con la migración 29 aplicada)";; esac
  if [ "$CON29" = 0 ]; then [ "$(snap_q "select to_regclass('public.digifact_operaciones') is null;")" = "t" ] || falla "la migración 29 ya existe en el origen: con 28 migraciones registradas, este ensayo es previo a la 29"
  else [ "$(snap_q "select to_regclass('public.digifact_operaciones') is not null and to_regclass('public.digifact_artefactos') is not null;")" = "t" ] || falla "el origen registra 29 migraciones pero le faltan las tablas de la migración 29"; fi
  VER_ORIGEN="$(snap_q "select string_agg(version, ' ' order by version) from supabase_migrations.schema_migrations;")"
  VER_REPO="$(for f in supabase/migrations/*.sql; do b="$(basename "$f")"; v="${b%%_*}"; [ "$v" -le "$HASTA_V" ] && echo "$v"; done | sort | tr '\n' ' ' | sed 's/ $//')"
  [ "$VER_ORIGEN" = "$VER_REPO" ] || falla "las $N_MIG migraciones registradas en el origen no coinciden con las del repositorio"
  CONT_ORIGEN="$(snap_q "$SQL_CONTENIDO")" || falla "no se pudo leer el contenido del origen en la instantánea"; [ -n "$CONT_ORIGEN" ] || falla "el origen no tiene tablas en public"
  ESTR_ORIGEN="$(snap_q "$SQL_ESTRUCTURA")" || falla "no se pudo leer la estructura del origen en la instantánea"; [ -n "$ESTR_ORIGEN" ] || falla "no se pudo leer la estructura del origen"
  NTAB="$(printf '%s\n' "$CONT_ORIGEN" | grep -c .)"; TOTAL="$(printf '%s\n' "$CONT_ORIGEN" | awk -F'[=:]' '{s+=$2} END{print s+0}')"
  echo "  OK    instantánea consistente del origen (tomada $HORA_SNAP, hora de Guatemala): $NTAB tablas · $TOTAL filas · $N_MIG migraciones iguales a las del repositorio · la 29 $([ "$CON29" = 1 ] && echo presente || echo ausente)"
  # ---- 7. copia lógica LEÍDA DE ESA MISMA INSTANTÁNEA (pg_dump es de solo lectura) · sin propietarios (--no-owner), con los permisos (ACL)
  src pg_dump "$ORIGEN" -Fc --schema=public --schema=supabase_migrations --no-owner --snapshot="$SNAP_ID" -f "$T/respaldo.dump" 2>"$T/dump.err" || { cierra_snap; falla "pg_dump falló: $(head -c 200 "$T/dump.err" | tr '\n' ' ' | sed "s|$CLAVE_URL|***|g")"; }
  [ -s "$T/respaldo.dump" ] || { cierra_snap; falla "pg_dump no generó contenido"; }
  cierra_snap
  # lo que cambió en el origen DESPUÉS de la instantánea es una modificación legítima (no afecta a la copia): se informa, no se confunde con una restauración incorrecta
  VIVO="$(src psql "$ORIGEN" -X -q -tA -v ON_ERROR_STOP=1 -c "begin transaction read only" -c "$FMT" -c "$(printf '%s' "$SQL_CONTENIDO" | tr '\n' ' ')" -c "rollback" 2>/dev/null)"
  if [ -n "$VIVO" ] && [ "$VIVO" != "$CONT_ORIGEN" ]; then echo "  INFO  el origen cambió DESPUÉS de la instantánea (modificación legítima): la copia corresponde a la instantánea de las $HORA_SNAP y la comparación usa esa misma instantánea"; fi
  TAM="$(stat -c %s "$T/respaldo.dump")"; SHA="$(sha256sum "$T/respaldo.dump" | cut -d' ' -f1)"
  echo "  OK    copia lógica generada: $TAM bytes · SHA-256 $SHA"
  pg_restore --list "$T/respaldo.dump" > "$T/lista.txt" 2>"$T/lista.err" || falla "pg_restore --list no puede leer la copia"
  grep -q "TABLE DATA public empresas" "$T/lista.txt" && grep -q "TABLE DATA supabase_migrations schema_migrations" "$T/lista.txt" || falla "la copia NO contiene los datos de empresas o del historial de migraciones"
  echo "  OK    pg_restore --list: la copia contiene los datos de public y el historial de migraciones"
  # ---- 8. destino efímero: base nueva con lo mínimo que Supabase ya trae, privilegios por defecto retirados (para que la restauración los reproduzca tal cual vienen del origen)
  DEST_ADMIN="$D"
  psql "$DEST_ADMIN" -X -q -v ON_ERROR_STOP=1 -c "create database $NOMBRE_DB" >/dev/null 2>"$T/destino.err" || falla "no se pudo crear la base efímera en el destino local: $(head -c 160 "$T/destino.err")"
  DB_CREADA=1
  DEST_DB="$(D="$D" N="$NOMBRE_DB" python3 -c 'import os,urllib.parse as u;d=os.environ["D"];p=u.urlsplit(d);print(u.urlunsplit((p.scheme,p.netloc,"/"+os.environ["N"],p.query,"")))')"
  rd() { psql "$DEST_DB" -X -q -v ON_ERROR_STOP=1 "$@"; }
  rd -f tools/shim_supabase.sql >/dev/null 2>&1 || falla "no se pudo preparar la base efímera"
  rd -c "alter default privileges in schema public revoke all on tables from anon, authenticated, service_role" -c "alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role" -c "alter default privileges in schema public revoke execute on functions from anon, authenticated, service_role" >/dev/null 2>&1 || falla "no se pudieron retirar los privilegios por defecto del destino"
  grep -v " SCHEMA - public " "$T/lista.txt" > "$T/lista_sin_schema.txt"    # el destino ya trae public: se restaura su CONTENIDO, no se recrea el esquema
  # roles que la copia menciona en sus permisos y que el destino no tiene: se crean VACÍOS (sin atributos ni membresías; es una limitación declarada) para que los permisos se puedan restaurar
  pg_restore -L "$T/lista_sin_schema.txt" -f "$T/todo.sql" "$T/respaldo.dump" 2>/dev/null || falla "no se pudo leer el contenido de la copia para revisar sus roles"
  ROLES_FALTAN="$(python3 - "$T/todo.sql" <<'PY'
import re, sys
t = open(sys.argv[1], encoding="utf-8").read()
nombres = set()
for m in re.finditer(r"^(?:GRANT|REVOKE)\b[^;]*?\b(?:TO|FROM)\s+([^;]+);", t, re.M | re.S):
    resto = re.split(r"\s+(?:GRANTED BY|WITH GRANT OPTION|CASCADE|RESTRICT)\b", m.group(1))[0]
    nombres |= {x.strip().strip('"') for x in resto.split(",")}
for m in re.finditer(r"ALTER DEFAULT PRIVILEGES FOR ROLE\s+(\S+)", t): nombres.add(m.group(1).strip('"'))
ignorar = {"PUBLIC", "CURRENT_USER", "CURRENT_ROLE", "SESSION_USER", "postgres", ""}
print(" ".join(sorted(n for n in nombres if n not in ignorar and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", n))))
PY
)"
  ROLES_CREADOS=""
  for r in $ROLES_FALTAN; do
    if [ "$(rd -tA -c "select exists (select 1 from pg_roles where rolname = '$r')")" != "t" ]; then rd -c "create role \"$r\" nologin" >/dev/null 2>&1 && ROLES_CREADOS="$ROLES_CREADOS $r"; fi
  done
  # ---- 9. restauración en tres secciones; los usuarios de Auth no van en la copia: antes de las claves foráneas se crean usuarios de PRUEBA (sin datos reales) para los identificadores referenciados
  pg_restore -d "$DEST_DB" --no-owner --exit-on-error --section=pre-data -L "$T/lista_sin_schema.txt" "$T/respaldo.dump" 2>"$T/r1.err" || falla "la restauración (estructura) falló: $(head -c 200 "$T/r1.err" | tr '\n' ' ')"
  pg_restore -d "$DEST_DB" --no-owner --exit-on-error --disable-triggers --section=data -L "$T/lista_sin_schema.txt" "$T/respaldo.dump" 2>"$T/r2.err" || falla "la restauración (datos) falló: $(head -c 200 "$T/r2.err" | tr '\n' ' ')"
  pg_restore --section=post-data -L "$T/lista_sin_schema.txt" -f "$T/post.sql" "$T/respaldo.dump" 2>/dev/null || falla "no se pudo leer la sección de restricciones de la copia"
  python3 - "$T/post.sql" > "$T/usuarios.sql" <<'PY'
import re, sys
t = open(sys.argv[1], encoding="utf-8").read()
pares = set(re.findall(r"ALTER TABLE ONLY ([\w\".]+)\s+ADD CONSTRAINT [\w\"]+ FOREIGN KEY \((\w+)\) REFERENCES auth\.users\(id\)", t))
for tabla, col in sorted(pares):
    print(f"insert into auth.users (id, email) select distinct {col}, 'ensayo-' || {col}::text || '@invalido.test' from {tabla} where {col} is not null on conflict do nothing;")
PY
  [ ! -s "$T/usuarios.sql" ] || rd -f "$T/usuarios.sql" >/dev/null 2>"$T/u.err" || falla "no se pudieron crear los usuarios de prueba del destino"
  pg_restore -d "$DEST_DB" --no-owner --exit-on-error --section=post-data -L "$T/lista_sin_schema.txt" "$T/respaldo.dump" 2>"$T/r3.err" || falla "la restauración (restricciones e índices) falló: $(head -c 200 "$T/r3.err" | tr '\n' ' ')"
  echo "  OK    restauración completa en la base efímera ($NOMBRE_DB, local)"
  # ---- 10. verificaciones sobre lo restaurado (todas en solo lectura y con el MISMO SQL que se usó en la instantánea del origen)
  rdq() { psql "$DEST_DB" -X -q -tA -v ON_ERROR_STOP=1 -c "begin transaction read only" -c "$FMT" -c "$(printf '%s' "$1" | tr '\n' ' ')" -c "rollback"; }
  CONT_REST="$(rdq "$SQL_CONTENIDO" 2>/dev/null)" || falla "no se pudo leer el contenido de lo restaurado"
  # diagnóstico sin datos: la ordenación (collation) de cada base (la huella NO depende de ella: ordena con collate "C")
  Q_COL="select datcollate || '/' || datctype || '/' || case datlocprovider when 'c' then 'libc' when 'i' then 'icu' else 'otro' end from pg_database where datname = current_database()"
  COL_O="$(src_ro "$Q_COL" 2>/dev/null | head -1)"; COL_D="$(rdq "$Q_COL" 2>/dev/null | head -1)"
  echo "  INFO  ordenación (collation/ctype/proveedor) · origen: ${COL_O:-desconocida} · destino efímero: ${COL_D:-desconocida} (la huella de contenido ordena con collate \"C\": no depende de ellas)"
  if [ "$CONT_ORIGEN" != "$CONT_REST" ]; then
    echo "  diferencias por tabla (instantánea del origen vs restaurado; formato tabla=filas:huella):"; diff <(printf '%s\n' "$CONT_ORIGEN") <(printf '%s\n' "$CONT_REST") | grep '^[<>]' | cut -c1-110 | head -10
    [ "$(printf '%s\n' "$CONT_ORIGEN" | cut -d: -f1)" = "$(printf '%s\n' "$CONT_REST" | cut -d: -f1)" ] && falla "el CONTENIDO de lo restaurado no coincide con la instantánea del origen (mismas filas, datos distintos)"
    falla "los conteos de filas de lo restaurado NO coinciden con la instantánea del origen: la restauración es incorrecta"
  fi
  echo "  OK    datos: las $NTAB tablas, $TOTAL filas y su contenido (huella por tabla) coinciden exactamente con la instantánea del origen"
  [ "$(rdq "select count(*) from supabase_migrations.schema_migrations;")" = "$N_MIG" ] && [ "$(rdq "select string_agg(version, ' ' order by version) from supabase_migrations.schema_migrations;")" = "$VER_ORIGEN" ] || falla "el historial de migraciones restaurado no son las $N_MIG del origen"
  echo "  OK    historial restaurado: las $N_MIG migraciones"
  if [ "$CON29" = 0 ]; then
    [ "$(rdq "select to_regclass('public.digifact_operaciones') is null and to_regclass('public.digifact_artefactos') is null;")" = "t" ] || falla "lo restaurado ya tiene la migración 29"
    echo "  OK    la migración 29 sigue ausente en lo restaurado"
  else
    [ "$(rdq "select to_regclass('public.digifact_operaciones') is not null and to_regclass('public.digifact_artefactos') is not null;")" = "t" ] || falla "lo restaurado no tiene las tablas de la migración 29"
    echo "  OK    la migración 29 está presente en lo restaurado (sus dos tablas)"
  fi
  ESTR_REST="$(rdq "$SQL_ESTRUCTURA" 2>/dev/null)" || falla "no se pudo leer la estructura de lo restaurado"
  printf '%s\n' "$ESTR_ORIGEN" > "$T/estr_origen.txt"; printf '%s\n' "$ESTR_REST" > "$T/estr_rest.txt"
  INFORME="$(python3 - "$T/estr_origen.txt" "$T/estr_rest.txt" <<'PY'
import sys
def leer(p):
    d = {}
    for l in open(p, encoding="utf-8").read().splitlines():
        if l.count("|") < 2: continue
        c, k, v = l.split("|", 2); d.setdefault(c, {})[k] = v
    return d
o, r = leer(sys.argv[1]), leer(sys.argv[2])
cats = ["esquema", "relacion", "columna", "restriccion", "indice", "disparador", "politica", "funcion", "acl_defecto", "privilegio", "propietario"]
fallos, limit, total = [], 0, 0
for c in cats:
    a, b = o.get(c, {}), r.get(c, {}); total += len(a)
    for k in sorted(set(a) | set(b)):
        if a.get(k) == b.get(k): continue
        if c == "propietario" and a.get(k) not in (None, "postgres") and b.get(k) == "postgres": limit += 1; continue   # propietario que no es postgres: el volcado usa --no-owner (limitación declarada)
        fallos.append((c, k, a.get(k, "(no existe)"), b.get(k, "(no existe)")))
print(f"ELEMENTOS|{total}|{len(cats)}|{limit}")
for c, k, x, y in fallos[:10]: print(f"DIF|{c}|{k}|origen={x[:400]}|restaurado={y[:400]}")
print(f"TOTALDIF|{len(fallos)}")
PY
)"
  NDIF="$(printf '%s\n' "$INFORME" | sed -n 's/^TOTALDIF|//p')"
  if [ "$NDIF" != "0" ]; then echo "  diferencias de estructura, propietarios y permisos (origen vs restaurado):"; printf '%s\n' "$INFORME" | grep '^DIF|' | cut -c1-900 | head -10; falla "la estructura, los propietarios o los permisos de lo restaurado NO coinciden con el origen ($NDIF diferencias)"; fi
  NELEM="$(printf '%s\n' "$INFORME" | sed -n 's/^ELEMENTOS|\([0-9]*\)|.*/\1/p')"; NLIM="$(printf '%s\n' "$INFORME" | sed -n 's/^ELEMENTOS|[0-9]*|[0-9]*|\([0-9]*\)$/\1/p')"
  echo "  OK    estructura, propietarios y permisos: $NELEM elementos idénticos (columnas, restricciones, índices, disparadores, políticas, funciones, ACL de objetos, privilegios por defecto y privilegios efectivos de anon, authenticated y service_role)"
  [ -z "$ROLES_CREADOS" ] || echo "  LIMITACIÓN: la copia menciona roles que el destino no tenía (${ROLES_CREADOS# }); se crearon vacíos: sus atributos y membresías NO se reproducen"
  [ "${NLIM:-0}" = "0" ] || echo "  LIMITACIÓN: $NLIM objeto(s) tienen un propietario distinto de postgres en el origen; el volcado usa --no-owner y en lo restaurado son de postgres: NO validado de forma equivalente"
  if [ "$CON29" = 0 ]; then
    printf '%s\n' '\set ON_ERROR_STOP on' 'begin transaction read only;' "\\i docs/migracion-28/verificacion-posterior-28.sql" > "$T/ro28.sql"
    SC="$(psql "$DEST_DB" -X -q -v ON_ERROR_STOP=1 -f "$T/ro28.sql" 2>&1)" || { echo "$SC" | grep -m1 ERROR | head -c 200; falla "lo restaurado NO pasa el catálogo de la migración 28"; }
    echo "$SC" | grep -q "VERIFICACION POSTERIOR 28 OK" || falla "el catálogo de la migración 28 no confirmó OK"
    echo "  OK    catálogo de la migración 28 sano en lo restaurado (67 tablas, políticas, funciones y privilegios; transacción de solo lectura)"
  else
    # El disparador de evento «ensure_rls» de la plataforma NO viaja en el volcado de «public»: si el origen trae la función public.rls_auto_enable(), se recrea EN EL DESTINO EFÍMERO (nunca en el origen) para evaluar el catálogo
    # con la misma regla estricta que en el origen. La estructura (incluida esa función) ya se comparó idéntica arriba.
    if [ "$(psql "$DEST_DB" -X -q -tA -c "select to_regprocedure('public.rls_auto_enable()') is not null")" = "t" ]; then
      psql "$DEST_DB" -X -q -v ON_ERROR_STOP=1 -c "drop event trigger if exists ensure_rls" -c "create event trigger ensure_rls on ddl_command_end when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO') execute function public.rls_auto_enable()" >/dev/null 2>&1 || falla "no se pudo recrear el disparador de evento de la plataforma en el destino efímero"
    fi
    printf '%s\n' '\set ON_ERROR_STOP on' 'begin transaction read only;' "\\i docs/migracion-29/verificacion-posterior-29.sql" > "$T/ro29.sql"
    SC="$(psql "$DEST_DB" -X -q -v ON_ERROR_STOP=1 -f "$T/ro29.sql" 2>&1)" || { echo "$SC" | grep -m1 ERROR | head -c 200; falla "lo restaurado NO pasa el catálogo de la migración 29"; }
    echo "$SC" | grep -q "VERIFICACION POSTERIOR 29 OK" || falla "el catálogo de la migración 29 no confirmó OK"
    echo "  OK    catálogo de la migración 29 sano en lo restaurado (69 tablas con RLS, políticas, funciones —con la excepción estricta de rls_auto_enable()—, disparadores y privilegios; transacción de solo lectura)"
  fi
  echo "  LIMITACIONES de esta validación (no son prueba aprobada): las expresiones CHECK y de políticas se comparan sin paréntesis (el volcado puede aplanarlos); atributos y membresías de roles; extensiones y su configuración; disparadores de evento de la plataforma; todo lo que está fuera de public y supabase_migrations (auth, storage, vault); los usuarios de Auth se sustituyen por usuarios de prueba"
  echo "== INFORME (sin datos): tablas $NTAB · filas $TOTAL · elementos de estructura $NELEM · tamaño de la copia $TAM bytes · SHA-256 $SHA · instantánea $HORA_SNAP · cliente pg_dump $VC · servidor $VS · destino: local y efímero · la copia se elimina"
  echo "ENSAYO DE RESPALDO Y RESTAURACIÓN: OK"
  exit 0;;
*) echo "Uso: bash tools/respaldo-nexa-demo.sh verificar-respaldo|ensayo-respaldo"; exit 2;;
esac
