-- M-K · R2, fase F4 (PROPUESTA; fuera de supabase/migrations; NO se aplica sin autorización). Requiere M-G (fel__sesion_empresa, fel__sesion_maestro) y M-I.
-- Separa el PODER DEL SISTEMA del de la aplicación. Las 45 funciones `fel_sys_*` no reciben actor, pero 24 reciben una EMPRESA: una conexión comprometida de la aplicación podría operar sobre cualquier empresa (R2·C4).
-- 1) Rol `nexa_sys`: credencial PROPIA, sin tablas, sin esquemas ajenos, solo EXECUTE sobre las `fel_sys_*` (procesos sin persona: supervisor, vencimientos, verificaciones de saldos, alertas).
-- 2) Envoltorios `fel_ses_sys_X(p_sesion, …)` para las `fel_sys_*` que reciben `p_empresa` y se usan DENTRO de una petición (máquina de estados de certificación, cobertura, artefactos, credencial y emisor): la empresa sale de la sesión.
-- 3) M-E (última) retira de `nexa_app` toda `fel_sys_*` salvo las 9 de los protocolos de máquina del agente local (se autentican dentro de la función con su propia clave/firma) y le concede los envoltorios.
-- La contraseña de nexa_sys se asigna FUERA del repositorio. El poder de nexa_sys sigue siendo grande sobre las operaciones del sistema: su secreto vive solo en la función interna de sistema (`nexa-sys`), nunca en la función de cara al usuario.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'nexa_sys') then
    create role nexa_sys nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end $$;
grant usage on schema public to nexa_sys;
revoke all on all tables in schema public from nexa_sys;
revoke all on all functions in schema public from nexa_sys;
revoke all on all sequences in schema public from nexa_sys;

do $$
declare r record; v_args text; v_call text; v_ret text; v_body text; n int := 0; i int; v_nombre text;
begin
  for r in select p.oid, p.proname, p.proretset, p.proargnames, p.proargmodes, pg_get_function_arguments(p.oid) as args
             from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname = 'public' and p.prokind = 'f' and p.proname like 'fel\_sys\_%' and p.proname <> 'fel_sys_ordenes_vencer' and pg_get_function_arguments(p.oid) like 'p\_empresa uuid%' order by p.proname loop
    v_nombre := 'fel_ses_sys_' || substr(r.proname, 9);
    v_args := regexp_replace(r.args, '^p_empresa uuid(, )?', '');
    v_call := 'p_empresa := e';
    for i in 2 .. array_length(r.proargnames, 1) loop
      if r.proargmodes is null or r.proargmodes[i] in ('i', 'b', 'v') then v_call := v_call || format(', %I := %I', r.proargnames[i], r.proargnames[i]); end if;
    end loop;
    v_ret := pg_get_function_result(r.oid);
    if v_ret = 'void' then v_body := format('perform public.%I(%s);', r.proname, v_call);
    elsif r.proretset then v_body := format('return query select * from public.%I(%s);', r.proname, v_call);
    else v_body := format('return public.%I(%s);', r.proname, v_call); end if;
    execute format($fn$create or replace function public.%I(p_sesion text%s) returns %s%s language plpgsql security definer set search_path = '' as $body$
      declare e uuid;
      begin select o_empresa into e from public.fel__sesion_empresa(p_sesion); %s end $body$ $fn$,
      v_nombre, case when v_args = '' then '' else ', ' || v_args end, '', v_ret, v_body);
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', v_nombre, (select pg_get_function_identity_arguments(o.oid) from pg_proc o where o.proname = v_nombre and o.pronamespace = 'public'::regnamespace));
    n := n + 1;
  end loop;
  raise notice 'M-K: % envoltorios fel_ses_sys_* generados', n;
end $$;

-- sin identidad en la firma pero con efecto sobre datos de una empresa o de la plataforma: se exige sesión
create or replace function public.fel_ses_sys_bolson_cuenta_simulada(p_sesion text, p_proveedor text default 'digifact') returns uuid
language plpgsql security definer set search_path = '' as $$
declare e uuid;
begin select o_empresa into e from public.fel__sesion_empresa(p_sesion); return public.fel_sys_bolson_cuenta_simulada(p_proveedor); end $$;
create or replace function public.fel_pla_sys_bolson_revisar(p_sesion text, p_umbral_min integer default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare u uuid;
begin select o_user into u from public.fel__sesion_maestro(p_sesion); return public.fel_sys_bolson_revisar(p_umbral_min); end $$;
-- verificaciones de saldos del panel de la plataforma (solo lectura; devuelven únicamente si cada fila es correcta)
create or replace function public.fel_pla_sys_verificar_saldos(p_sesion text) returns table (ok boolean)
language plpgsql security definer set search_path = '' as $$
declare u uuid;
begin select o_user into u from public.fel__sesion_maestro(p_sesion); return query select v.ok from public.fel_sys_verificar_saldos() v; end $$;
create or replace function public.fel_pla_sys_verificar_monederos(p_sesion text) returns table (ok boolean)
language plpgsql security definer set search_path = '' as $$
declare u uuid;
begin select o_user into u from public.fel__sesion_maestro(p_sesion); return query select v.ok from public.fel_sys_verificar_monederos() v; end $$;
revoke all on function public.fel_ses_sys_bolson_cuenta_simulada(text, text), public.fel_pla_sys_bolson_revisar(text, integer), public.fel_pla_sys_verificar_saldos(text), public.fel_pla_sys_verificar_monederos(text) from public, anon, authenticated;

-- nexa_sys: SOLO las fel_sys_* (ningún envoltorio, ninguna función de personas, ninguna tabla)
do $$ declare r record; begin
  for r in select p.oid::regprocedure as f from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'fel\_sys\_%' loop
    execute format('grant execute on function %s to nexa_sys', r.f);
  end loop;
end $$;
