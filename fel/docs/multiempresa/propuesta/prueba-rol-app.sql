-- Pruebas de seguridad EJECUTADAS CON EL ROL REAL `nexa_app` (conexión real, no SET ROLE ni identidades simuladas). Se ejecuta con: psql -U nexa_app -f prueba-rol-app.sql
\set ON_ERROR_STOP on
create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_ok boolean := false;
begin
  begin execute p_sql; exception when others then v_ok := (sqlerrm ~ p_patron) or (sqlstate ~ p_patron); end;
  if not v_ok then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if;
end $$;

-- 1) identidad y atributos del rol
do $$ begin
  assert current_user = 'nexa_app' and session_user = 'nexa_app', 'conectado como nexa_app';
  assert (select not rolsuper and not rolbypassrls and not rolcreaterole and not rolcreatedb and not rolreplication and not rolinherit from pg_roles where rolname = 'nexa_app'), 'sin superusuario, sin BYPASSRLS, sin crear roles ni bases, sin herencia';
  assert not exists (select 1 from pg_auth_members m join pg_roles r on r.oid = m.member where r.rolname = 'nexa_app'), 'no es miembro de ningún rol';
  assert not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relowner = (select oid from pg_roles where rolname = 'nexa_app')), 'no es propietario de ninguna tabla ni vista';
  assert not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proowner = (select oid from pg_roles where rolname = 'nexa_app')), 'no es propietario de ninguna función';
  assert not has_schema_privilege('nexa_app', 'public', 'create'), 'no puede crear objetos en public';
  assert not has_schema_privilege('nexa_app', 'auth', 'usage') and (not exists (select 1 from pg_namespace where nspname = 'vault') or not has_schema_privilege('nexa_app', 'vault', 'usage')), 'no ve auth ni vault';
end $$;

-- 2) no puede cambiar el esquema ni escalar privilegios
select pg_temp.espera_error($$create table public.intruso (x int)$$, 'permission denied|42501');
select pg_temp.espera_error($$alter table public.documentos disable trigger all$$, 'must be owner|42501');
select pg_temp.espera_error($$alter table public.documentos disable row level security$$, 'must be owner|42501');
select pg_temp.espera_error($$drop table public.documentos$$, 'must be owner|42501');
select pg_temp.espera_error($$drop function public.fel_tiene_permiso(uuid, text)$$, 'must be owner|42501');
select pg_temp.espera_error($$create policy intruso on public.documentos for select to nexa_app using (true)$$, 'must be owner|42501');
select pg_temp.espera_error($$set role postgres$$, 'permission denied|42501');
select pg_temp.espera_error($$set role service_role$$, 'permission denied|42501');
select pg_temp.espera_error($$set role authenticated$$, 'permission denied|42501');
select pg_temp.espera_error($$set session authorization postgres$$, 'permission denied|42501');
select pg_temp.espera_error($$alter role nexa_app bypassrls$$, 'permission denied|42501');
grant insert on public.documentos to nexa_app;   -- PostgreSQL solo avisa («no privileges were granted»): lo que importa es que NO se concede
do $$ begin assert not has_table_privilege('nexa_app', 'public.documentos', 'insert'), 'no puede darse privilegios a sí mismo'; end $$;
select pg_temp.espera_error($$create extension pgcrypto$$, 'permission denied|42501|already exists');
select pg_temp.espera_error($$truncate public.documentos$$, 'permission denied|42501');

-- 3) tablas protegidas: nada directo, ni siquiera lectura (solo por funciones)
select pg_temp.espera_error($$select * from public.empresa_digifact_config$$, 'permission denied|42501');
select pg_temp.espera_error($$select credencial_cifrada from public.empresa_digifact_config$$, 'permission denied|42501');
select pg_temp.espera_error($$update public.empresa_digifact_config set certificar = true$$, 'permission denied|42501');
select pg_temp.espera_error($$select * from public.empresa_emisor_versiones$$, 'permission denied|42501');
select pg_temp.espera_error($$select * from public.empresa_digifact_eventos$$, 'permission denied|42501');
select pg_temp.espera_error($$insert into public.empresa_digifact_eventos (empresa_id, tipo) values (gen_random_uuid(), 'probar')$$, 'permission denied|42501');
select pg_temp.espera_error($$select * from public.acceso_maestro_datos$$, 'permission denied|42501');
select pg_temp.espera_error($$select * from public.v_empresa_digifact_estado$$, 'permission denied|42501');
select pg_temp.espera_error($$select * from auth.users$$, 'permission denied|42501');
select pg_temp.espera_error($$select * from vault.decrypted_secrets$$, 'permission denied|schema "vault" does not exist|does not exist|42501|42P01');

-- 4) tablas de la aplicación: solo los privilegios mínimos
do $$ begin
  assert has_table_privilege('nexa_app', 'public.documentos', 'select'), 'lee documentos';
  assert not has_table_privilege('nexa_app', 'public.documentos', 'insert') and not has_table_privilege('nexa_app', 'public.documentos', 'update') and not has_table_privilege('nexa_app', 'public.documentos', 'delete'), 'NO escribe documentos directamente (solo por funciones)';
  assert not has_table_privilege('nexa_app', 'public.clientes', 'insert') and not has_table_privilege('nexa_app', 'public.clientes', 'update') and not has_table_privilege('nexa_app', 'public.clientes', 'delete'), 'NO escribe clientes directamente';
  assert not has_table_privilege('nexa_app', 'public.empresas', 'insert') and not has_table_privilege('nexa_app', 'public.empresas', 'update') and not has_table_privilege('nexa_app', 'public.empresas', 'delete'), 'NO crea ni borra empresas directamente';
  assert not has_table_privilege('nexa_app', 'public.plataforma_admins', 'insert'), 'NO se agrega maestros';
  assert has_table_privilege('nexa_app', 'public.digifact_operaciones', 'insert') and has_table_privilege('nexa_app', 'public.digifact_operaciones', 'update') and not has_table_privilege('nexa_app', 'public.digifact_operaciones', 'delete'), 'operaciones: insertar y actualizar, jamás borrar';
  assert not has_table_privilege('nexa_app', 'public.auditoria', 'insert') and not has_table_privilege('nexa_app', 'public.auditoria', 'update') and not has_table_privilege('nexa_app', 'public.auditoria', 'delete'), 'la auditoría solo se escribe por fel_auditar';
end $$;
select pg_temp.espera_error($$update public.documentos set estado_fiscal = 'certificado'$$, 'permission denied|42501');
select pg_temp.espera_error($$delete from public.operaciones_fiscales$$, 'permission denied|42501');
select pg_temp.espera_error($$insert into public.empresas (nombre_comercial) values ('x')$$, 'permission denied|42501');
select pg_temp.espera_error($$delete from public.digifact_operaciones$$, 'permission denied|42501');
select pg_temp.espera_error($$update public.auditoria set accion = 'x'$$, 'permission denied|42501');

-- 5) funciones: solo las que el código usa; las de administración global y de arranque, no
do $$ begin
  assert has_function_privilege('nexa_app', 'public.fel_auditar(uuid, uuid, text, text, text, jsonb, text)', 'execute'), 'usa fel_auditar';
  assert has_function_privilege('nexa_app', 'public.fel_adm_digifact_conectar(text, text, bytea, smallint, integer)', 'execute'), 'usa las funciones de sesión validada';
  assert not has_function_privilege('nexa_app', 'public.fel_op_digifact_conectar(uuid, uuid, text, bytea, smallint, integer)', 'execute') and not has_function_privilege('nexa_app', 'public.fel_op_asignacion_guardar(uuid, uuid, uuid, uuid, boolean, text)', 'execute') and not has_function_privilege('nexa_app', 'public.fel_admin_acceso_solicitar(uuid, uuid, text, text, uuid, integer)', 'execute'), 'NO ejecuta las funciones internas con actor y empresa como parámetros';
  assert has_function_privilege('nexa_app', 'public.fel_sys_digifact_credencial(uuid)', 'execute'), 'el resolvedor lee la credencial por la función';
  assert not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('fel_bootstrap_primer_maestro','fel_agregar_maestro_adicional','fel_admin_maestro_autorizar','fel_admin_maestro_revocar_autorizacion','fel_admin_regimen_crear_version','fel_admin_regimen_verificar','fel_admin_regla_crear_version','fel_admin_regla_verificar','fel_admin_emision','fel__borrar_sesiones_auth','fel_admin_identificacion_verificar') and has_function_privilege('nexa_app', p.oid, 'execute')), 'sin funciones de arranque ni de administración global';
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prorettype <> 'trigger'::regtype and p.prokind = 'f' and has_function_privilege('nexa_app', p.oid, 'execute')) = 105, 'exactamente las 105 funciones previstas';
end $$;
select pg_temp.espera_error($$select public.fel_bootstrap_primer_maestro('00000000-0000-0000-0000-000000000001')$$, 'permission denied|42501|does not exist');
select pg_temp.espera_error($$select public.fel_agregar_maestro_adicional('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')$$, 'permission denied|42501|does not exist');

-- 6) RLS: el rol no omite RLS; solo ve lo que su política declara; una tabla nueva sin política sería invisible (falla cerrado)
do $$ begin
  assert (select count(*) from pg_policies where schemaname = 'public' and roles = '{nexa_app}') >= 51, 'políticas explícitas por tabla';
  assert not exists (select 1 from pg_policies where schemaname = 'public' and roles = '{nexa_app}' and tablename in ('empresa_digifact_config','empresa_emisor_versiones','empresa_digifact_eventos','acceso_maestro_datos')), 'ninguna política sobre las tablas protegidas';
end $$;
select 'PRUEBAS DEL ROL nexa_app OK' as resultado;
