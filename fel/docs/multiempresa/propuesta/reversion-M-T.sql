-- Reversión de M-T: retira las RPC de lectura restantes y el constructor del plan.
\set ON_ERROR_STOP on
begin;
drop function if exists api.plan_resumen(), api.reporte_consumos(), api.usuarios_resumen(), api.pla_lectura_resumen(), api.pla_lectura_planes(), api.pla_lectura_plan_empresa(uuid), api.pla_lectura_bolson(), api.pla_lectura_conciliaciones(), api.pla_lectura_verificacion();
drop function if exists public.fel__plan_json(uuid);
commit;
