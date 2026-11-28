#!/usr/bin/env bash
# Pruebas de MUTACIÓN de CORE: se rompe a propósito una garantía de seguridad en una copia de las migraciones y la suite DEBE fallar. Si una mutación sobrevive, las pruebas no protegen esa garantía.
set -uo pipefail
cd "$(dirname "$0")/../.."
SRC=core/supabase/migraciones; fallos=0
mut() { # nombre archivo patrón_python reemplazo_python
  local T=/tmp/core-mut-$$-$1; rm -rf $T; mkdir -p $T; cp $SRC/*.sql $T/
  python3 - "$T/$2" "$3" "$4" <<'PY' || { echo "FALLO la mutación «$1» no se pudo aplicar"; fallos=$((fallos+1)); return; }
import sys; p, a, b = sys.argv[1:4]; s = open(p).read()
assert a in s, 'patrón no encontrado'; open(p, 'w').write(s.replace(a, b, 1))
PY
  if MIGDIR=$T pruebas/core/test_core.sh >/tmp/mut_out_$$.txt 2>&1; then echo "FALLO sobrevivió la mutación: $1"; fallos=$((fallos+1));
  elif grep -q "FALLO pruebas de comportamiento de CORE" /tmp/mut_out_$$.txt && ! grep -q "FALLO no carga" /tmp/mut_out_$$.txt; then echo "OK    mutación detectada por las pruebas de comportamiento: $1";
  else echo "FALLO la mutación «$1» rompió la carga, no una garantía (revisar)"; fallos=$((fallos+1)); fi
  rm -rf $T
}
mut membresia_suspendida C05_funciones_internas.sql "where m.empresa_id = p_empresa and m.user_id = p_user and m.estado = 'activa' and e.estado = 'activa'" "where m.empresa_id = p_empresa and m.user_id = p_user and e.estado = 'activa'"
mut permiso_ignorado C05_funciones_internas.sql "if not (p_codigo = any (core.permisos_de(p_empresa, c.o_user, p_modulo))) then" "if false then"
mut sesion_no_viva C05_funciones_internas.sql "if not found then raise exception 'CORE_SESION_NO_VIVA' using errcode = '28000'; end if;" ""
mut anon_ejecuta C06_api.sql "revoke all on all tables in schema core from public, anon, authenticated;" "grant execute on function api.mi_contexto() to anon; revoke all on all tables in schema core from public, anon, authenticated;"
mut auditoria_modificable C04_eventos_aprovisionamiento_auditoria.sql "create trigger auditoria_sin_cambios before update or delete on core.auditoria for each row execute function core.auditoria_inmutable();" ""
mut eventos_de_otras_empresas C06_api.sql "and exists (select 1 from core.empresa_modulos em where em.empresa_id = ev.empresa_id and em.modulo = p_modulo)))" "))"
mut modulo_sin_verificar C06_api.sql "(claims ->> 'modulo') is distinct from p_modulo or " ""
mut mfa_plataforma C05_funciones_internas.sql "and not c.o_aal2 then raise exception 'CORE_MFA_REQUERIDA'" "and false then raise exception 'CORE_MFA_REQUERIDA'"
mut ultimo_propietario C06_api.sql "if p_estado = 'suspendida' and core.es_propietario(p_empresa, p_user) and core.otros_propietarios(p_empresa, p_user) = 0 then" "if false then"
mut invitacion_ajena C06_api.sql "if mail is distinct from inv.email then" "if false then"
mut plan_no_incluye C06_api.sql "if p_origen = 'plan' and not exists (select 1 from core.suscripciones s" "if false and not exists (select 1 from core.suscripciones s"
[ $fallos = 0 ] && echo "MUTACIONES OK (11 de 11 detectadas)" || { echo "MUTACIONES CON FALLOS: $fallos"; exit 1; }
