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
if [ "$1 $2" = "secrets set" ]; then for a in "$@"; do case "$a" in --env-file) tomar=1;; *) [ "${tomar:-}" = 1 ] && { cat "$a" > "$ENV_COPIA"; cut -d= -f1 "$a" >> "$ESTADO_SECRETOS"; sort -u "$ESTADO_SECRETOS" -o "$ESTADO_SECRETOS"; tomar=0; };; esac; done; fi
# secretos FALSOS de la función: «unset» retira nombres, «list» solo muestra nombres con una huella inventada (como la CLI real). Fallos inyectables: FAKE_LIST_RC, FAKE_UNSET_RC, FAKE_UNSET_NOOP (dice que retiró pero no lo hace)
if [ "$1 $2" = "secrets unset" ]; then
  [ -n "${FAKE_UNSET_RC:-}" ] && exit "$FAKE_UNSET_RC"
  if [ -z "${FAKE_UNSET_NOOP:-}" ]; then for a in "${@:3}"; do case "$a" in --*) ;; *) grep -vx "$a" "$ESTADO_SECRETOS" > "$ESTADO_SECRETOS.n" || true; mv "$ESTADO_SECRETOS.n" "$ESTADO_SECRETOS";; esac; done; fi
fi
if [ "$1 $2" = "secrets list" ]; then
  [ -n "${FAKE_LIST_RC:-}" ] && exit "$FAKE_LIST_RC"
  echo "NAME | DIGEST"; while read -r n; do [ -n "$n" ] && echo "$n | 0123456789abcdef0123456789abcdef"; done < "$ESTADO_SECRETOS"
fi
exit 0
SH
cat > "$W/psql" <<'SH'
#!/usr/bin/env bash
# psql FALSO: «autentica» solo si PGPASSWORD es la contraseña buena; registra los argumentos. Su error INCLUYE la contraseña a propósito (peor caso) para probar que el diagnóstico la oculta.
echo "[$PGOPTIONS] $*" >> "$REG_PSQL"
if [ "${PGPASSWORD:-}" = "$CLAVE_BUENA" ]; then
  if [ -n "${FAKE_INICIAL:-}" ]; then   # modo verificación inicial: guarda el envoltorio recibido y devuelve la tabla de resultados indicada
    prev=""; f=""; for a in "$@"; do [ "$prev" = "-f" ] && f="$a"; prev="$a"; done
    [ -n "$f" ] && cp "$f" "$WRAPPER_LOG" 2>/dev/null
    [ -n "${FAKE_INICIAL_ERR:-}" ] && { echo "psql:envoltorio:3: ERROR:  cannot execute CREATE TABLE in a read-only transaction ($PGPASSWORD)" >&2; exit 3; }
    cat "$FAKE_INICIAL_SALIDA"; exit 0
  fi
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
chmod +x "$W/psql" "$W/supabase"; export ESTADO_SECRETOS="$W/secretos_estado.txt"; : > "$ESTADO_SECRETOS"; export REGISTRO="$W/reg.txt" ENV_COPIA="$W/envcopia.txt" REG_PSQL="$W/regpsql.txt" CLAVE_BUENA="$CLAVE"
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
# --- Digifact TEST hacia la función (opcional, apagado por defecto, todo o nada, sin imprimir valores)
DG_PASS="PASS-FALSA-DIGIFACT-#9 con espacio"; DG_USER="USUARIO-FALSO-DG"; DG_EMP="10000000-0000-4000-8000-0000000000a1"; DG_HUELLA="0123456789abcdef"; DG_EMISOR='{"nit":"5888492","nombre":"EMISOR DE PRUEBA","direccion":{"direccion":"3a Calle #5 zona 1"}}'
dg_rechaza() { rm -f "$REGISTRO" "$ENV_COPIA"; base "$REF" funcion; r=$?; [ $r = 2 ] && nollamo && grep -q "no se publica la función" "$W/salida.txt" && ! grep -qF "$DG_PASS" "$W/salida.txt" && ok "$1" || mal "$1 (código $r)"; }
dg_limpiar() { unset FEL_DIGIFACT_TEST FEL_DIGIFACT_TEST_EMPRESA DIGIFACT_TEST_USERNAME DIGIFACT_TEST_PASSWORD DIGIFACT_TEST_NIT FEL_DIGIFACT_TEST_EMISOR FEL_DIGIFACT_TEST_HUELLA FEL_DIGIFACT_AUTORIZA_REFERENCIA; }
dg_completo() { export FEL_DIGIFACT_TEST=habilitado FEL_DIGIFACT_TEST_EMPRESA="$DG_EMP" DIGIFACT_TEST_USERNAME="$DG_USER" DIGIFACT_TEST_PASSWORD="$DG_PASS" DIGIFACT_TEST_NIT=5888492 FEL_DIGIFACT_TEST_EMISOR="$DG_EMISOR" FEL_DIGIFACT_TEST_HUELLA="$DG_HUELLA"; }
dg_limpiar; rm -f "$REGISTRO" "$ENV_COPIA"; base "$REF" funcion
! grep -qi "digifact" "$ENV_COPIA" && ok "Digifact apagado (por defecto): ningún valor de Digifact llega a los secretos de la función" || mal "Digifact apagado pero llegó a la función"
dg_completo; rm -f "$REGISTRO" "$ENV_COPIA"; base "$REF" funcion; r=$?
[ $r = 0 ] && grep -q "^secrets set --env-file" "$REGISTRO" && ok "Digifact habilitado y completo: la función se publica" || mal "Digifact completo no se publicó"
grep -qF "DIGIFACT_TEST_PASSWORD='$DG_PASS'" "$ENV_COPIA" && grep -qF "FEL_DIGIFACT_TEST_EMISOR='$DG_EMISOR'" "$ENV_COPIA" && grep -qx "FEL_DIGIFACT_TEST='habilitado'" "$ENV_COPIA" && grep -qF "FEL_DIGIFACT_TEST_EMPRESA='$DG_EMP'" "$ENV_COPIA" && ok "los valores viajan con comillas simples (la contraseña con espacio y # y el JSON del emisor con # quedan íntegros)" || mal "los valores de Digifact no llegaron íntegros"
! grep -qF "$DG_PASS" "$W/salida.txt" && ! grep -qF "$DG_USER" "$W/salida.txt" && ! grep -qF "$DG_EMISOR" "$W/salida.txt" && grep -q "Digifact TEST: habilitado para la función (valores no mostrados)" "$W/salida.txt" && ok "la salida no contiene la contraseña, el usuario ni el emisor (solo «valores no mostrados»)" || mal "la salida de la función muestra valores de Digifact"
[ "$(stat -c %a "$(grep -o '\-\-env-file [^ ]*' "$REGISTRO" | cut -d' ' -f2)" 2>/dev/null || echo gone)" = gone ] && ok "el archivo temporal con los secretos se borra al terminar" || mal "el archivo temporal de secretos sigue existiendo"
for falta in FEL_DIGIFACT_TEST_EMPRESA DIGIFACT_TEST_USERNAME DIGIFACT_TEST_PASSWORD DIGIFACT_TEST_NIT FEL_DIGIFACT_TEST_EMISOR FEL_DIGIFACT_TEST_HUELLA; do
  dg_completo; unset "$falta"; dg_rechaza "Digifact habilitado SIN $falta: todo o nada, la función no se publica"
done
dg_completo; export FEL_DIGIFACT_TEST_EMISOR="{\"nombre\":\"O'REILLY\"}"; dg_rechaza "un valor con comilla simple se rechaza (no se publica)"
dg_completo; export DIGIFACT_TEST_PASSWORD=$'linea1\nlinea2'; dg_rechaza "un valor con salto de línea se rechaza (no se publica)"
dg_completo; export FEL_DIGIFACT_TEST_HUELLA="xyz"; dg_rechaza "huella que no es de 16 hexadecimales: se rechaza"
dg_completo; export FEL_DIGIFACT_TEST_EMPRESA="no-es-uuid"; dg_rechaza "empresa que no es UUID: se rechaza"
dg_completo; export FEL_DIGIFACT_AUTORIZA_REFERENCIA="no-es-guid"; dg_rechaza "referencia autorizada que no es GUID: se rechaza"
dg_completo; export FEL_DIGIFACT_AUTORIZA_REFERENCIA="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"; rm -f "$REGISTRO" "$ENV_COPIA"; base "$REF" funcion; grep -q "^FEL_DIGIFACT_AUTORIZA_REFERENCIA='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'" "$ENV_COPIA" && ok "la referencia de LA prueba autorizada llega a la función solo con Digifact habilitado" || mal "la referencia autorizada no llegó"
dg_limpiar; export FEL_DIGIFACT_AUTORIZA_REFERENCIA="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"; dg_rechaza "una referencia autorizada con Digifact apagado se rechaza"
dg_limpiar; export FEL_DIGIFACT_TEST="si"; dg_rechaza "FEL_DIGIFACT_TEST solo admite «habilitado» o vacío"
dg_limpiar
# --- Consulta de NIT por Digifact TEST (INDEPENDIENTE de la certificación): apagada por defecto, todo o nada, una empresa, sin datos de emisor ni de certificación
nit_limpiar() { dg_limpiar; unset FEL_DIGIFACT_NIT FEL_DIGIFACT_NIT_EMPRESA FEL_DIGIFACT_CUI FEL_DIGIFACT_CUI_EMPRESA; }
nit_completo() { nit_limpiar; export FEL_DIGIFACT_NIT=habilitado FEL_DIGIFACT_NIT_EMPRESA="$DG_EMP" DIGIFACT_TEST_USERNAME="$DG_USER" DIGIFACT_TEST_PASSWORD="$DG_PASS" DIGIFACT_TEST_NIT=5888492; }
nit_rechaza() { rm -f "$REGISTRO" "$ENV_COPIA"; base "$REF" funcion; r=$?; [ $r = 2 ] && nollamo && grep -q "no se publica la función" "$W/salida.txt" && ! grep -qF "$DG_PASS" "$W/salida.txt" && ok "$1" || mal "$1 (código $r)"; }
nit_limpiar; rm -f "$REGISTRO" "$ENV_COPIA"; base "$REF" funcion
! grep -qi "FEL_DIGIFACT_NIT\|DIGIFACT_TEST" "$ENV_COPIA" && ok "consulta de NIT apagada (por defecto): ningún valor llega a los secretos de la función" || mal "consulta de NIT apagada pero llegó a la función"
nit_completo; rm -f "$REGISTRO" "$ENV_COPIA"; base "$REF" funcion; r=$?
[ $r = 0 ] && grep -q "^secrets set --env-file" "$REGISTRO" && ok "consulta de NIT habilitada y completa: la función se publica" || mal "consulta de NIT completa no se publicó"
grep -qx "FEL_DIGIFACT_NIT='habilitado'" "$ENV_COPIA" && grep -qF "FEL_DIGIFACT_NIT_EMPRESA='$DG_EMP'" "$ENV_COPIA" && grep -qF "DIGIFACT_TEST_PASSWORD='$DG_PASS'" "$ENV_COPIA" && ok "viajan el interruptor, la empresa y las credenciales de TEST (la contraseña con espacio y # íntegra)" || mal "los valores de la consulta de NIT no llegaron"
! grep -q "FEL_DIGIFACT_TEST\b\|FEL_DIGIFACT_TEST_\|FEL_DIGIFACT_AUTORIZA" "$ENV_COPIA" && ok "con solo la consulta de NIT NO viaja el interruptor de certificación, ni el emisor, ni su huella, ni autorización de pruebas" || mal "la consulta de NIT arrastró datos de certificación"
! grep -qF "$DG_PASS" "$W/salida.txt" && ! grep -qF "$DG_USER" "$W/salida.txt" && grep -q "Consulta de NIT por Digifact TEST: habilitada para una empresa (valores no mostrados" "$W/salida.txt" && ok "la salida no contiene la contraseña ni el usuario" || mal "la salida muestra valores de la consulta de NIT"
for falta in FEL_DIGIFACT_NIT_EMPRESA DIGIFACT_TEST_USERNAME DIGIFACT_TEST_PASSWORD DIGIFACT_TEST_NIT; do nit_completo; unset "$falta"; nit_rechaza "consulta de NIT habilitada SIN $falta: todo o nada, la función no se publica"; done
nit_completo; export FEL_DIGIFACT_NIT_EMPRESA="no-es-uuid"; nit_rechaza "empresa de la consulta de NIT que no es UUID: se rechaza"
nit_completo; export DIGIFACT_TEST_PASSWORD=$'linea1\nlinea2'; nit_rechaza "un valor con salto de línea se rechaza (consulta de NIT)"
nit_limpiar; export FEL_DIGIFACT_NIT="si"; nit_rechaza "FEL_DIGIFACT_NIT solo admite «habilitado» o vacío"
nit_limpiar; export FEL_DIGIFACT_NIT_EMPRESA="$DG_EMP"; nit_rechaza "una empresa de la consulta de NIT con la consulta apagada se rechaza"
# las dos juntas son independientes: no se duplican las credenciales en el archivo
nit_completo; export FEL_DIGIFACT_TEST=habilitado FEL_DIGIFACT_TEST_EMPRESA="$DG_EMP" FEL_DIGIFACT_TEST_EMISOR="$DG_EMISOR" FEL_DIGIFACT_TEST_HUELLA="$DG_HUELLA"; rm -f "$REGISTRO" "$ENV_COPIA"; base "$REF" funcion
[ "$(grep -c "^DIGIFACT_TEST_PASSWORD=" "$ENV_COPIA")" = 1 ] && grep -q "^FEL_DIGIFACT_NIT=" "$ENV_COPIA" && grep -q "^FEL_DIGIFACT_TEST=" "$ENV_COPIA" && ok "certificación y consulta de NIT habilitadas por separado: cada interruptor viaja, las credenciales una sola vez" || mal "interruptores combinados"
# --- APAGADO REAL de Digifact en la función: activar, desactivar y reactivar; cada interruptor retira solo lo suyo; si no se puede asegurar, la función NO se publica
CERT="FEL_DIGIFACT_TEST FEL_DIGIFACT_TEST_EMPRESA FEL_DIGIFACT_TEST_EMISOR FEL_DIGIFACT_TEST_HUELLA"; NITV="FEL_DIGIFACT_NIT FEL_DIGIFACT_NIT_EMPRESA"; CRED="DIGIFACT_TEST_USERNAME DIGIFACT_TEST_PASSWORD DIGIFACT_TEST_NIT"
nombres_dg() { grep -E "^(FEL_DIGIFACT|DIGIFACT)" "$ESTADO_SECRETOS" | sort | tr '\n' ' ' | sed 's/ $//'; }
esperado() { printf '%s\n' "$@" | tr ' ' '\n' | sort | tr '\n' ' ' | sed 's/ $//'; }
publica() { rm -f "$REGISTRO" "$ENV_COPIA"; base "$REF" funcion; r=$?; }
dg_todo_apagado() { nit_limpiar; }
dg_solo_nit() { nit_completo; }
dg_solo_cert() { nit_limpiar; dg_completo; }
dg_ambos() { nit_completo; export FEL_DIGIFACT_TEST=habilitado FEL_DIGIFACT_TEST_EMPRESA="$DG_EMP" FEL_DIGIFACT_TEST_EMISOR="$DG_EMISOR" FEL_DIGIFACT_TEST_HUELLA="$DG_HUELLA"; }
: > "$ESTADO_SECRETOS"; printf 'FEL_PROXY_SECRETO\nFEL_DEMO_BD_URL\n' > "$ESTADO_SECRETOS"
dg_todo_apagado; publica; [ $r = 0 ] && [ -z "$(nombres_dg)" ] && grep -q "certificación apagada · consulta de NIT apagada" "$W/salida.txt" && ok "todo apagado: no queda ningún secreto de Digifact y la salida lo dice (solo nombres)" || mal "todo apagado dejó secretos"
dg_solo_nit; publica; [ $r = 0 ] && [ "$(nombres_dg)" = "$(esperado $NITV $CRED)" ] && grep -q "certificación apagada · consulta de NIT HABILITADA" "$W/salida.txt" && ok "ACTIVAR solo la consulta de NIT: quedan solo sus secretos y las credenciales; ninguno de certificación" || mal "activar solo NIT: $(nombres_dg)"
dg_todo_apagado; publica; [ $r = 0 ] && [ -z "$(nombres_dg)" ] && grep -q "^secrets unset" "$REGISTRO" && ok "DESACTIVAR la consulta de NIT: se retiran de verdad TODOS sus secretos y las credenciales (la certificación tampoco los necesita)" || mal "desactivar NIT dejó: $(nombres_dg)"
dg_solo_nit; publica; [ $r = 0 ] && [ "$(nombres_dg)" = "$(esperado $NITV $CRED)" ] && ok "REACTIVAR la consulta de NIT tras apagarla: vuelve a quedar solo lo suyo" || mal "reactivar NIT: $(nombres_dg)"
dg_solo_cert; publica; [ $r = 0 ] && [ "$(nombres_dg)" = "$(esperado $CERT $CRED)" ] && ok "pasar de consulta de NIT a SOLO certificación: se retiran los secretos de NIT y se fijan los de certificación (independientes)" || mal "cambio a certificación: $(nombres_dg)"
dg_ambos; publica; [ $r = 0 ] && [ "$(nombres_dg)" = "$(esperado $CERT $NITV $CRED)" ] && ok "las dos habilitadas: conviven los secretos de ambas con las credenciales una sola vez" || mal "ambas: $(nombres_dg)"
dg_solo_nit; publica; [ $r = 0 ] && [ "$(nombres_dg)" = "$(esperado $NITV $CRED)" ] && ok "APAGAR la certificación con la consulta de NIT encendida: se retiran solo los de certificación; los de NIT y las credenciales se conservan" || mal "apagar certificación: $(nombres_dg)"
dg_ambos; publica; dg_solo_cert; publica; [ $r = 0 ] && [ "$(nombres_dg)" = "$(esperado $CERT $CRED)" ] && ok "APAGAR la consulta de NIT con la certificación encendida: se retiran solo los de NIT; los de certificación y las credenciales se conservan" || mal "apagar NIT con cert: $(nombres_dg)"
dg_solo_cert; export FEL_DIGIFACT_AUTORIZA_REFERENCIA="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"; publica; grep -qx "FEL_DIGIFACT_AUTORIZA_REFERENCIA" "$ESTADO_SECRETOS" && dg_solo_cert && publica && ! grep -qx "FEL_DIGIFACT_AUTORIZA_REFERENCIA" "$ESTADO_SECRETOS" && ok "la autorización de UNA prueba se retira al publicar sin ella (no queda activa por error)" || mal "la autorización quedó activa"
dg_todo_apagado; publica; [ -z "$(nombres_dg)" ] && grep -qx "FEL_PROXY_SECRETO" "$ESTADO_SECRETOS" && ok "al apagar solo se retiran secretos de Digifact: los demás secretos de la función no se tocan" || mal "se tocaron otros secretos"
! grep -E "^secrets unset" "$REGISTRO" | grep -qE "FEL_PROXY_SECRETO|FEL_DEMO_BD_URL|FEL_DEMO_MFA_SEMILLAS|FEL_DEMO_HOSTS" && ok "«secrets unset» nunca nombra secretos que no sean de Digifact" || mal "unset de un secreto ajeno"
# fallo seguro: no se pudo retirar / no se pudo leer / «retiró» pero sigue activo → la función NO se publica
dg_solo_nit; publica; dg_todo_apagado; FAKE_UNSET_RC=1 publica; [ $r = 3 ] && ! grep -q "^functions deploy" "$REGISTRO" && grep -q "no se publica la función" "$W/salida.txt" && ok "si «secrets unset» falla: la función NO se publica (código 3)" || mal "unset fallido se publicó (código $r)"
dg_todo_apagado; FAKE_LIST_RC=1 publica; [ $r = 3 ] && ! grep -q "^functions deploy" "$REGISTRO" && ! grep -q "^secrets set" "$REGISTRO" && ok "si no se puede LEER la lista de secretos: no se fija nada ni se publica (no se puede asegurar el apagado)" || mal "lista ilegible se publicó (código $r)"
dg_todo_apagado; FAKE_UNSET_NOOP=1 publica; [ $r = 3 ] && ! grep -q "^functions deploy" "$REGISTRO" && grep -q "debía estar apagado" "$W/salida.txt" && ok "si «unset» dice haber retirado pero el secreto sigue activo: la verificación por lista lo detecta y NO se publica" || mal "unset ficticio no detectado (código $r)"
dg_solo_nit; : > "$ESTADO_SECRETOS"; printf 'FEL_PROXY_SECRETO\n' > "$ESTADO_SECRETOS"; publica; [ $r = 0 ] && grep -q "^functions deploy" "$REGISTRO" && ok "tras una reactivación normal la función se publica" || mal "no se publicó tras reactivar"
for f in "$W/salida.txt"; do ! grep -qF "$DG_PASS" "$f" && ! grep -qF "$DG_USER" "$f" && ! grep -q "0123456789abcdef0123456789abcdef" "$f" && ok "ninguna salida de estas pruebas contiene la contraseña, el usuario ni huellas de secretos" || mal "la salida muestra secretos"; done
dg_todo_apagado
# --- Consulta de CUI/DPI por Digifact TEST: TERCER interruptor independiente (certificación y NIT no la habilitan ni la retiran)
CUIV="FEL_DIGIFACT_CUI FEL_DIGIFACT_CUI_EMPRESA"
cui_completo() { nit_limpiar; export FEL_DIGIFACT_CUI=habilitado FEL_DIGIFACT_CUI_EMPRESA="$DG_EMP" DIGIFACT_TEST_USERNAME="$DG_USER" DIGIFACT_TEST_PASSWORD="$DG_PASS" DIGIFACT_TEST_NIT=5888492; }
cui_rechaza() { rm -f "$REGISTRO" "$ENV_COPIA"; base "$REF" funcion; r=$?; [ $r = 2 ] && nollamo && grep -q "no se publica la función" "$W/salida.txt" && ! grep -qF "$DG_PASS" "$W/salida.txt" && ok "$1" || mal "$1 (código $r)"; }
printf 'FEL_PROXY_SECRETO\nFEL_DEMO_BD_URL\n' > "$ESTADO_SECRETOS"
cui_completo; rm -f "$REGISTRO" "$ENV_COPIA"; base "$REF" funcion; r=$?
[ $r = 0 ] && grep -qx "FEL_DIGIFACT_CUI='habilitado'" "$ENV_COPIA" && grep -qF "FEL_DIGIFACT_CUI_EMPRESA='$DG_EMP'" "$ENV_COPIA" && ok "consulta de CUI habilitada y completa: la función se publica y viajan el interruptor, la empresa y las credenciales" || mal "consulta de CUI completa (código $r)"
! grep -q "FEL_DIGIFACT_TEST\b\|FEL_DIGIFACT_TEST_\|FEL_DIGIFACT_AUTORIZA\|FEL_DIGIFACT_NIT" "$ENV_COPIA" && ok "con solo la consulta de CUI NO viaja la certificación, ni el emisor, ni su huella, ni la consulta de NIT" || mal "la consulta de CUI arrastró otros interruptores"
! grep -qF "$DG_PASS" "$W/salida.txt" && ! grep -qF "$DG_USER" "$W/salida.txt" && grep -q "Consulta de CUI por Digifact TEST: habilitada para una empresa (valores no mostrados" "$W/salida.txt" && ok "la salida de la consulta de CUI no contiene la contraseña ni el usuario" || mal "la salida muestra valores de la consulta de CUI"
for falta in FEL_DIGIFACT_CUI_EMPRESA DIGIFACT_TEST_USERNAME DIGIFACT_TEST_PASSWORD DIGIFACT_TEST_NIT; do cui_completo; unset "$falta"; cui_rechaza "consulta de CUI habilitada SIN $falta: todo o nada, la función no se publica"; done
cui_completo; export FEL_DIGIFACT_CUI_EMPRESA="no-es-uuid"; cui_rechaza "empresa de la consulta de CUI que no es UUID: se rechaza"
cui_completo; export DIGIFACT_TEST_PASSWORD=$'linea1\nlinea2'; cui_rechaza "un valor con salto de línea se rechaza (consulta de CUI)"
nit_limpiar; export FEL_DIGIFACT_CUI="si"; cui_rechaza "FEL_DIGIFACT_CUI solo admite «habilitado» o vacío"
nit_limpiar; export FEL_DIGIFACT_CUI_EMPRESA="$DG_EMP"; cui_rechaza "una empresa de la consulta de CUI con la consulta apagada se rechaza"
cui_completo; publica; [ $r = 0 ] && [ "$(nombres_dg)" = "$(esperado $CUIV $CRED)" ] && grep -q "certificación apagada · consulta de NIT apagada · consulta de CUI HABILITADA" "$W/salida.txt" && ok "ACTIVAR solo la consulta de CUI: quedan solo sus secretos y las credenciales" || mal "activar solo CUI: $(nombres_dg)"
dg_solo_nit; publica; [ $r = 0 ] && [ "$(nombres_dg)" = "$(esperado $NITV $CRED)" ] && ok "pasar de CUI a solo NIT: se retiran los de CUI, se fijan los de NIT (independientes)" || mal "CUI→NIT: $(nombres_dg)"
nit_completo; export FEL_DIGIFACT_CUI=habilitado FEL_DIGIFACT_CUI_EMPRESA="$DG_EMP"; publica; [ $r = 0 ] && [ "$(nombres_dg)" = "$(esperado $NITV $CUIV $CRED)" ] && ok "NIT y CUI habilitados a la vez: conviven y las credenciales viajan una sola vez" || mal "NIT+CUI: $(nombres_dg)"
dg_solo_nit; publica; [ $r = 0 ] && [ "$(nombres_dg)" = "$(esperado $NITV $CRED)" ] && ok "APAGAR la consulta de CUI con la de NIT encendida: se retiran solo los de CUI; los de NIT y las credenciales se conservan" || mal "apagar CUI con NIT: $(nombres_dg)"
cui_completo; publica; dg_todo_apagado; publica; [ $r = 0 ] && [ -z "$(nombres_dg)" ] && grep -q "^secrets unset" "$REGISTRO" && ok "DESACTIVAR la consulta de CUI: se retiran de verdad sus secretos y las credenciales (nadie más las necesita)" || mal "desactivar CUI dejó: $(nombres_dg)"
cui_completo; publica; [ $r = 0 ] && [ "$(nombres_dg)" = "$(esperado $CUIV $CRED)" ] && ok "REACTIVAR la consulta de CUI tras apagarla" || mal "reactivar CUI: $(nombres_dg)"
cui_completo; publica; dg_solo_cert; publica; [ $r = 0 ] && [ "$(nombres_dg)" = "$(esperado $CERT $CRED)" ] && ok "pasar de CUI a solo certificación: se retiran los de CUI" || mal "CUI→cert: $(nombres_dg)"
dg_todo_apagado; publica; [ -z "$(nombres_dg)" ] && grep -qx "FEL_PROXY_SECRETO" "$ESTADO_SECRETOS" && ok "al apagar todo solo se retiran secretos de Digifact (los demás no se tocan)" || mal "se tocaron otros secretos"
cui_completo; publica; dg_todo_apagado; FAKE_UNSET_RC=1 publica; [ $r = 3 ] && ! grep -q "^functions deploy" "$REGISTRO" && ok "si «secrets unset» falla al apagar la consulta de CUI: la función NO se publica (código 3)" || mal "unset fallido de CUI se publicó (código $r)"
dg_todo_apagado
# --- secretos-estado (solo lectura) y empresa-demo (solo lectura)
dg_solo_nit; publica; rm -f "$REGISTRO"; base "$REF" secretos-estado; r=$?
[ $r = 0 ] && grep -qE "FEL_DIGIFACT_NIT +presente" "$W/salida.txt" && grep -qE "FEL_DIGIFACT_TEST +ausente" "$W/salida.txt" && [ "$(cat "$REGISTRO")" = "secrets list --remote=$REF" ] && ! grep -q "0123456789abcdef" "$W/salida.txt" && ok "secretos-estado: solo «secrets list», muestra presente/ausente por nombre y jamás huellas" || mal "secretos-estado"
FAKE_LIST_RC=1 base "$REF" secretos-estado; [ $? = 1 ] && grep -q "NO VERIFICADO" "$W/salida.txt" && ok "secretos-estado: si no puede leer la lista dice NO VERIFICADO (nunca «ok»)" || mal "secretos-estado sin lista"
dg_todo_apagado
cat > "$W/psql_emp" <<'SH'
#!/usr/bin/env bash
echo "[$PGOPTIONS] $*" >> "$REG_PSQL"
[ "${PGPASSWORD:-}" = "$CLAVE_BUENA" ] || { echo "psql: error ($PGPASSWORD)" >&2; exit 2; }
case "$*" in
  *"from public.empresas e join public.miembros"*) echo -n "${FAKE_EMPRESA_ANA-10000000-0000-0000-0000-0000000000d0}";;
  *"count(*) from public.empresas"*) echo 2;;
  *) echo 1;;
esac
SH
chmod +x "$W/psql_emp"; cp "$W/psql" "$W/psql_viejo"; cp "$W/psql_emp" "$W/psql"
rm -f "$REG_PSQL"; base "$REF" empresa-demo; r=$?
[ $r = 0 ] && grep -q "UUID de la empresa de «ana» ............. 10000000-0000-0000-0000-0000000000d0" "$W/salida.txt" && grep -q "coincide con el UUID esperado" "$W/salida.txt" && ok "empresa-demo: imprime el UUID de «ana» y confirma que coincide con el esperado" || mal "empresa-demo (código $r)"
grep -q "default_transaction_read_only=on" "$REG_PSQL" && ! grep -qiE "insert|update|delete|drop|create|alter" "$REG_PSQL" && ok "empresa-demo: sesión forzada a solo lectura y solo SELECT" || mal "empresa-demo no es de solo lectura"
! grep -qF "$CLAVE" "$W/salida.txt" && ! grep -qiE "nombre|razon|correo|@|token" "$W/salida.txt" && ok "empresa-demo no imprime contraseña ni nombres, correos ni tokens (solo UUID y conteos)" || mal "empresa-demo imprime datos de más"
FAKE_EMPRESA_ANA="10000000-0000-0000-0000-0000000000d9" base "$REF" empresa-demo; [ $? = 0 ] && grep -q "NO coincide con el esperado" "$W/salida.txt" && ok "empresa-demo: un UUID distinto se informa como NO coincide (y se indica cuál usar)" || mal "empresa-demo distinto"
FAKE_EMPRESA_ANA="" base "$REF" empresa-demo; [ $? = 1 ] && grep -q "NO se debe habilitar nada" "$W/salida.txt" && ok "empresa-demo: si «ana» no tiene exactamente una empresa, falla y pide no habilitar nada" || mal "empresa-demo sin empresa"
FAKE_EMPRESA_ANA="10000000-0000-0000-0000-0000000000d0,10000000-0000-0000-0000-0000000000d1" base "$REF" empresa-demo; [ $? = 1 ] && ok "empresa-demo: con dos empresas para «ana» también falla (no hay una única)" || mal "empresa-demo con dos"
cp "$W/psql_viejo" "$W/psql"
nit_limpiar
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
reinicia; export FAKE_HIST=t FAKE_VERSIONS="$V1" FAKE_TABLAS=67; etapa "$REF" verificar-etapa 1; r=$?
[ $r = 0 ] && grep -q "OK    V1 reforzada (etapa 1) (verificacion-posterior-27.sql, solo lectura)" "$W/salida.txt" && grep -q -- "-f docs/migracion-28/verificacion-posterior-27.sql" "$REG_PSQL" && ! grep -q -- "verificacion-posterior-28.sql" "$REG_PSQL" && solo_lectura && ok "verificar-etapa 1: corre la V1 reforzada (67 tablas, políticas, funciones, privilegios, 0 filas) en solo lectura" || { mal "verificar-etapa 1 sin V1 reforzada"; cat "$W/salida.txt"; }
reinicia; export FAKE_HIST=t FAKE_VERSIONS="$V1" FAKE_TABLAS=67 FAKE_CATALOGO_RC=3; etapa "$REF" verificar-etapa 1; r=$?
[ $r = 1 ] && grep -q "FALLO V1 reforzada (etapa 1)" "$W/salida.txt" && ! grep -q "$CLAVE" "$W/salida.txt" && ok "verificar-etapa 1: si la V1 reforzada falla → FALLA y no imprime la contraseña" || mal "V1 reforzada fallida no falla"
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

# --- verificar-inicial: SOLO LECTURA ESTRICTA; ninguna ruta hacia migraciones, CLI, DDL ni DML
unset FAKE_ETAPAS; export WRAPPER_LOG="$W/envoltorio.txt" FAKE_INICIAL_SALIDA="$W/inicial_ok.txt"
cat > "$W/inicial_ok.txt" <<'TXT'
auth.users.id existe | true | true | OK
tablas en public | 0 | 0 | OK
sesión de solo lectura | on | on | OK
extensión supabase_vault | disponible 0.3.1, instalada no | informativo | INFO
TXT
mkdir -p "$W/solo_psql"; cp "$W/psql" "$W/solo_psql/psql"   # PATH SIN «supabase»: si la acción intentara invocar la CLI, fallaría
inicial() { # $1 ref; el resto de variables viene del entorno de la llamada
  env -i PATH="$W/solo_psql:/usr/bin:/bin" HOME="$W" REG_PSQL="$REG_PSQL" WRAPPER_LOG="$WRAPPER_LOG" CLAVE_BUENA="$CLAVE_BUENA" FAKE_INICIAL=1 FAKE_INICIAL_SALIDA="$FAKE_INICIAL_SALIDA" ${FAKE_INICIAL_ERR:+FAKE_INICIAL_ERR=1} \
    FEL_DEMO_PROYECTO_REF="$1" FEL_DEMO_BD_URL="$URL_TX" ${EXTRA_SECRETOS:+SUPABASE_ACCESS_TOKEN=token-falso FEL_CONFIRMAR_MIGRACIONES=APLICAR-MIGRACIONES SUPABASE_DB_PASSWORD=$CLAVE} ${ACTIONS:+GITHUB_ACTIONS=true} bash "$S" "${ACCION_INI:-verificar-inicial}" >"$W/salida.txt" 2>&1; }
rm -f "$REG_PSQL" "$WRAPPER_LOG" "$REGISTRO"; inicial "$REF"; r=$?
[ $r = 0 ] && grep -q "VERIFICACIÓN INICIAL: OK (solo lectura). Nada se modificó." "$W/salida.txt" && ok "verificar-inicial: todo OK → termina bien" || { mal "verificar-inicial OK"; cat "$W/salida.txt"; }
nollamo && ok "verificar-inicial: NO llama a la CLI de Supabase (y se ejecutó con un PATH sin «supabase»)" || mal "verificar-inicial llamó a la CLI"
[ "$(nps)" = 1 ] && grep -q "^\[-c default_transaction_read_only=on\] " "$REG_PSQL" && solo_lectura && ok "verificar-inicial: UNA sola conexión, con la sesión forzada a solo lectura (default_transaction_read_only=on)" || { mal "verificar-inicial: conexión"; cat "$REG_PSQL"; }
[ "$(sed -n '2p' "$WRAPPER_LOG")" = "begin transaction read only;" ] && [ "$(tail -1 "$WRAPPER_LOG")" = "rollback;" ] && sed -n '3p' "$WRAPPER_LOG" | grep -qE '^\\i /.*/docs/migracion-28/verificacion-inicial-nexa-demo\.sql$' && ok "verificar-inicial: el SQL se ejecuta DENTRO de «begin transaction read only … rollback» (nunca se confirma nada)" || { mal "envoltorio"; cat "$WRAPPER_LOG"; }
! grep -qiE "commit|insert|update|delete|create|alter|drop|grant|revoke|truncate" "$WRAPPER_LOG" && ok "verificar-inicial: el envoltorio no contiene COMMIT ni sentencias de escritura" || mal "envoltorio con escritura"
! grep -q "$CLAVE" "$W/salida.txt" && ok "verificar-inicial: ninguna contraseña aparece en la salida" || mal "verificar-inicial imprime la contraseña"
# con token y confirmación presentes en el entorno, sigue sin tener ruta hacia las migraciones
rm -f "$REG_PSQL" "$REGISTRO"; EXTRA_SECRETOS=1 inicial "$REF"; [ $? = 0 ] && nollamo && ok "verificar-inicial: aunque el entorno traiga el token de Supabase y APLICAR-MIGRACIONES, no llama a la CLI ni aplica nada" || mal "verificar-inicial con token y confirmación"
# resultados que bloquean
printf '%s\n' "tablas en public | 5 | 0 | REVISAR" "sesión de solo lectura | on | on | OK" > "$W/inicial_rev.txt"; rm -f "$REG_PSQL"; FAKE_INICIAL_SALIDA="$W/inicial_rev.txt" inicial "$REF"; r=$?
[ $r = 1 ] && grep -q "1 comprobación(es) para REVISAR" "$W/salida.txt" && ok "verificar-inicial: una fila REVISAR hace FALLAR la acción (no se debe aplicar la etapa 1)" || mal "REVISAR no falla"
printf '%s\n' "auth.users.id existe | true | true | OK" > "$W/inicial_sin_ro.txt"; FAKE_INICIAL_SALIDA="$W/inicial_sin_ro.txt" inicial "$REF"; r=$?
[ $r = 1 ] && grep -q "NO está confirmada como de solo lectura" "$W/salida.txt" && ok "verificar-inicial: sin la fila «sesión de solo lectura | on» el resultado se DESCARTA y falla" || mal "acepta una sesión sin confirmar"
printf '%s\n' "sesión de solo lectura | off | on | REVISAR" > "$W/inicial_off.txt"; FAKE_INICIAL_SALIDA="$W/inicial_off.txt" inicial "$REF"; [ $? = 1 ] && ok "verificar-inicial: una sesión que NO es de solo lectura falla" || mal "acepta sesión de escritura"
FAKE_INICIAL_ERR=1 inicial "$REF"; r=$?
[ $r = 1 ] && grep -q "no se pudo ejecutar: psql:envoltorio:3: ERROR:  cannot execute CREATE TABLE in a read-only transaction" "$W/salida.txt" && ! grep -q "$CLAVE" "$W/salida.txt" && ok "verificar-inicial: si PostgreSQL rechaza una escritura por ser de solo lectura, la acción FALLA y oculta la contraseña (aunque el psql falso la incluya)" || { mal "error de escritura"; cat "$W/salida.txt"; }
rm -f "$REG_PSQL"; inicial "abcdefghijklmnopqrst"; [ $? = 2 ] && [ ! -e "$REG_PSQL" ] && ok "verificar-inicial: con otra referencia de proyecto se rechaza sin conectar" || mal "verificar-inicial con otra referencia"
ACTIONS=1 inicial "$REF"; sm="$(grep -v '^::add-mask::' "$W/salida.txt" | grep -c "$CLAVE" || true)"; [ "$sm" = 0 ] && grep -q "^::add-mask::" "$W/salida.txt" && ok "verificar-inicial en GitHub Actions: se enmascara la contraseña" || mal "verificar-inicial sin enmascarar"
# verificador estático del SQL: solo SELECT
V="$R/tools/verificar-sql-solo-lectura.py"; python3 "$V" "$R/docs/migracion-28/verificacion-inicial-nexa-demo.sql" >/dev/null && ok "el SQL de verificación inicial pasa el verificador (solo SELECT)" || mal "el SQL real no pasa el verificador"
malo() { printf '%s\n' "$1" > "$W/malo.sql"; python3 "$V" "$W/malo.sql" >/dev/null 2>&1 && mal "el verificador ACEPTÓ: $1" || ok "el verificador rechaza: $1"; }
malo "select 1; insert into public.t values (1);"; malo "select 1; update public.t set x = 1;"; malo "select 1; delete from public.t;"; malo "create table public.t (id int);"; malo "select 1; drop table public.t;"
malo "select * into public.copia from public.t;"; malo "select set_config('a', 'b', false);"; malo "select nextval('s');"; malo "select 1; grant all on public.t to anon;"; malo "do \$\$ begin null; end \$\$;"
malo "select 1; truncate public.t;"; malo "\\copy public.t from 'x'"; malo "select 1; alter role postgres password 'x';"; malo "select pg_terminate_backend(1);"; malo "select 1; commit;"; malo "begin; select 1;"
printf '%s\n' "select 'CREATE' as x; select has_schema_privilege('postgres', 'public', 'CREATE');" > "$W/bueno.sql"; python3 "$V" "$W/bueno.sql" >/dev/null && ok "el verificador no se confunde con la palabra CREATE dentro de un texto" || mal "falso positivo con texto"

# --- diagnostico-inicial: misma barrera de solo lectura que verificar-inicial (informativo: no falla por hallazgos)
cat > "$W/diag_ok.txt" <<'TXT'
00 sesión | transaction_read_only | on
A1 función | identidad | public.rls_auto_enable()
A2 uso | disparador de evento que la ejecuta | ensure_rls (ddl_command_end, activo=O)
B2 vault privilegio efectivo | service_role sobre decrypted_secrets | SELECT=true INSERT=false UPDATE=false DELETE=false
TXT
rm -f "$REG_PSQL" "$WRAPPER_LOG" "$REGISTRO"; ACCION_INI=diagnostico-inicial FAKE_INICIAL_SALIDA="$W/diag_ok.txt" inicial "$REF"; r=$?
[ $r = 0 ] && grep -q "DIAGNÓSTICO: OK (solo lectura). Nada se modificó." "$W/salida.txt" && grep -q "A1 función | identidad | public.rls_auto_enable()" "$W/salida.txt" && ok "diagnostico-inicial: imprime los hallazgos y termina bien" || { mal "diagnostico-inicial OK"; cat "$W/salida.txt"; }
nollamo && ok "diagnostico-inicial: NO llama a la CLI de Supabase (PATH sin «supabase»)" || mal "diagnostico-inicial llamó a la CLI"
[ "$(nps)" = 1 ] && grep -q "^\[-c default_transaction_read_only=on\] " "$REG_PSQL" && solo_lectura && ok "diagnostico-inicial: UNA conexión con la sesión forzada a solo lectura" || mal "diagnostico-inicial: conexión"
[ "$(sed -n '2p' "$WRAPPER_LOG")" = "begin transaction read only;" ] && [ "$(tail -1 "$WRAPPER_LOG")" = "rollback;" ] && sed -n '3p' "$WRAPPER_LOG" | grep -qE '^\\i /.*/docs/migracion-28/diagnostico-funcion-y-vault-nexa-demo\.sql$' && ok "diagnostico-inicial: el SQL va DENTRO de «begin transaction read only … rollback»" || { mal "diagnostico: envoltorio"; cat "$WRAPPER_LOG"; }
! grep -q "$CLAVE" "$W/salida.txt" && ok "diagnostico-inicial: ninguna contraseña en la salida" || mal "diagnostico imprime la contraseña"
rm -f "$REGISTRO"; ACCION_INI=diagnostico-inicial EXTRA_SECRETOS=1 FAKE_INICIAL_SALIDA="$W/diag_ok.txt" inicial "$REF"; [ $? = 0 ] && nollamo && ok "diagnostico-inicial: aunque el entorno traiga el token y APLICAR-MIGRACIONES, no llama a la CLI ni aplica nada" || mal "diagnostico con token"
printf '%s\n' "A1 función | identidad | public.x()" > "$W/diag_sin_ro.txt"; ACCION_INI=diagnostico-inicial FAKE_INICIAL_SALIDA="$W/diag_sin_ro.txt" inicial "$REF"; r=$?
[ $r = 1 ] && grep -q "NO está confirmada como de solo lectura" "$W/salida.txt" && ok "diagnostico-inicial: sin la fila «00 sesión | transaction_read_only | on» el resultado se DESCARTA y falla" || mal "diagnostico acepta sesión sin confirmar"
printf '%s\n' "00 sesión | transaction_read_only | off" > "$W/diag_off.txt"; ACCION_INI=diagnostico-inicial FAKE_INICIAL_SALIDA="$W/diag_off.txt" inicial "$REF"; [ $? = 1 ] && ok "diagnostico-inicial: una sesión que NO es de solo lectura falla" || mal "diagnostico acepta sesión de escritura"
ACCION_INI=diagnostico-inicial FAKE_INICIAL_ERR=1 inicial "$REF"; r=$?
[ $r = 1 ] && grep -q "DIAGNÓSTICO: no se pudo ejecutar: psql:envoltorio:3: ERROR:  cannot execute CREATE TABLE in a read-only transaction" "$W/salida.txt" && ! grep -q "$CLAVE" "$W/salida.txt" && ok "diagnostico-inicial: si PostgreSQL rechaza una escritura, FALLA y oculta la contraseña" || { mal "diagnostico error de escritura"; cat "$W/salida.txt"; }
rm -f "$REG_PSQL"; ACCION_INI=diagnostico-inicial inicial "abcdefghijklmnopqrst"; [ $? = 2 ] && [ ! -e "$REG_PSQL" ] && ok "diagnostico-inicial: con otra referencia de proyecto se rechaza sin conectar" || mal "diagnostico con otra referencia"
ACCION_INI=diagnostico-inicial ACTIONS=1 FAKE_INICIAL_SALIDA="$W/diag_ok.txt" inicial "$REF"; sm="$(grep -v '^::add-mask::' "$W/salida.txt" | grep -c "$CLAVE" || true)"; [ "$sm" = 0 ] && grep -q "^::add-mask::" "$W/salida.txt" && ok "diagnostico-inicial en GitHub Actions: se enmascara la contraseña" || mal "diagnostico sin enmascarar"
python3 "$V" "$R/docs/migracion-28/diagnostico-funcion-y-vault-nexa-demo.sql" >/dev/null && ok "el SQL de diagnóstico pasa el verificador (solo SELECT)" || mal "el SQL de diagnóstico no pasa el verificador"

# --- verificar-api-vault: SOLO LECTURA (GET a la raíz de la API con la clave pública); sin psql, sin CLI, sin claves de servicio
mkdir -p "$W/solo_curl"
cat > "$W/solo_curl/curl" <<'SH'
#!/usr/bin/env bash
# curl FALSO: registra argumentos y la configuración recibida por la entrada estándar (donde va la clave) y contesta según FAKE_API.
echo "$*" >> "$CURL_ARGS"; cfg="$(cat)"; printf '%s\n---\n' "$cfg" >> "$CURL_STDIN"
salida=""; prev=""; for a in "$@"; do [ "$prev" = "-o" ] && salida="$a"; prev="$a"; done
perfil="$(printf '%s' "$cfg" | sed -n 's/^header = "Accept-Profile: \(.*\)"$/\1/p')"
resp() { printf '%s' "$2" > "$salida"; printf '%s' "$1"; }
case "${FAKE_API:-ok}" in
  red) exit 28;;
  sin_clave) resp 401 '{"message":"Invalid API key"}';;
  denegado) resp 403 '{"message":"forbidden"}';;
  control_200) resp 200 '{"swagger":"2.0"}';;
  *) if [ "$perfil" = public ]; then resp 404 '{"code":"PGRST205","details":null,"hint":null,"message":"Could not find the table '"'"'public.fel_sonda_inexistente'"'"' in the schema cache"}'
     else case "${FAKE_API}" in
       ok) resp 406 '{"code":"PGRST106","details":null,"hint":null,"message":"The schema must be one of the following: public, graphql_public"}';;
       hint_ok) resp 406 '{"code":"PGRST106","details":null,"hint":"Only the following schemas are exposed: public, graphql_public","message":"Invalid schema: vault"}';;
       hint_con_vault) resp 406 '{"code":"PGRST106","hint":"Only the following schemas are exposed: public, vault","message":"Invalid schema: vault"}';;
       sin_lista) resp 406 '{"code":"PGRST106","message":"otra cosa"}';;
       lista_con_vault) resp 406 '{"code":"PGRST106","details":null,"hint":null,"message":"The schema must be one of the following: public, vault"}';;
       expuesto) resp 404 '{"code":"PGRST205","message":"Could not find the table '"'"'vault.fel_sonda_inexistente'"'"' in the schema cache"}';;
       expuesto_200) resp 200 '[]';;
       vault_401) resp 401 '{"code":"42501","message":"permission denied"}';;
       vault_403) resp 403 '{"message":"forbidden"}';;
       raro) resp 500 '{"message":"boom"}';;
     esac; fi;;
esac
SH
chmod +x "$W/solo_curl/curl"
b64u() { python3 -c 'import base64,json,sys;print(base64.urlsafe_b64encode(json.dumps(json.loads(sys.argv[1])).encode()).decode().rstrip("="))' "$1"; }
JWT_ANON="$(b64u '{"alg":"HS256","typ":"JWT"}').$(b64u "{\"role\":\"anon\",\"ref\":\"$REF\"}").firma-publica-de-prueba"
JWT_SERV="$(b64u '{"alg":"HS256","typ":"JWT"}').$(b64u "{\"role\":\"service_role\",\"ref\":\"$REF\"}").firma-de-servicio-de-prueba"
JWT_OTRO="$(b64u '{"alg":"HS256","typ":"JWT"}').$(b64u '{"role":"anon","ref":"otroproyecto12345678"}').firma-otro-proyecto"
export CURL_ARGS="$W/curl_args.txt" CURL_STDIN="$W/curl_stdin.txt"
api() { # $1 ref, $2 clave; FAKE_API y ACTIONS vienen del entorno de la llamada
  env -i PATH="$W/solo_curl:/usr/bin:/bin" HOME="$W" CURL_ARGS="$CURL_ARGS" CURL_STDIN="$CURL_STDIN" FAKE_API="${FAKE_API:-ok}" FEL_DEMO_PROYECTO_REF="$1" ${2:+FEL_DEMO_ANON_KEY=$2} ${ACTIONS:+GITHUB_ACTIONS=true} bash "$S" verificar-api-vault >"$W/salida.txt" 2>&1; }
limpia_api() { rm -f "$CURL_ARGS" "$CURL_STDIN"; }
limpia_api; api "$REF" "$JWT_ANON"; r=$?
[ $r = 0 ] && grep -q "API de datos: OK (solo lectura). Nada se modificó." "$W/salida.txt" && grep -q "Esquemas expuestos por la API: public, graphql_public" "$W/salida.txt" && ok "verificar-api-vault: vault NO expuesto (406 PGRST106) → OK y muestra los esquemas expuestos" || { mal "api-vault OK"; cat "$W/salida.txt"; }
[ "$(wc -l < "$CURL_ARGS" | tr -d ' ')" = 2 ] && ! grep -qE -- "-X|--request|-d |--data|-T |--upload|-F |PUT|POST|DELETE|PATCH" "$CURL_ARGS" && grep -c "https://$REF.supabase.co/rest/v1/fel_sonda_inexistente?limit=0\$" "$CURL_ARGS" | grep -qx 2 && ok "verificar-api-vault: DOS peticiones GET, ambas a una tabla INEXISTENTE del proyecto fijado (no se lee ningún dato; ninguna con método de escritura; ya no se pide la raíz OpenAPI)" || { mal "api-vault: peticiones"; cat "$CURL_ARGS"; }
! grep -q "firma-publica" "$CURL_ARGS" && grep -q "apikey: $JWT_ANON" "$CURL_STDIN" && ok "verificar-api-vault: la clave va por la entrada estándar, NUNCA en los argumentos del proceso" || mal "la clave aparece en los argumentos"
grep -q "Authorization: Bearer" "$CURL_STDIN" && grep -q "Accept-Profile: vault" "$CURL_STDIN" && grep -q "Accept-Profile: public" "$CURL_STDIN" && ok "verificar-api-vault: sonda de control (public) y sonda de vault, con la clave JWT anon" || mal "perfiles de la sonda"
! grep -q "firma-publica" "$W/salida.txt" && ok "verificar-api-vault: la clave no aparece en la salida" || mal "api-vault imprime la clave"
limpia_api; FAKE_API=expuesto api "$REF" "$JWT_ANON"; r=$?
[ $r = 1 ] && grep -q "REVISAR el esquema vault ESTÁ EXPUESTO" "$W/salida.txt" && ok "verificar-api-vault: el esquema vault se resuelve (404 PGRST205) → REVISAR (expuesto) y falla" || mal "no detecta vault expuesto"
limpia_api; FAKE_API=expuesto_200 api "$REF" "$JWT_ANON"; r=$?
[ $r = 1 ] && grep -q "REVISAR el esquema vault ESTÁ EXPUESTO" "$W/salida.txt" && ok "verificar-api-vault: vault responde 200 → REVISAR (expuesto) y falla" || mal "no detecta vault 200"
limpia_api; FAKE_API=vault_401 api "$REF" "$JWT_ANON"; r=$?
[ $r = 1 ] && grep -q "NO VERIFICADO (respuesta inesperada HTTP 401" "$W/salida.txt" && ! grep -q "API de datos: OK" "$W/salida.txt" && ok "verificar-api-vault: 401 en la sonda de vault (con control válido) → NO VERIFICADO, nunca OK" || mal "vault 401 no es NO VERIFICADO"
limpia_api; FAKE_API=vault_403 api "$REF" "$JWT_ANON"; r=$?
[ $r = 1 ] && grep -q "NO VERIFICADO (respuesta inesperada HTTP 403" "$W/salida.txt" && ! grep -q "API de datos: OK" "$W/salida.txt" && ok "verificar-api-vault: 403 en la sonda de vault → NO VERIFICADO, nunca OK" || mal "vault 403 no es NO VERIFICADO"
limpia_api; FAKE_API=control_200 api "$REF" "$JWT_ANON"; r=$?
[ $r = 1 ] && grep -q "NO VERIFICADO (respuesta inesperada de la sonda de control (HTTP 200)" "$W/salida.txt" && [ "$(wc -l < "$CURL_ARGS" | tr -d ' ')" = 1 ] && ok "verificar-api-vault: un 200 en el control (no es «tabla inexistente») → NO VERIFICADO, sin probar vault" || mal "control 200 no es NO VERIFICADO"
limpia_api; FAKE_API=denegado api "$REF" "$JWT_ANON"; r=$?
[ $r = 1 ] && grep -q "NO VERIFICADO (la API denegó el acceso (HTTP 403)" "$W/salida.txt" && [ "$(wc -l < "$CURL_ARGS" | tr -d ' ')" = 1 ] && ok "verificar-api-vault: 403 en el control → NO VERIFICADO, sin probar vault" || mal "control 403 no es NO VERIFICADO"
limpia_api; FAKE_API=lista_con_vault api "$REF" "$JWT_ANON"; r=$?
[ $r = 1 ] && grep -q "REVISAR la lista de esquemas expuestos incluye vault" "$W/salida.txt" && ok "verificar-api-vault: si la lista de esquemas expuestos incluye vault → REVISAR" || mal "no detecta vault en la lista"
limpia_api; FAKE_API=sin_clave api "$REF" "$JWT_ANON"; r=$?
[ $r = 1 ] && grep -q "NO VERIFICADO (la API rechazó la autenticación (HTTP 401)" "$W/salida.txt" && [ "$(wc -l < "$CURL_ARGS" | tr -d ' ')" = 1 ] && ok "verificar-api-vault: clave rechazada por la API (401) → NO VERIFICADO, sin probar vault" || mal "401 no es NO VERIFICADO"
limpia_api; FAKE_API=red api "$REF" "$JWT_ANON"; [ $? = 1 ] && grep -q "NO VERIFICADO" "$W/salida.txt" && ok "verificar-api-vault: sin red → NO VERIFICADO (nunca OK)" || mal "sin red no es NO VERIFICADO"
limpia_api; FAKE_API=raro api "$REF" "$JWT_ANON"; [ $? = 1 ] && grep -q "NO VERIFICADO (respuesta inesperada HTTP 500)" "$W/salida.txt" && ok "verificar-api-vault: respuesta inesperada → NO VERIFICADO" || mal "respuesta rara no es NO VERIFICADO"
limpia_api; FAKE_API=hint_ok api "$REF" "$JWT_ANON"; r=$?
[ $r = 0 ] && grep -q "Esquemas expuestos por la API: public, graphql_public" "$W/salida.txt" && ok "verificar-api-vault: lista de esquemas en «hint» (message «Invalid schema: vault») → OK" || { mal "lista en hint"; cat "$W/salida.txt"; }
limpia_api; FAKE_API=hint_con_vault api "$REF" "$JWT_ANON"; r=$?
[ $r = 1 ] && grep -q "REVISAR la lista de esquemas expuestos incluye vault" "$W/salida.txt" && ok "verificar-api-vault: «hint» con vault en la lista → REVISAR" || mal "hint con vault"
limpia_api; FAKE_API=sin_lista api "$REF" "$JWT_ANON"; [ $? = 1 ] && grep -q "NO VERIFICADO (rechazó el esquema vault pero no se pudo leer la lista.*otra cosa" "$W/salida.txt" && ok "verificar-api-vault: 406 sin lista de esquemas → NO VERIFICADO" || mal "406 sin lista no es NO VERIFICADO"
# claves NO públicas: se rechazan SIN enviarlas a ningún sitio
for caso in "clave secreta sb_secret_|sb_secret_abcdefghijklmnop" "JWT del rol service_role|$JWT_SERV" "JWT anon de OTRO proyecto|$JWT_OTRO" "texto cualquiera|esto-no-es-una-clave" "vacía|"; do
  desc="${caso%%|*}"; clave="${caso#*|}"; limpia_api; api "$REF" "$clave"; r=$?
  [ $r = 2 ] && [ ! -e "$CURL_ARGS" ] && ok "verificar-api-vault: $desc → se rechaza SIN llamar a curl" || { mal "api-vault aceptó: $desc"; cat "$W/salida.txt" | head -3; }
done
limpia_api; api "$REF" "sb_publishable_abcdefghijklmnop"; r=$?
[ $r = 0 ] && ! grep -q "Authorization" "$CURL_STDIN" && grep -q "apikey: sb_publishable_abcdefghijklmnop" "$CURL_STDIN" && ok "verificar-api-vault: la clave «publicable» se admite y se envía solo como apikey (sin Authorization)" || { mal "clave publicable"; cat "$W/salida.txt" | head -3; }
limpia_api; api "abcdefghijklmnopqrst" "$JWT_ANON"; [ $? = 2 ] && [ ! -e "$CURL_ARGS" ] && ok "verificar-api-vault: con otra referencia de proyecto se rechaza sin llamar a curl" || mal "api-vault con otra referencia"
limpia_api; ACTIONS=1 api "$REF" "$JWT_ANON"; sm="$(grep -v '^::add-mask::' "$W/salida.txt" | grep -c "firma-publica" || true)"; [ "$sm" = 0 ] && grep -q "^::add-mask::" "$W/salida.txt" && ok "verificar-api-vault en GitHub Actions: se enmascara la clave" || mal "api-vault sin enmascarar"
[ "$fallos" = 0 ] && echo "SUPABASE HOSPEDADO (SESSION POOLER IPv4, SINTAXIS v3 Y DESTINO FIJO) OK" || { echo "$fallos fallo(s)"; exit 1; }
