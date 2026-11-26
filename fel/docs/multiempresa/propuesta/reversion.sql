-- Reversión de M-A a M-D (orden inverso). SE NIEGA si ya hay datos de configuración, para no perder credenciales cifradas, emisores aprobados ni permisos excepcionales.
\set ON_ERROR_STOP on
begin;
do $$ begin
  if exists (select 1 from public.empresa_digifact_config) or exists (select 1 from public.empresa_emisor_versiones where estado <> 'borrador')
     or exists (select 1 from public.acceso_maestro_datos) or exists (select 1 from public.empresa_digifact_eventos) then
    raise exception 'FEL_REGLA: hay datos multiempresa; la reversión se niega (exporta y decide con el propietario)';
  end if;
end $$;
drop function if exists public.fel_admin_empresas_resumen(uuid), public.fel_admin_datos_excepcionales_configuracion(uuid, uuid), public.fel_admin_datos_excepcionales_documentos(uuid, uuid, integer),
  public.fel__acceso_vigente(uuid, uuid, text), public.fel_admin_acceso_revocar(uuid, uuid), public.fel_admin_acceso_solicitar(uuid, uuid, text, text, uuid, integer);
drop table if exists public.acceso_maestro_datos;
drop view if exists public.v_empresa_digifact_estado;
drop function if exists public.fel_sys_digifact_credencial(uuid), public.fel_op_digifact_suspender(uuid, uuid), public.fel_op_digifact_interruptores(uuid, uuid, boolean, boolean, boolean, boolean, integer),
  public.fel_op_digifact_registrar_prueba(uuid, uuid, boolean), public.fel_op_digifact_conectar(uuid, uuid, text, bytea, smallint, integer), public.fel__digifact_evento(uuid, text, uuid, jsonb);
drop table if exists public.empresa_digifact_eventos, public.empresa_digifact_config;
drop function if exists public.fel_digifact_config_reglas(), public.fel_solo_agregar();
drop function if exists public.fel_sys_emisor_vigente(uuid), public.fel_op_emisor_aprobar(uuid, uuid, integer, text), public.fel_op_emisor_guardar(uuid, uuid, text, text, text, text, jsonb, text, integer, text, text, text, text, text);
drop table if exists public.empresa_emisor_versiones;
drop function if exists public.fel_emisor_inmutable();
alter table public.establecimientos drop column if exists departamento, drop column if exists municipio, drop column if exists codigo_postal;
delete from public.rol_permisos where permiso in ('fiscal.configurar','fiscal.aprobar_emisor','digifact.conectar','digifact.probar');
delete from public.permisos_catalogo where codigo in ('fiscal.configurar','fiscal.aprobar_emisor','digifact.conectar','digifact.probar');
commit;
