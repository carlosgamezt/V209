#!/usr/bin/env bash
# Prueba (sin red ni credenciales reales) de tools/respaldo-nexa-demo.sh.
#   · verificar-respaldo: con un «curl» FALSO; distingue RESPALDO CONFIRMADO / SIN RESPALDOS AUTOMÁTICOS / NO VERIFICABLE y nunca imprime el token.
#   · ensayo-respaldo: con PostgreSQL REAL (un servidor temporal) y envoltorios de psql/pg_dump/pg_restore que SOLO redirigen la cadena del pooler de nexa-demo hacia una base local de prueba que hace de origen;
#     el código del script corre tal cual. Se prueba el camino feliz y cada protección: destino incorrecto, versión del cliente, datos que cambian durante el volcado, restauración que pierde filas, 29 presente, historial distinto,
#     copia vacía, el origen NO se modifica, la copia temporal y la base efímera no sobreviven, y ningún secreto aparece en la salida.
# Uso: bash tools/test-respaldo-nexa-demo.sh      (detecta el PostgreSQL instalado, ≥ 15, con initdb, pg_ctl, psql, pg_dump y pg_restore; PGBIN lo fija a mano; si no hay ninguno FALLA; levanta dos servidores temporales)
set -uo pipefail
R="$(cd "$(dirname "$0")/.." && pwd)"; S="$R/tools/respaldo-nexa-demo.sh"; W="$(mktemp -d)"; fallos=0
REF=sbmchmknfercbtziwrge; HOST=aws-0-us-west-2.pooler.supabase.com; CLAVE=CLAVE-FALSA-DE-PRUEBA-9; TOKEN=sbp_TOKEN_FALSO_DE_PRUEBA_1234567890
DATA=${FEL_PGDATA:-/tmp/fel-pgdata-respaldo}; PORT=${FEL_PGPORT:-54394}; SOCK=/tmp; DATA2="${DATA}-destino"; PORT2=$((PORT-1))   # el DESTINO es OTRO servidor (como el contenedor de servicio del ejecutor)
ok() { echo "OK    $1"; }; mal() { echo "FALLO $1"; fallos=$((fallos+1)); }
# ---- PostgreSQL de prueba: NO depende de una ruta fija. Se detecta el que haya (PGBIN si se indica; si no, pg_config y /usr/lib/postgresql/*/bin), se exige que tenga initdb, pg_ctl, psql, pg_dump y pg_restore de la MISMA versión mayor (≥ 15)
# y se elige la más nueva. Si no hay ninguno, la prueba FALLA (no se omite): en CI lo instala .github/actions/postgresql-17 y deja PGBIN.
herramientas_pg() { local c="$1" h v w; for h in initdb pg_ctl psql pg_dump pg_restore; do [ -x "$c/$h" ] || { echo "faltan herramientas en $c: $h"; return 1; }; done
  v="$("$c/initdb" --version | grep -oE '[0-9]+' | head -1)"; for h in pg_ctl psql pg_dump pg_restore; do w="$("$c/$h" --version | grep -oE '[0-9]+' | head -1)"; [ "$w" = "$v" ] || { echo "$h es de la versión $w y initdb de la $v en $c"; return 1; }; done
  [ "$v" -ge 15 ] 2>/dev/null || { echo "la versión $v de $c es anterior a la 15"; return 1; }; echo "$v"; }
detectar_pg() { local c v mejor="" mejorv=0 cands=() d
  if [ -n "${PGBIN:-}" ]; then v="$(herramientas_pg "$PGBIN")" || { echo "FALLO: PGBIN=$PGBIN no sirve: $v"; return 1; }; PGMAYOR="$v"; return 0; fi
  cands+=("$(pg_config --bindir 2>/dev/null || true)"); for d in /usr/lib/postgresql/*/bin; do cands+=("$d"); done
  for c in "${cands[@]}"; do [ -n "$c" ] && [ -d "$c" ] || continue; v="$(herramientas_pg "$c" 2>/dev/null)" || continue; if [ "$v" -gt "$mejorv" ]; then mejor="$c"; mejorv="$v"; fi; done
  [ -n "$mejor" ] || return 1; PGBIN="$mejor"; PGMAYOR="$mejorv"; }
detectar_pg || { echo "FALLO: no hay un PostgreSQL (≥ 15) con initdb, pg_ctl, psql, pg_dump y pg_restore en este equipo. Instálalo (en CI: .github/actions/postgresql-17). La prueba NO se omite."; exit 1; }
echo "PostgreSQL de prueba: $PGBIN (versión $PGMAYOR)"
as_pg() { if [ "$(id -u)" = 0 ]; then su pgtest -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
[ "$(id -u)" != 0 ] || id pgtest >/dev/null 2>&1 || useradd -m pgtest
# ORDENACIONES DISTINTAS a propósito (fallo real de la corrida 44982292038): el ORIGEN usa «C» y el DESTINO una ordenación que ignora la puntuación (en_US.utf8 de glibc o, si no existe, ICU «und-u-ka-shifted»).
#   Con la misma base de datos para ambos, una huella que dependiera de la ordenación pasaría sin que nadie lo notara.
LOC_ORIGEN="--locale=C --encoding=UTF8"
if locale -a 2>/dev/null | grep -qix 'en_US.utf-\?8'; then LOC_DESTINO="--locale=en_US.UTF-8"; DESC_LOC="en_US.UTF-8 (glibc)"; else LOC_DESTINO="--locale=C --encoding=UTF8 --locale-provider=icu --icu-locale=und-u-ka-shifted"; DESC_LOC="ICU und-u-ka-shifted"; fi
as_pg "rm -rf '$DATA' && mkdir -p '$DATA' && '$PGBIN/initdb' -D '$DATA' -A trust -U postgres $LOC_ORIGEN >/dev/null" && as_pg "'$PGBIN/pg_ctl' -D '$DATA' -o '-p $PORT -k $SOCK -c listen_addresses=' -w -l '$DATA/log' start >/dev/null" || { echo "no se pudo levantar PostgreSQL de prueba"; exit 1; }
as_pg "rm -rf '$DATA2' && mkdir -p '$DATA2' && '$PGBIN/initdb' -D '$DATA2' -A trust -U postgres $LOC_DESTINO >/dev/null" && as_pg "'$PGBIN/pg_ctl' -D '$DATA2' -o '-p $PORT2 -k $SOCK -c listen_addresses=' -w -l '$DATA2/log' start >/dev/null" || { echo "no se pudo levantar el servidor de destino"; exit 1; }
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
if [ "\${1:-}" = "--version" ]; then echo "pg_dump (PostgreSQL) \${FAKE_PGDUMP_MAJOR:-$PGMAYOR}.1"; exit 0; fi
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
env_base() { export FEL_DEMO_PROYECTO_REF=$REF SUPABASE_ACCESS_TOKEN=$TOKEN FEL_DEMO_BD_URL="postgresql://postgres.$REF:$CLAVE@$HOST:6543/postgres" FEL_ENSAYO_DESTINO_URL="$DEST" TMPDIR="$W/tmp"; mkdir -p "$W/tmp"; unset FAKE_CURL_RC FAKE_CURL_CUERPO FAKE_CURL_CODIGO FAKE_PGDUMP_MAJOR FAKE_DUMP_VACIO FAKE_ESCRIBE_DURANTE FAKE_ESCRIBE_ANTES FAKE_RESTORE_MUTA FAKE_RESTORE_PRIVS FAKE_RESTORE_DEFACL FAKE_RESTORE_PIERDE FAKE_ORIGEN R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET AGE_PUBLIC_KEY FEL_R2_ENDPOINT_PRUEBA; }
sale() { env -i PATH="$PATH" HOME="$W" TMPDIR="$W/tmp" REGISTRO_CURL="$REGISTRO_CURL" FEL_DEMO_PROYECTO_REF="${FEL_DEMO_PROYECTO_REF:-}" SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:-}" FEL_DEMO_BD_URL="${FEL_DEMO_BD_URL:-}" FEL_ENSAYO_DESTINO_URL="${FEL_ENSAYO_DESTINO_URL:-}" \
  FAKE_CURL_RC="${FAKE_CURL_RC:-}" FAKE_CURL_CUERPO="${FAKE_CURL_CUERPO:-}" FAKE_CURL_CODIGO="${FAKE_CURL_CODIGO:-}" FAKE_PGDUMP_MAJOR="${FAKE_PGDUMP_MAJOR:-}" FAKE_DUMP_VACIO="${FAKE_DUMP_VACIO:-}" FAKE_ESCRIBE_DURANTE="${FAKE_ESCRIBE_DURANTE:-}" FAKE_RESTORE_PIERDE="${FAKE_RESTORE_PIERDE:-}" FAKE_ESCRIBE_ANTES="${FAKE_ESCRIBE_ANTES:-}" FAKE_RESTORE_MUTA="${FAKE_RESTORE_MUTA:-}" FAKE_RESTORE_PRIVS="${FAKE_RESTORE_PRIVS:-}" FAKE_RESTORE_DEFACL="${FAKE_RESTORE_DEFACL:-}" FAKE_ORIGEN="${FAKE_ORIGEN:-}" \
  R2_ACCOUNT_ID="${R2_ACCOUNT_ID:-}" R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:-}" R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:-}" R2_BUCKET="${R2_BUCKET:-}" AGE_PUBLIC_KEY="${AGE_PUBLIC_KEY:-}" FEL_R2_ENDPOINT_PRUEBA="${FEL_R2_ENDPOINT_PRUEBA:-}" \
  bash "$S" "$@" > "$W/salida.txt" 2>&1; echo $?; }
# ============================================================================================================== 0. instalación verificada de PostgreSQL 17 (el workflow manual y el CI usan tools/instalar-postgresql-17.sh)
echo "== 0. instalación verificada de PostgreSQL 17"
IN="$R/tools/instalar-postgresql-17.sh"; GH="$W/gpg"; mkdir -p "$GH"; chmod 700 "$GH"
command -v gpg >/dev/null || mal "falta gpg: no se puede probar la verificación de la clave"
for n in 1 2; do GNUPGHOME="$GH" gpg --batch --quiet --passphrase '' --quick-generate-key "prueba$n <p$n@invalido.test>" rsa2048 sign never 2>/dev/null; done
GNUPGHOME="$GH" gpg --batch --list-keys --with-colons 2>/dev/null | awk -F: '$1=="fpr"{print $10}' | grep -v '^$' > "$W/fprs.txt"
FPR1="$(sed -n 1p "$W/fprs.txt")"; FPR2="$(sed -n 2p "$W/fprs.txt")"
GNUPGHOME="$GH" gpg --batch --armor --export "$FPR1" > "$W/k1.asc" 2>/dev/null; GNUPGHOME="$GH" gpg --batch --armor --export "$FPR2" > "$W/k2.asc" 2>/dev/null; cat "$W/k1.asc" "$W/k2.asc" > "$W/ambas.asc"; echo "no es una clave" > "$W/basura.asc"; : > "$W/vacia.asc"
t() { ( set +e; export HUELLA_PRUEBA="$1"; source "$IN"; HUELLA_PGDG="$HUELLA_PRUEBA"; verificar_huella "$2" >/dev/null 2>&1; echo $? ); }
[ -n "$FPR1" ] && [ -n "$FPR2" ] && [ "$FPR1" != "$FPR2" ] || mal "no se pudieron generar las claves de prueba"
[ "$(t "$FPR1" "$W/k1.asc")" = 0 ] && ok "una clave con la huella esperada se acepta" || mal "no acepta la huella esperada"
[ "$(t "$FPR1" "$W/k2.asc")" != 0 ] && ok "una clave con OTRA huella se rechaza" || mal "acepta una clave con otra huella"
[ "$(t "$FPR1" "$W/ambas.asc")" != 0 ] && ok "un archivo con DOS claves se rechaza aunque una sea la esperada" || mal "acepta un archivo con dos claves"
[ "$(t "$FPR1" "$W/basura.asc")" != 0 ] && [ "$(t "$FPR1" "$W/vacia.asc")" != 0 ] && ok "un archivo ilegible o vacío se rechaza" || mal "acepta un archivo ilegible"
r=$(bash "$IN" verificar-clave "$W/k2.asc" >"$W/salida.txt" 2>&1; echo $?); [ "$r" = 1 ] && grep -q "NO es la oficial" "$W/salida.txt" && ok "el instalador, por la línea de órdenes, rechaza una clave que no es la oficial" || mal "el instalador no rechaza una clave ajena"
OFICIAL="$( ( set +e; source "$IN"; echo "$HUELLA_PGDG" ) )"; [ "$OFICIAL" = "B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8" ] && ok "la huella confiada es la oficial de PGDG (B97B 0AFC AA1A 47F0 44F2 44A0 7FCC 7D46 ACCC 4CF8)" || mal "la huella confiada no es la oficial"
vi() { ( set +e; source "$IN"; BIN="$1"; MAYOR="$2"; verificar_instalacion "$3" >/dev/null 2>&1; echo $? ); }
mkdir -p "$W/vacio"; [ "$(vi "$W/vacio" "$PGMAYOR" true)" != 0 ] && ok "un directorio sin herramientas se rechaza" || mal "acepta una instalación vacía"
[ "$(vi "$PGBIN" "$PGMAYOR" true)" = 0 ] && ok "la instalación detectada (initdb, pg_ctl, psql, pg_dump, pg_restore) se acepta" || mal "no acepta la instalación detectada"
[ "$(vi "$PGBIN" "$((PGMAYOR+1))" true)" != 0 ] && ok "una versión mayor distinta de la esperada se rechaza" || mal "acepta una versión mayor distinta"
r=$(cd "$W" && PGBIN="$W/vacio" bash -c "set +e; $(declare -f herramientas_pg detectar_pg); detectar_pg; echo \$?" 2>&1 | tail -1); [ "$r" != 0 ] && ok "si PGBIN apunta a algo sin las herramientas, la detección FALLA (no elige otro en silencio)" || mal "la detección acepta un PGBIN inválido"
# flujo COMPLETO del instalador con sudo, apt-get, curl y dpkg-query SIMULADOS (nada del sistema se toca): orden, firma, versión mayor y paquetes. La huella oficial no se puede falsificar, así que la prueba usa una clave propia SOLO dentro de este subproceso.
sim_instalar() {   # $1 servidor · $2 clave servida (archivo) · $3 huella confiada · $4 versión que «instalan» las herramientas falsas · $5 «previas» (1 = herramientas ya instaladas)
  ( set +e; source "$IN"; HUELLA_PGDG="$3"; BIN="$W/bin17"; rm -rf "$BIN"; mkdir -p "$BIN"; LOG="$W/sim.log"; : > "$LOG"; : > "$W/sim.tee"
    VF="$4"; PREV="$5"
    falsas() { local h; for h in psql pg_dump pg_restore initdb pg_ctl; do printf '#!/bin/sh\necho "%s (PostgreSQL) %s.1"\n' "$h" "$VF" > "$BIN/$h"; chmod +x "$BIN/$h"; done; }
    [ "$PREV" != 1 ] || falsas
    sudo() { echo "sudo $*" >> "$LOG"; [ "$1" != tee ] || cat >> "$W/sim.tee"; case "$*" in *"apt-get install"*postgresql-client-17*) falsas;; esac; return 0; }
    curl() { local o=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && o="$2"; shift; done; cp "$W/serv.asc" "$o"; echo "curl -> clave" >> "$LOG"; }
    dpkg-query() { echo "postgresql-client-17 17.99-simulado"; }
    cp "$2" "$W/serv.asc"; instalar "$1" >"$W/sim.out" 2>&1; echo $? ) ; }
r=$(sim_instalar false "$W/k1.asc" "$FPR1" 17 0)
[ "$r" = 0 ] && grep -q "Clave de PGDG verificada" "$W/sim.out" && grep -q "signed-by=/usr/share/keyrings/pgdg.gpg" "$W/sim.tee" && grep -q "bookworm-pgdg\|-pgdg main" "$W/sim.tee" && grep -q "create_main_cluster = false" "$W/sim.tee" && grep -q "apt-get install .*postgresql-client-17" "$W/sim.log" && ! grep -qE "apt-get install .* postgresql-17( |$)" "$W/sim.log" && ok "instalador (solo cliente): verifica la clave, declara el repositorio con signed-by, no crea clúster e instala SOLO postgresql-client-17" || { mal "el flujo del instalador (cliente) no es el esperado"; cat "$W/sim.out" "$W/sim.log" | head -12; }
[ "$(grep -n 'curl' "$W/sim.log" | head -1 | cut -d: -f1)" -lt "$(grep -n 'apt-get update' "$W/sim.log" | head -1 | cut -d: -f1)" ] && [ "$(grep -n 'install -d' "$W/sim.log" | head -1 | cut -d: -f1)" -lt "$(grep -n 'apt-get update' "$W/sim.log" | head -1 | cut -d: -f1)" ] && grep -q 'Dir::Etc::sourcelist=sources.list.d/pgdg.list' "$W/sim.log" && ok "el orden es: descargar y verificar la clave → declarar el repositorio → actualizar SOLO la lista de PGDG → instalar" || mal "el orden del instalador no es el esperado"
r=$(sim_instalar true "$W/k1.asc" "$FPR1" 17 0); [ "$r" = 0 ] && grep -qE "apt-get install .*postgresql-client-17 postgresql-17" "$W/sim.log" && [ "$(grep -n 'createcluster' "$W/sim.log" | head -1 | cut -d: -f1)" != "" ] && ok "instalador (con servidor): instala también postgresql-17 y deja el clúster sin crear (initdb y pg_ctl disponibles)" || { mal "el instalador con servidor no instala postgresql-17"; cat "$W/sim.log" | head; }
r=$(sim_instalar false "$W/k2.asc" "$FPR1" 17 0); [ "$r" != 0 ] && grep -q "NO es la oficial de PostgreSQL" "$W/sim.out" && ! grep -qE "apt-get|install|tee" "$W/sim.log" && ok "con una clave que NO es la oficial: se aborta ANTES de tocar el sistema (ningún sudo, apt-get ni repositorio)" || { mal "una clave ajena no detiene el instalador a tiempo"; cat "$W/sim.log" | head -5; }
r=$(sim_instalar false "$W/k1.asc" "$FPR1" 16 0); [ "$r" != 0 ] && grep -q "se esperaba 17" "$W/sim.out" && ok "si lo instalado no es de la versión mayor 17, el instalador FALLA (no se acepta otro cliente)" || mal "acepta un cliente de otra versión mayor"
r=$(sim_instalar true "$W/k1.asc" "$FPR1" 17 1); [ "$r" = 0 ] && grep -q "ya está instalado" "$W/sim.out" && [ ! -s "$W/sim.log" ] && ok "si PostgreSQL 17 ya está completo no se reinstala ni se toca el sistema" || mal "reinstala aunque ya esté completo"
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
  for f in "$R"/supabase/migrations/*.sql; do case "$f" in *20261114000100*|*20261115000100*) ;; *) DB=origen P -f "$f" >/dev/null 2>&1 || { echo "no se pudo aplicar $f"; return 1; };; esac; done
  DB=origen P -c "create schema if not exists supabase_migrations; create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[])" -c "insert into supabase_migrations.schema_migrations (version) values $(ls "$R/supabase/migrations" | grep -v -e 20261114000100 -e 20261115000100 | sed "s/_.*//; s/.*/('&')/" | paste -sd,)" >/dev/null
  DB=origen P -c "insert into auth.users (id, email, email_confirmed_at) values ('30000000-0000-0000-0000-0000000000a1', 'actor@prueba.local', now())" \
    -c "insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id) select '10000000-0000-0000-0000-0000000000a1', 'Empresa R', 'Empresa R S.A.', '9900001-1', id from public.regimenes_fiscales where codigo = 'general'" \
    -c "insert into public.documentos (id, empresa_id, numero_borrador, estado_preparacion, creado_por) select ('20000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, '10000000-0000-0000-0000-0000000000a1', n, 'borrador', '30000000-0000-0000-0000-0000000000a1' from generate_series(1,5) n" \
    -c "revoke usage on schema public from anon, authenticated, service_role" -c "grant usage on schema public to postgres, anon, authenticated, service_role" \
    -c "insert into public.auditoria (accion, entidad, entidad_id, datos) select 'prueba-orden', 'documento', 'id-' || n, jsonb_build_object('n', n, 'texto', 'línea ' || n) from generate_series(1,160) n" >/dev/null
}
huella_origen() { DB=origen P -tA -c "select md5(string_agg(t, '|' order by t)) from (select 'e'||count(*) t from public.empresas union all select 'd'||count(*) from public.documentos union all select 'u'||count(*) from auth.users union all select 'm'||count(*) from supabase_migrations.schema_migrations union all select 'tab'||count(*) from information_schema.tables where table_schema in ('public','supabase_migrations')) x"; }
sobras() { echo "$(DB=postgres Pd -tA -c "select count(*) from pg_database where datname like 'nexa_ensayo_%'") $(ls -d "$W"/tmp/nexa-respaldo.* 2>/dev/null | wc -l)"; }
prepara_origen && ok "origen simulado preparado (shim + 28 migraciones + datos)" || mal "no se pudo preparar el origen"
# -- las dos bases NO ordenan igual (si no, esta prueba no detectaría el fallo): la misma consulta de huella con «order by» SIN collate da resultados distintos
SENS="select md5(string_agg(t::text, '|' order by t::text)) from (select (g::bigint, 'x') t from generate_series(1,25) g) s"
[ "$(DB=postgres P -tA -c "$SENS")" != "$(DB=postgres Pd -tA -c "$SENS")" ] && ok "el origen (C) y el destino ($DESC_LOC) ordenan DISTINTO: la prueba es sensible al fallo de la ordenación" || mal "las dos bases ordenan igual: la prueba no detectaría el fallo de la ordenación"
SENS2="select md5(string_agg(t::text, '|' order by t::text collate \"C\")) from (select (g::bigint, 'x') t from generate_series(1,25) g) s"
[ "$(DB=postgres P -tA -c "$SENS2")" = "$(DB=postgres Pd -tA -c "$SENS2")" ] && ok "con collate \"C\" la huella es idéntica en ambas ordenaciones" || mal "con collate \"C\" la huella sigue dependiendo de la ordenación"
env_base; H0="$(huella_origen)"; : > "$REG"
r=$(sale ensayo-respaldo)
[ "$r" = 0 ] && grep -q "ENSAYO DE RESPALDO Y RESTAURACIÓN: OK" "$W/salida.txt" && ok "camino feliz: el ensayo termina OK" || { mal "el ensayo feliz falló"; cat "$W/salida.txt" | tail -15; }
for t in "origen en solo lectura: PostgreSQL RECHAZÓ" "cliente compatible: pg_dump $PGMAYOR" "instantánea consistente del origen \\(tomada [0-9/]+ [0-9:]+, hora de Guatemala\\): 68 tablas" "copia lógica generada" "pg_restore --list" "restauración completa en la base efímera" "datos: las 68 tablas, [0-9]+ filas y su contenido \\(huella por tabla\\) coinciden exactamente con la instantánea del origen" "historial restaurado: las 28 migraciones" "la migración 29 sigue ausente" "estructura, propietarios y permisos: [0-9]+ elementos idénticos" "catálogo de la migración 28 sano" "LIMITACIONES de esta validación [(]no son prueba aprobada[)]" "copia temporal sobrescrita y eliminada" "== INFORME [(]sin datos[)]"; do
  grep -qE "$t" "$W/salida.txt" || { mal "falta en la salida: $t"; grep -E "instantánea|datos:" "$W/salida.txt" | head -3 | cut -c1-200; }; done
grep -qE "SHA-256 [0-9a-f]{64}" "$W/salida.txt" && ok "informe con tamaño y SHA-256 de 64 caracteres" || mal "sin SHA-256"
grep -q "^pg_dump args=.*--snapshot=[0-9A-F]" "$REG" && ok "pg_dump lee la instantánea EXPORTADA por la sesión de solo lectura (--snapshot): conteos, contenido, estructura y copia salen de la misma instantánea" || mal "pg_dump no recibió --snapshot"
[ "$(sobras)" = "0 0" ] && ok "tras el ensayo no queda ni la base efímera ni la copia temporal" || mal "quedaron restos: $(sobras)"
grep -q "INFO  ordenación (collation/ctype/proveedor) · origen: C" "$W/salida.txt" && ok "el informe muestra la ordenación de origen y destino (diagnóstico sin datos)" || mal "falta el INFO de ordenación"
# -- REPRODUCCIÓN EXACTA del fallo de la corrida 44982292038: el algoritmo ANTERIOR (order by t::text SIN collate «C») entre bases con distinta ordenación
WBASE="$(mktemp -d)"; WREP="$WBASE/fel"; mkdir -p "$WREP/tools"; for f in "$R"/tools/*; do [ "$(basename "$f")" = "respaldo-nexa-demo.sh" ] || ln -s "$f" "$WREP/tools/"; done; for d in docs supabase; do ln -s "$R/$d" "$WREP/$d"; done
sed 's/ order by t::text collate "C")/ order by t::text)/; s/order by table_schema collate "C", table_name collate "C";/order by 1;/' "$S" > "$WREP/tools/respaldo-nexa-demo.sh"
! diff -q "$S" "$WREP/tools/respaldo-nexa-demo.sh" >/dev/null && ok "copia del algoritmo ANTERIOR (sin collate \"C\") preparada para reproducir el fallo" || mal "no se pudo preparar el algoritmo anterior"
S_NUEVO="$S"; S="$WREP/tools/respaldo-nexa-demo.sh"; cp "$REG" "$W/reg.feliz"; env_base; : > "$REG"; r=$(sale ensayo-respaldo); cp "$W/salida.txt" "$W/anterior.txt"; S="$S_NUEVO"; cp "$W/reg.feliz" "$REG"; rm -rf "$WBASE"; env_base
[ "$r" = 1 ] && grep -q "FALLO: el CONTENIDO de lo restaurado no coincide con la instantánea del origen (mismas filas, datos distintos)" "$W/anterior.txt" && grep -q "public.auditoria=160:" "$W/anterior.txt" && ok "el algoritmo anterior REPRODUCE el fallo real (mismas filas, datos distintos, en public.auditoria) con ordenaciones distintas" || { mal "el algoritmo anterior no reproduce el fallo"; tail -8 "$W/anterior.txt"; }
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
env_base; : > "$REG"; export FAKE_PGDUMP_MAJOR=$((PGMAYOR-1)); r=$(sale ensayo-respaldo); [ "$r" = 1 ] && grep -q "pg_dump $((PGMAYOR-1)) no puede volcar un servidor PostgreSQL $PGMAYOR" "$W/salida.txt" && no_dump && [ "$(sobras)" = "0 0" ] && ok "cliente más viejo que el servidor → falla antes de volcar" || mal "no detecta el cliente incompatible"
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
env_base; r=$(sale ensayo-respaldo); [ "$r" = 1 ] && grep -q "NO tiene exactamente 28, 29 ni 30 migraciones" "$W/salida.txt" && ok "historial con 27 migraciones → falla" || mal "historial incompleto no hace fallar"
prepara_origen >/dev/null; DB=origen P -f "$R/supabase/migrations/20261114000100_fel_digifact_operaciones.sql" >/dev/null 2>&1
env_base; r=$(sale ensayo-respaldo); [ "$r" = 1 ] && grep -q "la migración 29 ya existe en el origen" "$W/salida.txt" && ok "la 29 ya aplicada en el origen → falla (el ensayo es previo a la 29)" || mal "la 29 presente no hace fallar"
# -- origen con las 29 migraciones (la 29 aplicada Y registrada): el ensayo vale para ese estado, con el catálogo de la 29 sobre lo restaurado
prepara_origen29() { prepara_origen >/dev/null; DB=origen P -f "$R/supabase/migrations/20261114000100_fel_digifact_operaciones.sql" >/dev/null 2>&1 && DB=origen P -c "insert into supabase_migrations.schema_migrations (version) values ('20261114000100')" >/dev/null; }
prepara_origen29; env_base; r=$(sale ensayo-respaldo)
[ "$r" = 0 ] && grep -q "ENSAYO DE RESPALDO Y RESTAURACIÓN: OK" "$W/salida.txt" && grep -q "29 migraciones iguales a las del repositorio · la 29 presente" "$W/salida.txt" && grep -q "historial restaurado: las 29 migraciones" "$W/salida.txt" && grep -q "la migración 29 está presente en lo restaurado" "$W/salida.txt" && grep -q "catálogo de la migración 29 sano en lo restaurado" "$W/salida.txt" && ok "origen con las 29 migraciones → el ensayo termina OK (historial, 29 presente y catálogo de la 29 en lo restaurado)" || { mal "el ensayo con la 29 aplicada no termina OK"; tail -12 "$W/salida.txt"; }
# -- con la función de plataforma rls_auto_enable() (y su disparador de evento) en el origen: 185 + 1 funciones; el disparador se recrea SOLO en el destino efímero
prepara_origen29; DB=origen P -f "$R/supabase/tests/plataforma/rls_auto_enable_real.sql" >/dev/null 2>&1; env_base; r=$(sale ensayo-respaldo)
[ "$r" = 0 ] && grep -q "catálogo de la migración 29 sano en lo restaurado" "$W/salida.txt" && ok "origen con las 29 y la función de la plataforma rls_auto_enable() → OK (excepción estricta, disparador recreado solo en el destino)" || { mal "la función de la plataforma rompe el ensayo con la 29"; tail -12 "$W/salida.txt"; }
# -- una función de más que NO es la de la plataforma sigue haciendo fallar el catálogo de la 29 en lo restaurado
prepara_origen29; DB=origen P -c "create function public.zz_funcion_ajena() returns int language sql as 'select 1'" >/dev/null; env_base; r=$(sale ensayo-respaldo)
[ "$r" = 1 ] && grep -q "NO pasa el catálogo de la migración 29" "$W/salida.txt" && ok "una función ajena de más → el catálogo de la 29 falla (la excepción es estricta)" || mal "una función ajena no hace fallar el catálogo de la 29"
# -- 29 registradas pero sin las tablas de la 29 → falla; 30 registradas → falla
prepara_origen29; DB=origen P -c "drop table public.digifact_artefactos" >/dev/null 2>&1; env_base; r=$(sale ensayo-respaldo)
[ "$r" = 1 ] && grep -q "faltan las tablas de la migración 29" "$W/salida.txt" && ok "29 registradas sin las tablas de la 29 → falla" || mal "29 sin tablas no hace fallar"
# -- origen con las 30 migraciones (la 30 = tipos de documento aplicada Y registrada): el ensayo vale también para ese estado, con el catálogo de la 29 (cifras +2/+2/+10/+5) y la verificación de la 30
prepara_origen30() { prepara_origen29; DB=origen P -f "$R/supabase/migrations/20261115000100_fel_tipos_documento.sql" >/dev/null 2>&1 && DB=origen P -c "insert into supabase_migrations.schema_migrations (version) values ('20261115000100')" >/dev/null; }
prepara_origen30; env_base; r=$(sale ensayo-respaldo)
[ "$r" = 0 ] && grep -q "ENSAYO DE RESPALDO Y RESTAURACIÓN: OK" "$W/salida.txt" && grep -q "30 migraciones iguales a las del repositorio · la 29 presente · la 30 presente" "$W/salida.txt" && grep -q "historial restaurado: las 30 migraciones" "$W/salida.txt" && grep -q "la migración 30 está presente en lo restaurado" "$W/salida.txt" && grep -q "catálogo de la migración 29 sano en lo restaurado (71 tablas" "$W/salida.txt" && grep -q "verificación de la migración 30 sana en lo restaurado" "$W/salida.txt" && ok "origen con las 30 migraciones → el ensayo termina OK (historial, 30 presente, catálogo de la 29 con las cifras de la 30 y verificación de los tipos)" || { mal "el ensayo con la 30 aplicada no termina OK"; tail -12 "$W/salida.txt"; }
# compatibilidad hacia atrás: los respaldos de los estados 28 y 29 siguen valiendo (casos de arriba) y dicen «la 30 ausente»
prepara_origen29; env_base; r=$(sale ensayo-respaldo); [ "$r" = 0 ] && grep -q "la 29 presente · la 30 ausente" "$W/salida.txt" && ok "un origen en el estado 29 (respaldos anteriores a la 30) sigue pasando el ensayo y declara la 30 ausente" || mal "el estado 29 dejó de valer"
prepara_origen; env_base; r=$(sale ensayo-respaldo); [ "$r" = 0 ] && grep -q "la 29 ausente · la 30 ausente" "$W/salida.txt" && ok "un origen en el estado 28 (respaldos anteriores a la 29) sigue pasando el ensayo" || mal "el estado 28 dejó de valer"
# -- estados inconsistentes → falla
prepara_origen29; DB=origen P -c "insert into supabase_migrations.schema_migrations (version) values ('20261115000100')" >/dev/null; env_base; r=$(sale ensayo-respaldo)
[ "$r" = 1 ] && grep -q "registra la migración 30 pero le faltan sus tablas" "$W/salida.txt" && ok "30 registradas sin las tablas de la 30 → falla" || mal "30 sin tablas no hace fallar"
prepara_origen29; DB=origen P -f "$R/supabase/migrations/20261115000100_fel_tipos_documento.sql" >/dev/null 2>&1; env_base; r=$(sale ensayo-respaldo)
[ "$r" = 1 ] && grep -q "objetos de la migración 30 sin tenerla registrada" "$W/salida.txt" && ok "las tablas de la 30 sin registrarla en el historial (deriva) → falla" || mal "la deriva entre historial y base no hace fallar"
prepara_origen30; DB=origen P -c "insert into supabase_migrations.schema_migrations (version) values ('20261116000100')" >/dev/null; env_base; r=$(sale ensayo-respaldo)
[ "$r" = 1 ] && grep -q "NO tiene exactamente 28, 29 ni 30 migraciones" "$W/salida.txt" && ok "31 migraciones registradas → falla (solo valen 28, 29 o 30)" || mal "31 migraciones no hacen fallar"
prepara_origen30; DB=origen P -c "create function public.zz_funcion_ajena() returns int language sql as 'select 1'" >/dev/null; env_base; r=$(sale ensayo-respaldo)
[ "$r" = 1 ] && grep -q "NO pasa el catálogo de la migración 29" "$W/salida.txt" && ok "con la 30, una función ajena de más sigue haciendo fallar el catálogo (la tolerancia es exacta)" || mal "con la 30 una función ajena no hace fallar el catálogo"
prepara_origen30; DB=origen P -c "grant select on public.fel_tipos_dte to anon" >/dev/null; env_base; r=$(sale ensayo-respaldo)
[ "$r" = 1 ] && grep -qE "verificación de la migración 30 en lo restaurado tiene filas con ok = false|NO pasa la verificación de la migración 30" "$W/salida.txt" && ok "con la 30, un privilegio abierto a anon en sus tablas hace fallar su verificación" || mal "la verificación de la 30 no detecta un privilegio abierto"
prepara_origen >/dev/null
prepara_origen >/dev/null; DB=origen P -c "grant select on public.empresas to anon" >/dev/null
env_base; r=$(sale ensayo-respaldo); [ "$r" = 1 ] && grep -q "NO pasa el catálogo de la migración 28" "$W/salida.txt" && ok "un origen con un permiso de más (anon puede leer empresas) → la copia restaurada no pasa el catálogo de la 28 y el ensayo FALLA" || { mal "un origen con permisos de más no hace fallar"; tail -3 "$W/salida.txt"; }
[ "$(sobras)" = "0 0" ] && ok "tras todos los casos no quedan bases efímeras ni copias temporales" || mal "quedaron restos: $(sobras)"
echo "== C. las listas de privilegios (ACL) se comparan como CONJUNTO: el orden no cuenta; todo lo demás (rol, privilegio, concedente, opción GRANT) sí"
# Se ejecuta el SQL de estructura REAL del script (extraído tal cual) sobre dos bases que solo se diferencian en las ACL, y se compara la línea de «esquema public» y de la tabla de prueba.
SQL_E="$(sed -n "/^  read -r -d '' SQL_ESTRUCTURA <<'SQL'$/,/^SQL$/p" "$S" | sed '1d;$d')"
[ -n "$SQL_E" ] && ok "se extrajo el SQL de estructura real del script para probar las ACL" || mal "no se pudo extraer el SQL de estructura del script"
DB=postgres P -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = 'zz_g') then create role zz_g nologin; end if; end \$\$" >/dev/null
acl_linea() {   # $1 = base, $2 = patrón de la línea; imprime la línea de estructura correspondiente
  DB="$1" P -tA -c "begin transaction read only" -c "$(printf '%s' "$SQL_E" | tr '\n' ' ')" -c "rollback" 2>&1 | grep -F -- "$2" | head -1; }
acl_base() {    # $1 = base, $2 = sentencias sobre el esquema public y la tabla t_acl
  DB=postgres P -c "drop database if exists $1 with (force)" -c "create database $1" >/dev/null
  DB="$1" P -c "create table public.t_acl (id int)" -c "revoke all on schema public from public, postgres, anon, authenticated, service_role" -c "$2" >/dev/null; }
acl_caso() {    # $1 = descripción, $2 = ACL de A, $3 = ACL de B, $4 = igual|distinto, $5 = patrón de la línea
  acl_base zz_acl_a "$2"; acl_base zz_acl_b "$3"
  local la lb; la="$(acl_linea zz_acl_a "$5")"; lb="$(acl_linea zz_acl_b "$5")"
  if [ -z "$la" ] || [ -z "$lb" ]; then mal "ACL · $1: no se pudo leer la línea de estructura"; return; fi
  if [ "$4" = igual ]; then [ "$la" = "$lb" ] && ok "ACL · $1 → se consideran IGUALES" || { mal "ACL · $1 debería ser igual"; echo "  A: $la"; echo "  B: $lb"; }
  else [ "$la" != "$lb" ] && ok "ACL · $1 → se detecta la DIFERENCIA" || { mal "ACL · $1 NO se detectó"; echo "  A: $la"; }; fi
}
SCH='esquema|public|'; REL='relacion|public.t_acl|'
acl_caso "esquema: mismos privilegios en otro orden" "grant usage on schema public to postgres, anon, authenticated, service_role" "grant usage on schema public to service_role, authenticated, anon, postgres" igual "$SCH"
acl_caso "esquema: mismos privilegios, concedidos en dos pasos y en otro orden" "grant usage on schema public to anon; grant usage on schema public to postgres" "grant usage on schema public to postgres; grant usage on schema public to anon" igual "$SCH"
acl_caso "esquema: falta un rol (service_role)" "grant usage on schema public to postgres, anon, authenticated, service_role" "grant usage on schema public to postgres, anon, authenticated" distinto "$SCH"
acl_caso "esquema: un rol de más (zz_g)" "grant usage on schema public to postgres, anon" "grant usage on schema public to postgres, anon, zz_g" distinto "$SCH"
acl_caso "esquema: un privilegio de más (CREATE para anon)" "grant usage on schema public to anon" "grant usage, create on schema public to anon" distinto "$SCH"
acl_caso "esquema: un privilegio de menos (anon pierde USAGE y queda sin nada)" "grant usage on schema public to anon, authenticated" "grant usage on schema public to authenticated" distinto "$SCH"
acl_caso "esquema: privilegio distinto para el mismo rol (USAGE frente a CREATE)" "grant usage on schema public to anon" "grant create on schema public to anon" distinto "$SCH"
acl_caso "esquema: misma concesión pero con OPCIÓN GRANT" "grant usage on schema public to anon" "grant usage on schema public to anon with grant option" distinto "$SCH"
acl_caso "esquema: el mismo privilegio con otro CONCEDENTE (zz_g en vez del propietario)" "grant usage on schema public to zz_g with grant option; grant usage on schema public to anon" "grant usage on schema public to zz_g with grant option; set role zz_g; grant usage on schema public to anon; reset role; revoke usage on schema public from anon" distinto "$SCH"
acl_caso "tabla: mismos privilegios en otro orden" "grant select on public.t_acl to anon; grant insert on public.t_acl to authenticated" "grant insert on public.t_acl to authenticated; grant select on public.t_acl to anon" igual "$REL"
acl_caso "tabla: un privilegio de más (DELETE)" "grant select on public.t_acl to anon" "grant select, delete on public.t_acl to anon" distinto "$REL"
acl_caso "tabla: falta un rol" "grant select on public.t_acl to anon, authenticated" "grant select on public.t_acl to anon" distinto "$REL"
acl_caso "tabla: misma concesión con OPCIÓN GRANT" "grant select on public.t_acl to anon" "grant select on public.t_acl to anon with grant option" distinto "$REL"
DB=postgres P -c "drop database if exists zz_acl_a with (force)" -c "drop database if exists zz_acl_b with (force)" >/dev/null
# ============================================================================================================== C. respaldo-persistente (cifrado con age + subida a un R2 FALSO local; sin red ni credenciales reales)
echo "== C. respaldo-persistente"
command -v age >/dev/null && command -v age-keygen >/dev/null || mal "falta age/age-keygen en este equipo (la prueba del respaldo persistente NO se omite)"
R2D="$W/r2"; R2REG="$W/r2reg.txt"; mkdir -p "$R2D"; : > "$R2REG"; R2PORT=$((PORT-5)); R2ID=0123456789abcdef0123456789abcdef; R2KID=AKIAFALSOPRUEBA000; R2SEC=SECRETO-R2-FALSO-DE-PRUEBA-77; BUCKET=bucket-de-prueba
age-keygen -o "$W/age-privada.txt" >/dev/null 2>&1; AGEPUB="$(age-keygen -y "$W/age-privada.txt")"
age-keygen -o "$W/age-otra.txt" >/dev/null 2>&1
python3 "$R/tools/test-r2-servidor-falso.py" "$R2PORT" "$R2D" "$R2KID" "$R2SEC" "$R2REG" & R2PID=$!; sleep 1
trap 'kill $R2PID 2>/dev/null; as_pg "$PGBIN/pg_ctl -D $DATA -m immediate stop >/dev/null" 2>/dev/null; as_pg "$PGBIN/pg_ctl -D $DATA2 -m immediate stop >/dev/null" 2>/dev/null; rm -rf "$W"' EXIT
env_r2() { export R2_ACCOUNT_ID=$R2ID R2_ACCESS_KEY_ID=$R2KID R2_SECRET_ACCESS_KEY=$R2SEC R2_BUCKET=$BUCKET AGE_PUBLIC_KEY=$AGEPUB FEL_R2_ENDPOINT_PRUEBA="http://127.0.0.1:$R2PORT"; }
vacia_r2() { rm -rf "$R2D/objetos" "$R2D/RECHAZA"; : > "$R2REG"; }
# -- camino feliz (origen en estado 29)
prepara_origen29; env_base; env_r2; vacia_r2; r=$(sale respaldo-persistente)
[ "$r" = 0 ] && grep -q "RESPALDO PERSISTENTE: CONSERVADO EN R2" "$W/salida.txt" && grep -q "ENSAYO DE RESPALDO Y RESTAURACIÓN: OK" "$W/salida.txt" && ok "respaldo-persistente: el ensayo pasa y el respaldo se conserva" || { mal "respaldo-persistente no termina OK"; tail -12 "$W/salida.txt"; }
N_AGE=$(ls "$R2D/objetos" 2>/dev/null | grep -c '\.dump\.age$'); N_SHA=$(ls "$R2D/objetos" 2>/dev/null | grep -c '\.dump\.sha256$'); N_INF=$(ls "$R2D/objetos" 2>/dev/null | grep -c '\.informe\.txt$'); N_TOT=$(ls "$R2D/objetos" 2>/dev/null | wc -l)
[ "$N_AGE$N_SHA$N_INF$N_TOT" = 1113 ] && ok "se suben exactamente tres objetos: .dump.age, .dump.sha256 e .informe.txt (nada más)" || mal "objetos subidos distintos de los tres esperados ($N_AGE/$N_SHA/$N_INF de $N_TOT)"
OBJ_AGE="$(ls "$R2D/objetos"/*.dump.age 2>/dev/null | head -1)"; BASEN="$(basename "$OBJ_AGE" .dump.age)"
echo "$BASEN" | grep -qE '^bucket-de-prueba__nexa-demo__[0-9]{8}-[0-9]{6}-[0-9a-f]{8}$' && ok "el nombre del objeto es nexa-demo/AAAAMMDD-HHMMSS-<sha8>.dump.age dentro del bucket configurado" || mal "nombre de objeto inesperado: $BASEN"
if [ -f "$OBJ_AGE" ]; then
  head -c 22 "$OBJ_AGE" | grep -q 'age-encryption.org/v1' && ! grep -q PGDMP "$OBJ_AGE" && ok "lo subido es un archivo age y no contiene el volcado en claro (sin la firma PGDMP)" || mal "lo subido no es un cifrado válido de age"
  age -d -i "$W/age-privada.txt" -o "$W/descifrado.dump" "$OBJ_AGE" 2>/dev/null && [ -s "$W/descifrado.dump" ] && ok "con la clave PRIVADA se descifra" || mal "no se pudo descifrar con la clave privada"
  age -d -i "$W/age-otra.txt" -o "$W/otra.dump" "$OBJ_AGE" >/dev/null 2>&1 && mal "una clave ajena descifró la copia" || ok "una clave privada ajena NO descifra la copia"
  SHA_CLARO="$(sha256sum "$W/descifrado.dump" | cut -d' ' -f1)"; ARCH_SHA="$R2D/objetos/${BASEN}.dump.sha256"
  [ "$(cut -d' ' -f1 "$ARCH_SHA")" = "$SHA_CLARO" ] && ok "el .sha256 coincide con el SHA-256 del volcado descifrado" || mal "el .sha256 no coincide con el volcado descifrado"
  LISTA="$("$PGBIN/pg_restore" --list "$W/descifrado.dump" 2>/dev/null)"; grep -q "TABLE DATA public empresas" <<<"$LISTA" && grep -q "schema_migrations" <<<"$LISTA" && ok "el volcado descifrado se lista con pg_restore (datos de public e historial)" || mal "el volcado descifrado no es válido"
  # restauración REAL de lo descifrado en una base aparte: mismo recuento de filas que el origen
  DB=postgres Pd -c "drop database if exists desde_r2 with (force)" -c "create database desde_r2" >/dev/null; DB=desde_r2 Pd -f "$R/tools/shim_supabase.sql" >/dev/null 2>&1
  "$PGBIN/pg_restore" --no-owner -d "host=$SOCK port=$PORT2 dbname=desde_r2 user=postgres" "$W/descifrado.dump" >/dev/null 2>&1
  [ "$(DB=desde_r2 Pd -tA -c "select count(*) from public.documentos")" = "$(DB=origen P -tA -c "select count(*) from public.documentos")" ] && ok "restaurar lo descifrado en una base aparte devuelve las mismas filas que el origen" || mal "la restauración desde el cifrado no devuelve los mismos datos"
  rm -f "$W/descifrado.dump" "$W/otra.dump"
  INF="$R2D/objetos/${BASEN}.informe.txt"
  ! grep -qiE "Empresa R|actor@prueba|9900001-1|línea [0-9]|$CLAVE|$R2SEC|$R2KID|$TOKEN" "$INF" && grep -q "SHA-256 del volcado en claro" "$INF" && grep -q "migraciones registradas" "$INF" && ok "el informe subido no contiene datos del contenido ni credenciales (solo tamaños, huellas y totales)" || mal "el informe contiene datos o credenciales"
fi
! grep -qE "$R2SEC|$R2KID|$R2ID|$CLAVE|$TOKEN" "$W/salida.txt" && ok "ninguna credencial (R2, base, token) aparece en la salida" || mal "alguna credencial apareció en la salida"
grep -c '^PUT ' "$R2REG" | grep -qx 3 && grep -q '^PUT .* 200 ' "$R2REG" && ! grep -qE '403|400' "$R2REG" && ok "las tres subidas llevaron firma SigV4 válida y If-None-Match (sin sobrescribir)" || mal "las subidas no fueron las esperadas"
L_AGE="$(grep -n 'dump.age' "$R2REG" | head -1 | cut -d: -f1)"; L_SHA="$(grep -n 'dump.sha256' "$R2REG" | head -1 | cut -d: -f1)"; [ -n "$L_AGE" ] && [ -n "$L_SHA" ] && [ "$L_SHA" -lt "$L_AGE" ] && ok "el cifrado se sube al FINAL (si existe, existen su huella y su informe)" || mal "el orden de subida no deja el cifrado al final"
[ -z "$(find "$W/tmp" -mindepth 1 2>/dev/null | head -1)" ] && ok "el directorio temporal (volcado en claro y cifrado locales) no sobrevive" || mal "quedaron archivos temporales"
! find "$R" -name '*.dump' -o -name '*.dump.age' 2>/dev/null | grep -q . && ok "ningún volcado quedó dentro del repositorio" || mal "hay un volcado dentro del repositorio"
# ---- recuperación (paso 6) con el MISMO respaldo que acaba de subirse: descarga firmada del R2 falso, descifrado con la clave privada, restauración en un PostgreSQL NUEVO y verificaciones (tools/recuperar-respaldo.py)
echo "== C2. recuperar-respaldo (descarga + descifrado + restauración + verificaciones)"
RECDIR="/tmp/fel-recuperacion-test"; [ -n "$RECDIR" ] && rm -rf "$RECDIR"; mkdir -p "$RECDIR"; chmod 777 "$RECDIR"; cp "$W/age-privada.txt" "$RECDIR/clave.txt"; cp "$W/age-otra.txt" "$RECDIR/otra.txt"; chmod 644 "$RECDIR/clave.txt" "$RECDIR/otra.txt"
BASE_R="nexa-demo/${BASEN#*__nexa-demo__}"; PORT_R=$((PORT-7)); BN_R="$(basename "$BASE_R")"
cat > "$RECDIR/rec.sh" <<SH
#!/usr/bin/env bash
export TMPDIR="$RECDIR" R2_ACCOUNT_ID=$R2ID R2_ACCESS_KEY_ID=$R2KID R2_SECRET_ACCESS_KEY=$R2SEC FEL_R2_ENDPOINT_PRUEBA="http://127.0.0.1:$R2PORT"
exec python3 "$R/tools/recuperar-respaldo.py" \${REC_PG:---pgbin "$PGBIN"} --repo "$R" --pg-mayor \${REC_MAYOR:-$PGMAYOR} "\$@"
SH
chmod 755 "$RECDIR/rec.sh"
rec() { as_pg "'$RECDIR/rec.sh' $* > '$RECDIR/salida.txt' 2>&1; echo \$?"; }
sin_restos() { ! ls "$RECDIR" | grep -q '^nexa-recuperacion-' && ! pgrep -f 'nexa-recuperacion-' >/dev/null 2>&1; }
r=$(rec --base "$BASE_R" --bucket $BUCKET --clave "$RECDIR/clave.txt" --descargar --sha-esperado "$SHA_CLARO")
[ "$r" = 0 ] && grep -q "RECUPERACIÓN VERIFICADA: OK" "$RECDIR/salida.txt" && grep -q "= valor esperado independiente" "$RECDIR/salida.txt" && grep -q "RLS: las" "$RECDIR/salida.txt" && grep -q "catálogo de la migración 29 sano" "$RECDIR/salida.txt" && grep -q "historial de migraciones: 29 versiones, idénticas" "$RECDIR/salida.txt" && ok "recuperar-respaldo: descarga, descifra, restaura en un PostgreSQL 17 nuevo y verifica tablas, filas, migraciones, RLS y catálogo de la 29" || { mal "la recuperación no termina OK"; tail -15 "$RECDIR/salida.txt"; }
grep -E "tablas y registros|RLS: las" "$RECDIR/salida.txt" | cut -c1-150
! grep -qE "$R2SEC|$R2KID|AGE-SECRET-KEY|$CLAVE" "$RECDIR/salida.txt" && ok "la salida no contiene credenciales ni la clave privada" || mal "la salida de la recuperación contiene credenciales"
sin_restos && ok "no quedan archivos temporales ni el PostgreSQL temporal en marcha" || mal "quedaron restos de la recuperación"
grep -q "pooler.supabase.com\|FEL_DEMO_BD_URL\|DEMO_BD_URL" "$R/tools/recuperar-respaldo.py" && mal "recuperar-respaldo.py menciona la base alojada" || ok "recuperar-respaldo.py no conoce ninguna cadena de nexa-demo (no puede tocarla)"
# modo carpeta (descarga manual desde el panel de Cloudflare)
CARP="$RECDIR/carpeta"; mkdir -p "$CARP"; for e in dump.age dump.sha256 informe.txt; do cp "$R2D/objetos/${BASEN}.$e" "$CARP/$BN_R.$e"; done; chmod -R a+rX "$CARP"
r=$(rec --base "$BASE_R" --clave "$RECDIR/clave.txt" --carpeta "$CARP"); [ "$r" = 0 ] && grep -q "RECUPERACIÓN VERIFICADA: OK" "$RECDIR/salida.txt" && sin_restos && ok "modo --carpeta (objetos descargados a mano) → recuperación OK" || { mal "el modo carpeta no termina OK"; tail -8 "$RECDIR/salida.txt"; }
# protecciones
r=$(rec --base "$BASE_R" --clave "$RECDIR/otra.txt" --carpeta "$CARP"); [ "$r" = 1 ] && grep -q "age no pudo descifrar" "$RECDIR/salida.txt" && ! grep -q "temporal e independiente" "$RECDIR/salida.txt" && sin_restos && ok "con una clave privada equivocada → falla al descifrar y no restaura nada" || mal "clave equivocada no se detecta"
CARP2="$RECDIR/carpeta2"; cp -r "$CARP" "$CARP2"; python3 -c "
import sys; p=sys.argv[1]; b=bytearray(open(p,'rb').read()); b[len(b)//2]^=1; open(p,'wb').write(b)" "$CARP2/$BN_R.dump.age"; chmod -R a+rX "$CARP2"
r=$(rec --base "$BASE_R" --clave "$RECDIR/clave.txt" --carpeta "$CARP2"); [ "$r" = 1 ] && grep -q "archivo CIFRADO no coincide" "$RECDIR/salida.txt" && ! grep -q "descifrado con tu clave" "$RECDIR/salida.txt" && ok "un archivo cifrado alterado se detecta ANTES de descifrar" || mal "un cifrado alterado no se detecta"
CARP3="$RECDIR/carpeta3"; cp -r "$CARP" "$CARP3"; printf '%064d  respaldo.dump\n' 0 > "$CARP3/$BN_R.dump.sha256"; chmod -R a+rX "$CARP3"
r=$(rec --base "$BASE_R" --clave "$RECDIR/clave.txt" --carpeta "$CARP3"); [ "$r" = 1 ] && grep -q "no coincide con el .sha256" "$RECDIR/salida.txt" && ! grep -q "temporal e independiente" "$RECDIR/salida.txt" && ok "un .sha256 distinto del volcado descifrado se detecta antes de restaurar" || mal "un .sha256 alterado no se detecta"
r=$(rec --base "$BASE_R" --clave "$RECDIR/clave.txt" --carpeta "$CARP" --sha-esperado "$(printf '%064d' 1)"); [ "$r" = 1 ] && grep -q "valor esperado que indicaste" "$RECDIR/salida.txt" && ok "un SHA-256 esperado distinto → falla" || mal "el SHA esperado erróneo no se detecta"
CARP4="$RECDIR/carpeta4"; mkdir -p "$CARP4"; cp "$CARP/$BN_R.dump.age" "$CARP/$BN_R.dump.sha256" "$CARP4/"; chmod -R a+rX "$CARP4"
r=$(rec --base "$BASE_R" --clave "$RECDIR/clave.txt" --carpeta "$CARP4"); [ "$r" = 1 ] && grep -q "falta en la carpeta" "$RECDIR/salida.txt" && ok "un objeto que falta (informe) → falla" || mal "un objeto ausente no se detecta"
CARP5="$RECDIR/carpeta5"; cp -r "$CARP" "$CARP5"; sed -i -E 's/(contenido: [0-9]+ tablas) · [0-9]+ filas/\1 · 99999 filas/' "$CARP5/$BN_R.informe.txt"; chmod -R a+rX "$CARP5"
r=$(rec --base "$BASE_R" --clave "$RECDIR/clave.txt" --carpeta "$CARP5"); [ "$r" = 1 ] && grep -q "distintas de las del informe" "$RECDIR/salida.txt" && sin_restos && ok "si las filas restauradas difieren de las del informe → falla (y se limpia)" || mal "una diferencia de filas no se detecta"
: > "$R2REG"; r=$(rec --base "nexa-demo/20200101-000000-00000000" --bucket $BUCKET --clave "$RECDIR/clave.txt" --descargar); [ "$r" = 1 ] && grep -q "no se pudo descargar" "$RECDIR/salida.txt" && grep -q "GET .* 404" "$R2REG" && ok "un respaldo inexistente en R2 → falla con claridad" || mal "un objeto inexistente no se detecta"
r=$(as_pg "REC_PG='--pgbin /no/existe' '$RECDIR/rec.sh' --base '$BASE_R' --clave '$RECDIR/clave.txt' --descargar --bucket $BUCKET > '$RECDIR/salida.txt' 2>&1; echo \$?"); [ "$r" = 2 ] && grep -q "falta initdb" "$RECDIR/salida.txt" && ok "sin PostgreSQL 17 en --pgbin → se niega con un requisito claro" || mal "un --pgbin inválido no se rechaza"
# informe de recuperación en archivo (sin datos ni claves) y nunca sobrescribe uno existente
INFR="$RECDIR/informe-recuperacion.txt"; r=$(rec --base "$BASE_R" --clave "$RECDIR/clave.txt" --carpeta "$CARP" --informe "$INFR")
[ "$r" = 0 ] && grep -q "RECUPERACIÓN VERIFICADA: OK" "$INFR" && grep -q "tablas y registros" "$INFR" && grep -q "RLS: las" "$INFR" && ! grep -qE "$R2SEC|$R2KID|AGE-SECRET-KEY|$CLAVE|$AGEPUB" "$INFR" && ok "el informe de recuperación se guarda en un archivo sin credenciales ni claves" || mal "el informe en archivo falta o contiene secretos"
cp "$INFR" "$RECDIR/inf-previo.txt"; r=$(rec --base "$BASE_R" --clave "$RECDIR/clave.txt" --carpeta "$CARP" --informe "$INFR"); [ "$r" = 2 ] && grep -q "no se sobrescribe" "$RECDIR/salida.txt" && cmp -s "$INFR" "$RECDIR/inf-previo.txt" && ok "un informe existente no se sobrescribe" || mal "se sobrescribió un informe existente"
INFF="$RECDIR/informe-fallo.txt"; r=$(rec --base "$BASE_R" --clave "$RECDIR/otra.txt" --carpeta "$CARP" --informe "$INFF"); [ "$r" = 1 ] && grep -q "RECUPERACIÓN VERIFICADA: FALLÓ" "$INFF" && ok "un fallo también deja su informe en archivo" || mal "el fallo no dejó informe"
# modo Docker (contenedor postgres:17 sin puertos publicados): obligatorio en CI; en un equipo sin Docker en marcha se informa y se omite
if docker info >/dev/null 2>&1; then
  r=$(as_pg "REC_PG=--docker REC_MAYOR=17 '$RECDIR/rec.sh' --base '$BASE_R' --clave '$RECDIR/clave.txt' --carpeta '$CARP' > '$RECDIR/salida.txt' 2>&1; echo \$?")
  [ "$r" = 0 ] && grep -q "RECUPERACIÓN VERIFICADA: OK" "$RECDIR/salida.txt" && grep -q "contenedor nexa-recuperacion-.*sin puertos publicados" "$RECDIR/salida.txt" && grep -q "tablas y registros" "$RECDIR/salida.txt" && grep -q "RLS: las" "$RECDIR/salida.txt" && [ -z "$(docker ps -a -q --filter name=nexa-recuperacion-)" ] && ok "modo --docker: restaura en un contenedor postgres:17 sin puertos publicados, verifica todo y lo elimina" || { mal "el modo Docker no termina OK"; tail -12 "$RECDIR/salida.txt"; }
  r=$(as_pg "REC_PG=--docker REC_MAYOR=17 '$RECDIR/rec.sh' --base '$BASE_R' --clave '$RECDIR/otra.txt' --carpeta '$CARP' > '$RECDIR/salida.txt' 2>&1; echo \$?"); [ "$r" = 1 ] && [ -z "$(docker ps -a -q --filter name=nexa-recuperacion-)" ] && ok "modo --docker con clave equivocada: falla sin crear ningún contenedor" || mal "el modo Docker con clave equivocada dejó contenedores o no falló"
elif [ -n "${GITHUB_ACTIONS:-}" ]; then mal "en CI Docker debe estar disponible para probar el modo --docker"
else echo "INFO  Docker no está en marcha en este equipo: el modo --docker se prueba en el CI (donde es obligatorio)"; fi
[ -n "$RECDIR" ] && rm -rf "$RECDIR"
# -- una segunda corrida con el mismo contenido NO sobrescribe nada (nombre con fecha: objeto nuevo) y no toca los anteriores
sleep 1; env_base; env_r2; r=$(sale respaldo-persistente); [ "$r" = 0 ] && [ "$(ls "$R2D/objetos" | wc -l)" = 6 ] && ok "una segunda corrida crea objetos NUEVOS (6 en total) sin tocar los anteriores" || mal "la segunda corrida no creó objetos nuevos"
# ---- C3. respaldo persistente + recuperación en el estado 30 (con tipos de documento) y en el 28 (respaldos anteriores): la herramienta de recuperación es compatible con todos
echo "== C3. respaldo persistente y recuperación en los estados 30 y 28"
RECDIR="/tmp/fel-recuperacion-test"; [ -n "$RECDIR" ] && rm -rf "$RECDIR"; mkdir -p "$RECDIR"; chmod 777 "$RECDIR"; cp "$W/age-privada.txt" "$RECDIR/clave.txt"; chmod 644 "$RECDIR/clave.txt"
cat > "$RECDIR/rec.sh" <<SH
#!/usr/bin/env bash
export TMPDIR="$RECDIR" R2_ACCOUNT_ID=$R2ID R2_ACCESS_KEY_ID=$R2KID R2_SECRET_ACCESS_KEY=$R2SEC FEL_R2_ENDPOINT_PRUEBA="http://127.0.0.1:$R2PORT"
exec python3 "$R/tools/recuperar-respaldo.py" --pgbin "$PGBIN" --repo "$R" --pg-mayor $PGMAYOR "\$@"
SH
chmod 755 "$RECDIR/rec.sh"
for ESTADO in 30 28; do
  vacia_r2; if [ "$ESTADO" = 30 ]; then prepara_origen30; else prepara_origen; fi; env_base; env_r2; r=$(sale respaldo-persistente)
  [ "$r" = 0 ] && grep -q "RESPALDO PERSISTENTE: CONSERVADO EN R2" "$W/salida.txt" && ok "respaldo-persistente con el origen en el estado $ESTADO → conservado en R2" || { mal "respaldo-persistente en el estado $ESTADO falló"; tail -8 "$W/salida.txt"; continue; }
  OBJ2="$(ls "$R2D/objetos"/*.dump.age | head -1)"; BN2="$(basename "$OBJ2" .dump.age)"; BASE2="nexa-demo/${BN2#*__nexa-demo__}"; SHA2="$(cut -d' ' -f1 "$R2D/objetos/${BN2}.dump.sha256")"
  r=$(as_pg "'$RECDIR/rec.sh' --base '$BASE2' --bucket $BUCKET --clave '$RECDIR/clave.txt' --descargar --sha-esperado $SHA2 > '$RECDIR/salida.txt' 2>&1; echo \$?")
  if [ "$ESTADO" = 30 ]; then
    [ "$r" = 0 ] && grep -q "RECUPERACIÓN VERIFICADA: OK" "$RECDIR/salida.txt" && grep -q "historial de migraciones: 30 versiones, idénticas" "$RECDIR/salida.txt" && grep -q "la migración 30 (tipos de documento) está registrada en el historial" "$RECDIR/salida.txt" && grep -q "verificación de la migración 30 sana en lo restaurado" "$RECDIR/salida.txt" && grep -q "RLS: las 71 tablas" "$RECDIR/salida.txt" && grep -q "catálogo de la migración 29 sano" "$RECDIR/salida.txt" && ok "recuperar-respaldo con un respaldo en el estado 30: 30 versiones, la 30 registrada y verificada, 71 tablas con RLS y el catálogo de la 29 con sus cifras" || { mal "la recuperación del estado 30 no termina OK"; tail -14 "$RECDIR/salida.txt"; }
  else
    [ "$r" = 0 ] && grep -q "RECUPERACIÓN VERIFICADA: OK" "$RECDIR/salida.txt" && grep -q "historial de migraciones: 28 versiones, idénticas" "$RECDIR/salida.txt" && ! grep -q "migración 30" "$RECDIR/salida.txt" && ok "recuperar-respaldo con un respaldo ANTERIOR (estado 28): sigue funcionando y no exige la 29 ni la 30" || { mal "la recuperación del estado 28 no termina OK"; tail -14 "$RECDIR/salida.txt"; }
  fi
done
# un respaldo del estado 30 cuyo historial dice 29 (deriva) se rechaza en la recuperación
vacia_r2; prepara_origen30; env_base; env_r2; r=$(sale respaldo-persistente); OBJ2="$(ls "$R2D/objetos"/*.dump.age | head -1)"; BN2="$(basename "$OBJ2" .dump.age)"
CARPX="$RECDIR/carpetax"; mkdir -p "$CARPX"; for e in dump.age dump.sha256 informe.txt; do cp "$R2D/objetos/${BN2}.$e" "$CARPX/${BN2#*__nexa-demo__}.$e"; done
sed -i -E 's/ · 30 migraciones/ · 29 migraciones/' "$CARPX/${BN2#*__nexa-demo__}.informe.txt"; chmod -R a+rX "$CARPX"
r=$(as_pg "'$RECDIR/rec.sh' --base 'nexa-demo/${BN2#*__nexa-demo__}' --clave '$RECDIR/clave.txt' --carpeta '$CARPX' > '$RECDIR/salida.txt' 2>&1; echo \$?"); [ "$r" = 1 ] && grep -qE "historial restaurado tiene 30 migraciones y el informe 29|deriva entre el historial" "$RECDIR/salida.txt" && ok "un informe que dice 29 migraciones sobre un volcado de 30 → la recuperación falla (no se da por buena)" || { mal "una deriva de historial no se detecta en la recuperación"; tail -5 "$RECDIR/salida.txt"; }
[ -n "$RECDIR" ] && rm -rf "$RECDIR"; vacia_r2
# -- protecciones
for v in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET AGE_PUBLIC_KEY; do prepara_origen29; env_base; env_r2; vacia_r2; export "$v="; r=$(sale respaldo-persistente); [ "$r" = 2 ] && grep -q "falta $v" "$W/salida.txt" && [ ! -d "$R2D/objetos" ] && ok "sin $v → se niega antes de hacer nada" || mal "sin $v no se niega"; done
env_base; env_r2; export AGE_PUBLIC_KEY="$(grep -o 'AGE-SECRET-KEY-[A-Z0-9]*' "$W/age-privada.txt")"; r=$(sale respaldo-persistente); [ "$r" = 2 ] && grep -q "clave PÚBLICA" "$W/salida.txt" && ! grep -q "AGE-SECRET-KEY" "$W/salida.txt" && ok "una clave PRIVADA de age como destinatario se rechaza (y no se imprime)" || mal "se aceptó una clave privada de age"
env_base; env_r2; export AGE_PUBLIC_KEY="age1corta"; r=$(sale respaldo-persistente); [ "$r" = 2 ] && ok "un destinatario con formato inválido se rechaza" || mal "formato de destinatario inválido aceptado"
env_base; env_r2; export R2_BUCKET="../otro"; r=$(sale respaldo-persistente); [ "$r" = 2 ] && ok "un nombre de bucket inválido se rechaza" || mal "bucket inválido aceptado"
# R2 rechaza (403) → falla y NO declara el respaldo conservado
prepara_origen29; env_base; env_r2; vacia_r2; : > "$R2D/RECHAZA"; r=$(sale respaldo-persistente); [ "$r" = 1 ] && ! grep -q "CONSERVADO EN R2" "$W/salida.txt" && grep -q "la subida a R2" "$W/salida.txt" && ok "si R2 rechaza la subida → falla y no se da el respaldo por conservado" || mal "R2 rechaza pero el flujo no falla"
! grep -qE "$R2SEC|$R2KID" "$W/salida.txt" && ok "el fallo de R2 tampoco imprime credenciales" || mal "el fallo de R2 imprimió credenciales"
# credenciales equivocadas → 403 por firma
prepara_origen29; env_base; env_r2; vacia_r2; export R2_SECRET_ACCESS_KEY=otro-secreto; r=$(sale respaldo-persistente); [ "$r" = 1 ] && grep -q "403-firma" "$R2REG" && ok "una firma con secreto equivocado es rechazada por R2 y el flujo falla" || mal "firma equivocada no falla"
# el ensayo FALLA → no se sube NADA (una copia que no se pudo restaurar no se conserva)
prepara_origen29; env_base; env_r2; vacia_r2; FAKE_RESTORE_PIERDE=1 r=$(sale respaldo-persistente); [ "$r" = 1 ] && [ ! -d "$R2D/objetos" ] && ! grep -q '^PUT' "$R2REG" && ok "si la restauración efímera falla, NO se sube ningún objeto" || mal "se subió algo pese a fallar el ensayo"
prepara_origen29; env_base; env_r2; vacia_r2; FAKE_RESTORE_MUTA=1 r=$(sale respaldo-persistente); [ "$r" = 1 ] && [ ! -d "$R2D/objetos" ] && ok "si lo restaurado difiere del origen, NO se sube nada" || mal "se subió pese a datos distintos"
# ensayo-respaldo normal (y verificar) NO sube nada aunque haya variables R2 en el entorno
prepara_origen29; env_base; env_r2; vacia_r2; r=$(sale ensayo-respaldo); [ "$r" = 0 ] && [ ! -d "$R2D/objetos" ] && ! grep -q '^PUT' "$R2REG" && ok "ensayo-respaldo no conserva nada en R2 (solo respaldo-persistente lo hace)" || mal "ensayo-respaldo tocó R2"
# subir sin sobrescribir: el mismo objeto dos veces → 412
env_r2; : > "$W/x.bin"; echo hola > "$W/x.bin"; KEY=nexa-demo/20260101-000000-abcdef12.informe.txt; vacia_r2
python3 "$R/tools/r2_subir.py" poner $BUCKET $KEY "$W/x.bin" >/dev/null 2>&1 && ! python3 "$R/tools/r2_subir.py" poner $BUCKET $KEY "$W/x.bin" 2>"$W/e.txt" >/dev/null && grep -q "YA EXISTE" "$W/e.txt" && ok "subir dos veces la misma clave falla: nunca se sobrescribe" || mal "se pudo sobrescribir un objeto"
! FEL_R2_ENDPOINT_PRUEBA="http://example.com:80" python3 "$R/tools/r2_subir.py" poner $BUCKET $KEY "$W/x.bin" >/dev/null 2>&1 && ! python3 "$R/tools/r2_subir.py" poner $BUCKET "otra/clave.txt" "$W/x.bin" >/dev/null 2>&1 && ok "el destino de prueba solo admite 127.0.0.1 y las claves de objeto fuera del patrón se rechazan" || mal "r2_subir aceptó un destino o una clave no permitidos"
kill $R2PID 2>/dev/null
# -- el origen: ninguna orden de escritura/restauración se le dirige (revisión del propio script)
echo "== revisión estática"
! grep -nE 'src (pg_restore|createdb|dropdb)|src psql [^|]*(create|drop|alter|insert|update|delete|truncate|grant)' "$S" | grep -v "zz_nexa_prueba_escritura" | grep -q . && ok "el script nunca dirige restauraciones ni escrituras al origen" || mal "el script dirige una escritura al origen"
grep -q 'upload-artifact\|actions/cache\|gh release' "$S" && mal "el script contiene publicación" || ok "el script no publica nada (ni artefactos, ni cachés, ni releases)"
[ "$fallos" = 0 ] && echo "RESPALDO NEXA-DEMO (FASE 1) OK" || { echo "$fallos fallo(s)"; exit 1; }
