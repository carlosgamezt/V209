#!/usr/bin/env bash
# Prueba LOCAL de las funciones SQL de super-api: (1) nexa_foto_acceso contra las políticas REALES de pa_docs (réplica rls_real) y (2) nexa_push_pendientes contra el cálculo de referencia de super-api.
set -euo pipefail
cd "$(dirname "$0")/../.."
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}; D=/tmp/eg-sa-pg-$$; PORT=$((57450 + RANDOM % 150)); R=pruebas/egress/rls_real; A=supabase/auto; T=/tmp/sa_$$; mkdir -p $T
id pgtest >/dev/null 2>&1 || useradd -m pgtest
su pgtest -s /bin/bash -c "mkdir -p '$D' && '$PGBIN/initdb' -D '$D' -A trust -U postgres >/dev/null && '$PGBIN/pg_ctl' -D '$D' -o '-p $PORT -k /tmp -c listen_addresses=' -w -l '$D/log' start >/dev/null"
trap 'su pgtest -s /bin/bash -c "'"$PGBIN"'/pg_ctl -D '"$D"' -m immediate stop >/dev/null" || true; rm -rf "$D" $T' EXIT
"$PGBIN/psql" -h /tmp -p $PORT -U postgres -d postgres -q -X -c "create database nexa" -c "create database push"
Q() { "$PGBIN/psql" -h /tmp -p $PORT -U postgres -d nexa -v ON_ERROR_STOP=1 -q -X "$@"; }
ok() { echo "OK    $1"; }; fallo() { echo "FALLO $1"; exit 1; }
Q -f $R/01_esquema_y_ayudantes.sql >/dev/null; Q -f $R/02_politicas_reales_pa_docs.sql >/dev/null; Q -f $R/03_datos.sql >/dev/null 2>&1
Q -c "create role service_role nologin bypassrls; grant all on public.pa_docs to service_role; grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated; grant select on public.pa_profiles to authenticated"
Q -At -f $A/super_api_funciones.sql | grep -v '^COMMIT$' > $T/sa.json 2>$T/err.txt || { head -3 $T/err.txt; fallo "la migración de super-api se deshizo"; }
python3 - $T/sa.json <<'PY' && ok "foto_acceso coincide con los permisos reales de lectura y escritura en todos los perfiles × todos los planes; permisos de ejecución correctos" || fallo "resultado de la migración"
import json, sys; v = json.loads(open(sys.argv[1]).read())
assert v['casos_perfil_x_plan_comprobados'] >= 100 and v['casos_donde_alguien_puede_escribir'] > 0 and v['casos_donde_alguien_puede_leer'] > v['casos_donde_alguien_puede_escribir'], v
assert not v['foto_acceso_ejecutable_por_anon'] and not v['push_pendientes_ejecutable_por_authenticated'] and v['push_pendientes_ejecutable_por_service_role'], v
PY
Q -At -f $A/super_api_funciones.sql >/dev/null && ok "la migración es idempotente"
# plan automático con espacios en el número («PA-2026-045 - AUTO»): la app guarda los archivos con el nombre saneado
Q -c "insert into public.pa_docs (col, id, data) values ('plans', 'PA-2026-045 - AUTO', jsonb_build_object('id', 'PA-2026-045 - AUTO', 'region', '1', 'branch', 'b11', 'type', 'Operaciones', 'status', 'En proceso', 'acts', jsonb_build_array(jsonb_build_object('text', 'A', 'st', 'Enviada', 'ev', jsonb_build_object('k', 'PA-2026-045 - AUTO#ev0#1792703892149', 'o', 1, 'x', 'jpg')))))"
# casos concretos con las políticas reales
Q -At > $T/casos.txt <<'SQL'
create temp table r (u text, ev_lee boolean, ev_escribe boolean, ref_lee_propia boolean, ref_lee_ajena boolean, ref_escribe boolean, auto_lee_clave boolean, auto_lee_plan boolean, auto_escribe boolean);
do $$ declare z record; a boolean; b boolean; c boolean; d boolean; e boolean; f boolean; g boolean; h boolean; begin
 for z in select * from public.zz_u loop
  execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub', z.uid::text, true);
  a := public.nexa_foto_acceso('ev', 'PA-111', 'ev#111-1', false); b := public.nexa_foto_acceso('ev', 'PA-111', null, true);
  c := public.nexa_foto_acceso('ref', null, 'ref#111-1', false); d := public.nexa_foto_acceso('ref', null, 'ref#311-1', false); e := public.nexa_foto_acceso('ref', null, null, true);
  f := public.nexa_foto_acceso('ev', 'PA-2026-045_-_AUTO', 'PA-2026-045_-_AUTO#ev0#1792703892149', false); g := public.nexa_foto_acceso('ev', 'PA-2026-045 - AUTO', null, false); h := public.nexa_foto_acceso('ev', 'PA-2026-045_-_AUTO', null, true);
  execute 'reset role'; insert into r values (z.u, a, b, c, d, e, f, g, h);
 end loop; end $$;
select u || ':' || ev_lee || '/' || ev_escribe || '/' || ref_lee_propia || '/' || ref_lee_ajena || '/' || ref_escribe || '/' || auto_lee_clave || '/' || auto_lee_plan || '/' || auto_escribe from r order by u;
SQL
python3 - $T/casos.txt <<'PY' && ok "casos concretos: sucursal propia lee y escribe, otra sucursal NO; visualizador NO escribe; sin perfil NO accede; supervisor de otra región en modo «ver» lee y NO escribe" || fallo "casos concretos"
import sys
d = {l.split(':')[0]: [x == 'true' for x in l.strip().split(':')[1].split('/')] for l in open(sys.argv[1]) if ':' in l}
# PA-111 = región 1, sucursal b11
assert d['suc11'][:2] == [True, True], d['suc11']
assert d['suc21'][:2] == [False, False], d['suc21']          # otra sucursal/región
assert d['sinperfil'][:5] == [False] * 5, d['sinperfil']
assert d['vis'][0] and not d['vis'][1], d['vis']   # visualizador: lectura sí, escritura no (analista/gerencia: según la política real)
assert d['admin'][:2] == [True, True] and d['sup1'][:2] == [True, True], d
assert d['supx'][0] and not d['supx'][1], d['supx']          # región 1 en modo «ver»
assert d['suc21'][3] is False and d['suc11'][2] is True, d   # foto de referencia: visible solo si algún plan visible la referencia
assert d['suc11'][5:] == [True, True, True] and d['admin'][5:] == [True, True, True] and d['suc21'][5:] == [False, False, False] and d['sinperfil'][5:] == [False, False, False], ('plan con espacios', d['suc11'][5:], d['suc21'][5:])
assert d['admin'][4] and d['sup1'][4] and d['com1'][4] and not d['suc11'][4] and not d['vis'][4] and not d['sinperfil'][4], d   # quién puede crear planes
PY
# ---- contadores del aviso fijo ----
"$PGBIN/psql" -h /tmp -p $PORT -U postgres -d push -q -X -c "create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid'; create table public.pa_profiles (auth_id uuid primary key, user_id text, role text, region text, branch text, assigned jsonb); create table public.pa_docs (col text, id text, data jsonb, updated_at timestamptz default now(), primary key (col, id))"
python3 - $T <<'PY'
import json, random, sys; random.seed(11); T = sys.argv[1]; rows = []
st = ['Pendiente', 'Rechazada', 'Enviada', 'Aprobada', None]
for i in range(260):
    p = {'id': f'P{i:03d}', 'status': random.choice(['En proceso'] * 4 + ['Completado'] * 3 + ['Informe enviado', 'Pendiente de envío', 'Cancelado', None]), 'type': random.choice(['Inventarios', 'Inventarios', 'Operaciones', None]),
         'region': random.choice([1, 2, '2', 3, None]), 'branch': random.choice(['A', 'B', 'C', None]), 'acts': [{'st': random.choice(st), 'x': 'y' * 50} for _ in range(random.randint(0, 6))]}
    if random.random() < .04: p.pop('acts')
    rows.append(('plans', p['id'], p))
roles = ['sucursal', 'supervisor', 'admin', 'analista', 'gerencia', 'inventarios', 'comodin', 'visualizador', 'otro']
for i in range(90): rows.append(('users', f'u{i}', {'role': roles[i % 9], 'region': random.choice([1, 2, '2', 3]), 'branch': random.choice(['A', 'B', 'C']), 'name': 'n' * 40}))
rows.append(('users', 'usinrol', {}))
cfg = {'watch': {'u3': {'all': True}, 'u12': {'regs': [1, '3']}, 'u21': {'regs': ['2']}, 'u30': {'all': False, 'regs': [2]}, 'u39': {}}, 'invReview': False}
open(T + '/cfg_off.json', 'w').write(json.dumps(cfg)); cfg['invReview'] = True; open(T + '/cfg_on.json', 'w').write(json.dumps(cfg))
def q(v): return "'" + json.dumps(v).replace("'", "''") + "'::jsonb"
open(T + '/datos.sql', 'w').write('\n'.join(f"insert into public.pa_docs (col,id,data) values ('{c}','{i}',{q(d)});" for c, i, d in rows))
json.dump([f'u{i}' for i in range(90)] + ['usinrol', 'noexiste'], open(T + '/ids.json', 'w'))
PY
QP() { "$PGBIN/psql" -h /tmp -p $PORT -U postgres -d push -v ON_ERROR_STOP=1 -q -X "$@"; }
QP -f $T/datos.sql; QP -f $A/super_api_funciones.sql >/dev/null
for modo in off on; do
  QP -c "delete from public.pa_docs where col='meta' and id='cfg'" -c "insert into public.pa_docs (col,id,data) values ('meta','cfg','$(cat $T/cfg_$modo.json)'::jsonb)"
  QP -At -c "select json_agg(data order by id) from public.pa_docs where col='plans'" > $T/planes.json
  QP -At -c "select json_agg(json_build_object('id', id, 'data', data) order by id) from public.pa_docs where col='users'" > $T/usuarios.json
  QP -At -c "select data from public.pa_docs where col='meta' and id='cfg'" > $T/cfg.json
  IDS=$(python3 -c "import json;print('{'+','.join(json.load(open('$T/ids.json')))+'}')")
  QP -At -c "select public.nexa_push_pendientes('$IDS'::text[])" > $T/pg.json
  node pruebas/egress/push_ref.cjs $T > $T/ref.txt && ok "contadores del aviso fijo en SQL = cálculo anterior de super-api para los 9 roles (invReview=$modo): $(tail -1 $T/ref.txt)" || { cat $T/ref.txt | head -5; fallo "contadores (invReview=$modo)"; }
done
echo "SUPER-API SQL OK"
