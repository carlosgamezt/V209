-- NEXA FEL · REVERSIÓN SEGURA de la migración 30, tipos de documento (solo sus objetos y su versión en el historial; NO es una restauración de respaldo). Se ejecuta como «postgres» en el editor SQL, DENTRO de una sola sentencia.
-- SE NIEGA (y no borra nada) si ya hay notas, recibos o configuración por empresa: esos datos se perderían. Los documentos que son FACT quedan intactos (solo se quitan las 5 columnas nuevas, todas vacías en una FACT).
do $r$
declare a int; b int;
begin
  select count(*) into a from public.documentos where tipo_dte <> 'FACT';
  select count(*) into b from public.empresa_tipos_documento;
  if a > 0 or b > 0 then raise exception 'REVERSIÓN TIPOS RECHAZADA: hay % documentos que no son FACT y % filas de configuración por empresa; se perderían. No se borró nada.', a, b; end if;
  drop trigger if exists fel_operacion_tipo_guard_t on public.operaciones_fiscales;
  if to_regclass('public.digifact_operaciones') is not null then execute 'drop trigger if exists fel_digifact_tipo_guard_t on public.digifact_operaciones'; end if;
  drop trigger if exists fel_documento_tipo_guard_t on public.documentos;
  alter table public.documentos drop constraint documentos_tipo_chk, drop constraint documentos_origen_fk;
  drop index if exists public.documentos_origen_idx, public.documentos_tipo_idx;
  alter table public.documentos drop column tipo_dte, drop column documento_origen_id, drop column referencia_origen, drop column motivo_ajuste, drop column tipo_recibo;
  drop function public.fel_op_documento_tipo(uuid, uuid, uuid, text, uuid, text, text, integer), public.fel_op_documento_origenes(uuid, uuid, text, uuid, text),
    public.fel_op_tipos_empresa_guardar(uuid, uuid, text, boolean, text, boolean), public.fel_tipos_empresa(uuid, uuid), public.fel_tipos_instalar_guardian_digifact(),
    public.fel_operacion_tipo_guard(), public.fel_documento_tipo_guard(), public.fel__receptor_id(uuid, uuid), public.fel__tipo_no_habilitado(uuid, text);
  drop table public.empresa_tipos_documento;
  drop table public.fel_tipos_dte;   -- sus disparadores se van con la tabla
  drop function public.fel_tipos_dte_inmutable();
  -- la 30 es una migración REGISTRADA: al quitar sus objetos se quita también su versión del historial (si existe), para que la base y el historial sigan diciendo lo mismo
  if to_regclass('supabase_migrations.schema_migrations') is not null then execute 'delete from supabase_migrations.schema_migrations where version = ''20261115000100'''; end if;
end
$r$;
