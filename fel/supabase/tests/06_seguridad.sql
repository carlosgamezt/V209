-- Cuenta activa, administrador maestro activo, interruptor de emisión a nivel de base de datos y limitador de peticiones.
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_ok boolean := false;
begin
  begin execute p_sql; exception when others then v_ok := (sqlerrm ~ p_patron) or (sqlstate ~ p_patron); end;
  if not v_ok then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'maestro@fel.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'prop@fel.test');
insert into public.perfiles (user_id) select id from auth.users;
insert into public.plataforma_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1');

-- ================= cuenta activa / maestro activo (las usa la API en cada petición)
do $$ begin
  assert public.fel_usuario_activo('00000000-0000-0000-0000-0000000000b1'), 'con perfil activo debe estar activa';
  assert public.fel_es_plataforma('00000000-0000-0000-0000-0000000000a1'), 'maestro activo debe serlo';
  assert not public.fel_es_plataforma('00000000-0000-0000-0000-0000000000b1'), 'un usuario común no es maestro';
  assert not public.fel_usuario_activo(null), 'nulo no es activo';
  assert not public.fel_es_plataforma(null), 'nulo no es maestro';
end $$;
update public.perfiles set activo = false where user_id = '00000000-0000-0000-0000-0000000000a1';
do $$ begin
  assert not public.fel_usuario_activo('00000000-0000-0000-0000-0000000000a1'), 'perfil bloqueado sigue activo';
  assert not public.fel_es_plataforma('00000000-0000-0000-0000-0000000000a1'), 'maestro bloqueado sigue siendo maestro';
end $$;
-- ninguna operación administrativa pasa con el maestro bloqueado
select pg_temp.espera_error($$select public.fel_admin_empresa_crear('00000000-0000-0000-0000-0000000000a1', 'X', 'X S.A.', '1111111-1', (select id from public.regimenes_fiscales limit 1))$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_admin_regimen_crear_version('00000000-0000-0000-0000-0000000000a1', 'general', 'X', '{}', null, null)$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_admin_emision('00000000-0000-0000-0000-0000000000a1', gen_random_uuid(), false, 'Motivo válido')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_admin_regla_crear_version('00000000-0000-0000-0000-0000000000a1', 'anulacion_dte', 'X', '{}', null, null)$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_admin_identificacion_verificar('00000000-0000-0000-0000-0000000000a1', 'NIT', null, 'Fuente de prueba', 'Motivo válido')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_admin_invitar_propietario('00000000-0000-0000-0000-0000000000a1', gen_random_uuid(), 'x@fel.test')$$, 'FEL_NO_AUTORIZADO');
rollback;
begin;
-- (el rollback devuelve la base a su estado; se repiten los datos mínimos para lo que sigue)
create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_ok boolean := false;
begin
  begin execute p_sql; exception when others then v_ok := (sqlerrm ~ p_patron) or (sqlstate ~ p_patron); end;
  if not v_ok then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if;
end $$;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'maestro@fel.test');
insert into public.perfiles (user_id) values ('00000000-0000-0000-0000-0000000000a1');
insert into public.plataforma_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1');

-- ================= interruptor de emisión real a nivel de base de datos
do $$ begin
  assert not public.fel__emision_real_disponible(), 'el interruptor global debe nacer APAGADO';
  assert not exists (select 1 from public.empresas where emision_real_habilitada), 'no debe haber empresas con emisión real';
end $$;
-- preparar una empresa 100% elegible (habilitada, régimen verificado, autorizada) y comprobar que IGUAL se bloquea
insert into public.regimenes_fiscales (codigo, version, nombre, reglas, fuente, vigente_desde)
values ('prueba_reg', 1, 'Prueba', '{"esquema":1,"impuestos":[],"precios_incluyen_impuesto":false,"redondeo":{"modo":"x"}}', 'Referencia de prueba', current_date);
update public.regimenes_fiscales set estado = 'verificado', verificado_por = '00000000-0000-0000-0000-0000000000a1', verificado_en = now() where codigo = 'prueba_reg';
insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id, estado)
select '10000000-0000-0000-0000-00000000000a', 'A', 'A S.A.', '1111111-1', id, 'habilitada' from public.regimenes_fiscales where codigo = 'prueba_reg';
select pg_temp.espera_error($$select public.fel_admin_emision('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', true, 'Intento con interruptor apagado')$$, 'FEL_EMISION_BLOQUEADA');
select pg_temp.espera_error($$update public.empresas set emision_real_habilitada = true, emision_autorizada_por = '00000000-0000-0000-0000-0000000000a1', emision_autorizada_en = now() where id = '10000000-0000-0000-0000-00000000000a'$$, 'FEL_EMISION_BLOQUEADA');
select pg_temp.espera_error($$insert into public.empresas (nombre_comercial, razon_social, nit, regimen_id, estado, emision_real_habilitada, emision_autorizada_por, emision_autorizada_en) select 'B','B S.A.','2222222-2', id, 'habilitada', true, '00000000-0000-0000-0000-0000000000a1', now() from public.regimenes_fiscales where codigo = 'prueba_reg'$$, 'FEL_EMISION_BLOQUEADA');
do $$ begin assert not exists (select 1 from public.empresas where emision_real_habilitada), 'quedó una empresa con emisión real'; end $$;
-- ni service_role ni authenticated pueden abrir el interruptor ni leerlo
do $$ declare r text; begin
  foreach r in array array['service_role','authenticated','anon'] loop
    assert not has_table_privilege(r, 'public.plataforma_config', 'SELECT,INSERT,UPDATE,DELETE'), r || ' accede a plataforma_config';
    assert not has_table_privilege(r, 'public.limites_peticiones', 'SELECT,INSERT,UPDATE,DELETE'), r || ' accede a limites_peticiones';
  end loop;
  assert not has_function_privilege('authenticated', 'public.fel_limite_consumir(text,integer,integer)', 'EXECUTE'), 'authenticated usa el limitador';
  assert not has_function_privilege('anon', 'public.fel_es_plataforma(uuid)', 'EXECUTE'), 'anon consulta maestros';
  assert has_function_privilege('service_role', 'public.fel_limite_consumir(text,integer,integer)', 'EXECUTE'), 'service_role no usa el limitador';
end $$;
-- cambiar el interruptor queda auditado y no se puede borrar
update public.plataforma_config set valor = true where clave = 'emision_real_disponible';
do $$ begin assert exists (select 1 from public.auditoria where accion = 'plataforma.config_cambiada' and datos ->> 'despues' = 'true'), 'cambio sin auditar'; end $$;
select pg_temp.espera_error($$delete from public.plataforma_config$$, 'FEL_REGLA');
update public.plataforma_config set valor = false where clave = 'emision_real_disponible';
-- con el interruptor apagado, las operaciones fiscales se bloquean aunque una empresa conserve el indicador (defensa en profundidad)
update public.plataforma_config set valor = true where clave = 'emision_real_disponible';
select public.fel_admin_emision('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', true, 'Habilitada solo para esta prueba');
update public.plataforma_config set valor = false where clave = 'emision_real_disponible';
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b1', 'prop@fel.test');
insert into public.perfiles (user_id) values ('00000000-0000-0000-0000-0000000000b1');
insert into public.miembros (empresa_id, user_id, rol) values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b1', 'propietario');
select pg_temp.espera_error($$select public.fel_op_certificacion_iniciar('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'clave-0000000000001', repeat('a',64), 'p')$$, 'FEL_EMISION_BLOQUEADA');
select pg_temp.espera_error($$select public.fel_op_anulacion_iniciar('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'anul-00000000000001', repeat('a',64), 'Motivo válido', 'p')$$, 'FEL_EMISION_BLOQUEADA');

-- ================= limitador de peticiones
do $$ declare r record; i int; permitidas int := 0; denegadas int := 0; ret int; begin
  for i in 1..7 loop
    select * into r from public.fel_limite_consumir('prueba:a', 60, 5);
    if r.permitido then permitidas := permitidas + 1; else denegadas := denegadas + 1; ret := r.reintentar_en; end if;
  end loop;
  assert permitidas = 5 and denegadas = 2, 'debían ser 5 permitidas y 2 denegadas: ' || permitidas || '/' || denegadas;
  assert ret between 1 and 60, 'reintentar_en fuera de rango: ' || ret;
  -- las denegadas no incrementan el contador
  assert (select contador from public.limites_peticiones where clave = 'prueba:a') = 5, 'el contador creció con peticiones denegadas';
  -- claves distintas son independientes
  assert (select permitido from public.fel_limite_consumir('prueba:b', 60, 5)), 'otra clave debía tener su propio cupo';
  -- misma clave con otra ventana = otra cubeta
  assert (select permitido from public.fel_limite_consumir('prueba:a', 3600, 5)), 'otra ventana debía tener su propio cupo';
end $$;
-- expiración: al cambiar la ventana el cupo se renueva (se simula una ventana pasada llena y se consulta la actual)
insert into public.limites_peticiones (clave, ventana_inicio, contador) values ('prueba:c', now() - interval '3 days', 5);
do $$ begin assert (select permitido from public.fel_limite_consumir('prueba:c', 60, 5)), 'una ventana vieja no debe bloquear la actual'; end $$;
select pg_temp.espera_error($$select * from public.fel_limite_consumir('', 60, 5)$$, 'FEL_REGLA');
select pg_temp.espera_error($$select * from public.fel_limite_consumir('x', 0, 5)$$, 'FEL_REGLA');
select pg_temp.espera_error($$select * from public.fel_limite_consumir('x', 60, 0)$$, 'FEL_REGLA');

rollback;
\echo 'OK 06_seguridad'
