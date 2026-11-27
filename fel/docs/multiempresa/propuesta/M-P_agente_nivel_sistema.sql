-- M-P · Punto 7 de W (PROPUESTA; fuera de supabase/migrations; NO se aplica sin autorización). CORTE: los 9 protocolos de máquina del agente local pasan al nivel `nexa_sys`.
-- Hoy `nexa_app` ejecuta fel_sys_agente_{autenticar,clave,latido,politica,vincular} y fel_sys_orden_{reclamar,progreso,resultado,vista_previa}: dentro de la base solo se identifican por el `uuid` del agente (la firma Ed25519 se verifica
-- en el servidor, con la clave que entrega `fel_sys_agente_clave`). Un `nexa_app` comprometido que conozca un id de agente actúa como él (latido, reclamar, progreso, vista previa) sin firma. Con este corte esas funciones solo las ejecuta
-- `nexa_sys` (credencial propia, en la función interna `nexa-sys` donde se verifica la firma; W5). Orden de aplicación: DESPUÉS de M-E y cuando la ruta del agente ya use la conexión de sistema.
-- Reversible: reversion-M-P.sql (devuelve el EXECUTE a nexa_app).
do $$
declare r record; v_n int := 0;
begin
  for r in select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('fel_sys_agente_autenticar', 'fel_sys_agente_clave', 'fel_sys_agente_latido', 'fel_sys_agente_politica', 'fel_sys_agente_vincular', 'fel_sys_orden_reclamar', 'fel_sys_orden_progreso', 'fel_sys_orden_resultado', 'fel_sys_orden_vista_previa') loop
    if exists (select 1 from pg_roles where rolname = 'nexa_app') then execute format('revoke execute on function public.%I(%s) from nexa_app', r.proname, r.args); end if;
    if exists (select 1 from pg_roles where rolname = 'nexa_sys') then execute format('grant execute on function public.%I(%s) to nexa_sys', r.proname, r.args); end if;
    v_n := v_n + 1;
  end loop;
  if v_n <> 9 then raise exception 'M-P: se esperaban 9 funciones de protocolo del agente y hay %', v_n; end if;
end $$;
