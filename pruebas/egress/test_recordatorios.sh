#!/usr/bin/env bash
# Prueba LOCAL de: (1) la lectura mínima de las tareas programadas (equivalencia con los planes completos en los 3 modos), (2) la rotación del secreto (fase 1 y fase 2 sobre un pg_cron simulado).
set -euo pipefail
cd "$(dirname "$0")/../.."
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}; D=/tmp/eg-rec-pg-$$; PORT=$((57300 + RANDOM % 150)); A=supabase/auto; T=/tmp/rec_$$; mkdir -p $T
id pgtest >/dev/null 2>&1 || useradd -m pgtest
su pgtest -s /bin/bash -c "mkdir -p '$D' && '$PGBIN/initdb' -D '$D' -A trust -U postgres >/dev/null && '$PGBIN/pg_ctl' -D '$D' -o '-p $PORT -k /tmp -c listen_addresses=' -w -l '$D/log' start >/dev/null"
trap 'su pgtest -s /bin/bash -c "'"$PGBIN"'/pg_ctl -D '"$D"' -m immediate stop >/dev/null" || true; rm -rf "$D" $T' EXIT
"$PGBIN/psql" -h /tmp -p $PORT -U postgres -d postgres -q -X -c "create database nexa"
Q() { "$PGBIN/psql" -h /tmp -p $PORT -U postgres -d nexa -v ON_ERROR_STOP=1 -q -X "$@"; }
ok() { echo "OK    $1"; }; fallo() { echo "FALLO $1"; exit 1; }
Q -c "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create table public.pa_docs (col text, id text, data jsonb, updated_at timestamptz default now(), primary key (col, id)); alter table public.pa_docs enable row level security; grant all on public.pa_docs to service_role"
python3 - $T <<'PY'
import json, random, sys
random.seed(7); T = sys.argv[1]; rows = []
sts = ['Pendiente', 'Rechazada', 'Enviada', 'Aprobada', 'Cancelada', None]
for i in range(300):
    st = random.choice(['En proceso'] * 3 + ['Completado'] * 4 + ['Cancelado', 'Borrador', None]); typ = random.choice(['Inventarios', 'Inventarios', 'Limpieza', 'Seguridad', None])
    acts = []
    for k in range(random.randint(0, 7)):
        a = {'id': f'a{k}', 'st': random.choice(sts), 'deadline': random.choice([f'2026-11-{random.randint(15,30)}', f'2026-12-0{random.randint(1,5)}', None, '']), 'dr': random.choice([None, None, True, 1]),
             'name': 'x' * 200, 'ev': {'t': 'data:image/jpeg;base64,' + 'A' * 3000}, 'tl': [[random.choice(['a', 'e', 'x', 'c']), 1795000000000 + random.randint(0, 900000000), 'u1'] for _ in range(random.randint(0, 5))] + (['basura', None, {'o': 1}] if random.random() < .2 else [])}
        if random.random() < .1: a.pop('tl')
        acts.append(a)
    p = {'id': f'P{i:04d}', 'status': st, 'type': typ, 'region': random.choice([1, 2, '2', 3]), 'branch': random.choice(['Mixco', 'Zona 1', 'Antigua', 'Escuintla']), 'acts': acts, 'obs': 'y' * 500}
    if random.random() < .5: p['sent'] = True
    if random.random() < .4: p['sentAt'] = 1795000000000 + random.randint(0, 900000000)
    if random.random() < .03: p.pop('acts')
    rows.append(('plans', p['id'], p))
rows.append(('plans', 'RARO1', [1, 2])); rows.append(('plans', 'RARO2', 'texto'))
roles = ['sucursal', 'supervisor', 'admin', 'inventarios']
for i in range(40):
    u = {'role': roles[i % 4], 'region': random.choice([1, 2, '2']), 'branch': random.choice(['Mixco', 'Zona 1', 'Antigua', 'Escuintla']), 'pw': 'secreto-de-prueba', 'foto': 'z' * 2000}
    if i % 4 == 3 and i % 8 == 3: u['assigned'] = [f'u{j}' for j in range(0, 40, 3)]
    rows.append(('users', f'u{i}', u))
rows.append(('users', 'uvacio', {}))
nts = [{'id': f'n{i}', 'pid': f'P{random.randint(0,299):04d}', 'text': 'Nuevo plan X', 'to': [f'u{j}' for j in range(0, 40, 4)], 'read': [f'u{j}' for j in range(0, 40, 8)], 'ts': 1795000000000 + random.randint(0, 900000000)} for i in range(80)]
for n in nts: rows.append(('notifs', n['id'], n))
json.dump(nts, open(T + '/notifs.json', 'w'))
def q(v): return "'" + json.dumps(v).replace("'", "''") + "'::jsonb"
open(T + '/datos.sql', 'w').write('\n'.join(f"insert into public.pa_docs (col,id,data) values ('{c}','{i}',{q(d)});" for c, i, d in rows))
PY
Q -f $T/datos.sql; Q -f $A/recordatorios_lectura_minima.sql >/dev/null && ok "la función de lectura mínima se crea"
Q -At -c "select json_agg(data order by id) from public.pa_docs where col='plans'" > $T/completo.json
Q -At -c "select json_agg(json_build_object('id', id, 'role', data->>'role', 'region', data->>'region', 'branch', data->>'branch', 'assigned', data->'assigned') order by id) from public.pa_docs where col='users'" > $T/usuarios.json
for m in recordatorios unread badge; do Q -At -c "select public.nexa_recordatorios_planes('$m')" > $T/min_$m.json; done
echo '[]' > $T/descargados.json; Q -At -c "insert into public.pa_docs select 'x','x','{}'" >/dev/null 2>&1 || true
python3 - $T <<'PY'
import json, sys; T = sys.argv[1]
c = json.load(open(T + '/completo.json')); json.dump([p['id'] for p in c if isinstance(p, dict) and p.get('id') and hash(p['id']) % 5 == 0], open(T + '/descargados.json', 'w'))
PY
deno run -A pruebas/egress/recordatorios_equiv.ts $T | tee $T/eq.txt | grep -E "FALLO|EQUIV|planes_completos" && grep -q "EQUIVALENCIA OK" $T/eq.txt && ok "mismos avisos y contadores con la lectura mínima que con los planes completos (3 modos, 4 fechas, 2 turnos, con y sin envío a Inventarios)" || fallo "equivalencia"
python3 - $T <<'PY' && ok "la lectura mínima pesa una fracción de los planes completos" || fallo "tamaño"
import json, re, sys
l = [l for l in open(sys.argv[1] + '/eq.txt') if l.startswith('{')][0]; v = json.loads(l)
assert v['kb_badge'] * 5 < v['kb_completo'] and v['kb_recordatorios'] <= v['kb_unread'] <= v['kb_badge'] and v['planes_recordatorios'] < v['planes_completos'], v
print(' ', {k: v[k] for k in ('planes_completos', 'planes_recordatorios', 'planes_unread', 'planes_badge', 'kb_completo', 'kb_recordatorios', 'kb_unread', 'kb_badge')})
PY
Q -c "set role anon; select public.nexa_recordatorios_planes('badge')" >/dev/null 2>&1 && fallo "anon pudo ejecutar la lectura mínima" || ok "anon no puede ejecutar la lectura mínima"
Q -c "set role authenticated; select public.nexa_recordatorios_planes('badge')" >/dev/null 2>&1 && fallo "authenticated pudo ejecutarla" || ok "authenticated no puede ejecutarla"
# ---- rotación del secreto ----
Q -c "create schema cron; create table cron.job (jobid bigserial primary key, jobname text, schedule text, command text, active boolean default true);
create function cron.alter_job(job_id bigint, schedule text default null, command text default null, database text default null, username text default null, active boolean default null) returns void language sql as \$\$ update cron.job set schedule = coalesce(\$2, cron.job.schedule), command = coalesce(\$3, cron.job.command) where jobid = \$1 \$\$;"
OLD="select net.http_post(
  url := 'https://zzz.supabase.co/functions/v1/recordatorios-de-nexa',
  headers := '{\"Content-Type\":\"application/json\",\"x-cron-secret\":\"VIEJO-SECRETO-DE-PRUEBA\"}'::jsonb,
  body := '%s'::jsonb);"
mk() { Q -c "insert into cron.job (jobname, schedule, command) values ('$1', '$2', \$q\$$(printf "$OLD" "$3")\$q\$)"; }
mk am '30 14 * * *' '{"slot":"am"}'; mk pm '0 19 * * *' '{"slot":"pm"}'; mk nexa-sin-leer '0 13-23,0,1 * * *' '{"mode":"unread"}'
Q -At -f $A/cron_secret_fase1.sql | tail -1 > $T/f1.json
python3 - $T/f1.json <<'PY' && ok "fase 1: secreto de 64 caracteres guardado, sin acceso para anon/authenticated, RLS activa, comprobación rechaza lo falso" || fallo "fase 1"
import json, sys; v = json.loads(open(sys.argv[1]).read())
assert v['secreto_guardado'] and v['longitud_del_secreto'] == 64 and not v['anon_puede_leer_tabla'] and not v['authenticated_puede_leer_tabla'] and not v['anon_puede_ejecutar_comprobacion'] and not v['authenticated_puede_ejecutar_comprobacion'] and v['service_role_puede_ejecutar_comprobacion'] and v['rls_activa'] and v['comprobacion_rechaza_texto_falso'], v
PY
S1=$(Q -At -c "select valor from public.nexa_cron_secret"); Q -At -f $A/cron_secret_fase1.sql >/dev/null; [ "$(Q -At -c "select valor from public.nexa_cron_secret")" = "$S1" ] && ok "la fase 1 es idempotente (no vuelve a cambiar el secreto)" || fallo "fase 1 regeneró el secreto"
[ "$(Q -At -c "select public.nexa_cron_check('$S1')")" = t ] && [ "$(Q -At -c "select public.nexa_cron_check('VIEJO-SECRETO-DE-PRUEBA')")" = f ] && ok "el secreto nuevo se acepta y el viejo se rechaza" || fallo "comprobación del secreto"
Q -c "set role anon; select count(*) from public.nexa_cron_secret" >/dev/null 2>&1 && fallo "anon leyó el secreto" || ok "anon no puede leer la tabla del secreto"
# con 3 tareas (no 4) la fase 2 debe DESHACERSE
if Q -f $A/cron_secret_fase2.sql >/dev/null 2>&1; then fallo "fase 2 se aplicó con 3 tareas"; else ok "fase 2 se detiene si no hay exactamente 4 tareas"; fi
[ "$(Q -At -c "select count(*) from cron.job where command like '%VIEJO-SECRETO%'")" = 3 ] && ok "y no cambió ninguna tarea" || fallo "se modificó una tarea pese al error"
mk nexa-badge '*/15 12-23,0-1 * * *' '{"mode":"badge"}'
Q -c "insert into cron.job (jobname, schedule, command) values ('otra', '0 0 * * *', 'select 1')"
SCH=$(Q -At -c "select string_agg(jobid || schedule, '|' order by jobid) from cron.job")
Q -At -f $A/cron_secret_fase2.sql | tail -1 > $T/f2.json
python3 - $T/f2.json <<'PY' && ok "fase 2: 4 tareas leen el secreto de la base, ya sin secreto escrito, con espera de 60 s y el mismo cuerpo" || fallo "fase 2"
import json, sys; v = json.loads(open(sys.argv[1]).read())['tareas']
assert len(v) == 4 and all(not t['secreto_escrito_en_el_comando'] and t['lee_secreto_de_la_base'] and t['espera_60s'] and t['activa'] for t in v), v
assert [t['cuerpo'] for t in v] == ['{"slot":"am"}', '{"slot":"pm"}', '{"mode":"unread"}', '{"mode":"badge"}'], v
PY
[ "$(Q -At -c "select string_agg(jobid || schedule, '|' order by jobid) from cron.job")" = "$SCH" ] && ok "los horarios no cambiaron" || fallo "cambió un horario"
[ "$(Q -At -c "select command from cron.job where jobname='otra'")" = "select 1" ] && ok "las tareas ajenas no se tocaron" || fallo "tocó otra tarea"
[ "$(Q -At -c "select count(*) from cron.job where command like '%VIEJO-SECRETO%'")" = 0 ] && ok "el secreto anterior ya no está en ningún comando" || fallo "queda el secreto viejo"
Q -At -f $A/cron_secret_fase2.sql >/dev/null && [ "$(Q -At -c "select count(*) from cron.job where command like '%nexa_cron_secret%'")" = 4 ] && ok "la fase 2 es idempotente" || fallo "fase 2 no idempotente"
# el comando generado es SQL válido y entrega el secreto correcto como cabecera
Q -c "create schema net; create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns bigint language plpgsql as \$\$ begin if headers->>'x-cron-secret' is distinct from (select valor from public.nexa_cron_secret) or timeout_milliseconds <> 60000 then raise exception 'cabecera incorrecta'; end if; return 1; end \$\$;"
for id in $(Q -At -c "select jobid from cron.job where command like '%nexa_cron_secret%'"); do Q -At -c "$(Q -At -c "select command from cron.job where jobid=$id")" >/dev/null || fallo "el comando de la tarea $id no ejecuta"; done; ok "los 4 comandos nuevos se ejecutan y envían el secreto de la base con espera de 60 s"
echo "RECORDATORIOS OK"
