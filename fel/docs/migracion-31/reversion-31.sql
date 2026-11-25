-- NEXA FEL · REVERSIÓN SEGURA de la propuesta 31 (solo sus objetos; NO es restauración de respaldo). Una sola sentencia, como «postgres».
-- SE NIEGA (sin borrar nada) si ya existe una operación de Digifact sobre un documento que no es FACT: se perdería su respaldo de integridad.
do $r$
declare n int;
begin
  select count(*) into n from public.digifact_operaciones o join public.documentos d on d.id = o.documento_id and d.empresa_id = o.empresa_id where d.tipo_dte <> 'FACT';
  if n > 0 then raise exception 'REVERSIÓN 31 RECHAZADA: hay % operaciones de Digifact sobre documentos que no son FACT. No se borró nada.', n; end if;
  drop trigger fel_digifact_tipo_guard_t on public.digifact_operaciones;
  create trigger fel_digifact_tipo_guard_t before insert on public.digifact_operaciones for each row execute function public.fel_operacion_tipo_guard();
  drop function public.fel_digifact_tipo_guard(), public.fel_tipos_certificacion_test();
  alter table public.fel_tipos_dte drop constraint fel_tipos_cert_test_chk, drop column certificacion_test;
  if to_regclass('supabase_migrations.schema_migrations') is not null then execute 'delete from supabase_migrations.schema_migrations where version = ''20261125000100'''; end if;
end
$r$;
