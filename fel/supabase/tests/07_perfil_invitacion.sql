-- Cuenta sin perfil = sin acceso. Cuentas desactivadas. Aceptación de invitaciones como ÚNICA excepción, acotada.
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_ok boolean := false;
begin
  begin execute p_sql; exception when others then v_ok := (sqlerrm ~ p_patron) or (sqlstate ~ p_patron); end;
  if not v_ok then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if;
end $$;

-- usuarios: a1 maestro, b1 propietario (con perfil), n1..n4 sin perfil, d1 desactivado
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'maestro@fel.test', now()),
  ('00000000-0000-0000-0000-0000000000b1', 'prop@fel.test', now()),
  ('00000000-0000-0000-0000-0000000000f1', 'sinperfil@fel.test', now()),       -- sin perfil, con membresía "colada" y con fila de maestro
  ('00000000-0000-0000-0000-0000000000f2', 'nuevo@fel.test', now()),           -- sin perfil, con invitación vigente
  ('00000000-0000-0000-0000-0000000000f3', 'sininv@fel.test', now()),          -- sin perfil, sin invitación
  ('00000000-0000-0000-0000-0000000000f4', 'vencida@fel.test', now()),         -- sin perfil, invitación vencida
  ('00000000-0000-0000-0000-0000000000f5', 'revocada@fel.test', now()),        -- sin perfil, invitación revocada
  ('00000000-0000-0000-0000-0000000000f6', 'sinconfirmar@fel.test', null),     -- sin perfil, correo sin confirmar
  ('00000000-0000-0000-0000-0000000000f7', 'otrocorreo@fel.test', now()),      -- sin perfil; intenta usar el correo de otro
  ('00000000-0000-0000-0000-0000000000d1', 'desactivado@fel.test', now());     -- perfil desactivado, con invitación vigente
insert into public.perfiles (user_id, activo) values
  ('00000000-0000-0000-0000-0000000000a1', true), ('00000000-0000-0000-0000-0000000000b1', true),
  ('00000000-0000-0000-0000-0000000000d1', false);
insert into public.plataforma_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000f1');
insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id, estado)
select '10000000-0000-0000-0000-00000000000a', 'A', 'A S.A.', '1111111-1', id, 'habilitada' from public.regimenes_fiscales where codigo = 'general';
insert into public.miembros (empresa_id, user_id, rol) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b1', 'propietario'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000f1', 'propietario');  -- membresía sin perfil
select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000a', null, 'NIT', '3333333-3', 'Cliente', null, null, null, null);

-- ================= estado de la cuenta
do $$ begin
  assert public.fel_estado_cuenta('00000000-0000-0000-0000-0000000000b1') = 'activa', 'activa';
  assert public.fel_estado_cuenta('00000000-0000-0000-0000-0000000000d1') = 'bloqueada', 'bloqueada';
  assert public.fel_estado_cuenta('00000000-0000-0000-0000-0000000000f3') = 'sin_perfil', 'sin_perfil';
  assert public.fel_estado_cuenta(gen_random_uuid()) = 'sin_perfil', 'inexistente = sin_perfil';
  assert public.fel_estado_cuenta(null) = 'sin_perfil', 'nulo = sin_perfil';
  assert not public.fel_usuario_activo('00000000-0000-0000-0000-0000000000f3'), 'sin perfil NO es activa';
  assert not public.fel_usuario_activo('00000000-0000-0000-0000-0000000000d1'), 'bloqueada NO es activa';
end $$;

-- ================= sin perfil = sin acceso (aunque exista una membresía o una fila de maestro)
do $$ begin
  assert public.fel_permisos_efectivos('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000f1') = '{}', 'sin perfil con membresía tiene permisos';
  assert not public.fel_es_plataforma('00000000-0000-0000-0000-0000000000f1'), 'sin perfil con fila de maestro es maestro';
end $$;
select pg_temp.espera_error($$select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-00000000000a', null, 'NIT', '4444444-4', 'X', null, null, null, null)$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_documento_guardar('00000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-00000000000a', null, null, null, null, '[]'::jsonb, 0, 0, 0, '{}'::jsonb, null)$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_admin_empresa_estado('00000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-00000000000a', 'suspendida', 'Motivo válido')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_invitacion_registrar('00000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-00000000000a', 'x@fel.test', 'lector', '{}')$$, 'FEL_NO_AUTORIZADO');
-- lecturas con RLS: sin perfil no ve nada
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}', true) as _cfg \gset
do $$ begin
  assert (select count(*) from public.empresas) = 0, 'sin perfil ve empresas';
  assert (select count(*) from public.clientes) = 0, 'sin perfil ve clientes';
  assert (select count(*) from public.miembros where empresa_id is not null and user_id <> auth.uid()) = 0, 'sin perfil ve miembros ajenos';
end $$;
reset role;
-- desactivada: igual
select pg_temp.espera_error($$select public.fel_op_cliente_guardar('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000a', null, 'NIT', '5555555-5', 'X', null, null, null, null)$$, 'FEL_NO_AUTORIZADO');

-- ================= aceptación de invitaciones (única excepción)
-- invitaciones: f2 vigente; f4 vencida; f5 revocada; d1 vigente (pero cuenta desactivada); 'ajeno' vigente para otra persona
insert into public.invitaciones (empresa_id, email, rol, estado, expira_en) values
  ('10000000-0000-0000-0000-00000000000a', 'nuevo@fel.test', 'lector', 'pendiente', now() + interval '3 days'),
  ('10000000-0000-0000-0000-00000000000a', 'vencida@fel.test', 'lector', 'pendiente', now() - interval '1 hour'),
  ('10000000-0000-0000-0000-00000000000a', 'revocada@fel.test', 'lector', 'revocada', now() + interval '3 days'),
  ('10000000-0000-0000-0000-00000000000a', 'desactivado@fel.test', 'lector', 'pendiente', now() + interval '3 days'),
  ('10000000-0000-0000-0000-00000000000a', 'ajeno@fel.test', 'lector', 'pendiente', now() + interval '3 days'),
  ('10000000-0000-0000-0000-00000000000a', 'sinconfirmar@fel.test', 'lector', 'pendiente', now() + interval '3 days');
-- sin invitación / vencida / revocada: se rechaza y NO se crea perfil ni membresía
select pg_temp.espera_error($$select public.fel_op_invitacion_aceptar('00000000-0000-0000-0000-0000000000f3', 'sininv@fel.test')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_invitacion_aceptar('00000000-0000-0000-0000-0000000000f4', 'vencida@fel.test')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_invitacion_aceptar('00000000-0000-0000-0000-0000000000f5', 'revocada@fel.test')$$, 'FEL_NO_AUTORIZADO');
-- correo sin confirmar, correo distinto al de la cuenta, usuario nulo
select pg_temp.espera_error($$select public.fel_op_invitacion_aceptar('00000000-0000-0000-0000-0000000000f6', 'sinconfirmar@fel.test')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_invitacion_aceptar('00000000-0000-0000-0000-0000000000f7', 'ajeno@fel.test')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_invitacion_aceptar(null, 'nuevo@fel.test')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_invitacion_aceptar(gen_random_uuid(), 'nuevo@fel.test')$$, 'FEL_NO_AUTORIZADO');
-- cuenta desactivada: no se reactiva ni gana membresía
select pg_temp.espera_error($$select public.fel_op_invitacion_aceptar('00000000-0000-0000-0000-0000000000d1', 'desactivado@fel.test')$$, 'FEL_NO_AUTORIZADO');
do $$ begin
  assert not exists (select 1 from public.perfiles where user_id in (
    '00000000-0000-0000-0000-0000000000f3','00000000-0000-0000-0000-0000000000f4','00000000-0000-0000-0000-0000000000f5',
    '00000000-0000-0000-0000-0000000000f6','00000000-0000-0000-0000-0000000000f7')), 'se creó un perfil sin invitación válida';
  assert (select activo from public.perfiles where user_id = '00000000-0000-0000-0000-0000000000d1') = false, 'la cuenta desactivada se reactivó';
  assert not exists (select 1 from public.miembros where user_id in (
    '00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000f3','00000000-0000-0000-0000-0000000000f4')), 'se creó una membresía indebida';
  assert (select estado from public.invitaciones where email = 'desactivado@fel.test') = 'pendiente', 'la invitación de una cuenta bloqueada se consumió';
end $$;
-- invitación vigente + correo confirmado y coincidente: crea el perfil activo y la membresía
do $$ declare n int; begin
  assert public.fel_estado_cuenta('00000000-0000-0000-0000-0000000000f2') = 'sin_perfil', 'antes de aceptar debe ser sin_perfil';
  assert public.fel_permisos_efectivos('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000f2') = '{}', 'permisos antes de aceptar';
  n := public.fel_op_invitacion_aceptar('00000000-0000-0000-0000-0000000000f2', 'Nuevo@Fel.Test');
  assert n = 1, 'debía aceptar 1, aceptó ' || n;
  assert public.fel_estado_cuenta('00000000-0000-0000-0000-0000000000f2') = 'activa', 'tras aceptar debe estar activa';
  assert 'clientes.ver' = any (public.fel_permisos_efectivos('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000f2')), 'el lector debía poder ver clientes';
  assert not ('clientes.escribir' = any (public.fel_permisos_efectivos('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000f2'))), 'el lector no debe escribir';
  assert (select estado from public.invitaciones where email = 'nuevo@fel.test') = 'aceptada', 'invitación sin marcar aceptada';
  assert exists (select 1 from public.auditoria where accion = 'invitacion.aceptar' and actor_user_id = '00000000-0000-0000-0000-0000000000f2'), 'sin auditoría';
  -- repetir no crea nada nuevo (ya no hay invitaciones pendientes) y la cuenta, ya con perfil, no falla
  assert public.fel_op_invitacion_aceptar('00000000-0000-0000-0000-0000000000f2', 'nuevo@fel.test') = 0, 'repetir debía devolver 0';
  -- la invitación de otra persona sigue intacta
  assert (select estado from public.invitaciones where email = 'ajeno@fel.test') = 'pendiente', 'se consumió la invitación ajena';
end $$;
-- la nueva cuenta ve solo lo permitido por RLS (lector de A)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true) as _cfg \gset
do $$ begin
  assert (select count(*) from public.clientes) = 1, 'el lector aceptado debe ver el cliente de su empresa';
  assert (select count(*) from public.empresas) = 1, 'el lector aceptado debe ver su empresa';
end $$;
reset role;
-- una cuenta con perfil activo y SIN invitaciones sigue pudiendo llamar (devuelve 0), pero no gana nada
do $$ begin assert public.fel_op_invitacion_aceptar('00000000-0000-0000-0000-0000000000b1', 'prop@fel.test') = 0, 'cuenta activa sin invitaciones'; end $$;
-- una invitación vencida se marca como vencida cuando la cuenta ya tiene perfil
insert into public.invitaciones (empresa_id, email, rol, estado, expira_en) values ('10000000-0000-0000-0000-00000000000a', 'prop@fel.test', 'lector', 'pendiente', now() - interval '1 day');
do $$ begin
  assert public.fel_op_invitacion_aceptar('00000000-0000-0000-0000-0000000000b1', 'prop@fel.test') = 0;
  assert (select estado from public.invitaciones where email = 'prop@fel.test') = 'vencida', 'no se marcó vencida';
end $$;
-- solo service_role ejecuta la aceptación
do $$ begin
  assert not has_function_privilege('authenticated', 'public.fel_op_invitacion_aceptar(uuid,text)', 'EXECUTE'), 'authenticated acepta invitaciones directo';
  assert not has_function_privilege('anon', 'public.fel_estado_cuenta(uuid)', 'EXECUTE'), 'anon consulta estados';
end $$;

rollback;
\echo 'OK 07_perfil_invitacion'
