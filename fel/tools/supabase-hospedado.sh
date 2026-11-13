#!/usr/bin/env bash
# Las ÚNICAS órdenes de la CLI de Supabase que modifican el proyecto hospedado. Compatible con la CLI v3, que:
#  · trabaja en LOCAL por defecto (un «db push» sin --remote no toca el proyecto hospedado),
#  · pide consentimiento para cambios hospedados (en CI, --yes),
#  · sustituye --project-ref por --remote=<ref> (todavía funciona, pero está obsoleto y oculto de la ayuda).
# Por eso TODA orden lleva el proyecto de forma EXPLÍCITA (--remote=<ref>): nunca depende de qué proyecto esté «enlazado».
#   bash tools/supabase-hospedado.sh migraciones     → enlaza y aplica las migraciones pendientes
#   bash tools/supabase-hospedado.sh funcion         → carga los secretos de la función y la despliega
# Entradas: FEL_DEMO_PROYECTO_REF (debe ser exactamente la de nexa-demo), SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD, y para «funcion»: FEL_DEMO_BD_URL, FEL_DEMO_HOSTS, FEL_DEMO_MFA_SEMILLAS, FEL_PROXY_SECRETO.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=tools/destinos-demo.sh
source tools/destinos-demo.sh
REF="${FEL_DEMO_PROYECTO_REF:-}"
[[ "$REF" =~ ^[a-z0-9]{20}$ ]] && [ "$REF" = "$REF_ESPERADA" ] || { echo "PROHIBIDO: la referencia no es la del proyecto nexa-demo ($REF_ESPERADA). No se hace nada."; exit 2; }
case "${1:-}" in
  migraciones)
    supabase link --project-ref "$REF" --workdir . >/dev/null
    supabase db push --remote="$REF" --yes --workdir .;;
  funcion)
    for v in FEL_DEMO_BD_URL FEL_DEMO_HOSTS FEL_DEMO_MFA_SEMILLAS FEL_PROXY_SECRETO; do [ -n "${!v:-}" ] || { echo "Falta $v"; exit 2; }; done
    ENVF="$(mktemp)"; chmod 600 "$ENVF"; trap 'rm -f "$ENVF"' EXIT
    { echo "FEL_DEMO_BD_URL=$FEL_DEMO_BD_URL"; echo "FEL_DEMO_HOSTS=$FEL_DEMO_HOSTS"; echo "FEL_DEMO_MFA_SEMILLAS=$FEL_DEMO_MFA_SEMILLAS"; echo "FEL_PROXY_SECRETO=$FEL_PROXY_SECRETO"; } > "$ENVF"
    supabase secrets set --env-file "$ENVF" --remote="$REF" --yes >/dev/null
    supabase functions deploy nexa-demo --remote="$REF" --yes --no-verify-jwt --workdir dist/nube/funcion;;
  *) echo "Uso: supabase-hospedado.sh migraciones|funcion"; exit 2;;
esac
