-- REVERSIÓN de 20261121000100_fel_correo_envios.sql. ATENCIÓN: borra el historial de envíos por correo (no hay copia). Úsala solo si no hay nada que conservar.
-- No toca ninguna tabla ni función anterior a la propuesta. Es repetible (if exists).
begin;
drop table if exists public.envios_correo;                       -- elimina también su trigger, sus índices y su política RLS
drop function if exists public.fel_envios_correo_guardia();
delete from public.rol_permisos where permiso in ('correos.ver', 'correos.enviar', 'correos.reenviar');
delete from public.permisos_catalogo where codigo in ('correos.ver', 'correos.enviar', 'correos.reenviar');
commit;
