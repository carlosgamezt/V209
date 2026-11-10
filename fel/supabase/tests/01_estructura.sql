-- Pruebas de estructura y protecciones. Se ejecutan con psql (ON_ERROR_STOP): cualquier fallo corta con error.
-- Todo corre dentro de una transacción que se deshace al final; no deja datos.
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_ok boolean := false;
begin
  begin
    execute p_sql;
  exception when others then
    v_ok := (sqlerrm ~ p_patron) or (sqlstate ~ p_patron);
  end;
  if not v_ok then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if;
end $$;

-- ---------------------------------------------------------------- datos de apoyo
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'maestro@fel.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'prop@fel.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'admin@fel.test'),
  ('00000000-0000-0000-0000-0000000000b3', 'emisor@fel.test'),
  ('00000000-0000-0000-0000-0000000000b4', 'otro@fel.test');
insert into public.plataforma_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1');

-- 1. RLS activo en todas las tablas de public
do $$ declare n int; begin
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  assert n = 0, 'hay tablas sin RLS: ' || n;
end $$;

-- 2. anon y authenticated no tienen permisos de escritura en ninguna tabla; anon no lee nada
do $$ declare t record; begin
  for t in select c.oid::regclass::text as nombre from pg_class c join pg_namespace s on s.oid = c.relnamespace
            where s.nspname = 'public' and c.relkind = 'r' loop
    assert not has_table_privilege('anon', t.nombre, 'INSERT,UPDATE,DELETE,SELECT'), 'anon con permisos en ' || t.nombre;
    assert not has_table_privilege('authenticated', t.nombre, 'INSERT,UPDATE,DELETE'), 'authenticated escribe en ' || t.nombre;
  end loop;
  assert not has_table_privilege('authenticated', 'public.contadores_borrador', 'SELECT'), 'authenticated lee contadores';
end $$;

-- 3. funciones de escritura: solo service_role
do $$ begin
  assert not has_function_privilege('authenticated', 'public.fel_admin_empresa_crear(uuid,text,text,text,uuid)', 'EXECUTE'), 'authenticated ejecuta fel_admin_empresa_crear';
  assert not has_function_privilege('anon', 'public.fel_auditar(uuid,uuid,text,text,text,jsonb,text)', 'EXECUTE'), 'anon ejecuta fel_auditar';
  assert not has_function_privilege('authenticated', 'public.fel_auditar(uuid,uuid,text,text,text,jsonb,text)', 'EXECUTE'), 'authenticated ejecuta fel_auditar';
  assert has_function_privilege('service_role', 'public.fel_auditar(uuid,uuid,text,text,text,jsonb,text)', 'EXECUTE'), 'service_role no ejecuta fel_auditar';
end $$;

-- 4. auditoría append-only
select public.fel_auditar(null, '00000000-0000-0000-0000-0000000000a1', 'prueba.evento', 'plataforma', null, '{"x":1}');
select pg_temp.espera_error($$update public.auditoria set accion = 'x'$$, 'FEL_APPEND_ONLY');
select pg_temp.espera_error($$delete from public.auditoria$$, 'FEL_APPEND_ONLY');
select pg_temp.espera_error($$truncate public.auditoria$$, 'FEL_APPEND_ONLY');
do $$ begin
  assert not has_table_privilege('service_role', 'public.auditoria', 'UPDATE'), 'service_role puede actualizar auditoría';
  assert not has_table_privilege('service_role', 'public.auditoria', 'DELETE'), 'service_role puede borrar auditoría';
  assert (select actor_email from public.auditoria order by id desc limit 1) = 'maestro@fel.test', 'auditoría sin correo del actor';
  assert (select ocurrido_en from public.auditoria order by id desc limit 1) is not null, 'auditoría sin fecha';
end $$;

-- 5. régimen: las semillas nacen sin verificar y sin reglas; no se pueden verificar incompletas
do $$ begin
  assert (select count(*) from public.regimenes_fiscales where estado = 'sin_verificar' and codigo in ('general','pequeno_contribuyente')) = 2, 'faltan regímenes semilla';
  assert (select count(*) from public.regimenes_fiscales where reglas ? 'impuestos') = 0, 'las semillas no deben traer impuestos';
end $$;
select pg_temp.espera_error($$update public.regimenes_fiscales set estado = 'verificado', verificado_por = '00000000-0000-0000-0000-0000000000a1', verificado_en = now(), fuente = 'Referencia normativa X', vigente_desde = current_date where codigo = 'general'$$, 'FEL_REGLA');

-- régimen de prueba completo: se puede verificar y luego es inmutable
insert into public.regimenes_fiscales (codigo, version, nombre, reglas, fuente, vigente_desde)
values ('prueba_reg', 1, 'Régimen de prueba',
        '{"esquema":1,"impuestos":[],"precios_incluyen_impuesto":false,"redondeo":{"modo":"half_up","decimales":2}}', 'Referencia de prueba', current_date);
update public.regimenes_fiscales set estado = 'verificado', verificado_por = '00000000-0000-0000-0000-0000000000a1', verificado_en = now() where codigo = 'prueba_reg';
select pg_temp.espera_error($$update public.regimenes_fiscales set reglas = '{"esquema":1}' where codigo = 'prueba_reg'$$, 'FEL_REGLA');
select pg_temp.espera_error($$delete from public.regimenes_fiscales where codigo = 'prueba_reg'$$, 'FEL_REGLA');

-- 6. empresa: emisión real solo con empresa habilitada, régimen verificado y autorización
insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id)
select '10000000-0000-0000-0000-000000000001', 'Empresa Uno', 'Empresa Uno S.A.', '1234567-8', id from public.regimenes_fiscales where codigo = 'general';
update public.empresas set estado = 'habilitada' where id = '10000000-0000-0000-0000-000000000001';
-- (el interruptor global de emisión se abre aquí solo para probar las demás reglas; ver 06_seguridad.sql para su bloqueo)
update public.plataforma_config set valor = true where clave = 'emision_real_disponible';
select pg_temp.espera_error($$update public.empresas set emision_real_habilitada = true, emision_autorizada_por = '00000000-0000-0000-0000-0000000000a1', emision_autorizada_en = now() where id = '10000000-0000-0000-0000-000000000001'$$, 'FEL_REGLA');
-- con régimen verificado pero sin autorización: también falla
update public.empresas set regimen_id = (select id from public.regimenes_fiscales where codigo = 'prueba_reg')
 where id = '10000000-0000-0000-0000-000000000001';
select pg_temp.espera_error($$update public.empresas set emision_real_habilitada = true where id = '10000000-0000-0000-0000-000000000001'$$, 'FEL_REGLA');
-- vía correcta (función atómica del maestro): funciona y queda auditada
select public.fel_admin_emision('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', true, 'Prueba de emisión');
do $$ begin
  assert (select emision_real_habilitada from public.empresas where id = '10000000-0000-0000-0000-000000000001'), 'emisión no habilitada';
  assert exists (select 1 from public.auditoria where accion = 'empresa.emision_habilitada'), 'sin auditoría de emisión';
end $$;
-- con emisión real no se cambia el régimen ni se obsolece el régimen
select pg_temp.espera_error($$select public.fel_admin_empresa_regimen('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', (select id from public.regimenes_fiscales where codigo = 'general'), 'Intento de cambio')$$, 'FEL_REGLA');
select pg_temp.espera_error($$update public.regimenes_fiscales set estado = 'obsoleto' where codigo = 'prueba_reg'$$, 'FEL_REGLA');
-- suspender la empresa apaga la emisión automáticamente
select public.fel_admin_empresa_estado('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', 'suspendida', 'Prueba de suspensión');
do $$ begin
  assert not (select emision_real_habilitada from public.empresas where id = '10000000-0000-0000-0000-000000000001'), 'la suspensión no apagó la emisión';
end $$;
select public.fel_admin_empresa_estado('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', 'habilitada', 'Reactivación de prueba');

-- 7. solo el administrador maestro ejecuta las operaciones de plataforma
select pg_temp.espera_error($$select public.fel_admin_empresa_crear('00000000-0000-0000-0000-0000000000b1', 'X', 'X', '1234-5', (select id from public.regimenes_fiscales limit 1))$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_admin_empresa_estado('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-000000000001', 'suspendida', 'Intento no autorizado')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_admin_regimen_verificar('00000000-0000-0000-0000-0000000000b1', (select id from public.regimenes_fiscales limit 1), 'x', 'Intento no autorizado')$$, 'FEL_NO_AUTORIZADO');
-- los cambios críticos exigen motivo
select pg_temp.espera_error($$select public.fel_admin_empresa_estado('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', 'suspendida', '')$$, 'FEL_REGLA');

-- 8. membresías: jerarquía, no escalar permisos, al menos un propietario
insert into public.miembros (empresa_id, user_id, rol) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'propietario'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', 'administrador'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b3', 'emisor');
select pg_temp.espera_error($$update public.miembros set activo = false where user_id = '00000000-0000-0000-0000-0000000000b1'$$, 'FEL_REGLA');
select pg_temp.espera_error($$update public.miembros set rol = 'lector' where user_id = '00000000-0000-0000-0000-0000000000b1'$$, 'FEL_REGLA');
-- el emisor no gestiona usuarios
select pg_temp.espera_error($$select public.fel_op_invitacion_registrar('00000000-0000-0000-0000-0000000000b3', '10000000-0000-0000-0000-000000000001', 'nuevo@fel.test', 'lector', '{}')$$, 'FEL_NO_AUTORIZADO');
-- el administrador no asigna rol igual o superior
select pg_temp.espera_error($$select public.fel_op_invitacion_registrar('00000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-000000000001', 'nuevo@fel.test', 'administrador', '{}')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_invitacion_registrar('00000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-000000000001', 'nuevo@fel.test', 'propietario', '{}')$$, 'FEL_NO_AUTORIZADO');
-- sí puede invitar a un lector
select public.fel_op_invitacion_registrar('00000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-000000000001', 'Nuevo@Fel.Test', 'lector', '{}');
do $$ begin assert (select email from public.invitaciones order by creado_en desc limit 1) = 'nuevo@fel.test', 'el correo no se normalizó'; end $$;
-- no puede modificar a otro administrador/propietario, ni a sí mismo
select pg_temp.espera_error($$select public.fel_op_miembro_actualizar('00000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'lector')$$, 'FEL_NO_AUTORIZADO');
select pg_temp.espera_error($$select public.fel_op_miembro_actualizar('00000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', 'propietario')$$, 'FEL_NO_AUTORIZADO');
-- un administrador sin un permiso no puede concederlo a otros
update public.miembros set permisos_revocados = array['auditoria.ver'] where user_id = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.espera_error($$select public.fel_op_miembro_actualizar('00000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b3', null, array['auditoria.ver'])$$, 'FEL_NO_AUTORIZADO');
-- sí puede conceder uno que tiene; queda auditado con antes y después
select public.fel_op_miembro_actualizar('00000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b3', null, array['borradores.revisar']);
do $$ begin
  assert 'borradores.revisar' = any (public.fel_permisos_efectivos('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b3')), 'el emisor no recibió el permiso extra';
  assert exists (select 1 from public.auditoria where accion = 'miembro.actualizar' and datos ? 'antes' and datos ? 'despues'), 'auditoría de miembro incompleta';
  assert not ('usuarios.gestionar' = any (public.fel_permisos_efectivos('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b3'))), 'el emisor no debe gestionar usuarios';
end $$;

-- 9. aceptar invitaciones: crea la membresía; una vencida no
do $$ declare n int; begin
  n := public.fel_op_invitacion_aceptar('00000000-0000-0000-0000-0000000000b4', 'nuevo@fel.test');
  assert n = 1, 'debía aceptar 1 invitación, aceptó ' || n;
  assert exists (select 1 from public.miembros where user_id = '00000000-0000-0000-0000-0000000000b4' and rol = 'lector' and activo), 'no se creó la membresía';
end $$;
insert into public.invitaciones (empresa_id, email, rol, expira_en)
values ('10000000-0000-0000-0000-000000000001', 'tarde@fel.test', 'lector', now() - interval '1 day');
do $$ declare n int; begin
  n := public.fel_op_invitacion_aceptar('00000000-0000-0000-0000-0000000000b4', 'tarde@fel.test');
  assert n = 0, 'una invitación vencida no debe aceptarse';
  assert (select estado from public.invitaciones where email = 'tarde@fel.test') = 'vencida', 'no se marcó vencida';
end $$;

-- 10. documentos: datos fiscales vacíos salvo certificado verificado; borrador interno por empresa
insert into public.documentos (id, empresa_id, numero_borrador) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 1);
select pg_temp.espera_error($$update public.documentos set serie = 'A' where id = '20000000-0000-0000-0000-000000000001'$$, '23514|documentos_datos_fiscales_chk');
select pg_temp.espera_error($$update public.documentos set numero_fiscal = '1' where id = '20000000-0000-0000-0000-000000000001'$$, '23514|documentos_datos_fiscales_chk');
select pg_temp.espera_error($$update public.documentos set autorizacion_sat = 'X' where id = '20000000-0000-0000-0000-000000000001'$$, '23514|documentos_datos_fiscales_chk');
-- el estado fiscal no se cambia con un UPDATE directo, ni siquiera con la clave de servicio
select pg_temp.espera_error($$update public.documentos set estado_fiscal = 'certificado' where id = '20000000-0000-0000-0000-000000000001'$$, 'FEL_REGLA|23514');
select pg_temp.espera_error($$update public.documentos set estado_fiscal = 'invalido' where id = '20000000-0000-0000-0000-000000000001'$$, 'FEL_REGLA|23514');
select pg_temp.espera_error($$update public.documentos set estado_preparacion = 'anulado' where id = '20000000-0000-0000-0000-000000000001'$$, 'FEL_REGLA|23514');
select pg_temp.espera_error($$insert into public.documentos (empresa_id, numero_borrador) values ('10000000-0000-0000-0000-000000000001', 1)$$, '23505');
select pg_temp.espera_error($$delete from public.documentos$$, 'FEL_REGLA');
-- el historial de estados también es append-only
insert into public.documento_estados (documento_id, empresa_id, eje, anterior, nuevo)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'preparacion', null, 'borrador');
select pg_temp.espera_error($$update public.documento_estados set nuevo = 'revisado'$$, 'FEL_APPEND_ONLY');
select pg_temp.espera_error($$delete from public.documento_estados$$, 'FEL_APPEND_ONLY');
-- integridad entre empresas: una línea no puede apuntar a un documento de otra empresa
insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id)
select '10000000-0000-0000-0000-000000000002', 'Empresa Dos', 'Empresa Dos S.A.', '7654321-K', id from public.regimenes_fiscales where codigo = 'general';
select pg_temp.espera_error($$insert into public.documento_lineas (documento_id, empresa_id, orden, descripcion, cantidad, precio_unitario) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 1, 'x', 1, 1)$$, '23503');

-- 11. contador de borradores independiente por empresa
do $$ begin
  assert public.fel_siguiente_borrador('10000000-0000-0000-0000-000000000001') = 1, 'contador A';
  assert public.fel_siguiente_borrador('10000000-0000-0000-0000-000000000001') = 2, 'contador A 2';
  assert public.fel_siguiente_borrador('10000000-0000-0000-0000-000000000002') = 1, 'contador B';
end $$;

-- 12. un cliente con el mismo NIT en dos empresas es válido; en la misma empresa no
insert into public.clientes (empresa_id, tipo_identificacion, numero_identificacion, nombre) values ('10000000-0000-0000-0000-000000000001', 'NIT', '5555555-5', 'Cliente');
insert into public.clientes (empresa_id, tipo_identificacion, numero_identificacion, nombre) values ('10000000-0000-0000-0000-000000000002', 'NIT', '5555555-5', 'Cliente');
select pg_temp.espera_error($$insert into public.clientes (empresa_id, tipo_identificacion, numero_identificacion, nombre) values ('10000000-0000-0000-0000-000000000001', 'NIT', '5555555-5', 'Repetido')$$, '23505');
-- el mismo número con otro tipo de identificación no choca
insert into public.clientes (empresa_id, tipo_identificacion, numero_identificacion, nombre) values ('10000000-0000-0000-0000-000000000001', 'CUI', '5555555-5', 'Otro tipo');
insert into public.clientes (empresa_id, tipo_identificacion, numero_identificacion, nombre) values ('10000000-0000-0000-0000-000000000001', 'CF', 'CF', 'Consumidor final');
insert into public.clientes (empresa_id, tipo_identificacion, numero_identificacion, nombre) values ('10000000-0000-0000-0000-000000000001', 'CF', 'CF', 'Consumidor final 2');
select pg_temp.espera_error($$insert into public.clientes (empresa_id, tipo_identificacion, numero_identificacion, nombre) values ('10000000-0000-0000-0000-000000000001', 'CF', '123', 'CF falso')$$, '23514');
select pg_temp.espera_error($$insert into public.clientes (empresa_id, tipo_identificacion, numero_identificacion, nombre) values ('10000000-0000-0000-0000-000000000001', 'XXX', '1', 'Tipo inexistente')$$, '23503');

rollback;
\echo 'OK 01_estructura'
