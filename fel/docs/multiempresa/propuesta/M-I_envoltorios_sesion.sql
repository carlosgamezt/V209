-- M-I · ENVOLTORIOS CON IDENTIDAD DE SESIÓN para las funciones de empresa `fel_op_*` (R2, fase F1; PROPUESTA; fuera de supabase/migrations; NO se aplica sin autorización). Requiere M-G (fel__sesion_empresa) y que las funciones `fel_op_*` existan.
-- Problema: cada `fel_op_*` recibe `p_actor` y `p_empresa` como PARÁMETROS; quien pudiera ejecutar SQL con el rol de la aplicación podría suplantar a cualquier persona de cualquier empresa.
-- Solución: por cada `fel_op_X(p_actor uuid, p_empresa uuid, …)` se genera `fel_ses_X(p_sesion text, …)` (mismos demás parámetros y mismo resultado) que obtiene actor y empresa de la SESIÓN validada en la base y llama a la función interna con ellos.
-- M-E (rol nexa_app) NO concede las internas que tengan envoltorio y SÍ concede los `fel_ses_*`. La identidad se resuelve SOLO en `fel__sesion_empresa`: en la fase F5 (Supabase Auth) basta reimplementar esa función para validar un JWT; los envoltorios no cambian.
-- Los permisos efectivos (rol, extras y revocados, incluidos los heredados) siguen siendo los de la función interna (`fel__exigir_permiso`). La generación lee el catálogo: no hay lista que mantener a mano.
do $$
declare r record; v_args text; v_decl text; v_call text; v_ret text; v_body text; n int := 0; i int;
  -- las que M-A…M-F ya cubren con funciones de sesión propias (fel_adm_*, M-G/M-H): NO se envuelven aquí (nexa_app nunca recibe las internas)
  v_excluir text[] := array['fel_op_asignacion_guardar', 'fel_op_asignacion_revocar', 'fel_op_borrador_trasladar', 'fel_op_digifact_conectar', 'fel_op_digifact_interruptores', 'fel_op_digifact_registrar_prueba', 'fel_op_digifact_suspender', 'fel_op_emisor_aprobar', 'fel_op_emisor_guardar'];
begin
  for r in select p.oid, p.proname, p.proretset, p.proargnames, p.proargmodes, pg_get_function_arguments(p.oid) as args
             from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname = 'public' and p.prokind = 'f' and p.proname like 'fel\_op\_%' and p.proname <> all (v_excluir) and pg_get_function_arguments(p.oid) like 'p\_actor uuid, p\_empresa uuid%' order by p.proname loop
    -- parámetros restantes (con sus valores por defecto tal como los imprime PostgreSQL) y llamada con notación por nombre (robusta ante valores por defecto)
    v_args := regexp_replace(r.args, '^p_actor uuid, p_empresa uuid(, )?', '');
    v_call := 'p_actor := u, p_empresa := e';
    for i in 3 .. array_length(r.proargnames, 1) loop   -- solo parámetros de ENTRADA (las columnas de un RETURNS TABLE también figuran en proargnames, con modo 't')
      if r.proargmodes is null or r.proargmodes[i] in ('i', 'b', 'v') then v_call := v_call || format(', %I := %I', r.proargnames[i], r.proargnames[i]); end if;
    end loop;
    v_ret := pg_get_function_result(r.oid);
    if v_ret = 'void' then v_body := format('perform public.%I(%s);', r.proname, v_call);
    elsif r.proretset then v_body := format('return query select * from public.%I(%s);', r.proname, v_call);
    else v_body := format('return public.%I(%s);', r.proname, v_call); end if;
    execute format($fn$create or replace function public.%I(p_sesion text%s) returns %s%s language plpgsql security definer set search_path = '' as $body$
      declare u uuid; e uuid;
      begin select o_user, o_empresa into u, e from public.fel__sesion_empresa(p_sesion); %s end $body$ $fn$,
      'fel_ses_' || substr(r.proname, 8), case when v_args = '' then '' else ', ' || v_args end, case when r.proretset and v_ret not like 'TABLE%' then 'setof ' else '' end, v_ret, v_body);
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', 'fel_ses_' || substr(r.proname, 8), (select pg_get_function_identity_arguments(o.oid) from pg_proc o where o.proname = 'fel_ses_' || substr(r.proname, 8) and o.pronamespace = 'public'::regnamespace));
    n := n + 1;
  end loop;
  raise notice 'M-I: % envoltorios fel_ses_* generados', n;
end $$;
