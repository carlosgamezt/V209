-- Aislamiento entre empresas y entre roles, con RLS real (rol authenticated + claims JWT).
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'maestro@fel.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'propA@fel.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'lectorA@fel.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'emisorA@fel.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'propB@fel.test'),
  ('00000000-0000-0000-0000-0000000000e1', 'sinempresa@fel.test');
insert into public.plataforma_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1');

insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id, estado)
select e.id, e.n, e.n || ' S.A.', e.nit, r.id, 'habilitada'
  from (values ('10000000-0000-0000-0000-00000000000a'::uuid, 'Empresa A', '1111111-1'),
               ('10000000-0000-0000-0000-00000000000b'::uuid, 'Empresa B', '2222222-2')) e(id, n, nit),
       public.regimenes_fiscales r where r.codigo = 'general';

insert into public.miembros (empresa_id, user_id, rol) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 'propietario'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c2', 'lector'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', 'emisor'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000d1', 'propietario');

insert into public.clientes (empresa_id, tipo_identificacion, numero_identificacion, nombre) values
  ('10000000-0000-0000-0000-00000000000a', 'NIT', '3333333-3', 'Cliente A1'),
  ('10000000-0000-0000-0000-00000000000a', 'NIT', '4444444-4', 'Cliente A2'),
  ('10000000-0000-0000-0000-00000000000b', 'NIT', '5555555-5', 'Cliente B1');
insert into public.conceptos (empresa_id, codigo, descripcion, tipo) values
  ('10000000-0000-0000-0000-00000000000a', 'C1', 'Concepto A', 'servicio'),
  ('10000000-0000-0000-0000-00000000000b', 'C1', 'Concepto B', 'servicio');
insert into public.documentos (empresa_id, numero_borrador) values
  ('10000000-0000-0000-0000-00000000000a', 1), ('10000000-0000-0000-0000-00000000000b', 1);
select public.fel_auditar('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 'cliente.crear', 'cliente', 'x', '{"nit":"3333333-3"}');
select public.fel_auditar('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000d1', 'cliente.crear', 'cliente', 'y', '{"nit":"5555555-5"}');
select public.fel_auditar('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'empresa.habilitada', 'empresa', 'a', '{}');
select public.fel_auditar(null, '00000000-0000-0000-0000-0000000000a1', 'regimen.crear_version', 'regimen', 'r', '{}');

-- ============ propietario de A: ve solo lo de A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true) as _cfg \gset
do $$ begin
  assert (select count(*) from public.empresas) = 1, 'A debe ver 1 empresa';
  assert (select count(*) from public.clientes) = 2, 'A debe ver sus 2 clientes';
  assert (select count(*) from public.clientes where empresa_id <> '10000000-0000-0000-0000-00000000000a') = 0, 'A ve clientes de B';
  assert (select count(*) from public.conceptos) = 1, 'A debe ver su concepto';
  assert (select count(*) from public.documentos) = 1, 'A debe ver su documento';
  assert (select count(*) from public.miembros) = 3, 'A debe ver sus 3 miembros';
  assert (select count(*) from public.auditoria where empresa_id = '10000000-0000-0000-0000-00000000000b') = 0, 'A ve auditoría de B';
  assert (select count(*) from public.auditoria) >= 2, 'A debe ver su auditoría';
  assert (select count(*) from public.permisos_catalogo) > 0, 'A debe ver el catálogo';
  assert not public.fel_es_admin_plataforma(), 'A no es administrador maestro';
end $$;
-- no puede escribir directamente en ninguna tabla (todo pasa por la función)
do $$ begin
  begin insert into public.clientes (empresa_id, tipo_identificacion, numero_identificacion, nombre) values ('10000000-0000-0000-0000-00000000000a', 'NIT', '9999999-9', 'Directo'); raise exception 'NO DEBIÓ PERMITIR insert'; exception when insufficient_privilege then null; end;
  begin update public.clientes set nombre = 'x'; raise exception 'NO DEBIÓ PERMITIR update'; exception when insufficient_privilege then null; end;
  begin delete from public.clientes; raise exception 'NO DEBIÓ PERMITIR delete'; exception when insufficient_privilege then null; end;
  begin update public.miembros set rol = 'propietario'; raise exception 'NO DEBIÓ PERMITIR cambiar rol'; exception when insufficient_privilege then null; end;
  begin insert into public.auditoria (accion, entidad) values ('x', 'y'); raise exception 'NO DEBIÓ PERMITIR insertar auditoría'; exception when insufficient_privilege then null; end;
  begin perform public.fel_auditar(null, null, 'x', 'y', null); raise exception 'NO DEBIÓ EJECUTAR fel_auditar'; exception when insufficient_privilege then null; end;
  begin perform public.fel_admin_empresa_estado('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', 'suspendida', 'intento'); raise exception 'NO DEBIÓ EJECUTAR admin'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.contadores_borrador; raise exception 'NO DEBIÓ LEER contadores'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ============ propietario de B
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true) as _cfg \gset
do $$ begin
  assert (select count(*) from public.clientes) = 1, 'B debe ver 1 cliente';
  assert (select count(*) from public.clientes where empresa_id <> '10000000-0000-0000-0000-00000000000b') = 0, 'B ve clientes de A';
  assert (select count(*) from public.documentos) = 1, 'B debe ver 1 documento';
  assert (select count(*) from public.miembros) = 1, 'B debe ver 1 miembro';
end $$;
reset role;

-- ============ lector de A: lee negocio, pero no usuarios ni auditoría ni invitaciones
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true) as _cfg \gset
do $$ begin
  assert (select count(*) from public.clientes) = 2, 'el lector ve clientes de A';
  assert (select count(*) from public.miembros) = 1, 'el lector solo ve su propia membresía';
  assert (select count(*) from public.auditoria) = 0, 'el lector no ve auditoría';
  assert (select count(*) from public.invitaciones) = 0, 'el lector no ve invitaciones';
  assert (select count(*) from public.perfiles) = 0, 'el lector no ve perfiles ajenos';
end $$;
reset role;

-- ============ emisor de A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}', true) as _cfg \gset
do $$ begin
  assert (select count(*) from public.documentos) = 1, 'el emisor ve borradores de A';
  assert (select count(*) from public.auditoria) = 0, 'el emisor no ve auditoría';
  assert not public.fel_tiene_permiso('10000000-0000-0000-0000-00000000000a', 'usuarios.gestionar'), 'el emisor no gestiona usuarios';
  assert not public.fel_tiene_permiso('10000000-0000-0000-0000-00000000000b', 'clientes.ver'), 'el emisor de A no tiene permisos en B';
end $$;
reset role;

-- ============ administrador maestro: ve empresas y regímenes, NO datos de negocio
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true) as _cfg \gset
do $$ begin
  assert public.fel_es_admin_plataforma(), 'debe ser administrador maestro';
  assert (select count(*) from public.empresas) = 2, 'el maestro ve las 2 empresas';
  assert (select count(*) from public.clientes) = 0, 'el maestro no debe ver clientes';
  assert (select count(*) from public.conceptos) = 0, 'el maestro no debe ver conceptos';
  assert (select count(*) from public.documentos) = 0, 'el maestro no debe ver documentos';
  assert (select count(*) from public.auditoria where entidad = 'cliente') = 0, 'el maestro no debe ver auditoría de clientes';
  assert (select count(*) from public.auditoria where entidad in ('empresa','regimen')) >= 2, 'el maestro debe ver auditoría administrativa';
  assert (select count(*) from public.regimenes_fiscales) >= 2, 'el maestro ve los regímenes sin verificar';
end $$;
reset role;

-- ============ usuario sin empresa y usuario sin sesión
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true) as _cfg \gset
do $$ begin
  assert (select count(*) from public.empresas) = 0, 'sin empresa no ve empresas';
  assert (select count(*) from public.clientes) = 0, 'sin empresa no ve clientes';
  assert (select count(*) from public.auditoria) = 0, 'sin empresa no ve auditoría';
  assert (select count(*) from public.regimenes_fiscales where estado <> 'verificado') = 0, 'sin empresa no ve regímenes sin verificar';
end $$;
reset role;

set local role anon;
do $$ begin
  begin perform 1 from public.clientes; raise exception 'anon no debió leer clientes'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.empresas; raise exception 'anon no debió leer empresas'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ============ empresa suspendida: sus miembros pierden el acceso a los datos
update public.empresas set estado = 'suspendida' where id = '10000000-0000-0000-0000-00000000000a';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true) as _cfg \gset
do $$ begin
  assert (select count(*) from public.clientes) = 0, 'una empresa suspendida no debe exponer clientes';
  assert (select count(*) from public.empresas) = 0, 'una empresa suspendida no se lista a sus miembros';
  assert (select count(*) from public.miembros where user_id = '00000000-0000-0000-0000-0000000000c1') = 1, 'el usuario sigue viendo su propia membresía';
end $$;
reset role;

rollback;
\echo 'OK 02_rls_aislamiento'
