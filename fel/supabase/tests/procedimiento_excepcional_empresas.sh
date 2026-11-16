#!/usr/bin/env bash
# Procedimiento EXCEPCIONAL de eliminación de una empresa (docs/migracion-28/eliminar-empresa-excepcional.sql) sobre una base DESECHABLE: debe negarse en cada caso inseguro y funcionar solo con una empresa vacía.
# Uso: PSQL_CMD="psql -h ... -U postgres -d postgres" bash procedimiento_excepcional_empresas.sh
set -uo pipefail
P=${PSQL_CMD:?define PSQL_CMD}; SQL="$(cd "$(dirname "$0")/../.." && pwd)/docs/migracion-28/eliminar-empresa-excepcional.sql"
q() { $P -v ON_ERROR_STOP=1 -q -X -t -A -c "$1"; }
A=00000000-0000-0000-0000-0000000000a7; E1=11111111-1111-1111-1111-1111111111e1; E2=22222222-2222-2222-2222-2222222222e2; E3=33333333-3333-3333-3333-3333333333e3
q "insert into auth.users (id,email) values ('$A','m-exc@fel.test'); insert into public.perfiles (user_id) values ('$A') on conflict (user_id) do nothing; insert into public.plataforma_admins (user_id) values ('$A');
   insert into public.empresas (id,nombre_comercial,razon_social,nit) values ('$E1','Vacia','Vacia, S.A.','1111111-1'),('$E2','Con historial','Con historial, S.A.','2222222-2'),('$E3','Otra vacia','Otra vacia, S.A.','3333333-3');
   select public.fel_auditar('$E2','$A','x','empresa','x')" >/dev/null || { echo "FALLO preparación"; exit 1; }
corre() { $P -v ON_ERROR_STOP=1 -q -X -v empresa="$1" -v autoriza="$2" -v motivo="$3" -v confirmacion="$4" -f "$SQL" 2>&1; }
dice() { local o; o="$("${@:2}" 2>&1)"; grep -q -- "$1" <<<"$o"; }   # captura la salida antes de buscar (con pipefail, grep -q cortaría la tubería)
fallos=0; ok() { echo "OK procedimiento-excepcional: $1"; }; mal() { echo "FALLO excepcional: $1"; fallos=$((fallos+1)); }
dice "falta la confirmación literal" corre $E1 $A "creada por error en pruebas" "no" && ok "sin la confirmación literal se niega" || mal "sin confirmación"
dice "al menos 10 caracteres" corre $E1 $A "corto" "ELIMINAR-EMPRESA-$E1" && ok "motivo corto se niega" || mal "motivo corto"
dice "no es administrador de la plataforma" corre $E1 22222222-0000-0000-0000-0000000000ff "creada por error en pruebas" "ELIMINAR-EMPRESA-$E1" && ok "quien autoriza debe ser administrador de la plataforma" || mal "autorizador"
dice "tiene historial y NO se elimina: auditoria" corre $E2 $A "creada por error en pruebas" "ELIMINAR-EMPRESA-$E2" && ok "una empresa con historial NO se elimina (lista dónde lo tiene)" || mal "con historial"
q "update public.empresas set estado='suspendida' where id='$E3'" >/dev/null 2>&1; q "select count(*) from public.empresas where id in ('$E1','$E2','$E3')" | grep -qx 3 && ok "tras los rechazos no se borró nada (transacción única)" || mal "se borró algo en un rechazo"
corre $E1 $A "creada por error en pruebas" "ELIMINAR-EMPRESA-$E1" >/dev/null && [ "$(q "select count(*) from public.empresas where id='$E1'")" = 0 ] && ok "una empresa VACÍA y todo en regla sí se elimina" || mal "no eliminó la empresa vacía"
[ "$(q "select tgenabled from pg_trigger where tgrelid='public.empresas'::regclass and tgname='empresas_no_borrar'")" = O ] && ok "el disparador queda ACTIVO después del procedimiento" || mal "disparador desactivado"
[ "$(q "select count(*) from public.auditoria where accion='empresa.eliminacion_excepcional' and entidad_id='$E1' and empresa_id is null")" = 1 ] && ok "queda constancia en la auditoría (sin empresa, porque ya no existe)" || mal "sin auditoría"
dice "no se borran" q "delete from public.empresas where id='$E2'" && ok "después del procedimiento, borrar sigue prohibido" || mal "borrar ya no está prohibido"
[ "$fallos" = 0 ] && echo "PROCEDIMIENTO EXCEPCIONAL OK" || { echo "$fallos fallo(s)"; exit 1; }
