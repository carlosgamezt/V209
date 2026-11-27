-- M-L · R3/F5 (PROPUESTA; fuera de supabase/migrations; NO se aplica sin autorización). Prepara la ruta de la Data API (arquitectura C): lo que la base exige a un JWT de Supabase Auth ANTES de leer datos de una empresa.
-- Las políticas permisivas por permiso y empresa YA existen (migración 3: `fel_tiene_permiso(empresa_id, …)` con `auth.uid()`; M-F: política restrictiva por establecimiento). Aquí se agregan las dos garantías que el JWT por sí solo NO da:
--   · SESIÓN VIVA: el `session_id` del token debe existir en `auth.sessions` y ser del mismo usuario (cerrar sesión o dar de baja = efecto INMEDIATO, sin esperar el `exp` del access token).
--   · MFA REAL: `aal2` solo vale si el token lo dice Y la sesión guardada en la base también (los claims pueden estar desactualizados hasta renovar el token).
-- NO concede ningún privilegio a `authenticated` (hoy no puede leer estas tablas): abrir la lectura por la Data API tabla por tabla es F5-3 y se hace con una migración propia.
-- Se escriben sobre `auth.jwt()` y `auth.sessions`, que son los de Supabase: no dependen de nuestras sesiones propias (`demo_sesiones`), que desaparecen en F5.
create or replace function public.fel__sesion_viva() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.sessions s where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid and s.user_id = auth.uid())
$$;
create or replace function public.fel__aal2() returns boolean language sql stable security definer set search_path = '' as $$
  select (auth.jwt() ->> 'aal') = 'aal2' and exists (select 1 from auth.sessions s where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid and s.user_id = auth.uid() and s.aal::text = 'aal2')
$$;
revoke all on function public.fel__sesion_viva(), public.fel__aal2() from public, anon;
grant execute on function public.fel__sesion_viva(), public.fel__aal2() to authenticated;
-- política RESTRICTIVA de sesión viva en TODA tabla de datos de empresa (con `empresa_id` y RLS activado); se genera desde el catálogo para que ninguna tabla futura quede fuera sin que una prueba lo note
do $$ declare t text; n int := 0; begin
  for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attname = 'empresa_id' and not a.attisdropped
            where s.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity and c.relname not like 'zz\_%' order by 1 loop
    execute format('drop policy if exists sesion_viva on public.%I', t);
    execute format('create policy sesion_viva on public.%I as restrictive for select to authenticated using (public.fel__sesion_viva())', t);
    n := n + 1;
  end loop;
  raise notice 'M-L: política de sesión viva en % tablas', n;
end $$;
