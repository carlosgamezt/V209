#!/usr/bin/env bash
# Plan B de instalación de la CLI de Supabase: descarga directa (sin la API de GitHub) con reintentos y VERIFICACIÓN DE INTEGRIDAD (SHA-256) antes de instalar.
# Entradas por entorno: VERSION (latest o x.y.z), SHA256 (opcional: huella fija), BASE (por defecto el repositorio oficial de lanzamientos), DESTINO (carpeta del binario).
set -euo pipefail
V="${VERSION:-latest}"; BASE="${BASE:-https://github.com/supabase/cli/releases}"; TMP="${RUNNER_TEMP:-/tmp}"; DESTINO="${DESTINO:-$TMP/sbbin}"
if [ "$V" = latest ]; then URL="$BASE/latest/download/supabase_linux_amd64.tar.gz"; else URL="$BASE/download/v${V#v}/supabase_linux_amd64.tar.gz"; fi
rm -f "$TMP/supabase.tgz"
for i in 1 2 3 4 5; do curl -fsSL --retry 3 --retry-delay 3 -o "$TMP/supabase.tgz" "$URL" && break || { echo "intento $i falló"; sleep $((i*5)); }; done
test -s "$TMP/supabase.tgz" || { echo "No se pudo descargar la CLI"; exit 1; }
ESPERADA="${SHA256:-}"
if [ -z "$ESPERADA" ]; then
  mkdir -p "$TMP/sbprobe" && tar -xzf "$TMP/supabase.tgz" -C "$TMP/sbprobe" supabase
  VER="$("$TMP/sbprobe/supabase" --version | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"; test -n "$VER"
  curl -fsSL --retry 5 --retry-delay 3 -o "$TMP/sumas.txt" "$BASE/download/v${VER}/supabase_${VER}_checksums.txt"
  ESPERADA="$(grep -E ' supabase_linux_amd64\.tar\.gz$' "$TMP/sumas.txt" | awk '{print $1}' | head -1)"
fi
test -n "$ESPERADA" || { echo "No se pudo obtener la huella esperada: no se instala"; exit 1; }
echo "$ESPERADA  $TMP/supabase.tgz" | sha256sum -c - || { echo "La huella NO coincide: no se instala"; exit 1; }
mkdir -p "$DESTINO" && tar -xzf "$TMP/supabase.tgz" -C "$DESTINO" supabase
[ -n "${GITHUB_PATH:-}" ] && echo "$DESTINO" >> "$GITHUB_PATH"
"$DESTINO/supabase" --version
