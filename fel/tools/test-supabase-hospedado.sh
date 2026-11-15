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
if [ "$1 $2" = "secrets set" ]; then for a in "$@"; do case "$a" in --env-file) tomar=1;; *) [ "${tomar:-}" = 1 ] && { cat "$a" > "$ENV_COPIA"; tomar=0; };; esac; done; fi
exit 0
SH
cat > "$W/psql" <<'SH'
#!/usr/bin/env bash
# psql FALSO: «autentica» solo si PGPASSWORD es la contraseña buena; registra los argumentos. Su error INCLUYE la contraseña a propósito (peor caso) para probar que el diagnóstico la oculta.
echo "$*" >> "$REG_PSQL"
if [ "${PGPASSWORD:-}" = "$CLAVE_BUENA" ]; then echo 1; exit 0; fi
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
[ "$fallos" = 0 ] && echo "SUPABASE HOSPEDADO (SESSION POOLER IPv4, SINTAXIS v3 Y DESTINO FIJO) OK" || { echo "$fallos fallo(s)"; exit 1; }
