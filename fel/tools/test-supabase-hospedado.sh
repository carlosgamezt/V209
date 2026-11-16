#!/usr/bin/env bash
# Prueba (sin red ni credenciales reales) de tools/supabase-hospedado.sh con una CLI de Supabase FALSA que solo registra los argumentos que recibe.
# Comprueba la sintaxis de la CLI v3, la derivación al Session Pooler (IPv4, puerto 5432) y que NINGUNA orden pueda apuntar a otro proyecto.
set -uo pipefail
R="$(cd "$(dirname "$0")/.." && pwd)"; S="$R/tools/supabase-hospedado.sh"; W=$(mktemp -d); fallos=0; REF=sbmchmknfercbtziwrge
HOST=aws-0-us-west-2.pooler.supabase.com; CLAVE=CLAVE-FALSA-DE-PRUEBA
URL_TX="postgresql://postgres.$REF:$CLAVE@$HOST:6543/postgres"; URL_SES="postgresql://postgres.$REF:$CLAVE@$HOST:5432/postgres"
trap 'rm -rf "$W"' EXIT
cat > "$W/supabase" <<'SH'
#!/usr/bin/env bash
echo "$*" >> "$REGISTRO"
if [ "$1 $2" = "db push" ]; then
  wd=""; yes=0; dry=0; prev=""; for a in "$@"; do [ "$prev" = "--workdir" ] && wd="$a"; [ "$a" = "--yes" ] && yes=1; [ "$a" = "--dry-run" ] && dry=1; prev="$a"; done
  if [ -n "$wd" ] && [ -d "$wd/supabase/migrations" ] && [ "$yes" = 1 ] && [ "$dry" = 0 ]; then   # simula la aplicación: guarda qué se «aplicó» y deja el estado resultante para el psql falso
    ls "$wd/supabase/migrations" | sort > "${LISTADO:-/dev/null}"; ls "$wd/supabase/migrations" | sed 's/_.*//' | tr '\n' ' ' > "${ESTADO_VERS:-/dev/null}"; echo 67 > "${ESTADO_TAB:-/dev/null}"
  fi
fi
if [ "$1 $2" = "secrets set" ]; then for a in "$@"; do case "$a" in --env-file) tomar=1;; *) [ "${tomar:-}" = 1 ] && { cat "$a" > "$ENV_COPIA"; tomar=0; };; esac; done; fi
exit 0
SH
cat > "$W/psql" <<'SH'
#!/usr/bin/env bash
# psql FALSO: «autentica» solo si PGPASSWORD es la contraseña buena; registra los argumentos. Su error INCLUYE la contraseña a propósito (peor caso) para probar que el diagnóstico la oculta.
echo "[$PGOPTIONS] $*" >> "$REG_PSQL"
if [ "${PGPASSWORD:-}" = "$CLAVE_BUENA" ]; then
  if [ -n "${FAKE_ETAPAS:-}" ]; then   # modo etapas: contesta según la consulta
    vers="${FAKE_VERSIONS:-}"; [ -s "${ESTADO_VERS:-/nonexistent}" ] && vers="$(cat "$ESTADO_VERS")"; tab="${FAKE_TABLAS:-0}"; [ -s "${ESTADO_TAB:-/nonexistent}" ] && tab="$(cat "$ESTADO_TAB")"
    case "$*" in
      *" -f "*) if [ "${FAKE_CATALOGO_RC:-0}" != 0 ]; then echo "psql:verificacion-posterior-28.sql:86: ERROR:  service_role puede borrar empresas ($PGPASSWORD)" >&2; exit 3; fi; exit 0;;
      *to_regclass*) echo "${FAKE_HIST:-f}";;
      *"string_agg(version"*) echo -n "$vers";;
      *"count(*) from supabase_migrations.schema_migrations"*) echo -n "$vers" | wc -w | tr -d ' ';;
      *pg_available_extensions*) echo "supabase_vault (disponible 0.3.1, instalada no)";;
      *"to_regnamespace('vault')"*) echo "anon=false authenticated=false service_role=false";;
      *relrowsecurity*) echo "${FAKE_RLS:-$tab}";;
      *fel_verificar_dependencias_auth*) echo "${FAKE_DEP:-0}";;
      *"count(*) from pg_class"*) echo "$tab";;
      *) echo 1;;
    esac; exit 0
  fi
  echo 1; exit 0
fi
echo "psql: error: connection to server failed: FATAL:  password authentication failed for user x ($PGPASSWORD)" >&2; exit 2
SH
chmod +x "$W/psql" "$W/supabase"; export REGISTRO="$W/reg.txt" ENV_COPIA="$W/envcopia.txt" REG_PSQL="$W/regpsql.txt" CLAVE_BUENA="$CLAVE"
base() { # $1 ref, $2 acción, $3 url de la base (por defecto la de transacción); admite GITHUB_ACTIONS en el entorno
  env -u GITHUB_ACTIONS PATH="$W:$PATH" ${DBPW+SUPABASE_DB_PASSWORD=$DBPW} FEL_DEMO_PROYECTO_REF="$1" FEL_DEMO_BD_URL="${3-$URL_TX}" FEL_DEMO_HOSTS=nexa-fel-demo.pages.dev FEL_DEMO_MFA_SEMILLAS="maestro=AAAA" FEL_PROXY_SECRETO=SECRETO-FALSO-DE-PRUEBA ${ACTIONS:+GITHUB_ACTIONS=true} bash "$S" "$2" >"$W/salida.txt" 2>&1; }
ok() { echo "OK    $1"; }; mal() { echo "FALLO $1"; fallos=$((fallos+1)); }
nollamo() { [ ! -e "$REGISTRO" ]; }

# --- validar
rm -f "$REGISTRO"; base "$REF" validar; [ $? = 0 ] && nollamo && ok "validar: cadena de transacción (6543) aceptada sin llamar a la CLI" || mal "validar 6543"
base "$REF" validar "$URL_SES"; [ $? = 0 ] && ok "validar: cadena de sesión (5432) también aceptada" || mal "validar 5432"
! grep -q "$CLAVE" "$W/salida.txt" && ok "validar no imprime la contraseña ni la cadena" || mal "validar imprime la contraseña"
# --- conexión de SOLO LECTURA
rm -f "$REGISTRO"; base "$REF" conexion; r=$?
[ $r = 0 ] && ok "conexion: termina bien" || mal "conexion falló"
[ "$(cat "$REGISTRO")" = "db push --remote=$URL_SES --dry-run --workdir ." ] && ok "conexion: UNA sola orden, «db push --dry-run» por el Session Pooler (5432), sin --yes (solo lectura)" || { mal "conexion: orden inesperada"; cat "$REGISTRO"; }
! grep -E "secrets|functions|--yes|link" "$REGISTRO" >/dev/null && ok "conexion no usa link, secretos, funciones ni --yes" || mal "conexion hace más de lo debido"
# --- migraciones
rm -f "$REGISTRO"; base "$REF" migraciones; [ $? = 0 ] && ok "migraciones: termina bien" || mal "migraciones fallaron"
grep -qx "link --project-ref $REF --workdir \." "$REGISTRO" && ok "link con el proyecto fijado" || mal "link"
grep -qx "db push --remote=$URL_SES --yes --workdir \." "$REGISTRO" && ok "db push por el Session Pooler (puerto 5432 derivado de 6543: mismo host, usuario y contraseña) con --yes" || mal "db push sin la URL de sesión"
! grep -q -- "--dry-run" <(grep -x "db push --remote=$URL_SES --yes --workdir \." "$REGISTRO") && ok "las migraciones reales no llevan --dry-run" || mal "mezcla de dry-run"
# --- función
base "$REF" funcion; [ $? = 0 ] && ok "función: termina bien" || mal "función falló"
grep -q "^secrets set --env-file .* --remote=$REF --yes" "$REGISTRO" && ok "secrets set con --remote=<ref> y --yes" || mal "secrets set"
grep -qx "functions deploy nexa-demo --remote=$REF --yes --no-verify-jwt --workdir dist/nube/funcion" "$REGISTRO" && ok "functions deploy con --remote=<ref>, --yes y --no-verify-jwt" || mal "functions deploy"
! grep -E "^(secrets set|functions deploy|db push)" "$REGISTRO" | grep -q -- "--project-ref" && ok "ninguna orden que modifica usa el --project-ref obsoleto" || mal "--project-ref obsoleto en una orden hospedada"
grep -q "^FEL_PROXY_SECRETO=SECRETO-FALSO-DE-PRUEBA" "$ENV_COPIA" && grep -q "^FEL_DEMO_HOSTS=nexa-fel-demo.pages.dev" "$ENV_COPIA" && grep -q "^FEL_DEMO_BD_URL=$URL_TX" "$ENV_COPIA" && ok "el archivo de secretos de la función lleva los 4 valores (la cadena de transacción original)" || mal "contenido del archivo de secretos"
# --- ocultación en el registro de GitHub Actions
rm -f "$REGISTRO"; ACTIONS=1 base "$REF" migraciones
sin_mascara="$(grep -v '^::add-mask::' "$W/salida.txt" | grep -c "$CLAVE" || true)"
[ "$sin_mascara" = 0 ] && grep -q "^::add-mask::$URL_SES$" "$W/salida.txt" && grep -q "^::add-mask::$CLAVE$" "$W/salida.txt" && ok "en Actions la URL derivada y la contraseña se registran como enmascaradas; fuera de esas órdenes no aparecen en la salida" || mal "enmascarado en Actions"
unset ACTIONS; rm -f "$REGISTRO"; base "$REF" migraciones
! grep -q "$CLAVE" "$W/salida.txt" && ok "fuera de Actions la salida no contiene la contraseña" || mal "contraseña en la salida (sin Actions)"
# --- destinos: nada de lo ajeno llega a la CLI
for malo in abcdefghijklmnopqrst "${REF}x" "${REF^^}" "" "../x"; do rm -f "$REGISTRO"; base "$malo" migraciones; r=$?; [ $r = 2 ] && nollamo && ok "referencia «${malo:-vacía}» rechazada sin llamar a la CLI" || mal "referencia «${malo}» aceptada"; done
rm -f "$REGISTRO"; base "abcdefghijklmnopqrst" funcion; [ $? = 2 ] && nollamo && ok "función con otra referencia: rechazada" || mal "función con otra referencia"
rechazar() { rm -f "$REGISTRO"; base "$REF" "$1" "$2"; r=$?; [ $r = 2 ] && nollamo && ok "$3" || mal "$3 (código $r)"; }
for a in conexion migraciones; do
  rechazar $a "postgresql://postgres.abcdefghijklmnopqrst:$CLAVE@$HOST:6543/postgres" "$a: cadena con usuario de OTRO proyecto rechazada"
  rechazar $a "postgresql://postgres:$CLAVE@$HOST:6543/postgres" "$a: usuario sin referencia rechazado"
  rechazar $a "postgresql://postgres.$REF:$CLAVE@db.$REF.supabase.co:5432/postgres" "$a: host directo (IPv6) rechazado"
  rechazar $a "postgresql://postgres.$REF:$CLAVE@evil.example.com:5432/postgres" "$a: host ajeno rechazado"
  rechazar $a "postgresql://postgres.$REF:$CLAVE@aws-0-us-west-2.pooler.supabase.com.evil.com:5432/postgres" "$a: dominio que solo empieza como el pooler rechazado"
  rechazar $a "postgresql://postgres.$REF:$CLAVE@$HOST:5433/postgres" "$a: puerto distinto de 6543 y 5432 rechazado"
  rechazar $a "postgresql://postgres.$REF:$CLAVE@$HOST:6543/postgres?sslmode=disable" "$a: parámetros en la cadena rechazados"
  rechazar $a "postgresql://postgres.$REF:$CLAVE@$HOST:6543/otra" "$a: base distinta de postgres rechazada"
  rechazar $a "postgresql://postgres.$REF:@$HOST:6543/postgres" "$a: sin contraseña rechazado"
  rechazar $a "http://postgres.$REF:$CLAVE@$HOST:6543/postgres" "$a: esquema distinto de postgres rechazado"
  rechazar $a "" "$a: cadena vacía rechazada"
done
rm -f "$REGISTRO"; env -u GITHUB_ACTIONS PATH="$W:$PATH" FEL_DEMO_PROYECTO_REF="$REF" bash "$S" borrar >/dev/null 2>&1; [ $? = 2 ] && nollamo && ok "acción desconocida rechazada" || mal "acción desconocida"
# --- diagnóstico de la contraseña (psql falso): solo SI/NO, jamás valores
MALA1="CLAVE-MALA-UNO"; MALA2="CLAVE-MALA-DOS"; URL_MALA1="postgresql://postgres.$REF:$MALA1@$HOST:6543/postgres"
nps() { wc -l < "$REG_PSQL" 2>/dev/null || echo 0; }
rm -f "$REG_PSQL"; DBPW="$CLAVE" base "$REF" diagnostico; r=$?
[ $r = 0 ] && grep -q "SI autentica" "$W/salida.txt" && grep -q "CONCLUSIÓN: la contraseña de DEMO_BD_URL SÍ autentica" "$W/salida.txt" && ok "diagnóstico: contraseña buena → autentica" || { mal "diagnóstico con contraseña buena"; cat "$W/salida.txt"; }
[ "$(nps)" = 1 ] && ok "diagnóstico: si las dos contraseñas son iguales solo se intenta UNA vez" || mal "intentos de más cuando son iguales"
grep -q "iguales \.* SI" "$W/salida.txt" && ok "diagnóstico: informa que las dos son iguales" || mal "no informa igualdad"
grep -q "host=$HOST port=5432 dbname=postgres user=postgres.$REF sslmode=require -X -tA -c select 1" "$REG_PSQL" && ok "diagnóstico: solo «select 1» al Session Pooler (5432) de nexa-demo" || { mal "argumentos de psql"; cat "$REG_PSQL"; }
rm -f "$REG_PSQL"; DBPW="$CLAVE" base "$REF" diagnostico "$URL_MALA1"
grep -q "DEMO_BD_URL tiene la contraseña INCORRECTA" "$W/salida.txt" && [ "$(nps)" = 2 ] && ok "diagnóstico: URL mala + contraseña de la base buena → corregir solo DEMO_BD_URL (2 intentos)" || { mal "caso URL mala"; cat "$W/salida.txt"; }
for v in "$CLAVE" "$MALA1"; do ! grep -q "$v" "$W/salida.txt" || mal "el diagnóstico imprimió una contraseña"; done
rm -f "$REG_PSQL"; DBPW="$MALA2" base "$REF" diagnostico "$URL_MALA1"
grep -q "ninguna contraseña candidata autentica" "$W/salida.txt" && [ "$(nps)" = 2 ] && ok "diagnóstico: ninguna autentica → restablecer en Supabase y actualizar los dos secretos" || { mal "caso ninguna"; cat "$W/salida.txt"; }
for v in "$MALA1" "$MALA2"; do ! grep -q "$v" "$W/salida.txt" || mal "el diagnóstico imprimió una contraseña (el psql falso la incluye en su error)"; done; ok "diagnóstico: ninguna contraseña aparece en la salida, aunque el error de psql la incluyera"
rm -f "$REG_PSQL"; unset DBPW; base "$REF" diagnostico; grep -q "no está definida" "$W/salida.txt" && ok "diagnóstico: sin DEMO_SUPABASE_DB_PASSWORD lo dice" || mal "no informa que falta"
base "$REF" diagnostico "postgresql://postgres.$REF:[YOUR-PASSWORD]@$HOST:6543/postgres"; grep -q "marcador sin reemplazar (\[YOUR-PASSWORD\]) \.* SI" "$W/salida.txt" && ok "diagnóstico: detecta el marcador [YOUR-PASSWORD] sin reemplazar" || mal "marcador"
rm -f "$REG_PSQL"; base "abcdefghijklmnopqrst" diagnostico; [ $? = 2 ] && [ ! -e "$REG_PSQL" ] && ok "diagnóstico: con otra referencia se rechaza sin conectar" || mal "diagnóstico con otra referencia"
# --- estado de la base (psql falso): solo metadatos, solo SELECT, sesión de solo lectura, sin contraseñas
rm -f "$REG_PSQL"; DBPW="$CLAVE" base "$REF" estado; r=$?
[ $r = 0 ] && grep -q "Estado de la base de nexa-demo (solo lectura" "$W/salida.txt" && ok "estado: termina bien y presenta el estado de la base" || { mal "estado"; cat "$W/salida.txt"; }
[ "$(nps)" -ge 5 ] && ! grep -v "default_transaction_read_only=on" "$REG_PSQL" | grep -q . && ok "estado: TODAS las consultas van con la sesión forzada a solo lectura (default_transaction_read_only=on)" || { mal "estado sin sesión de solo lectura"; cat "$REG_PSQL" | head -3; }
! grep -i -E "insert |update |delete |drop |create |alter |truncate |grant |revoke |copy " "$REG_PSQL" && ok "estado: solo consultas SELECT (ninguna escritura)" || mal "estado con una orden de escritura"
! grep -q "$CLAVE" "$W/salida.txt" && ok "estado: ninguna contraseña aparece en la salida" || mal "estado imprime la contraseña"
grep -q "Migraciones en el repositorio" "$W/salida.txt" && ok "estado: informa las migraciones del repositorio y las pendientes" || mal "estado sin migraciones"
rm -f "$REG_PSQL"; base "abcdefghijklmnopqrst" estado; [ $? = 2 ] && [ ! -e "$REG_PSQL" ] && ok "estado: con otra referencia se rechaza sin conectar" || mal "estado con otra referencia"
# --- explicación de por qué se rechazó una cadena (solo SI/NO)
rm -f "$REGISTRO"; base "$REF" validar "postgresql://postgres:$CLAVE@db.$REF.supabase.co:5432/postgres"; r=$?
[ $r = 2 ] && grep -q "usuario es solo «postgres» (conexión DIRECTA) \.* SI" "$W/salida.txt" && grep -q "host es el DIRECTO db.<ref>.supabase.co (solo IPv6) SI" "$W/salida.txt" && grep -q "host termina en .pooler.supabase.com \.* NO" "$W/salida.txt" && ok "explicación: detecta la conexión DIRECTA (usuario postgres + host db.<ref>.supabase.co)" || { mal "explicación conexión directa"; cat "$W/salida.txt"; }
base "$REF" validar "$URL_TX?sslmode=require"; grep -q "parámetros después de «?» (debe ser NO) \.* SI" "$W/salida.txt" && ok "explicación: detecta parámetros en la cadena" || mal "explicación parámetros"
base "$REF" validar "postgresql://postgres.$REF@$HOST:6543/postgres"; grep -q "trae usuario y contraseña (usuario:contraseña@) \.* NO" "$W/salida.txt" && ok "explicación: detecta que falta la contraseña" || mal "explicación sin contraseña"
base "$REF" validar "postgresql://postgres.otroproyecto12345:$CLAVE@$HOST:6543/postgres"; grep -q "usuario es exactamente postgres.<ref de nexa-demo> NO" "$W/salida.txt" && ok "explicación: detecta un usuario de OTRO proyecto" || mal "explicación otro proyecto"
base "$REF" validar "postgresql://postgres.$REF:$CLAVE@$HOST:7777/otrabase"; grep -q "puerto es 6543 o 5432 \.* NO" "$W/salida.txt" && grep -q "base es «postgres» \.* NO" "$W/salida.txt" && ok "explicación: detecta puerto y base incorrectos" || mal "explicación puerto/base"
for v in "$CLAVE" "otroproyecto12345" "db.$REF" "$HOST"; do ! grep -q "$v" "$W/salida.txt" || mal "la explicación imprimió un valor ($v)"; done; ok "explicación: no imprime ningún valor (ni usuario, ni host, ni contraseña)"
base "$REF" validar "$URL_TX"; [ $? = 0 ] && ok "explicación: una cadena correcta sigue aceptándose" || mal "cadena correcta rechazada"

# --- migraciones POR ETAPAS (solo migraciones, con parada) y su verificación de solo lectura
export FAKE_ETAPAS=1 LISTADO="$W/listado.txt" ESTADO_VERS="$W/estado_vers.txt" ESTADO_TAB="$W/estado_tab.txt"
V1="$(cd "$R" && for f in supabase/migrations/*.sql; do b="$(basename "$f")"; v="${b%%_*}"; [ "$v" -le 20261112001000 ] && echo "$v"; done | sort | tr '\n' ' ')"
reinicia() { rm -f "$REGISTRO" "$REG_PSQL" "$LISTADO" "$ESTADO_VERS" "$ESTADO_TAB"; unset FAKE_HIST FAKE_VERSIONS FAKE_TABLAS FAKE_RLS FAKE_DEP FAKE_CATALOGO_RC; }
etapa() { # $1 ref, $2 acción, $3 etapa, $4 confirmación (opcional)
  env -u GITHUB_ACTIONS PATH="$W:$PATH" SUPABASE_DB_PASSWORD="$CLAVE" FEL_DEMO_PROYECTO_REF="$1" FEL_DEMO_BD_URL="$URL_TX" ${4:+FEL_CONFIRMAR_MIGRACIONES=$4} ${ACTIONS:+GITHUB_ACTIONS=true} bash "$S" "$2" "$3" >"$W/salida.txt" 2>&1; }
solo_lectura() { ! grep -v "default_transaction_read_only=on" "$REG_PSQL" | grep -q .; }
# verificar-etapa: solo lectura, nunca llama a la CLI
reinicia; export FAKE_HIST=t FAKE_VERSIONS="$V1" FAKE_TABLAS=67; etapa "$REF" verificar-etapa 1; r=$?
[ $r = 0 ] && grep -q "VERIFICACIÓN DE LA ETAPA 1: OK" "$W/salida.txt" && nollamo && solo_lectura && ok "verificar-etapa 1: todo en regla → OK; no llama a la CLI y todas las consultas son de solo lectura" || { mal "verificar-etapa 1"; cat "$W/salida.txt"; }
reinicia; export FAKE_HIST=t FAKE_VERSIONS="$V1" FAKE_TABLAS=67; etapa "$REF" verificar-etapa 1; grep -q "INFO  extensiones de cifrado: supabase_vault" "$W/salida.txt" && grep -q "INFO  privilegios sobre el esquema vault" "$W/salida.txt" && solo_lectura && ok "verificar-etapa 1: informa (solo lectura) si Vault está disponible y quién tiene USAGE en su esquema; es informativo" || { mal "información de Vault"; cat "$W/salida.txt"; }
reinicia; export FAKE_HIST=t FAKE_VERSIONS="$V1" FAKE_TABLAS=67 FAKE_RLS=60; etapa "$REF" verificar-etapa 1; r=$?
[ $r = 1 ] && grep -q "FALLO RLS: 60 de 67 tablas" "$W/salida.txt" && ok "verificar-etapa 1: RLS incompleto → FALLA (exit 1)" || mal "verificar-etapa no detecta RLS incompleto"
reinicia; export FAKE_HIST=t FAKE_VERSIONS="$V1" FAKE_TABLAS=67 FAKE_DEP=2; etapa "$REF" verificar-etapa 1; [ $? = 1 ] && grep -q "FALLO dependencias de Auth: 2" "$W/salida.txt" && ok "verificar-etapa 1: faltan dependencias de Auth → FALLA" || mal "verificar-etapa no detecta dependencias de Auth"
reinicia; export FAKE_HIST=t FAKE_VERSIONS="${V1}20261113000100 " FAKE_TABLAS=67; etapa "$REF" verificar-etapa 2; r=$?
[ $r = 0 ] && grep -q "catálogo de la migración 28" "$W/salida.txt" && grep -q -- "-f docs/migracion-28/verificacion-posterior-28.sql" "$REG_PSQL" && solo_lectura && ok "verificar-etapa 2: corre el catálogo de la migración 28 (solo lectura)" || { mal "verificar-etapa 2"; cat "$W/salida.txt"; }
reinicia; export FAKE_HIST=t FAKE_VERSIONS="${V1}20261113000100 " FAKE_TABLAS=67 FAKE_CATALOGO_RC=3; etapa "$REF" verificar-etapa 2; r=$?
[ $r = 1 ] && grep -q "FALLO catálogo de la migración 28" "$W/salida.txt" && ! grep -q "$CLAVE" "$W/salida.txt" && ok "verificar-etapa 2: si el catálogo falla → FALLA y no imprime la contraseña (aunque el psql falso la incluya)" || mal "verificar-etapa 2 con catálogo fallido"
# aplicar: confirmación literal y precondiciones
reinicia; export FAKE_HIST=f FAKE_TABLAS=0; etapa "$REF" migraciones-etapa 1; r=$?
[ $r = 2 ] && grep -q "falta la confirmación literal APLICAR-MIGRACIONES" "$W/salida.txt" && nollamo && ok "migraciones-etapa 1 sin confirmación literal → se niega y NO llama a la CLI" || mal "migraciones-etapa sin confirmación"
reinicia; export FAKE_HIST=f FAKE_TABLAS=0; etapa "$REF" migraciones-etapa 1 aplicar-migraciones; [ $? = 2 ] && nollamo && ok "la confirmación distingue mayúsculas: «aplicar-migraciones» no vale" || mal "confirmación en minúsculas aceptada"
reinicia; export FAKE_HIST=f FAKE_TABLAS=5; etapa "$REF" migraciones-etapa 1 APLICAR-MIGRACIONES; r=$?
[ $r = 2 ] && grep -q "exige una base VACÍA" "$W/salida.txt" && nollamo && ok "etapa 1 con la base NO vacía → se niega y NO llama a la CLI" || mal "etapa 1 aceptó una base no vacía"
reinicia; export FAKE_HIST=t FAKE_VERSIONS="20261110000100 " FAKE_TABLAS=0; etapa "$REF" migraciones-etapa 1 APLICAR-MIGRACIONES; [ $? = 2 ] && nollamo && ok "etapa 1 con historial previo → se niega" || mal "etapa 1 aceptó historial previo"
reinicia; export FAKE_HIST=f FAKE_TABLAS=0; etapa "$REF" migraciones-etapa 2 APLICAR-MIGRACIONES; r=$?
[ $r = 2 ] && grep -q "etapa 2 exige que estén registradas EXACTAMENTE las 27" "$W/salida.txt" && nollamo && ok "etapa 2 sin las 27 anteriores → se niega (no se puede saltar la etapa 1)" || mal "etapa 2 aceptó una base sin las 27"
reinicia; export FAKE_HIST=t FAKE_VERSIONS="$(echo "$V1" | awk '{$NF=""; print}') " FAKE_TABLAS=60; etapa "$REF" migraciones-etapa 2 APLICAR-MIGRACIONES; [ $? = 2 ] && nollamo && ok "etapa 2 con solo 26 de las 27 → se niega" || mal "etapa 2 aceptó 26 migraciones"
reinicia; etapa "$REF" migraciones-etapa 3 APLICAR-MIGRACIONES; [ $? = 2 ] && nollamo && ok "una etapa que no existe se rechaza" || mal "etapa 3 aceptada"
reinicia; etapa "abcdefghijklmnopqrst" migraciones-etapa 1 APLICAR-MIGRACIONES; [ $? = 2 ] && nollamo && [ ! -e "$REG_PSQL" ] && ok "con otra referencia de proyecto se rechaza sin conectar ni llamar a la CLI" || mal "otra referencia aceptada"
# aplicar etapa 1 de verdad (CLI falsa): carpeta temporal con SOLO las 27, un único push, verificación y parada
reinicia; export FAKE_HIST=f FAKE_TABLAS=0; etapa "$REF" migraciones-etapa 1 APLICAR-MIGRACIONES; r=$?
[ $r = 0 ] && ok "migraciones-etapa 1: termina bien" || { mal "migraciones-etapa 1 falló"; cat "$W/salida.txt"; }
[ "$(grep -c '^db push' "$REGISTRO")" = 1 ] && grep -qE "^db push --remote=$URL_SES --yes --workdir /" "$REGISTRO" && ! grep -q -- "--workdir \.$" "$REGISTRO" && ok "etapa 1: UN solo «db push» por el Session Pooler, sobre una carpeta temporal (no sobre el repositorio completo)" || { mal "etapa 1: push inesperado"; cat "$REGISTRO"; }
[ "$(wc -l < "$LISTADO" | tr -d ' ')" = 27 ] && ! grep -q "endurecimiento_28" "$LISTADO" && grep -q "demo_limites" "$LISTADO" && ok "etapa 1: la carpeta aplicada tiene EXACTAMENTE las 27 migraciones (la 28 ni se ve)" || { mal "etapa 1: contenido de la carpeta"; cat "$LISTADO"; }
! grep -E "^(secrets|functions)" "$REGISTRO" >/dev/null && ! grep -q -- "--include-all" "$REGISTRO" && ok "etapa 1: no carga secretos, no despliega función y no usa --include-all" || mal "etapa 1 hace más de lo debido"
grep -qx "link --project-ref $REF --workdir $(grep -oE -- '--workdir /[^ ]+' "$REGISTRO" | head -1 | cut -d' ' -f2)" "$REGISTRO" && ok "etapa 1: link con el proyecto fijado, sobre la misma carpeta temporal" || mal "etapa 1: link"
grep -q "VERIFICACIÓN DE LA ETAPA 1: OK. SE DETIENE AQUÍ" "$W/salida.txt" && solo_lectura && ok "etapa 1: verifica en solo lectura y SE DETIENE (la etapa 2 necesita otra aprobación)" || { mal "etapa 1: verificación o parada"; cat "$W/salida.txt"; }
! grep -q "$CLAVE" "$W/salida.txt" && ok "etapa 1: ninguna contraseña aparece en la salida" || mal "etapa 1 imprime la contraseña"
# aplicar etapa 2 de verdad
reinicia; export FAKE_HIST=t FAKE_VERSIONS="$V1" FAKE_TABLAS=67; etapa "$REF" migraciones-etapa 2 APLICAR-MIGRACIONES; r=$?
[ $r = 0 ] && ok "migraciones-etapa 2: termina bien" || { mal "migraciones-etapa 2 falló"; cat "$W/salida.txt"; }
[ "$(wc -l < "$LISTADO" | tr -d ' ')" = 28 ] && grep -q "endurecimiento_28" "$LISTADO" && ok "etapa 2: la carpeta aplicada tiene las 28 (27 ya registradas + la 28: la CLI solo empuja la pendiente)" || { mal "etapa 2: contenido"; cat "$LISTADO"; }
grep -q "catálogo de la migración 28" "$W/salida.txt" && grep -q "VERIFICACIÓN DE LA ETAPA 2: OK. SE DETIENE AQUÍ" "$W/salida.txt" && ok "etapa 2: verifica el catálogo de la 28 en solo lectura y se detiene" || { mal "etapa 2: verificación"; cat "$W/salida.txt"; }
# la verificación posterior fallida tras aplicar → exit 1
reinicia; export FAKE_HIST=t FAKE_VERSIONS="$V1" FAKE_TABLAS=67 FAKE_CATALOGO_RC=3; etapa "$REF" migraciones-etapa 2 APLICAR-MIGRACIONES; [ $? = 1 ] && grep -q "FALLÓ. No se sigue" "$W/salida.txt" && ok "etapa 2: si la verificación posterior falla, el flujo FALLA y no se sigue" || mal "verificación posterior fallida no detiene"
# GitHub Actions: la contraseña y la URL se enmascaran
reinicia; export FAKE_HIST=f FAKE_TABLAS=0; ACTIONS=1 etapa "$REF" migraciones-etapa 1 APLICAR-MIGRACIONES; sm="$(grep -v '^::add-mask::' "$W/salida.txt" | grep -c "$CLAVE" || true)"; [ "$sm" = 0 ] && grep -q "^::add-mask::" "$W/salida.txt" && ok "etapas en GitHub Actions: se enmascaran la contraseña y la URL derivada" || mal "etapas sin enmascarar"
unset FAKE_ETAPAS
[ "$fallos" = 0 ] && echo "SUPABASE HOSPEDADO (SESSION POOLER IPv4, SINTAXIS v3 Y DESTINO FIJO) OK" || { echo "$fallos fallo(s)"; exit 1; }
