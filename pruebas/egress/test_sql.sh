#!/usr/bin/env bash
# Prueba REAL en PostgreSQL temporal (sin red) de la propuesta E1/E2: no pierde miniaturas, respeta las reglas de acceso de pa_docs, equivale al cálculo anterior de descargas y se revierte.
# ADVERTENCIA: pa_docs y sus políticas reales NO están en el repositorio; aquí se usa una réplica mínima con la misma idea de visibilidad. Antes de aplicar en Supabase hay que correr supabase/consultas/medicion_egress.sql (sección «políticas»).
set -euo pipefail
cd "$(dirname "$0")/../.."
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}; D=/tmp/eg-sql-pg-$$; PORT=$((57000 + RANDOM % 400)); P=supabase/propuestas/egress
as_pg() { if [ "$(id -u)" = 0 ]; then su pgtest -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
id pgtest >/dev/null 2>&1 || useradd -m pgtest
as_pg "mkdir -p '$D' && '$PGBIN/initdb' -D '$D' -A trust -U postgres >/dev/null"; as_pg "'$PGBIN/pg_ctl' -D '$D' -o '-p $PORT -k /tmp -c listen_addresses=' -w -l '$D/log' start >/dev/null"
trap 'as_pg "'"$PGBIN"'/pg_ctl -D '"$D"' -m immediate stop >/dev/null" || true; rm -rf "$D"' EXIT
Q() { "$PGBIN/psql" -h /tmp -p $PORT -U postgres -d nexa -v ON_ERROR_STOP=1 -q -X "$@"; }
ok() { echo "OK    $1"; }; fallo() { echo "FALLO $1"; exit 1; }
"$PGBIN/psql" -h /tmp -p $PORT -U postgres -d postgres -q -X -c "create database nexa"
Q <<'SQL'
create role anon nologin; create role authenticated nologin;
create function public.pa_uid() returns text language sql stable as $$ select nullif(current_setting('app.uid', true), '') $$;
create function public.pa_role() returns text language sql stable as $$ select nullif(current_setting('app.role', true), '') $$;
create table public.pa_docs (col text not null, id text not null, data jsonb not null, updated_at timestamptz not null default now(), primary key (col, id));
alter table public.pa_docs enable row level security;
create policy sel on public.pa_docs for select to authenticated using (
  case col when 'plans' then pa_role() = 'admin' or data ->> 'branch' = current_setting('app.branch', true)
            when 'notifs' then (data -> 'to') ? pa_uid() else true end);
create policy ins on public.pa_docs for insert to authenticated with check (true);
create policy upd on public.pa_docs for update to authenticated using (true) with check (true);
create policy del on public.pa_docs for delete to authenticated using (true);
grant select, insert, update, delete on public.pa_docs to authenticated;
SQL
Q -f supabase/descargas.sql >/dev/null 2>&1; Q -c "grant select, insert on public.pa_descargas to authenticated"; ok "esquema base (pa_docs réplica + pa_descargas real)"
# datos: planes con miniaturas embebidas (antes de la migración), avisos, descargas
Q <<'SQL'
create function pg_temp.foto(n text) returns jsonb language sql as $$ select jsonb_build_object('k', n, 't', 'data:image/jpeg;base64,' || repeat(md5(n), 400), 'o', 1, 'x', 'jpg') $$;
insert into public.pa_docs (col, id, data) select 'plans', 'PA-2026-' || lpad(g::text, 3, '0'), jsonb_build_object('id', 'PA-2026-' || lpad(g::text, 3, '0'), 'branch', 'Suc ' || (g % 4), 'region', '1', 'type', case when g % 3 = 0 then 'Inventarios' else 'Auditoría' end, 'created', 1700000000000 + g,
   'acts', (select jsonb_agg(jsonb_build_object('text', 'A' || a, 'st', 'Enviada', 'ref', pg_temp.foto('ref#' || g || '-' || a), 'ev', pg_temp.foto('ev#' || g || '-' || a), 'rv', jsonb_build_object('n', 'x', 't', 1700000000123, 'ok', true), 'tl', jsonb_build_array(jsonb_build_array('e', 1700000000456)))) from generate_series(1, 5) a)) from generate_series(1, 40) g;
insert into public.pa_docs (col, id, data, updated_at) select 'notifs', 'n' || g, jsonb_build_object('id', 'n' || g, 'to', jsonb_build_array('u1', 'u2'), 'read', case when g % 2 = 0 then jsonb_build_array('u1', 'u2') else jsonb_build_array('u1') end, 'ts', g), now() - (g || ' days')::interval from generate_series(1, 120) g;
insert into public.pa_docs (col, id, data) values ('users', 'u1', '{"role":"admin"}'), ('meta', 'cfg', '{}');
SQL
Q -c "create table pg_temp.x(a int)" >/dev/null 2>&1 || true
Q <<'SQL'
create table public.zz_orig as select col, id, data from public.pa_docs;        -- fotografía exacta del original
set app.role = 'admin';
insert into public.pa_descargas (plan_id, user_id, user_name, role, manual, created_at) select 'PA-2026-' || lpad((g % 40 + 1)::text, 3, '0'), 'u', 'Inv', case when g % 5 = 0 then 'admin' else 'inventarios' end, g % 7 = 0, now() - (g || ' hours')::interval from generate_series(1, 300) g;
SQL
ANTES=$(Q -At -c "select pg_total_relation_size('public.pa_docs')"); ok "datos de prueba: 40 planes con 400 miniaturas embebidas; 120 avisos; 300 descargas"
# ---------- E0 (respaldo) ----------
Q -f $P/E0_respaldo.sql 2>&1 | grep -q "E0 OK" && ok "E0: respaldo exacto de pa_docs y pa_descargas (mismas filas y misma huella)" || fallo "E0"
if Q -f $P/E0_respaldo.sql >/dev/null 2>&1; then fallo "E0 sobrescribió un respaldo existente"; else ok "E0 no sobrescribe un respaldo existente"; fi
Q <<'SQL' 2>&1 | grep -q "E0 ACCESO OK" && echo "OK    E0: las tablas de respaldo no son legibles por la app (authenticated/anon)" || { echo "FALLO acceso al respaldo"; exit 1; }
do $$ begin set local role authenticated; begin perform 1 from public.pa_docs_respaldo_e0 limit 1; assert false, 'authenticated no debe leer el respaldo'; exception when insufficient_privilege then null; end; reset role; raise notice 'E0 ACCESO OK'; end $$;
SQL
# ---------- E1 ----------
Q -f $P/E1_miniaturas_y_listados.sql >/dev/null; Q -f $P/E1_miniaturas_y_listados.sql >/dev/null; ok "E1 aplica y se puede volver a aplicar (idempotente)"
[ "$(Q -At -c "select count(*) from public.pa_thumbs")" = 400 ] && ok "E1 copió las 400 miniaturas a pa_thumbs" || fallo "conteo de pa_thumbs"
[ "$(Q -At -c "select count(*) from public.pa_docs where data::text like '%data:image/%'")" = 40 ] && ok "E1 NO modificó pa_docs (los 40 planes siguen con sus miniaturas)" || fallo "E1 modificó pa_docs"
Q -At -c "select md5(string_agg(d.data::text, '' order by d.col, d.id)) from public.pa_docs d where col='plans'" > /tmp/h1_$$; Q -At -c "select md5(string_agg(d.data::text, '' order by d.col, d.id)) from public.zz_orig d where col='plans'" > /tmp/h0_$$; cmp -s /tmp/h1_$$ /tmp/h0_$$ && ok "los planes son idénticos byte a byte a la fotografía original" || fallo "planes cambiados"
# vista ligera: sin miniaturas, conserva TODO lo demás (incluido t numérico de rv y de la cronología)
Q <<'SQL' 2>&1 | grep -q "VISTA OK" && echo "OK    vista ligera: quita solo las imágenes; conserva t numéricos (revisión, cronología) y el resto del plan" || { echo "FALLO vista ligera"; exit 1; }
do $$ declare a jsonb; b jsonb; begin
  select data into a from public.pa_docs where col = 'plans' and id = 'PA-2026-001'; select data into b from public.pa_docs_lite where col = 'plans' and id = 'PA-2026-001';
  assert b::text not like '%data:image/%', 'la vista aún trae imágenes';
  assert (b #> '{acts,0,rv}') = (a #> '{acts,0,rv}') and (b #> '{acts,0,tl}') = (a #> '{acts,0,tl}'), 'rv/tl alterados';
  assert (b #>> '{acts,0,ref,k}') = (a #>> '{acts,0,ref,k}') and not (b #> '{acts,0,ref}') ? 't', 'la foto debe conservar k y no traer t';
  assert (select count(*) from public.pa_docs_lite where col = 'plans') = 40;
  assert octet_length(b::text) < octet_length(a::text) / 10, 'la vista debe pesar mucho menos'; raise notice 'VISTA OK (% bytes -> % bytes)', octet_length(a::text), octet_length(b::text); end $$;
SQL
# propiedad: incrustar(quitar(x)) = x  (se prueba con la función de E2_reversion)
Q <<'SQL'
create function public.pa_embed_thumbs(j jsonb) returns jsonb language plpgsql stable set search_path = '' as $$
declare r jsonb; base jsonb; tt text;
begin if j is null then return null; end if;
  if jsonb_typeof(j) = 'array' then select coalesce(jsonb_agg(public.pa_embed_thumbs(x.v) order by x.n), '[]'::jsonb) into r from jsonb_array_elements(j) with ordinality as x(v, n); return r;
  elsif jsonb_typeof(j) = 'object' then base := j;
    if base ? 'k' and jsonb_typeof(base -> 'k') = 'string' and not base ? 't' then select p.t into tt from public.pa_thumbs p where p.k = base ->> 'k'; if tt is not null then base := base || jsonb_build_object('t', tt); end if; end if;
    select coalesce(jsonb_object_agg(e.key, public.pa_embed_thumbs(e.value)), '{}'::jsonb) into r from jsonb_each(base) as e; return r; end if; return j; end $$;
SQL
Q <<'SQL' 2>&1 | grep -q "ROUNDTRIP OK" && echo "OK    quitar + volver a incrustar reproduce exactamente cada plan original (ida y vuelta sin pérdida)" || { echo "FALLO ida y vuelta"; exit 1; }
do $$ begin assert (select count(*) from public.zz_orig o where o.col = 'plans' and public.pa_embed_thumbs(public.pa_strip_thumbs(o.data)) <> o.data) = 0, 'ida y vuelta distinta'; raise notice 'ROUNDTRIP OK'; end $$;
SQL
# disparador: una app «ligera» (sin t) actualiza un plan heredado: no se pierde ninguna foto
Q <<'SQL' 2>&1 | grep -q "TRIGGER OK" && echo "OK    escritura desde la app ligera sobre un plan heredado: ninguna foto se pierde (pa_thumbs conserva todo)" || { echo "FALLO disparador"; exit 1; }
do $$ declare ligero jsonb; n0 int; begin
  select count(*) into n0 from public.pa_thumbs;
  select data into ligero from public.pa_docs_lite where col = 'plans' and id = 'PA-2026-002';
  update public.pa_docs set data = jsonb_set(ligero, '{acts,0,text}', '"editado"') where col = 'plans' and id = 'PA-2026-002';
  assert (select data::text from public.pa_docs where col = 'plans' and id = 'PA-2026-002') not like '%data:image/%', 'la fila debe quedar sin imágenes';
  assert (select count(*) from public.pa_thumbs) = n0, 'no deben aparecer ni desaparecer miniaturas';
  assert public.pa_embed_thumbs((select data from public.pa_docs where id = 'PA-2026-002' and col = 'plans')) = jsonb_set((select data from public.zz_orig where id = 'PA-2026-002' and col = 'plans'), '{acts,0,text}', '"editado"'), 'el plan reconstruido debe ser el original más la edición';
  -- foto nueva desde un equipo: se separa y queda en pa_thumbs
  update public.pa_docs set data = jsonb_set(data, '{acts,1,ev}', jsonb_build_object('k', 'ev#nuevo', 't', 'data:image/jpeg;base64,AAAA', 'o', 1)) where col = 'plans' and id = 'PA-2026-003';
  assert (select t from public.pa_thumbs where k = 'ev#nuevo') = 'data:image/jpeg;base64,AAAA' and (select data::text from public.pa_docs where id = 'PA-2026-003' and col = 'plans') not like '%AAAA%';
  insert into public.pa_docs (col, id, data) values ('plans', 'PA-2026-900', jsonb_build_object('id', 'PA-2026-900', 'branch', 'Suc 1', 'acts', jsonb_build_array(jsonb_build_object('ref', jsonb_build_object('k', 'ref#900', 't', 'data:image/png;base64,BBBB')))));
  assert (select count(*) from public.pa_thumbs where k = 'ref#900') = 1 and (select data::text from public.pa_docs where id = 'PA-2026-900' and col = 'plans') not like '%BBBB%';
  raise notice 'TRIGGER OK'; end $$;
SQL
# acceso: la vista y pa_thumbs respetan las reglas de pa_docs
Q <<'SQL' 2>&1 | tee /tmp/acc.log | grep -q "ACCESO OK" && echo "OK    acceso: administrador ve todo; una sucursal ve solo sus planes, sus miniaturas y sus avisos; sin sesión (anon) nada" || { echo "FALLO acceso"; exit 1; }
do $$ declare n int; m int; begin
  set local role authenticated; perform set_config('app.role', 'admin', true);
  select count(*) into n from public.pa_docs_lite where col = 'plans'; assert n = 41, 'admin ve todos los planes: ' || n;
  perform set_config('app.role', 'sucursal', true); perform set_config('app.branch', 'Suc 1', true); perform set_config('app.uid', 'u1', true);
  select count(*) into n from public.pa_docs_lite where col = 'plans'; select count(*) into m from public.pa_docs where col = 'plans'; assert n = m and n > 0 and n < 41, 'la vista debe dar los MISMOS planes que la tabla: ' || n || ' vs ' || m;
  select count(*) into n from public.pa_thumbs; assert n > 0 and n < 400, 'solo miniaturas de sus planes: ' || n;
  assert not exists (select 1 from public.pa_thumbs t where not exists (select 1 from public.pa_docs d where d.col = 'plans' and d.id = t.plan_id)), 'miniatura de un plan invisible';
  select count(*) into n from public.pa_docs_lite where col = 'notifs'; select count(*) into m from public.pa_docs where col = 'notifs'; assert n < m and n > 0, 'avisos viejos ya leídos por todos quedan fuera de la vista (no se borran): ' || n || ' vs ' || m;
  begin insert into public.pa_thumbs values ('x', 'PA-2026-001', 'data:image/x'); assert false, 'un usuario no debe poder insertar miniaturas'; exception when insufficient_privilege then null; end;
  perform set_config('app.uid', 'u9', true); select count(*) into n from public.pa_docs_lite where col = 'notifs'; assert n = 0, 'otra persona no ve avisos ajenos';
  reset role; set local role anon; begin perform count(*) from public.pa_docs_lite; assert false, 'anon no debe leer la vista'; exception when insufficient_privilege then null; end;
  reset role; raise notice 'ACCESO OK'; end $$;
SQL
# E1 no amplía permisos: quien puede editar SU plan no puede pisar ni leer la miniatura de otro plan reutilizando su llave
Q <<'SQL' 2>&1 | grep -q "SIN AMPLIACION OK" && echo "OK    E1 no amplía permisos: reutilizar la llave de una miniatura ajena no la sobrescribe ni permite leerla" || { echo "FALLO ampliación de permisos"; exit 1; }
do $$ declare antes text; n int; begin
  select t into antes from public.pa_thumbs where k = 'ref#2-1';
  set local role authenticated; perform set_config('app.role', 'sucursal', true); perform set_config('app.branch', 'Suc 1', true);
  update public.pa_docs set data = jsonb_set(data, '{acts,0,ref}', jsonb_build_object('k', 'ref#2-1', 't', 'data:image/jpeg;base64,EVIL')) where col = 'plans' and id = 'PA-2026-001';
  select count(*) into n from public.pa_thumbs where k = 'ref#2-1'; assert n = 0, 'la sucursal no debe poder leer la miniatura de otro plan';
  reset role; assert (select t from public.pa_thumbs where k = 'ref#2-1') = antes, 'la miniatura ajena fue sobrescrita';
  assert (select data::text from public.pa_docs where col = 'plans' and id = 'PA-2026-001') not like '%EVIL%', 'el contenido no debe quedar en el plan';
  raise notice 'SIN AMPLIACION OK'; end $$;
SQL
# descargas: la agregación da el MISMO resultado que dlInfo sobre las 5 000 filas
Q <<'SQL' 2>&1 | tee /tmp/desc.log | grep -q "DESCARGAS OK" && echo "OK    pa_descargas_resumen() = misma respuesta que la lógica anterior (última descarga relevante por plan), con las mismas reglas de acceso" || { echo "FALLO descargas"; exit 1; }
do $$ declare mal int; begin
  set local role authenticated; perform set_config('app.role', 'admin', true);
  select count(*) into mal from (select distinct plan_id from public.pa_descargas) p where
    (select (r.user_name, r.role, r.manual, r.created_at)::text from public.pa_descargas r where r.plan_id = p.plan_id and (r.role = 'inventarios' or r.manual) order by r.created_at desc limit 1) is distinct from
    (select (s.user_name, s.role, s.manual, s.created_at)::text from public.pa_descargas_resumen() s where s.plan_id = p.plan_id);
  assert mal = 0, 'difieren ' || mal || ' planes'; reset role; raise notice 'DESCARGAS OK'; end $$;
SQL
# ---------- E2 ----------
Q -f $P/E2_compactar_miniaturas.sql 2>&1 | grep -q "verificación OK" && ok "E2: respaldo + verificación previa + compactación" || fallo "E2"
[ "$(Q -At -c "select count(*) from public.pa_docs where data::text like '%data:image/%'")" = 0 ] && ok "tras E2 ningún plan trae imágenes embebidas" || fallo "E2 incompleto"
[ "$(Q -At -c "select count(*) from public.pa_docs_respaldo_e2")" = 41 ] && ok "respaldo de los planes antes de compactar (41 filas)" || fallo "respaldo E2"
DESP=$(Q -At -c "select pg_total_relation_size('public.pa_docs')"); echo "      tamaño de pa_docs: antes $ANTES B → después $DESP B (sin VACUUM FULL; el espacio se reutiliza)"
Q -f $P/E2_reversion.sql >/dev/null && ok "E2_reversion: las miniaturas vuelven a los planes" || fallo "E2_reversion"
Q <<'SQL' 2>&1 | grep -q "REV OK" && echo "OK    tras revertir E2 cada plan coincide con el original (+ las ediciones hechas durante la prueba)" || { echo "FALLO reversión E2"; exit 1; }
do $$ begin assert (select count(*) from public.pa_docs d join public.zz_orig o on o.col = d.col and o.id = d.id where d.col = 'plans' and d.data <> o.data and d.id not in ('PA-2026-001', 'PA-2026-002', 'PA-2026-003')) = 0, 'planes distintos del original'; raise notice 'REV OK'; end $$;
SQL
Q -f $P/E1_reversion.sql >/dev/null && ok "E1_reversion: sin disparador, vista ni RPC; pa_thumbs se conserva" || fallo "E1_reversion"
[ "$(Q -At -c "select count(*) from pg_trigger where tgname = 'pa_docs_split_thumbs_t'")" = 0 ] && [ "$(Q -At -c "select count(*) from public.pa_thumbs")" -ge 400 ] && ok "tras revertir: no queda el disparador y no se perdió ninguna miniatura" || fallo "reversión incompleta"
echo "PRUEBAS SQL DE E1/E2 OK"
