#!/usr/bin/env bash
# Publicación PRIVADA de NEXA FEL (demostración SIMULADA): Supabase (migraciones, base, función) + Cloudflare Pages (con Wrangler) + prueba de humo.
# Se ejecuta solo con tu autorización y desde un equipo donde TÚ pones las claves como variables de entorno (nunca se imprimen ni van en argumentos de comandos).
#   bash tools/publicar-nube.sh --simular     comprueba variables y herramientas y muestra el plan, sin tocar nada
#   bash tools/publicar-nube.sh               ejecuta todo en orden y se detiene en el primer fallo
# Variables (todas obligatorias):
#   FEL_DEMO_PROYECTO_REF      referencia del proyecto Supabase NUEVO y exclusivo (las letras de https://<ref>.supabase.co)
#   SUPABASE_ACCESS_TOKEN      token personal de Supabase (Account → Access Tokens)
#   SUPABASE_DB_PASSWORD       contraseña de la base del proyecto
#   FEL_DEMO_BD_URL            cadena del «Transaction pooler» (puerto 6543)
#   SUPABASE_URL               https://<ref>.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY  clave service_role del proyecto
#   FEL_DEMO_CLAVES, FEL_DEMO_MFA_SEMILLAS   salida de «deno run src/generar_secretos.ts»
#   FEL_PROXY_SECRETO          secreto largo que une Cloudflare con la función (openssl rand -hex 32)
#   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID   token de API con permiso «Cloudflare Pages: Edit» y el id de tu cuenta
#   PAGES_PROYECTO             nombre del proyecto de Pages (la página será https://<nombre>.pages.dev)
set -euo pipefail
cd "$(dirname "$0")/.."
SIMULAR=0; [ "${1:-}" = "--simular" ] && SIMULAR=1
OBLIG=(FEL_DEMO_PROYECTO_REF SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD FEL_DEMO_BD_URL SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY FEL_DEMO_CLAVES FEL_DEMO_MFA_SEMILLAS FEL_PROXY_SECRETO CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID PAGES_PROYECTO)
falta=(); for v in "${OBLIG[@]}"; do [ -n "${!v:-}" ] || falta+=("$v"); done
herr=(); for h in deno node npx supabase jq curl; do command -v "$h" >/dev/null || herr+=("$h"); done
if [ ${#falta[@]} -gt 0 ] || [ ${#herr[@]} -gt 0 ]; then
  [ ${#falta[@]} -gt 0 ] && echo "Faltan variables: ${falta[*]}"; [ ${#herr[@]} -gt 0 ] && echo "Faltan herramientas: ${herr[*]}"
  [ "$SIMULAR" = 1 ] || exit 1
fi
case "${PAGES_PROYECTO:-}" in nexa|nexacorp) echo "PROHIBIDO: «$PAGES_PROYECTO» es un proyecto principal de NEXA (la demostración usa nexa-fel-demo)"; exit 2;; esac
[ -z "${PAGES_PROYECTO:-}" ] || [[ "$PAGES_PROYECTO" =~ ^nexa-fel-demo(-[a-z0-9]+)?$ ]] || { echo "PAGES_PROYECTO no permitido: debe ser nexa-fel-demo"; exit 2; }
REF="${FEL_DEMO_PROYECTO_REF:-<ref>}"; PAGES_PROYECTO="${PAGES_PROYECTO:-<nombre>}"; export FEL_DEMO_HOSTS="${FEL_DEMO_HOSTS:-${PAGES_PROYECTO}.pages.dev}"
paso() { echo; echo "== $1"; }
if [ "$SIMULAR" = 1 ]; then cat <<PLAN
PLAN (simulación: no se ejecuta nada)
 1. Protección: la referencia ($REF) debe coincidir con la URL de Supabase y con la conexión a la base; el proyecto de Pages solo puede llamarse nexa-fel-demo (nunca nexa ni nexacorp).
 2. Cloudflare Pages: si el proyecto $PAGES_PROYECTO no existe se CREA con Wrangler (se verifica por la API); si existe se reutiliza; se toma su subdominio real (tools/pages-proyecto.sh)
 3. supabase link --project-ref $REF  ·  supabase db push   (migraciones aditivas al proyecto NUEVO)
 4. deno run -A demo-facturacion/nube/aprovisionar.ts      (siembra la base y crea los usuarios con la API de Supabase Auth; guarda solo hashes)
 5. deno run -A demo-facturacion/nube/construir.ts         (dist/nube/pagina con _worker.js + _routes.json, dist/nube/funcion)
 6. supabase secrets set (archivo temporal 600)  ·  supabase functions deploy nexa-demo --no-verify-jwt
 7. wrangler pages secret put FUNCION_URL / PROXY_SECRETO  ·  wrangler pages deploy dist/nube/pagina
 8. Prueba de humo contra el subdominio real (inicio de sesión, MFA, factura, certificación simulada, PDF, persistencia)
PLAN
  exit 0; fi

paso "1/8 · comprobaciones previas"
case "$SUPABASE_URL" in "https://$REF.supabase.co") ;; *) echo "SUPABASE_URL no corresponde a FEL_DEMO_PROYECTO_REF"; exit 1;; esac
case "$FEL_DEMO_BD_URL" in *"$REF"*) ;; *) echo "FEL_DEMO_BD_URL no pertenece al proyecto indicado"; exit 1;; esac
echo "OK"
paso "2/8 · Cloudflare Pages: crear (con Wrangler) o reutilizar el proyecto $PAGES_PROYECTO"
SALIDA_PAGES="$(bash tools/pages-proyecto.sh)"; echo "$SALIDA_PAGES" | grep -v '^HOST='
FEL_DEMO_HOSTS="$(echo "$SALIDA_PAGES" | sed -n 's/^HOST=//p' | tail -1)"; [ -n "$FEL_DEMO_HOSTS" ] || { echo "No se obtuvo el subdominio del proyecto"; exit 1; }; export FEL_DEMO_HOSTS
echo "Dirección pública: https://$FEL_DEMO_HOSTS"
paso "3/8 · migraciones (proyecto nuevo y exclusivo)"
supabase link --project-ref "$REF" --workdir . >/dev/null
supabase db push --workdir . --yes
paso "4/8 · aprovisionar base y usuarios"
( cd demo-facturacion && deno run -A nube/aprovisionar.ts )
paso "5/8 · construir"
( cd demo-facturacion && deno run -A nube/construir.ts )
paso "6/8 · función de Supabase"
ENVF="$(mktemp)"; chmod 600 "$ENVF"; trap 'rm -f "$ENVF"' EXIT
{ echo "FEL_DEMO_BD_URL=$FEL_DEMO_BD_URL"; echo "FEL_DEMO_HOSTS=$FEL_DEMO_HOSTS"; echo "FEL_DEMO_MFA_SEMILLAS=$FEL_DEMO_MFA_SEMILLAS"; echo "FEL_PROXY_SECRETO=$FEL_PROXY_SECRETO"; } > "$ENVF"
supabase secrets set --project-ref "$REF" --env-file "$ENVF" >/dev/null
supabase functions deploy nexa-demo --project-ref "$REF" --workdir dist/nube/funcion --no-verify-jwt
rm -f "$ENVF"
paso "7/8 · Cloudflare Pages: secretos y página (Wrangler)"
WR=(npx --yes wrangler@4)
printf '%s' "https://$REF.supabase.co/functions/v1/nexa-demo" | "${WR[@]}" pages secret put FUNCION_URL --project-name "$PAGES_PROYECTO" >/dev/null
printf '%s' "$FEL_PROXY_SECRETO" | "${WR[@]}" pages secret put PROXY_SECRETO --project-name "$PAGES_PROYECTO" >/dev/null
"${WR[@]}" pages deploy dist/nube/pagina --project-name "$PAGES_PROYECTO" --branch main --commit-dirty=true
paso "8/8 · prueba de humo contra https://$FEL_DEMO_HOSTS"
sleep 10
( cd demo-facturacion && FEL_DEMO_URL="https://$FEL_DEMO_HOSTS" deno run -A nube/prueba_humo.ts )
echo; echo "LISTO: https://$FEL_DEMO_HOSTS (privada: solo entra quien tenga una cuenta). Siguiente: probarla desde el teléfono."
