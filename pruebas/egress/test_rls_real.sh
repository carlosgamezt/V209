#!/usr/bin/env bash
# Prueba E1 contra las POLÍTICAS REALES de pa_docs (rls_real/02_*.sql). Las funciones auxiliares son sustitutos hasta recibir politicas_rls.sql.
set -euo pipefail
cd "$(dirname "$0")/../.."
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}; D=/tmp/eg-rls-pg-$$; PORT=$((57600 + RANDOM % 300)); R=pruebas/egress/rls_real; P=supabase/propuestas/egress
id pgtest >/dev/null 2>&1 || useradd -m pgtest
su pgtest -s /bin/bash -c "mkdir -p '$D' && '$PGBIN/initdb' -D '$D' -A trust -U postgres >/dev/null && '$PGBIN/pg_ctl' -D '$D' -o '-p $PORT -k /tmp -c listen_addresses=' -w -l '$D/log' start >/dev/null"
trap 'su pgtest -s /bin/bash -c "'"$PGBIN"'/pg_ctl -D '"$D"' -m immediate stop >/dev/null" || true; rm -rf "$D"' EXIT
"$PGBIN/psql" -h /tmp -p $PORT -U postgres -d postgres -q -X -c "create database nexa"
Q() { "$PGBIN/psql" -h /tmp -p $PORT -U postgres -d nexa -v ON_ERROR_STOP=1 -q -X "$@"; }
Q -f $R/01_esquema_y_ayudantes.sql; Q -f $R/02_politicas_reales_pa_docs.sql; echo "OK    8 políticas reales de pa_docs cargadas sobre la réplica"
Q -f $R/03_datos.sql >/dev/null 2>&1; Q -c "select public.zz_matriz('pre')"; echo "OK    matriz de escritura ANTES de E1 (12 usuarios × 12 planes)"
Q -c "create table public.pa_descargas (id bigint generated always as identity primary key, plan_id text, user_id text, user_name text, role text, manual boolean default false, created_at timestamptz default now())" ; Q -f $P/E0_respaldo.sql 2>&1 | grep -q "E0 OK" && echo "OK    E0 (respaldo) sobre la réplica"
Q -c "create role service_role nologin bypassrls; grant all on public.pa_docs to service_role"
Q -f $P/E1a_vista_ligera.sql >/dev/null 2>&1 && echo "OK    E1a (solo la vista ligera) aplicada sobre la réplica con las políticas reales"
Q <<'SQL' 2>&1 | grep -E "NOTICE:  OK|ERROR" | sed 's/^psql:[^ ]* NOTICE:  //;s/^.*NOTICE:  //'
do $$ declare u record; a text[]; b text[]; begin
  for u in select * from public.zz_u loop
    execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub', u.uid::text, true);
    select coalesce(array_agg(col || '|' || id order by col, id), '{}') into a from public.pa_docs;
    select coalesce(array_agg(col || '|' || id order by col, id), '{}') into b from public.pa_docs_lite;
    execute 'reset role';
    select coalesce(array_agg(x order by x), '{}') into a from unnest(a) x where x not in (select 'notifs|' || id from public.pa_docs where col = 'notifs' and updated_at < now() - interval '45 days' and (data -> 'to') <@ (data -> 'read'));
    assert a = b, 'E1a: ' || u.u || ' ve filas distintas por la vista';
  end loop;
  set local role service_role; assert (select count(*) from public.pa_docs_lite where col = 'plans') = 12, 'el rol de servicio debe ver los 12 planes'; assert (select count(*) from public.pa_docs_lite where col = 'plans' and data::text like '%data:image/%') = 0; reset role;
  raise notice 'OK E1a con políticas reales: los 12 perfiles ven por la vista exactamente las mismas filas que en la tabla; el rol de servicio (tareas programadas) ve los 12 planes sin imágenes'; end $$;
SQL
Q -f $P/E1_miniaturas_y_listados.sql >/dev/null 2>&1 && echo "OK    E1 completa aplicada sobre la réplica (encima de E1a) con las políticas reales"
Q -c "select public.zz_matriz('post')"
Q -f $P/E3_guardado_parcial.sql >/dev/null 2>&1 && echo "OK    E3 (guardado parcial) aplicada"
Q -f $R/04_verificaciones.sql 2>&1 | grep -E "^psql:.*NOTICE:  (OK|   rol)|ERROR|CONTEXT" | sed 's/^psql:[^ ]* NOTICE:  //'
Q -At -c "select 'matriz de escritura (filas actualizables por usuario, 12 planes):'" ; Q -At -c "select u, count(*) filter (where filas > 0) as actualizables, count(*) filter (where filas = 0) as sin_filas, count(*) filter (where filas < 0) as rechazadas from public.zz_res where fase = 'post' group by u order by u"
echo "PRUEBAS E1 CON POLÍTICAS REALES OK"
