-- Pruebas COMO nexa_app (conexión real) de la administración de establecimientos (M-H): identidad derivada de la sesión, permisos, otra empresa, nombre interno sin tocar el código, supervisión, reasignación con historial.
-- Se ejecuta con: psql -U nexa_app -f prueba-admin-establecimientos.sql (todo dentro de una transacción que se deshace: no deja cambios).
\set ON_ERROR_STOP on
begin;
create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_ok boolean := false;
begin begin execute p_sql; exception when others then v_ok := (sqlerrm ~ p_patron) or (sqlstate ~ p_patron); end;
  if not v_ok then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if; end $$;
create temp table k (u text primary key, tok text);
insert into k values ('propa', 'tok-propa-0123456789abcdef'), ('admina', 'tok-admina-0123456789abcdef'), ('facta', 'tok-facta-0123456789abcdef'), ('factb', 'tok-factb-0123456789abcdef'),
  ('superv', 'tok-superv-0123456789abcdef'), ('lectora', 'tok-lectora-0123456789abcdef'), ('propb', 'tok-propb-0123456789abcdef'), ('factbemp', 'tok-factbemp-0123456789abcdef'), ('maestro', 'tok-maestro-0123456789abcdef');
create or replace function pg_temp.t(p_u text) returns text language sql as $$ select tok from k where u = p_u $$;
create or replace function pg_temp.id(p_n text) returns uuid language sql as $$ select case p_n when 'e10' then e10 when 'e20' then e20 else eb end from public.zz_ids $$;
create or replace function pg_temp.u(p_n text) returns uuid language sql as $$ select ('00000000-0000-0000-0000-0000000000' || p_n)::uuid $$;   -- c3 facta, c5 factb, c6 superv, c2 lectora, c4 admina

-- 1) el administrador ve SUS establecimientos (códigos 2 y 67 con nombre interno) y a SUS personas con su asignación; nada de otra empresa
do $$ declare l jsonb; est jsonb; per jsonb; begin
  l := public.fel_adm_asignaciones_listar(pg_temp.t('admina'));
  est := l -> 'establecimientos'; per := l -> 'personas';
  assert (select array_agg(x ->> 'codigo_sat' order by x ->> 'codigo_sat') from jsonb_array_elements(est) x) = array['2', '67'], 'admina: ve los códigos 2 y 67';
  assert (select x ->> 'nombre' from jsonb_array_elements(est) x where x ->> 'codigo_sat' = '2') = 'Sucursal Principal', 'nombre interno del 2';
  assert (select x ->> 'nombre' from jsonb_array_elements(est) x where x ->> 'codigo_sat' = '67') = 'Sucursal 2', 'nombre interno del 67';
  assert not exists (select 1 from jsonb_array_elements(per) x where x ->> 'usuario' in ('propb', 'factbemp')), 'no ve personas de otra empresa';
  assert (select jsonb_array_length(x -> 'asignaciones') from jsonb_array_elements(per) x where x ->> 'usuario' = 'facta') = 1, 'facta: UN establecimiento';
  assert (select (x ->> 'supervisor')::boolean from jsonb_array_elements(per) x where x ->> 'usuario' = 'superv') and (select jsonb_array_length(x -> 'asignaciones') from jsonb_array_elements(per) x where x ->> 'usuario' = 'superv') = 2, 'superv: supervisor con dos';
  assert not (select (x ->> 'supervisor')::boolean from jsonb_array_elements(per) x where x ->> 'usuario' = 'facta'), 'facta: no es supervisor';
  assert (l ->> 'yo')::uuid = pg_temp.u('c4'), 'la identidad sale de la sesión';
end $$;
-- 2) quien no administra no entra; otra empresa solo ve la suya
select pg_temp.espera_error($$select public.fel_adm_asignaciones_listar(pg_temp.t('facta'))$$, 'permiso|FEL_');
select pg_temp.espera_error($$select public.fel_adm_asignaciones_listar(pg_temp.t('lectora'))$$, 'permiso|FEL_');
select pg_temp.espera_error($$select public.fel_adm_asignaciones_listar(pg_temp.t('maestro'))$$, 'empresa|FEL_');   -- la sesión de la plataforma no administra una empresa
select pg_temp.espera_error($$select public.fel_adm_asignaciones_listar('tok-inexistente-0123456789abcdef')$$, 'sesión no válida');
do $$ declare l jsonb; begin
  l := public.fel_adm_asignaciones_listar(pg_temp.t('propb'));
  assert not exists (select 1 from jsonb_array_elements(l -> 'establecimientos') x where (x ->> 'id')::uuid in (pg_temp.id('e10'), pg_temp.id('e20'))), 'propb no ve los establecimientos de A';
  assert not exists (select 1 from jsonb_array_elements(l -> 'personas') x where x ->> 'usuario' in ('facta', 'factb', 'superv')), 'propb no ve las personas de A';
end $$;
create or replace function pg_temp.lst() returns jsonb language sql as $$ select public.fel_adm_asignaciones_listar(pg_temp.t('admina')) $$;
create or replace function pg_temp.per(p_u text) returns jsonb language sql as $$ select x from jsonb_array_elements(pg_temp.lst() -> 'personas') x where x ->> 'usuario' = p_u $$;
create or replace function pg_temp.est(p_id uuid) returns jsonb language sql as $$ select x from jsonb_array_elements(pg_temp.lst() -> 'establecimientos') x where (x ->> 'id')::uuid = p_id $$;
create or replace function pg_temp.hist(p_accion text, p_persona text) returns jsonb language sql as $$ select h from jsonb_array_elements(pg_temp.lst() -> 'historial') h where h ->> 'accion' = p_accion and (p_persona is null or h ->> 'persona' = p_persona) limit 1 $$;
-- 3) nombre interno: cambia solo el nombre; el código, la dirección y el estado no se tocan; con auditoría; solo con permiso; solo de la propia empresa
do $$ declare x jsonb; begin
  perform public.fel_adm_establecimiento_nombre(pg_temp.t('admina'), pg_temp.id('e20'), 'Sucursal Norte');
  x := pg_temp.est(pg_temp.id('e20'));
  assert x ->> 'nombre' = 'Sucursal Norte' and x ->> 'codigo_sat' = '67' and x ->> 'direccion' = 'Dirección 67' and x ->> 'estado' = 'activo', 'solo cambió el nombre';
  assert (pg_temp.hist('establecimiento.nombre', pg_temp.id('e20')::text) -> 'datos' ->> 'de') = 'Sucursal 2' and (pg_temp.hist('establecimiento.nombre', pg_temp.id('e20')::text) -> 'datos' ->> 'a') = 'Sucursal Norte', 'auditado con el nombre anterior';
  perform public.fel_adm_establecimiento_nombre(pg_temp.t('admina'), pg_temp.id('e20'), 'Sucursal 2');
  assert pg_temp.est(pg_temp.id('e20')) ->> 'nombre' = 'Sucursal 2', 'vuelve a su nombre';
end $$;
select pg_temp.espera_error(format($f$select public.fel_adm_establecimiento_nombre(pg_temp.t('facta'), %L, 'Intento')$f$, pg_temp.id('e10')), 'permiso|FEL_');
select pg_temp.espera_error(format($f$select public.fel_adm_establecimiento_nombre(pg_temp.t('propb'), %L, 'Ajeno')$f$, pg_temp.id('e10')), 'no encontrado|FEL_');   -- otra empresa
select pg_temp.espera_error(format($f$select public.fel_adm_establecimiento_nombre(pg_temp.t('admina'), %L, '   ')$f$, pg_temp.id('e10')), 'entre 1 y 120');
-- 4) reasignación: el facturador se mueve de establecimiento; la asignación anterior queda REVOCADA (no se borra) y el cambio queda auditado
do $$ declare rev0 int; begin
  rev0 := (pg_temp.per('facta') ->> 'revocadas')::int;
  perform public.fel_adm_asignar(pg_temp.t('admina'), pg_temp.u('c3'), pg_temp.id('e20'), true, 'reasignación de prueba');
  assert (pg_temp.per('facta') ->> 'revocadas')::int = rev0 + 1, 'la asignación anterior sigue existiendo (revocada)';
  assert jsonb_array_length(pg_temp.per('facta') -> 'asignaciones') = 1 and (pg_temp.per('facta') -> 'asignaciones' -> 0 ->> 'establecimiento_id')::uuid = pg_temp.id('e20'), 'ahora solo el 67';
  assert (public.fel_adm_contexto(pg_temp.t('facta')) ->> 'establecimiento_activo')::uuid = pg_temp.id('e20'), 'su contexto cambió a la nueva asignación';
  assert (pg_temp.hist('usuario.establecimiento', pg_temp.u('c3')::text) -> 'datos' ->> 'anterior')::uuid = pg_temp.id('e10'), 'el historial muestra el establecimiento anterior';
end $$;
select pg_temp.espera_error(format($f$select public.fel_adm_asignar(pg_temp.t('facta'), %L, %L, true, 'x')$f$, pg_temp.u('c5'), pg_temp.id('e10')), 'permiso|FEL_');   -- un facturador no reasigna a nadie
select pg_temp.espera_error(format($f$select public.fel_adm_asignar(pg_temp.t('propb'), %L, %L, true, 'x')$f$, pg_temp.u('c3'), pg_temp.id('e10')), 'miembro|establecimiento no válido|FEL_');   -- otra empresa
-- 5) supervisión: solo con «usuarios.gestionar», con motivo, nunca a uno mismo ni a un lector; al retirarla queda UN solo establecimiento
do $$ declare rev0 int; begin
  perform public.fel_adm_supervisor(pg_temp.t('admina'), pg_temp.u('c3'), true, 'supervisa las dos sucursales');
  assert (pg_temp.per('facta') ->> 'supervisor')::boolean, 'facta ahora es supervisora';
  perform public.fel_adm_asignar(pg_temp.t('admina'), pg_temp.u('c3'), pg_temp.id('e10'), false, 'segunda sucursal');
  assert jsonb_array_length(pg_temp.per('facta') -> 'asignaciones') = 2, 'con supervisión se agrega, no reemplaza';
  assert (public.fel_adm_contexto(pg_temp.t('facta')) -> 'alcance' ->> 'multiples') = 'true', 'su contexto lo refleja';
  rev0 := (pg_temp.per('facta') ->> 'revocadas')::int;
  perform public.fel_adm_supervisor(pg_temp.t('admina'), pg_temp.u('c3'), false, 'ya no supervisa');
  assert not (pg_temp.per('facta') ->> 'supervisor')::boolean, 'retirada';
  assert jsonb_array_length(pg_temp.per('facta') -> 'asignaciones') = 1 and (pg_temp.per('facta') ->> 'revocadas')::int = rev0 + 1, 'vuelve a UN solo establecimiento y nada se borró';
  assert (public.fel_adm_contexto(pg_temp.t('facta')) -> 'alcance' ->> 'multiples') = 'false', 'su contexto vuelve a ser el de un facturador';
  assert (pg_temp.hist('usuario.supervisor', pg_temp.u('c3')::text) -> 'datos' ->> 'valor') = 'false', 'auditoría de la retirada';
end $$;
select pg_temp.espera_error(format($f$select public.fel_adm_supervisor(pg_temp.t('facta'), %L, true, 'me lo doy')$f$, pg_temp.u('c5')), 'permiso|FEL_');   -- un facturador no concede supervisión
select pg_temp.espera_error(format($f$select public.fel_adm_supervisor(pg_temp.t('admina'), %L, true, 'me lo doy yo')$f$, pg_temp.u('c4')), 'propio');
select pg_temp.espera_error(format($f$select public.fel_adm_supervisor(pg_temp.t('admina'), %L, true, 'a una lectora')$f$, pg_temp.u('c2')), 'lector');
select pg_temp.espera_error(format($f$select public.fel_adm_supervisor(pg_temp.t('admina'), %L, true, 'ya')$f$, pg_temp.u('c5')), 'motivo');
select pg_temp.espera_error(format($f$select public.fel_adm_supervisor(pg_temp.t('propb'), %L, true, 'otra empresa distinta')$f$, pg_temp.u('c5')), 'miembro|FEL_');   -- otra empresa
select pg_temp.espera_error(format($f$select public.fel_adm_supervisor(pg_temp.t('admina'), %L, true, 'al propietario')$f$, pg_temp.u('c1')), 'propietario');
-- 6) ninguna de las funciones nuevas recibe persona o empresa como parámetro (la identidad no es manipulable) y nexa_app no ejecuta las internas
do $$ begin
  assert not exists (select 1 from pg_proc p where p.proname in ('fel_adm_asignaciones_listar', 'fel_adm_establecimiento_nombre', 'fel_adm_supervisor') and pg_get_function_arguments(p.oid) ~ 'p_actor|p_empresa|p_user\M'), 'sin parámetros de identidad';
  assert not has_function_privilege('nexa_app', 'public.fel_op_asignacion_guardar(uuid, uuid, uuid, uuid, boolean, text)', 'execute'), 'nexa_app no ejecuta la función interna';
end $$;
select 'PRUEBAS DE ADMINISTRACIÓN DE ESTABLECIMIENTOS OK';
rollback;
