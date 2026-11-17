#!/usr/bin/env bash
# Las ÚNICAS órdenes de la CLI de Supabase que tocan el proyecto hospedado. Compatible con la CLI v3, que:
#  · trabaja en LOCAL por defecto (un «db push» sin --remote no toca el proyecto hospedado),
#  · pide consentimiento para cambios hospedados (en CI, --yes),
#  · sustituye --project-ref por --remote=<ref> (todavía funciona, pero está obsoleto y oculto de la ayuda).
# CONEXIÓN A LA BASE (migraciones): los ejecutores de GitHub Actions NO tienen IPv6 y el host directo de la base (db.<ref>.supabase.co) es solo IPv6 en el plan gratuito.
# Por eso las migraciones usan el SESSION POOLER (host compartido *.pooler.supabase.com, puerto 5432, usuario postgres.<ref>), que sí es IPv4. Se deriva de DEMO_BD_URL
# (la cadena del pooler en modo transacción, puerto 6543) cambiando SOLO el puerto: mismo host, usuario y contraseña. Antes se valida que sea EXACTAMENTE el proyecto fijado.
#   bash tools/supabase-hospedado.sh validar        → comprueba la forma de la cadena de conexión (no llama a la CLI, no imprime valores)
#   bash tools/supabase-hospedado.sh conexion       → SOLO LECTURA: «db push --dry-run» (lista las migraciones pendientes; no aplica nada)
#   bash tools/supabase-hospedado.sh diagnostico    → SOLO LECTURA: ¿qué contraseña autentica en el pooler? (un «select 1» por cada candidata; imprime solo SI/NO, nunca valores)
#   bash tools/supabase-hospedado.sh estado         → SOLO LECTURA de METADATOS (sesión forzada a solo lectura): tablas existentes, RLS, historial de migraciones y cuáles faltan; no lee datos de negocio
#   bash tools/supabase-hospedado.sh migraciones    → enlaza y aplica las migraciones pendientes
#   bash tools/supabase-hospedado.sh funcion        → carga los secretos de la función y la despliega
#   bash tools/supabase-hospedado.sh verificar-api-vault   → SOLO LECTURA: ¿expone la API de Supabase el esquema «vault»? Un GET a la RAÍZ de la API REST (nunca a una tabla) con «Accept-Profile: vault» y la clave «anon» PÚBLICA
#                                                          (FEL_DEMO_ANON_KEY; se comprueba que sea de rol anon y de este proyecto: jamás se envía una clave de servicio). Sin base de datos, sin CLI, sin escrituras.
#   bash tools/supabase-hospedado.sh diagnostico-inicial   → SOLO LECTURA ESTRICTA (mismas 4 capas y mismos 2 secretos que verificar-inicial): ejecuta docs/migracion-28/diagnostico-funcion-y-vault-nexa-demo.sql (solo SELECT sobre el catálogo):
#                                                          función propia en public, disparadores de evento y privilegios sobre Vault. Informativo: no falla por hallazgos. NO llama a la CLI, NO tiene ruta hacia migraciones ni escrituras.
#   bash tools/supabase-hospedado.sh verificar-inicial     → SOLO LECTURA ESTRICTA de «nexa-demo» ANTES de migrar: ejecuta docs/migracion-28/verificacion-inicial-nexa-demo.sql (solo SELECT sobre el catálogo) dentro de «begin transaction read only … rollback»
#                                                          y con la sesión forzada a solo lectura. NO llama a la CLI de Supabase, NO usa token ni confirmación, NO tiene ninguna ruta hacia «db push», «link», función ni escrituras. Falla si alguna fila dice REVISAR.
#   bash tools/supabase-hospedado.sh migraciones-etapa 1|2   → SOLO MIGRACIONES, por etapas y con parada: etapa 1 = migraciones 1–27 (exige base VACÍA y sin historial), etapa 2 = migración 28 (exige que estén EXACTAMENTE las 27).
#                                                          Exige FEL_CONFIRMAR_MIGRACIONES=APLICAR-MIGRACIONES. NO carga secretos de función, NO despliega función ni frontend. Al terminar corre la verificación de solo lectura de esa etapa.
#   bash tools/supabase-hospedado.sh verificar-etapa 1|2     → SOLO LECTURA: comprueba lo que debe cumplirse tras la etapa (historial, tablas, RLS, dependencias de Auth; en la 2, el catálogo de la migración 28)
# Entradas: FEL_DEMO_PROYECTO_REF (debe ser exactamente la de nexa-demo), FEL_DEMO_BD_URL, SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD; y para «funcion»: FEL_DEMO_HOSTS, FEL_DEMO_MFA_SEMILLAS, FEL_PROXY_SECRETO.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=tools/destinos-demo.sh
source tools/destinos-demo.sh
REF="${FEL_DEMO_PROYECTO_REF:-}"
[[ "$REF" =~ ^[a-z0-9]{20}$ ]] && [ "$REF" = "$REF_ESPERADA" ] || { echo "PROHIBIDO: la referencia no es la del proyecto nexa-demo ($REF_ESPERADA). No se hace nada."; exit 2; }

# Explica POR QUÉ no se aceptó la cadena: solo SI/NO por requisito, nunca valores (ni usuario, ni host, ni contraseña).
explicar_url() {
  local u="${FEL_DEMO_BD_URL:-}" resto cred user hostpart host despues puerto base si="SI" no="NO"
  resto="${u#*://}"; hostpart="${resto##*@}"; cred="${resto%@*}"; [ "$resto" = "$hostpart" ] && cred=""
  user="${cred%%:*}"; host="${hostpart%%[:/?]*}"; despues="${hostpart#"$host"}"
  puerto=""; [[ "$despues" == :* ]] && { puerto="${despues#:}"; puerto="${puerto%%[/?]*}"; }
  base="${despues#*/}"; [[ "$despues" == */* ]] || base=""; base="${base%%\?*}"
  echo "  Forma de DEMO_BD_URL (solo SI/NO, sin valores):"
  echo "    empieza por postgresql:// o postgres:// ............ $(if [[ "$u" == postgresql://* || "$u" == postgres://* ]]; then echo SI; else echo NO; fi)"
  echo "    trae usuario y contraseña (usuario:contraseña@) .... $(if [[ "$cred" == *:* && -n "${cred#*:}" ]]; then echo SI; else echo NO; fi)"
  echo "    el usuario es exactamente postgres.<ref de nexa-demo> $(if [ "$user" = "postgres.$REF" ]; then echo SI; else echo NO; fi)"
  echo "    el usuario es solo «postgres» (conexión DIRECTA) ..... $(if [ "$user" = "postgres" ]; then echo SI; else echo NO; fi)"
  echo "    el host termina en .pooler.supabase.com ............ $(if [[ "$host" == *.pooler.supabase.com ]]; then echo SI; else echo NO; fi)"
  echo "    el host es el DIRECTO db.<ref>.supabase.co (solo IPv6) $(if [[ "$host" == db.*.supabase.co ]]; then echo SI; else echo NO; fi)"
  echo "    el puerto es 6543 o 5432 ........................... $(if [[ "$puerto" == 6543 || "$puerto" == 5432 ]]; then echo SI; else echo NO; fi)"
  echo "    la base es «postgres» .............................. $(if [ "$base" = "postgres" ]; then echo SI; else echo NO; fi)"
  echo "    trae parámetros después de «?» (debe ser NO) ....... $(if [[ "$u" == *"?"* ]]; then echo SI; else echo NO; fi)"
  echo "    trae espacios o saltos de línea (debe ser NO) ...... $(if [[ "$u" == *[[:space:]]* ]]; then echo SI; else echo NO; fi)"
}

# Cadena de conexión → URL del Session Pooler (puerto 5432). Se rechaza todo lo que no sea exactamente el pooler compartido del proyecto fijado.
derivar_url_sesion() {
  local u="${FEL_DEMO_BD_URL:-}" re
  [ -n "$u" ] || { echo "Falta FEL_DEMO_BD_URL"; exit 2; }
  re="^postgres(ql)?://postgres\.${REF}:([^@/:?#[:space:]]+)@([a-z0-9-]+\.pooler\.supabase\.com):(6543|5432)/postgres$"
  if [[ ! "$u" =~ $re ]]; then
    echo "PROHIBIDO: FEL_DEMO_BD_URL no es la cadena del pooler compartido de nexa-demo (usuario postgres.<ref>, host *.pooler.supabase.com, puerto 6543 o 5432, base postgres, sin parámetros). No se hace nada."; explicar_url; exit 2
  fi
  CLAVE_BD="${BASH_REMATCH[2]}"; HOST_BD="${BASH_REMATCH[3]}"
  URL_SESION="postgresql://postgres.${REF}:${CLAVE_BD}@${HOST_BD}:5432/postgres"
  # los valores derivados no deben salir en el registro de GitHub Actions
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::add-mask::$URL_SESION"; echo "::add-mask::$CLAVE_BD"; fi
}

case "${1:-}" in
  validar)
    derivar_url_sesion
    echo "OK: DEMO_BD_URL corresponde al pooler compartido de nexa-demo; las migraciones usarán el Session Pooler (puerto 5432, IPv4).";;
  conexion)
    derivar_url_sesion
    # SOLO LECTURA. Sin --yes (no es un cambio hospedado). La opción --dry-run debe existir en esta versión de la CLI: si no existiera, la orden fallaría por opción desconocida y no se haría nada.
    supabase db push --remote="$URL_SESION" --dry-run --workdir .;;
  diagnostico)
    # Delimita un «password authentication failed» SIN mostrar secretos: prueba (con psql, solo «select 1») la contraseña de DEMO_BD_URL y la de DEMO_SUPABASE_DB_PASSWORD (máx. 2 intentos) e imprime únicamente SI/NO.
    derivar_url_sesion
    command -v psql >/dev/null || { echo "(psql no está disponible aquí: no se puede diagnosticar)"; exit 0; }
    decodificar() { P="$1" python3 -c 'import os,urllib.parse;print(urllib.parse.unquote(os.environ["P"]),end="")'; }
    CLAVE_URL="$(decodificar "$CLAVE_BD")"; CLAVE_DB="${SUPABASE_DB_PASSWORD:-}"
    if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::add-mask::$CLAVE_URL"; [ -z "$CLAVE_DB" ] || echo "::add-mask::$CLAVE_DB"; fi
    probar() {   # $1 = contraseña candidata → una línea sin secretos
      local salida linea
      if salida="$(PGPASSWORD="$1" PGCONNECT_TIMEOUT=15 psql "host=$HOST_BD port=5432 dbname=postgres user=postgres.$REF sslmode=require" -X -tA -c 'select 1' 2>&1)"; then echo "SI autentica"; return; fi
      linea="$(printf '%s' "$salida" | head -1)"; linea="${linea//"$1"/***}"
      case "$linea" in
        *"password authentication failed"*) echo "NO: la base rechazó la contraseña (28P01)";;
        *"Tenant or user not found"*) echo "NO: el pooler no reconoce el proyecto o el usuario";;
        *) echo "NO: otro error de conexión (${linea:0:120})";;
      esac
    }
    R_URL="$(probar "$CLAVE_URL")"
    if [ -z "$CLAVE_DB" ]; then R_DB="no está definida"
    elif [ "$CLAVE_DB" = "$CLAVE_URL" ]; then R_DB="es IGUAL a la de DEMO_BD_URL (no se prueba otra vez)"
    else R_DB="$(probar "$CLAVE_DB")"; fi
    echo "== Diagnóstico de la contraseña de PostgreSQL (sin mostrar valores)"
    echo "  Contraseña de DEMO_BD_URL ............... $R_URL"
    echo "  Contraseña de DEMO_SUPABASE_DB_PASSWORD . $R_DB"
    [ -n "$CLAVE_DB" ] && [ "$CLAVE_DB" = "$CLAVE_URL" ] && echo "  Las dos contraseñas son iguales ......... SI" || echo "  Las dos contraseñas son iguales ......... NO"
    if [[ "$CLAVE_BD" == *"["* || "$CLAVE_BD" == *"]"* || "${CLAVE_BD^^}" == *YOUR*PASSWORD* ]]; then echo "  La de DEMO_BD_URL parece el marcador sin reemplazar ([YOUR-PASSWORD]) ... SI"; else echo "  La de DEMO_BD_URL parece el marcador sin reemplazar ([YOUR-PASSWORD]) ... NO"; fi
    [[ "$CLAVE_BD" == *"%"* ]] && echo "  La de DEMO_BD_URL contiene «%» (codificación de URL) ... SI" || echo "  La de DEMO_BD_URL contiene «%» (codificación de URL) ... NO"
    URL_OK=0; DB_OK=0; case "$R_URL" in SI*) URL_OK=1;; esac; case "$R_DB" in SI*) DB_OK=1;; esac
    if [ "$URL_OK" = 1 ]; then echo "  CONCLUSIÓN: la contraseña de DEMO_BD_URL SÍ autentica; el fallo de la CLI no viene de ella."
    elif [ "$DB_OK" = 1 ]; then echo "  CONCLUSIÓN: DEMO_BD_URL tiene la contraseña INCORRECTA y DEMO_SUPABASE_DB_PASSWORD es la buena: corrige solo DEMO_BD_URL."
    else echo "  CONCLUSIÓN: ninguna contraseña candidata autentica: la vigente de la base es otra (¿se restableció?). Restablécela en Supabase y actualiza DEMO_BD_URL y DEMO_SUPABASE_DB_PASSWORD."; fi;;
  estado)
    # Qué hay ya en la base de nexa-demo. SOLO metadatos y solo SELECT; la sesión se fuerza a solo lectura (default_transaction_read_only=on). No se leen datos de las tablas.
    derivar_url_sesion
    command -v psql >/dev/null || { echo "(psql no está disponible aquí: no se puede revisar el estado)"; exit 0; }
    CLAVE_URL="$(P="$CLAVE_BD" python3 -c 'import os,urllib.parse;print(urllib.parse.unquote(os.environ["P"]),end="")')"
    if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::add-mask::$CLAVE_URL"; fi
    q() {   # una consulta SELECT → su resultado, o «(no se pudo leer)» sin secretos
      local salida; if salida="$(PGPASSWORD="$CLAVE_URL" PGOPTIONS="-c default_transaction_read_only=on" PGCONNECT_TIMEOUT=20 psql "host=$HOST_BD port=5432 dbname=postgres user=postgres.$REF sslmode=require" -X -tA -c "$1" 2>&1)"; then printf '%s' "$salida"; else salida="$(printf '%s' "$salida" | head -1)"; salida="${salida//"$CLAVE_URL"/***}"; echo "(no se pudo leer: $salida)"; fi
    }
    echo "== Estado de la base de nexa-demo (solo lectura, solo metadatos)"
    echo "  Esquemas (sin los del sistema) .......... $(q "select coalesce(string_agg(nspname, ', ' order by nspname), '—') from pg_namespace where nspname not like 'pg\_%' and nspname <> 'information_schema'")"
    echo "  Tablas en el esquema public ............. $(q "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p')")"
    echo "  …de ellas con RLS activado .............. $(q "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity")"
    echo "  Nombres (hasta 80) ...................... $(q "select coalesce(string_agg(relname, ', ' order by relname), '—') from (select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p') order by 1 limit 80) t")"
    HIST="$(q "select to_regclass('supabase_migrations.schema_migrations') is not null")"
    echo "  Existe el historial de migraciones ...... $HIST"
    LOCALES="$(for f in supabase/migrations/*.sql; do b="$(basename "$f")"; echo "${b%%_*}"; done | sort)"
    echo "  Migraciones en el repositorio ........... $(printf '%s\n' "$LOCALES" | grep -c .)"
    if [ "$HIST" = "t" ]; then
      APLICADAS="$(q "select coalesce(string_agg(version, ' ' order by version), '') from supabase_migrations.schema_migrations")"
      echo "  Migraciones ya registradas en la base ... $(printf '%s' "$APLICADAS" | wc -w)"
      PEND="$(comm -23 <(printf '%s\n' "$LOCALES") <(printf '%s' "$APLICADAS" | tr ' ' '\n' | sort) | grep -c . || true)"
      echo "  Migraciones PENDIENTES de aplicar ....... $PEND"
    else
      echo "  Migraciones ya registradas en la base ... 0 (no existe el historial: base sin migrar)"
      echo "  Migraciones PENDIENTES de aplicar ....... $(printf '%s\n' "$LOCALES" | grep -c .)"
    fi;;
  migraciones)
    derivar_url_sesion
    supabase link --project-ref "$REF" --workdir . >/dev/null
    supabase db push --remote="$URL_SESION" --yes --workdir .;;
  verificar-api-vault)
    # SOLO LECTURA. No usa psql, ni la CLI de Supabase, ni claves de servicio. Solo peticiones GET a «/rest/v1/<tabla inexistente>» del proyecto fijado (el listado OpenAPI de la raíz ya no se sirve a claves públicas: 401).
    ANON="${FEL_DEMO_ANON_KEY:-}"
    [ -n "$ANON" ] || { echo "Falta FEL_DEMO_ANON_KEY (la clave «anon» pública del proyecto). No se hace nada."; exit 2; }
    if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::add-mask::$ANON"; fi
    # la clave debe ser PÚBLICA: o la clave «publicable» (sb_publishable_…) o el JWT del rol «anon» de ESTE proyecto. Una clave secreta (sb_secret_…), una de servicio u otra se rechaza SIN enviarla a ningún sitio
    TIPO_CLAVE=""
    if [[ "$ANON" == sb_secret_* ]]; then echo "PROHIBIDO: FEL_DEMO_ANON_KEY es una clave SECRETA (sb_secret_…). Solo se admite la clave pública. No se hace nada."; exit 2
    elif [[ "$ANON" =~ ^sb_publishable_[A-Za-z0-9_-]+$ ]]; then TIPO_CLAVE="publicable"
    elif A="$ANON" R="$REF" python3 - <<'PY'
import base64, json, os, re, sys
t = os.environ["A"]
if not re.fullmatch(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*", t): sys.exit(1)
try: p = json.loads(base64.urlsafe_b64decode(t.split(".")[1] + "=" * (-len(t.split(".")[1]) % 4)))
except Exception: sys.exit(1)
sys.exit(0 if p.get("role") == "anon" and p.get("ref") == os.environ["R"] else 1)
PY
    then TIPO_CLAVE="jwt"
    else echo "PROHIBIDO: FEL_DEMO_ANON_KEY no es la clave pública (publicable o JWT del rol «anon») de nexa-demo. No se hace nada (nunca se envía otra clave)."; exit 2; fi
    CUERPO="$(mktemp)"; trap 'rm -f -- "$CUERPO"' EXIT
    SONDA_RUTA="fel_sonda_inexistente"   # tabla que NO existe en ningún esquema: nunca se lee un dato; solo se observa cómo responde la API (clave, esquema)
    sonda() {   # $1 = perfil de esquema; imprime el código HTTP y deja la respuesta en $CUERPO. Solo GET; la clave va por la entrada estándar (no en los argumentos)
      local cod; cod="$({ printf 'header = "apikey: %s"\n' "$ANON"; [ "$TIPO_CLAVE" = jwt ] && printf 'header = "Authorization: Bearer %s"\n' "$ANON"; printf 'header = "Accept-Profile: %s"\n' "$1"; } | curl -sS -K - -m 25 -o "$CUERPO" -w '%{http_code}' "https://${REF}.supabase.co/rest/v1/${SONDA_RUTA}?limit=0" 2>/dev/null || true)"
      cod="${cod: -3}"; [ -n "$cod" ] || cod=000
      printf '%s' "$cod"
    }
    campo() { python3 -c 'import json,sys
try: d=json.load(sys.stdin)
except Exception: d={}
v=d.get(sys.argv[1],"") if isinstance(d,dict) else ""
print(v if isinstance(v,str) else "",end="")' "$1"; }
    echo "== NEXA FEL · ¿expone la API de nexa-demo el esquema vault? (SOLO LECTURA: GET de una tabla inexistente con la clave pública; no se lee ningún dato)"
    BASE_COD="$(sonda public)"; RESP="$(head -c 2000 "$CUERPO" | tr -d '\r')"; BASE_CODE="$(printf '%s' "$RESP" | campo code)"
    # control: con una clave VÁLIDA y el esquema public expuesto, PostgREST contesta 404 («tabla inexistente», PGRST205 o 42P01). Cualquier otra cosa NO permite interpretar la sonda de vault.
    if [ "$BASE_COD" != "404" ] || { [ "$BASE_CODE" != "PGRST205" ] && [ "$BASE_CODE" != "42P01" ]; }; then
      MSG="$(printf '%s' "$RESP" | campo message)"; MSG="${MSG//"$ANON"/***}"
      case "$BASE_COD" in
        401) CAUSA="la API rechazó la autenticación (HTTP 401): clave inválida, revocada, de otro proyecto o no admitida";;
        403) CAUSA="la API denegó el acceso (HTTP 403)";;
        *) CAUSA="respuesta inesperada de la sonda de control (HTTP $BASE_COD)";;
      esac
      echo "API de datos: NO VERIFICADO ($CAUSA; no se puede interpretar la sonda de vault). Respuesta: ${MSG:0:160}"; exit 1
    fi
    echo "  OK    sonda de control: la clave es válida y el esquema public responde (HTTP 404 $BASE_CODE: tabla inexistente)"
    VAULT_COD="$(sonda vault)"; RESP="$(head -c 2000 "$CUERPO" | tr -d '\r')"; VAULT_CODE="$(printf '%s' "$RESP" | campo code)"
    if [ "$VAULT_COD" = "200" ] || { [ "$VAULT_COD" = "404" ] && { [ "$VAULT_CODE" = "PGRST205" ] || [ "$VAULT_CODE" = "42P01" ]; }; }; then echo "  REVISAR el esquema vault ESTÁ EXPUESTO por la API de datos (HTTP $VAULT_COD con Accept-Profile: vault: el esquema se resuelve)."; echo "API de datos: REVISAR. No se debe guardar nada en Vault ni aplicar migraciones hasta cerrarlo."; exit 1; fi
    if [ "$VAULT_COD" = "406" ] && [ "$VAULT_CODE" = "PGRST106" ]; then
      # la lista de esquemas expuestos puede venir en «message» («…must be one of the following: a, b») o en «hint» («Only the following schemas are exposed: a, b») según la versión de PostgREST
      LISTA="$(printf '%s' "$RESP" | python3 -c 'import json,sys,re
try: d=json.load(sys.stdin)
except Exception: d={}
r=""
for k in ("hint","message"):
    v=d.get(k) if isinstance(d,dict) else None
    x=re.search(r"(?:must be one of the following|following schemas are exposed):\s*(.*?)\s*$", v) if isinstance(v,str) else None
    if x: r=x.group(1).strip(); break
print(r)')"
      if [ -z "$LISTA" ]; then CRUDO="${RESP//"$ANON"/***}"; echo "API de datos: NO VERIFICADO (rechazó el esquema vault pero no se pudo leer la lista de esquemas expuestos). Respuesta (HTTP 406): ${CRUDO:0:400}"; exit 1; fi
      if printf '%s' "$LISTA" | tr ',' '\n' | sed 's/^ *//;s/ *$//' | grep -qx "vault"; then echo "  REVISAR la lista de esquemas expuestos incluye vault: $LISTA"; exit 1; fi
      echo "  OK    el esquema vault NO está expuesto (HTTP 406, PGRST106). Esquemas expuestos por la API: $LISTA"
      echo "API de datos: OK (solo lectura). Nada se modificó."; exit 0
    fi
    echo "API de datos: NO VERIFICADO (respuesta inesperada HTTP $VAULT_COD${VAULT_CODE:+, código $VAULT_CODE}). Un 401/403 aquí NO se toma por prueba de seguridad."; exit 1;;
  diagnostico-inicial)
    # Igual que verificar-inicial: NO usa la CLI de Supabase, NO lee SUPABASE_ACCESS_TOKEN ni FEL_CONFIRMAR_MIGRACIONES y NO contiene «db push», «link», función ni escrituras. Solo informa.
    derivar_url_sesion
    command -v psql >/dev/null || { echo "Falta psql: sin él no se puede diagnosticar (de solo lectura). No se hace nada."; exit 2; }
    SQL_DIAG="$PWD/docs/migracion-28/diagnostico-funcion-y-vault-nexa-demo.sql"
    [ -f "$SQL_DIAG" ] || { echo "Falta $SQL_DIAG. No se hace nada."; exit 2; }
    python3 tools/verificar-sql-solo-lectura.py "$SQL_DIAG" >/dev/null || { echo "PROHIBIDO: el SQL de diagnóstico contiene algo que no es un SELECT. No se hace nada."; python3 tools/verificar-sql-solo-lectura.py "$SQL_DIAG" | head -5; exit 2; }
    source tools/sql-solo-lectura.sh
    CLAVE_URL="$(P="$CLAVE_BD" python3 -c 'import os,urllib.parse;print(urllib.parse.unquote(os.environ["P"]),end="")')"
    if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::add-mask::$CLAVE_URL"; fi
    ENVOLTORIO="$(mktemp)"; trap 'rm -f -- "$ENVOLTORIO"' EXIT
    envolver_solo_lectura "$SQL_DIAG" > "$ENVOLTORIO"
    echo "== NEXA FEL · diagnóstico de nexa-demo (SOLO LECTURA: transacción de solo lectura + sesión forzada a solo lectura; sin CLI, sin migraciones)"
    if ! SALIDA="$(PGPASSWORD="$CLAVE_URL" PGOPTIONS="-c default_transaction_read_only=on" PGCONNECT_TIMEOUT=20 psql "host=$HOST_BD port=5432 dbname=postgres user=postgres.$REF sslmode=require" -X -q -f "$ENVOLTORIO" 2>&1)"; then
      PRIMERA="$(printf '%s' "$SALIDA" | grep -m1 -E 'ERROR|error|FATAL' || true)"; PRIMERA="${PRIMERA//"$CLAVE_URL"/***}"
      echo "DIAGNÓSTICO: no se pudo ejecutar: ${PRIMERA:0:240}"; exit 1
    fi
    SALIDA="${SALIDA//"$CLAVE_URL"/***}"
    printf '%s\n' "$SALIDA" | grep -qx '00 sesión | transaction_read_only | on' || { echo "DIAGNÓSTICO: la sesión NO está confirmada como de solo lectura. Se descarta el resultado."; exit 1; }
    printf '%s\n' "$SALIDA" | grep -E '^[0-9A-Z]{2} [^|]+ \| '
    echo "DIAGNÓSTICO: OK (solo lectura). Nada se modificó."; exit 0;;
  verificar-inicial)
    # Esta acción NO usa la CLI de Supabase (ni siquiera la invoca), NO lee SUPABASE_ACCESS_TOKEN ni FEL_CONFIRMAR_MIGRACIONES y NO contiene «db push», «link», función ni escrituras: no existe ruta para aplicar migraciones desde aquí.
    derivar_url_sesion
    command -v psql >/dev/null || { echo "Falta psql: sin él no se puede verificar (de solo lectura). No se hace nada."; exit 2; }
    SQL_INICIAL="$PWD/docs/migracion-28/verificacion-inicial-nexa-demo.sql"
    [ -f "$SQL_INICIAL" ] || { echo "Falta $SQL_INICIAL. No se hace nada."; exit 2; }
    # capa 1: el archivo solo puede contener SELECT (y \pset)
    python3 tools/verificar-sql-solo-lectura.py "$SQL_INICIAL" >/dev/null || { echo "PROHIBIDO: el SQL de verificación contiene algo que no es un SELECT. No se hace nada."; python3 tools/verificar-sql-solo-lectura.py "$SQL_INICIAL" | head -5; exit 2; }
    source tools/sql-solo-lectura.sh
    CLAVE_URL="$(P="$CLAVE_BD" python3 -c 'import os,urllib.parse;print(urllib.parse.unquote(os.environ["P"]),end="")')"
    if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::add-mask::$CLAVE_URL"; fi
    ENVOLTORIO="$(mktemp)"; trap 'rm -f -- "$ENVOLTORIO"' EXIT
    envolver_solo_lectura "$SQL_INICIAL" > "$ENVOLTORIO"      # capa 2: begin transaction read only … rollback
    echo "== NEXA FEL · verificación inicial de nexa-demo (SOLO LECTURA: transacción de solo lectura + sesión forzada a solo lectura; sin CLI, sin migraciones)"
    # capa 3: PGOPTIONS fuerza la sesión a solo lectura
    if ! SALIDA="$(PGPASSWORD="$CLAVE_URL" PGOPTIONS="-c default_transaction_read_only=on" PGCONNECT_TIMEOUT=20 psql "host=$HOST_BD port=5432 dbname=postgres user=postgres.$REF sslmode=require" -X -q -f "$ENVOLTORIO" 2>&1)"; then
      PRIMERA="$(printf '%s' "$SALIDA" | grep -m1 -E 'ERROR|error|FATAL' || true)"; PRIMERA="${PRIMERA//"$CLAVE_URL"/***}"
      echo "VERIFICACIÓN INICIAL: no se pudo ejecutar: ${PRIMERA:0:240}"; exit 1
    fi
    SALIDA="${SALIDA//"$CLAVE_URL"/***}"
    printf '%s\n' "$SALIDA" | grep -E ' \| (OK|REVISAR|INFO)$' || true
    # capa 4: la propia consulta debe confirmar que la sesión es de solo lectura; si no, la acción falla
    printf '%s\n' "$SALIDA" | grep -qx 'sesión de solo lectura | on | on | OK' || { echo "VERIFICACIÓN INICIAL: la sesión NO está confirmada como de solo lectura. Se descarta el resultado."; exit 1; }
    NREV="$(printf '%s\n' "$SALIDA" | grep -c ' | REVISAR$' || true)"
    if [ "$NREV" != "0" ]; then echo "VERIFICACIÓN INICIAL: $NREV comprobación(es) para REVISAR. No se debe aplicar la etapa 1 hasta resolverlas."; exit 1; fi
    echo "VERIFICACIÓN INICIAL: OK (solo lectura). Nada se modificó."; exit 0;;
  migraciones-etapa|verificar-etapa)
    ACCION="$1"; ETAPA="${2:-}"
    case "$ETAPA" in
      1) HASTA=20261112001000; ESPERADAS=27; DESCRIPCION="etapa 1: migraciones 1 a 27";;
      2) HASTA=20261113000100; ESPERADAS=28; DESCRIPCION="etapa 2: migración 28";;
      *) echo "Uso: supabase-hospedado.sh $ACCION 1|2"; exit 2;;
    esac
    derivar_url_sesion
    command -v psql >/dev/null || { echo "Falta psql: sin él no se pueden comprobar las precondiciones (de solo lectura). No se hace nada."; exit 2; }
    CLAVE_URL="$(P="$CLAVE_BD" python3 -c 'import os,urllib.parse;print(urllib.parse.unquote(os.environ["P"]),end="")')"
    if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::add-mask::$CLAVE_URL"; fi
    # TODAS las consultas de esta acción van con la sesión forzada a solo lectura; un fallo devuelve «(no se pudo leer…)» sin secretos
    qro() { local salida; if salida="$(PGPASSWORD="$CLAVE_URL" PGOPTIONS="-c default_transaction_read_only=on" PGCONNECT_TIMEOUT=20 psql "host=$HOST_BD port=5432 dbname=postgres user=postgres.$REF sslmode=require" -X -tA -c "$1" 2>&1)"; then printf '%s' "$salida"; else salida="$(printf '%s' "$salida" | head -1)"; salida="${salida//"$CLAVE_URL"/***}"; echo "(no se pudo leer: $salida)"; fi; }
    # versiones locales de esta etapa (todas las que no pasan de HASTA) y su cantidad: si el repositorio ya no coincide con la etapa, no se hace nada
    LOCALES_ETAPA="$(for f in supabase/migrations/*.sql; do b="$(basename "$f")"; v="${b%%_*}"; if [ "$v" -le "$HASTA" ]; then echo "$v"; fi; done | sort)"
    [ "$(printf '%s\n' "$LOCALES_ETAPA" | grep -c .)" = "$ESPERADAS" ] || { echo "PROHIBIDO: el repositorio no tiene exactamente $ESPERADAS migraciones hasta la versión $HASTA. No se hace nada."; exit 2; }
    HIST="$(qro "select to_regclass('supabase_migrations.schema_migrations') is not null")"
    case "$HIST" in t|f) ;; *) echo "No se pudo leer el historial de migraciones; no se hace nada. $HIST"; exit 2;; esac
    if [ "$HIST" = "t" ]; then APLICADAS="$(qro "select coalesce(string_agg(version, ' ' order by version), '') from supabase_migrations.schema_migrations")"; else APLICADAS=""; fi
    [[ "$APLICADAS" == "(no se pudo leer"* ]] && { echo "No se pudo leer el historial de migraciones; no se hace nada."; exit 2; }
    NAPL="$(printf '%s' "$APLICADAS" | wc -w | tr -d ' ')"
    NTAB="$(qro "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p')")"
    echo "== NEXA FEL · $DESCRIPCION ($ACCION). Migraciones ya registradas: $NAPL · tablas en public: $NTAB"
    verificacion() {   # SOLO LECTURA: lo que debe cumplirse DESPUÉS de la etapa
      local fallo=0 ap tab rls
      ap="$(qro "select count(*) from supabase_migrations.schema_migrations")"
      if [ "$ap" = "$ESPERADAS" ]; then echo "  OK    historial: $ap migraciones registradas"; else echo "  FALLO historial: $ap registradas, se esperaban $ESPERADAS"; fallo=1; fi
      tab="$(qro "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p')")"
      rls="$(qro "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity")"
      if [ "$tab" = "$rls" ] && [ "$tab" != "0" ]; then echo "  OK    RLS activado en las $rls tablas de public"; else echo "  FALLO RLS: $rls de $tab tablas"; fallo=1; fi
      local dep; dep="$(qro "select count(*) filter (where not ok) from public.fel_verificar_dependencias_auth()")"
      if [ "$dep" = "0" ]; then echo "  OK    dependencias de Supabase Auth (fel_verificar_dependencias_auth): sin faltantes"; else echo "  FALLO dependencias de Auth: $dep comprobaciones fallan"; fallo=1; fi
      # INFORMATIVO (nunca hace fallar la etapa): ¿está disponible Vault en este proyecto y quién puede usar su esquema? Sirve para cerrar la verificación de Vault sin modificar nada.
      echo "  INFO  extensiones de cifrado: $(qro "select coalesce(string_agg(name || ' (disponible ' || coalesce(default_version, '-') || ', instalada ' || coalesce(installed_version, 'no') || ')', '; '), 'ninguna disponible') from pg_available_extensions where name in ('supabase_vault', 'pgsodium')")"
      echo "  INFO  privilegios sobre el esquema vault (USAGE) anon/authenticated/service_role: $(qro "select case when to_regnamespace('vault') is null then 'el esquema vault no existe' else (select string_agg(r || '=' || has_schema_privilege(r, 'vault', 'USAGE')::text, ' ') from unnest(array['anon','authenticated','service_role']) r) end")"
      if [ "$ETAPA" = "2" ]; then
        local sal; if sal="$(PGPASSWORD="$CLAVE_URL" PGOPTIONS="-c default_transaction_read_only=on" PGCONNECT_TIMEOUT=20 psql "host=$HOST_BD port=5432 dbname=postgres user=postgres.$REF sslmode=require" -X -q -v ON_ERROR_STOP=1 -f docs/migracion-28/verificacion-posterior-28.sql 2>&1)"; then echo "  OK    catálogo de la migración 28 (verificacion-posterior-28.sql, solo lectura)"; else sal="$(printf '%s' "$sal" | grep -m1 -E 'ERROR|error' || true)"; sal="${sal//"$CLAVE_URL"/***}"; echo "  FALLO catálogo de la migración 28: ${sal:0:200}"; fallo=1; fi
      fi
      return $fallo
    }
    if [ "$ACCION" = "verificar-etapa" ]; then verificacion && echo "VERIFICACIÓN DE LA ETAPA $ETAPA: OK" || { echo "VERIFICACIÓN DE LA ETAPA $ETAPA: FALLÓ"; exit 1; }; exit 0; fi
    # ---- aplicar: confirmación literal y precondiciones exactas de ESTA etapa
    [ "${FEL_CONFIRMAR_MIGRACIONES:-}" = "APLICAR-MIGRACIONES" ] || { echo "PROHIBIDO: falta la confirmación literal APLICAR-MIGRACIONES. No se hace nada."; exit 2; }
    if [ "$ETAPA" = "1" ]; then
      [ "$NAPL" = "0" ] && [ "$NTAB" = "0" ] || { echo "PROHIBIDO: la etapa 1 exige una base VACÍA y sin historial (registradas: $NAPL, tablas: $NTAB). No se hace nada."; exit 2; }
    else
      [ "$(printf '%s' "$APLICADAS" | tr ' ' '\n' | sort | grep -c .)" = "27" ] && [ "$(printf '%s' "$APLICADAS" | tr ' ' '\n' | sort)" = "$(printf '%s\n' "$LOCALES_ETAPA" | grep -v "^$HASTA$")" ] \
        || { echo "PROHIBIDO: la etapa 2 exige que estén registradas EXACTAMENTE las 27 migraciones anteriores (registradas: $NAPL). No se hace nada."; exit 2; }
    fi
    # carpeta de trabajo TEMPORAL con solo las migraciones de esta etapa: la CLI nunca ve (ni aplica) las posteriores
    SUB="$(mktemp -d)"; trap 'rm -rf -- "$SUB"' EXIT
    mkdir -p "$SUB/supabase/migrations"; cp supabase/config.toml "$SUB/supabase/config.toml"
    for f in supabase/migrations/*.sql; do b="$(basename "$f")"; v="${b%%_*}"; if [ "$v" -le "$HASTA" ]; then cp "$f" "$SUB/supabase/migrations/"; fi; done
    [ "$(ls "$SUB/supabase/migrations" | wc -l | tr -d ' ')" = "$ESPERADAS" ] || { echo "PROHIBIDO: la carpeta de la etapa no tiene las $ESPERADAS migraciones esperadas. No se hace nada."; exit 2; }
    supabase link --project-ref "$REF" --workdir "$SUB" >/dev/null
    supabase db push --remote="$URL_SESION" --yes --workdir "$SUB"
    echo "== Migraciones aplicadas ($DESCRIPCION). Verificación de solo lectura:"
    verificacion && echo "VERIFICACIÓN DE LA ETAPA $ETAPA: OK. SE DETIENE AQUÍ: la siguiente etapa necesita una nueva aprobación." || { echo "VERIFICACIÓN DE LA ETAPA $ETAPA: FALLÓ. No se sigue."; exit 1; };;
  funcion)
    for v in FEL_DEMO_BD_URL FEL_DEMO_HOSTS FEL_DEMO_MFA_SEMILLAS FEL_PROXY_SECRETO; do [ -n "${!v:-}" ] || { echo "Falta $v"; exit 2; }; done
    ENVF="$(mktemp)"; chmod 600 "$ENVF"; trap 'rm -f "$ENVF"' EXIT
    { echo "FEL_DEMO_BD_URL=$FEL_DEMO_BD_URL"; echo "FEL_DEMO_HOSTS=$FEL_DEMO_HOSTS"; echo "FEL_DEMO_MFA_SEMILLAS=$FEL_DEMO_MFA_SEMILLAS"; echo "FEL_PROXY_SECRETO=$FEL_PROXY_SECRETO"; } > "$ENVF"
    # Digifact TEST (OPCIONAL, apagado por defecto): solo con FEL_DIGIFACT_TEST=habilitado, TODO O NADA, y solo hacia los secretos de la FUNCIÓN (nunca a Cloudflare ni al navegador). Los valores jamás se imprimen:
    # se escriben con comillas simples en el archivo temporal (600) que se borra al terminar; por eso no se admiten comillas simples ni saltos de línea.
    case "${FEL_DIGIFACT_TEST:-}" in
      "") for v in FEL_DIGIFACT_AUTORIZA_REFERENCIA; do [ -z "${!v:-}" ] || { echo "$v requiere FEL_DIGIFACT_TEST=habilitado: no se publica la función"; exit 2; }; done;;
      habilitado)
        for v in FEL_DIGIFACT_TEST_EMPRESA DIGIFACT_TEST_USERNAME DIGIFACT_TEST_PASSWORD DIGIFACT_TEST_NIT FEL_DIGIFACT_TEST_EMISOR FEL_DIGIFACT_TEST_HUELLA; do [ -n "${!v:-}" ] || { echo "Digifact TEST habilitado, pero falta $v (todo o nada): no se publica la función"; exit 2; }; done
        printf '%s' "${FEL_DIGIFACT_TEST_EMPRESA}" | grep -Eiq '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' || { echo "FEL_DIGIFACT_TEST_EMPRESA no es un UUID: no se publica la función"; exit 2; }
        printf '%s' "${FEL_DIGIFACT_TEST_HUELLA}" | grep -Eq '^[0-9a-f]{16}$' || { echo "FEL_DIGIFACT_TEST_HUELLA no es una huella de 16 caracteres hexadecimales: no se publica la función"; exit 2; }
        [ -z "${FEL_DIGIFACT_AUTORIZA_REFERENCIA:-}" ] || printf '%s' "${FEL_DIGIFACT_AUTORIZA_REFERENCIA}" | grep -Eiq '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' || { echo "FEL_DIGIFACT_AUTORIZA_REFERENCIA no es un UUID: no se publica la función"; exit 2; }
        for v in FEL_DIGIFACT_TEST FEL_DIGIFACT_TEST_EMPRESA DIGIFACT_TEST_USERNAME DIGIFACT_TEST_PASSWORD DIGIFACT_TEST_NIT FEL_DIGIFACT_TEST_EMISOR FEL_DIGIFACT_TEST_HUELLA FEL_DIGIFACT_AUTORIZA_REFERENCIA; do
          valor="${!v:-}"; [ -n "$valor" ] || continue
          case "$valor" in *"'"*|*$'\n'*|*$'\r'*) echo "$v contiene un carácter no admitido (comilla simple o salto de línea): no se publica la función"; exit 2;; esac
          printf "%s='%s'\n" "$v" "$valor" >> "$ENVF"
        done
        echo "Digifact TEST: habilitado para la función (valores no mostrados)";;
      *) echo "FEL_DIGIFACT_TEST solo admite «habilitado» o vacío: no se publica la función"; exit 2;;
    esac
    supabase secrets set --env-file "$ENVF" --remote="$REF" --yes >/dev/null
    supabase functions deploy nexa-demo --remote="$REF" --yes --no-verify-jwt --workdir dist/nube/funcion;;
  *) echo "Uso: supabase-hospedado.sh validar|conexion|diagnostico|estado|migraciones|verificar-api-vault|diagnostico-inicial|verificar-inicial|migraciones-etapa|verificar-etapa|funcion"; exit 2;;
esac
