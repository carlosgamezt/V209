#!/usr/bin/env bash
# Suite integral de pruebas de Egress/optimización (locales; nunca tocan producción). Uso: ./suite_integral.sh   → imprime un resumen y termina con código 1 si algo falla.
cd "$(dirname "$0")"; R=../../nexa; X='--extra server_extra.js'; C='{"lite":true,"patch":true}'; fall=0; T=/tmp/suite_$$; mkdir -p $T
run() { local n="$1"; shift; if timeout 600 "$@" > $T/$n.txt 2>&1; then echo "OK    $n ($(grep -c '^OK' $T/$n.txt) comprobaciones)"; else echo "FALLO $n"; grep -E "^FALLO|Error|error" $T/$n.txt | head -4; fall=1; fi; }
run sql ./test_sql.sh
run rls_reales ./test_rls_real.sh
run sql_automaticos ./test_auto_sql.sh
run recordatorios ./test_recordatorios.sh
run funcion_recordatorios deno run -A recordatorios_fn_test.ts
run funcional node funcional.cjs --root $R --out $T/f.json $X --caps "$C"
run recuperacion node recuperacion.cjs --root $R --out $T/r.json $X --caps "$C"
run cache node cache_test.cjs --root $R --out $T/c.json $X --caps "$C"
run arqueos node arqueos_test.cjs --root $R --out $T/a.json $X --caps "$C"
run guardado_parcial node parcial_test.cjs --root $R --out $T/p.json $X --caps "$C"
for m in cors nocors exp; do run descarga_$m node descarga_test.cjs --root $R --out $T/d.json --od $m --directo $X --caps "$C"; done
for m in cors nocors mid; do run subida_$m node subida_test.cjs --root $R --out $T/s.json --od $m $X --caps "$C"; done
run descarga_apagada node descarga_test.cjs --root $R --out $T/d.json --odoff --directo $X --caps "$C"
[ $fall = 0 ] && echo "SUITE INTEGRAL OK" || echo "SUITE INTEGRAL CON FALLOS"; exit $fall
