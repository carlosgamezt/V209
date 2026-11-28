#!/usr/bin/env bash
# Verifica, SOLO CON UNA LECTURA a la API de Cloudflare, que el destino de una vista previa es seguro:
#   · el proyecto de Pages es el indicado, NO es «nexacorp» (producción de NEXA) y su rama de PRODUCCIÓN es «main»;
#   · la rama de la vista previa NO es main/master/production y su alias de vista previa no coincide con un dominio de producción del proyecto.
# No escribe nada. El token va por stdin a curl (nunca en argumentos) y no se imprime. Sale con 0 solo si todo coincide.
#   Uso: CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… bash verificar-destino.sh <proyecto-pages> <rama-vista-previa>
set -euo pipefail
PROYECTO="${1:-}"; RAMA="${2:-}"
[[ "$PROYECTO" =~ ^[a-z0-9-]{3,58}$ ]] || { echo "PROHIBIDO: nombre de proyecto no válido (${PROYECTO:-vacío})."; exit 2; }
[ "$PROYECTO" != "nexacorp" ] || { echo "PROHIBIDO: «nexacorp» es la producción de NEXA principal; esta plantilla es para productos nuevos."; exit 2; }
[[ "$RAMA" =~ ^[a-z0-9][a-z0-9-]{2,60}$ ]] || { echo "PROHIBIDO: nombre de rama no válido (${RAMA:-vacío})."; exit 2; }
case "$RAMA" in main|master|production) echo "PROHIBIDO: «$RAMA» es una rama de producción."; exit 2;; esac
[ -n "${CLOUDFLARE_API_TOKEN:-}" ] && [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] || { echo "PROHIBIDO: faltan CLOUDFLARE_API_TOKEN o CLOUDFLARE_ACCOUNT_ID. No se hace nada."; exit 2; }
[[ "$CLOUDFLARE_ACCOUNT_ID" =~ ^[0-9a-f]{32}$ ]] || { echo "PROHIBIDO: CLOUDFLARE_ACCOUNT_ID no tiene el formato esperado."; exit 2; }
CUERPO="$(mktemp)"; trap 'rm -f -- "$CUERPO"' EXIT
CODIGO="$(printf 'header = "Authorization: Bearer %s"\n' "$CLOUDFLARE_API_TOKEN" | curl -sS -K - -m 30 -o "$CUERPO" -w '%{http_code}' -X GET "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$PROYECTO" || true)"
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
doms = r.get("domains") or []
if not isinstance(doms, list): print("DOMINIOS_ILEGIBLES"); sys.exit(0)
alias = sys.argv[3] + "." + nombre + ".pages.dev"
if any(str(x).lower() in (alias, sys.argv[3]) or str(x).lower().startswith(sys.argv[3] + ".") for x in doms): print("ALIAS_EN_PRODUCCION"); sys.exit(0)
print("OK|" + prod + "|" + str(len(doms)))
PY
)"
case "$RES" in
  OK\|main\|*) echo "OK  destino verificado: proyecto $PROYECTO · producción «main» · la vista previa usa la rama «$RAMA» (distinta)."; exit 0;;
  ILEGIBLE|SIN_EXITO) echo "NO VERIFICABLE: respuesta ilegible o sin éxito de la API de Cloudflare. No se publica nada."; exit 3;;
  *) echo "PROHIBIDO: el proyecto de destino no cumple lo esperado ($RES). No se publica nada."; exit 2;;
esac
