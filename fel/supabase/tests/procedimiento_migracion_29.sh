#!/usr/bin/env bash
# PROCEDIMIENTO de la migración 29 (almacén persistente de Digifact) sobre bases DESECHABLES de un PostgreSQL de PRUEBA (nunca una base hospedada):
#   A. aplicar dos veces · B. aplicar sin la 28 · C. la verificación posterior detecta manipulaciones · D. reversión segura (vacía / idempotente / reaplicable)
#   E. con DATOS la reversión se niega y no borra nada · F. mejora 28→29 con datos presentes: las tablas anteriores no cambian.
# Uso: PSQL_BIN=psql CONN='postgres://postgres@127.0.0.1:5432/{DB}' bash procedimiento_migracion_29.sh      ({DB} se sustituye por el nombre de la base)
set -u
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$RAIZ"
PSQL_BIN=${PSQL_BIN:-psql}; CONN=${CONN:?define CONN (con la marca DB entre llaves)}; M=supabase/migrations/20261114000100_fel_digifact_operaciones.sql
MARCA="{DB}"
Q() { local db="$1"; shift; "$PSQL_BIN" "${CONN//$MARCA/$db}" -v ON_ERROR_STOP=1 -q -X "$@"; }
nuevo() { Q postgres -c "drop database if exists $1 with (force)" -c "create database $1" >/dev/null 2>&1; Q $1 -f tools/shim_supabase.sql >/dev/null; for f in supabase/migrations/*.sql; do case "$f" in *20261114000100*) continue;; esac; Q $1 -f "$f" >/dev/null 2>&1 || { echo "FALLO preparación: $f"; exit 1; }; done; }
ok() { echo "OK migración-29: $1"; }; mal() { echo "FALLO migración-29: $1"; FALLOS=$((FALLOS+1)); }; FALLOS=0
V() { Q "$1" -f docs/migracion-29/verificacion-posterior-29.sql 2>&1; }
echo "== A. aplicar la 29 dos veces: la segunda se rechaza SIN cambiar nada (precondición)"
nuevo t_a; Q t_a -f $M >/dev/null 2>&1 && ok "primera aplicación" || mal "primera aplicación"
Q t_a -f $M 2>&1 | grep -q "PRECONDICIÓN 29: ya existen objetos" && ok "segunda aplicación rechazada con mensaje claro" || mal "segunda aplicación no se rechazó"
V t_a | grep -q "VERIFICACION POSTERIOR 29 OK" && ok "tras el intento repetido el esquema sigue verificado" || mal "esquema alterado por el intento repetido"
echo "== B. aplicar la 29 sin la 28 se rechaza"
Q postgres -c "drop database if exists t_b with (force)" -c "create database t_b" >/dev/null 2>&1; Q t_b -f tools/shim_supabase.sql >/dev/null; for f in supabase/migrations/2026111*.sql; do case "$f" in *20261113000100*|*20261114000100*) continue;; esac; Q t_b -f "$f" >/dev/null 2>&1 || true; done
Q t_b -f $M 2>&1 | grep -q "PRECONDICIÓN 29: falta la migración 28" && ok "sin la 28 se rechaza" || mal "sin la 28 NO se rechazó"
echo "== C. la verificación posterior DETECTA manipulaciones"
for caso in "grant select on public.digifact_operaciones to service_role" "grant execute on function public.fel_sys_digifact_aplicar(uuid,uuid) to service_role" "grant select on public.digifact_artefactos to authenticated" "alter table public.digifact_operaciones disable row level security" "alter table public.digifact_artefactos disable trigger digifact_art_guarda" "alter table public.digifact_artefactos drop constraint digifact_artefactos_operacion_id_empresa_id_fkey" "drop index public.digifact_op_una_que_bloquea_uq" "create policy x on public.digifact_operaciones for select to authenticated using (true)" "alter function public.fel_digifact_op_guarda() reset search_path"; do
  nuevo t_c; Q t_c -f $M >/dev/null 2>&1; Q t_c -c "$caso" >/dev/null 2>&1 || echo "    (no se pudo preparar: $caso)"
  V t_c | grep -q "ERROR" && ok "detecta: ${caso:0:80}" || mal "NO detecta: $caso"
done
echo "== D. reversión segura"
nuevo t_d; Q t_d -f $M >/dev/null 2>&1
Q t_d -f docs/migracion-29/reversion-29.sql 2>&1 | grep -q "REVERSION 29 OK" && ok "con tablas VACÍAS se revierte" || mal "no revirtió con tablas vacías"
Q t_d -At -c "select (select count(*) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p')), (select count(*) from pg_proc where pronamespace='public'::regnamespace), (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal)" | grep -q '^67|182|59$' && ok "el esquema vuelve EXACTAMENTE a 1–28 (67 tablas, 182 funciones, 59 disparadores)" || mal "el esquema no volvió a 1–28"
Q t_d -f docs/migracion-28/verificacion-posterior-28.sql 2>&1 | grep -q "VERIFICACION POSTERIOR 28 OK" && ok "la verificación posterior de la 28 vuelve a pasar" || mal "la 28 no pasa tras revertir"
Q t_d -f docs/migracion-29/reversion-29.sql 2>&1 | grep -q "ya no existen" && ok "revertir dos veces no hace nada (idempotente)" || mal "la segunda reversión no fue idempotente"
Q t_d -f $M >/dev/null 2>&1 && ok "se puede volver a aplicar la 29 tras revertirla" || mal "no se pudo reaplicar"
echo "== E. con DATOS la reversión se NIEGA y no borra nada"
nuevo t_e; Q t_e -f $M >/dev/null 2>&1
Q t_e >/dev/null <<'SQL'
insert into auth.users (id, email, email_confirmed_at) values ('30000000-0000-0000-0000-0000000000e1', 'e@x.local', now());
insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id) select '10000000-0000-0000-0000-0000000000e1', 'E', 'E S.A.', '1000001-1', id from public.regimenes_fiscales where codigo='general';
insert into public.documentos (id, empresa_id, numero_borrador) values ('20000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e1', 1);
insert into public.digifact_operaciones (id, empresa_id, documento_id, referencia, hash, huella_emisor, fecha_emision, establecimiento, total, estado, creada_ms, actualizada_ms, actor_id, intento_del_documento)
 values (gen_random_uuid(), '10000000-0000-0000-0000-0000000000e1', '20000000-0000-0000-0000-0000000000e1', gen_random_uuid(), repeat('a',64), '0123456789abcdef', '2026-11-16', 1, '1.00', 'preparada', 1, 1, '30000000-0000-0000-0000-0000000000e1', 0);
SQL
Q t_e -f docs/migracion-29/reversion-29.sql 2>&1 | grep -q "REVERSIÓN 29 RECHAZADA" && ok "con una operación existente la reversión se RECHAZA" || mal "la reversión no se rechazó con datos"
Q t_e -At -c "select count(*) from public.digifact_operaciones" | grep -q '^1$' && ok "la fila sigue ahí (no se borró nada)" || mal "se perdió la fila"
Q t_e -At -c "select to_regclass('public.digifact_artefactos') is not null and to_regclass('public.digifact_operaciones') is not null" | grep -q '^t$' && ok "las tablas siguen existiendo" || mal "las tablas desaparecieron"
echo "== F. mejora 28→29 con DATOS existentes: nada cambia en las tablas anteriores"
nuevo t_f
Q t_f >/dev/null <<'SQL'
insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id) select '10000000-0000-0000-0000-0000000000f1', 'F', 'F S.A.', '1000002-2', id from public.regimenes_fiscales where codigo='general';
insert into public.documentos (id, empresa_id, numero_borrador) values ('20000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1', 1), ('20000000-0000-0000-0000-0000000000f2', '10000000-0000-0000-0000-0000000000f1', 2);
SQL
ANTES=$(Q t_f -At -c "select md5(string_agg(t::text, '|' order by t::text)) from (select * from public.empresas union all select null,null,null,null,null,null,null,null,null,null,null,null where false) t" 2>/dev/null || echo x)
H1=$(Q t_f -At -c "select md5(coalesce(string_agg(d::text, '|' order by d.id), '')) from public.documentos d"); E1=$(Q t_f -At -c "select md5(coalesce(string_agg(e::text, '|' order by e.id), '')) from public.empresas e")
Q t_f -f $M >/dev/null 2>&1 && ok "la 29 se aplica con datos presentes" || mal "no se aplicó con datos"
H2=$(Q t_f -At -c "select md5(coalesce(string_agg(d::text, '|' order by d.id), '')) from public.documentos d"); E2=$(Q t_f -At -c "select md5(coalesce(string_agg(e::text, '|' order by e.id), '')) from public.empresas e")
[ "$H1" = "$H2" ] && [ "$E1" = "$E2" ] && ok "documentos y empresas idénticos antes y después (huella md5 de todas las filas)" || mal "los datos existentes cambiaron"
[ "$FALLOS" = 0 ] && echo "PROCEDIMIENTO MIGRACIÓN 29 OK" || { echo "$FALLOS fallo(s)"; exit 1; }
