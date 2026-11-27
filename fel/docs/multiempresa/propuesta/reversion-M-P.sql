-- Reversión de M-P: devuelve a nexa_app el EXECUTE de los 9 protocolos de máquina del agente local (solo si el rol existe).
do $$ declare r record; begin
  if not exists (select 1 from pg_roles where rolname = 'nexa_app') then return; end if;
  for r in select p.proname, pg_get_function_identity_arguments(p.oid) as args from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('fel_sys_agente_autenticar', 'fel_sys_agente_clave', 'fel_sys_agente_latido', 'fel_sys_agente_politica', 'fel_sys_agente_vincular', 'fel_sys_orden_reclamar', 'fel_sys_orden_progreso', 'fel_sys_orden_resultado', 'fel_sys_orden_vista_previa') loop
    execute format('grant execute on function public.%I(%s) to nexa_app', r.proname, r.args);
  end loop;
end $$;
