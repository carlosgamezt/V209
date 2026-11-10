-- Privilegios de ejecución (catálogo completo) y suplantación en la aceptación de invitaciones.
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_ok boolean := false;
begin
  begin execute p_sql; exception when others then v_ok := (sqlerrm ~ p_patron) or (sqlstate ~ p_patron); end;
  if not v_ok then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if;
end $$;

-- ================= catálogo: qué funciones de public puede ejecutar cada rol
-- PUBLIC (grantee 0) y anon: ninguna. authenticated: solo las 3 que usan las políticas RLS. service_role: todas las fel_*, salvo el bootstrap.
do $$ declare f record; publicas text[]; anon_ text[]; auth_ text[]; faltan text[]; bootstrap boolean; begin
  select coalesce(array_agg(p.proname::text order by p.proname), '{}') into publicas
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE');
  assert publicas = '{}', 'funciones ejecutables por PUBLIC: ' || publicas::text;
  select coalesce(array_agg(p.proname::text order by p.proname), '{}') into anon_
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  assert anon_ = '{}', 'funciones ejecutables por anon: ' || anon_::text;
  select coalesce(array_agg(p.proname::text order by p.proname), '{}') into auth_
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and has_function_privilege('authenticated', p.oid, 'EXECUTE');
  assert auth_ = array['fel_es_admin_plataforma', 'fel_es_miembro', 'fel_tiene_permiso'], 'funciones ejecutables por authenticated: ' || auth_::text;
  select coalesce(array_agg(p.proname::text order by p.proname), '{}') into faltan
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'fel\_%' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
     and p.proname not in ('fel_bootstrap_primer_maestro', 'fel_agregar_maestro_adicional', 'fel__validar_candidato_maestro', 'fel__puede_resolver_mfa', 'fel_registrar_recuperacion_manual', 'fel__rango')
     and not has_function_privilege('service_role', p.oid, 'EXECUTE');
  assert faltan = '{}', 'funciones que service_role no puede ejecutar: ' || faltan::text;
  assert not has_function_privilege('service_role', 'public.fel_bootstrap_primer_maestro(text)', 'EXECUTE'), 'service_role puede crear maestros';
  assert not has_function_privilege('service_role', 'public.fel_agregar_maestro_adicional(text)', 'EXECUTE'), 'service_role puede agregar maestros';
  assert not has_function_privilege('service_role', 'public.fel__puede_resolver_mfa(uuid,uuid)', 'EXECUTE'), 'service_role consulta resolutores';
  assert not has_function_privilege('service_role', 'public.fel_registrar_recuperacion_manual(text,text)', 'EXECUTE'), 'service_role registra recuperaciones manuales';
end $$;

-- ================= las funciones de escritura no se pueden invocar con los roles de la app (error de privilegios real)
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'atacante@fel.test', now()),
  ('00000000-0000-0000-0000-0000000000b1', 'victima@fel.test', now()),
  ('00000000-0000-0000-0000-0000000000c1', 'sinconfirmar@fel.test', null);
insert into public.perfiles (user_id) values ('00000000-0000-0000-0000-0000000000a1');
insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id, estado)
select '10000000-0000-0000-0000-00000000000a', 'A', 'A S.A.', '1111111-1', id, 'habilitada' from public.regimenes_fiscales where codigo = 'general';
insert into public.invitaciones (empresa_id, email, rol, estado, expira_en) values
  ('10000000-0000-0000-0000-00000000000a', 'victima@fel.test', 'administrador', 'pendiente', now() + interval '3 days'),
  ('10000000-0000-0000-0000-00000000000a', 'sinconfirmar@fel.test', 'lector', 'pendiente', now() + interval '3 days');

do $$ declare r text; q text; begin
  foreach r in array array['anon', 'authenticated'] loop
    execute format('set local role %I', r);
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
    foreach q in array array[
      $q$select public.fel_op_invitacion_aceptar('00000000-0000-0000-0000-0000000000b1', 'victima@fel.test')$q$,
      $q$select public.fel_op_invitacion_aceptar('00000000-0000-0000-0000-0000000000a1', 'victima@fel.test')$q$,
      $q$select public.fel_estado_cuenta('00000000-0000-0000-0000-0000000000a1')$q$,
      $q$select public.fel_es_plataforma('00000000-0000-0000-0000-0000000000a1')$q$,
      $q$select public.fel_bootstrap_primer_maestro('atacante@fel.test')$q$,
      $q$select public.fel_agregar_maestro_adicional('atacante@fel.test')$q$,
      $q$select public.fel_admin_maestro_autorizar('00000000-0000-0000-0000-0000000000a1', 'x@fel.test', 'motivo de prueba largo')$q$,
      $q$select public.fel_op_miembros_listar('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a')$q$,
      $q$select public.fel_op_mfa_recuperacion_aprobar('00000000-0000-0000-0000-0000000000a1', gen_random_uuid(), 'verificación de prueba muy larga')$q$,
      $q$select public.fel_op_mfa_recuperacion_solicitar('00000000-0000-0000-0000-0000000000a1', 'motivo de prueba largo')$q$,
      $q$select public.fel_limite_consumir('x', 60, 5)$q$] loop
      begin execute q; raise exception 'SE EJECUTÓ como %: %', r, q;
      exception when insufficient_privilege then null; end;
    end loop;
    reset role;
  end loop;
end $$;
-- service_role tampoco puede crear maestros
set local role service_role;
select pg_temp.espera_error($$select public.fel_bootstrap_primer_maestro('atacante@fel.test')$$, '42501');
select pg_temp.espera_error($$select public.fel_agregar_maestro_adicional('atacante@fel.test')$$, '42501');
reset role;

-- ================= suplantación: la identidad sale de Auth, no del llamador
-- el atacante (cuenta propia, sin perfil confirmado de la víctima) intenta usar la invitación de la víctima con SU id y el correo de la víctima
select pg_temp.espera_error($$select public.fel_op_invitacion_aceptar('00000000-0000-0000-0000-0000000000a1', 'victima@fel.test')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_invitacion_aceptar('00000000-0000-0000-0000-0000000000a1', 'VICTIMA@fel.test')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_invitacion_aceptar('00000000-0000-0000-0000-0000000000a1', ' victima@fel.test ')$$, 'FEL_NO_AUTORIZADO');
-- correo de la víctima con el id de la víctima pero llamado con el correo del atacante
select pg_temp.espera_error($$select public.fel_op_invitacion_aceptar('00000000-0000-0000-0000-0000000000b1', 'atacante@fel.test')$$, 'FEL_NO_AUTORIZADO');
-- cuenta con correo sin confirmar no usa su invitación
select pg_temp.espera_error($$select public.fel_op_invitacion_aceptar('00000000-0000-0000-0000-0000000000c1', 'sinconfirmar@fel.test')$$, 'FEL_NO_AUTORIZADO');
do $$ begin
  assert (select estado from public.invitaciones where email = 'victima@fel.test') = 'pendiente', 'se consumió la invitación de la víctima';
  assert not exists (select 1 from public.miembros), 'se creó una membresía por suplantación';
  assert not exists (select 1 from public.perfiles where user_id in ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1')), 'se creó un perfil por suplantación';
  assert not public.fel_usuario_activo('00000000-0000-0000-0000-0000000000b1'), 'la víctima sigue sin perfil hasta que ella misma acepte';
end $$;
-- la víctima legítima sí puede, y obtiene solo SU invitación
do $$ begin
  assert public.fel_op_invitacion_aceptar('00000000-0000-0000-0000-0000000000b1', 'Victima@Fel.Test') = 1;
  assert (select rol from public.miembros where user_id = '00000000-0000-0000-0000-0000000000b1') = 'administrador';
  assert not exists (select 1 from public.miembros where user_id = '00000000-0000-0000-0000-0000000000a1'), 'el atacante recibió membresía';
end $$;

rollback;
\echo 'OK 08_privilegios'
