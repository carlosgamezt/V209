-- R2 · F1-F3: pruebas COMO nexa_app de los envoltorios `fel_ses_*` (M-I), `fel_pla_*` y la auditoría acotada (M-J) con sesiones validadas. Todo dentro de una transacción que se deshace. Datos: fixture-sesion.sql.
\set ON_ERROR_STOP on
begin;
create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_ok boolean := false;
begin begin execute p_sql; exception when others then v_ok := (sqlerrm ~ p_patron) or (sqlstate ~ p_patron); end;
  if not v_ok then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if; end $$;
create temp table k (u text primary key, tok text);
insert into k values ('propa', 'tok-propa-0123456789abcdef'), ('maestro2', 'tok-maestro2-0123456789abcdef'), ('admina', 'tok-admina-0123456789abcdef'), ('facta', 'tok-facta-0123456789abcdef'), ('lectora', 'tok-lectora-0123456789abcdef'), ('bajaa', 'tok-bajaa-0123456789abcdef'),
  ('propb', 'tok-propb-0123456789abcdef'), ('factbemp', 'tok-factbemp-0123456789abcdef'), ('vencida', 'tok-vencida-0123456789abcdef'), ('maestro', 'tok-maestro-0123456789abcdef');
create or replace function pg_temp.t(p_u text) returns text language sql as $$ select tok from k where u = p_u $$;
-- 1) GENÉRICO: TODOS los envoltorios rechazan un token inventado, nulo, corto, el hash guardado, una sesión vencida, una cuenta desactivada y la sesión de la plataforma, ANTES de hacer nada
do $$ declare r record; v_args text; n int := 0; t text; begin
  for r in select p.oid, p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'fel\_ses\_%' or p.proname like 'fel\_pla\_%') and p.proname <> 'fel_ses_auditar' order by 1 loop
    select string_agg(format('null::%s', format_type(ty, null)), ', ') into v_args from unnest((select proargtypes::oid[] from pg_proc where oid = r.oid)) with ordinality as x(ty, o) where o > 1;
    foreach t in array case when r.proname like 'fel\_pla\_%' then array['tok-inexistente-0123456789abcdef', 'corto', encode(sha256(convert_to(pg_temp.t('maestro'), 'UTF8')), 'hex'), pg_temp.t('vencida'), pg_temp.t('bajaa'), pg_temp.t('propa'), pg_temp.t('admina'), pg_temp.t('facta')]
                                else array['tok-inexistente-0123456789abcdef', 'corto', encode(sha256(convert_to(pg_temp.t('facta'), 'UTF8')), 'hex'), pg_temp.t('vencida'), pg_temp.t('bajaa'), pg_temp.t('maestro')] end loop
      begin execute format('select public.%I(%L%s)', r.proname, t, case when v_args is null then '' else ', ' || v_args end); raise exception 'SIN_RECHAZO %', r.proname;
      exception when others then if sqlerrm like 'SIN_RECHAZO%' then raise; end if; if sqlerrm !~ 'sesión no válida|FEL_NO_AUTORIZADO|sesión|plataforma' then raise exception '% con token % devolvió otro error: %', r.proname, left(t, 12), sqlerrm; end if; end;
    end loop;
    begin execute format('select public.%I(null%s)', r.proname, case when v_args is null then '' else ', ' || v_args end); raise exception 'SIN_RECHAZO_NULO %', r.proname;
    exception when others then if sqlerrm like 'SIN_RECHAZO%' then raise; end if; end;
    n := n + 1;
  end loop;
  assert n >= 60, 'se probaron todos los envoltorios de empresa y de plataforma (' || n || ')';
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
-- 4) F2 · plataforma: solo la sesión de PLATAFORMA actúa; una sesión de empresa (incluida la propietaria) no
do $$ declare n int; begin
  select count(*) into n from public.fel_pla_mfa_recuperacion_listar(pg_temp.t('maestro')); assert n >= 0, 'la plataforma lista con su sesión';
  select count(*) into n from public.fel_pla_mfa_recuperacion_listar(pg_temp.t('maestro2')); assert n >= 0, 'la otra persona de plataforma también';
end $$;
select pg_temp.espera_error($$select * from public.fel_pla_mfa_recuperacion_listar(pg_temp.t('propa'))$$, 'plataforma');
select pg_temp.espera_error($$select * from public.fel_pla_mfa_recuperacion_listar(pg_temp.t('admina'))$$, 'plataforma');
select pg_temp.espera_error($$select * from public.fel_ses_miembros_listar(pg_temp.t('maestro'))$$, 'empresa|plataforma|FEL_');   -- y la plataforma no entra por la puerta de empresa
-- 5) F3 · auditoría acotada: la firma la sesión; lista cerrada de acciones; nunca las de seguridad, administración o sesión
do $$ declare v bigint; a record; begin
  v := public.fel_ses_auditar(pg_temp.t('facta'), 'documento.prueba_f3', 'documento', 'doc-prueba', '{"nota":"ok"}'::jsonb);
  select actor_user_id, empresa_id, origen into a from public.auditoria where id = v;
  assert a.actor_user_id = '00000000-0000-0000-0000-0000000000c3' and a.empresa_id = '10000000-0000-0000-0000-00000000000a' and a.origen = 'fel-api', 'la entrada quedó a nombre de LA SESIÓN (facta, empresa A)';
  v := public.fel_ses_auditar(pg_temp.t('propb'), 'documento.prueba_f3', 'documento', 'doc-prueba-b', '{}'::jsonb, 'fel-correo');
  select actor_user_id, empresa_id into a from public.auditoria where id = v; assert a.empresa_id = '10000000-0000-0000-0000-00000000000b', 'la sesión de B firma en B (misma llamada, otra empresa)';
  -- eventos de acceso: la base resuelve a la persona por su usuario
  v := public.fel_aud_acceso('inicio_fallido', 'facta', '{"ip":"x"}'::jsonb); select actor_user_id, empresa_id, origen, datos into a from public.auditoria where id = v;
  assert a.actor_user_id = '00000000-0000-0000-0000-0000000000c3' and a.origen = 'acceso' and (a.datos ->> 'existe') = 'true', 'acceso: persona resuelta por la base';
  v := public.fel_aud_acceso('inicio_fallido', 'nadie-existe', '{}'::jsonb); select actor_user_id, datos into a from public.auditoria where id = v; assert a.actor_user_id is null and (a.datos ->> 'existe') = 'false', 'usuario inexistente: sin persona';
end $$;
select pg_temp.espera_error($$select public.fel_ses_auditar(pg_temp.t('facta'), 'usuario.supervisor', 'usuario', 'x')$$, 'no permitida');
select pg_temp.espera_error($$select public.fel_ses_auditar(pg_temp.t('facta'), 'establecimiento.nombre', 'establecimiento', 'x')$$, 'no permitida');
select pg_temp.espera_error($$select public.fel_ses_auditar(pg_temp.t('facta'), 'demo.inicio_correcto', 'sesion', 'x')$$, 'no permitida');
select pg_temp.espera_error($$select public.fel_ses_auditar(pg_temp.t('facta'), 'documento.prueba_f3', 'usuario', 'x')$$, 'entidad');
select pg_temp.espera_error($$select public.fel_ses_auditar(pg_temp.t('facta'), 'documento.prueba_f3', 'documento', 'x', '{}'::jsonb, 'acceso')$$, 'origen');
select pg_temp.espera_error($$select public.fel_ses_auditar('tok-inexistente-0123456789abcdef', 'documento.prueba_f3', 'documento', 'x')$$, 'sesión no válida');
select pg_temp.espera_error($$select public.fel_ses_auditar(pg_temp.t('facta'), 'documento.prueba_f3', 'documento', 'x', '{}'::jsonb, 'fel-api', p_actor => '00000000-0000-0000-0000-0000000000c1')$$, 'p_actor|does not exist|no existe');
select pg_temp.espera_error($$select public.fel_aud_acceso('usuario.supervisor', 'facta')$$, 'no permitido');
select pg_temp.espera_error($$select public.fel_aud_acceso('inicio_correcto', 'facta', '{}'::jsonb, p_actor => '00000000-0000-0000-0000-0000000000c1')$$, 'p_actor|does not exist|no existe');
-- la original ya no es ejecutable por nexa_app
select pg_temp.espera_error($$select public.fel_auditar('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 'x.y', 'documento', null, '{}'::jsonb)$$, 'permission denied|permiso');
select 'PRUEBAS DE ENVOLTORIOS DE SESIÓN OK';
rollback;
