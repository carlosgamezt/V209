-- APLICADO en producción el 28-nov-2026 (resultado en el registro del flujo; ver docs/egress/ESTADO-PRODUCCION.md). Este archivo queda INERTE para que una ejecución manual completa del flujo no repita un paso que ya no corresponde.
-- El SQL original (con sus comprobaciones) se conserva en supabase/propuestas/egress/ (auto_v1_validacion_roles.sql) y en el historial de git; la reversión está en E1_reversion.sql y la recuperación en E0_recuperacion.sql.
select 'aplicado' as estado, 'v1_validacion_roles' as paso;
