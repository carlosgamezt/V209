#!/usr/bin/env bash
# MEDICIÓN de las lecturas por la Data API con 300, 3 000 y 15 000 registros, con los MISMOS datos para cada variante de políticas RLS (R3):
#   V0 original · V1 +«sesión viva» evaluada una vez por consulta (M-L) · V2 +permisos por conjunto de empresas (M-O/M-S) · V3 +alcance por establecimiento por conjunto (M-S)  = estado propuesto.
# Mide en la BASE (PostgreSQL temporal local, 1 conexión, sin red; pgbench con las mismas sentencias que PostgREST: claims + SET LOCAL ROLE + RPC). No es una medición contra #55 ni de la red de Supabase.
# Uso: bash tools/medir-lecturas-rls.sh [segundos_por_caso] [salida.md]
set -euo pipefail
cd "$(dirname "$0")/.."
T=${1:-2}; SALIDA=${2:-/dev/stdout}; PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}; DATA=/tmp/fel-medrls-pg-$$; PORT=$((58000 + RANDOM % 900)); SOCK=/tmp
as_pg() { if [ "$(id -u)" = 0 ]; then su pgtest -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
id pgtest >/dev/null 2>&1 || useradd -m pgtest
as_pg "mkdir -p '$DATA' && '$PGBIN/initdb' -D '$DATA' -A trust -U postgres >/dev/null"
as_pg "'$PGBIN/pg_ctl' -D '$DATA' -o '-p $PORT -k $SOCK -c listen_addresses=127.0.0.1 -c max_connections=50' -w -l '$DATA/log' start >/dev/null"
trap 'as_pg "'"$PGBIN"'/pg_ctl -D '"$DATA"' -m immediate stop >/dev/null" || true' EXIT
D=docs/multiempresa/propuesta
P() { "$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d nexa -v ON_ERROR_STOP=1 -q -X "$@"; }
"$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d postgres -q -X -c "create database nexa"; P -f tools/shim_supabase.sql
for f in supabase/migrations/*.sql; do P -f "$f" >/dev/null 2>&1; done
for f in M-D_permisos M-A_emisor_fiscal M-B_digifact_config M-C_acceso_maestro M-F_establecimientos_usuario M-G_sesion_admin M-H_admin_establecimientos M-I_envoltorios_sesion M-J_plataforma_y_auditoria M-K_sistema_nexa_sys M-L_rls_sesion_viva M-M_identidad_auth M-N_esquema_api M-O_lecturas_api M-Q_agente_endurecimiento M-R_parametros_clases M-S_lecturas_documentos M-T_lecturas_restantes M-U_lecturas_paginadas M-E_rol_app; do P -f $D/$f.sql >/dev/null 2>&1 || { echo "FALLO al aplicar $f"; exit 1; }; done
P -f $D/fixture-sesion.sql >/dev/null 2>/tmp/medrls_fix.log || { echo "FALLO fixture"; tail -3 /tmp/medrls_fix.log; exit 1; }
U=00000000-0000-0000-0000-0000000000c1; A=10000000-0000-0000-0000-00000000000a; SID=98000000-0000-0000-0000-0000000000c1
P -c "insert into auth.sessions (id, user_id, aal) values ('$SID', '$U', 'aal2') on conflict do nothing"
CLAIMS="select set_config('request.jwt.claims', '{\"sub\":\"$U\",\"role\":\"authenticated\",\"session_id\":\"$SID\",\"aal\":\"aal2\"}', true); set local role authenticated;"
# ---- variantes de políticas (idempotentes) ----
cat > /tmp/medrls_v_$$.sql <<'S'
create or replace function public.zz_politicas(p_sesion_nueva boolean, p_perm_nuevo boolean) returns void language plpgsql as $$
declare t text; x record;
begin
  for t in select tablename from pg_policies where policyname = 'sesion_viva' and schemaname = 'public' loop
    execute format('drop policy sesion_viva on public.%I', t);
    execute format('create policy sesion_viva on public.%I as restrictive for select to authenticated using (%s)', t, case when p_sesion_nueva then '(select public.fel__sesion_viva())' else 'public.fel__sesion_viva()' end);
  end loop;
  for x in select * from (values ('clientes', 'clientes_leer', 'clientes.ver'), ('conceptos', 'conceptos_leer', 'conceptos.ver'), ('establecimientos', 'establecimientos_leer', 'establecimientos.ver'), ('documentos', 'documentos_leer', 'borradores.ver'),
      ('documento_lineas', 'doc_lineas_leer', 'borradores.ver'), ('operaciones_fiscales', 'operaciones_leer', 'historial.ver'), ('eventos_proveedor', 'eventos_leer', 'fiscal.ver'), ('conciliaciones', 'conciliaciones_leer', 'fiscal.ver'), ('alertas_fiscales', 'alertas_leer', 'fiscal.ver')) v(tabla, pol, perm) loop
    execute format('drop policy if exists %I on public.%I', x.pol, x.tabla);
    execute format('create policy %I on public.%I for select to authenticated using (%s)', x.pol, x.tabla,
      case when p_perm_nuevo then format('empresa_id in (select public.fel__empresas_con_permiso(%L))', x.perm) else format('fel_tiene_permiso(empresa_id, %L)', x.perm) end);
  end loop;
end $$;
S
P -f /tmp/medrls_v_$$.sql
alcance() { if [ "$1" = nueva ]; then P -c "drop policy if exists documentos_alcance_leer on public.documentos; create policy documentos_alcance_leer on public.documentos as restrictive for select to authenticated using ((select not public.fel__establecimiento_por_usuario()) or empresa_id in (select public.fel__empresas_alcance_total()) or establecimiento_id in (select public.fel__establecimientos_en_alcance()))"
 else P -c "drop policy if exists documentos_alcance_leer on public.documentos; create policy documentos_alcance_leer on public.documentos as restrictive for select to authenticated using ((not public.fel__establecimiento_por_usuario()) or public.fel_en_alcance(empresa_id, auth.uid(), establecimiento_id))"; fi; }
variante() { # $1 = 0..3
  local s=false p=false a=antigua; [ "$1" -ge 1 ] && s=true; [ "$1" -ge 2 ] && p=true; [ "$1" -ge 3 ] && a=nueva
  P -c "select public.zz_politicas($s, $p)" >/dev/null; alcance $a; }
cargar() { local N=$1
  P -c "set session_replication_role = replica; truncate public.alertas_fiscales, public.artefactos_documento, public.operaciones_fiscales, public.documento_lineas, public.documentos, public.clientes cascade;
        insert into public.clientes (empresa_id, tipo_identificacion, numero_identificacion, nombre, activo, frecuente) select '$A', 'NIT', (8000000 + g) || '-1', 'Cliente ' || lpad(g::text, 6, '0'), true, g % 17 = 0 from generate_series(1, $N) g;
        insert into public.documentos (empresa_id, numero_borrador, cliente_id, establecimiento_id, subtotal, base_imponible, total, estado_preparacion, estado_fiscal, serie, numero_fiscal, autorizacion_sat, certificacion_verificada_en, fecha_emision_prevista)
          select '$A', g, (select id from public.clientes c where c.empresa_id = '$A' order by c.nombre offset (g - 1) % $N limit 1), (select id from public.establecimientos where empresa_id = '$A' order by codigo_sat offset g % 2 limit 1), 100, 100, 112, 'revisado',
                 case when g % 3 = 0 then 'certificado' else 'ninguno' end, case when g % 3 = 0 then 'SIM' end, case when g % 3 = 0 then g::text end, case when g % 3 = 0 then 'SIM-' || g end, case when g % 3 = 0 then now() end, date '2026-01-01' + (g % 300)
            from generate_series(1, $N) g;
        insert into public.documento_lineas (documento_id, empresa_id, orden, descripcion, cantidad, precio_unitario) select id, empresa_id, 1, 'Servicio', 1, 100 from public.documentos;
        analyze;" >/dev/null; }
cat > /tmp/medrls_a_$$.sql <<S
begin;
$CLAIMS
select jsonb_array_length(api.clientes_listar());
commit;
S
mk() { cat > /tmp/medrls_$1_$$.sql <<S
begin;
$CLAIMS
$2
commit;
S
}
mk estado "select jsonb_array_length(api.estado_catalogos() -> 'clientes');"
mk lista "select (api.documentos_listar('{\"pagina\":1,\"tam\":25}') ->> 'total')::int;"
mk filtro "select (api.documentos_listar('{\"pagina\":2,\"tam\":25,\"categoria\":\"emitidos\",\"q\":\"Cliente 0001\"}') ->> 'total')::int;"
mk detalle "select jsonb_typeof(api.documento_detalle((select id from public.documentos where empresa_id = '$A' and numero_borrador = 7)) -> 'documento');"
mk panel "select (api.panel_resumen() -> 'documentos' ->> 'total')::int;"
mk directo_cli "select count(*) from (select c.id, (select count(*)::int from public.documentos d where d.cliente_id = c.id and d.empresa_id = c.empresa_id) as facturas from public.clientes c where c.empresa_id = '$A' order by c.nombre) x;"
mk directo "select (select count(*) from public.documentos where empresa_id = '$A') + (select count(*) from (select d.id from public.documentos d left join public.clientes c on c.id = d.cliente_id and c.empresa_id = d.empresa_id where d.empresa_id = '$A' order by d.numero_borrador desc limit 25) x);"
bench() { "$PGBIN/pgbench" -h "$SOCK" -p "$PORT" -U postgres -d nexa -n -f "$1" -c 1 -j 1 -T "$T" 2>&1 | awk '/latency average/ {printf "%.2f", $4}'; }
{
echo "# Mediciones de lecturas por la Data API (RLS) · $(date -u +%F)"; echo
echo "Base local PostgreSQL, 1 conexión, **sin red**, ${T} s por caso, mismas sentencias que PostgREST (claims + \`SET LOCAL ROLE authenticated\` + RPC). Latencia media en **ms** (menos es mejor). **No** es una medición contra #55 ni de la red de Supabase."
echo "N = clientes = documentos (y líneas) de una empresa; la tercera parte de los documentos está certificada. Variantes: **V0** políticas originales · **V1** + «sesión viva» una vez por consulta · **V2** + permisos por conjunto de empresas · **V3** + alcance por establecimiento por conjunto (estado propuesto). «directo» = SQL de superusuario sin RLS (referencia)."; echo
for N in 300 3000 15000; do
  cargar $N; echo "## N = $N"; echo; echo "| caso | directo (sin RLS) | V0 original | V1 | V2 | V3 propuesto | V0 → V3 |"; echo "|---|---|---|---|---|---|---|"
  declare -A R=()
  for v in 0 1 2 3; do variante $v; for c in a estado lista filtro detalle panel; do R[$c,$v]=$(bench /tmp/medrls_${c}_$$.sql); done; done
  DIR=$(bench /tmp/medrls_directo_$$.sql); DIRC=$(bench /tmp/medrls_directo_cli_$$.sql)
  for c in a estado lista filtro detalle panel; do
    nom=$c; case $c in a) nom="clientes_listar (N filas)";; estado) nom="estado_catalogos";; lista) nom="documentos_listar p.1 (25)";; filtro) nom="documentos_listar filtrada p.2";; detalle) nom="documento_detalle";; panel) nom="panel_resumen";; esac
    echo "| $nom | $([ $c = lista ] && echo $DIR || ([ $c = a ] && echo "$DIRC (consulta actual del servidor)" || echo —)) | ${R[$c,0]} | ${R[$c,1]} | ${R[$c,2]} | ${R[$c,3]} | $(awk -v a=${R[$c,0]} -v b=${R[$c,3]} 'BEGIN{ if (b>0) printf "×%.1f", a/b; else print "—"}') |"
  done; echo
done
} > "$SALIDA"
echo "medición terminada → $SALIDA" >&2
