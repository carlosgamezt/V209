#!/usr/bin/env bash
# ÚNICA fuente de cómo se ejecuta un SQL de verificación en SOLO LECTURA (la usan la acción «verificar-inicial» y sus pruebas, para que lo probado sea exactamente lo ejecutado).
#   envolver_solo_lectura <archivo.sql>   imprime un script de psql que ejecuta el archivo DENTRO de «begin transaction read only … rollback»:
#       cualquier INSERT, UPDATE, DELETE, DDL, CREATE, ALTER, DROP, GRANT, etc. que hubiera en el archivo es rechazado por PostgreSQL y la transacción nunca se confirma.
# Capas de defensa (todas independientes): 1) el verificador estático del archivo (tools/verificar-sql-solo-lectura.py: solo SELECT); 2) esta transacción de solo lectura;
# 3) la sesión forzada a solo lectura (PGOPTIONS="-c default_transaction_read_only=on"); 4) la fila «sesión de solo lectura» del propio resultado, sin la cual la acción falla.
envolver_solo_lectura() {
  local f="$1"
  printf '%s\n' '\set ON_ERROR_STOP on' 'begin transaction read only;' "\\i $f" 'rollback;'
}
