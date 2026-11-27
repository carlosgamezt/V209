#!/usr/bin/env bash
# Pruebas de seguridad del rol de conexión restringido `nexa_app` (PROPUESTA, etapa 1B-bis) en un PostgreSQL temporal (no toca ningún proyecto de Supabase): migraciones 1-30 + M-D, M-A, M-B, M-C, M-E;
# auditoría de las funciones SECURITY DEFINER; pruebas conectadas COMO nexa_app; compatibilidad con la aplicación (recorrido real de la nube con la base como nexa_app) y reversión de M-E.
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}; DATA=${FEL_PGDATA:-/tmp/fel-rolapp-pg-$$}; PORT=${FEL_PGPORT:-$((55000 + RANDOM % 900))}; SOCK=/tmp
as_pg() { if [ "$(id -u)" = 0 ]; then su pgtest -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
if [ "$(id -u)" = 0 ] && ! id pgtest >/dev/null 2>&1; then useradd -m pgtest; fi
as_pg "mkdir -p '$DATA' && '$PGBIN/initdb' -D '$DATA' -A trust -U postgres >/dev/null"
as_pg "'$PGBIN/pg_ctl' -D '$DATA' -o '-p $PORT -k $SOCK -c listen_addresses=127.0.0.1 -c max_connections=300' -w -l '$DATA/log' start >/dev/null"
trap 'as_pg "'"$PGBIN"'/pg_ctl -D '"$DATA"' -m immediate stop >/dev/null" || true' EXIT
D=${FEL_PROPUESTA:-docs/multiempresa/propuesta}
PSQL() { "$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d "$1" -v ON_ERROR_STOP=1 -q -X "${@:2}"; }
PSQLSYS() { "$PGBIN/psql" -h "$SOCK" -p "$PORT" -U nexa_sys -d "$1" -v ON_ERROR_STOP=1 -q -X "${@:2}"; }
PSQLAPP() { "$PGBIN/psql" -h "$SOCK" -p "$PORT" -U nexa_app -d "$1" -v ON_ERROR_STOP=1 -q -X "${@:2}"; }
PSQL postgres -c "create database nexa_plantilla"
PSQL nexa_plantilla -f tools/shim_supabase.sql
for f in supabase/migrations/*.sql; do PSQL nexa_plantilla -f "$f" >/dev/null 2>&1; done
for f in M-D_permisos M-A_emisor_fiscal M-B_digifact_config M-C_acceso_maestro M-F_establecimientos_usuario M-G_sesion_admin M-H_admin_establecimientos M-I_envoltorios_sesion M-J_plataforma_y_auditoria M-K_sistema_nexa_sys M-L_rls_sesion_viva M-M_identidad_auth M-N_esquema_api M-O_lecturas_api M-Q_agente_endurecimiento M-R_parametros_clases M-S_lecturas_documentos M-T_lecturas_restantes M-U_lecturas_paginadas M-V1_lecturas_de_sistema M-V_cierre_r3 M-E_rol_app; do PSQL nexa_plantilla --single-transaction -f $D/$f.sql >/dev/null || { echo "FALLO: no se aplicó $f"; exit 1; }; done
PSQL postgres -c "alter role nexa_app login password 'prueba-local'" ; PSQL postgres -c "alter role nexa_sys login password 'prueba-sys'" ; echo "OK    M-D, M-A, M-B, M-C y M-E aplicadas; nexa_app habilitado SOLO en este PostgreSQL temporal"
PSQL postgres -c "create database nexa_sesion template nexa_plantilla"   # copia con los datos de prueba de sesiones; la plantilla queda limpia para la prueba de compatibilidad de la aplicación
# datos de prueba persistentes + pruebas COMO nexa_app con sesiones validadas (suplantación, otra empresa, MFA, permisos, establecimientos, maestro)
PSQL nexa_sesion -f $D/fixture-sesion.sql >/dev/null 2>&1 || { echo "FALLO: fixture de sesiones"; PSQL nexa_sesion -f $D/fixture-sesion.sql 2>&1 | tail -3; exit 1; }
# auditoría SECURITY DEFINER (como superusuario): todas con search_path vacío, nada ejecutable por anon/PUBLIC, solo 3 predicados por authenticated
SAL=$(PSQL nexa_plantilla -A -t -f $D/auditoria-definer.sql)
echo "$SAL" | sed 's/^/      /'
grep -q "DEFINER sin search_path fijo: ninguna" <<< "$SAL" && grep -q "DEFINER con search_path no vacío: ninguna" <<< "$SAL" && grep -q "DEFINER ejecutables por anon/PUBLIC: ninguna" <<< "$SAL" \
 && grep -q "DEFINER ejecutables por authenticated: fel__aal2, fel__empresa_actual, fel__empresas_alcance_total, fel__empresas_con_permiso, fel__establecimiento_por_usuario, fel__establecimientos_en_alcance, fel__parametros_lista, fel__sesion_viva, fel_en_alcance, fel_es_admin_plataforma, fel_es_miembro, fel_tiene_permiso$" <<< "$SAL" && echo "OK    auditoría de funciones SECURITY DEFINER" || { echo "FALLO: auditoría SECURITY DEFINER"; exit 1; }
# pruebas COMO nexa_app (conexión real)
PGPASSWORD=prueba-local PSQLAPP nexa_sesion -f $D/prueba-rol-app.sql | grep -q "PRUEBAS DEL ROL nexa_app OK" && echo "OK    pruebas de seguridad conectadas como nexa_app" || { echo "FALLO: pruebas como nexa_app"; exit 1; }
PGPASSWORD=prueba-local PSQLAPP nexa_sesion -f $D/prueba-sesion-admin.sql 2>&1 | tee /tmp/sesion_admin.log | grep -q "PRUEBAS DE SESIÓN VALIDADA OK" && echo "OK    pruebas conectadas como nexa_app con sesión validada (suplantación, MFA, establecimientos, maestro)" || { grep -E "ERROR|ESPERABA|CONTEXT" /tmp/sesion_admin.log | head -4; echo "FALLO: pruebas de sesión validada"; exit 1; }
PGPASSWORD=prueba-local PSQLAPP nexa_sesion -f $D/prueba-admin-establecimientos.sql 2>&1 | tee /tmp/admin_est.log | grep -q "PRUEBAS DE ADMINISTRACIÓN DE ESTABLECIMIENTOS OK" && echo "OK    administración de establecimientos como nexa_app (sesión validada, otra empresa, nombre interno, reasignación, supervisión)" || { echo "FALLO: administración de establecimientos"; tail -8 /tmp/admin_est.log; exit 1; }
PGPASSWORD=prueba-local PSQLAPP nexa_sesion -f $D/prueba-envoltorios.sql 2>&1 | tee /tmp/envoltorios.log | grep -q "PRUEBAS DE ENVOLTORIOS DE SESIÓN OK" && echo "OK    envoltorios fel_ses_* como nexa_app (todos rechazan identidades inválidas; empresa y permisos desde la sesión)" || { echo "FALLO: envoltorios de sesión"; tail -8 /tmp/envoltorios.log; exit 1; }
PSQL nexa_sesion -f $D/prueba-rls-sesion-viva.sql 2>&1 | tee /tmp/rls_viva.log | grep -q "PRUEBAS RLS DE SESIÓN VIVA OK" && echo "OK    lectura por la Data API (R3/F5): sesión viva, revocación inmediata, MFA real y cobertura de todas las tablas de empresa" || { echo "FALLO: RLS de sesión viva"; tail -8 /tmp/rls_viva.log; exit 1; }
PSQL nexa_sesion -f $D/prueba-api-identidad.sql 2>&1 | tee /tmp/api_id.log | grep -q "PRUEBAS DE IDENTIDAD DE AUTH Y ESQUEMA API OK" && echo "OK    identidad de Supabase Auth y esquema api (W1/W2): sesión viva, MFA real, empresa por membresía, permisos efectivos, exposición mínima" || { echo "FALLO: identidad de Auth y esquema api"; tail -8 /tmp/api_id.log; exit 1; }
PSQL nexa_sesion -f $D/prueba-api-lecturas.sql 2>&1 | tee /tmp/api_lec.log | grep -q "PRUEBAS DE LECTURAS POR LA DATA API OK" && echo "OK    lecturas por la Data API (W4): RPC INVOKER + RLS, aislamiento entre empresas, permisos, sesión viva, selector de empresa" || { echo "FALLO: lecturas por la Data API"; tail -8 /tmp/api_lec.log; exit 1; }
(cd $D && PSQL nexa_sesion -f prueba-agente-protocolo.sql) 2>&1 | tee /tmp/agente_prot.log | grep -q "PRUEBAS DE PROTOCOLO DEL AGENTE OK" && echo "OK    protocolos del agente (9 fel_sys_*): $(grep -o 'AGENTE ESTADO: [^;]*' /tmp/agente_prot.log | head -1)" || { echo "FALLO: protocolos del agente"; tail -8 /tmp/agente_prot.log; exit 1; }
PSQL nexa_sesion -f $D/prueba-parametros.sql 2>&1 | tee /tmp/params.log | grep -q "PRUEBAS DE PARÁMETROS POR CLASE OK" && echo "OK    parámetros de plataforma por clase (M-R): usuario / empresa con permiso / plataforma / interno; sin clasificar = nunca; sin sesión = nada" || { echo "FALLO: parámetros por clase"; tail -6 /tmp/params.log; exit 1; }
PSQL nexa_sesion -f $D/prueba-api-documentos.sql 2>&1 | tee /tmp/api_docs.log | grep -q "PRUEBAS DE LECTURAS DE DOCUMENTOS OK" && echo "OK    lecturas de documentos, archivos, panel y reporte (M-S): aislamiento, permisos, alcance, equivalencia de políticas, contenido de archivos protegido" || { echo "FALLO: lecturas de documentos"; tail -8 /tmp/api_docs.log; exit 1; }
PSQL nexa_sesion -f $D/prueba-cierre-r3.sql 2>&1 | tee /tmp/cierre_r3.log | grep -q "PRUEBAS DE CIERRE LOCAL DE R3 OK" && echo "OK    cierre local de R3 (M-V): pre-lecturas de personas, contexto de empresa, lecturas de servicios solo nexa_sys, privilegios mínimos" || { echo "FALLO: cierre local de R3"; tail -8 /tmp/cierre_r3.log; exit 1; }
PGPASSWORD=prueba-sys PSQLSYS nexa_sesion -f $D/prueba-nexa-sys.sql 2>&1 | tee /tmp/nexa_sys.log | grep -q "PRUEBAS DE NEXA_SYS OK" && echo "OK    nexa_sys (F4): solo fel_sys_*, sin tablas, sin esquemas ajenos, sin asumir otro rol" || { echo "FALLO: pruebas de nexa_sys"; tail -8 /tmp/nexa_sys.log; exit 1; }
PGPASSWORD=prueba-local PSQLAPP nexa_sesion -v esperado=${FEL_R2_ESPERADO:-abierto} -f $D/prueba-r2-suplantacion.sql 2>&1 | tee /tmp/r2.log | grep -q "SONDA R2 OK" && echo "OK    sonda R2 (suplantación por fel_op_*): $(grep -o 'R2 ESTADO: [a-z]*' /tmp/r2.log) — esperado ${FEL_R2_ESPERADO:-abierto}" || { echo "FALLO: sonda R2"; tail -12 /tmp/r2.log; exit 1; }
# reversión de W1–W4 (M-M, M-N, M-O) y de M-P en una copia: el esquema api y los ayudantes desaparecen y la identidad vuelve a ser solo el token (sin tocar la base de las pruebas siguientes)
PSQL postgres -c "create database nexa_revw template nexa_sesion"
for r in M-V M-U M-T M-S M-R M-Q; do PSQL nexa_revw -f $D/reversion-$r.sql >/dev/null 2>/tmp/rev_w.log || { echo "FALLO: reversión de $r"; tail -5 /tmp/rev_w.log; exit 1; }; done
PSQL nexa_revw -f $D/reversion-M-M-N-O.sql >/dev/null 2>/tmp/rev_w.log || { echo "FALLO: reversión de M-M/M-N/M-O"; tail -5 /tmp/rev_w.log; exit 1; }
PSQL nexa_revw -f $D/reversion-M-P.sql >/dev/null 2>&1 || { echo "FALLO: reversión de M-P"; exit 1; }
[ "$(PSQL nexa_revw -At -c "select (select count(*) from pg_namespace where nspname = 'api') + (select count(*) from pg_proc where proname in ('fel__ctx', 'fel__exigir_aal2', 'fel__empresa_actual', 'fel__parametros_lista', 'fel__parametro_clase', 'fel__parametro_permiso', 'fel__empresas_con_permiso', 'fel__establecimientos_en_alcance', 'fel__empresas_alcance_total', 'fel__plan_json')) + (select count(*) from public.plataforma_parametros where clave = 'mfa_operaciones_sensibles')")" = 0 ] \
 && { SAL_REV=$(PSQL nexa_revw -At -c "select public.fel__sesion_empresa(null)" 2>&1 || true); grep -q "sesión no válida" <<< "$SAL_REV"; } && echo "OK    reversión de W1–W4: sin esquema api ni ayudantes de Auth; la identidad vuelve a ser solo el token (null ya no abre otra puerta)" || { echo "FALLO: estado tras revertir W1–W4"; PSQL nexa_revw -At -c "select (select count(*) from pg_namespace where nspname = 'api') a, (select count(*) from pg_proc where proname in ('fel__ctx', 'fel__exigir_aal2', 'fel__empresa_actual', 'fel__parametros_lista')) f, (select count(*) from public.plataforma_parametros where clave = 'mfa_operaciones_sensibles') p"; PSQL nexa_revw -At -c "select public.fel__sesion_empresa(null)" 2>&1 | head -3; exit 1; }
# CORTE M-P (nexa_app pierde los 9 protocolos del agente) en una copia: exactamente 9 funciones menos, ninguna fel_sys_*, y el resto de la aplicación como nexa_app sigue funcionando; nexa_sys conserva el protocolo
PSQL postgres -c "create database nexa_corte template nexa_plantilla"; PSQL nexa_corte -f $D/fixture-sesion.sql >/dev/null 2>&1
CUENTA="select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prorettype <> 'trigger'::regtype and p.prokind = 'f' and has_function_privilege('nexa_app', p.oid, 'execute')"
ANTES=$(PSQL nexa_corte -At -c "$CUENTA"); PSQL nexa_corte -f $D/M-P_agente_nivel_sistema.sql >/dev/null; DESPUES=$(PSQL nexa_corte -At -c "$CUENTA")
[ "$((ANTES - DESPUES))" = 9 ] && [ "$(PSQL nexa_corte -At -c "select count(*) from pg_proc p where p.proname like 'fel\\_sys\\_%' and has_function_privilege('nexa_app', p.oid, 'execute')")" = 0 ] || { echo "FALLO: corte M-P ($ANTES -> $DESPUES)"; exit 1; }
PGPASSWORD=prueba-local PSQLAPP nexa_corte -f $D/prueba-sesion-admin.sql 2>&1 | grep -q "PRUEBAS DE SESIÓN VALIDADA OK" && PGPASSWORD=prueba-local PSQLAPP nexa_corte -f $D/prueba-envoltorios.sql 2>&1 | grep -q "PRUEBAS DE ENVOLTORIOS DE SESIÓN OK" && PGPASSWORD=prueba-sys PSQLSYS nexa_corte -f $D/prueba-nexa-sys.sql 2>&1 | grep -q "PRUEBAS DE NEXA_SYS OK" && echo "OK    corte M-P: nexa_app $ANTES -> $DESPUES funciones (−9), sin fel_sys_*; sesión, envoltorios y nexa_sys siguen en verde" || { echo "FALLO: pruebas tras el corte M-P"; PGPASSWORD=prueba-local PSQLAPP nexa_corte -f $D/prueba-sesion-admin.sql 2>&1 | tail -3; PGPASSWORD=prueba-local PSQLAPP nexa_corte -f $D/prueba-envoltorios.sql 2>&1 | tail -3; PGPASSWORD=prueba-sys PSQLSYS nexa_corte -f $D/prueba-nexa-sys.sql 2>&1 | tail -3; exit 1; }
# una tabla nueva con RLS y sin política es invisible para nexa_app (falla cerrado)
PSQL nexa_sesion -c "create table public.zz_nueva (x int); alter table public.zz_nueva enable row level security; insert into public.zz_nueva values (1); grant select on public.zz_nueva to nexa_app;"
[ "$(PGPASSWORD=prueba-local PSQLAPP nexa_sesion -At -c 'select count(*) from public.zz_nueva')" = 0 ] && echo "OK    tabla nueva con RLS y sin política: nexa_app ve 0 filas (falla cerrado)"
PSQL nexa_sesion -c "drop table public.zz_nueva"
# compatibilidad: recorrido real de la nube con la base como nexa_app (aprovisiona el administrador; sirve nexa_app)
if [ "${FEL_SIN_DENO:-}" != 1 ]; then
  ( cd demo-facturacion && FEL_TEST_PG_ADMIN="postgres://postgres@127.0.0.1:$PORT/postgres" FEL_IDENTIDAD_SESION=1 FEL_TEST_PG_ROL_APP="nexa_app:prueba-local" deno test -A tests/rol_app_pg_test.ts 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tail -45 ) | tee /tmp/rol_app_deno.log
  grep -q "ok | 1 passed | 0 failed" /tmp/rol_app_deno.log && echo "OK    compatibilidad de la aplicación con nexa_app" || { echo "FALLO: compatibilidad con nexa_app"; exit 1; }
fi
PSQL postgres -c "drop database if exists nexa_sesion with (force)"
# reversión de M-E
PSQL postgres -c "drop database if exists nexa_revw" -c "drop database if exists nexa_corte" >/dev/null 2>&1   # las copias de las pruebas de reversión y de corte dependen del rol: se retiran antes de revertir M-E
PSQL nexa_plantilla -f $D/reversion-M-E.sql >/dev/null 2>&1 || { PSQL postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where usename='nexa_app'" >/dev/null; PSQL nexa_plantilla -f $D/reversion-M-E.sql >/dev/null; }
[ "$(PSQL nexa_plantilla -At -c "select count(*) from pg_roles where rolname='nexa_app'")" = 0 ] && echo "OK    reversión de M-E: el rol y sus políticas desaparecen"
echo "ROL nexa_app (SQL) OK"
