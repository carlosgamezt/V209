-- M-N · W2 (PROPUESTA; fuera de supabase/migrations; NO se aplica sin autorización). Requiere M-I, M-J y M-M. ESQUEMA `api`: lo único que la Data API (PostgREST) debe exponer, con privilegios mínimos.
-- Configuración de Supabase (se hace en el panel/`config.toml`, no en SQL): «Exposed schemas» = `api` SOLAMENTE (no `public`), de modo que ninguna tabla ni función de `public` es alcanzable por HTTP aunque alguien les conceda privilegios por error.
-- Contenido: por cada función de PERSONA con envoltorio (`fel_ses_X` de empresa, `fel_adm_X` de empresa/plataforma y `fel_pla_X` de plataforma) se genera `api.X(…)` SIN parámetro de identidad: llama al envoltorio con `p_sesion := null`, que ahora significa
-- «la identidad de Supabase Auth» (M-M: auth.uid() + sesión viva + MFA real). Quedan FUERA, a propósito:
--   · `fel_ses_sys_*` / `fel_pla_sys_*` (pasos de la máquina de estados de certificación y verificaciones del sistema): si una persona pudiera llamarlos, podría registrar un resultado fiscal falso de su propia operación. Los ejecuta el nivel de sistema (`nexa-sys`, W5);
--   · `fel_ses_auditar` y `fel_aud_acceso`: la auditoría la escribe el servidor, no la persona.
-- Las operaciones SENSIBLES (fiscales, usuarios, canales, agentes, emisor, Digifact, accesos) exigen aal2 (`fel__exigir_aal2`).
-- Privilegios: `anon` y PUBLIC sin nada; `authenticated` con USAGE del esquema y EXECUTE de cada función.
create schema if not exists api;
revoke all on schema api from public, anon;
grant usage on schema api to authenticated;
alter default privileges in schema api revoke execute on functions from public, anon;
do $$
declare r record; v_args text; v_call text; v_ret text; v_body text; v_nombre text; v_suf text; n int := 0; i int; v_sens boolean;
  v_aal2 text[] := array['certificacion_iniciar', 'certificacion_solicitar', 'anulacion_iniciar', 'anulacion_simulada_iniciar', 'miembro_actualizar', 'invitacion_registrar', 'invitacion_revocar', 'canal_configurar', 'agente_codigo_crear', 'agente_revocar',
    'empresa_datos_guardar', 'establecimiento_guardar', 'conciliacion_decidir', 'tipos_empresa_guardar', 'orden_confirmacion_autorizar', 'asignar', 'asignacion_revocar', 'supervisor', 'establecimiento_nombre', 'borrador_trasladar',
    'emisor_guardar', 'emisor_aprobar', 'digifact_conectar', 'digifact_registrar_prueba', 'digifact_interruptores', 'digifact_suspender', 'acceso_solicitar', 'acceso_revocar'];
begin
  for r in select p.oid, p.proname, p.proretset, p.proargnames, p.proargmodes, pg_get_function_arguments(p.oid) as args
             from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and pg_get_function_arguments(p.oid) like 'p\_sesion text%'
              and ((p.proname like 'fel\_ses\_%' and p.proname not like 'fel\_ses\_sys\_%' and p.proname <> 'fel_ses_auditar') or p.proname like 'fel\_adm\_%' or (p.proname like 'fel\_pla\_%' and p.proname not like 'fel\_pla\_sys\_%'))
            order by p.proname loop
    v_suf := regexp_replace(r.proname, '^fel_(ses|adm|pla)_', '');
    -- las funciones de PLATAFORMA llevan el prefijo pla_ (las `fel_adm_*` de plataforma: accesos excepcionales, resumen de empresas); `fel_adm_estado` (Digifact) no debe chocar con las lecturas `api.estado`
    v_nombre := case when r.proname like 'fel\_pla\_%' or v_suf in ('acceso_solicitar', 'acceso_revocar', 'datos_excepcionales_configuracion', 'datos_excepcionales_documentos', 'empresas_resumen') then 'pla_' || v_suf when v_suf = 'estado' then 'digifact_estado' else v_suf end;
    if exists (select 1 from pg_proc x where x.pronamespace = 'api'::regnamespace and x.proname = v_nombre and x.oid in (select oid from pg_proc where proname = v_nombre and pronamespace = 'api'::regnamespace) and (select count(*) from pg_proc y where y.pronamespace = 'api'::regnamespace and y.proname = v_nombre) > 0 and not exists (select 1 from pg_proc z where z.oid = x.oid and pg_get_function_arguments(z.oid) = regexp_replace(r.args, '^p_sesion text(, )?', ''))) then
      raise exception 'colisión de nombres en api: %', v_nombre; end if;
    v_args := regexp_replace(r.args, '^p_sesion text(, )?', '');
    v_call := 'p_sesion := null::text';
    for i in 2 .. array_length(r.proargnames, 1) loop
      if r.proargmodes is null or r.proargmodes[i] in ('i', 'b', 'v') then v_call := v_call || format(', %I := %I', r.proargnames[i], r.proargnames[i]); end if;
    end loop;
    v_ret := pg_get_function_result(r.oid); v_sens := v_suf = any (v_aal2);
    if v_ret = 'void' then v_body := format('perform public.%I(%s);', r.proname, v_call);
    elsif r.proretset then v_body := format('return query select * from public.%I(%s);', r.proname, v_call);
    else v_body := format('return public.%I(%s);', r.proname, v_call); end if;
    execute format($fn$create or replace function api.%I(%s) returns %s language plpgsql security definer set search_path = '' as $body$
      begin %s %s end $body$ $fn$, v_nombre, v_args, v_ret, case when v_sens then 'perform public.fel__exigir_aal2();' else '' end, v_body);
    execute format('revoke all on function api.%I(%s) from public, anon', v_nombre, (select pg_get_function_identity_arguments(o.oid) from pg_proc o where o.proname = v_nombre and o.pronamespace = 'api'::regnamespace and pg_get_function_arguments(o.oid) = v_args));
    execute format('grant execute on function api.%I(%s) to authenticated', v_nombre, (select pg_get_function_identity_arguments(o.oid) from pg_proc o where o.proname = v_nombre and o.pronamespace = 'api'::regnamespace and pg_get_function_arguments(o.oid) = v_args));
    n := n + 1;
  end loop;
  raise notice 'M-N: % funciones api.* generadas', n;
end $$;
