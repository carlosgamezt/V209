-- NEXA FEL · acceso exclusivo por cuenta de Supabase Auth (UUID): ÚNICO procedimiento oficial de instalación (Supabase de NEXA principal). Se ejecuta A MANO en el editor SQL, como «postgres».
-- Crea EXCLUSIVAMENTE la tabla public.nx_fel_cuentas_autorizadas y la función public.nx_fel_autorizado(), registra UNA cuenta (la suya) y verifica permisos.
-- Todo ocurre dentro de UNA sola sentencia (un bloque DO): es atómica. Si cualquier control falla, no queda NADA instalado.
--
-- CÓMO USARLO (dos ejecuciones del mismo script):
--   1) ENSAYO (así viene: v_ensayo = true): reemplace solo el UUID de v_cuenta y ejecute. Debe terminar con un ERROR INTENCIONAL que dice «ENSAYO TERMINADO … todo correcto … se deshizo todo».
--   2) INSTALAR: cambie v_ensayo a false y ejecute de nuevo. Debe terminar sin error y mostrar una tabla de controles con la columna «ok» en true.
--   Después de instalar, BORRE el texto con su UUID del editor (si guarda la consulta, Supabase la conserva en su cuenta). No lo suba al repositorio.
-- Su UUID: Authentication → Users → columna «User UID» de su cuenta. Este archivo del repositorio NO contiene ningún UUID ni correo: solo el marcador PEGA-AQUI-TU-UUID.
--   Si no reemplaza el marcador, el script falla de inmediato («invalid input syntax for type uuid») sin tocar nada.
-- Reversión (solo estos dos objetos, no es una restauración de respaldo):  drop function public.nx_fel_autorizado(); drop table public.nx_fel_cuentas_autorizadas;

do $instalar$
declare
  v_ensayo boolean := true;                      -- true = ensayo (se deshace todo al final) · false = instalar de verdad
  v_cuenta uuid    := 'PEGA-AQUI-TU-UUID';       -- el UUID de SU cuenta (reemplace SOLO este texto, entre comillas)
  v_fallos text;
  v_total  int;
  v_si     boolean;
  v_no     boolean;
  v_den_t  boolean := false;
  v_den_a  boolean := false;
begin
  -- 1. Es el proyecto y el rol correctos (si no, se detiene sin crear nada)
  if current_user <> 'postgres' then raise exception 'PARE: el rol actual es «%», debe ser postgres (editor SQL del panel).', current_user; end if;
  if to_regclass('public.pa_docs') is null or to_regclass('public.pa_profiles') is null
     or not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'pa_next_seq') then
    raise exception 'PARE: no parece el proyecto de NEXA principal (faltan pa_docs, pa_profiles o pa_next_seq).'; end if;
  if to_regclass('public.empresas') is not null then raise exception 'PARE: este proyecto tiene tablas de NEXA FEL (public.empresas): no es NEXA principal.'; end if;
  if (select count(*) from pg_roles where rolname in ('anon','authenticated','service_role','postgres')) <> 4 or to_regclass('auth.users') is null or to_regprocedure('auth.uid()') is null then
    raise exception 'PARE: faltan roles de Supabase o auth.users / auth.uid().'; end if;
  -- 2. Los objetos NO existen todavía (nunca se sobrescribe nada)
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relname ilike 'nx\_fel%')
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname ilike 'nx\_fel%')
     or exists (select 1 from pg_type t where t.typname ilike 'nx\_fel%') then
    raise exception 'PARE: ya existen objetos con nombre nx_fel_*; no se sobrescribe nada. Revíselos antes de continuar.'; end if;
  -- 3. La cuenta existe en Authentication
  if not exists (select 1 from auth.users where id = v_cuenta) then raise exception 'PARE: ese UUID no existe en Authentication → Users.'; end if;

  -- 4. Se crean EXCLUSIVAMENTE los dos objetos
  create table public.nx_fel_cuentas_autorizadas (
    auth_id   uuid primary key references auth.users (id) on delete cascade,
    creado_en timestamptz not null default now()
  );
  comment on table public.nx_fel_cuentas_autorizadas is 'Cuentas de Supabase Auth (UUID) autorizadas a ver el acceso a NEXA FEL. Sin políticas RLS a propósito: solo el propietario puede leerla o escribirla.';
  alter table public.nx_fel_cuentas_autorizadas owner to postgres;
  alter table public.nx_fel_cuentas_autorizadas enable row level security;
  revoke all on table public.nx_fel_cuentas_autorizadas from public, anon, authenticated, service_role;

  create function public.nx_fel_autorizado()
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
  as $fn$
    select coalesce(
      (select exists (select 1 from public.nx_fel_cuentas_autorizadas a where a.auth_id = (select auth.uid()))),
      false
    )
  $fn$;
  comment on function public.nx_fel_autorizado() is 'true solo si el UUID de la sesión (auth.uid()) está en nx_fel_cuentas_autorizadas; false en cualquier otro caso. SECURITY DEFINER, search_path vacío.';
  alter function public.nx_fel_autorizado() owner to postgres;
  revoke all on function public.nx_fel_autorizado() from public, anon, authenticated, service_role;
  grant execute on function public.nx_fel_autorizado() to authenticated;

  -- 5. Se registra SOLO su cuenta
  insert into public.nx_fel_cuentas_autorizadas (auth_id) values (v_cuenta);

  -- 6. Controles de propiedades, propietarios y privilegios (cualquier diferencia deshace todo)
  with c as (
    select 'RLS de la tabla' as control, relrowsecurity::text as valor, 'true' as esperado from pg_class where oid = 'public.nx_fel_cuentas_autorizadas'::regclass
    union all select 'FORCE RLS apagado', relforcerowsecurity::text, 'false' from pg_class where oid = 'public.nx_fel_cuentas_autorizadas'::regclass
    union all select 'sin politicas', (select count(*)::text from pg_policy where polrelid = 'public.nx_fel_cuentas_autorizadas'::regclass), '0'
    union all select 'propietario de la tabla', pg_get_userbyid(relowner), 'postgres' from pg_class where oid = 'public.nx_fel_cuentas_autorizadas'::regclass
    union all select 'SECURITY DEFINER', prosecdef::text, 'true' from pg_proc where oid = 'public.nx_fel_autorizado()'::regprocedure
    union all select 'propietario de la funcion', pg_get_userbyid(proowner), 'postgres' from pg_proc where oid = 'public.nx_fel_autorizado()'::regprocedure
    union all select 'search_path vacio', coalesce(proconfig::text, '-'), '{"search_path=\"\""}' from pg_proc where oid = 'public.nx_fel_autorizado()'::regprocedure
    union all select 'devuelve boolean', prorettype::regtype::text, 'boolean' from pg_proc where oid = 'public.nx_fel_autorizado()'::regprocedure
    union all select 'EXECUTE de PUBLIC', (select count(*)::text from aclexplode((select proacl from pg_proc where oid = 'public.nx_fel_autorizado()'::regprocedure)) where grantee = 0), '0'
    union all select 'EXECUTE de ' || r, has_function_privilege(r, 'public.nx_fel_autorizado()', 'execute')::text, case when r = 'authenticated' then 'true' else 'false' end from unnest(array['anon','authenticated','service_role']) r
    union all select r || ' ' || p || ' sobre la tabla', has_table_privilege(r, 'public.nx_fel_cuentas_autorizadas', p)::text, 'false'
      from unnest(array['anon','authenticated','service_role']) r, unnest(array['select','insert','update','delete','truncate','references','trigger']) p
    union all select 'cuentas registradas', (select count(*)::text from public.nx_fel_cuentas_autorizadas), '1'
    union all select 'otros objetos nx_fel_', ((select count(*) from pg_class where relname ilike 'nx\_fel%' and relkind in ('r','v','m','S','f','p')) + (select count(*) from pg_proc where proname ilike 'nx\_fel%'))::text, '2'
  )
  select string_agg(case when valor is distinct from esperado then control end, '; '), count(*) into v_fallos, v_total from c;

  -- 7. Controles funcionales con sesiones simuladas (su cuenta sí, otra no, la tabla no es accesible, anon no ejecuta)
  perform set_config('request.jwt.claim.sub', v_cuenta::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_cuenta, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if auth.uid() is distinct from v_cuenta then reset role; raise exception 'PARE: la simulación de sesión no funciona en este editor (auth.uid() no coincide).'; end if;
  begin v_si := public.nx_fel_autorizado(); exception when others then v_si := null; end;
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  begin v_no := public.nx_fel_autorizado(); exception when others then v_no := null; end;
  begin perform 1 from public.nx_fel_cuentas_autorizadas; exception when insufficient_privilege then v_den_t := true; end;
  reset role;
  set local role anon;
  begin perform public.nx_fel_autorizado(); exception when insufficient_privilege then v_den_a := true; end;
  reset role;
  if v_si is distinct from true then v_fallos := coalesce(v_fallos || '; ', '') || 'su cuenta NO resulta autorizada'; end if;
  if v_no is distinct from false then v_fallos := coalesce(v_fallos || '; ', '') || 'una cuenta cualquiera resulta autorizada'; end if;
  if not v_den_t then v_fallos := coalesce(v_fallos || '; ', '') || 'authenticated puede leer la tabla'; end if;
  if not v_den_a then v_fallos := coalesce(v_fallos || '; ', '') || 'anon puede ejecutar la funcion'; end if;

  if v_fallos is not null then raise exception 'PARE: controles fallidos: [%]. Se deshizo todo; no quedó nada instalado.', v_fallos; end if;
  if v_ensayo then raise exception 'ENSAYO TERMINADO: los % controles de propiedades y las 4 pruebas funcionales son correctos. Se deshizo todo (no quedó nada instalado). Para instalar de verdad cambie v_ensayo a false y ejecute de nuevo.', v_total; end if;
end
$instalar$;

-- Resultado de la instalación real (solo se ejecuta si el bloque anterior terminó bien y v_ensayo = false): todas las filas deben tener ok = true.
select 'tabla y función instaladas' as control, (to_regclass('public.nx_fel_cuentas_autorizadas') is not null and to_regprocedure('public.nx_fel_autorizado()') is not null)::text as valor, 'true' as esperado,
       (to_regclass('public.nx_fel_cuentas_autorizadas') is not null and to_regprocedure('public.nx_fel_autorizado()') is not null) as ok
union all select 'cuentas registradas', (select count(*)::text from public.nx_fel_cuentas_autorizadas), '1', (select count(*) = 1 from public.nx_fel_cuentas_autorizadas)
union all select 'RLS activado', relrowsecurity::text, 'true', relrowsecurity from pg_class where oid = 'public.nx_fel_cuentas_autorizadas'::regclass
union all select 'SECURITY DEFINER con search_path vacío', (prosecdef and coalesce(proconfig::text, '-') = '{"search_path=\"\""}')::text, 'true', (prosecdef and coalesce(proconfig::text, '-') = '{"search_path=\"\""}') from pg_proc where oid = 'public.nx_fel_autorizado()'::regprocedure
union all select 'solo authenticated ejecuta la función', (has_function_privilege('authenticated', 'public.nx_fel_autorizado()', 'execute') and not has_function_privilege('anon', 'public.nx_fel_autorizado()', 'execute') and not has_function_privilege('service_role', 'public.nx_fel_autorizado()', 'execute'))::text, 'true',
       (has_function_privilege('authenticated', 'public.nx_fel_autorizado()', 'execute') and not has_function_privilege('anon', 'public.nx_fel_autorizado()', 'execute') and not has_function_privilege('service_role', 'public.nx_fel_autorizado()', 'execute'));
