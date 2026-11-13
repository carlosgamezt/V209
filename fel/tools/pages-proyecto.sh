#!/usr/bin/env bash
# Crea (con Wrangler) o reutiliza el proyecto de Cloudflare Pages de la DEMOSTRACIÓN y devuelve su nombre público real.
# Garantías: solo trabaja con el nombre exacto «nexa-fel-demo»; nunca con «nexa» ni «nexacorp» (proyectos principales); no traga errores (un fallo distinto de «no existe» detiene todo);
# el token no va en argumentos de comandos. Imprime en la última línea:  HOST=<subdominio>.pages.dev   (puede llevar sufijo si el nombre ya estaba ocupado en pages.dev).
# Entradas: PAGES_PROYECTO, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN · opcionales: CLOUDFLARE_API_BASE, WRANGLER_CMD, RAMA_PRODUCCION (main).
set -euo pipefail
NOMBRE="${PAGES_PROYECTO:-}"; BASE="${CLOUDFLARE_API_BASE:-https://api.cloudflare.com/client/v4}"; RAMA="${RAMA_PRODUCCION:-main}"
read -r -a WR <<< "${WRANGLER_CMD:-npx --yes wrangler@4}"
case "$NOMBRE" in nexa|nexacorp) echo "PROHIBIDO: «$NOMBRE» es un proyecto principal de NEXA; la demostración usa nexa-fel-demo."; exit 2;; esac
[ "$NOMBRE" = "nexa-fel-demo" ] || { echo "Nombre no permitido («$NOMBRE»): debe ser exactamente nexa-fel-demo."; exit 2; }
for v in CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_TOKEN; do [ -n "${!v:-}" ] || { echo "Falta $v"; exit 2; }; done
[[ "$CLOUDFLARE_ACCOUNT_ID" =~ ^[0-9a-f]{32}$ ]] || { echo "CLOUDFLARE_ACCOUNT_ID no tiene el formato esperado (32 caracteres hexadecimales)"; exit 2; }
URL="$BASE/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$NOMBRE"
CUERPO="$(mktemp)"
consulta() { # imprime el código HTTP y deja el cuerpo en $CUERPO; el token viaja por entrada estándar, no por argumentos
  curl -sS -o "$CUERPO" -w '%{http_code}' --config - "$URL" <<CFG
header = "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
CFG
}
trap 'rm -f "$CUERPO"' EXIT
COD="$(consulta)" || { echo "No se pudo consultar Cloudflare"; exit 1; }
case "$COD" in
  200) echo "El proyecto de Pages «$NOMBRE» ya existe: se reutiliza.";;
  404) echo "El proyecto de Pages «$NOMBRE» no existe: se crea con Wrangler."
       "${WR[@]}" pages project create "$NOMBRE" --production-branch "$RAMA"   # si falla, el script se detiene (no se oculta el error)
       COD="$(consulta)" || { echo "No se pudo verificar la creación"; exit 1; }
       [ "$COD" = 200 ] || { echo "El proyecto no aparece tras crearlo (código $COD)"; exit 1; };;
  401|403) echo "Cloudflare rechazó el token (código $COD): revisa que sea de la cuenta correcta y tenga «Cloudflare Pages: Edit»."; exit 1;;
  *) echo "Respuesta inesperada de Cloudflare al consultar el proyecto (código $COD)."; exit 1;;
esac
SUB="$(jq -r '.result.subdomain // empty' "$CUERPO")"; NOM="$(jq -r '.result.name // empty' "$CUERPO")"
[ "$NOM" = "$NOMBRE" ] || { echo "El proyecto devuelto no coincide con el solicitado."; exit 1; }
[[ "$SUB" =~ ^[a-z0-9-]+\.pages\.dev$ ]] || { echo "Cloudflare no devolvió un subdominio válido."; exit 1; }
echo "HOST=$SUB"
