-- REVERSIÓN de la migración 20261113000100_fel_endurecimiento_28.sql (solo para emergencias; NO es una migración del proyecto).
-- Devuelve el estado de las 27 migraciones anteriores. No toca datos. Idempotente. Úsese únicamente si la 28 causara un problema operativo comprobado.
begin;
drop trigger if exists empresas_no_borrar on public.empresas;
drop trigger if exists empresas_no_vaciar on public.empresas;
drop function if exists public.fel_empresa_no_borrar();
alter table public.ordenes_confirmaciones drop constraint if exists ordenes_confirmaciones_orden_empresa_fkey;
alter table public.ordenes_emision drop constraint if exists ordenes_emision_id_empresa_uq;
do $$ declare t record; begin
  for t in select c.oid::regclass as tabla from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p') loop
    execute format('grant delete, truncate on %s to service_role', t.tabla);   -- estado previo a la 28 (los privilegios de las 27 se recrean con la 28 de nuevo si se vuelve a aplicar)
  end loop;
end $$;
do $$ declare f record; begin
  for f in select distinct p.oid::regprocedure as fn from pg_trigger t join pg_proc p on p.oid = t.tgfoid join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and not t.tgisinternal loop
    execute format('grant execute on function %s to service_role', f.fn);
  end loop;
end $$;
commit;
