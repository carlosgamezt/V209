-- ENDURECIMIENTO 28 · cierra los hallazgos de la auditoría de seguridad de las 27 migraciones (ver docs/migracion-28/INFORME-AUDITORIA-28.md).
-- ADITIVA e IDEMPOTENTE: no modifica ninguna migración anterior, no toca datos y no abre ningún privilegio; solo CIERRA.
--   1. Las empresas no se borran ni se vacían (se inhabilitan cambiando su estado). Lo impone un disparador, de modo que tampoco puede borrarlas por error ningún otro rol.
--   2. El rol de servicio ya no puede borrar ni vaciar NINGUNA tabla de «public»: todas las escrituras legítimas pasan por las funciones fel_* (SECURITY DEFINER, que corren con los privilegios de su dueño).
--   3. Las funciones de disparador dejan de ser ejecutables por los roles de la API (un disparador se ejecuta igual al dispararse; el privilegio solo importaba al crearlo).
--   4. Una confirmación de orden de emisión solo puede apuntar a una orden de SU MISMA empresa (clave foránea compuesta; hasta ahora lo garantizaba solo la función fel_op_orden_confirmacion_autorizar).
-- No cambia ningún comportamiento de la aplicación: ninguna ruta de la API ni de la demostración borra, vacía ni escribe directamente con el rol de servicio.

-- 1 · empresas: ni borrar ni vaciar
create or replace function public.fel_empresa_no_borrar() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'FEL_REGLA: las empresas no se borran ni se vacían; se inhabilitan cambiando su estado';
end $$;
revoke all on function public.fel_empresa_no_borrar() from public, anon, authenticated, service_role;
drop trigger if exists empresas_no_borrar on public.empresas;
create trigger empresas_no_borrar before delete on public.empresas for each row execute function public.fel_empresa_no_borrar();
drop trigger if exists empresas_no_vaciar on public.empresas;
create trigger empresas_no_vaciar before truncate on public.empresas for each statement execute function public.fel_empresa_no_borrar();

-- 2 · el rol de servicio no borra ni vacía tablas (REVOKE de un privilegio que no se tiene no es error)
do $$
declare t record;
begin
  for t in select c.oid::regclass as tabla from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') loop
    execute format('revoke delete, truncate on %s from service_role', t.tabla);
  end loop;
end $$;

-- 3 · funciones de disparador: sin EXECUTE para los roles de la API
do $$
declare f record;
begin
  for f in select distinct p.oid::regprocedure as fn from pg_trigger t join pg_proc p on p.oid = t.tgfoid join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and not t.tgisinternal loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.fn);
  end loop;
end $$;

-- 4 · confirmación de orden ↔ orden: misma empresa también a nivel de estructura
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ordenes_emision_id_empresa_uq' and conrelid = 'public.ordenes_emision'::regclass) then
    alter table public.ordenes_emision add constraint ordenes_emision_id_empresa_uq unique (id, empresa_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ordenes_confirmaciones_orden_empresa_fkey' and conrelid = 'public.ordenes_confirmaciones'::regclass) then
    alter table public.ordenes_confirmaciones add constraint ordenes_confirmaciones_orden_empresa_fkey foreign key (orden_id, empresa_id) references public.ordenes_emision (id, empresa_id) not valid;
  end if;
  alter table public.ordenes_confirmaciones validate constraint ordenes_confirmaciones_orden_empresa_fkey;   -- falla (y no se aplica nada) si hubiera una confirmación cruzada entre empresas
end $$;

-- comprobación final: si algo no quedó como se declara, la migración entera falla y no se aplica nada
do $$
declare n int;
begin
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind in ('r', 'p') and (has_table_privilege('service_role', c.oid, 'DELETE') or has_table_privilege('service_role', c.oid, 'TRUNCATE'));
  if n <> 0 then raise exception 'FEL_REGLA: % tablas conservan DELETE o TRUNCATE para el rol de servicio', n; end if;
  select count(*) into n from pg_trigger t join pg_proc p on p.oid = t.tgfoid join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and not t.tgisinternal and (has_function_privilege('service_role', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE'));
  if n <> 0 then raise exception 'FEL_REGLA: % disparadores conservan EXECUTE para roles de la API', n; end if;
end $$;
