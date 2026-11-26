-- R2 · F1: pruebas COMO nexa_app de los envoltorios `fel_ses_*` (M-I) con sesiones validadas. Todo dentro de una transacción que se deshace. Datos: fixture-sesion.sql.
\set ON_ERROR_STOP on
begin;
create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_ok boolean := false;
begin begin execute p_sql; exception when others then v_ok := (sqlerrm ~ p_patron) or (sqlstate ~ p_patron); end;
  if not v_ok then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if; end $$;
create temp table k (u text primary key, tok text);
insert into k values ('propa', 'tok-propa-0123456789abcdef'), ('admina', 'tok-admina-0123456789abcdef'), ('facta', 'tok-facta-0123456789abcdef'), ('lectora', 'tok-lectora-0123456789abcdef'), ('bajaa', 'tok-bajaa-0123456789abcdef'),
  ('propb', 'tok-propb-0123456789abcdef'), ('factbemp', 'tok-factbemp-0123456789abcdef'), ('vencida', 'tok-vencida-0123456789abcdef'), ('maestro', 'tok-maestro-0123456789abcdef');
create or replace function pg_temp.t(p_u text) returns text language sql as $$ select tok from k where u = p_u $$;
-- 1) GENÉRICO: TODOS los envoltorios rechazan un token inventado, nulo, corto, el hash guardado, una sesión vencida, una cuenta desactivada y la sesión de la plataforma, ANTES de hacer nada
do $$ declare r record; v_args text; n int := 0; t text; begin
  for r in select p.oid, p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'fel\_ses\_%' order by 1 loop
    select string_agg(format('null::%s', format_type(ty, null)), ', ') into v_args from unnest((select proargtypes::oid[] from pg_proc where oid = r.oid)) with ordinality as x(ty, o) where o > 1;
    foreach t in array array['tok-inexistente-0123456789abcdef', 'corto', encode(sha256(convert_to(pg_temp.t('facta'), 'UTF8')), 'hex'), pg_temp.t('vencida'), pg_temp.t('bajaa'), pg_temp.t('maestro')] loop
      begin execute format('select public.%I(%L%s)', r.proname, t, case when v_args is null then '' else ', ' || v_args end); raise exception 'SIN_RECHAZO %', r.proname;
      exception when others then if sqlerrm like 'SIN_RECHAZO%' then raise; end if; if sqlerrm !~ 'sesión no válida|FEL_NO_AUTORIZADO|sesión|plataforma' then raise exception '% con token % devolvió otro error: %', r.proname, left(t, 12), sqlerrm; end if; end;
    end loop;
    begin execute format('select public.%I(null%s)', r.proname, case when v_args is null then '' else ', ' || v_args end); raise exception 'SIN_RECHAZO_NULO %', r.proname;
    exception when others then if sqlerrm like 'SIN_RECHAZO%' then raise; end if; end;
    n := n + 1;
  end loop;
  assert n >= 30, 'se probaron todos los envoltorios (' || n || ')';
end $$;
-- 2) la persona correcta actúa en SU empresa (la empresa no es un parámetro); otra empresa no se toca; los permisos efectivos los decide la base
do $$ declare ca jsonb; cb jsonb; begin
  ca := to_jsonb(public.fel_ses_cliente_guardar(pg_temp.t('facta'), null, 'NIT', '7777771-1', 'Cliente de A', null, null, null, null));
  assert (ca ->> 'empresa_id') = '10000000-0000-0000-0000-00000000000a', 'el cliente quedó en la empresa de la sesión (A)';
  cb := to_jsonb(public.fel_ses_cliente_guardar(pg_temp.t('propb'), null, 'NIT', '7777771-1', 'Cliente de B', null, null, null, null));
  assert (cb ->> 'empresa_id') = '10000000-0000-0000-0000-00000000000b', 'la misma llamada con la sesión de B quedó en B';
  assert (ca ->> 'id') <> (cb ->> 'id'), 'son registros distintos';
end $$;
select pg_temp.espera_error($$select public.fel_ses_cliente_guardar(pg_temp.t('lectora'), null, 'NIT', '7777772-2', 'Sin permiso', null, null, null, null)$$, 'permiso|FEL_');   -- el lector no escribe clientes (permiso efectivo por rol)
do $$ declare l int; begin
  select count(*) into l from public.fel_ses_miembros_listar(pg_temp.t('propa')); assert l >= 5, 'la propietaria de A lista a las personas de A (' || l || ')';
  assert not exists (select 1 from public.fel_ses_miembros_listar(pg_temp.t('propb')) m where m.email like '%facta@%' or m.email like '%admina@%'), 'la propietaria de B no ve a las personas de A';
end $$;
select pg_temp.espera_error($$select * from public.fel_ses_miembros_listar(pg_temp.t('facta'))$$, 'permiso|FEL_');   -- una facturadora no lista usuarios
-- 3) la identidad no se puede enviar: la firma no tiene p_actor ni p_empresa
select pg_temp.espera_error($$select public.fel_ses_cliente_guardar(pg_temp.t('facta'), null, 'NIT', '7777773-3', 'x', null, null, null, null, p_actor => '00000000-0000-0000-0000-0000000000c1')$$, 'p_actor|does not exist|no existe');
select 'PRUEBAS DE ENVOLTORIOS DE SESIÓN OK';
rollback;
