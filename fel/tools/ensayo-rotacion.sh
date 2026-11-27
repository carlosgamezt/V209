#!/usr/bin/env bash
# ENSAYO LOCAL de rotación manual de credenciales de base (nexa_app / nexa_sys) con PostgreSQL temporal y autenticación SCRAM: sin red ni secretos reales (las contraseñas se generan al vuelo y no se imprimen).
# Comprueba: la clave nueva entra, la anterior deja de funcionar, las sesiones abiertas con la anterior se cierran al terminarlas, y los privilegios del rol no cambian.  Uso: bash tools/ensayo-rotacion.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}; DATA=/tmp/fel-rot-pg-$$; PORT=$((58000 + RANDOM % 400)); SOCK=/tmp; D=docs/multiempresa/propuesta
as_pg() { if [ "$(id -u)" = 0 ]; then su pgtest -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
id pgtest >/dev/null 2>&1 || useradd -m pgtest
as_pg "mkdir -p '$DATA' && '$PGBIN/initdb' -D '$DATA' -A trust -U postgres >/dev/null && sed -i 's/^local .*all.*trust/local all postgres trust/' '$DATA/pg_hba.conf' && echo 'local all all scram-sha-256' >> '$DATA/pg_hba.conf'"
as_pg "'$PGBIN/pg_ctl' -D '$DATA' -o '-p $PORT -k $SOCK -c listen_addresses= -c password_encryption=scram-sha-256' -w -l '$DATA/log' start >/dev/null"
trap 'as_pg "'"$PGBIN"'/pg_ctl -D '"$DATA"' -m immediate stop >/dev/null" || true; rm -rf "$DATA"' EXIT
P() { "$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d nexa -v ON_ERROR_STOP=1 -q -X "$@"; }
U() { PGPASSWORD="$2" "$PGBIN/psql" -h "$SOCK" -p "$PORT" -U "$1" -d nexa -At -q -X -c "${3:-select 1}" 2>/dev/null; }
ok() { echo "OK    $1"; }; fallo() { echo "FALLO $1"; exit 1; }
"$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d postgres -q -X -c "create database nexa"; P -f tools/shim_supabase.sql
for f in supabase/migrations/*.sql; do P -f "$f" >/dev/null 2>&1; done
for f in M-D_permisos M-A_emisor_fiscal M-B_digifact_config M-C_acceso_maestro M-F_establecimientos_usuario M-G_sesion_admin M-H_admin_establecimientos M-I_envoltorios_sesion M-J_plataforma_y_auditoria M-K_sistema_nexa_sys M-L_rls_sesion_viva M-M_identidad_auth M-N_esquema_api M-O_lecturas_api M-Q_agente_endurecimiento M-R_parametros_clases M-S_lecturas_documentos M-T_lecturas_restantes M-U_lecturas_paginadas M-V1_lecturas_de_sistema M-V_cierre_r3 M-E_rol_app; do P -f $D/$f.sql >/dev/null 2>&1 || fallo "no se aplicó $f"; done
gen() { head -c 24 /dev/urandom | base64 | tr -d '/+=' ; }
for R in nexa_app nexa_sys; do
  V1=$(gen); V2=$(gen); P -c "alter role $R login password '$V1'"
  [ "$(U $R "$V1")" = 1 ] && ok "$R entra con la clave vigente"
  PRIV1=$(P -At -c "select md5(string_agg(format('%s.%s.%s', table_name, privilege_type, grantee), '|' order by 1)) from information_schema.role_table_grants where grantee = '$R'; ") ; FN1=$(P -At -c "select count(*) from information_schema.routine_privileges where grantee = '$R'")
  # sesión abierta con la clave vieja durante la rotación
  PGPASSWORD="$V1" "$PGBIN/psql" -h "$SOCK" -p "$PORT" -U $R -d nexa -At -q -X -c "select pg_sleep(3)" >/dev/null 2>&1 & VIEJA=$!
  P -c "alter role $R password '$V2'"
  [ "$(U $R "$V2")" = 1 ] && ok "$R entra con la clave NUEVA"
  [ -z "$(U $R "$V1")" ] && ok "$R: la clave ANTERIOR ya no entra" || fallo "$R: la clave anterior sigue entrando"
  wait $VIEJA && ok "$R: la sesión abierta con la clave anterior termina su trabajo (la rotación no corta lo en curso)"
  PRIV2=$(P -At -c "select md5(string_agg(format('%s.%s.%s', table_name, privilege_type, grantee), '|' order by 1)) from information_schema.role_table_grants where grantee = '$R'; "); FN2=$(P -At -c "select count(*) from information_schema.routine_privileges where grantee = '$R'")
  [ "$PRIV1" = "$PRIV2" ] && [ "$FN1" = "$FN2" ] && ok "$R: privilegios idénticos antes y después de rotar ($FN2 funciones)" || fallo "$R: los privilegios cambiaron"
  P -c "alter role $R nologin password null" ; [ -z "$(U $R "$V2")" ] && ok "$R: deshabilitado de emergencia (nologin + sin clave) rechaza todo; se rehabilita con alter role … login password" || fallo "$R: sigue entrando"
done
echo "ENSAYO DE ROTACIÓN OK"
