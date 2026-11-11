#!/usr/bin/env bash
# Empaqueta la PoC (SOLO lo confirmado en git) en un ZIP para Windows. Uso: bash fel/tools/empaquetar-poc.sh [carpeta_de_salida]
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
git diff --quiet HEAD -- fel || { echo "Hay cambios sin confirmar en fel/: haz commit antes de empaquetar (el ZIP debe corresponder a un commit)"; exit 1; }
sha=$(git rev-parse --short HEAD); rama=$(git rev-parse --abbrev-ref HEAD); out=${1:-/tmp}; nombre="NEXA-FEL-PoC-${rama}-${sha}"
tmp=$(mktemp -d); raiz="$tmp/NEXA-FEL-PoC"; mkdir -p "$raiz"
docs=(prueba-viabilidad-portal-sat gestion-sesion-sat fase-2-observacion-portal-real fase-2-analisis-observacion-1 fase-2-informe-sat-2a fase-2-prueba-simulada-angular fase-2-sat-2d-preparacion informe-viabilidad-fase-2 fase-3-procedimiento-llenado-en-seco fase-3-etapa-1-procedimiento fase-3-etapa-2-diseno fase-3-etapa-2-validacion-local fase-3-etapa-2a-auditoria-final fase-3-observacion-o1-o2)
git archive HEAD fel/poc-sat $(for d in "${docs[@]}"; do echo "fel/docs/$d.md"; done) | tar -x -C "$raiz"
# nada que no deba viajar
if find "$raiz" \( -name node_modules -o -name observaciones -o -name registros -o -name perfiles -o -name '*.local.json' -o -name 'mapeo.local*' -o -name '.env*' -o -name 'consola.json' -o -name 'sat-2*.json' -o -name '*.har' \) | grep -q .; then echo "El paquete contiene archivos prohibidos"; exit 1; fi
{ echo "NEXA FEL — PoC del formulario FEL (rama $rama, commit $sha)"; echo "Generado: $(date -u +%Y-%m-%dT%H:%M:%SZ)"; echo "ETAPA 0: sin SAT. Etapas 1 y 2 NO autorizadas."; echo; echo "SHA-256 de los fragmentos de consola (nº 2 retirado: no usar):"
  for n in observar-consola.js observar-consola-2.js observar-consola-3.js observar-consola-4.js; do echo "$n  $(sha256sum "$raiz/fel/poc-sat/consola/$n" | cut -d' ' -f1)"; done; } > "$raiz/VERSION.txt"
printf 'NEXA FEL — PoC. Lee primero fel\\poc-sat\\INSTALAR-WINDOWS.md\r\nEtapa 0: todo es local y simulado; no se toca SAT.\r\n' > "$raiz/LEEME-PRIMERO.txt"
(cd "$tmp" && zip -rq "$out/$nombre.zip" NEXA-FEL-PoC)
echo "ZIP: $out/$nombre.zip"; sha256sum "$out/$nombre.zip"; unzip -l "$out/$nombre.zip" | tail -1
rm -rf "$tmp"
