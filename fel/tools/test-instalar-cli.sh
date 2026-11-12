#!/usr/bin/env bash
# Prueba (sin red externa) de la instalación de la CLI de Supabase: API de lanzamientos simulada en 127.0.0.1. Comprueba la resolución de versión, la verificación SHA-256
# (huella publicada por el lanzamiento, archivo de sumas o huella fija) y el rechazo de huella incorrecta, paquete alterado, falta de huella y API caída.
set -uo pipefail
S="$(cd "$(dirname "$0")/../.." && pwd)/.github/actions/supabase-cli/instalar.sh"; W=$(mktemp -d); PUERTO=${PUERTO:-8899}; fallos=0
trap 'kill $SRV 2>/dev/null || true; rm -rf "$W"' EXIT
mkdir -p "$W/srv/dl" "$W/srv/repos" "$W/pk"; printf '#!/bin/sh\necho "9.9.9"\n' > "$W/pk/supabase"; chmod +x "$W/pk/supabase"
tar -czf "$W/srv/dl/supabase_linux_amd64.tar.gz" -C "$W/pk" supabase; H=$(sha256sum "$W/srv/dl/supabase_linux_amd64.tar.gz" | awk '{print $1}')
echo "$H  supabase_linux_amd64.tar.gz" > "$W/srv/dl/supabase_9.9.9_checksums.txt"
U="http://127.0.0.1:$PUERTO"
json() { # $1 = con_digest | con_sumas | sin_nada
  local a="{\"name\":\"supabase_linux_amd64.tar.gz\",\"browser_download_url\":\"$U/dl/supabase_linux_amd64.tar.gz\"$([ "$1" = con_digest ] && echo ",\"digest\":\"sha256:$H\"")}"
  local s=""; [ "$1" = con_sumas ] && s=",{\"name\":\"supabase_9.9.9_checksums.txt\",\"browser_download_url\":\"$U/dl/supabase_9.9.9_checksums.txt\"}"
  echo "{\"tag_name\":\"v9.9.9\",\"assets\":[$a$s]}"; }
publicar() { json "$1" > "$W/srv/repos/latest"; mkdir -p "$W/srv/repos/tags"; cp "$W/srv/repos/latest" "$W/srv/repos/tags/v9.9.9"; }
publicar con_digest
(cd "$W/srv" && exec python3 -m http.server "$PUERTO" --bind 127.0.0.1 >/dev/null 2>&1) & SRV=$!; sleep 1
corre() { local n="$1"; shift; RUNNER_TEMP="$W/$n" API="$U/repos" GITHUB_TOKEN=prueba "$@" bash -c "mkdir -p \$RUNNER_TEMP; bash '$S' \${MODO:-}" >"$W/$n.log" 2>&1; }
ok() { echo "OK    $1"; }; mal() { echo "FALLO $1"; cat "$W/$2.log" 2>/dev/null | tail -5; fallos=$((fallos+1)); }
corre t1 env; [ $? = 0 ] && [ -x "$W/t1/sbbin/supabase" ] && ok "latest con la huella publicada por el lanzamiento" || mal "latest con huella publicada" t1
corre t2 env VERSION=9.9.9 SHA256="$H"; [ $? = 0 ] && ok "versión fija con huella fija correcta" || mal "versión fija" t2
corre t3 env VERSION=9.9.9 SHA256="$(printf 'a%.0s' $(seq 64))"; [ $? != 0 ] && [ ! -e "$W/t3/sbbin/supabase" ] && ok "huella fija incorrecta se rechaza" || mal "huella incorrecta aceptada" t3
corre t7 env MODO=resolver; [ "$(tail -1 "$W/t7.log")" = 9.9.9 ] && ok "resolver imprime la versión exacta" || mal "resolver" t7
publicar con_sumas; corre t5 env; [ $? = 0 ] && ok "sin «digest»: usa el archivo de sumas del lanzamiento" || mal "archivo de sumas" t5
publicar sin_nada; corre t6 env; [ $? != 0 ] && [ ! -e "$W/t6/sbbin/supabase" ] && ok "sin ninguna huella publicada no se instala" || mal "se instaló sin huella" t6
publicar con_digest; printf 'xx' >> "$W/srv/dl/supabase_linux_amd64.tar.gz"
corre t4 env; [ $? != 0 ] && [ ! -e "$W/t4/sbbin/supabase" ] && ok "paquete alterado se rechaza" || mal "paquete alterado aceptado" t4
mkdir -p "$W/pk2" && printf '#!/bin/sh\necho malicioso\n' > "$W/pk2/supabase" && chmod +x "$W/pk2/supabase" && tar -czf "$W/srv/dl/supabase_linux_amd64.tar.gz" -C "$W/pk2" supabase
corre t8 env; [ $? != 0 ] && [ ! -e "$W/t8/sbbin/supabase" ] && ok "paquete distinto (extraíble) con la huella del original se rechaza" || mal "paquete distinto aceptado" t8
kill $SRV 2>/dev/null; sleep 1; RUNNER_TEMP="$W/t9" API="$U/repos" bash -c "mkdir -p \$RUNNER_TEMP; sleep 0; timeout 20 bash '$S'" >"$W/t9.log" 2>&1; [ $? != 0 ] && ok "API caída: falla sin instalar" || mal "API caída" t9
[ "$fallos" = 0 ] && echo "INSTALACIÓN DE LA CLI OK" || { echo "$fallos fallo(s)"; exit 1; }
