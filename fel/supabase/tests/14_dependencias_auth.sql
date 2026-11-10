-- Dependencia del esquema INTERNO de Auth (auth.users, auth.mfa_factors, auth.sessions): compatibilidad, privilegios y fallos parciales.
-- Las partes que exigen alterar tablas de Auth se omiten (con aviso) si el rol de pruebas no es su propietario (p. ej. Supabase real).
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_ok boolean := false;
begin
  begin execute p_sql; exception when others then v_ok := (sqlerrm ~ p_patron) or (sqlstate ~ p_patron); end;
  if not v_ok then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if;
end $$;

-- ================= la comprobación de compatibilidad pasa con el esquema actual, y la API de service_role puede llamarla
do $$ declare r record; n int := 0; begin
  for r in select * from public.fel_verificar_dependencias_auth() loop
    n := n + 1; assert r.ok, 'dependencia de Auth no satisfecha: ' || r.comprobacion || ' (' || r.detalle || ')';
  end loop;
  assert n >= 14, 'la comprobación devolvió muy pocas filas: ' || n;
  assert has_function_privilege('service_role', 'public.fel_verificar_dependencias_auth()', 'EXECUTE'), 'service_role no puede verificar dependencias';
  assert not has_function_privilege('authenticated', 'public.fel_verificar_dependencias_auth()', 'EXECUTE'), 'authenticated verifica dependencias';
  assert not has_function_privilege('anon', 'public.fel_verificar_dependencias_auth()', 'EXECUTE'), 'anon verifica dependencias';
end $$;

-- ================= la comprobación DETECTA un cambio de esquema (se simula y se revierte en una subtransacción)
do $$ declare v_ok boolean := true; v_prop boolean; begin
  select (pg_get_userbyid(c.relowner) = current_user) into v_prop from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'auth' and c.relname = 'mfa_factors';
  if not coalesce(v_prop, false) then raise notice 'OMITIDO: el rol de pruebas no es propietario de auth.mfa_factors'; return; end if;
  begin
    alter table auth.mfa_factors rename column user_id to uid_renombrada;
    select ok into v_ok from public.fel_verificar_dependencias_auth() where comprobacion = 'auth.mfa_factors.user_id existe';
    raise exception 'revertir';
  exception when raise_exception then null; end;
  assert v_ok = false, 'la comprobación no detectó una columna ausente en auth.mfa_factors';
end $$;

-- ================= datos
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000b1', 'prop@fel.test', now()), ('00000000-0000-0000-0000-0000000000b2', 'emisor@fel.test', now());
insert into public.perfiles (user_id) select id from auth.users;
insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at)
select gen_random_uuid(), id, 'totp', 'verified', now(), now() from auth.users;
insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id, estado)
select '10000000-0000-0000-0000-00000000000a', 'A', 'A S.A.', '1111111-1', id, 'habilitada' from public.regimenes_fiscales where codigo = 'general';
insert into public.miembros (empresa_id, user_id, rol) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b1', 'propietario'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b2', 'emisor');
insert into auth.sessions (id, user_id) values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000b2'), (gen_random_uuid(), '00000000-0000-0000-0000-0000000000b2');
create temp table t_sol as select public.fel_op_mfa_recuperacion_solicitar('00000000-0000-0000-0000-0000000000b2', 'Perdí el dispositivo con la aplicación de códigos') as id;

-- ================= fallo al LEER mfa_factors al aprobar (esquema cambiado): la aprobación falla ENTERA, sin marca ni estado a medias
do $$ declare v_err text; v_prop boolean; begin
  select (pg_get_userbyid(c.relowner) = current_user) into v_prop from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'auth' and c.relname = 'mfa_factors';
  if not coalesce(v_prop, false) then raise notice 'OMITIDO: el rol de pruebas no es propietario de auth.mfa_factors'; return; end if;
  begin
    alter table auth.mfa_factors rename column factor_type to tipo_renombrado;
    perform public.fel_op_mfa_recuperacion_aprobar('00000000-0000-0000-0000-0000000000b1', (select id from t_sol), 'Videollamada con documento en mano; confirmé identidad y cargo');
  exception when others then v_err := sqlerrm; end;
  assert v_err is not null, 'la aprobación no falló con un esquema incompatible';
  assert (select estado from public.solicitudes_recuperacion_mfa where id = (select id from t_sol)) = 'pendiente', 'la solicitud quedó a medias';
  assert not exists (select 1 from public.revocaciones_sesion), 'se fijó una marca de revocación pese al fallo';
  assert (select count(*) from auth.sessions where user_id = '00000000-0000-0000-0000-0000000000b2') = 2, 'se borraron sesiones pese al fallo';
end $$;

-- ================= fallo al BORRAR sesiones (privilegios/esquema): la aprobación sigue adelante, la marca protege y el fallo queda registrado y visible
create function public.fel_prueba_falla_borrado() returns trigger language plpgsql as $$ begin raise exception 'borrado de sesiones no permitido (simulado)'; end $$;
do $$ declare v_prop boolean; r jsonb; begin
  select (pg_get_userbyid(c.relowner) = current_user) into v_prop from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'auth' and c.relname = 'sessions';
  if not coalesce(v_prop, false) then raise notice 'OMITIDO: el rol de pruebas no es propietario de auth.sessions'; return; end if;
  create trigger fel_prueba_sin_borrar before delete on auth.sessions for each row execute function public.fel_prueba_falla_borrado();
  r := public.fel_op_mfa_recuperacion_aprobar('00000000-0000-0000-0000-0000000000b1', (select id from t_sol), 'Videollamada con documento en mano; confirmé identidad y cargo');
  assert (r ->> 'sesiones_auth_borradas')::int = -1, 'debía informar que NO se pudieron borrar las sesiones: ' || r::text;
  assert (select estado from public.solicitudes_recuperacion_mfa where id = (select id from t_sol)) = 'aprobada', 'la aprobación debía seguir adelante';
  assert exists (select 1 from public.revocaciones_sesion where user_id = '00000000-0000-0000-0000-0000000000b2'), 'sin marca de revocación: nada protegería la API ni la RLS';
  assert (select count(*) from auth.sessions where user_id = '00000000-0000-0000-0000-0000000000b2') = 2, 'las sesiones debían seguir (el borrado falló)';
  assert exists (select 1 from public.auditoria where accion = 'plataforma.mfa_recuperacion_aprobada' and (datos ->> 'sesiones_auth_borradas')::int = -1), 'el fallo del borrado no quedó en la auditoría';
  drop trigger fel_prueba_sin_borrar on auth.sessions;
  -- un reintento no vuelve a borrar ni a mover la marca, y no repite el aviso (sesiones_auth_borradas nulo)
  r := public.fel_op_mfa_recuperacion_aprobar('00000000-0000-0000-0000-0000000000b1', (select id from t_sol), null);
  assert (r ->> 'sesiones_auth_borradas') is null, 'el reintento no debe repetir el borrado de sesiones';
end $$;
drop function if exists public.fel_prueba_falla_borrado();

rollback;
\echo 'OK 14_dependencias_auth'
