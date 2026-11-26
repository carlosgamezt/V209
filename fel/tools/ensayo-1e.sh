#!/usr/bin/env bash
# ENSAYO 1E en un proyecto de pruebas AISLADO («nexa-fel-test»). Aplica M-D…M-H y M-E en el orden documentado y corre las pruebas de seguridad COMO nexa_app. NO se usa nunca contra nexa-demo.
# Variables (secretos del entorno; nunca se imprimen):
#   ENSAYO_REF              referencia del proyecto de pruebas (obligatoria)
#   ENSAYO_URL_ADMIN        postgres://postgres.<ref>:<clave>@<host-pooler>:5432/postgres   (session pooler, para aplicar migraciones)
#   ENSAYO_URL_APP          postgres://nexa_app.<ref>:<clave>@<host-pooler>:6543/postgres   (pooler en modo transacción, como la función)
#   ENSAYO_CLAVE_NEXA_APP   contraseña que se asigna a nexa_app en el proyecto de pruebas
#   ENSAYO_CONFIRMO         debe valer «nexa-fel-test»
#   FEL_DEMO_PROYECTO_REF   (opcional) ref de nexa-demo: si coincide con ENSAYO_REF el script se NIEGA
#   FEL_R2_ESPERADO         abierto (hoy) | cerrado (tras corregir R2)
# Uso: bash tools/ensayo-1e.sh [validar|aplicar|probar|todo]    («validar» no toca la base)
set -euo pipefail
cd "$(dirname "$0")/.."
D=docs/multiempresa/propuesta; MODO=${1:-validar}
fallo() { echo "FALLO: $*" >&2; exit 1; }
[ "${ENSAYO_CONFIRMO:-}" = "nexa-fel-test" ] || fallo "ENSAYO_CONFIRMO debe valer «nexa-fel-test»"
REF=${ENSAYO_REF:-}; [ -n "$REF" ] || fallo "falta ENSAYO_REF"
[ -z "${FEL_DEMO_PROYECTO_REF:-}" ] || [ "$REF" != "$FEL_DEMO_PROYECTO_REF" ] || fallo "ENSAYO_REF es el de nexa-demo: se niega"
for v in ENSAYO_URL_ADMIN ENSAYO_URL_APP ENSAYO_CLAVE_NEXA_APP; do [ -n "${!v:-}" ] || fallo "falta $v"; done
# el usuario de cada cadena debe terminar en .<ref> (pooler de Supabase) y la base debe ser la del proyecto de pruebas: así no se cruza con otro proyecto
usuario() { sed -E 's#^postgres(ql)?://([^:@/]+)[:@].*#\2#' <<< "$1"; }
UA=$(usuario "$ENSAYO_URL_ADMIN"); UP=$(usuario "$ENSAYO_URL_APP")
local_ok() { [[ "$1" == *"127.0.0.1"* || "$1" == *"localhost"* ]]; }   # solo para validar este script contra un PostgreSQL local
if ! local_ok "$ENSAYO_URL_ADMIN"; then [[ "$UA" == *".$REF" ]] || fallo "el usuario administrador no corresponde a ENSAYO_REF"; [[ "$UP" == "nexa_app.$REF" ]] || fallo "el usuario de la aplicación debe ser nexa_app.<ref>"; fi
echo "OK    guardas: proyecto $REF distinto de nexa-demo, usuarios coherentes"
[ "$MODO" = validar ] && { echo "OK    validación de la forma (no se tocó la base)"; exit 0; }
PSQLA() { psql "$ENSAYO_URL_ADMIN" -v ON_ERROR_STOP=1 -q -X "$@"; }
PSQLP() { PGPASSWORD="$ENSAYO_CLAVE_NEXA_APP" psql "$ENSAYO_URL_APP" -v ON_ERROR_STOP=1 -q -X "$@"; }
aplicar() {
  echo "== 1) identidad del administrador del ensayo"; PSQLA -At -c "select 'usuario='||current_user||' · super='||rolsuper||' · bypassrls='||rolbypassrls from pg_roles where rolname=current_user"
  echo "== 2) estado previo (solo lectura)"; PSQLA -At -c "select 'tablas public='||count(*) from information_schema.tables where table_schema='public'"
  if [ "$(PSQLA -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='documentos'")" = 0 ]; then
    echo "== 3) migraciones 1-30 (proyecto vacío)"; for f in supabase/migrations/*.sql; do PSQLA --single-transaction -f "$f" >/dev/null || fallo "migración $f"; done; echo "OK    migraciones del proyecto"; fi
  echo "== 4) propuestas en orden: M-D, M-A, M-B, M-C, M-F, M-G, M-H, M-E (una transacción cada una)"
  for f in M-D_permisos M-A_emisor_fiscal M-B_digifact_config M-C_acceso_maestro M-F_establecimientos_usuario M-G_sesion_admin M-H_admin_establecimientos M-E_rol_app; do PSQLA --single-transaction -f "$D/$f.sql" >/dev/null || fallo "no se aplicó $f"; echo "OK    $f"; done
  PSQLA -c "alter role nexa_app login password '$ENSAYO_CLAVE_NEXA_APP'" ; echo "OK    nexa_app habilitado SOLO en el proyecto de pruebas"
  echo "== 5) verificación posterior (solo lectura)"; V=$({ echo '\set ON_ERROR_STOP on'; echo 'begin transaction read only;'; echo "\\i $D/verificacion.sql"; echo 'rollback;'; } | PSQLA -At); NT=$(grep -c '|t$' <<< "$V" || true); NF=$(grep -c '|f$' <<< "$V" || true)
  echo "comprobaciones ok=t: $NT · ok=f: $NF"; [ "$NT" -gt 0 ] && [ "$NF" = 0 ] || fallo "verificación posterior"
  echo "== 6) datos SIMULADOS (dos empresas, establecimientos 2 y 67, sesiones de prueba)"; PSQLA -f "$D/fixture-sesion.sql" >/dev/null; echo "OK    fixture"
}
probar() {
  echo "== 7) conexión como nexa_app por el pooler (modo transacción)"; PSQLP -At -c "select 'usuario='||current_user||' · super='||rolsuper||' · bypassrls='||rolbypassrls from pg_roles where rolname=current_user"
  PSQLP -At -c "select 'funciones ejecutables: '||count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and has_function_privilege(current_user, p.oid, 'execute') and p.proname like 'fel%'"
  echo "== 8) pruebas como nexa_app"
  for t in prueba-rol-app prueba-sesion-admin prueba-admin-establecimientos; do PSQLP -f "$D/$t.sql" 2>&1 | grep -qE "PRUEBAS DEL ROL nexa_app OK|PRUEBAS DE SESIÓN VALIDADA OK|PRUEBAS DE ADMINISTRACIÓN DE ESTABLECIMIENTOS OK" && echo "OK    $t" || fallo "$t"; done
  echo "== 9) sonda R2 (suplantación por fel_op_*), esperado: ${FEL_R2_ESPERADO:-abierto}"; PSQLP -v esperado="${FEL_R2_ESPERADO:-abierto}" -f "$D/prueba-r2-suplantacion.sql" 2>&1 | grep -E "POSIBLE|rechazada|R2 ESTADO|SONDA R2" || fallo "sonda R2"
  echo "== 10) tabla nueva con RLS y sin política: nexa_app debe ver 0 filas"
  PSQLA -c "create table public.zz_nueva (x int); alter table public.zz_nueva enable row level security; insert into public.zz_nueva values (1); grant select on public.zz_nueva to nexa_app;" >/dev/null
  [ "$(PSQLP -At -c 'select count(*) from public.zz_nueva')" = 0 ] && echo "OK    falla cerrado" || fallo "RLS sin política"; PSQLA -c "drop table public.zz_nueva" >/dev/null
}
case "$MODO" in aplicar) aplicar;; probar) probar;; todo) aplicar; probar;; *) fallo "modo desconocido";; esac
echo "ENSAYO 1E ($MODO) terminado"
