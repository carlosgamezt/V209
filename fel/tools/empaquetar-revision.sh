#!/usr/bin/env bash
# Genera fel/revision/: migraciones, políticas RLS y funciones de autorización en archivos legibles para revisión.
set -euo pipefail
cd "$(dirname "$0")/.."
out=revision; rm -rf "$out"; mkdir -p "$out"
cat supabase/migrations/*.sql > "$out/1_migraciones_completas.sql"
grep -n -i -E "^create policy|^  using|^  with check" supabase/migrations/20261110000300_fel_rls_y_datos.sql > /dev/null
{ echo "-- Políticas RLS (extraídas de la migración 0300)"; awk '/^create policy/{p=1} p{print} /;[[:space:]]*$/{if(p){p=0; print ""}}' supabase/migrations/20261110000300_fel_rls_y_datos.sql; } > "$out/2_politicas_rls.sql"
{ echo "-- Funciones de autorización y protecciones"; sed -n '/^create or replace function public.fel__rango/,/^create or replace function public.fel_siguiente_borrador/p' supabase/migrations/20261110000200_fel_funciones.sql; sed -n '/^create or replace function public.fel__exigir_permiso/,/^end \$\$;/p' supabase/migrations/20261110000400_fel_clientes_conceptos.sql; } > "$out/3_funciones_autorizacion.sql"
cp docs/matriz-estados.md "$out/4_matriz_estados.md"
cp docs/primer-administrador-maestro.md "$out/5_primer_administrador_maestro.md"
for d in auditoria-claims auditoria-cadena-autenticacion matriz-integracion-supabase-real invitaciones recuperacion-acceso seguridad-sesion dependencias-auth-interno guia-proyecto-supabase-desarrollo prueba-viabilidad-portal-sat gestion-sesion-sat fase-2-observacion-portal-real fase-2-analisis-observacion-1 fase-2-informe-sat-2a fase-2-prueba-simulada-angular; do cp docs/$d.md "$out/6_$d.md"; done
echo "Paquete en fel/$out"
