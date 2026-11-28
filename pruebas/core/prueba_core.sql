\set ON_ERROR_STOP 1
\set QUIET 1
-- ===== datos de partida (como postgres) =====
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'admin@t.co'), ('00000000-0000-0000-0000-0000000000b1', 'b1@t.co'), ('00000000-0000-0000-0000-0000000000b2', 'b2@t.co'),
  ('00000000-0000-0000-0000-0000000000c1', 'c@t.co'), ('00000000-0000-0000-0000-0000000000d1', 'd@t.co'), ('00000000-0000-0000-0000-0000000000e1', 'soporte@t.co');
insert into core.plataforma_admins (user_id, nivel) values ('00000000-0000-0000-0000-0000000000a1', 'maestro'), ('00000000-0000-0000-0000-0000000000e1', 'soporte');
\i pruebas/core/ayudantes.sql

-- ===== 1. identidad real: sin sesión, sesión inexistente, sesión viva y revocación inmediata =====
do $$ begin
  perform t.como(null);
  perform t.ok(t.falla('select api.mi_contexto()', 'CORE_NO_AUTENTICADO'), 'sin identidad: mi_contexto se rechaza');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000d1', 'session_id', gen_random_uuid())::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true); set local role authenticated;
  perform t.ok(t.falla('select api.mi_contexto()', 'CORE_SESION_NO_VIVA'), 'token con sesión inexistente (ajena o falsa): se rechaza');
  perform t.como('d@t.co');
  perform t.ok((api.mi_contexto() ->> 'plataforma')::boolean = false and jsonb_array_length(api.mi_contexto() -> 'empresas') = 0, 'persona con sesión viva y sin empresas: contexto vacío, no es plataforma');
  reset role; delete from auth.sessions where user_id = '00000000-0000-0000-0000-0000000000d1';
  perform set_config('request.jwt.claims', (select json_build_object('sub', '00000000-0000-0000-0000-0000000000d1', 'session_id', gen_random_uuid())::text), true); set local role authenticated;
  perform t.ok(t.falla('select api.mi_contexto()', 'CORE_SESION_NO_VIVA'), 'sesión revocada: acceso cortado de inmediato');
end $$;

-- ===== 2. superficie: anon y authenticated no tocan tablas ni funciones internas =====
do $$ begin
  perform t.como(null, 'aal1', null, 'anon');
  perform t.ok(t.falla('select api.mi_contexto()', 'permission denied'), 'anon: sin acceso a la API');
  perform t.ok(t.falla('select * from core.empresas', 'permission denied'), 'anon: sin acceso a las tablas');
  perform t.como('b1@t.co');
  perform t.ok(t.falla('select * from core.empresas', 'permission denied'), 'authenticated: no lee tablas directamente');
  perform t.ok(t.falla('insert into core.empresas (nombre_comercial) values (''x1'')', 'permission denied'), 'authenticated: no escribe tablas directamente');
  perform t.ok(t.falla('select core.ctx()', 'permission denied'), 'authenticated: no ejecuta funciones internas (core.*)');
  perform t.ok(t.falla('select core_sys.aprov_tomar(''fel'')', 'permission denied'), 'authenticated: no ejecuta la API de módulos (core_sys.*)');
  perform t.como('b1@t.co', 'aal1', 'fel', 'core_worker');
  perform t.ok(t.falla('select api.mi_contexto()', 'permission denied'), 'core_worker: no ejecuta la API de personas');
  perform t.ok(t.falla('select * from core.empresas', 'permission denied'), 'core_worker: no lee tablas');
end $$;

-- ===== 3. plataforma: separación, MFA y creación de empresa + invitación del propietario =====
do $$ declare e1 uuid; e2 uuid; inv uuid; begin
  perform t.como('b1@t.co');
  perform t.ok(t.falla('select api.pla_empresa_crear(''X'', null, null, ''z@t.co'')', 'CORE_PLATAFORMA_REQUERIDA'), 'persona normal: no usa la plataforma');
  perform t.como('admin@t.co', 'aal1');
  perform t.ok(t.falla('select api.pla_empresa_crear(''X1'', null, null, ''z@t.co'')', 'CORE_MFA_REQUERIDA'), 'administrador de plataforma sin aal2: se exige verificación en dos pasos');
  perform t.como('admin@t.co', 'aal2');
  e1 := api.pla_empresa_crear('Empresa Uno', 'Uno, S.A.', '1234567-8', 'b1@t.co'); e2 := api.pla_empresa_crear('Empresa Dos', 'Dos, S.A.', '7654321-0', 'b2@t.co');
  reset role; insert into t.ids values ('e1', e1), ('e2', e2);
  perform t.ok((select count(*) from core.invitaciones where estado = 'pendiente') = 2, 'plataforma: crea empresas e invita al propietario');
  perform t.ok(t.falla('select api.pla_empresa_crear(''Dup'', null, ''1234567-8'', ''q@t.co'')', 'duplicate key'), 'NIT duplicado: se rechaza');
  perform t.como('soporte@t.co', 'aal2');
  perform t.ok(jsonb_array_length(api.pla_empresas_listar()) = 2, 'soporte lista empresas');
  perform t.ok(t.falla('select api.pla_plan_definir(''{"codigo":"x"}''::jsonb)', 'CORE_PLATAFORMA_REQUERIDA'), 'soporte no define planes (solo maestro)');
end $$;

-- ===== 4. invitaciones: solo la persona invitada acepta; propietarios =====
do $$ declare inv uuid; begin
  reset role; select id into inv from core.invitaciones where email = 'b1@t.co';
  perform t.como('b2@t.co');
  perform t.ok(t.falla(format('select api.invitacion_aceptar(%L)', inv), 'CORE_INVITACION_AJENA'), 'invitación ajena: otra persona no puede aceptarla');
  perform t.como('b1@t.co'); perform api.invitacion_aceptar(inv);
  perform t.ok(t.falla(format('select api.invitacion_aceptar(%L)', inv), 'CORE_INVITACION_NO_VALIDA'), 'invitación ya usada: se rechaza');
  perform t.ok((api.mi_contexto() -> 'empresas' -> 0 -> 'roles') ? 'core.propietario', 'la persona invitada queda como propietaria');
  reset role; select id into inv from core.invitaciones where email = 'b2@t.co'; update core.invitaciones set expira_en = now() - interval '1 day' where id = inv;
  perform t.como('b2@t.co');
  perform t.ok(t.falla(format('select api.invitacion_aceptar(%L)', inv), 'CORE_INVITACION_VENCIDA'), 'invitación vencida: se rechaza');
  reset role; update core.invitaciones set expira_en = now() + interval '3 days', estado = 'pendiente' where id = inv;
  perform t.como('b2@t.co'); perform api.invitacion_aceptar(inv);
  perform t.ok(true, 'segunda empresa aceptada por su propietario');
end $$;

-- ===== 5. módulos del catálogo (manifiestos), planes y suscripción =====
\set m_nexa `cat core/manifiestos/nexa.json`
\set m_fel `cat core/manifiestos/fel.json`
\set m_pos `cat core/manifiestos/pos.json`
\set m_hotel `cat core/manifiestos/hotel.json`
\set m_col `cat core/manifiestos/colegios.json`
begin;
select t.como('admin@t.co', 'aal2');
select api.pla_modulo_registrar(:'m_nexa'::jsonb), api.pla_modulo_registrar(:'m_fel'::jsonb), api.pla_modulo_registrar(:'m_pos'::jsonb), api.pla_modulo_registrar(:'m_hotel'::jsonb), api.pla_modulo_registrar(:'m_col'::jsonb);
commit;
do $$ begin
  perform t.ok((select count(*) from core.modulos where codigo in ('nexa', 'fel', 'pos', 'hotel', 'colegios')) = 5 and (select count(*) from core.permisos where modulo = 'fel') = 6, 'cinco módulos registrados con manifiesto (permisos, roles y eventos)');
  perform t.como('admin@t.co', 'aal2');
  perform api.pla_plan_definir('{"codigo":"basico","nombre":"Básico","periodo":"mensual","modulos":[{"modulo":"fel"}]}'::jsonb);
  perform api.pla_plan_definir('{"codigo":"completo","nombre":"Completo","periodo":"mensual","modulos":[{"modulo":"fel"},{"modulo":"pos"}]}'::jsonb);
  perform api.pla_suscripcion_asignar(t.id('e1'), 'basico', 'activa', null, false);
  perform api.pla_suscripcion_asignar(t.id('e2'), 'completo', 'prueba', now() + interval '14 days', false);
  perform t.como('b1@t.co');
  perform t.ok(t.falla('select api.pla_plan_definir(''{"codigo":"zz"}''::jsonb)', 'CORE_PLATAFORMA_REQUERIDA'), 'una empresa no define planes');
  perform t.ok(t.falla(format('select api.pla_suscripcion_asignar(%L, ''completo'')', t.id('e1')), 'CORE_PLATAFORMA_REQUERIDA'), 'una empresa no se cambia su propio plan');
end $$;
select count(*) as modulos_registrados from core.modulos;

-- ===== 6. activación de módulos: plan, aprovisionamiento por el módulo y eventos aislados por empresa =====
do $$ declare a uuid; r jsonb; v jsonb; begin
  perform t.como('b1@t.co');
  perform t.ok(t.falla(format('select api.modulo_activar(%L, ''pos'')', t.id('e1')), 'CORE_PLAN_NO_INCLUYE_MODULO'), 'el plan básico no incluye POS: no se puede activar');
  a := api.modulo_activar(t.id('e1'), 'fel');
  perform t.ok(a = api.modulo_activar(t.id('e1'), 'fel'), 'activar dos veces no duplica el aprovisionamiento (idempotente)');
  perform t.ok((api.verificar_acceso(t.id('e1'), 'fel', 'documentos.ver') ->> 'motivo') = 'modulo_no_vigente', 'hasta que el módulo lo aprovisiona, no hay acceso');
  perform t.como('b2@t.co');
  perform api.modulo_activar(t.id('e2'), 'fel'); perform api.modulo_activar(t.id('e2'), 'pos');
  perform t.como('b1@t.co', 'aal1', 'pos', 'core_worker');
  perform t.ok(t.falla('select core_sys.aprov_tomar(''fel'')', 'CORE_MODULO_NO_AUTENTICADO'), 'un módulo no se hace pasar por otro (reclamación modulo)');
  perform t.como('b1@t.co', 'aal1', 'fel', 'core_worker');
  r := core_sys.aprov_tomar('fel', 10);
  perform t.ok(jsonb_array_length(r) = 2, 'el módulo FEL toma sus 2 solicitudes (empresa 1 y 2) y ninguna de POS');
  perform t.ok(r::text not like '%password%', 'la respuesta solo trae datos de la empresa necesarios');
  perform core_sys.aprov_completar('fel', (r -> 0 ->> 'id')::uuid, false, 'fallo simulado');
  reset role; perform t.ok((select estado from core.aprovisionamientos where id = (r -> 0 ->> 'id')::uuid) = 'pendiente', 'un fallo deja la solicitud pendiente para reintento');
  perform t.como('b1@t.co', 'aal1', 'fel', 'core_worker');
  perform core_sys.aprov_completar('fel', (r -> 1 ->> 'id')::uuid, true);
  perform t.ok(t.falla(format('select core_sys.aprov_completar(''fel'', %L, true)', (r -> 1 ->> 'id')), 'CORE_APROVISIONAMIENTO_NO_VALIDO'), 'completar dos veces se rechaza');
  r := core_sys.aprov_tomar('fel', 10); perform core_sys.aprov_completar('fel', (r -> 0 ->> 'id')::uuid, true);
  perform t.como('b1@t.co', 'aal1', 'pos', 'core_worker'); r := core_sys.aprov_tomar('pos', 10); perform core_sys.aprov_completar('pos', (r -> 0 ->> 'id')::uuid, true);
  perform t.como('b1@t.co');
  perform t.ok((api.verificar_acceso(t.id('e1'), 'fel', 'documentos.ver') ->> 'motivo') in ('sin_permiso'), 'módulo activo pero sin rol de FEL: sin permiso (el propietario de CORE no recibe permisos de módulos automáticamente)');
  perform t.como('b1@t.co', 'aal1', 'fel', 'core_worker');
  v := core_sys.eventos_leer('fel', 0, 100);
  perform t.ok(v::text like '%modulo_activado%' and v::text like '%modulo_activacion_solicitada%', 'eventos de activación llegan al módulo');
  perform t.ok((select count(*) from jsonb_array_elements(v) x where (x ->> 'empresa_id')::uuid not in (t.id('e1'), t.id('e2'))) = 0, 'solo eventos de empresas con ese módulo');
  perform t.como('b1@t.co', 'aal1', 'pos', 'core_worker');
  perform t.ok(core_sys.eventos_leer('pos', 0, 100)::text not like ('%' || t.id('e1')::text || '%'), 'POS no ve eventos de la empresa 1 (no tiene POS)');
end $$;

-- ===== 7. roles, permisos efectivos, permisos extra/revocados y roles propios =====
do $$ declare inv uuid; rid uuid; begin
  perform t.como('b1@t.co');
  inv := api.invitacion_crear(t.id('e1'), 'C@T.CO', '[{"modulo":"core","codigo":"lector"},{"modulo":"fel","codigo":"emisor"}]'::jsonb);
  perform t.ok(t.falla(format('select api.invitacion_crear(%L, ''x@t.co'', ''[{"modulo":"pos","codigo":"cajero"}]''::jsonb)', t.id('e1')), 'CORE_MODULO_NO_VIGENTE'), 'no se asignan roles de un módulo no vigente (POS no está en el plan)');
  perform t.ok(t.falla(format('select api.invitacion_crear(%L, ''x@t.co'', ''[{"modulo":"fel","codigo":"inexistente"}]''::jsonb)', t.id('e1')), 'CORE_ROL_INEXISTENTE'), 'rol inexistente: se rechaza');
  perform t.como('c@t.co'); perform api.invitacion_aceptar(inv);
  perform t.ok(api.permisos(t.id('e1'), 'fel') = array['clientes.gestionar', 'conceptos.gestionar', 'documentos.emitir', 'documentos.ver'], 'permisos efectivos de FEL = los del rol emisor');
  perform t.ok(api.permisos(t.id('e1'), 'core') = array['empresa.ver', 'miembros.ver', 'modulos.ver', 'suscripcion.ver'], 'permisos de CORE = los del rol lector');
  perform t.ok(t.falla(format('select api.miembro_roles_asignar(%L, %L, ''[]''::jsonb)', t.id('e1'), t.id('e1')), 'CORE_SIN_PERMISO'), 'un lector no gestiona miembros');
  perform t.como('b1@t.co');
  perform api.miembro_permiso(t.id('e1'), '00000000-0000-0000-0000-0000000000c1', 'fel', 'documentos.emitir', 'revocar');
  perform api.miembro_permiso(t.id('e1'), '00000000-0000-0000-0000-0000000000c1', 'fel', 'documentos.anular', 'conceder');
  perform t.como('c@t.co');
  perform t.ok(api.permisos(t.id('e1'), 'fel') = array['clientes.gestionar', 'conceptos.gestionar', 'documentos.anular', 'documentos.ver'], 'revocar quita y conceder agrega permisos puntuales');
  perform t.como('b1@t.co');
  rid := api.rol_definir(t.id('e1'), 'fel', 'revisor', 'Revisor', array['documentos.ver']);
  perform t.ok(t.falla(format('select api.rol_definir(%L, ''fel'', ''malo'', ''Malo'', array[''permiso.inexistente''])', t.id('e1')), 'CORE_PERMISO_INEXISTENTE'), 'rol propio con permiso inexistente: se rechaza');
  perform api.miembro_roles_asignar(t.id('e1'), '00000000-0000-0000-0000-0000000000c1', '[{"modulo":"core","codigo":"lector"},{"modulo":"fel","codigo":"revisor"}]'::jsonb);
  perform t.como('c@t.co'); perform t.ok(api.permisos(t.id('e1'), 'fel') = array['documentos.anular', 'documentos.ver'], 'rol propio asignado (conserva el permiso concedido)');
  perform t.como('b2@t.co');
  perform t.ok(t.falla(format('select api.rol_definir(%L, ''fel'', ''revisor'', ''X'', array[''documentos.ver''])', t.id('e1')), 'CORE_SIN_PERMISO'), 'otra empresa no define roles aquí');
end $$;

-- ===== 8. aislamiento entre empresas y no filtración de existencia =====
do $$ begin
  perform t.como('b2@t.co');
  perform t.ok((api.verificar_acceso(t.id('e1'), 'core', 'empresa.ver') ->> 'motivo') = 'sin_membresia', 'otra empresa: sin membresía (no revela si existe)');
  perform t.ok((api.verificar_acceso(gen_random_uuid(), 'core', 'empresa.ver') ->> 'motivo') = 'sin_membresia', 'empresa inexistente: mismo motivo que ajena');
  perform t.ok(api.permisos(t.id('e1'), 'core') = '{}', 'permisos en empresa ajena: vacío');
  perform t.ok(t.falla(format('select api.auditoria_listar(%L)', t.id('e1')), 'CORE_SIN_PERMISO'), 'auditoría ajena: se rechaza');
  perform t.ok(t.falla(format('select api.config_escribir(%L, null, ''k'', ''1''::jsonb)', t.id('e1')), 'CORE_SIN_PERMISO'), 'configuración ajena: se rechaza');
  perform t.ok(t.falla(format('select api.modulo_activar(%L, ''fel'')', t.id('e1')), 'CORE_SIN_PERMISO'), 'activar módulos en empresa ajena: se rechaza');
  perform t.ok(t.falla(format('select api.miembro_estado(%L, %L, ''suspendida'')', t.id('e1'), '00000000-0000-0000-0000-0000000000c1'), 'CORE_SIN_PERMISO'), 'suspender personas de otra empresa: se rechaza');
  perform t.como('d@t.co');
  perform t.ok(t.falla(format('select api.pla_empresa_detalle(%L)', t.id('e1')), 'CORE_PLATAFORMA_REQUERIDA'), 'persona sin empresa no ve detalles de plataforma');
end $$;

-- ===== 9. suspensión inmediata, último propietario, empresa suspendida =====
do $$ begin
  perform t.como('b1@t.co');
  perform t.ok(t.falla(format('select api.miembro_estado(%L, %L, ''suspendida'')', t.id('e1'), '00000000-0000-0000-0000-0000000000b1'), 'CORE_ULTIMO_PROPIETARIO'), 'no se suspende al último propietario');
  perform t.ok(t.falla(format('select api.miembro_roles_asignar(%L, %L, ''[{"modulo":"core","codigo":"lector"}]''::jsonb)', t.id('e1'), '00000000-0000-0000-0000-0000000000b1'), 'CORE_ULTIMO_PROPIETARIO'), 'no se quita el rol al último propietario');
  perform api.miembro_estado(t.id('e1'), '00000000-0000-0000-0000-0000000000c1', 'suspendida');
  perform t.como('c@t.co');
  perform t.ok(api.permisos(t.id('e1'), 'fel') = '{}' and api.permisos(t.id('e1'), 'core') = '{}', 'persona suspendida: sin permisos al instante (aunque su sesión siga viva)');
  perform t.como('b1@t.co'); perform api.miembro_estado(t.id('e1'), '00000000-0000-0000-0000-0000000000c1', 'activa');
  perform t.como('c@t.co'); perform t.ok(array_length(api.permisos(t.id('e1'), 'fel'), 1) = 2, 'reactivada: recupera sus permisos');
  perform t.como('admin@t.co', 'aal2'); perform api.pla_empresa_estado(t.id('e1'), 'suspendida', 'prueba');
  perform t.como('b1@t.co');
  perform t.ok(api.permisos(t.id('e1'), 'core') = '{}' and (api.verificar_acceso(t.id('e1'), 'core', 'empresa.ver') ->> 'motivo') = 'empresa_inactiva', 'empresa suspendida: nadie opera');
  perform t.ok(jsonb_array_length(api.mi_contexto() -> 'empresas') = 1, 'la persona sigue viendo que pertenece a la empresa (estado suspendida)');
  perform t.como('admin@t.co', 'aal2'); perform api.pla_empresa_estado(t.id('e1'), 'activa');
end $$;

-- ===== 10. suscripción: gracia, vencimiento y cambio de plan que suspende módulos =====
do $$ declare s uuid; begin
  perform t.como('admin@t.co', 'aal2');
  perform api.pla_suscripcion_asignar(t.id('e1'), 'basico', 'activa', now() - interval '1 day', false);
  perform t.ok(t.vigente(t.id('e1'), 'fel'), 'vencida hace 1 día, dentro de la gracia de 3 días: sigue vigente');
  perform api.pla_suscripcion_asignar(t.id('e1'), 'basico', 'activa', now() - interval '10 days', false);
  perform t.ok(not t.vigente(t.id('e1'), 'fel'), 'vencida hace 10 días: el módulo deja de estar vigente');
  perform api.pla_suscripcion_asignar(t.id('e1'), 'basico', 'activa', null, false);
  perform t.ok(t.vigente(t.id('e1'), 'fel'), 'renovada: vuelve a estar vigente');
  perform api.pla_plan_definir('{"codigo":"minimo","nombre":"Mínimo","modulos":[{"modulo":"nexa"}]}'::jsonb);
  perform api.pla_suscripcion_asignar(t.id('e1'), 'minimo', 'activa', null, false);
  perform t.ok(not t.vigente(t.id('e1'), 'fel') and t.q(format('select estado from core.empresa_modulos where empresa_id = %L and modulo = ''fel''', t.id('e1'))) = 'suspendido', 'cambio a un plan sin FEL: el módulo se suspende de inmediato');
  perform t.ok(t.q(format('select count(*) from core.aprovisionamientos where empresa_id = %L and modulo = ''fel'' and accion = ''desactivar'' and estado = ''pendiente''', t.id('e1'))) = '1', 'y queda pendiente la desactivación para el módulo');
  perform api.pla_suscripcion_asignar(t.id('e1'), 'completo', 'activa', null, false);
  perform t.ok(t.q(format('select count(*) from core.suscripciones where empresa_id = %L and estado in (''prueba'', ''activa'')', t.id('e1'))) = '1', 'solo una suscripción vigente por empresa');
  perform api.pla_modulo_activar_manual(t.id('e1'), 'hotel');
  perform t.como('b1@t.co');
  perform t.ok(t.falla(format('select api.pla_modulo_activar_manual(%L, ''hotel'')', t.id('e1')), 'CORE_PLATAFORMA_REQUERIDA'), 'la activación manual es solo de plataforma');
end $$;

-- ===== 11. configuración y contexto de empresa para el módulo =====
do $$ declare v jsonb; begin
  perform t.como('b1@t.co');
  perform api.config_escribir(t.id('e1'), null, 'zona', '"America/Guatemala"'::jsonb);
  perform t.ok(api.config_leer(t.id('e1'), null, 'zona') = '"America/Guatemala"'::jsonb, 'configuración de empresa: escribir y leer');
  reset role; update core.empresa_modulos set estado = 'activo' where empresa_id = t.id('e1') and modulo = 'fel'; perform t.como('b1@t.co');
  perform api.config_escribir(t.id('e1'), 'fel', 'ambiente', '"pruebas"'::jsonb);
  perform t.como('c@t.co'); perform t.ok(t.falla(format('select api.config_escribir(%L, null, ''x'', ''1''::jsonb)', t.id('e1')), 'CORE_SIN_PERMISO'), 'sin permiso config.editar: se rechaza');
  perform t.como('b1@t.co', 'aal1', 'fel', 'core_worker');
  v := core_sys.empresa_contexto('fel', t.id('e1'));
  perform t.ok(v -> 'configuracion' ->> 'ambiente' = 'pruebas' and (v -> 'modulo' ->> 'vigente')::boolean, 'el módulo recibe el contexto de su empresa y su configuración');
  perform t.ok(core_sys.empresa_contexto('fel', t.id('e2')) is not null, 'empresa 2 también tiene FEL');
  perform t.como('b1@t.co', 'aal1', 'nexa', 'core_worker');
  perform t.ok(core_sys.empresa_contexto('nexa', t.id('e2')) is null, 'un módulo no ve empresas que no lo tienen');
  perform t.como('b1@t.co', 'aal1', 'fel', 'core_worker');
  perform t.ok((core_sys.verificar_acceso('fel', t.id('e1'), '00000000-0000-0000-0000-0000000000c1', 'documentos.ver') ->> 'permitido')::boolean, 'un módulo consulta si una persona puede hacer algo en su empresa');
  perform t.ok(not (core_sys.verificar_acceso('fel', t.id('e1'), '00000000-0000-0000-0000-0000000000d1', 'documentos.ver') ->> 'permitido')::boolean, 'persona sin membresía: denegado');
end $$;

-- ===== 12. auditoría de solo-añadir y paginación =====
do $$ declare n int; j jsonb; begin
  perform t.como('b1@t.co');
  j := api.auditoria_listar(t.id('e1'), null, 5);
  perform t.ok(jsonb_array_length(j) = 5 and (j -> 0 ->> 'id')::bigint > (j -> 1 ->> 'id')::bigint, 'auditoría paginada de más reciente a más antigua');
  perform t.ok(jsonb_array_length(api.auditoria_listar(t.id('e1'), (j -> 4 ->> 'id')::bigint, 100)) > 0, 'siguiente página por clave (sin desplazamiento)');
  perform t.ok(not (api.auditoria_listar(t.id('e1'), null, 200)::text like '%password%'), 'la auditoría no contiene contraseñas');
  reset role;
  perform t.ok(t.falla('update core.auditoria set accion = ''x''', 'CORE_AUDITORIA_INMUTABLE'), 'auditoría: no se modifica (ni como propietario)');
  perform t.ok(t.falla('delete from core.auditoria', 'CORE_AUDITORIA_INMUTABLE'), 'auditoría: no se borra');
  perform t.ok(t.falla('truncate core.auditoria', 'CORE_AUDITORIA_INMUTABLE'), 'auditoría: no se vacía');
  perform t.como('admin@t.co', 'aal2');
  perform t.ok(jsonb_array_length(api.pla_auditoria_listar(t.id('e1'), null, 10)) = 10, 'auditoría de plataforma por empresa');
  perform t.ok(jsonb_array_length(api.pla_empresas_listar(null, 1)) = 1 and jsonb_array_length(api.pla_empresas_listar('uno')) = 1, 'listado de empresas paginado y con búsqueda');
end $$;

-- ===== 13. registro público apagado por omisión y aprovisionamiento con reintentos =====
do $$ declare a uuid; r jsonb; i int; begin
  perform t.como('d@t.co');
  perform t.ok(t.falla('select api.empresa_registrar(''Mi empresa'')', 'CORE_REGISTRO_NO_HABILITADO'), 'el registro público está apagado por omisión');
  perform t.como('admin@t.co', 'aal2'); perform api.pla_parametro_definir('registro_publico', 1);
  perform t.como('d@t.co'); a := api.empresa_registrar('Mi empresa'); perform t.ok(a is not null and api.permisos(a, 'core') @> array['modulos.gestionar'], 'con el registro público activo, quien registra queda propietario');
  perform t.como('admin@t.co', 'aal2'); perform api.pla_parametro_definir('registro_publico', 0);
  perform t.como('b2@t.co'); perform api.modulo_desactivar(t.id('e2'), 'pos');
  for i in 1..5 loop
    perform t.como('b2@t.co', 'aal1', 'pos', 'core_worker'); r := core_sys.aprov_tomar('pos', 5);
    exit when jsonb_array_length(r) = 0;
    perform core_sys.aprov_completar('pos', (r -> 0 ->> 'id')::uuid, false, 'sin conexión');
  end loop;
  reset role;
  perform t.ok((select estado from core.aprovisionamientos where empresa_id = t.id('e2') and modulo = 'pos' and accion = 'desactivar') = 'fallido' and (select intentos from core.aprovisionamientos where empresa_id = t.id('e2') and modulo = 'pos' and accion = 'desactivar') = 5, 'tras 5 intentos fallidos la solicitud queda «fallida» y no se reintenta');
  perform t.ok((select count(*) from core.eventos where tipo = 'modulo_error_aprovisionamiento') >= 1, 'se emite el evento de error de aprovisionamiento');
end $$;

-- ===== 14. inventario de seguridad =====
do $$ declare mal int; begin
  perform t.como(null); reset role;
  select count(*) into mal from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('core', 'api', 'core_sys') and p.prokind = 'f'
    and (not p.prosecdef or p.proconfig is null or not (p.proconfig::text like '%search_path=""%' or p.proconfig::text like '%search_path=%'));
  perform t.ok(mal = 0, 'todas las funciones de CORE son SECURITY DEFINER con search_path fijo (' || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('core', 'api', 'core_sys')) || ' funciones)');
  select count(*) into mal from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('core', 'api', 'core_sys') and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'));
  perform t.ok(mal = 0, 'ninguna función de CORE es ejecutable por anon ni por público');
  select count(*) into mal from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'core' and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('core_worker', p.oid, 'execute'));
  perform t.ok(mal = 0, 'las funciones internas (core.*) no son ejecutables por authenticated ni por los módulos');
  select count(*) into mal from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' and (not has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('core_worker', p.oid, 'execute'));
  perform t.ok(mal = 0, 'la API de personas (api.*) es solo de authenticated');
  select count(*) into mal from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'core_sys' and (has_function_privilege('authenticated', p.oid, 'execute') or not has_function_privilege('core_worker', p.oid, 'execute'));
  perform t.ok(mal = 0, 'la API de módulos (core_sys.*) es solo de core_worker');
  select count(*) into mal from pg_tables where schemaname = 'core' and not rowsecurity;
  perform t.ok(mal = 0, 'RLS activa en todas las tablas de core');
  select count(*) into mal from information_schema.role_table_grants where table_schema = 'core' and grantee in ('anon', 'authenticated', 'public', 'core_worker');
  perform t.ok(mal = 0, 'ningún privilegio directo sobre tablas para anon, authenticated, público ni módulos');
end $$;
select 'PRUEBAS DE CORE OK' as resultado;
