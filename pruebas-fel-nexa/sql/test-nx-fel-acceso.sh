#!/usr/bin/env bash
# Prueba REAL de PostgreSQL (servidor temporal, sin red ni Supabase hospedado) del script único supabase/nx_fel_acceso.sql.
# Se monta lo mínimo de Supabase (roles anon/authenticated/service_role, esquema auth con auth.users y auth.uid() leyendo el token, privilegios por defecto como en Supabase,
# y el PEOR CASO: los roles de la API pueden crear objetos en public) y se comprueba:
#   · la cuenta registrada recibe true; otra cuenta —también una con rol «admin» en la app—, una sesión sin UUID y un UUID desconocido reciben false (nunca null ni error);
#   · anon no puede ejecutar la función; nadie de la API puede leer, insertar, modificar ni borrar la tabla (ni siquiera la cuenta autorizada);
#   · SECURITY DEFINER, propietario, search_path vacío y permisos de ejecución exactos; RLS activado y sin políticas;
#   · ataques de search_path/objetos suplantados (tabla temporal, operador = en public) no cambian el resultado;
#   · borrar la cuenta de auth.users retira la autorización; el script es el ÚNICO procedimiento de instalación: falla sin tocar nada con el marcador sin reemplazar, con un UUID inexistente, en otro proyecto o si ya existen objetos; el ensayo no deja nada; un defecto deshace todo; no contiene UUID ni correos reales.
#   Uso: bash pruebas-fel-nexa/sql/test-nx-fel-acceso.sh   (desde la raíz del repositorio)
set -uo pipefail
R="$(cd "$(dirname "$0")/../.." && pwd)"; SQLF="${NXFEL_SQL:-$R/supabase/nx_fel_acceso.sql}"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PGBIN/initdb" ] && [ -x "$PGBIN/pg_ctl" ] && [ -x "$PGBIN/psql" ] || { echo "FALLO no hay PostgreSQL con initdb, pg_ctl y psql (PGBIN=$PGBIN): la prueba NO se omite"; exit 1; }
DATA="/tmp/nxfel-pgdata-$$"; PORT="${NXFEL_PGPORT:-54463}"; SOCK="/tmp"; fallos=0
ok() { echo "OK    $1"; }; mal() { echo "FALLO $1"; fallos=$((fallos+1)); }
as_pg() { if [ "$(id -u)" = 0 ]; then su pgtest -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
[ "$(id -u)" != 0 ] || id pgtest >/dev/null 2>&1 || useradd -m pgtest
trap 'as_pg "$PGBIN/pg_ctl -D $DATA -m immediate stop >/dev/null" 2>/dev/null; rm -rf "$DATA"' EXIT
as_pg "rm -rf '$DATA' && mkdir -p '$DATA' && '$PGBIN/initdb' -D '$DATA' -A trust -U postgres --locale=C --encoding=UTF8 >/dev/null" && as_pg "'$PGBIN/pg_ctl' -D '$DATA' -o '-p $PORT -k $SOCK -c listen_addresses=' -w -l '$DATA/log' start >/dev/null" || { echo "FALLO no se pudo levantar PostgreSQL de prueba"; exit 1; }
echo "PostgreSQL de prueba: $PGBIN ($("$PGBIN/postgres" --version | grep -oE '[0-9]+(\.[0-9]+)?' | head -1))"
Q() { "$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d postgres -X -q -tA -v ON_ERROR_STOP=0 "$@" 2>&1; }
# --- entorno mínimo de Supabase (se aplica a cada base de prueba)
QD() { local d="$1"; shift; "$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d "$d" -X -q -tA -v ON_ERROR_STOP=0 "$@" 2>&1; }
Q() { QD postgres "$@"; }
Q -c "create role anon nologin" -c "create role authenticated nologin" -c "create role service_role nologin bypassrls" >/dev/null
entorno() { # $1 = base; $2 = «nexa» (con las tablas de NEXA principal) · «sinpa» (sin pa_docs) · «fel» (con public.empresas, como NEXA FEL)
  [ "$1" = postgres ] || Q -c "create database $1" >/dev/null
  QD "$1" -c "create schema auth" -c "create table auth.users (id uuid primary key, email text)" \
    -c "create function auth.uid() returns uuid language sql stable as \$\$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid \$\$" \
    -c "grant usage on schema auth to anon, authenticated, service_role" -c "grant execute on function auth.uid() to anon, authenticated, service_role" \
    -c "grant usage, create on schema public to anon, authenticated, service_role" \
    -c "alter default privileges in schema public grant all on tables to anon, authenticated, service_role" -c "alter default privileges in schema public grant execute on functions to anon, authenticated, service_role" \
    -c "insert into auth.users values ('$U_AUT','autorizada@prueba.invalid'), ('$U_ADM2','otro-admin@prueba.invalid'), ('$U_SUP','supervisor@prueba.invalid')" >/dev/null
  if [ "$2" != sinpa ]; then QD "$1" -c "create table public.pa_docs (col text, id text, data jsonb)" -c "create table public.pa_profiles (auth_id uuid primary key, role text not null)" -c "create function public.pa_next_seq() returns int language sql as 'select 1'" \
    -c "insert into public.pa_profiles values ('$U_AUT','admin'), ('$U_ADM2','admin'), ('$U_SUP','supervisor')" >/dev/null; fi
  [ "$2" != fel ] || QD "$1" -c "create table public.empresas (id int)" >/dev/null
}
U_AUT=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa; U_ADM2=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb; U_SUP=cccccccc-cccc-4ccc-8ccc-cccccccccccc; U_DESC=dddddddd-dddd-4ddd-8ddd-dddddddddddd
entorno postgres nexa; entorno sinpa sinpa; entorno fel fel
# --- el SCRIPT ÚNICO (el archivo bajo prueba) es el procedimiento oficial: se reemplaza el marcador por un UUID de PRUEBA y v_ensayo según el caso
INST() { sed "s/PEGA-AQUI-TU-UUID/$1/;s/v_ensayo boolean := true;/v_ensayo boolean := ${2:-false};/" "$SQLF"; }
nuevos() { QD "${1:-postgres}" -c "select (select count(*) from pg_class where relname ilike 'nx\_fel%') + (select count(*) from pg_proc where proname ilike 'nx\_fel%')"; }
R="$(Q -c "$(cat "$SQLF")")"; echo "$R" | grep -q 'invalid input syntax for type uuid' && [ "$(nuevos)" = 0 ] && ok "con el marcador PEGA-AQUI-TU-UUID sin reemplazar el script falla de inmediato y no crea nada" || mal "el marcador sin reemplazar no detiene el script: $R"
R="$(Q -c "$(INST cccccccc-0000-4ccc-8ccc-cccccccccccc false)")"; echo "$R" | grep -q '^ERROR:  PARE: ese UUID no existe' && [ "$(nuevos)" = 0 ] && ok "un UUID que no existe en Authentication detiene el script sin crear nada" || mal "UUID inexistente no detiene el script: $R"
R="$(QD sinpa -c "$(INST $U_AUT false)")"; echo "$R" | grep -q '^ERROR:  PARE: no parece el proyecto de NEXA principal' && [ "$(nuevos sinpa)" = 0 ] && ok "un proyecto que no tiene las tablas de NEXA principal detiene el script sin crear nada" || mal "proyecto sin pa_docs no detiene el script: $R"
R="$(QD fel -c "$(INST $U_AUT false)")"; echo "$R" | grep -q '^ERROR:  PARE: este proyecto tiene tablas de NEXA FEL' && [ "$(nuevos fel)" = 0 ] && ok "un proyecto con tablas de NEXA FEL (public.empresas) detiene el script sin crear nada" || mal "proyecto de FEL no detiene el script: $R"
Q -c "create table public.nx_fel_otra (x int)" >/dev/null; R="$(Q -c "$(INST $U_AUT false)")"; echo "$R" | grep -q '^ERROR:  PARE: ya existen objetos con nombre nx_fel_' && ok "si ya existe un objeto nx_fel_* el script se detiene y no sobrescribe nada" || mal "objeto previo no detiene el script: $R"; Q -c "drop table public.nx_fel_otra" >/dev/null
R="$(Q -c "$(INST $U_AUT true)")"; echo "$R" | grep -q '^ERROR:  ENSAYO TERMINADO' && [ "$(nuevos)" = 0 ] && ok "el ENSAYO (v_ensayo = true) pasa todos los controles y no deja nada instalado" || mal "el ensayo falla o deja objetos: $R"
R="$(Q -c "$(INST $U_AUT false | sed '/enable row level security/d')")"; echo "$R" | grep -q '^ERROR:  PARE: controles fallidos' && [ "$(nuevos)" = 0 ] && ok "un defecto (sin RLS) hace fallar los controles y se deshace todo" || mal "defecto sin RLS no detectado: $R"
R="$(Q -c "$(INST $U_AUT false | sed 's/to authenticated;/to authenticated, anon;/')")"; echo "$R" | grep -q '^ERROR:  PARE: controles fallidos' && [ "$(nuevos)" = 0 ] && ok "un defecto (EXECUTE para anon) hace fallar los controles y se deshace todo" || mal "defecto de EXECUTE no detectado: $R"
R="$(Q -c "$(INST $U_AUT false | sed "s/security definer/security invoker/")")"; echo "$R" | grep -q '^ERROR:  PARE: controles fallidos' && [ "$(nuevos)" = 0 ] && ok "un defecto (sin SECURITY DEFINER) hace fallar los controles y se deshace todo" || mal "defecto de SECURITY DEFINER no detectado: $R"
R="$(Q -c "$(INST $U_AUT false)")"; echo "$R" | tr '\n' ' ' | grep -q 'cuentas registradas|1|1|t' && ! echo "$R" | grep -q '|f$' && ok "la INSTALACIÓN real (una sola petición) termina bien y la tabla de resultados trae todo en true" || mal "la instalación falla: $R"
[ "$(Q -c "select count(*) from public.nx_fel_cuentas_autorizadas")" = "1" ] && [ "$(Q -c "select auth_id::text from public.nx_fel_cuentas_autorizadas")" = "$U_AUT" ] && ok "queda registrada exactamente 1 cuenta: la indicada" || mal "la cuenta registrada no es exactamente la indicada"
R="$(Q -c "$(INST $U_AUT false)")"; echo "$R" | grep -q '^ERROR:  PARE: ya existen objetos con nombre nx_fel_' && [ "$(Q -c "select count(*) from public.nx_fel_cuentas_autorizadas")" = "1" ] && ok "una segunda ejecución se detiene sin tocar nada y conserva la cuenta registrada" || mal "la segunda ejecución no se detiene: $R"
fn() { Q -c "begin" -c "set local role $1" -c "select set_config('request.jwt.claim.sub', '$2', true) is not null" -c "select public.nx_fel_autorizado()" -c "rollback" | tail -1; }
# --- 1. resultados de la función
[ "$(fn authenticated $U_AUT)" = "t" ] && ok "la cuenta registrada recibe true" || mal "la cuenta registrada no recibe true ($(fn authenticated $U_AUT))"
[ "$(fn authenticated $U_ADM2)" = "f" ] && ok "otro administrador (rol admin en la app) NO registrado recibe false" || mal "otro administrador no recibe false"
[ "$(fn authenticated $U_SUP)" = "f" ] && ok "un supervisor no registrado recibe false" || mal "un supervisor no recibe false"
[ "$(fn authenticated $U_DESC)" = "f" ] && ok "un UUID que no existe en auth.users recibe false" || mal "UUID desconocido no recibe false"
[ "$(fn authenticated '')" = "f" ] && ok "una sesión sin UUID (sub vacío) recibe false (no null)" || mal "sin UUID no recibe false ($(fn authenticated ''))"
R="$(Q -c "begin" -c "set local role authenticated" -c "select public.nx_fel_autorizado() is null" -c "rollback" | tail -1)"; [ "$R" = "f" ] && ok "sin ninguna configuración de sesión el resultado no es null" || mal "el resultado sin sesión es null o falla ($R)"
R="$(Q -c "begin" -c "set local role anon" -c "select public.nx_fel_autorizado()" -c "rollback")"; echo "$R" | grep -qi "permission denied" && ok "anon NO puede ejecutar la función (permission denied)" || mal "anon puede ejecutar la función: $R"
R="$(Q -c "begin" -c "set local role service_role" -c "select public.nx_fel_autorizado()" -c "rollback")"; echo "$R" | grep -qi "permission denied" && ok "service_role tampoco recibe permiso de ejecución" || mal "service_role puede ejecutar la función: $R"
# --- 2. la tabla: nadie de la API puede tocarla, ni la cuenta autorizada
for rol in authenticated anon service_role; do
  for op in "select * from public.nx_fel_cuentas_autorizadas" "insert into public.nx_fel_cuentas_autorizadas (auth_id) values ('$U_ADM2')" "update public.nx_fel_cuentas_autorizadas set creado_en = now()" "delete from public.nx_fel_cuentas_autorizadas" "truncate public.nx_fel_cuentas_autorizadas"; do
    R="$(Q -c "begin" -c "set local role $rol" -c "select set_config('request.jwt.claim.sub', '$U_AUT', true) is not null" -c "$op" -c "rollback")"
    echo "$R" | grep -qi "permission denied" && ok "$rol (incluso como la cuenta autorizada) no puede: ${op%% *} ${op#* }" | cut -c1-120 || mal "$rol puede ejecutar «$op»: $R"
  done
done
[ "$(Q -c "select count(*) from public.nx_fel_cuentas_autorizadas")" = "1" ] && ok "tras todos los intentos la tabla sigue con exactamente 1 cuenta" || mal "la tabla cambió"
# --- 3. propiedades de la función y la tabla
[ "$(Q -c "select prosecdef from pg_proc where oid = 'public.nx_fel_autorizado()'::regprocedure")" = "t" ] && ok "la función es SECURITY DEFINER" || mal "la función no es SECURITY DEFINER"
[ "$(Q -c "select pg_get_userbyid(proowner) from pg_proc where oid = 'public.nx_fel_autorizado()'::regprocedure")" = "postgres" ] && ok "el propietario de la función es postgres" || mal "propietario de la función distinto de postgres"
[ "$(Q -c "select pg_get_userbyid(relowner) from pg_class where oid = 'public.nx_fel_cuentas_autorizadas'::regclass")" = "postgres" ] && ok "el propietario de la tabla es postgres" || mal "propietario de la tabla distinto de postgres"
[ "$(Q -c "select proconfig::text from pg_proc where oid = 'public.nx_fel_autorizado()'::regprocedure")" = '{"search_path=\"\""}' ] && ok "search_path de la función = vacío" || mal "search_path de la función no es vacío: $(Q -c "select proconfig::text from pg_proc where oid = 'public.nx_fel_autorizado()'::regprocedure")"
[ "$(Q -c "select prorettype::regtype from pg_proc where oid = 'public.nx_fel_autorizado()'::regprocedure")" = "boolean" ] && ok "la función devuelve solo boolean" || mal "la función no devuelve boolean"
[ "$(Q -c "select string_agg(r || ':' || has_function_privilege(r, 'public.nx_fel_autorizado()', 'execute')::text, ',' order by r) from unnest(array['anon','authenticated','service_role']) r")" = "anon:false,authenticated:true,service_role:false" ] && ok "ejecución: solo authenticated (anon y service_role no)" || mal "permisos de ejecución inesperados"
[ "$(Q -c "select count(*) from aclexplode((select proacl from pg_proc where oid = 'public.nx_fel_autorizado()'::regprocedure)) where grantee = 0")" = "0" ] && ok "PUBLIC no tiene EXECUTE sobre la función" || mal "PUBLIC tiene EXECUTE"
[ "$(Q -c "select relrowsecurity::text || '|' || (select count(*) from pg_policy where polrelid = c.oid) from pg_class c where oid = 'public.nx_fel_cuentas_autorizadas'::regclass")" = "true|0" ] && ok "la tabla tiene RLS activado y ninguna política" || mal "RLS/políticas de la tabla inesperados"
[ "$(Q -c "select count(*) from aclexplode((select relacl from pg_class where oid = 'public.nx_fel_cuentas_autorizadas'::regclass)) a where a.grantee <> (select oid from pg_roles where rolname = 'postgres')")" = "0" ] && ok "solo el propietario tiene privilegios sobre la tabla" || mal "otros roles tienen privilegios sobre la tabla"
# --- 4. ataques: objetos suplantados
R="$(Q -c "begin" -c "set local role authenticated" -c "select set_config('request.jwt.claim.sub', '$U_ADM2', true) is not null" -c "create temp table nx_fel_cuentas_autorizadas (auth_id uuid)" -c "insert into nx_fel_cuentas_autorizadas values ('$U_ADM2')" -c "set local search_path = pg_temp, public" -c "select public.nx_fel_autorizado()" -c "rollback" | grep -E '^(t|f)$' | tail -1)"
[ "$R" = "f" ] && ok "una tabla temporal con el mismo nombre y search_path del llamante manipulado NO cambia el resultado (false)" || mal "la suplantación con tabla temporal funcionó ($R)"
R="$(Q -c "begin" -c "set local role authenticated" -c "select set_config('request.jwt.claim.sub', '$U_ADM2', true) is not null" -c "create function public.siempre_true(uuid, uuid) returns boolean language sql as 'select true'" -c "create operator public.= (leftarg = uuid, rightarg = uuid, function = public.siempre_true)" -c "set local search_path = public, pg_temp" -c "select public.nx_fel_autorizado()" -c "rollback" | grep -E '^(t|f)$' | tail -1)"
[ "$R" = "f" ] && ok "un operador = suplantado en public NO cambia el resultado (false)" || mal "la suplantación con operador funcionó ($R)"
R="$(Q -c "begin" -c "set local role authenticated" -c "select set_config('request.jwt.claim.sub', '$U_ADM2', true) is not null" -c "create function public.uid() returns uuid language sql as 'select ''$U_AUT''::uuid'" -c "set local search_path = public" -c "select public.nx_fel_autorizado()" -c "rollback" | grep -E '^(t|f)$' | tail -1)"
[ "$R" = "f" ] && ok "una función uid() suplantada en public NO cambia el resultado (false)" || mal "la suplantación de uid() funcionó ($R)"
R="$(Q -c "begin" -c "set local role authenticated" -c "select set_config('request.jwt.claim.sub', '$U_ADM2', true) is not null" -c "select set_config('request.jwt.claims', '{\"sub\":\"$U_AUT\",\"role\":\"authenticated\"}', true) is not null" -c "select public.nx_fel_autorizado()" -c "rollback" | grep -E '^(t|f)$' | tail -1)"
echo "(info) con claim.sub de un usuario y claims de otro la función usa el mismo criterio que auth.uid() de Supabase: $R"
# --- 5. la cuenta se elimina → deja de estar autorizada
Q -c "delete from auth.users where id = '$U_AUT'" >/dev/null
[ "$(Q -c "select count(*) from public.nx_fel_cuentas_autorizadas")" = "0" ] && [ "$(fn authenticated $U_AUT)" = "f" ] && ok "al borrar la cuenta de auth.users se borra su autorización y recibe false" || mal "borrar la cuenta no retira la autorización"
# --- 6. el archivo no contiene datos personales ni abre permisos
grep -qiE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "$SQLF" && mal "el archivo SQL contiene un UUID" || ok "el archivo SQL no contiene ningún UUID"
grep -qE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' "$SQLF" && mal "el archivo SQL contiene un correo" || ok "el archivo SQL no contiene ningún correo"
grep -qiE 'grant[^;]*(to|,)[^;]*\banon\b|grant[^;]*to[^;]*\bpublic\b|row level security[^;]*(force|disable)' "$SQLF" && mal "el archivo SQL concede permisos a anon/public o debilita RLS" || ok "el archivo SQL no concede permisos a anon ni a public ni debilita RLS"
grep -qiE "security definer" "$SQLF" && grep -qE "set search_path = ''" "$SQLF" && ok "el archivo declara SECURITY DEFINER con search_path vacío" || mal "falta SECURITY DEFINER o search_path vacío en el archivo"
CUERPO="$(awk '/as \$fn\$/{f=1;next} /^[[:space:]]*\$fn\$;/{f=0} f' "$SQLF")"
[ -n "$CUERPO" ] && ! echo "$CUERPO" | grep -qiE "pa_profiles|admin|role" && ok "la función no depende del rol admin ni de ninguna tabla de la aplicación (solo de la tabla de cuentas autorizadas)" || mal "la función depende del rol admin o de una tabla de la aplicación (o no se pudo extraer): $CUERPO"
echo "$fallos fallo(s)"; [ "$fallos" = 0 ] && echo "NEXA FEL · ACCESO POR UUID (POSTGRESQL REAL): OK"; exit $((fallos>0))
