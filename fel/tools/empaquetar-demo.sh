#!/usr/bin/env bash
# Empaqueta la DEMOSTRACIÓN de facturación individual simulada (solo lo confirmado en git) en un ZIP autosuficiente. Uso: bash fel/tools/empaquetar-demo.sh [carpeta_de_salida]
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
git diff --quiet HEAD -- fel || { echo "Hay cambios sin confirmar en fel/: haz commit antes de empaquetar (el ZIP debe corresponder a un commit)"; exit 1; }
sha=$(git rev-parse --short HEAD); rama=$(git rev-parse --abbrev-ref HEAD); out=${1:-/tmp}; nombre="NEXA-FEL-Demo-Facturacion-Simulada-${sha}"
tmp=$(mktemp -d); raiz="$tmp/NEXA-FEL-Demo"; mkdir -p "$raiz"
git archive HEAD fel/demo-facturacion fel/proveedores/src fel/proveedores/deno.json fel/supabase/migrations fel/supabase/functions/fel-api/lib/calculo.ts fel/supabase/functions/fel-api/lib/errores.ts \
  fel/tools/shim_supabase.sql fel/app/css/fel.css fel/app/js/ui.js fel/app/js/icons.js fel/app/js/calculo.js fel/app/js/formato.js \
  fel/docs/matriz-estados.md fel/docs/saas-decisiones-arquitectura.md fel/docs/saas-proveedores-diseno.md fel/docs/saas-plan-implementacion.md fel/docs/saas-fase-2-informe.md | tar -x -C "$raiz"
if find "$raiz" \( -name node_modules -o -name '*.local.json' -o -name '.env*' \) | grep -q .; then echo "El paquete contiene archivos que no deben viajar"; exit 1; fi
{ echo "NEXA FEL — Demostración de facturación individual SIMULADA (rama $rama, commit $sha)"; echo "Generado: $(date -u +%Y-%m-%dT%H:%M:%SZ)"; echo "TODO es simulado: sin credenciales, sin SAT, sin certificadores, SIN VALOR FISCAL."; } > "$raiz/VERSION.txt"
printf 'NEXA FEL - Demostracion SIMULADA. Lee fel\\demo-facturacion\\README.md y haz doble clic en fel\\demo-facturacion\\INICIAR-DEMO.cmd\r\nNecesita Deno (gratuito): winget install DenoLand.Deno\r\n' > "$raiz/LEEME-PRIMERO.txt"
(cd "$tmp" && zip -rq "$out/$nombre.zip" NEXA-FEL-Demo)
echo "ZIP: $out/$nombre.zip"; sha256sum "$out/$nombre.zip"; unzip -l "$out/$nombre.zip" | tail -1
rm -rf "$tmp"
