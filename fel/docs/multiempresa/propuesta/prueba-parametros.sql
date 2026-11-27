-- Parámetros de plataforma por clase (M-R), imitando a PostgREST (rol `authenticated`/`anon` + claims). Todo en una transacción que se deshace; cada rechazo se comprueba por su EFECTO (lista sin esa clave) o por su mensaje.
\set ON_ERROR_STOP on
begin;
create or replace function pg_temp.como(p_uid text, p_sesion text, p_aal text default 'aal1') returns void language plpgsql as $$
begin perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', p_sesion, 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true); end $$;
create or replace function pg_temp.claves(p_ctx text default 'usuario') returns text language sql as $$ select coalesce(string_agg(x ->> 'clave', ',' order by x ->> 'clave'), '') from jsonb_array_elements(coalesce(public.fel__parametros_lista(p_ctx), '[]'::jsonb)) x $$;
create or replace function pg_temp.espera(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_msg text := null;
begin begin execute p_sql; exception when others then v_msg := sqlerrm; end;
  if v_msg is null then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if;
  if v_msg !~ p_patron then raise exception 'ERROR DISTINTO al esperado /%/: «%» en: %', p_patron, v_msg, p_sql; end if; end $$;
insert into auth.sessions (id, user_id, aal) values
  ('96000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c2', 'aal1'), ('96000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'aal1'), ('96000000-0100-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'aal2');
-- 1) clasificación completa: TODO parámetro existente tiene clase; la lista de «usuario» es exactamente la de la interfaz
do $$ declare r text; begin
  select string_agg(clave, ',') into r from public.plataforma_parametros where public.fel__parametro_clase(clave) is null; assert r is null, 'parámetros sin clasificar: ' || coalesce(r, '');
  assert (select string_agg(clave, ',' order by clave) from public.plataforma_parametros where public.fel__parametro_clase(clave) = 'usuario') = 'espera_conciliacion_manual_min,umbral_recuperacion_min,ventana_auditoria_min,ventana_tardia_min', 'clase usuario = la que muestra la interfaz';
  assert (select count(*) from public.plataforma_parametros where public.fel__parametro_clase(clave) = 'interno') = 6, '6 internos';
  assert (select string_agg(clave, ',' order by clave) from public.plataforma_parametros where public.fel__parametro_clase(clave) = 'interno') = 'agente_max_peticiones_min,agente_reloj_max_seg,agente_vinculacion_max_global,agente_vinculacion_max_origen,mfa_operaciones_sensibles,plataforma_mfa_obligatoria', 'internos = umbrales de defensa y MFA';
end $$;
-- 2) persona de una empresa (lector): SOLO la clase usuario; ningún contexto superior le amplía nada
select pg_temp.como('00000000-0000-0000-0000-0000000000c2', '96000000-0000-0000-0000-0000000000c2');
do $$ declare u text := 'espera_conciliacion_manual_min,umbral_recuperacion_min,ventana_auditoria_min,ventana_tardia_min'; begin
  assert pg_temp.claves() = u, 'sin argumento: solo usuario'; assert pg_temp.claves('usuario') = u;
  assert pg_temp.claves('empresa') = u, 'lector sin permisos: contexto empresa no le da nada más';
  assert pg_temp.claves('plataforma') = u, 'no es administrador: contexto plataforma no le da nada más';
  assert pg_temp.claves('interno') = u and pg_temp.claves('xyz') = u and pg_temp.claves(null) = u, 'contexto desconocido = usuario (nunca más)';
  assert pg_temp.claves() !~ 'mfa|agente_|vinculacion|reloj|peticiones', 'ningún umbral de defensa ni de agente';
end $$;
-- 3) permisos efectivos: un permiso EXTRA habilita su parámetro de empresa; uno REVOCADO lo quita; solo en SU empresa
select pg_temp.como('00000000-0000-0000-0000-0000000000a1', '96000000-0000-0000-0000-0000000000a1'); select set_config('role', 'postgres', true);
update public.miembros set permisos_extra = array['empresa.editar'] where user_id = '00000000-0000-0000-0000-0000000000c2';
select pg_temp.como('00000000-0000-0000-0000-0000000000c2', '96000000-0000-0000-0000-0000000000c2');
do $$ begin assert pg_temp.claves('empresa') like '%establecimiento_por_usuario%' and pg_temp.claves('empresa') !~ 'agente_', 'empresa.editar habilita solo establecimiento_por_usuario'; assert pg_temp.claves() !~ 'establecimiento_por_usuario', 'en contexto usuario no aparece'; end $$;
select set_config('role', 'postgres', true); update public.miembros set permisos_extra = array['agentes.administrar'] where user_id = '00000000-0000-0000-0000-0000000000c2';
select pg_temp.como('00000000-0000-0000-0000-0000000000c2', '96000000-0000-0000-0000-0000000000c2');
do $$ begin assert pg_temp.claves('empresa') ~ 'agente_codigo_min' and pg_temp.claves('empresa') ~ 'agente_latido_max_seg' and pg_temp.claves('empresa') !~ 'establecimiento_por_usuario', 'agentes.administrar habilita los dos de agentes'; end $$;
select set_config('role', 'postgres', true); update public.miembros set permisos_extra = array['empresa.editar'], permisos_revocados = array['empresa.editar'] where user_id = '00000000-0000-0000-0000-0000000000c2';
select pg_temp.como('00000000-0000-0000-0000-0000000000c2', '96000000-0000-0000-0000-0000000000c2');
do $$ begin assert pg_temp.claves('empresa') !~ 'establecimiento_por_usuario', 'permiso revocado: no lo ve'; end $$;
select set_config('role', 'postgres', true); update public.miembros set permisos_extra = '{}', permisos_revocados = '{}' where user_id = '00000000-0000-0000-0000-0000000000c2';
-- 4) administrador de la plataforma: exige MFA REAL (aal2 en token y sesión); con aal1 solo recibe la clase usuario. Con aal2: usuario + empresa + plataforma, JAMÁS interno
select pg_temp.como('00000000-0000-0000-0000-0000000000a1', '96000000-0000-0000-0000-0000000000a1', 'aal1');
do $$ begin assert pg_temp.claves('plataforma') !~ 'agente_version|establecimiento_por_usuario', 'administrador SIN aal2: no recibe plataforma ni empresa'; end $$;
select pg_temp.como('00000000-0000-0000-0000-0000000000a1', '96000000-0000-0000-0000-0000000000a1', 'aal2');   -- el token dice aal2 pero la sesión guardada es aal1
do $$ begin assert pg_temp.claves('plataforma') !~ 'agente_version', 'aal2 solo en el token: no vale'; end $$;
select pg_temp.como('00000000-0000-0000-0000-0000000000a1', '96000000-0100-0000-0000-0000000000a1', 'aal2');
do $$ begin
  assert pg_temp.claves('plataforma') ~ 'agente_version_minima' and pg_temp.claves('plataforma') ~ 'establecimiento_por_usuario' and pg_temp.claves('plataforma') ~ 'espera_conciliacion_manual_min', 'administrador con aal2: las tres clases, devolvió: ' || pg_temp.claves('plataforma');
  assert pg_temp.claves('plataforma') !~ 'mfa|vinculacion|reloj|peticiones', 'ni siquiera el administrador recibe los umbrales de defensa';
  assert pg_temp.claves('usuario') !~ 'agente_', 'en contexto usuario, solo usuario'; assert pg_temp.claves('empresa') !~ 'agente_version', 'en contexto empresa un administrador sin empresa no recibe lo de plataforma';
end $$;
-- 5) un parámetro NUEVO sin clasificar no sale a nadie (fallo cerrado), ni al administrador
select set_config('role', 'postgres', true); insert into public.plataforma_parametros (clave, valor, descripcion) values ('zz_nuevo_secreto', 7, 'prueba');
select pg_temp.como('00000000-0000-0000-0000-0000000000a1', '96000000-0100-0000-0000-0000000000a1', 'aal2');
do $$ begin assert pg_temp.claves('plataforma') !~ 'zz_nuevo', 'sin clasificar: no se entrega'; end $$;
-- 6) sin sesión viva: nada (null); anónimo: sin privilegio; la tabla sigue sin SELECT para authenticated
select set_config('role', 'postgres', true); delete from auth.sessions where id = '96000000-0100-0000-0000-0000000000a1';
select pg_temp.como('00000000-0000-0000-0000-0000000000a1', '96000000-0100-0000-0000-0000000000a1', 'aal2');
do $$ begin assert public.fel__parametros_lista('plataforma') is null, 'sesión cerrada: null'; end $$;
select set_config('role', 'anon', true); select pg_temp.espera($$select public.fel__parametros_lista()$$, 'permission denied');
select set_config('role', 'postgres', true);
do $$ begin assert not has_table_privilege('authenticated', 'public.plataforma_parametros', 'select'), 'authenticated no lee la tabla'; assert not has_function_privilege('anon', 'public.fel__parametros_lista(text)', 'execute'); end $$;
select 'PRUEBAS DE PARÁMETROS POR CLASE OK';
rollback;
