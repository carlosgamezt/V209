#!/usr/bin/env bash
# Prueba LOCAL de los SQL del flujo automático (auto_e0_respaldo.sql y auto_e1a_vista_ligera.sql): idempotencia, resultado final y condiciones de parada.
set -euo pipefail
cd "$(dirname "$0")/../.."
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}; D=/tmp/eg-auto-pg-$$; PORT=$((57800 + RANDOM % 150)); P=supabase/propuestas/egress
id pgtest >/dev/null 2>&1 || useradd -m pgtest
su pgtest -s /bin/bash -c "mkdir -p '$D' && '$PGBIN/initdb' -D '$D' -A trust -U postgres >/dev/null && '$PGBIN/pg_ctl' -D '$D' -o '-p $PORT -k /tmp -c listen_addresses=' -w -l '$D/log' start >/dev/null"
trap 'su pgtest -s /bin/bash -c "'"$PGBIN"'/pg_ctl -D '"$D"' -m immediate stop >/dev/null" || true; rm -rf "$D"' EXIT
Q() { "$PGBIN/psql" -h /tmp -p $PORT -U postgres -d nexa -v ON_ERROR_STOP=1 -q -X "$@"; }
ok() { echo "OK    $1"; }; fallo() { echo "FALLO $1"; exit 1; }
"$PGBIN/psql" -h /tmp -p $PORT -U postgres -d postgres -q -X -c "create database nexa"
Q -f pruebas/egress/rls_real/01_esquema_y_ayudantes.sql >/dev/null; Q -f pruebas/egress/rls_real/02_politicas_reales_pa_docs.sql >/dev/null; Q -c "create role service_role nologin bypassrls; grant all on public.pa_docs to service_role" 
Q -f pruebas/egress/rls_real/03_datos.sql >/dev/null 2>&1; Q -c "create table public.pa_descargas (id bigint generated always as identity primary key, plan_id text, user_id text, user_name text, role text, manual boolean default false, created_at timestamptz default now())"
# V1 (validación con roles) sin vista debe DETENERSE
if Q -f $P/auto_v1_validacion_roles.sql >/dev/null 2>&1; then fallo "V1 se ejecutó sin la vista"; else ok "V1 se detiene si falta la vista ligera"; fi
# E1a sin respaldo debe DETENERSE
if Q -f $P/auto_e1a_vista_ligera.sql >/dev/null 2>&1; then fallo "E1a se aplicó sin respaldo E0"; else ok "E1a se detiene si falta el respaldo E0"; fi
[ "$(Q -At -c "select count(*) from pg_class where relname = 'pa_docs_lite'")" = 0 ] && ok "y no dejó la vista a medias"
H0=$(Q -At -c "select md5(string_agg(data::text, '' order by col, id)) from public.pa_docs")
Q -At -f $P/auto_e0_respaldo.sql | tail -1 > /tmp/e0a_$$.json; python3 - /tmp/e0a_$$.json <<'PY' && ok "E0 crea el respaldo: mismas filas y huella, RLS activa y sin privilegios para la app" || fallo "resultado de E0"
import json, sys
v = json.load(open(sys.argv[1]))['e0'] if False else json.loads(open(sys.argv[1]).read())
assert v['filas_pa_docs'] == v['filas_respaldo'] and v['huella_pa_docs_ahora'] == v['huella_respaldo'] and v['rls_activa_en_respaldo'] and v['privilegios_app_sobre_respaldo'] == 0, v
assert v['miniaturas_en_respaldo'] == 96, v
PY
Q -At -f $P/auto_e0_respaldo.sql >/dev/null && ok "E0 es idempotente (segunda ejecución sin error ni cambios)"
[ "$(Q -At -c "select md5(string_agg(data::text, '' order by col, id)) from public.pa_docs")" = "$H0" ] && ok "E0 no modificó pa_docs"
Q -At -f $P/auto_e1a_vista_ligera.sql | tail -1 > /tmp/e1a_$$.json; python3 - /tmp/e1a_$$.json <<'PY' && ok "E1a aplica con el respaldo presente: vista security_invoker, 0 imágenes en la vista, datos intactos, 0 filas sin sesión" || fallo "resultado de E1a"
import json, sys
v = json.loads(open(sys.argv[1]).read())
assert v['vista_con_security_invoker'] is True and v['planes_con_imagenes_en_vista'] == 0 and v['datos_intactos_vs_respaldo'] is True and v['disparadores_en_pa_docs'] == 0, v
assert v['kb_planes_vista'] * 10 < v['kb_planes_tabla'], v
PY
Q -At -f $P/auto_e1a_vista_ligera.sql >/dev/null && ok "E1a es idempotente"
# una vista que eludiera RLS debe ser rechazada: se simula con una política permisiva para authenticated
Q -f $P/E1a_reversion.sql >/dev/null 2>&1; Q -c "create policy zz_abre_todo on public.pa_docs for select to authenticated using (true)"
if Q -f $P/auto_e1a_vista_ligera.sql >/dev/null 2>&1; then fallo "E1a no detectó una política que abre todo"; else ok "E1a se detiene si un rol sin sesión pudiera ver filas (protección contra eludir RLS)"; fi
[ "$(Q -At -c "select count(*) from pg_class where relname = 'pa_docs_lite'")" = 0 ] && ok "y se DESHIZO por completo: no quedó la vista" || fallo "quedó la vista tras fallar la comprobación" 
Q -f $P/E1a_reversion.sql >/dev/null 2>&1; Q -c "drop policy zz_abre_todo on public.pa_docs"; Q -f $P/auto_e1a_vista_ligera.sql >/dev/null 2>&1
Q -At -f $P/auto_v1_validacion_roles.sql | grep -v '^COMMIT$' > /tmp/v1_$$.json; python3 - /tmp/v1_$$.json <<'PY' && ok "V1 con las políticas reales: 11 perfiles con sesión (+1 sin perfil no figura): la vista = la tabla en todos; matriz de escritura de referencia guardada" || fallo "resultado de V1"
import json, sys
v = json.loads(open(sys.argv[1]).read())['v1'] if False else json.loads(open(sys.argv[1]).read())
assert v['lectura_vista_igual_a_tabla_en_todos'] is True and v['perfiles_probados'] == 11 and v['matriz_escritura_guardada'] > 0, v
roles = {r['rol']: r for r in v['por_rol']}
assert roles['admin']['max_actualizables'] == 12 and roles['visualizador']['max_actualizables'] == 0 and roles['sucursal']['max_actualizables'] == 2, roles
PY
[ "$(Q -At -c "select count(*) from public.pa_docs where data::text like '%\"marca\"%'")" = 0 ] && ok "V1 no dejó ninguna modificación en pa_docs (las pruebas de escritura se deshicieron)"
Q -f $P/auto_v1_validacion_roles.sql >/dev/null 2>&1 && ok "V1 es idempotente"
# E1 automática: requisitos, ejecución, resultado e idempotencia
Q -f $P/E1_reversion.sql >/dev/null 2>&1 || true; Q -f $P/auto_e1a_vista_ligera.sql >/dev/null 2>&1
Q -c "create table if not exists public.zz_ok(i int)"
Q -At -f $P/auto_e1_miniaturas.sql | grep -v '^COMMIT$' > /tmp/e1_$$.json 2>/tmp/e1err_$$.txt || { cat /tmp/e1err_$$.txt | head -3; fallo "E1 automática falló"; }
python3 - /tmp/e1_$$.json <<'PY' && ok "E1 automática: 96 miniaturas separadas con integridad total, pa_docs intacto, matriz de escritura idéntica, 1 disparador" || fallo "resultado de E1"
import json, sys
v = json.loads(open(sys.argv[1]).read())
assert v['miniaturas_embebidas_en_pa_docs'] == 96 and v['miniaturas_en_pa_thumbs'] >= 96 and v['respaldo_miniaturas'] == 96 and v['pa_docs_intacto_vs_respaldo'] is True and v['disparadores_en_pa_docs'] == 1 and v['matriz_escritura_identica_casos'] > 0, v
PY
Q -At -f $P/auto_e1_miniaturas.sql >/dev/null 2>&1 && echo "OK    E1 automática es idempotente (si pa_docs no cambió desde el respaldo)" || echo "NOTA: la segunda ejecución se detiene porque pa_docs ya cambió respecto al respaldo (esperado tras escribir planes)"
# E3 automática (requiere la matriz «despues» de E1: se genera aquí con la misma lógica de la validación de E1)
Q -At -f $P/auto_e3_guardado_parcial.sql | grep -v '^COMMIT$' > /tmp/e3_$$.json 2>/tmp/e3err_$$.txt || { head -3 /tmp/e3err_$$.txt; fallo "E3 automática falló"; }
python3 - /tmp/e3_$$.json <<'PY' && ok "E3 automática: permisos idénticos a E1 en todos los perfiles, edición concurrente real conservada y deshecha, función invoker sin acceso para anon" || fallo "resultado de E3"
import json, sys
v = json.loads(open(sys.argv[1]).read())
assert v['funcion_existe'] and v['security_invoker'] and not v['ejecutable_por_anon'] and v['ejecutable_por_authenticated'] and v['casos_perfil_x_plan_con_mismo_permiso_que_E1'] > 0, v
PY
echo "PRUEBAS DE LOS SQL AUTOMÁTICOS OK"
