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
# DESTINOS FIJOS: este script solo puede tocar el proyecto Supabase «nexa-demo» y el proyecto de Pages «nexa-fel-demo» (la referencia no es un secreto).
source tools/destinos-demo.sh
[ -z "${FEL_DEMO_PROYECTO_REF:-}" ] || [ "$FEL_DEMO_PROYECTO_REF" = "$REF_ESPERADA" ] || { echo "PROHIBIDO: FEL_DEMO_PROYECTO_REF no es la referencia del proyecto nexa-demo ($REF_ESPERADA). No se hace nada."; exit 2; }
[ -z "${PAGES_PROYECTO:-}" ] || [ "$PAGES_PROYECTO" = "$PAGES_ESPERADO" ] || { echo "PROHIBIDO: PAGES_PROYECTO debe ser exactamente $PAGES_ESPERADO. No se hace nada."; exit 2; }
case "${PAGES_PROYECTO:-}" in nexa|nexacorp) echo "PROHIBIDO: «$PAGES_PROYECTO» es un proyecto principal de NEXA (la demostración usa nexa-fel-demo)"; exit 2;; esac
comprobar_cli() { # la CLI cambia entre versiones: se comprueba, SIN ejecutar nada, que existen los comandos y las opciones que este script usa
  command -v supabase >/dev/null || { echo "(CLI de Supabase no instalada aquí: no se comprueban sus opciones)"; return 0; }
  local mal=0 c f; echo "CLI de Supabase $(supabase --version 2>/dev/null | head -1): comprobando opciones…"
  for par in "link|--project-ref" "db push|--remote" "db push|--yes" "db push|--dry-run" "secrets set|--env-file" "secrets set|--remote" "secrets set|--yes" "functions deploy|--remote" "functions deploy|--yes" "functions deploy|--no-verify-jwt"; do
    c="${par%%|*}"; f="${par##*|}"
    if supabase $c --help 2>&1 | grep -q -- "$f"; then echo "  OK  supabase $c $f"; else echo "  FALLO supabase $c ya no admite $f"; mal=1; fi
  done
  supabase --help 2>&1 | grep -q -- "--workdir" && echo "  OK  --workdir (global)" || { supabase db push --help 2>&1 | grep -q -- "--workdir" && echo "  OK  --workdir" || { echo "  FALLO falta --workdir"; mal=1; }; }
  return $mal
}
REF="${FEL_DEMO_PROYECTO_REF:-<ref>}"; PAGES_PROYECTO="${PAGES_PROYECTO:-<nombre>}"; export FEL_DEMO_HOSTS="${FEL_DEMO_HOSTS:-${PAGES_PROYECTO}.pages.dev}"
paso() { echo; echo "== $1"; }
if [ "$SIMULAR" = 1 ]; then cat <<PLAN
PLAN (simulación: no se ejecuta nada)
 1. Protección: la referencia ($REF) debe coincidir con la URL de Supabase y con la conexión a la base; el proyecto de Pages solo puede llamarse nexa-fel-demo (nunca nexa ni nexacorp).
 2. Cloudflare Pages: si el proyecto $PAGES_PROYECTO no existe se CREA con Wrangler (se verifica por la API); si existe se reutiliza; se toma su subdominio real (tools/pages-proyecto.sh)
 3. supabase link --project-ref $REF  ·  supabase db push --remote=<Session Pooler, puerto 5432, IPv4> --yes   (migraciones aditivas al proyecto NUEVO; la URL se deriva de DEMO_BD_URL y se valida: usuario postgres.$REF, host *.pooler.supabase.com)
 4. deno run -A demo-facturacion/nube/aprovisionar.ts      (siembra la base y crea los usuarios con la API de Supabase Auth; guarda solo hashes)
 5. deno run -A demo-facturacion/nube/construir.ts         (dist/nube/pagina con _worker.js + _routes.json, dist/nube/funcion)
 6. supabase secrets set --remote=$REF --yes (archivo temporal 600)  ·  supabase functions deploy nexa-demo --remote=$REF --yes --no-verify-jwt
 7. wrangler pages secret put FUNCION_URL / PROXY_SECRETO  ·  wrangler pages deploy dist/nube/pagina
 8. Prueba de humo contra el subdominio real (inicio de sesión, MFA, factura, certificación simulada, PDF, persistencia)
PLAN
  comprobar_cli || { echo "La CLI instalada no es compatible con este script: corrígelo antes de publicar."; exit 1; }
  if [ ${#falta[@]} -eq 0 ] && [ ${#herr[@]} -eq 0 ]; then
    echo; echo "== Comprobación de la cadena de conexión y prueba de conectividad de SOLO LECTURA (db push --dry-run por el Session Pooler IPv4: lista las migraciones pendientes, NO aplica nada)"
    bash tools/supabase-hospedado.sh validar || { echo "La cadena de conexión no es válida: no se publicará hasta corregirla."; exit 1; }
    bash tools/supabase-hospedado.sh conexion || { echo "La prueba de conectividad por el Session Pooler falló: no se publicará hasta resolverla."; exit 1; }
  else echo "(faltan variables o herramientas: se omite la prueba de conectividad)"; fi
  exit 0; fi

comprobar_cli || { echo "La CLI instalada no es compatible con este script. No se hace nada."; exit 1; }
paso "1/8 · comprobaciones previas"
case "$SUPABASE_URL" in "https://$REF.supabase.co") ;; *) echo "SUPABASE_URL no corresponde a FEL_DEMO_PROYECTO_REF"; exit 1;; esac
case "$FEL_DEMO_BD_URL" in *"$REF"*) ;; *) echo "FEL_DEMO_BD_URL no pertenece al proyecto indicado"; exit 1;; esac
bash tools/supabase-hospedado.sh validar   # el pooler compartido de ESTE proyecto, sin parámetros; si no, se detiene aquí sin tocar nada
echo "OK"
paso "2/8 · Cloudflare Pages: crear (con Wrangler) o reutilizar el proyecto $PAGES_PROYECTO"
SALIDA_PAGES="$(bash tools/pages-proyecto.sh)"; echo "$SALIDA_PAGES" | grep -v '^HOST='
FEL_DEMO_HOSTS="$(echo "$SALIDA_PAGES" | sed -n 's/^HOST=//p' | tail -1)"; [ -n "$FEL_DEMO_HOSTS" ] || { echo "No se obtuvo el subdominio del proyecto"; exit 1; }; export FEL_DEMO_HOSTS
echo "Dirección pública: https://$FEL_DEMO_HOSTS"
paso "3/8 · migraciones (proyecto nuevo y exclusivo)"
bash tools/supabase-hospedado.sh migraciones
paso "4/8 · aprovisionar base y usuarios"
( cd demo-facturacion && deno run -A nube/aprovisionar.ts )
paso "5/8 · construir"
( cd demo-facturacion && deno run -A nube/construir.ts )
paso "6/8 · función de Supabase"
bash tools/supabase-hospedado.sh funcion
paso "7/8 · Cloudflare Pages: secretos y página (Wrangler)"
WR=(npx --yes wrangler@4)
printf '%s' "https://$REF.supabase.co/functions/v1/nexa-demo" | "${WR[@]}" pages secret put FUNCION_URL --project-name "$PAGES_PROYECTO" >/dev/null
printf '%s' "$FEL_PROXY_SECRETO" | "${WR[@]}" pages secret put PROXY_SECRETO --project-name "$PAGES_PROYECTO" >/dev/null
"${WR[@]}" pages deploy dist/nube/pagina --project-name "$PAGES_PROYECTO" --branch main --commit-dirty=true
paso "8/8 · prueba de humo contra https://$FEL_DEMO_HOSTS"
sleep 10
( cd demo-facturacion && FEL_DEMO_URL="https://$FEL_DEMO_HOSTS" deno run -A nube/prueba_humo.ts )
echo; echo "LISTO: https://$FEL_DEMO_HOSTS (privada: solo entra quien tenga una cuenta). Siguiente: probarla desde el teléfono."
