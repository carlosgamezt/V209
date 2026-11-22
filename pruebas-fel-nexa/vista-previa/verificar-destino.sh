#!/usr/bin/env bash
# Verifica, SOLO CON UNA LECTURA a la API de Cloudflare, que el destino de la vista previa es seguro:
#   · el proyecto de Pages es exactamente «nexacorp» y su rama de PRODUCCIÓN es «main»;
#   · la rama de la vista previa NO es la de producción (ni main/master): así el despliegue no puede tocar el dominio de producción.
# No escribe nada. El token va por stdin a curl (nunca en argumentos) y no se imprime. Sale con 0 solo si todo coincide.
#   Uso: CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… bash verificar-destino.sh nexacorp fel-nexa-acceso
set -euo pipefail
PROYECTO="${1:-}"; RAMA="${2:-}"
[ "$PROYECTO" = "nexacorp" ] || { echo "PROHIBIDO: el proyecto de destino debe ser exactamente «nexacorp» (recibido: ${PROYECTO:-vacío}). No se hace nada."; exit 2; }
[ "$RAMA" = "fel-nexa-acceso" ] || { echo "PROHIBIDO: la rama de la vista previa debe ser exactamente «fel-nexa-acceso» (recibido: ${RAMA:-vacío}). No se hace nada."; exit 2; }
case "$RAMA" in main|master|production) echo "PROHIBIDO: «$RAMA» es una rama de producción."; exit 2;; esac
[ -n "${CLOUDFLARE_API_TOKEN:-}" ] && [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] || { echo "PROHIBIDO: faltan CLOUDFLARE_API_TOKEN o CLOUDFLARE_ACCOUNT_ID. No se hace nada."; exit 2; }
[[ "$CLOUDFLARE_ACCOUNT_ID" =~ ^[0-9a-f]{32}$ ]] || { echo "PROHIBIDO: CLOUDFLARE_ACCOUNT_ID no tiene el formato esperado (32 caracteres hexadecimales)."; exit 2; }
CUERPO="$(mktemp)"; trap 'rm -f -- "$CUERPO"' EXIT
CODIGO="$(printf 'header = "Authorization: Bearer %s"\n' "$CLOUDFLARE_API_TOKEN" | curl -sS -K - -m 30 -o "$CUERPO" -w '%{http_code}' -X GET "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$PROYECTO" 2>/dev/null)" || CODIGO="error"
[ "$CODIGO" = "200" ] || { echo "NO VERIFICABLE: la API de Cloudflare no respondió 200 (código: $CODIGO). No se publica nada."; exit 3; }
RES="$(python3 - "$CUERPO" "$PROYECTO" "$RAMA" <<'PY'
import json, sys
try: d = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception: print("ILEGIBLE"); sys.exit(0)
r = d.get("result") if isinstance(d, dict) else None
if not (isinstance(d, dict) and d.get("success") is True and isinstance(r, dict)): print("SIN_EXITO"); sys.exit(0)
nombre, prod = r.get("name"), r.get("production_branch")
if nombre != sys.argv[2]: print("NOMBRE|" + str(nombre)[:40]); sys.exit(0)
if prod != "main": print("PRODUCCION_NO_MAIN|" + str(prod)[:40]); sys.exit(0)
if prod == sys.argv[3]: print("MISMA_RAMA"); sys.exit(0)
print("OK|" + prod)
PY
)"
case "$RES" in
  OK\|main) echo "OK  destino verificado: proyecto $PROYECTO · rama de producción «main» · la vista previa usa la rama «$RAMA» (distinta): no toca el dominio de producción";;
  ILEGIBLE|SIN_EXITO) echo "NO VERIFICABLE: respuesta ilegible o sin éxito de la API de Cloudflare. No se publica nada."; exit 3;;
  *) echo "PROHIBIDO: el proyecto de destino no cumple lo esperado ($RES). No se publica nada."; exit 2;;
esac
