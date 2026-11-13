#!/usr/bin/env bash
# Prueba (sin red ni credenciales reales) de tools/supabase-hospedado.sh con una CLI de Supabase FALSA que solo registra los argumentos que recibe.
# Comprueba la sintaxis de la CLI v3 y que NINGUNA orden pueda apuntar a otro proyecto.
set -uo pipefail
R="$(cd "$(dirname "$0")/.." && pwd)"; S="$R/tools/supabase-hospedado.sh"; W=$(mktemp -d); fallos=0; REF=sbmchmknfercbtziwrge
trap 'rm -rf "$W"' EXIT
cat > "$W/supabase" <<'SH'
#!/usr/bin/env bash
echo "$*" >> "$REGISTRO"
if [ "$1 $2" = "secrets set" ]; then for a in "$@"; do case "$a" in --env-file) tomar=1;; *) [ "${tomar:-}" = 1 ] && { cat "$a" > "$ENV_COPIA"; tomar=0; };; esac; done; fi
exit 0
SH
chmod +x "$W/supabase"; export REGISTRO="$W/reg.txt" ENV_COPIA="$W/envcopia.txt"
base() { env PATH="$W:$PATH" FEL_DEMO_PROYECTO_REF="$1" FEL_DEMO_BD_URL="postgresql://postgres.$REF:CLAVE-FALSA@h:6543/postgres" FEL_DEMO_HOSTS=nexa-fel-demo.pages.dev FEL_DEMO_MFA_SEMILLAS="maestro=AAAA" FEL_PROXY_SECRETO=SECRETO-FALSO-DE-PRUEBA bash "$S" "$2" >"$W/salida.txt" 2>&1; }
ok() { echo "OK    $1"; }; mal() { echo "FALLO $1"; fallos=$((fallos+1)); }
rm -f "$REGISTRO"; base "$REF" migraciones; r=$?
[ $r = 0 ] && ok "migraciones: termina bien" || mal "migraciones fallaron"
grep -q "^link --project-ref $REF --workdir \." "$REGISTRO" && ok "link con el proyecto fijado" || mal "link"
grep -q "^db push --remote=$REF --yes --workdir \." "$REGISTRO" && ok "db push con --remote=<ref> explícito y --yes (la CLI v3 es local por defecto)" || mal "db push sin destino explícito"
base "$REF" funcion; r=$?
[ $r = 0 ] && ok "función: termina bien" || mal "función falló"
grep -q "^secrets set --env-file .* --remote=$REF --yes" "$REGISTRO" && ok "secrets set con --remote=<ref> y --yes" || mal "secrets set"
grep -q "^functions deploy nexa-demo --remote=$REF --yes --no-verify-jwt --workdir dist/nube/funcion" "$REGISTRO" && ok "functions deploy con --remote=<ref>, --yes y --no-verify-jwt" || mal "functions deploy"
! grep -E "^(secrets set|functions deploy|db push)" "$REGISTRO" | grep -q -- "--project-ref" && ok "ninguna orden que modifica usa el --project-ref obsoleto" || mal "--project-ref obsoleto en una orden hospedada"
for l in $(grep -E "^(secrets set|functions deploy|db push)" "$REGISTRO" | grep -c -- "--remote=$REF"); do [ "$l" = 3 ] && ok "las 3 órdenes que modifican llevan el destino explícito" || mal "falta destino explícito"; done
grep -q "^FEL_PROXY_SECRETO=SECRETO-FALSO-DE-PRUEBA" "$ENV_COPIA" && grep -q "^FEL_DEMO_HOSTS=nexa-fel-demo.pages.dev" "$ENV_COPIA" && ok "el archivo de secretos lleva los 4 valores" || mal "contenido del archivo de secretos"
! grep -q "SECRETO-FALSO\|CLAVE-FALSA" "$REGISTRO" "$W/salida.txt" && ok "los secretos no aparecen en argumentos ni en la salida" || mal "secreto en argumentos o salida"
for malo in abcdefghijklmnopqrst "$REF"x "${REF^^}" "" "../x"; do rm -f "$REGISTRO"; base "$malo" migraciones; r=$?; [ $r = 2 ] && [ ! -e "$REGISTRO" ] && ok "referencia «${malo:-vacía}» rechazada sin llamar a la CLI" || mal "referencia «${malo}» aceptada"; done
rm -f "$REGISTRO"; base "abcdefghijklmnopqrst" funcion; [ $? = 2 ] && [ ! -e "$REGISTRO" ] && ok "función con otra referencia: rechazada sin llamar a la CLI" || mal "función con otra referencia"
rm -f "$REGISTRO"; env PATH="$W:$PATH" FEL_DEMO_PROYECTO_REF="$REF" bash "$S" borrar >/dev/null 2>&1; [ $? = 2 ] && [ ! -e "$REGISTRO" ] && ok "acción desconocida rechazada" || mal "acción desconocida"
[ "$fallos" = 0 ] && echo "SUPABASE HOSPEDADO (SINTAXIS v3 Y DESTINO FIJO) OK" || { echo "$fallos fallo(s)"; exit 1; }
