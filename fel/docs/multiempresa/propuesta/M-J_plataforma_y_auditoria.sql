-- M-J · R2, fases F2 y F3 (PROPUESTA; fuera de supabase/migrations; NO se aplica sin autorización). Requiere M-G (fel__sesion_maestro) y M-I.
-- F2 · IDENTIDAD DE PLATAFORMA: por cada `fel_admin_*` y cada `fel_op_mfa_recuperacion_*` (aprobar, cerrar, listar, rechazar) que reciben `p_actor` por PARÁMETRO se genera `fel_pla_X(p_sesion, …)`:
--      el actor sale de la sesión de PLATAFORMA validada (`fel__sesion_maestro`: cuenta de plataforma, sin empresa; con `plataforma_mfa_obligatoria = 1` exige verificación en dos pasos). Los demás parámetros (incluida la empresa OBJETIVO) se conservan:
--      el administrador de la plataforma opera sobre empresas, pero solo con lo que las reglas de la función interna le permiten. La generación lee el catálogo.
-- F3 · AUDITORÍA: `fel_auditar(p_empresa, p_actor, …)` permitía escribir una entrada a nombre de CUALQUIER persona. nexa_app deja de ejecutarla (M-E) y usa:
--      · fel_ses_auditar(p_sesion, accion, entidad, entidad_id, datos): persona y empresa de la sesión; solo acciones de una lista cerrada (nunca las de seguridad, administración o sesión);
--      · fel_aud_acceso(evento, usuario, datos): eventos de inicio y cierre de sesión (la persona puede no tener sesión todavía); lista cerrada de eventos, la base resuelve a la persona por su usuario (no por un id enviado) y marca el origen «acceso».
do $$
declare r record; v_args text; v_call text; v_ret text; v_body text; n int := 0; i int; v_nombre text;
  -- las que M-C/M-G ya cubren con funciones de sesión propias (fel_adm_*): NO se envuelven aquí
  v_excluir text[] := array['fel_admin_acceso_revocar', 'fel_admin_acceso_solicitar', 'fel_admin_datos_excepcionales_configuracion', 'fel_admin_datos_excepcionales_documentos', 'fel_admin_empresas_resumen'];
begin
  for r in select p.oid, p.proname, p.proretset, p.proargnames, p.proargmodes, pg_get_function_arguments(p.oid) as args
             from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname = 'public' and p.prokind = 'f' and p.proname <> all (v_excluir) and pg_get_function_arguments(p.oid) like 'p\_actor uuid%'
              and (p.proname like 'fel\_admin\_%' or p.proname in ('fel_op_mfa_recuperacion_aprobar', 'fel_op_mfa_recuperacion_cerrar', 'fel_op_mfa_recuperacion_listar', 'fel_op_mfa_recuperacion_rechazar')) order by p.proname loop
    v_nombre := 'fel_pla_' || regexp_replace(r.proname, '^fel_(op|admin)_', '');
    if exists (select 1 from pg_proc x where x.pronamespace = 'public'::regnamespace and x.proname = v_nombre and x.oid <> r.oid and pg_get_function_arguments(x.oid) not like 'p\_sesion text%') then raise exception 'colisión de nombres: %', v_nombre; end if;
    v_args := regexp_replace(r.args, '^p_actor uuid(, )?', '');
    v_call := 'p_actor := u';
    for i in 2 .. array_length(r.proargnames, 1) loop
      if r.proargmodes is null or r.proargmodes[i] in ('i', 'b', 'v') then v_call := v_call || format(', %I := %I', r.proargnames[i], r.proargnames[i]); end if;
    end loop;
    v_ret := pg_get_function_result(r.oid);
    if v_ret = 'void' then v_body := format('perform public.%I(%s);', r.proname, v_call);
    elsif r.proretset then v_body := format('return query select * from public.%I(%s);', r.proname, v_call);
    else v_body := format('return public.%I(%s);', r.proname, v_call); end if;
    execute format($fn$create or replace function public.%I(p_sesion text%s) returns %s%s language plpgsql security definer set search_path = '' as $body$
      declare u uuid;
      begin select o_user into u from public.fel__sesion_maestro(p_sesion); %s end $body$ $fn$,
      v_nombre, case when v_args = '' then '' else ', ' || v_args end, case when r.proretset and v_ret not like 'TABLE%' then 'setof ' else '' end, v_ret, v_body);
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', v_nombre, (select pg_get_function_identity_arguments(o.oid) from pg_proc o where o.proname = v_nombre and o.pronamespace = 'public'::regnamespace));
    n := n + 1;
  end loop;
  raise notice 'M-J: % envoltorios fel_pla_* generados', n;
end $$;

-- F3 · auditoría dentro de una sesión de empresa
create or replace function public.fel_ses_auditar(p_sesion text, p_accion text, p_entidad text, p_entidad_id text, p_datos jsonb default '{}'::jsonb, p_origen text default 'fel-api') returns bigint
language plpgsql security definer set search_path = '' as $$
declare u uuid; e uuid;
begin
  select o_user, o_empresa into u, e from public.fel__sesion_empresa(p_sesion);
  if p_accion is null or p_accion !~ '^(documento|receptor|digifact_test|correo)\.[a-z0-9_]{3,60}$' then raise exception 'FEL_REGLA: acción de auditoría no permitida desde la aplicación'; end if;
  if p_entidad is null or p_entidad not in ('documento', 'receptor', 'digifact', 'correo') then raise exception 'FEL_REGLA: entidad de auditoría no permitida'; end if;
  if coalesce(p_origen, 'fel-api') not in ('fel-api', 'fel-correo') then raise exception 'FEL_REGLA: origen de auditoría no permitido'; end if;
  if length(coalesce(p_datos, '{}'::jsonb)::text) > 4000 then raise exception 'FEL_REGLA: datos de auditoría demasiado grandes'; end if;
  return public.fel_auditar(e, u, p_accion, p_entidad, left(p_entidad_id, 120), coalesce(p_datos, '{}'::jsonb), coalesce(p_origen, 'fel-api'));
end $$;
-- F3 · eventos de acceso (pueden ocurrir ANTES de tener sesión): la base resuelve a la persona por su usuario; el evento sale de una lista cerrada
create or replace function public.fel_aud_acceso(p_evento text, p_usuario text, p_datos jsonb default '{}'::jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare c record;
begin
  if p_evento is null or p_evento not in ('inicio_correcto', 'inicio_fallido', 'inicio_bloqueado', 'mfa_fallido', 'sesion_cerrada', 'clave_cambiada') then raise exception 'FEL_REGLA: evento de acceso no permitido'; end if;
  if length(coalesce(p_datos, '{}'::jsonb)::text) > 2000 then raise exception 'FEL_REGLA: datos de auditoría demasiado grandes'; end if;
  select user_id, empresa_id into c from public.demo_credenciales where usuario = left(coalesce(p_usuario, ''), 40);
  return public.fel_auditar(c.empresa_id, c.user_id, 'demo.' || p_evento, 'sesion', left(coalesce(p_usuario, ''), 40), coalesce(p_datos, '{}'::jsonb) || jsonb_build_object('existe', c.user_id is not null), 'acceso');
end $$;
revoke all on function public.fel_ses_auditar(text, text, text, text, jsonb, text), public.fel_aud_acceso(text, text, jsonb) from public, anon, authenticated;
