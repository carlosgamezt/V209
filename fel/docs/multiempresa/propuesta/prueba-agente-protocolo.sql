-- Punto 7 · Verificación de las 9 `fel_sys_*` del agente local que `nexa_app` aún ejecuta: autenticación, permisos y alcance empresarial EN LA BASE. Superusuario con `set local role` (nexa_app / nexa_sys); todo se deshace.
-- Parte A (estado actual): lo que la base SÍ impone (agente activo, reloj, nonce, empresa de la orden, token de fencing, SIM-, límite de vinculación) y lo que NO (no verifica firma: con el id de un agente, nexa_app actúa como él).
-- Parte B (con M-P): nexa_app pierde las 9; nexa_sys las conserva. Cada rechazo se comprueba por su mensaje.
\set ON_ERROR_STOP on
begin;
create or replace function pg_temp.espera(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_msg text := null;
begin begin execute p_sql; exception when others then v_msg := sqlerrm; end;
  if v_msg is null then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if;
  if v_msg !~ p_patron then raise exception 'ERROR DISTINTO al esperado /%/: «%» en: %', p_patron, v_msg, p_sql; end if; end $$;
insert into public.agentes_locales (id, empresa_id, nombre, clave_publica) values
  ('a0000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Agente A', repeat('A', 43)),
  ('a0000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'Agente B', repeat('B', 43));
insert into public.agentes_locales (id, empresa_id, nombre, clave_publica, estado, revocado_en) values ('a0000000-0000-0000-0000-0000000000cc', '10000000-0000-0000-0000-00000000000a', 'Agente revocado', repeat('C', 43), 'revocado', now());
-- ===== PARTE A: estado actual (nexa_app) =====
set local role nexa_app;
do $$ declare r text; n int; begin
  select string_agg(p.proname, ',' order by p.proname) into r from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'fel\_sys\_%' and has_function_privilege('nexa_app', p.oid, 'execute');
  assert r = 'fel_sys_agente_autenticar,fel_sys_agente_clave,fel_sys_agente_latido,fel_sys_agente_politica,fel_sys_agente_vincular,fel_sys_orden_progreso,fel_sys_orden_reclamar,fel_sys_orden_resultado,fel_sys_orden_vista_previa', 'nexa_app ejecuta EXACTAMENTE los 9 protocolos del agente y ninguna otra fel_sys_*: ' || coalesce(r, '');
  assert not exists (select 1 from information_schema.role_table_grants where grantee = 'nexa_app' and table_name in ('agentes_locales', 'ordenes_emision', 'agente_nonces', 'codigos_vinculacion')), 'nexa_app sin acceso directo a las tablas del agente';
end $$;
-- lo que la base impone
select pg_temp.espera($$select public.fel_sys_agente_latido('a0000000-0000-0000-0000-0000000000ff', 'x', null)$$, 'FEL_REVOCADO');                    -- id inventado
select pg_temp.espera($$select public.fel_sys_agente_latido('a0000000-0000-0000-0000-0000000000cc', 'x', null)$$, 'FEL_REVOCADO');                    -- agente revocado
select pg_temp.espera($$select public.fel_sys_agente_autenticar('a0000000-0000-0000-0000-0000000000ff', now(), repeat('n', 20))$$, 'FEL_NO_AUTORIZADO');   -- desconocido
select pg_temp.espera($$select public.fel_sys_agente_autenticar('a0000000-0000-0000-0000-0000000000cc', now(), repeat('n', 20))$$, 'FEL_REVOCADO');
do $$ declare j jsonb; begin
  j := public.fel_sys_agente_autenticar('a0000000-0000-0000-0000-00000000000a', now() - interval '1 day', repeat('r', 20)); assert (j ->> 'ok') = 'false' and j ->> 'error' = 'FEL_RELOJ', 'reloj desfasado rechazado y registrado';
  j := public.fel_sys_agente_autenticar('a0000000-0000-0000-0000-00000000000a', now(), repeat('u', 20)); assert (j ->> 'ok') = 'true' and (j ->> 'empresa_id')::uuid = '10000000-0000-0000-0000-00000000000a', 'autentica y devuelve SU empresa';
end $$;
select pg_temp.espera($$select public.fel_sys_agente_autenticar('a0000000-0000-0000-0000-00000000000a', now(), repeat('u', 20))$$, 'FEL_REPETICION');   -- el mismo nonce no sirve dos veces
select pg_temp.espera($$select public.fel_sys_agente_autenticar('a0000000-0000-0000-0000-00000000000a', now(), 'corto')$$, 'FEL_DATOS_INVALIDOS');
-- alcance de empresa: un agente solo opera sobre SU empresa; una orden inexistente/ajena no se toca
select pg_temp.espera($$select public.fel_sys_orden_resultado('a0000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-000000000001', 1, 'emitido_simulado', 'A', '1', 'SIM-1', null)$$, 'FEL_EMPRESA');
select pg_temp.espera($$select public.fel_sys_orden_resultado('a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000001', 1, 'real', 'A', '1', 'X', null)$$, 'FEL_DATOS_INVALIDOS');   -- solo resultados simulados/descartes/errores
select pg_temp.espera($$select public.fel_sys_orden_progreso('a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000001', 1, 'cualquiera')$$, 'FEL_DATOS_INVALIDOS');
do $$ begin assert public.fel_sys_orden_reclamar('a0000000-0000-0000-0000-00000000000a') is null, 'sin órdenes de SU empresa no recibe nada (la cola es por empresa del agente)'; end $$;
-- la clave pública y estado de un agente por su id: solo esos tres campos (sin secretos)
do $$ declare j jsonb; begin j := public.fel_sys_agente_clave('a0000000-0000-0000-0000-00000000000a'); assert (select array_agg(k order by k) from jsonb_object_keys(j) k) = array['clave_publica', 'empresa_id', 'estado'], 'solo clave pública, empresa y estado'; end $$;
-- vinculación (M-Q): el límite es POR ORIGEN; un origen que agota sus intentos NO bloquea a los demás (antes: 20 fallos globales bloqueaban a todas las empresas)
do $$ declare i int; j jsonb; begin
  for i in 1 .. 10 loop j := public.fel_sys_agente_vincular('CODIGO-' || i, repeat('K', 43), 'X', '1', 'origen-atacante'); assert j ->> 'error' = 'FEL_CODIGO', 'código inexistente: error sin excepción'; end loop; end $$;
select pg_temp.espera($$select public.fel_sys_agente_vincular('CODIGO-11', repeat('K', 43), 'X', '1', 'origen-atacante')$$, 'FEL_LIMITE.*este origen');
do $$ declare j jsonb; begin j := public.fel_sys_agente_vincular('CODIGO-LEGIT', repeat('K', 43), 'X', '1', 'origen-legitimo'); assert j ->> 'error' = 'FEL_CODIGO', 'otro origen NO queda bloqueado por el atacante (responde FEL_CODIGO, no FEL_LIMITE)'; end $$;
-- el cortacircuitos global solo salta con volumen alto (parámetro) y entonces afecta a todos, con mensaje propio
do $$ begin update public.plataforma_parametros set valor = 11 where clave = 'agente_vinculacion_max_global'; end $$;
select pg_temp.espera($$select public.fel_sys_agente_vincular('CODIGO-LEGIT-2', repeat('K', 43), 'X', '1', 'origen-nuevo')$$, 'FEL_LIMITE.*temporalmente limitada');
do $$ begin update public.plataforma_parametros set valor = 1000 where clave = 'agente_vinculacion_max_global'; end $$;
-- una vinculación VÁLIDA con la clave correcta funciona aun con otros orígenes limitados (no consume fallos)
-- límite por agente: solo ese agente se limita (conteo por nonces del último minuto)
do $$ declare i int; begin
  update public.plataforma_parametros set valor = 4 where clave = 'agente_max_peticiones_min';
  for i in 1 .. 3 loop perform public.fel_sys_agente_autenticar('a0000000-0000-0000-0000-00000000000a', now(), 'nonce-limite-agente-' || i); end loop; end $$;
select pg_temp.espera($$select public.fel_sys_agente_autenticar('a0000000-0000-0000-0000-00000000000a', now(), 'nonce-limite-agente-4')$$, 'FEL_LIMITE.*este agente');
do $$ declare j jsonb; begin j := public.fel_sys_agente_autenticar('a0000000-0000-0000-0000-00000000000b', now(), 'nonce-agente-b-ok-0001'); assert (j ->> 'ok') = 'true', 'el agente B (otra empresa) NO se ve afectado por el límite del agente A';
  update public.plataforma_parametros set valor = 120 where clave = 'agente_max_peticiones_min'; end $$;
-- LO QUE LA BASE NO IMPONE (hallazgo, medido): con solo el id del agente, sin firma, nexa_app actúa como ese agente
do $$ declare j jsonb; begin
  j := public.fel_sys_agente_latido('a0000000-0000-0000-0000-00000000000a', 'x-sin-firma', null); assert j ->> 'estado' = 'activo', 'latido SIN FIRMA aceptado con solo el id del agente';
end $$;
reset role;
do $$ begin assert (select count(*) from public.agentes_locales where id = 'a0000000-0000-0000-0000-00000000000a' and version = 'x-sin-firma') = 1, 'el latido sin firma modificó al agente (medido como administrador)'; end $$;
-- ===== PARTE B: con M-P =====
\ir M-P_agente_nivel_sistema.sql
set local role nexa_app;
select pg_temp.espera($$select public.fel_sys_agente_latido('a0000000-0000-0000-0000-00000000000a', 'x', null)$$, 'permission denied');
select pg_temp.espera($$select public.fel_sys_agente_autenticar('a0000000-0000-0000-0000-00000000000a', now(), repeat('z', 20))$$, 'permission denied');
select pg_temp.espera($$select public.fel_sys_agente_clave('a0000000-0000-0000-0000-00000000000a')$$, 'permission denied');
select pg_temp.espera($$select public.fel_sys_agente_politica('a0000000-0000-0000-0000-00000000000a')$$, 'permission denied');
select pg_temp.espera($$select public.fel_sys_agente_vincular('X', repeat('K', 43), 'X', '1')$$, 'permission denied');
select pg_temp.espera($$select public.fel_sys_orden_reclamar('a0000000-0000-0000-0000-00000000000a')$$, 'permission denied');
select pg_temp.espera($$select public.fel_sys_orden_progreso('a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000001', 1, 'llenando')$$, 'permission denied');
select pg_temp.espera($$select public.fel_sys_orden_resultado('a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000001', 1, 'descartado', null, null, null, null)$$, 'permission denied');
select pg_temp.espera($$select public.fel_sys_orden_vista_previa('a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000001', 1, '{}', repeat('a', 64))$$, 'permission denied');
reset role; set local role nexa_sys;
do $$ declare j jsonb; begin j := public.fel_sys_agente_latido('a0000000-0000-0000-0000-00000000000a', 'desde-sys', null); assert j ->> 'estado' = 'activo', 'nexa_sys conserva el protocolo del agente'; end $$;
reset role;
do $$ declare r text; begin select string_agg(p.proname, ',') into r from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'fel\_sys\_%' and has_function_privilege('nexa_app', p.oid, 'execute'); assert r is null, 'con M-P nexa_app no ejecuta NINGUNA fel_sys_*: ' || coalesce(r, ''); end $$;
select 'AGENTE ESTADO: abierto en nexa_app (la base no verifica la firma del agente: basta su id); cerrado con M-P (solo nexa_sys)';
select 'PRUEBAS DE PROTOCOLO DEL AGENTE OK';
rollback;
