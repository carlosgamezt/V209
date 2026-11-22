#!/usr/bin/env bash
# Prueba (sin red ni credenciales reales) de tools/respaldo-nexa-demo.sh.
#   · verificar-respaldo: con un «curl» FALSO; distingue RESPALDO CONFIRMADO / SIN RESPALDOS AUTOMÁTICOS / NO VERIFICABLE y nunca imprime el token.
#   · ensayo-respaldo: con PostgreSQL REAL (un servidor temporal) y envoltorios de psql/pg_dump/pg_restore que SOLO redirigen la cadena del pooler de nexa-demo hacia una base local de prueba que hace de origen;
#     el código del script corre tal cual. Se prueba el camino feliz y cada protección: destino incorrecto, versión del cliente, datos que cambian durante el volcado, restauración que pierde filas, 29 presente, historial distinto,
#     copia vacía, el origen NO se modifica, la copia temporal y la base efímera no sobreviven, y ningún secreto aparece en la salida.
# Uso: bash tools/test-respaldo-nexa-demo.sh      (necesita PostgreSQL 16 en /usr/lib/postgresql/16/bin; se levanta uno temporal)
set -uo pipefail
R="$(cd "$(dirname "$0")/.." && pwd)"; S="$R/tools/respaldo-nexa-demo.sh"; W="$(mktemp -d)"; fallos=0
REF=sbmchmknfercbtziwrge; HOST=aws-0-us-west-2.pooler.supabase.com; CLAVE=CLAVE-FALSA-DE-PRUEBA-9; TOKEN=sbp_TOKEN_FALSO_DE_PRUEBA_1234567890
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}; DATA=${FEL_PGDATA:-/tmp/fel-pgdata-respaldo}; PORT=${FEL_PGPORT:-54394}; SOCK=/tmp; DATA2="${DATA}-destino"; PORT2=$((PORT-1))   # el DESTINO es OTRO servidor (como el contenedor de servicio del ejecutor)
ok() { echo "OK    $1"; }; mal() { echo "FALLO $1"; fallos=$((fallos+1)); }
as_pg() { if [ "$(id -u)" = 0 ]; then su pgtest -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
[ "$(id -u)" != 0 ] || id pgtest >/dev/null 2>&1 || useradd -m pgtest
as_pg "rm -rf '$DATA' && mkdir -p '$DATA' && '$PGBIN/initdb' -D '$DATA' -A trust -U postgres >/dev/null" && as_pg "'$PGBIN/pg_ctl' -D '$DATA' -o '-p $PORT -k $SOCK -c listen_addresses=' -w -l '$DATA/log' start >/dev/null" || { echo "no se pudo levantar PostgreSQL de prueba"; exit 1; }
as_pg "rm -rf '$DATA2' && mkdir -p '$DATA2' && '$PGBIN/initdb' -D '$DATA2' -A trust -U postgres >/dev/null" && as_pg "'$PGBIN/pg_ctl' -D '$DATA2' -o '-p $PORT2 -k $SOCK -c listen_addresses=' -w -l '$DATA2/log' start >/dev/null" || { echo "no se pudo levantar el servidor de destino"; exit 1; }
trap 'as_pg "$PGBIN/pg_ctl -D $DATA -m immediate stop >/dev/null" 2>/dev/null; as_pg "$PGBIN/pg_ctl -D $DATA2 -m immediate stop >/dev/null" 2>/dev/null; rm -rf "$W"' EXIT
P() { "$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d "${DB:-postgres}" -X -q -v ON_ERROR_STOP=1 "$@"; }
Pd() { "$PGBIN/psql" -h "$SOCK" -p "$PORT2" -U postgres -d "${DB:-postgres}" -X -q -v ON_ERROR_STOP=1 "$@"; }
DEST="postgresql://postgres@/postgres?host=$SOCK&port=$PORT2"        # SEGUNDO servidor local y efímero        # PostgreSQL local y efímero (socket Unix) donde se restaura
# ---------------------------------------------------------------------------------------------------------------- envoltorios: SOLO cambian «a dónde apunta la cadena del pooler»
mkdir -p "$W/bin"; REG="$W/reg.txt"; : > "$REG"
cat > "$W/bin/psql" <<SH
#!/usr/bin/env bash
args=(); for a in "\$@"; do case "\$a" in *pooler.supabase.com*) echo "psql->origen" >> "$REG"; a="host=$SOCK port=$PORT dbname=\${FAKE_ORIGEN:-origen} user=postgres";; esac; args+=("\$a"); done
exec $PGBIN/psql "\${args[@]}"
SH
cat > "$W/bin/pg_dump" <<SH
#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then echo "pg_dump (PostgreSQL) \${FAKE_PGDUMP_MAJOR:-16}.1"; exit 0; fi
args=(); for a in "\$@"; do case "\$a" in *pooler.supabase.com*) echo "pg_dump->origen" >> "$REG"; a="host=$SOCK port=$PORT dbname=\${FAKE_ORIGEN:-origen} user=postgres";; esac; args+=("\$a"); done
echo "pg_dump args=\$(printf '%s ' "\${args[@]}" | sed 's|host=[^ ]*||')" >> "$REG"
if [ -n "\${FAKE_ESCRIBE_ANTES:-}" ]; then $PGBIN/psql -h $SOCK -p $PORT -U postgres -d origen -X -q -c "insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id) select gen_random_uuid(), 'Extra', 'Extra S.A.', '9999998-9', id from public.regimenes_fiscales limit 1"; fi
$PGBIN/pg_dump "\${args[@]}"; rc=\$?
if [ -n "\${FAKE_DUMP_VACIO:-}" ]; then for a in "\$@"; do f="\$a"; done; : > "\$f"; fi
if [ -n "\${FAKE_ESCRIBE_DURANTE:-}" ]; then $PGBIN/psql -h $SOCK -p $PORT -U postgres -d origen -X -q -c "insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id) select gen_random_uuid(), 'Extra', 'Extra S.A.', '9999999-9', id from public.regimenes_fiscales limit 1"; fi
exit \$rc
SH
cat > "$W/bin/pg_restore" <<SH
#!/usr/bin/env bash
d=""; prev=""; for a in "\$@"; do [ "\$prev" = "-d" ] && d="\$a"; prev="\$a"; done; echo "pg_restore dest=\${d:-ninguno} args=\$(printf '%s ' "\$@" | sed 's|postgresql://[^ ]*|<url>|')" >> "$REG"
$PGBIN/pg_restore "\$@"; rc=\$?
if [ -n "\${FAKE_RESTORE_PIERDE:-}" ] && printf '%s ' "\$@" | grep -q -- '--section=data'; then dest=""; prev=""; for a in "\$@"; do [ "\$prev" = "-d" ] && dest="\$a"; prev="\$a"; done; $PGBIN/psql "\$dest" -X -q -c "delete from public.documentos where numero_borrador = 1"; fi
if [ -n "\${FAKE_RESTORE_MUTA:-}" ] && printf '%s ' "\$@" | grep -q -- '--section=data'; then dest=""; prev=""; for a in "\$@"; do [ "\$prev" = "-d" ] && dest="\$a"; prev="\$a"; done; $PGBIN/psql "\$dest" -X -q -c "update public.empresas set nombre_comercial = 'Alterado'"; fi
if [ -n "\${FAKE_RESTORE_PRIVS:-}" ] && printf '%s ' "\$@" | grep -q -- '--section=post-data' && printf '%s ' "\$@" | grep -q -- '-d '; then dest=""; prev=""; for a in "\$@"; do [ "\$prev" = "-d" ] && dest="\$a"; prev="\$a"; done; $PGBIN/psql "\$dest" -X -q -c "grant select on public.empresas to anon"; fi
if [ -n "\${FAKE_RESTORE_DEFACL:-}" ] && printf '%s ' "\$@" | grep -q -- '--section=post-data' && printf '%s ' "\$@" | grep -q -- '-d '; then dest=""; prev=""; for a in "\$@"; do [ "\$prev" = "-d" ] && dest="\$a"; prev="\$a"; done; $PGBIN/psql "\$dest" -X -q -c "alter default privileges in schema public grant select on tables to anon"; fi
exit \$rc
SH
cat > "$W/bin/curl" <<'SH'
#!/usr/bin/env bash
out=""; prev=""; for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; done
echo "curl $*" | sed "s|Bearer [^ ]*|Bearer <token>|" >> "$REGISTRO_CURL"
[ -z "${FAKE_CURL_RC:-}" ] || exit "$FAKE_CURL_RC"
printf '%s' "${FAKE_CURL_CUERPO:-}" > "$out"; printf '%s' "${FAKE_CURL_CODIGO:-200}"
SH
chmod +x "$W/bin/"*; export REGISTRO_CURL="$W/regcurl.txt"; : > "$REGISTRO_CURL"
export PATH="$W/bin:$PATH"
env_base() { export FEL_DEMO_PROYECTO_REF=$REF SUPABASE_ACCESS_TOKEN=$TOKEN FEL_DEMO_BD_URL="postgresql://postgres.$REF:$CLAVE@$HOST:6543/postgres" FEL_ENSAYO_DESTINO_URL="$DEST" TMPDIR="$W/tmp"; mkdir -p "$W/tmp"; unset FAKE_CURL_RC FAKE_CURL_CUERPO FAKE_CURL_CODIGO FAKE_PGDUMP_MAJOR FAKE_DUMP_VACIO FAKE_ESCRIBE_DURANTE FAKE_ESCRIBE_ANTES FAKE_RESTORE_MUTA FAKE_RESTORE_PRIVS FAKE_RESTORE_DEFACL FAKE_RESTORE_PIERDE FAKE_ORIGEN; }
sale() { env -i PATH="$PATH" HOME="$W" TMPDIR="$W/tmp" REGISTRO_CURL="$REGISTRO_CURL" FEL_DEMO_PROYECTO_REF="${FEL_DEMO_PROYECTO_REF:-}" SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:-}" FEL_DEMO_BD_URL="${FEL_DEMO_BD_URL:-}" FEL_ENSAYO_DESTINO_URL="${FEL_ENSAYO_DESTINO_URL:-}" \
  FAKE_CURL_RC="${FAKE_CURL_RC:-}" FAKE_CURL_CUERPO="${FAKE_CURL_CUERPO:-}" FAKE_CURL_CODIGO="${FAKE_CURL_CODIGO:-}" FAKE_PGDUMP_MAJOR="${FAKE_PGDUMP_MAJOR:-}" FAKE_DUMP_VACIO="${FAKE_DUMP_VACIO:-}" FAKE_ESCRIBE_DURANTE="${FAKE_ESCRIBE_DURANTE:-}" FAKE_RESTORE_PIERDE="${FAKE_RESTORE_PIERDE:-}" FAKE_ESCRIBE_ANTES="${FAKE_ESCRIBE_ANTES:-}" FAKE_RESTORE_MUTA="${FAKE_RESTORE_MUTA:-}" FAKE_RESTORE_PRIVS="${FAKE_RESTORE_PRIVS:-}" FAKE_RESTORE_DEFACL="${FAKE_RESTORE_DEFACL:-}" FAKE_ORIGEN="${FAKE_ORIGEN:-}" \
  bash "$S" "$@" > "$W/salida.txt" 2>&1; echo $?; }
# ============================================================================================================== A. verificar-respaldo
echo "== A. verificar-respaldo"
env_base
r=$(sale verificar-respaldo); FAKE_CURL_CODIGO=200
[ "$r" = 3 ] && grep -q "RESULTADO: NO VERIFICABLE" "$W/salida.txt" || true
export FAKE_CURL_CUERPO='{"region":"us-west-2","walg_enabled":true,"pitr_enabled":false,"backups":[{"is_physical_backup":false,"status":"COMPLETED","inserted_at":"2026-11-21T10:00:00.000Z"},{"is_physical_backup":false,"status":"COMPLETED","inserted_at":"2026-11-22T10:00:00.000Z"}],"physical_backup_data":{}}'
r=$(sale verificar-respaldo); [ "$r" = 0 ] && grep -q "RESULTADO: RESPALDO CONFIRMADO" "$W/salida.txt" && grep -q "copias listadas por la API: 2" "$W/salida.txt" && grep -q "última copia: 22/11/2026 04:00 (hora de Guatemala)" "$W/salida.txt" && ok "copias listadas → RESPALDO CONFIRMADO (con fecha en hora de Guatemala)" || { mal "no confirma el respaldo"; cat "$W/salida.txt" | head; }
export FAKE_CURL_CUERPO='{"region":"us-west-2","walg_enabled":true,"pitr_enabled":true,"backups":[],"physical_backup_data":{"earliest_physical_backup_date_unix":1}}'
r=$(sale verificar-respaldo); [ "$r" = 0 ] && grep -q "RESULTADO: RESPALDO CONFIRMADO" "$W/salida.txt" && ok "PITR activado sin copias diarias → RESPALDO CONFIRMADO" || mal "PITR no se reconoce"
export FAKE_CURL_CUERPO='{"region":"us-west-2","walg_enabled":false,"pitr_enabled":false,"backups":[],"physical_backup_data":{}}'
r=$(sale verificar-respaldo); [ "$r" = 0 ] && grep -q "RESULTADO: SIN RESPALDOS AUTOMÁTICOS" "$W/salida.txt" && ! grep -q "RESPALDO CONFIRMADO" "$W/salida.txt" && ok "la API responde y no hay copias ni PITR → SIN RESPALDOS AUTOMÁTICOS (distinto de «no verificable»)" || mal "la ausencia de respaldos no se distingue"
for caso in "401|{}|rechazó el token" "403|{}|rechazó el token" "404|{}|HTTP 404" "500|{}|HTTP 500"; do
  export FAKE_CURL_CODIGO="${caso%%|*}" FAKE_CURL_CUERPO="$(echo "$caso" | cut -d'|' -f2)"; r=$(sale verificar-respaldo)
  [ "$r" = 3 ] && grep -q "RESULTADO: NO VERIFICABLE" "$W/salida.txt" && grep -q "${caso##*|}" "$W/salida.txt" && ! grep -q "SIN RESPALDOS\|RESPALDO CONFIRMADO" "$W/salida.txt" && ok "HTTP ${caso%%|*} → NO VERIFICABLE (nunca se toma por «sin respaldos»)" || mal "HTTP ${caso%%|*} no se trata como no verificable"
done
export FAKE_CURL_CODIGO=200 FAKE_CURL_CUERPO='no es json'; r=$(sale verificar-respaldo); [ "$r" = 3 ] && grep -q "NO VERIFICABLE (la respuesta de la API no tiene la estructura esperada)" "$W/salida.txt" && ok "respuesta ilegible → NO VERIFICABLE" || mal "respuesta ilegible no se trata como no verificable"
export FAKE_CURL_CUERPO='{"pitr_enabled":false}'; r=$(sale verificar-respaldo); [ "$r" = 3 ] && grep -q "NO VERIFICABLE" "$W/salida.txt" && ok "respuesta sin la lista de copias → NO VERIFICABLE (no se asume que no hay)" || mal "falta de la lista se toma como ausencia"
export FAKE_CURL_RC=28; r=$(sale verificar-respaldo); [ "$r" = 3 ] && grep -q "NO VERIFICABLE (no se pudo consultar la API" "$W/salida.txt" && ok "tiempo agotado → NO VERIFICABLE" || mal "el tiempo agotado no se trata como no verificable"
env_base; export FAKE_CURL_CUERPO='{"pitr_enabled":false,"backups":[]}'; SUPABASE_ACCESS_TOKEN= r=$(SUPABASE_ACCESS_TOKEN="" sale verificar-respaldo); [ "$r" = 3 ] && grep -q "falta el secreto" "$W/salida.txt" && ok "sin token → NO VERIFICABLE y no consulta" || mal "sin token no se detiene"
FEL_DEMO_PROYECTO_REF=aaaaaaaaaaaaaaaaaaaa r=$(FEL_DEMO_PROYECTO_REF=aaaaaaaaaaaaaaaaaaaa sale verificar-respaldo); [ "$r" = 2 ] && grep -q "PROHIBIDO: la referencia no es la del proyecto nexa-demo" "$W/salida.txt" && ok "con otra referencia de proyecto se rechaza" || mal "otra referencia no se rechaza"
env_base; export FAKE_CURL_CUERPO='{"pitr_enabled":false,"backups":[]}'; : > "$REGISTRO_CURL"; sale verificar-respaldo >/dev/null
[ "$(grep -c '^curl' "$REGISTRO_CURL")" = 1 ] && grep -q -- "api.supabase.com/v1/projects/$REF/database/backups" "$REGISTRO_CURL" && ! grep -qE -- "-X (POST|PUT|PATCH|DELETE)|--data|-d " "$REGISTRO_CURL" && ok "una sola petición, un GET, solo al endpoint de respaldos de nexa-demo (nada se modifica)" || mal "la petición no es un único GET al endpoint previsto"
! grep -q "$TOKEN" "$W/salida.txt" && ! grep -q "$TOKEN" "$REGISTRO_CURL" && ok "el token no aparece en la salida" || mal "el token apareció"
# ============================================================================================================== B. ensayo-respaldo (PostgreSQL REAL)
echo "== B. ensayo-respaldo"
prepara_origen() {   # base «origen» = nexa-demo simulado: shim + las 28 migraciones + datos + historial
  DB=postgres P -c "drop database if exists origen with (force)" -c "create database origen" >/dev/null; DB=origen P -f "$R/tools/shim_supabase.sql" >/dev/null
  for f in "$R"/supabase/migrations/*.sql; do case "$f" in *20261114000100*) ;; *) DB=origen P -f "$f" >/dev/null 2>&1 || { echo "no se pudo aplicar $f"; return 1; };; esac; done
  DB=origen P -c "create schema if not exists supabase_migrations; create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[])" -c "insert into supabase_migrations.schema_migrations (version) values $(ls "$R/supabase/migrations" | grep -v 20261114000100 | sed "s/_.*//; s/.*/('&')/" | paste -sd,)" >/dev/null
  DB=origen P -c "insert into auth.users (id, email, email_confirmed_at) values ('30000000-0000-0000-0000-0000000000a1', 'actor@prueba.local', now())" \
    -c "insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id) select '10000000-0000-0000-0000-0000000000a1', 'Empresa R', 'Empresa R S.A.', '9900001-1', id from public.regimenes_fiscales where codigo = 'general'" \
    -c "insert into public.documentos (id, empresa_id, numero_borrador, estado_preparacion, creado_por) select ('20000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, '10000000-0000-0000-0000-0000000000a1', n, 'borrador', '30000000-0000-0000-0000-0000000000a1' from generate_series(1,5) n" >/dev/null
}
huella_origen() { DB=origen P -tA -c "select md5(string_agg(t, '|' order by t)) from (select 'e'||count(*) t from public.empresas union all select 'd'||count(*) from public.documentos union all select 'u'||count(*) from auth.users union all select 'm'||count(*) from supabase_migrations.schema_migrations union all select 'tab'||count(*) from information_schema.tables where table_schema in ('public','supabase_migrations')) x"; }
sobras() { echo "$(DB=postgres Pd -tA -c "select count(*) from pg_database where datname like 'nexa_ensayo_%'") $(ls -d "$W"/tmp/nexa-respaldo.* 2>/dev/null | wc -l)"; }
prepara_origen && ok "origen simulado preparado (shim + 28 migraciones + datos)" || mal "no se pudo preparar el origen"
env_base; H0="$(huella_origen)"; : > "$REG"
r=$(sale ensayo-respaldo)
[ "$r" = 0 ] && grep -q "ENSAYO DE RESPALDO Y RESTAURACIÓN: OK" "$W/salida.txt" && ok "camino feliz: el ensayo termina OK" || { mal "el ensayo feliz falló"; cat "$W/salida.txt" | tail -15; }
for t in "origen en solo lectura: PostgreSQL RECHAZÓ" "cliente compatible: pg_dump 16" "instantánea consistente del origen \\(tomada [0-9/]+ [0-9:]+, hora de Guatemala\\): 68 tablas" "copia lógica generada" "pg_restore --list" "restauración completa en la base efímera" "datos: las 68 tablas, [0-9]+ filas y su contenido \\(huella por tabla\\) coinciden exactamente con la instantánea del origen" "historial restaurado: las 28 migraciones" "la migración 29 sigue ausente" "estructura, propietarios y permisos: [0-9]+ elementos idénticos" "catálogo de la migración 28 sano" "LIMITACIONES de esta validación [(]no son prueba aprobada[)]" "copia temporal sobrescrita y eliminada" "== INFORME [(]sin datos[)]"; do
  grep -qE "$t" "$W/salida.txt" || { mal "falta en la salida: $t"; grep -E "instantánea|datos:" "$W/salida.txt" | head -3 | cut -c1-200; }; done
grep -qE "SHA-256 [0-9a-f]{64}" "$W/salida.txt" && ok "informe con tamaño y SHA-256 de 64 caracteres" || mal "sin SHA-256"
grep -q "^pg_dump args=.*--snapshot=[0-9A-F]" "$REG" && ok "pg_dump lee la instantánea EXPORTADA por la sesión de solo lectura (--snapshot): conteos, contenido, estructura y copia salen de la misma instantánea" || mal "pg_dump no recibió --snapshot"
[ "$(sobras)" = "0 0" ] && ok "tras el ensayo no queda ni la base efímera ni la copia temporal" || mal "quedaron restos: $(sobras)"
[ "$(huella_origen)" = "$H0" ] && ok "el origen quedó EXACTAMENTE igual (sin escrituras)" || mal "el origen cambió"
! grep -q "$CLAVE" "$W/salida.txt" && ! grep -qE "actor@prueba|ensayo-.*@invalido|Empresa R" "$W/salida.txt" && ok "ni la contraseña ni datos aparecen en la salida" || mal "la salida contiene la contraseña o datos"
[ "$(grep -c "^pg_restore dest=postgresql://postgres@/nexa_ensayo_[0-9a-f]*?host=$SOCK&port=$PORT2 " "$REG")" -ge 3 ] && ! grep "^pg_restore" "$REG" | grep -q "pooler\|supabase\|dest=host=" && ! grep "^pg_restore dest=" "$REG" | grep -v "dest=ninguno" | grep -qv "dest=postgresql://postgres@/nexa_ensayo_" && ok "pg_restore solo recibe como destino la base efímera LOCAL (nunca el origen)" || { mal "pg_restore recibió otro destino"; grep "^pg_restore" "$REG" | cut -c1-150 | head -5; }
# -- protecciones
echo "== protecciones"
no_dump() { ! grep -q "pg_dump->origen" "$REG"; }
for d in "postgresql://postgres.$REF:x@$HOST:5432/postgres" "postgresql://postgres:x@db.otro.supabase.co:5432/postgres" "postgresql://postgres:x@10.0.0.5:5432/postgres" "postgresql://postgres:x@127.0.0.1:5432/otra" "postgresql://postgres:x@localhost:5432/postgres?options=$REF" "postgresql://postgres:x@127.0.0.1:5432/postgres?host=$HOST" "postgresql://postgres:x@127.0.0.1:5432/postgres?hostaddr=10.1.2.3" "postgresql://postgres:x@127.0.0.1:5432/postgres?service=nexa"; do
  env_base; : > "$REG"; export FEL_ENSAYO_DESTINO_URL="$d"; r=$(sale ensayo-respaldo)
  [ "$r" = 2 ] && grep -q "^PROHIBIDO" "$W/salida.txt" && no_dump && [ "$(grep -c 'psql->origen' "$REG")" = 0 ] && ok "destino rechazado sin tocar el origen: ${d%%:x@*}…" || { mal "destino incorrecto aceptado: ${d:0:60}"; head -3 "$W/salida.txt"; }
done
env_base; : > "$REG"; unset FEL_ENSAYO_DESTINO_URL; r=$(env -u FEL_ENSAYO_DESTINO_URL PATH="$PATH" HOME="$W" TMPDIR="$W/tmp" FEL_DEMO_PROYECTO_REF=$REF FEL_DEMO_BD_URL="postgresql://postgres.$REF:$CLAVE@$HOST:6543/postgres" bash "$S" ensayo-respaldo >"$W/salida.txt" 2>&1; echo $?); [ "$r" = 2 ] && grep -q "falta FEL_ENSAYO_DESTINO_URL" "$W/salida.txt" && no_dump && ok "sin destino configurado → se rechaza (no hay valor por defecto)" || mal "sin destino no se rechaza"
env_base; : > "$REG"; export FEL_DEMO_BD_URL="postgresql://postgres.otrootrootrootrootro:x@$HOST:6543/postgres"; r=$(sale ensayo-respaldo); [ "$r" = 2 ] && grep -q "no es la cadena del pooler compartido de nexa-demo" "$W/salida.txt" && no_dump && ok "cadena de origen de otro proyecto → se rechaza" || mal "origen de otro proyecto aceptado"
env_base; export FEL_DEMO_BD_URL="postgresql://postgres.$REF:$CLAVE@evil.example.com:5432/postgres"; r=$(sale ensayo-respaldo); [ "$r" = 2 ] && ok "origen con host que no es el pooler de Supabase → se rechaza" || mal "origen con otro host aceptado"
env_base; : > "$REG"; mkdir -p "$R/zz-tmp-prueba"; r=$(env -i PATH="$PATH" HOME="$W" TMPDIR="$R/zz-tmp-prueba" FEL_DEMO_PROYECTO_REF=$REF FEL_DEMO_BD_URL="postgresql://postgres.$REF:$CLAVE@$HOST:6543/postgres" FEL_ENSAYO_DESTINO_URL="$DEST" bash "$S" ensayo-respaldo >"$W/salida.txt" 2>&1; echo $?)
[ "$r" = 1 ] && grep -q "quedó dentro del espacio de trabajo" "$W/salida.txt" && no_dump && [ -z "$(ls -A "$R/zz-tmp-prueba")" ] && ok "si el directorio temporal cayera dentro del espacio de trabajo (donde un artefacto lo recogería), se aborta ANTES de volcar y se borra" || mal "no se protege el espacio de trabajo"; rmdir "$R/zz-tmp-prueba" 2>/dev/null
env_base; : > "$REG"; export FAKE_PGDUMP_MAJOR=15; r=$(sale ensayo-respaldo); [ "$r" = 1 ] && grep -q "pg_dump 15 no puede volcar un servidor PostgreSQL 16" "$W/salida.txt" && no_dump && [ "$(sobras)" = "0 0" ] && ok "cliente más viejo que el servidor → falla antes de volcar" || mal "no detecta el cliente incompatible"
for gancho in FAKE_ESCRIBE_ANTES FAKE_ESCRIBE_DURANTE; do
  prepara_origen >/dev/null; env_base; export $gancho=1; r=$(sale ensayo-respaldo)
  [ "$r" = 0 ] && grep -q "INFO  el origen cambió DESPUÉS de la instantánea (modificación legítima)" "$W/salida.txt" && grep -q "ENSAYO DE RESPALDO Y RESTAURACIÓN: OK" "$W/salida.txt" && [ "$(sobras)" = "0 0" ] && ok "el origen cambia (${gancho#FAKE_ESCRIBE_}: $( [ $gancho = FAKE_ESCRIBE_ANTES ] && echo entre la instantánea y el volcado || echo tras el volcado )): la copia sigue siendo CONSISTENTE con la instantánea, se informa como modificación legítima y no se confunde con una restauración incorrecta" || { mal "un cambio posterior a la instantánea rompe o no se informa ($gancho)"; tail -4 "$W/salida.txt"; }
done
prepara_origen >/dev/null
env_base; export FAKE_DUMP_VACIO=1; r=$(sale ensayo-respaldo); [ "$r" = 1 ] && grep -q "FALLO" "$W/salida.txt" && ! grep -q "ENSAYO DE RESPALDO Y RESTAURACIÓN: OK" "$W/salida.txt" && [ "$(sobras)" = "0 0" ] && ok "copia vacía o ilegible → falla y limpia" || mal "una copia vacía no hace fallar"
env_base; export FAKE_RESTORE_PIERDE=1; r=$(sale ensayo-respaldo); [ "$r" = 1 ] && grep -q "los conteos de filas de lo restaurado NO coinciden con la instantánea del origen: la restauración es incorrecta" "$W/salida.txt" && grep -q "diferencias por tabla" "$W/salida.txt" && [ "$(sobras)" = "0 0" ] && ok "una restauración que pierde filas → falla, muestra qué tabla difiere y limpia" || { mal "no detecta la restauración incompleta"; tail -5 "$W/salida.txt"; }
prepara_origen >/dev/null
env_base; export FAKE_RESTORE_MUTA=1; r=$(sale ensayo-respaldo); [ "$r" = 1 ] && grep -q "el CONTENIDO de lo restaurado no coincide con la instantánea del origen (mismas filas, datos distintos)" "$W/salida.txt" && ok "datos alterados con el MISMO número de filas → falla por la huella de contenido (no basta con contar)" || { mal "no detecta datos alterados con igual conteo"; tail -4 "$W/salida.txt"; }
env_base; export FAKE_RESTORE_PRIVS=1; r=$(sale ensayo-respaldo); [ "$r" = 1 ] && grep -q "la estructura, los propietarios o los permisos de lo restaurado NO coinciden con el origen" "$W/salida.txt" && grep -q "DIF|privilegio\|DIF|relacion" "$W/salida.txt" && ok "un permiso de más para anon en lo restaurado → se detecta por los privilegios efectivos y las ACL, y falla" || { mal "no detecta un permiso de más en lo restaurado"; tail -6 "$W/salida.txt"; }
env_base; export FAKE_RESTORE_DEFACL=1; r=$(sale ensayo-respaldo); [ "$r" = 1 ] && grep -q "DIF|acl_defecto" "$W/salida.txt" && ok "un privilegio por defecto distinto en lo restaurado → se detecta y falla" || { mal "no detecta privilegios por defecto distintos"; tail -6 "$W/salida.txt"; }
Pr() { DB=origen P "$@"; }; Pr -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = 'zz_externo') then create role zz_externo nologin; end if; end \$\$" -c "grant select on public.empresas to zz_externo" >/dev/null
env_base; r=$(sale ensayo-respaldo); [ "$r" = 0 ] && grep -q "LIMITACIÓN: la copia menciona roles que el destino no tenía (zz_externo); se crearon vacíos: sus atributos y membresías NO se reproducen" "$W/salida.txt" && grep -q "ENSAYO DE RESPALDO Y RESTAURACIÓN: OK" "$W/salida.txt" && ok "un rol del origen que el destino no tiene → se crea vacío y se declara como LIMITACIÓN (no como prueba aprobada); los permisos restaurados coinciden" || { mal "el rol ausente en el destino no se maneja o no se declara"; tail -6 "$W/salida.txt"; }
Pr -c "revoke select on public.empresas from zz_externo" >/dev/null
DB=origen P -c "delete from supabase_migrations.schema_migrations where version = (select min(version) from supabase_migrations.schema_migrations)" >/dev/null
env_base; r=$(sale ensayo-respaldo); [ "$r" = 1 ] && grep -q "NO tiene exactamente 28 migraciones" "$W/salida.txt" && ok "historial con 27 migraciones → falla" || mal "historial incompleto no hace fallar"
prepara_origen >/dev/null; DB=origen P -f "$R/supabase/migrations/20261114000100_fel_digifact_operaciones.sql" >/dev/null 2>&1
env_base; r=$(sale ensayo-respaldo); [ "$r" = 1 ] && grep -q "la migración 29 ya existe en el origen" "$W/salida.txt" && ok "la 29 ya aplicada en el origen → falla (el ensayo es previo a la 29)" || mal "la 29 presente no hace fallar"
prepara_origen >/dev/null; DB=origen P -c "grant select on public.empresas to anon" >/dev/null
env_base; r=$(sale ensayo-respaldo); [ "$r" = 1 ] && grep -q "NO pasa el catálogo de la migración 28" "$W/salida.txt" && ok "un origen con un permiso de más (anon puede leer empresas) → la copia restaurada no pasa el catálogo de la 28 y el ensayo FALLA" || { mal "un origen con permisos de más no hace fallar"; tail -3 "$W/salida.txt"; }
[ "$(sobras)" = "0 0" ] && ok "tras todos los casos no quedan bases efímeras ni copias temporales" || mal "quedaron restos: $(sobras)"
# -- el origen: ninguna orden de escritura/restauración se le dirige (revisión del propio script)
echo "== revisión estática"
! grep -nE 'src (pg_restore|createdb|dropdb)|src psql [^|]*(create|drop|alter|insert|update|delete|truncate|grant)' "$S" | grep -v "zz_nexa_prueba_escritura" | grep -q . && ok "el script nunca dirige restauraciones ni escrituras al origen" || mal "el script dirige una escritura al origen"
grep -q 'upload-artifact\|actions/cache\|gh release' "$S" && mal "el script contiene publicación" || ok "el script no publica nada (ni artefactos, ni cachés, ni releases)"
[ "$fallos" = 0 ] && echo "RESPALDO NEXA-DEMO (FASE 1) OK" || { echo "$fallos fallo(s)"; exit 1; }
