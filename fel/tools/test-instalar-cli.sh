#!/usr/bin/env bash
# Prueba (sin red externa) del plan B de instalación de la CLI de Supabase: huella verificada, huella fija, rechazo ante huella incorrecta y ante paquete alterado.
set -uo pipefail
S="$(cd "$(dirname "$0")/.." && pwd)/../.github/actions/supabase-cli/instalar.sh"; W=$(mktemp -d); PUERTO=${PUERTO:-8899}; fallos=0
trap 'kill $SRV 2>/dev/null || true; rm -rf "$W"' EXIT
mkdir -p "$W/rel/latest/download" "$W/rel/download/v9.9.9" "$W/pk"; printf '#!/bin/sh\necho "9.9.9"\n' > "$W/pk/supabase"; chmod +x "$W/pk/supabase"
tar -czf "$W/supabase_linux_amd64.tar.gz" -C "$W/pk" supabase; cp "$W/supabase_linux_amd64.tar.gz" "$W/rel/latest/download/"; cp "$W/supabase_linux_amd64.tar.gz" "$W/rel/download/v9.9.9/"
H=$(sha256sum "$W/supabase_linux_amd64.tar.gz" | awk '{print $1}'); echo "$H  supabase_linux_amd64.tar.gz" > "$W/rel/download/v9.9.9/supabase_9.9.9_checksums.txt"
(cd "$W/rel" && exec python3 -m http.server "$PUERTO" --bind 127.0.0.1 >/dev/null 2>&1) & SRV=$!; sleep 1
corre() { RUNNER_TEMP="$W/$1" BASE="http://127.0.0.1:$PUERTO" "${@:2}" bash -c "mkdir -p \$RUNNER_TEMP; bash '$S'" >"$W/$1.log" 2>&1; }
esperar() { local nombre="$1" esperado="$2" real="$3"; if [ "$esperado" = "$real" ] || { [ "$esperado" = fallo ] && [ "$real" != 0 ]; }; then echo "OK    $nombre"; else echo "FALLO $nombre (código $real, se esperaba $esperado)"; cat "$W/$4.log" 2>/dev/null; fallos=$((fallos+1)); fi; }
corre t1 env; esperar "latest con sumas publicadas por el lanzamiento" 0 $? t1; [ -x "$W/t1/sbbin/supabase" ] || { echo "FALLO no quedó instalado"; fallos=$((fallos+1)); }
corre t2 env VERSION=9.9.9 SHA256="$H"; esperar "versión fija con huella fija correcta" 0 $? t2
corre t3 env VERSION=9.9.9 SHA256="$(printf 'a%.0s' $(seq 64))"; esperar "huella fija incorrecta se rechaza" fallo $? t3; [ ! -e "$W/t3/sbbin/supabase" ] || { echo "FALLO se instaló con huella incorrecta"; fallos=$((fallos+1)); }
printf 'xx' >> "$W/rel/latest/download/supabase_linux_amd64.tar.gz"
corre t4 env; esperar "paquete alterado se rechaza" fallo $? t4; [ ! -e "$W/t4/sbbin/supabase" ] || { echo "FALLO se instaló un paquete alterado"; fallos=$((fallos+1)); }
# alterado pero todavía extraíble (otro contenido, mismas sumas publicadas): la huella lo detecta
mkdir -p "$W/pk2" && printf '#!/bin/sh\necho "9.9.9"\necho malicioso\n' > "$W/pk2/supabase" && chmod +x "$W/pk2/supabase" && tar -czf "$W/rel/latest/download/supabase_linux_amd64.tar.gz" -C "$W/pk2" supabase
corre t5 env; esperar "paquete distinto con las sumas del original se rechaza" fallo $? t5; [ ! -e "$W/t5/sbbin/supabase" ] || { echo "FALLO se instaló un paquete distinto"; fallos=$((fallos+1)); }
[ "$fallos" = 0 ] && echo "INSTALACIÓN DE LA CLI (PLAN B) OK" || { echo "$fallos fallo(s)"; exit 1; }
