-- Pruebas COMO nexa_app (conexión real) de las funciones con sesión validada: suplantación, otra empresa, MFA, permisos, establecimientos y maestro. Se ejecuta con: psql -U nexa_app -f prueba-sesion-admin.sql
\set ON_ERROR_STOP on
create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_ok boolean := false;
begin begin execute p_sql; exception when others then v_ok := (sqlerrm ~ p_patron) or (sqlstate ~ p_patron); end;
  if not v_ok then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if; end $$;
create temp table k (u text primary key, tok text);
insert into k values ('maestro', 'tok-maestro-0123456789abcdef'), ('maestro2', 'tok-maestro2-0123456789abcdef'), ('propa', 'tok-propa-0123456789abcdef'), ('propa2', 'tok-propa2-0123456789abcdef'), ('admina', 'tok-admina-0123456789abcdef'),
  ('facta', 'tok-facta-0123456789abcdef'), ('factb', 'tok-factb-0123456789abcdef'), ('superv', 'tok-superv-0123456789abcdef'), ('lectora', 'tok-lectora-0123456789abcdef'), ('bajaa', 'tok-bajaa-0123456789abcdef'),
  ('propb', 'tok-propb-0123456789abcdef'), ('factbemp', 'tok-factbemp-0123456789abcdef'), ('vencida', 'tok-vencida-0123456789abcdef');
create or replace function pg_temp.t(p_u text) returns text language sql as $$ select tok from k where u = p_u $$;
create or replace function pg_temp.id(p_n text) returns uuid language sql as $$ select case p_n when 'e10' then e10 when 'e20' then e20 else eb end from public.zz_ids $$;

-- 1) la identidad sale de la sesión: contexto de cada persona
do $$ declare c jsonb; begin
  c := public.fel_adm_contexto(pg_temp.t('facta'));
  assert c ->> 'empresa_id' = '10000000-0000-0000-0000-00000000000a' and c ->> 'user_id' = '00000000-0000-0000-0000-0000000000c3', 'facta: su persona y su empresa, derivadas de la sesión';
  assert (c -> 'alcance' -> 'ids' ->> 0)::uuid = pg_temp.id('e10') and jsonb_array_length(c -> 'alcance' -> 'ids') = 1 and (c ->> 'establecimiento_activo')::uuid = pg_temp.id('e10'), 'facta: UN establecimiento, el 10, activo y único';
  c := public.fel_adm_contexto(pg_temp.t('factb')); assert (c ->> 'establecimiento_activo')::uuid = pg_temp.id('e20'), 'factb: el 20';
  c := public.fel_adm_contexto(pg_temp.t('superv')); assert jsonb_array_length(c -> 'alcance' -> 'ids') = 2 and (c -> 'alcance' ->> 'multiples') = 'true', 'supervisor: ambos';
  c := public.fel_adm_contexto(pg_temp.t('propb')); assert c ->> 'empresa_id' = '10000000-0000-0000-0000-00000000000b', 'propb: empresa B';
end $$;
-- 2) sin sesión válida no hay identidad
select pg_temp.espera_error($$select public.fel_adm_contexto(null)$$, 'sesión no válida|sin identidad');
select pg_temp.espera_error($$select public.fel_adm_contexto('corto')$$, 'sesión no válida');
select pg_temp.espera_error($$select public.fel_adm_contexto('tok-inexistente-0123456789abcdef')$$, 'sesión no válida');
select pg_temp.espera_error($$select public.fel_adm_contexto(pg_temp.t('vencida'))$$, 'sesión no válida');   -- vencida
select pg_temp.espera_error($$select public.fel_adm_contexto(pg_temp.t('bajaa'))$$, 'sesión no válida');   -- cuenta desactivada
select pg_temp.espera_error($$select public.fel_adm_contexto(encode(sha256(convert_to(pg_temp.t('facta'), 'UTF8')), 'hex'))$$, 'sesión no válida');   -- el hash guardado NO sirve como token
-- 3) ni una sola función de empresa recibe actor o empresa como parámetro (la identidad no es manipulable); las del maestro solo la empresa OBJETIVO
do $$ begin
  assert not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'fel\_adm\_%' and (p.proargnames @> array['p_actor'] or p.proargnames @> array['p_user'])), 'ninguna fel_adm_* recibe el actor';
  assert not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'fel\_adm\_%' and p.proname not in ('fel_adm_acceso_solicitar','fel_adm_datos_excepcionales_documentos','fel_adm_datos_excepcionales_configuracion') and p.proargnames @> array['p_empresa']), 'solo las del maestro nombran una empresa objetivo';
end $$;
-- 4) las funciones internas con actor/empresa como parámetro NO son ejecutables por el rol de la aplicación
select pg_temp.espera_error($$select public.fel_op_asignacion_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3', pg_temp.id('e20'), true, 'suplantación')$$, 'permission denied|42501');
select pg_temp.espera_error($$select public.fel_op_digifact_conectar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', '5888492', decode(repeat('ab', 40), 'hex'), 1::smallint, 0)$$, 'permission denied|42501');
select pg_temp.espera_error($$select public.fel_op_emisor_aprobar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', pg_temp.id('e10'), 1, 'aaaaaaaaaaaaaaaa')$$, 'permission denied|42501');
select pg_temp.espera_error($$select public.fel_admin_acceso_solicitar('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'documentos', 'Intento de suplantar al maestro', '00000000-0000-0000-0000-0000000000a2', 2)$$, 'permission denied|42501');
select pg_temp.espera_error($$select * from public.fel__sesion(pg_temp.t('propa'))$$, 'permission denied|42501');
select pg_temp.espera_error($$select public.fel_alcance('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c3')$$, 'permission denied|42501');
-- RIESGO RESIDUAL CONOCIDO R1 (documentado en ETAPA-1-DISENO.md): hoy el rol de la aplicación crea y lee sesiones (el inicio de sesión de la demostración es de la aplicación); quien controle ese rol podría fabricar una sesión.
-- Lo que SÍ impiden estas funciones: que un parámetro manipulado, un error del código o una inyección SQL que no fabrique sesiones suplante a otra persona o empresa. La solución de fondo es Supabase Auth con MFA (JWT validado por la base).
do $$ begin assert has_table_privilege('nexa_app', 'public.demo_sesiones', 'insert') and has_table_privilege('nexa_app', 'public.demo_sesiones', 'select'), 'estado conocido: la aplicación crea sesiones (R1)'; end $$;
select pg_temp.espera_error($$select * from public.sesion_establecimiento_activo$$, 'permission denied|42501');   -- ni siquiera lee la tabla del establecimiento activo
-- 5) asignaciones: solo quien tiene el permiso, solo en SU empresa (la que sale de la sesión)
select pg_temp.espera_error($$select public.fel_adm_asignar(pg_temp.t('facta'), '00000000-0000-0000-0000-0000000000c3', pg_temp.id('e20'), true, 'cambio por mi cuenta')$$, 'FEL_NO_AUTORIZADO');   -- un facturador no se reasigna
select pg_temp.espera_error($$select public.fel_adm_asignar(pg_temp.t('lectora'), '00000000-0000-0000-0000-0000000000c3', pg_temp.id('e20'), true, 'x')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_adm_asignar(pg_temp.t('propb'), '00000000-0000-0000-0000-0000000000c3', pg_temp.id('e20'), true, 'x')$$, 'FEL_REGLA');   -- el propietario de B apunta a un usuario de A: su empresa (B) no lo conoce
select pg_temp.espera_error($$select public.fel_adm_asignar(pg_temp.t('propa'), '00000000-0000-0000-0000-0000000000d2', pg_temp.id('e10'), true, 'x')$$, 'FEL_REGLA');   -- el propietario de A apunta a un usuario de B
select pg_temp.espera_error($$select public.fel_adm_asignar(pg_temp.t('propa'), '00000000-0000-0000-0000-0000000000c3', pg_temp.id('eb'), true, 'x')$$, 'FEL_REGLA');   -- establecimiento de B
select pg_temp.espera_error($$select public.fel_adm_asignar(pg_temp.t('maestro'), '00000000-0000-0000-0000-0000000000c3', pg_temp.id('e20'), true, 'x')$$, 'FEL_NO_AUTORIZADO');   -- la sesión de la plataforma no opera dentro de una empresa
select pg_temp.espera_error($$select public.fel_adm_asignar('tok-inexistente-0123456789abcdef', '00000000-0000-0000-0000-0000000000c3', pg_temp.id('e20'), true, 'x')$$, 'sesión no válida');
select public.fel_adm_asignar(pg_temp.t('admina'), '00000000-0000-0000-0000-0000000000c2', pg_temp.id('e10'), true, 'el administrador asigna a la lectora');   -- sí puede (permiso + su empresa)
do $$ begin assert (public.fel_adm_contexto(pg_temp.t('lectora')) -> 'alcance' -> 'ids' ->> 0)::uuid = pg_temp.id('e10'), 'la asignación rige de inmediato'; end $$;
-- 6) establecimiento activo: el facturador no puede cambiarlo; el supervisor sí, dentro de lo asignado y auditado
select pg_temp.espera_error($$select public.fel_adm_establecimiento_activo(pg_temp.t('facta'), pg_temp.id('e20'))$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_adm_establecimiento_activo(pg_temp.t('superv'), pg_temp.id('eb'))$$, 'FEL_REGLA');
select public.fel_adm_establecimiento_activo(pg_temp.t('superv'), pg_temp.id('e20'));
do $$ begin assert (public.fel_adm_contexto(pg_temp.t('superv')) ->> 'establecimiento_activo')::uuid = pg_temp.id('e20'), 'el cambio explícito del supervisor rige'; assert (public.fel_adm_contexto(pg_temp.t('facta')) ->> 'establecimiento_activo')::uuid = pg_temp.id('e10'), 'el del facturador no cambió'; end $$;
-- 7) emisor por establecimiento: configura quien puede; aprueba solo el propietario; nadie toca otro establecimiento ni otra empresa
select pg_temp.espera_error($$select public.fel_adm_emisor_guardar(pg_temp.t('facta'), pg_temp.id('e10'), '1111111', 'Empresa A, S.A.', null, 'GEN', '[]', null, 'Calle 1', '01001', 'Guatemala', 'Guatemala', 'aaaaaaaaaaaaaaaa')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_adm_emisor_guardar(pg_temp.t('admina'), pg_temp.id('eb'), '1111111', 'Empresa A, S.A.', null, 'GEN', '[]', null, 'Calle 1', '01001', 'Guatemala', 'Guatemala', 'aaaaaaaaaaaaaaaa')$$, 'FEL_REGLA');   -- establecimiento de B
select public.fel_adm_emisor_guardar(pg_temp.t('admina'), pg_temp.id('e10'), '1111111', 'Empresa A, S.A.', null, 'GEN', '[{"tipo":1,"escenario":2}]', null, 'Calle 1', '01001', 'Guatemala', 'Guatemala', 'aaaaaaaaaaaaaaaa');
select public.fel_adm_emisor_guardar(pg_temp.t('admina'), pg_temp.id('e20'), '1111111', 'Empresa A, S.A.', 'Sucursal 20', 'GEN', '[{"tipo":1,"escenario":2}]', null, 'Calle 20', '01002', 'Guatemala', 'Guatemala', 'bbbbbbbbbbbbbbbb');
select pg_temp.espera_error($$select public.fel_adm_emisor_aprobar(pg_temp.t('admina'), pg_temp.id('e10'), 1, 'aaaaaaaaaaaaaaaa')$$, 'FEL_NO_AUTORIZADO');   -- el administrador no aprueba
select pg_temp.espera_error($$select public.fel_adm_emisor_aprobar(pg_temp.t('propa'), pg_temp.id('e10'), 1, 'bbbbbbbbbbbbbbbb')$$, 'FEL_REGLA');   -- huella equivocada
select public.fel_adm_emisor_aprobar(pg_temp.t('propa'), pg_temp.id('e10'), 1, 'aaaaaaaaaaaaaaaa');
select public.fel_adm_emisor_aprobar(pg_temp.t('propa'), pg_temp.id('e20'), 1, 'bbbbbbbbbbbbbbbb');
select pg_temp.espera_error($$select public.fel_adm_emisor_aprobar(pg_temp.t('propb'), pg_temp.id('e10'), 1, 'aaaaaaaaaaaaaaaa')$$, 'FEL_NO_ENCONTRADO|FEL_NO_AUTORIZADO');   -- B no aprueba el de A
-- 8) Digifact: credenciales y servicios exigen MFA; la prueba y los interruptores siguen el flujo; nada se ve en el estado
select pg_temp.espera_error($$select public.fel_adm_digifact_conectar(pg_temp.t('propa2'), '5888492', decode(repeat('ab', 40), 'hex'), 1::smallint, 0)$$, 'MFA');   -- propietario SIN MFA
select pg_temp.espera_error($$select public.fel_adm_digifact_conectar(pg_temp.t('admina'), '5888492', decode(repeat('ab', 40), 'hex'), 1::smallint, 0)$$, 'MFA|FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_adm_digifact_conectar(pg_temp.t('propb'), '5888492', decode(repeat('ab', 40), 'hex'), 1::smallint, 5)$$, 'FEL_CONFLICTO');   -- versión que no es la de SU empresa
select public.fel_adm_digifact_conectar(pg_temp.t('propa'), '5888492', decode(repeat('ab', 40), 'hex'), 1::smallint, 0);
select pg_temp.espera_error($$select public.fel_adm_digifact_conectar(pg_temp.t('propb'), '5888492', decode(repeat('cd', 40), 'hex'), 1::smallint, 0)$$, '23505|unique|duplicate');   -- el NIT de Digifact no se comparte entre empresas
select pg_temp.espera_error($$select public.fel_adm_digifact_registrar_prueba(pg_temp.t('facta'), true)$$, 'FEL_NO_AUTORIZADO');
select public.fel_adm_digifact_registrar_prueba(pg_temp.t('admina'), true);
select pg_temp.espera_error($$select public.fel_adm_digifact_interruptores(pg_temp.t('propa2'), true, true, true, false, 2)$$, 'MFA');
select public.fel_adm_digifact_interruptores(pg_temp.t('propa'), true, true, true, false, (public.fel_adm_estado(pg_temp.t('propa')) -> 'digifact' ->> 'version')::integer);
do $$ declare e jsonb; begin
  e := public.fel_adm_estado(pg_temp.t('propa'));
  assert e -> 'digifact' ->> 'estado' = 'activo' and (e -> 'digifact' ->> 'certificar') = 'true', 'estado activo con certificación';
  assert jsonb_array_length(e -> 'emisores') = 2 and e -> 'asignaciones' is not null, 'dos emisores aprobados y las asignaciones visibles para quien puede asignarlas';
  assert e::text !~* '(credencial_cifrada|llave_version|abababab|password|secret)', 'el estado jamás revela credenciales ni versiones de llave';
  assert (public.fel_adm_estado(pg_temp.t('admina')) -> 'asignaciones') is not null, 'el administrador ve las asignaciones';
end $$;
do $$ declare e jsonb; begin e := public.fel_adm_estado(pg_temp.t('facta')); assert jsonb_typeof(e -> 'asignaciones') = 'null', 'un facturador no ve las asignaciones de los demás'; assert e::text !~* '(credencial_cifrada|llave_version|abababab)', 'ni credenciales'; end $$;
select pg_temp.espera_error($$select public.fel_adm_estado(pg_temp.t('maestro'))$$, 'FEL_NO_AUTORIZADO');
do $$ begin assert jsonb_typeof(public.fel_adm_estado(pg_temp.t('propb')) -> 'digifact') = 'null', 'B no ve la conexión de A (la suya está sin configurar)'; end $$;
-- 9) maestro con la identidad de SU sesión: resumen, acceso excepcional controlado
select pg_temp.espera_error($$select * from public.fel_adm_empresas_resumen(pg_temp.t('propa'))$$, 'FEL_NO_AUTORIZADO');   -- una empresa no usa funciones de la plataforma
do $$ begin assert (select count(*) from public.fel_adm_empresas_resumen(pg_temp.t('maestro'))) >= 2, 'el maestro ve el resumen'; end $$;
select pg_temp.espera_error($$select * from public.fel_adm_datos_excepcionales_documentos(pg_temp.t('maestro'), '10000000-0000-0000-0000-00000000000a')$$, 'FEL_NO_AUTORIZADO');   -- sin acceso vigente
select pg_temp.espera_error($$select public.fel_adm_acceso_solicitar(pg_temp.t('maestro'), '10000000-0000-0000-0000-00000000000a', 'documentos', 'Revisión por ticket 321 de soporte', '00000000-0000-0000-0000-0000000000a1', 2)$$, 'FEL_REGLA');   -- no se aprueba a sí mismo
select pg_temp.espera_error($$select public.fel_adm_acceso_solicitar(pg_temp.t('propa'), '10000000-0000-0000-0000-00000000000a', 'documentos', 'Revisión por ticket 321 de soporte', '00000000-0000-0000-0000-0000000000a2', 2)$$, 'FEL_NO_AUTORIZADO');
select public.fel_adm_acceso_solicitar(pg_temp.t('maestro'), '10000000-0000-0000-0000-00000000000a', 'configuracion', 'Revisión de la configuración por ticket 322', '00000000-0000-0000-0000-0000000000a2', 1);
do $$ declare j jsonb; begin j := public.fel_adm_datos_excepcionales_configuracion(pg_temp.t('maestro'), '10000000-0000-0000-0000-00000000000a'); assert j::text !~* '(credencial_cifrada|llave_version|abababab)', 'la lectura excepcional jamás devuelve credenciales'; end $$;
select pg_temp.espera_error($$select public.fel_adm_datos_excepcionales_configuracion(pg_temp.t('maestro2'), '10000000-0000-0000-0000-00000000000a')$$, 'FEL_NO_AUTORIZADO');   -- el permiso es de quien lo pidió
select 'PRUEBAS DE SESIÓN VALIDADA OK' as resultado;
