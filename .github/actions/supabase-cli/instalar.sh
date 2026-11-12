#!/usr/bin/env bash
# Instalación de la CLI de Supabase sin depender de que la API de GitHub acepte llamadas ANÓNIMAS (desde los ejecutores compartidos devuelve «rate limit exceeded»):
#   · las consultas a la API de lanzamientos llevan el token del propio flujo de trabajo (GITHUB_TOKEN), que tiene su propio cupo;
#   · el paquete se descarga del enlace del lanzamiento y se VERIFICA con su SHA-256 antes de instalarlo: huella fija (SHA256), o la que el lanzamiento publica para ese archivo
#     («digest» de la API; si no existiera, el archivo de sumas del lanzamiento). Sin huella verificada no se instala nada.
# Modos:  resolver  → imprime la versión exacta a instalar (para fijarla en la acción oficial)  ·  instalar (por defecto)
# Entradas por entorno: VERSION (latest o x.y.z), SHA256 (opcional), GITHUB_TOKEN (opcional), API (por defecto https://api.github.com/repos/supabase/cli/releases), DESTINO.
set -euo pipefail
MODO="${1:-instalar}"; V="${VERSION:-latest}"; API="${API:-https://api.github.com/repos/supabase/cli/releases}"; TMP="${RUNNER_TEMP:-/tmp}"; DESTINO="${DESTINO:-$TMP/sbbin}"
AUTH=(); [ -n "${GITHUB_TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
if [ "$V" = latest ]; then RUTA="$API/latest"; else RUTA="$API/tags/v${V#v}"; fi
consulta() { local j; for i in 1 2 3 4 5; do j="$(curl -fsSL --retry 2 --retry-delay 3 -H 'Accept: application/vnd.github+json' "${AUTH[@]}" "$RUTA")" && { printf '%s' "$j"; return 0; }; echo "consulta $i falló" >&2; sleep $((i*5)); done; return 1; }
JSON="$(consulta)" || { echo "No se pudo consultar el lanzamiento de la CLI"; exit 1; }
TAG="$(printf '%s' "$JSON" | jq -r '.tag_name')"; VER="${TAG#v}"; [[ "$VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Versión no reconocida: $TAG"; exit 1; }
if [ "$MODO" = resolver ]; then echo "$VER"; exit 0; fi
ACTIVO='supabase_linux_amd64.tar.gz'
URL="$(printf '%s' "$JSON" | jq -r --arg n "$ACTIVO" '.assets[] | select(.name==$n) | .browser_download_url')"; test -n "$URL" || { echo "El lanzamiento no trae $ACTIVO"; exit 1; }
rm -f "$TMP/supabase.tgz"
for i in 1 2 3 4 5; do curl -fsSL --retry 3 --retry-delay 3 -o "$TMP/supabase.tgz" "$URL" && break || { echo "descarga $i falló"; sleep $((i*5)); }; done
test -s "$TMP/supabase.tgz" || { echo "No se pudo descargar la CLI"; exit 1; }
ESPERADA="${SHA256:-}"
if [ -z "$ESPERADA" ]; then ESPERADA="$(printf '%s' "$JSON" | jq -r --arg n "$ACTIVO" '.assets[] | select(.name==$n) | .digest // empty' | sed 's/^sha256://')"; fi
if [ -z "$ESPERADA" ]; then
  SUMAS="$(printf '%s' "$JSON" | jq -r '[.assets[] | select(.name | test("checksum"; "i")) | .browser_download_url][0] // empty')"
  [ -n "$SUMAS" ] && curl -fsSL --retry 5 --retry-delay 3 -o "$TMP/sumas.txt" "$SUMAS" && ESPERADA="$(grep -E " \*?${ACTIVO}\$" "$TMP/sumas.txt" | awk '{print $1}' | head -1)"
fi
test -n "$ESPERADA" || { echo "No se pudo obtener la huella esperada: no se instala"; exit 1; }
echo "$ESPERADA  $TMP/supabase.tgz" | sha256sum -c - || { echo "La huella NO coincide: no se instala"; exit 1; }
mkdir -p "$DESTINO" && tar -xzf "$TMP/supabase.tgz" -C "$DESTINO" supabase
[ -n "${GITHUB_PATH:-}" ] && echo "$DESTINO" >> "$GITHUB_PATH"
echo "CLI de Supabase $VER instalada (SHA-256 $ESPERADA)"; "$DESTINO/supabase" --version
