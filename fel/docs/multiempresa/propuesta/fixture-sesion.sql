-- Datos de PRUEBA persistentes (PostgreSQL temporal) para las pruebas conectadas como nexa_app con sesiones validadas. Dos empresas, dos establecimientos en A (códigos de prueba 10 y 20), tokens de sesión conocidos.
\set ON_ERROR_STOP on
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'maestro@fel.test'), ('00000000-0000-0000-0000-0000000000a2', 'maestro2@fel.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'propa@fel.test'), ('00000000-0000-0000-0000-0000000000c8', 'propa2@fel.test'), ('00000000-0000-0000-0000-0000000000c4', 'admina@fel.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'facta@fel.test'), ('00000000-0000-0000-0000-0000000000c5', 'factb@fel.test'), ('00000000-0000-0000-0000-0000000000c6', 'superv@fel.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'lectora@fel.test'), ('00000000-0000-0000-0000-0000000000c9', 'bajaa@fel.test'), ('00000000-0000-0000-0000-0000000000d1', 'propb@fel.test'), ('00000000-0000-0000-0000-0000000000d2', 'factbemp@fel.test');
insert into public.perfiles (user_id, activo) select id, id <> '00000000-0000-0000-0000-0000000000c9' from auth.users on conflict (user_id) do nothing;
insert into public.plataforma_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000a2');
insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id, estado)
select e.id, e.n, e.n || ' S.A.', e.nit, r.id, 'habilitada' from (values ('10000000-0000-0000-0000-00000000000a'::uuid, 'Empresa A', '1111111-1'), ('10000000-0000-0000-0000-00000000000b'::uuid, 'Empresa B', '2222222-2')) e(id, n, nit), public.regimenes_fiscales r where r.codigo = 'general';
insert into public.miembros (empresa_id, user_id, rol) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 'propietario'), ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c8', 'propietario'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c4', 'administrador'), ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', 'emisor'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c5', 'emisor'), ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c6', 'emisor'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c2', 'lector'), ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c9', 'emisor'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000d1', 'propietario'), ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000d2', 'emisor');
update public.miembros set permisos_extra = array['establecimientos.multiples'] where user_id = '00000000-0000-0000-0000-0000000000c6';
create temp table t_x as select
  (public.fel_op_establecimiento_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, '10', 'Sucursal 10', 'Dirección 10', 'activo')).id e10,
  (public.fel_op_establecimiento_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, '20', 'Sucursal 20', 'Dirección 20', 'activo')).id e20,
  (public.fel_op_establecimiento_guardar('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000b', null, '10', 'Sucursal B', 'Dirección B', 'activo')).id eb;
create temp table t_k (u text primary key, tok text);
insert into t_k values ('maestro', 'tok-maestro-0123456789abcdef'), ('maestro2', 'tok-maestro2-0123456789abcdef'), ('propa', 'tok-propa-0123456789abcdef'), ('propa2', 'tok-propa2-0123456789abcdef'), ('admina', 'tok-admina-0123456789abcdef'),
  ('facta', 'tok-facta-0123456789abcdef'), ('factb', 'tok-factb-0123456789abcdef'), ('superv', 'tok-superv-0123456789abcdef'), ('lectora', 'tok-lectora-0123456789abcdef'), ('bajaa', 'tok-bajaa-0123456789abcdef'),
  ('propb', 'tok-propb-0123456789abcdef'), ('factbemp', 'tok-factbemp-0123456789abcdef'), ('vencida', 'tok-vencida-0123456789abcdef');
insert into public.demo_credenciales (usuario, user_id, nombre, descripcion, empresa_id, sal, hash, mfa_semilla_cifrada)
select u.usuario, u.id, 'Persona ' || u.usuario, '', u.emp, repeat('a', 32), repeat('b', 64), case when u.mfa then repeat('m', 30) end
  from (values ('maestro', '00000000-0000-0000-0000-0000000000a1'::uuid, null::uuid, true), ('maestro2', '00000000-0000-0000-0000-0000000000a2', null, true),
    ('propa', '00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', true), ('propa2', '00000000-0000-0000-0000-0000000000c8', '10000000-0000-0000-0000-00000000000a', false),
    ('admina', '00000000-0000-0000-0000-0000000000c4', '10000000-0000-0000-0000-00000000000a', false), ('facta', '00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', false),
    ('factb', '00000000-0000-0000-0000-0000000000c5', '10000000-0000-0000-0000-00000000000a', false), ('superv', '00000000-0000-0000-0000-0000000000c6', '10000000-0000-0000-0000-00000000000a', false),
    ('lectora', '00000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-00000000000a', false), ('bajaa', '00000000-0000-0000-0000-0000000000c9', '10000000-0000-0000-0000-00000000000a', false),
    ('propb', '00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000b', true), ('factbemp', '00000000-0000-0000-0000-0000000000d2', '10000000-0000-0000-0000-00000000000b', false)) u(usuario, id, emp, mfa);
insert into public.demo_sesiones (token_hash, usuario, creada_en, ultima_en)
select encode(sha256(convert_to(k.tok, 'UTF8')), 'hex'), case when k.u = 'vencida' then 'facta' else k.u end, now() - interval '1 hour', case when k.u = 'vencida' then now() - interval '20 hours' else now() end from t_k k;
-- las asignaciones iniciales las hace el administrador (interruptor encendido más abajo)
select public.fel_op_asignacion_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', (select e10 from t_x), true, 'alta');
select public.fel_op_asignacion_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c5', (select e20 from t_x), true, 'alta');
select public.fel_op_asignacion_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c6', (select e10 from t_x), true, 'supervisor');
select public.fel_op_asignacion_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c6', (select e20 from t_x), false, 'supervisor');
select public.fel_op_asignacion_guardar('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000d2', (select eb from t_x), true, 'alta');
update public.plataforma_parametros set valor = 1 where clave = 'establecimiento_por_usuario';
create table public.zz_ids as select (select e10 from t_x) e10, (select e20 from t_x) e20, (select eb from t_x) eb;   -- identificadores de prueba que leerán las pruebas
grant select on public.zz_ids to nexa_app;
