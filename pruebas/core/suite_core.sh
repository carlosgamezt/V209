#!/usr/bin/env bash
# Suite integral de NEXA CORE: comportamiento + idempotencia + reversión, y mutaciones de seguridad. Sale con 1 si algo falla.
cd "$(dirname "$0")/../.."; fall=0; T=/tmp/suite_core_$$; mkdir -p $T
run() { local n="$1"; shift; if "$@" > $T/$n.txt 2>&1; then echo "OK    $n ($(grep -c '^OK' $T/$n.txt) comprobaciones)"; else echo "FALLO $n"; grep -E "^FALLO" $T/$n.txt | head -5; fall=1; fi; }
run comportamiento pruebas/core/test_core.sh
run mutaciones pruebas/core/mutaciones.sh
[ $fall = 0 ] && echo "SUITE CORE OK" || echo "SUITE CORE CON FALLOS"; exit $fall
