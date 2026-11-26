-- Reversión de M-A a M-D (orden inverso). SE NIEGA si ya hay datos de configuración, para no perder credenciales cifradas, emisores aprobados ni permisos excepcionales.
\set ON_ERROR_STOP on
begin;
do $$ begin
  if exists (select 1 from public.empresa_digifact_config) or exists (select 1 from public.empresa_emisor_versiones where estado <> 'borrador')
     or exists (select 1 from public.acceso_maestro_datos) or exists (select 1 from public.empresa_digifact_eventos) or exists (select 1 from public.usuario_establecimientos) then
    raise exception 'FEL_REGLA: hay datos multiempresa; la reversión se niega (exporta y decide con el propietario)';
  end if;
end $$;
-- M-I (envoltorios de sesión de las fel_op_*; se retiran primero)
do $$ declare r record; begin for r in select oid::regprocedure as f from pg_proc where pronamespace = 'public'::regnamespace and proname like 'fel\_ses\_%' loop execute format('drop function %s', r.f); end loop; end $$;
-- M-G y M-F (se retiran primero)
drop function if exists public.fel_adm_datos_excepcionales_configuracion(text, uuid), public.fel_adm_datos_excepcionales_documentos(text, uuid, integer), public.fel_adm_acceso_revocar(text, uuid),
  public.fel_adm_acceso_solicitar(text, uuid, text, text, uuid, integer), public.fel_adm_empresas_resumen(text), public.fel_adm_estado(text), public.fel_adm_digifact_suspender(text),
  public.fel_adm_digifact_interruptores(text, boolean, boolean, boolean, boolean, integer), public.fel_adm_digifact_registrar_prueba(text, boolean), public.fel_adm_digifact_conectar(text, text, bytea, smallint, integer),
  public.fel_adm_emisor_aprobar(text, uuid, integer, text), public.fel_adm_emisor_guardar(text, uuid, text, text, text, text, jsonb, text, text, text, text, text, text), public.fel_adm_borrador_trasladar(text, uuid, uuid, text),
  public.fel_adm_asignacion_revocar(text, uuid, uuid, text), public.fel_adm_asignar(text, uuid, uuid, boolean, text), public.fel_adm_asignaciones_listar(text), public.fel_adm_establecimiento_nombre(text, uuid, text), public.fel_adm_supervisor(text, uuid, boolean, text), public.fel_adm_establecimiento_activo(text, uuid), public.fel_adm_contexto(text),
  public.fel__sesion_maestro(text), public.fel__sesion_empresa(text), public.fel__sesion(text);
drop table if exists public.sesion_establecimiento_activo;
drop policy if exists documentos_alcance_leer on public.documentos;
drop trigger if exists documentos_alcance on public.documentos;
drop trigger if exists miembros_multiples on public.miembros;
drop function if exists public.fel_op_borrador_trasladar(uuid, uuid, uuid, uuid, text), public.fel_op_asignacion_revocar(uuid, uuid, uuid, uuid, text), public.fel_op_asignacion_guardar(uuid, uuid, uuid, uuid, boolean, text);
drop table if exists public.usuario_establecimientos;
drop function if exists public.fel_documento_alcance(), public.fel_miembro_multiples(), public.fel_usuario_est_unica(), public.fel_en_alcance(uuid, uuid, uuid), public.fel_alcance(uuid, uuid), public.fel__establecimiento_por_usuario();
-- se restaura la función original del establecimiento del documento (migración 1)
create or replace function public.fel_op_documento_establecimiento(p_actor uuid, p_empresa uuid, p_doc uuid, p_est uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'borradores.editar');
  if not exists (select 1 from public.establecimientos where id = p_est and empresa_id = p_empresa and estado = 'activo') then
    raise exception 'FEL_REGLA: establecimiento no válido para esta empresa';
  end if;
  if not exists (select 1 from public.documentos where id = p_doc and empresa_id = p_empresa) then raise exception 'FEL_NO_ENCONTRADO: documento no encontrado'; end if;
  update public.documentos set establecimiento_id = p_est, actualizado_por = p_actor, version = version + 1
   where id = p_doc and empresa_id = p_empresa and estado_preparacion = 'borrador' and estado_fiscal = 'ninguno';
  if not found then raise exception 'FEL_REGLA: el establecimiento solo se asigna a un borrador sin estado fiscal'; end if;
  perform public.fel_auditar(p_empresa, p_actor, 'documento.establecimiento', 'documento', p_doc::text, jsonb_build_object('establecimiento', p_est));
end $$;
delete from public.plataforma_parametros where clave = 'establecimiento_por_usuario';
delete from public.rol_permisos where permiso in ('establecimientos.asignar','establecimientos.multiples');
delete from public.permisos_catalogo where codigo in ('establecimientos.asignar','establecimientos.multiples');
drop function if exists public.fel_admin_empresas_resumen(uuid), public.fel_admin_datos_excepcionales_configuracion(uuid, uuid), public.fel_admin_datos_excepcionales_documentos(uuid, uuid, integer),
  public.fel__acceso_vigente(uuid, uuid, text), public.fel_admin_acceso_revocar(uuid, uuid), public.fel_admin_acceso_solicitar(uuid, uuid, text, text, uuid, integer);
drop table if exists public.acceso_maestro_datos;
drop view if exists public.v_empresa_digifact_estado;
drop function if exists public.fel_sys_digifact_credencial(uuid), public.fel_op_digifact_suspender(uuid, uuid), public.fel_op_digifact_interruptores(uuid, uuid, boolean, boolean, boolean, boolean, integer),
  public.fel_op_digifact_registrar_prueba(uuid, uuid, boolean), public.fel_op_digifact_conectar(uuid, uuid, text, bytea, smallint, integer), public.fel__digifact_evento(uuid, text, uuid, jsonb);
drop table if exists public.empresa_digifact_eventos, public.empresa_digifact_config;
drop function if exists public.fel_digifact_config_reglas(), public.fel_solo_agregar();
drop function if exists public.fel_sys_emisor_vigente(uuid), public.fel_op_emisor_aprobar(uuid, uuid, uuid, integer, text), public.fel_op_emisor_guardar(uuid, uuid, uuid, text, text, text, text, jsonb, text, text, text, text, text, text);
drop table if exists public.empresa_emisor_versiones;
drop function if exists public.fel_emisor_inmutable();
alter table public.establecimientos drop column if exists departamento, drop column if exists municipio, drop column if exists codigo_postal;
delete from public.rol_permisos where permiso in ('fiscal.configurar','fiscal.aprobar_emisor','digifact.conectar','digifact.probar');
delete from public.permisos_catalogo where codigo in ('fiscal.configurar','fiscal.aprobar_emisor','digifact.conectar','digifact.probar');
commit;
