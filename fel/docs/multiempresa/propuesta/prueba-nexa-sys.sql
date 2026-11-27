-- R2 · F4: pruebas COMO nexa_sys (conexión real). El rol de sistema solo ejecuta `fel_sys_*`, no ve tablas ni esquemas ajenos y no puede asumir otro rol. Todo dentro de una transacción que se deshace.
\set ON_ERROR_STOP on
begin;
create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_ok boolean := false;
begin begin execute p_sql; exception when others then v_ok := (sqlerrm ~ p_patron) or (sqlstate ~ p_patron); end;
  if not v_ok then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if; end $$;
do $$ declare r pg_roles; n_sys int; n_todas int; begin
  select * into r from pg_roles where rolname = current_user;
  assert current_user = 'nexa_sys' and not r.rolsuper and not r.rolbypassrls and not r.rolcreaterole and not r.rolcreatedb and not r.rolreplication and not r.rolinherit, 'nexa_sys: sin super, BYPASSRLS, CREATEROLE, CREATEDB, replicación ni herencia';
  assert not exists (select 1 from pg_auth_members m join pg_roles x on x.oid = m.member where x.rolname = 'nexa_sys'), 'nexa_sys no es miembro de ningún rol';
  -- solo fel_sys_*: la cuenta de funciones ejecutables es EXACTAMENTE la de las fel_sys_*
  select count(*) filter (where p.proname like 'fel\_sys\_%'), count(*) into n_sys, n_todas from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype and has_function_privilege('nexa_sys', p.oid, 'execute');
  assert n_sys = n_todas and n_sys >= 45, 'nexa_sys ejecuta SOLO fel_sys_* (' || n_sys || ' de ' || n_todas || ')';
  assert not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname ~ '^fel_(ses|pla|adm|op|admin)_|^fel_(auditar|aud_acceso)$' and has_function_privilege('nexa_sys', p.oid, 'execute')), 'nexa_sys no ejecuta funciones de personas, plataforma ni auditoría';
  assert not exists (select 1 from information_schema.role_table_grants where grantee = 'nexa_sys'), 'nexa_sys no tiene ningún privilegio sobre tablas';
  assert not has_schema_privilege('nexa_sys', 'auth', 'usage') and not has_schema_privilege('nexa_sys', 'public', 'create'), 'sin acceso a auth y sin crear objetos';
end $$;
-- lo que SÍ hace: procesos del sistema
do $$ declare x int; begin
  select count(*) into x from public.fel_sys_operaciones_pendientes(15); assert x >= 0;
  select public.fel_sys_ordenes_vencer() into x; assert x >= 0;
  select public.fel_sys_bolson_revisar(15) into x; assert x >= 0;
  select count(*) into x from public.fel_sys_consumos_incoherentes(); select count(*) into x from public.fel_sys_verificar_saldos(); select count(*) into x from public.fel_sys_verificar_monederos();
end $$;
-- lo que NO puede: datos, sesiones, auditoría, personas, otro rol
select pg_temp.espera_error($$select count(*) from public.documentos$$, 'permission denied');
select pg_temp.espera_error($$select count(*) from public.clientes$$, 'permission denied');
select pg_temp.espera_error($$select count(*) from public.demo_sesiones$$, 'permission denied');
select pg_temp.espera_error($$insert into public.demo_sesiones (token_hash, usuario, creada_en, ultima_en) values ('x', 'propa', now(), now())$$, 'permission denied');
select pg_temp.espera_error($$insert into public.auditoria (accion, entidad) values ('x.y', 'z')$$, 'permission denied');
select pg_temp.espera_error($$select * from auth.users$$, 'permission denied');
select pg_temp.espera_error($$create table public.zz_sys (x int)$$, 'permission denied');
select pg_temp.espera_error($$select public.fel_auditar('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 'x.y', 'documento', null, '{}'::jsonb)$$, 'permission denied');
select pg_temp.espera_error($$select public.fel_ses_cliente_guardar('tok-propa-0123456789abcdef', null, 'NIT', '1-1', 'x', null, null, null, null)$$, 'permission denied');
select pg_temp.espera_error($$select * from public.fel_op_miembros_listar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a')$$, 'permission denied');
select pg_temp.espera_error($$set role nexa_app$$, 'permission denied');
select pg_temp.espera_error($$set role postgres$$, 'permission denied');
select 'PRUEBAS DE NEXA_SYS OK';
rollback;
