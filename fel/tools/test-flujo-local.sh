#!/usr/bin/env bash
# Pruebas del flujo individual SIMULADO (orquestador TypeScript + proveedor mock) contra un PostgreSQL temporal con las migraciones reales.
# Sin Docker, sin red, sin credenciales, sin tocar ningún proyecto de Supabase. En GitHub Actions se usa el Supabase local efímero (puerto 54322).
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DATA=${FEL_PGDATA:-/tmp/fel-pgdata-flujo}
PORT=${FEL_PGPORT:-54398}
SOCK=/tmp
as_pg() { if [ "$(id -u)" = 0 ]; then su pgtest -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
if [ "$(id -u)" = 0 ] && ! id pgtest >/dev/null 2>&1; then useradd -m pgtest; fi
as_pg "rm -rf '$DATA' && mkdir -p '$DATA' && '$PGBIN/initdb' -D '$DATA' -A trust -U postgres >/dev/null"
as_pg "'$PGBIN/pg_ctl' -D '$DATA' -o '-p $PORT -k $SOCK -c listen_addresses=' -w -l '$DATA/log' start >/dev/null"
trap 'as_pg "'"$PGBIN"'/pg_ctl -D '"$DATA"' -m immediate stop >/dev/null" || true' EXIT
PSQL=("$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -f tools/shim_supabase.sql
for f in supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f" >/dev/null; done
# FEL_PROPUESTAS=1: además aplica TODAS las propuestas multiempresa (M-D…M-S) para comprobar que ninguna rompe el flujo existente (regresión de proveedores/pruebas_db)
if [ "${FEL_PROPUESTAS:-0}" = 1 ]; then
  for f in M-D_permisos M-A_emisor_fiscal M-B_digifact_config M-C_acceso_maestro M-F_establecimientos_usuario M-G_sesion_admin M-H_admin_establecimientos M-I_envoltorios_sesion M-J_plataforma_y_auditoria M-K_sistema_nexa_sys M-L_rls_sesion_viva M-M_identidad_auth M-N_esquema_api M-O_lecturas_api M-Q_agente_endurecimiento M-R_parametros_clases M-S_lecturas_documentos M-T_lecturas_restantes M-U_lecturas_paginadas M-V1_lecturas_de_sistema M-V_cierre_r3 M-E_rol_app M-P_agente_nivel_sistema; do "${PSQL[@]}" -f docs/multiempresa/propuesta/$f.sql >/dev/null 2>&1 || { echo "FALLO al aplicar $f"; exit 1; }; done
  echo "propuestas M-D…M-S, M-E y M-P aplicadas"
fi
echo "migraciones aplicadas; ejecutando las pruebas del flujo (Deno)…"
cd proveedores
FEL_PGHOST="$SOCK" FEL_PGPORT="$PORT" FEL_PGUSER=postgres FEL_PGDATABASE=postgres deno test -A ${FEL_DENO_ARGS:-pruebas_db/}
echo "FLUJO OK"
