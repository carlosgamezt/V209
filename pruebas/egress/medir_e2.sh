#!/usr/bin/env bash
# Evalúa E2 en PostgreSQL real temporal: ¿qué ahorra además de E1? Mide tamaño en disco y tiempo de lectura de la vista ligera y de la tabla antes y después de compactar, con 200 planes × 8 miniaturas de ~30 KB aleatorias.
set -euo pipefail
cd "$(dirname "$0")/../.."
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}; D=/tmp/eg-e2-pg-$$; PORT=$((57400 + RANDOM % 300)); P=supabase/propuestas/egress
id pgtest >/dev/null 2>&1 || useradd -m pgtest
su pgtest -s /bin/bash -c "mkdir -p '$D' && '$PGBIN/initdb' -D '$D' -A trust -U postgres >/dev/null && '$PGBIN/pg_ctl' -D '$D' -o '-p $PORT -k /tmp -c listen_addresses=' -w -l '$D/log' start >/dev/null"
trap 'su pgtest -s /bin/bash -c "'"$PGBIN"'/pg_ctl -D '"$D"' -m immediate stop >/dev/null" || true; rm -rf "$D"' EXIT
Q() { "$PGBIN/psql" -h /tmp -p $PORT -U postgres -d nexa -v ON_ERROR_STOP=1 -q -X "$@"; }
"$PGBIN/psql" -h /tmp -p $PORT -U postgres -d postgres -q -X -c "create database nexa"
Q -c "create role anon nologin; create role authenticated nologin; create table public.pa_docs (col text not null, id text not null, data jsonb not null, updated_at timestamptz not null default now(), primary key (col, id)); alter table public.pa_docs enable row level security; create policy s on public.pa_docs for select to authenticated using (true); grant select on public.pa_docs to authenticated; create table public.pa_descargas (id bigint generated always as identity primary key, plan_id text, user_id text, user_name text, role text, manual boolean default false, created_at timestamptz default now()); "
Q <<'SQL'
create function pg_temp.foto(n text) returns jsonb language sql volatile as $$ select jsonb_build_object('k', n, 't', 'data:image/jpeg;base64,' || (select string_agg(md5(random()::text || g), '') from generate_series(1, 940) g), 'o', 1, 'x', 'jpg') $$;
insert into public.pa_docs (col, id, data) select 'plans', 'PA-' || lpad(g::text, 4, '0'), jsonb_build_object('id', 'PA-' || lpad(g::text, 4, '0'), 'branch', 'S' || g % 40, 'acts', (select jsonb_agg(jsonb_build_object('text', 'A' || a, 'st', 'Enviada', 'ref', pg_temp.foto('r' || g || '-' || a), 'ev', pg_temp.foto('e' || g || '-' || a))) from generate_series(1, 4) a)) from generate_series(1, 200) g;
analyze public.pa_docs;
SQL
T() { local t0=$(date +%s%N); Q -At -c "$1" >/dev/null; echo $(( ($(date +%s%N) - t0) / 1000000 )); }
SZ() { Q -At -c "select pg_size_pretty(pg_total_relation_size('public.pa_docs')) || ' (tabla+TOAST); filas ' || count(*) || '; JSON medio ' || round(avg(octet_length(data::text))/1024) || ' KB' from public.pa_docs where col='plans'"; }
Q -f $P/E1_miniaturas_y_listados.sql >/dev/null 2>&1
echo "ANTES de E2 (planes con miniaturas embebidas; E1 aplicada):"; echo "  tamaño: $(SZ)"
echo "  leer la vista ligera (200 planes): $(T "set role authenticated; select sum(octet_length(data::text)) from public.pa_docs_lite") ms | leer la tabla completa: $(T "set role authenticated; select sum(octet_length(data::text)) from public.pa_docs") ms"
Q -f $P/E2_compactar_miniaturas.sql >/dev/null 2>&1; Q -c "vacuum full public.pa_docs"
echo "DESPUÉS de E2 + VACUUM FULL:"; echo "  tamaño: $(SZ) ; pa_thumbs: $(Q -At -c "select pg_size_pretty(pg_total_relation_size('public.pa_thumbs'))")"
echo "  leer la vista ligera (200 planes): $(T "set role authenticated; select sum(octet_length(data::text)) from public.pa_docs_lite") ms | leer la tabla completa: $(T "set role authenticated; select sum(octet_length(data::text)) from public.pa_docs") ms"
echo "  coste del disparador en un UPDATE de un plan (ms): $(T "update public.pa_docs set data = jsonb_set(data, '{acts,0,text}', '\"x\"') where col='plans' and id='PA-0001'")"
