#!/usr/bin/env bash
# Prueba de humo del ejecutable autónomo: arranca, sirve la interfaz y el manifiesto, inicia sesión, consulta el plan y rechaza datos sin sesión.
set -euo pipefail
BIN="$1"; PUERTO=$((9100 + RANDOM % 500)); chmod +x "$BIN"
FEL_AGENTE_SUPERVISOR_MS=60000 "$BIN" --puerto=$PUERTO > /tmp/paquete.log 2>&1 &
PID=$!; trap 'kill $PID 2>/dev/null || true' EXIT
for i in $(seq 1 120); do grep -q "Supervisor de órdenes iniciado" /tmp/paquete.log 2>/dev/null && break; sleep 1; done
grep -q "Abre:" /tmp/paquete.log || { echo "no arrancó"; cat /tmp/paquete.log; exit 1; }
U="http://127.0.0.1:$PUERTO"
[ "$(curl -s -o /dev/null -w '%{http_code}' $U/)" = 200 ] || { echo "la interfaz no se sirve"; exit 1; }
[ "$(curl -s -o /dev/null -w '%{http_code}' $U/manifest.webmanifest)" = 200 ] || { echo "sin manifiesto"; exit 1; }
[ "$(curl -s -o /dev/null -w '%{http_code}' $U/web/js/main.js)" = 200 ] || { echo "sin scripts"; exit 1; }
[ "$(curl -s -o /dev/null -w '%{http_code}' -H 'x-demo: 1' $U/api/estado)" = 401 ] || { echo "la API debe exigir sesión"; exit 1; }
curl -s -c /tmp/ck.txt -H 'x-demo: 1' -H 'content-type: application/json' -X POST $U/api/sesion/entrar -d '{"usuario":"ana","clave":"demo1234"}' | grep -q '"autenticado":true' || { echo "no inició sesión"; cat /tmp/paquete.log; exit 1; }
curl -s -b /tmp/ck.txt $U/api/plan | grep -q 'prepago_basico' || { echo "sin plan"; exit 1; }
echo "PAQUETE OK"
