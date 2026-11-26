-- M-E · Rol de conexión restringido de la aplicación: `nexa_app` (PROPUESTA; fuera de supabase/migrations; NO se aplica ni sustituye la conexión actual sin autorización). Requiere M-D, M-A, M-B y M-C.
-- Hoy la función se conecta como `postgres` (omite RLS y es propietario de las tablas). `nexa_app` es la alternativa: NO es superusuario, NO omite RLS, NO es propietario de nada (no puede cambiar tablas, disparadores, políticas ni funciones),
-- NO es miembro de ningún rol, no ve `auth` ni `vault`, y solo tiene (1) las funciones que el código usa realmente (86 existentes + las 13 nuevas) y (2) los privilegios mínimos sobre las tablas que la aplicación consulta
-- directamente (lista derivada del código). Las tablas de credenciales, emisor, eventos de Digifact y accesos excepcionales del maestro NO tienen privilegios ni política para `nexa_app`: solo se alcanzan por funciones.
-- El inicio de sesión se habilita FUERA del repositorio con la contraseña real (secreto): alter role nexa_app login password '…'.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'nexa_app') then
    create role nexa_app nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end $$;
grant usage on schema public to nexa_app;
revoke all on all tables in schema public from nexa_app;
revoke all on all functions in schema public from nexa_app;
revoke all on all sequences in schema public from nexa_app;

-- 1) funciones (solo las que el código usa)
do $$ declare r record; begin
  for r in select p.oid::regprocedure as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = any (array['fel_admin_bolson_alerta_resolver', 'fel_admin_bolson_conciliar_decidir', 'fel_admin_bolson_conciliar_proponer', 'fel_admin_bolson_cuenta_crear', 'fel_admin_bolson_extracto_importar', 'fel_admin_bolson_lote_registrar', 'fel_admin_bolson_partida_resolver', 'fel_admin_cobro_emitir', 'fel_admin_cobro_generar', 'fel_admin_contrato_asignar', 'fel_admin_cuenta_comercial_ajustar', 'fel_admin_empresa_crear', 'fel_admin_empresa_estado', 'fel_admin_pago_simulado_registrar', 'fel_admin_plan_crear', 'fel_admin_plan_version_crear', 'fel_auditar', 'fel_op_agente_codigo_crear', 'fel_op_agente_metricas', 'fel_op_agente_revocar', 'fel_op_agentes_listar', 'fel_op_alerta_resolver', 'fel_op_anulacion_simulada_iniciar', 'fel_op_canal_configurar', 'fel_op_certificacion_solicitar', 'fel_op_cliente_estado', 'fel_op_cliente_frecuente', 'fel_op_cliente_guardar', 'fel_op_concepto_estado', 'fel_op_concepto_guardar', 'fel_op_conciliacion_decidir', 'fel_op_conciliacion_proponer', 'fel_op_documento_establecimiento', 'fel_op_documento_guardar', 'fel_op_documento_origenes', 'fel_op_documento_preparacion', 'fel_op_documento_reabrir', 'fel_op_documento_tipo', 'fel_op_empresa_datos_guardar', 'fel_op_establecimiento_guardar', 'fel_op_invitacion_aceptar', 'fel_op_invitacion_registrar', 'fel_op_miembro_actualizar', 'fel_op_miembros_listar', 'fel_op_orden_confirmacion_autorizar', 'fel_op_orden_vista_previa', 'fel_op_tipos_empresa_guardar', 'fel_permisos_efectivos', 'fel_sys_agente_autenticar', 'fel_sys_agente_clave', 'fel_sys_agente_latido', 'fel_sys_agente_metricas_guardar', 'fel_sys_agente_politica', 'fel_sys_agente_vincular', 'fel_sys_anulacion_cerrar', 'fel_sys_anulacion_desconocida', 'fel_sys_artefacto_guardar', 'fel_sys_artefactos_faltantes', 'fel_sys_bolson_cuenta_simulada', 'fel_sys_bolson_revisar', 'fel_sys_cobertura_cerrar', 'fel_sys_cobertura_reservar', 'fel_sys_digifact_aplicar', 'fel_sys_documento_instantanea', 'fel_sys_evento_registrar', 'fel_sys_fallidas_manuales_recientes', 'fel_sys_operacion', 'fel_sys_operacion_desconocida', 'fel_sys_operacion_marcar_envio', 'fel_sys_operacion_no_enviada', 'fel_sys_operacion_orden', 'fel_sys_operacion_resolver_evento', 'fel_sys_operaciones_pendientes', 'fel_sys_orden_cierre_liberar', 'fel_sys_orden_cierre_reservar', 'fel_sys_orden_crear', 'fel_sys_orden_por_operacion', 'fel_sys_orden_progreso', 'fel_sys_orden_reclamar', 'fel_sys_orden_resultado', 'fel_sys_orden_vista_previa', 'fel_sys_ordenes_para_cerrar', 'fel_sys_ordenes_vencer', 'fel_sys_verificar_monederos', 'fel_sys_verificar_saldos', 'fel_tipos_empresa', 'fel_op_emisor_guardar', 'fel_op_emisor_aprobar', 'fel_sys_emisor_vigente', 'fel_op_digifact_conectar', 'fel_op_digifact_registrar_prueba', 'fel_op_digifact_interruptores', 'fel_op_digifact_suspender', 'fel_sys_digifact_credencial', 'fel_admin_acceso_solicitar', 'fel_admin_acceso_revocar', 'fel_admin_datos_excepcionales_documentos', 'fel_admin_datos_excepcionales_configuracion', 'fel_admin_empresas_resumen']) and p.prorettype <> 'trigger'::regtype loop
    execute format('grant execute on function %s to nexa_app', r.f);
  end loop;
end $$;

-- 2) tablas consultadas directamente: privilegios mínimos + política para nexa_app (sin ella, con RLS activado, vería 0 filas)
do $$ declare t text; begin
  foreach t in array array['alertas_fiscales', 'artefactos_documento', 'auditoria', 'bolson_alertas', 'bolson_conciliacion_partidas', 'bolson_conciliaciones', 'bolson_cuentas', 'bolson_extracto_lineas', 'bolson_extractos', 'bolson_lotes', 'bolson_partida_resoluciones', 'bolson_reglas_consumo', 'bolson_saldos', 'cargos', 'clientes', 'cobros', 'conceptos', 'conciliaciones', 'consumos', 'contratos_plan', 'cuentas_comerciales', 'demo_credenciales', 'demo_entorno', 'demo_intentos', 'demo_sesiones', 'demo_simulador_estado', 'digifact_artefactos', 'digifact_operaciones', 'documento_lineas', 'documentos', 'empresa_canales', 'empresas', 'establecimientos', 'evento_tipos', 'eventos_proveedor', 'invitaciones', 'miembros', 'monedero_saldos', 'operaciones_fiscales', 'pagos', 'perfiles', 'permisos_catalogo', 'plan_versiones', 'planes', 'plataforma_admins', 'plataforma_parametros', 'proveedores_emision', 'regimenes_fiscales', 'rol_permisos', 'tarifas', 'demo_limites'] loop
    execute format('grant select on public.%I to nexa_app', t);
    execute format('create policy nexa_app_leer on public.%I for select to nexa_app using (true)', t);
  end loop;
  foreach t in array array['demo_credenciales', 'demo_intentos', 'demo_limites', 'demo_sesiones', 'demo_simulador_estado', 'digifact_artefactos', 'digifact_operaciones'] loop
    execute format('grant insert on public.%I to nexa_app', t);
    execute format('create policy nexa_app_insertar on public.%I for insert to nexa_app with check (true)', t);
  end loop;
  foreach t in array array['demo_credenciales', 'demo_intentos', 'demo_limites', 'demo_sesiones', 'demo_simulador_estado', 'digifact_operaciones', 'plataforma_parametros'] loop
    execute format('grant update on public.%I to nexa_app', t);
    execute format('create policy nexa_app_actualizar on public.%I for update to nexa_app using (true) with check (true)', t);
  end loop;
  foreach t in array array['demo_intentos', 'demo_limites', 'demo_sesiones'] loop
    execute format('grant delete on public.%I to nexa_app', t);
    execute format('create policy nexa_app_borrar on public.%I for delete to nexa_app using (true)', t);
  end loop;
end $$;
