-- Lista de miembros con correo: aislamiento entre empresas y permisos.
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_ok boolean := false;
begin
  begin execute p_sql; exception when others then v_ok := (sqlerrm ~ p_patron) or (sqlstate ~ p_patron); end;
  if not v_ok then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if;
end $$;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'propA@fel.test', now()), ('00000000-0000-0000-0000-0000000000a2', 'lectorA@fel.test', now()),
  ('00000000-0000-0000-0000-0000000000a3', 'emisorA@fel.test', now()), ('00000000-0000-0000-0000-0000000000b1', 'propB@fel.test', now()),
  ('00000000-0000-0000-0000-0000000000c1', 'sinperfil@fel.test', now());
insert into public.perfiles (user_id, nombre) values
  ('00000000-0000-0000-0000-0000000000a1', 'Ana'), ('00000000-0000-0000-0000-0000000000a2', 'Luis'),
  ('00000000-0000-0000-0000-0000000000a3', 'Eva'), ('00000000-0000-0000-0000-0000000000b1', 'Beto');
insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id, estado)
select e.id, e.n, e.n || ' S.A.', e.nit, r.id, 'habilitada'
  from (values ('10000000-0000-0000-0000-00000000000a'::uuid, 'Empresa A', '1111111-1'), ('10000000-0000-0000-0000-00000000000b'::uuid, 'Empresa B', '2222222-2')) e(id, n, nit),
       public.regimenes_fiscales r where r.codigo = 'general';
insert into public.miembros (empresa_id, user_id, rol) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'propietario'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 'lector'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a3', 'emisor'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1', 'propietario'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 'lector');   -- membresía sin perfil

-- el propietario de A ve a los miembros de A con su correo, ordenados por jerarquía, con permisos efectivos reales
do $$ declare r record; n int := 0; begin
  for r in select * from public.fel_op_miembros_listar('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a') loop
    n := n + 1;
    assert r.email in ('propa@fel.test', 'lectora@fel.test', 'emisora@fel.test', 'sinperfil@fel.test') or r.email like '%@fel.test', 'correo';
    if lower(r.email) = 'propa@fel.test' then assert r.rol = 'propietario' and r.cuenta = 'activa' and 'usuarios.gestionar' = any (r.permisos_efectivos), 'propietario'; end if;
    if lower(r.email) = 'lectora@fel.test' then assert not ('clientes.escribir' = any (r.permisos_efectivos)), 'el lector no escribe'; end if;
    if lower(r.email) = 'sinperfil@fel.test' then assert r.cuenta = 'sin_perfil' and r.permisos_efectivos = '{}', 'sin perfil no tiene permisos efectivos'; end if;
    assert r.user_id <> '00000000-0000-0000-0000-0000000000b1', 'apareció un miembro de otra empresa';
  end loop;
  assert n = 4, 'debía listar 4 miembros de A, listó ' || n;
  assert (select lower(email) from public.fel_op_miembros_listar('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a') limit 1) = 'propa@fel.test', 'orden por jerarquía';
end $$;
-- aislamiento: nadie lista una empresa que no es la suya, ni con permisos en otra
select pg_temp.espera_error($$select * from public.fel_op_miembros_listar('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000b')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select * from public.fel_op_miembros_listar('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000a')$$, 'FEL_NO_AUTORIZADO');
-- sin 'usuarios.ver' (el lector y el emisor no lo tienen) no hay lista; sin perfil, tampoco; nulo, tampoco
select pg_temp.espera_error($$select * from public.fel_op_miembros_listar('00000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select * from public.fel_op_miembros_listar('00000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-00000000000a')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select * from public.fel_op_miembros_listar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select * from public.fel_op_miembros_listar(null, '10000000-0000-0000-0000-00000000000a')$$, 'FEL_NO_AUTORIZADO');
-- cambio de permisos en caliente: revocar 'usuarios.ver' al propietario corta la lista de inmediato
update public.miembros set permisos_revocados = array['usuarios.ver'] where user_id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.espera_error($$select * from public.fel_op_miembros_listar('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a')$$, 'FEL_NO_AUTORIZADO');
update public.miembros set permisos_revocados = '{}' where user_id = '00000000-0000-0000-0000-0000000000a1';
-- cuenta bloqueada: igual
update public.perfiles set activo = false where user_id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.espera_error($$select * from public.fel_op_miembros_listar('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a')$$, 'FEL_NO_AUTORIZADO');
-- el correo no se filtra por RLS: la tabla perfiles no tiene correo y miembros tampoco
do $$ begin assert not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('perfiles', 'miembros', 'invitaciones_x') and column_name = 'email'), 'hay una columna email legible por RLS'; end $$;

rollback;
\echo 'OK 11_usuarios_listar'
