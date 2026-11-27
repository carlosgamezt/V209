#!/usr/bin/env bash
# ENSAYO LOCAL de respaldo y recuperación del ESQUEMA COMPLETO de NEXA FEL (migraciones 1-30 + propuestas M-D…M-V + datos SIMULADOS) con PostgreSQL temporal: sin red, sin credenciales, sin tocar ningún proyecto de Supabase.
#   1) crea el origen (A) y mide sus datos y su catálogo;  2) respalda: pg_dump (formato custom) de la base y de los ROLES sin contraseñas;  3) restaura en OTRO servidor (B);
#   4) compara filas por tabla, funciones, políticas RLS, privilegios y atributos de roles;  5) corre las pruebas de seguridad (identidad, lecturas, cierre de R3) SOBRE LA COPIA RESTAURADA;
#   6) comprueba que un respaldo dañado se detecta y que el origen no cambió.  Imprime tiempos (referencia de RTO para este volumen). Uso: bash tools/ensayo-respaldo-esquema.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}; W=$(mktemp -d); DA=$W/a; DB=$W/b; PA=$((56000 + RANDOM % 400)); PB=$((PA + 500)); SOCK=/tmp; D=docs/multiempresa/propuesta
as_pg() { if [ "$(id -u)" = 0 ]; then su pgtest -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
id pgtest >/dev/null 2>&1 || useradd -m pgtest
chmod 777 "$W"
for X in "$DA:$PA" "$DB:$PB"; do d=${X%%:*}; p=${X##*:}; as_pg "mkdir -p '$d' && '$PGBIN/initdb' -D '$d' -A trust -U postgres >/dev/null" && as_pg "'$PGBIN/pg_ctl' -D '$d' -o '-p $p -k $SOCK -c listen_addresses= -c max_connections=60' -w -l '$d/log' start >/dev/null"; done
trap 'for d in "$DA" "$DB"; do as_pg "'"$PGBIN"'/pg_ctl -D $d -m immediate stop >/dev/null" || true; done; rm -rf "$W"' EXIT
PA_() { "$PGBIN/psql" -h "$SOCK" -p "$PA" -U postgres -d "${DBN:-nexa}" -v ON_ERROR_STOP=1 -q -X "$@"; }; PB_() { "$PGBIN/psql" -h "$SOCK" -p "$PB" -U postgres -d "${DBN:-nexa}" -v ON_ERROR_STOP=1 -q -X "$@"; }
ok() { echo "OK    $1"; }; fallo() { echo "FALLO $1"; exit 1; }
t0=$(date +%s)
# ---- 1) origen
"$PGBIN/psql" -h "$SOCK" -p "$PA" -U postgres -d postgres -q -X -c "create database nexa"; PA_ -f tools/shim_supabase.sql
for f in supabase/migrations/*.sql; do PA_ -f "$f" >/dev/null 2>&1; done
for f in M-D_permisos M-A_emisor_fiscal M-B_digifact_config M-C_acceso_maestro M-F_establecimientos_usuario M-G_sesion_admin M-H_admin_establecimientos M-I_envoltorios_sesion M-J_plataforma_y_auditoria M-K_sistema_nexa_sys M-L_rls_sesion_viva M-M_identidad_auth M-N_esquema_api M-O_lecturas_api M-Q_agente_endurecimiento M-R_parametros_clases M-S_lecturas_documentos M-T_lecturas_restantes M-U_lecturas_paginadas M-V1_lecturas_de_sistema M-V_cierre_r3 M-E_rol_app; do PA_ -f $D/$f.sql >/dev/null 2>&1 || fallo "origen: no se aplicó $f"; done
PA_ -f $D/fixture-sesion.sql >/dev/null 2>&1 || fallo "origen: fixture"
PA_ -c "create table public.zz_volumen as select g as n, md5(g::text) as huella, repeat('x', 200) as relleno from generate_series(1, 200000) g; alter table public.zz_volumen enable row level security"
HUELLA=$(cat <<'SQL'
select md5(string_agg(x, ',' order by x)) from (
  select (select string_agg(r, ',' order by r) from (select format('%I.%I=%s', schemaname, relname, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', schemaname, relname), false, true, '')))[1]::text) r from pg_stat_user_tables where schemaname in ('public', 'auth')) t) as x
  union all select 'f:' || md5(string_agg(pg_get_functiondef(p.oid), '' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace in ('public'::regnamespace, 'api'::regnamespace) and p.prokind = 'f'
  union all select 'p:' || md5(string_agg(format('%s.%s.%s.%s.%s', schemaname, tablename, policyname, permissive, coalesce(qual, '')), '|' order by schemaname, tablename, policyname)) from pg_policies
  union all select 'g:' || md5(string_agg(format('%s.%s.%s', grantee, table_name, privilege_type), '|' order by grantee, table_name, privilege_type)) from information_schema.role_table_grants where table_schema in ('public', 'auth', 'api')
  union all select 'e:' || md5(string_agg(format('%s.%s.%s', grantee, routine_name, privilege_type), '|' order by grantee, routine_name, privilege_type)) from information_schema.routine_privileges where routine_schema in ('public', 'api')
  union all select 'r:' || md5(string_agg(format('%s.%s.%s.%s.%s', rolname, rolsuper, rolcreaterole, rolcanlogin, rolbypassrls), '|' order by rolname)) from pg_roles where rolname in ('nexa_app', 'nexa_sys', 'authenticated', 'anon', 'service_role')
) q
SQL
)
HA=$(PA_ -At -c "$HUELLA"); [ -n "$HA" ] || fallo "huella del origen vacía"; t1=$(date +%s); ok "origen creado y medido ($((t1 - t0)) s)"
# ---- 2) respaldo (base + roles SIN contraseñas)
"$PGBIN/pg_dump" -h "$SOCK" -p "$PA" -U postgres -d nexa -Fc -f "$W/nexa.dump"; "$PGBIN/pg_dumpall" -h "$SOCK" -p "$PA" -U postgres --roles-only --no-role-passwords -f "$W/roles.sql"
grep -qiE "password '|md5[0-9a-f]{32}|SCRAM-SHA-256" "$W/roles.sql" && fallo "el respaldo de roles contiene contraseñas"; [ -s "$W/nexa.dump" ] || fallo "respaldo vacío"; t2=$(date +%s); ok "respaldo hecho ($((t2 - t1)) s; $(du -k "$W/nexa.dump" | cut -f1) KB; roles sin contraseñas)"
HA2=$(PA_ -At -c "$HUELLA"); [ "$HA" = "$HA2" ] && ok "el respaldo no modificó el origen" || fallo "el origen cambió durante el respaldo"
# ---- 3) restauración en OTRO servidor (roles primero; luego la base con privilegios)
grep -v "^CREATE ROLE postgres\|^ALTER ROLE postgres" "$W/roles.sql" | "$PGBIN/psql" -h "$SOCK" -p "$PB" -U postgres -d postgres -q -X >/dev/null 2>&1 || true
"$PGBIN/psql" -h "$SOCK" -p "$PB" -U postgres -d postgres -q -X -c "create database nexa"
"$PGBIN/pg_restore" -h "$SOCK" -p "$PB" -U postgres -d nexa --no-owner --exit-on-error "$W/nexa.dump" 2>"$W/restore.log" || { tail -3 "$W/restore.log"; fallo "restauración"; }
t3=$(date +%s); ok "restauración hecha ($((t3 - t2)) s)"
# ---- 4) la copia es IDÉNTICA: filas por tabla, funciones, políticas, privilegios y roles
HB=$(PB_ -At -c "$HUELLA"); [ "$HA" = "$HB" ] && ok "copia idéntica: filas por tabla, funciones, políticas RLS, privilegios y roles" || { echo "$HA" | head -3; echo "$HB" | head -3; fallo "la copia restaurada difiere del origen"; }
# ---- 5) pruebas de seguridad SOBRE LA COPIA RESTAURADA (todas se deshacen)
for t in prueba-api-identidad:"PRUEBAS DE IDENTIDAD DE AUTH Y ESQUEMA API OK" prueba-api-lecturas:"PRUEBAS DE LECTURAS POR LA DATA API OK" prueba-cierre-r3:"PRUEBAS DE CIERRE LOCAL DE R3 OK" prueba-parametros:"PRUEBAS DE PARÁMETROS POR CLASE OK"; do
  PB_ -f "$D/${t%%:*}.sql" 2>&1 | tee "$W/${t%%:*}.log" | grep -q "${t#*:}" && ok "sobre la copia restaurada: ${t%%:*}" || { tail -6 "$W/${t%%:*}.log"; fallo "sobre la copia restaurada: ${t%%:*}"; }; done
t4=$(date +%s); echo "RTO de referencia de este volumen (200 000 filas simuladas): restaurar $((t3 - t2)) s + verificar $((t4 - t3)) s"
# ---- 6) un respaldo dañado se DETECTA (no se restaura en silencio) y el origen sigue intacto
head -c $(( $(stat -c %s "$W/nexa.dump") / 2 )) "$W/nexa.dump" > "$W/dañado.dump"
"$PGBIN/psql" -h "$SOCK" -p "$PB" -U postgres -d postgres -q -X -c "create database dañada" 2>/dev/null || "$PGBIN/psql" -h "$SOCK" -p "$PB" -U postgres -d postgres -q -X -c 'create database danada'
if "$PGBIN/pg_restore" -h "$SOCK" -p "$PB" -U postgres -d danada --no-owner --exit-on-error "$W/dañado.dump" >/dev/null 2>&1; then fallo "un respaldo dañado se restauró sin error"; else ok "un respaldo dañado (truncado) se rechaza con error"; fi
[ "$(PA_ -At -c "$HUELLA")" = "$HA" ] && ok "el origen sigue intacto" || fallo "el origen cambió"
echo "ENSAYO DE RESPALDO Y RECUPERACIÓN OK"
