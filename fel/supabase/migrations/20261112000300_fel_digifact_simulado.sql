-- D3-1 · Digifact SIMULADO (solo contra el simulador local) y anulación simulada. Sin credenciales, sin red, sin certificación real.
-- Decisiones (documentadas en fel/docs/demo-version-practica.md):
--   · «digifact» pasa a habilitado SOLO para el ambiente «simulado», con la misma barrera que ya usa «portal_playwright»: una restricción de tabla que impide agregar pruebas o producción
--     sin una migración deliberada (D4). Se reemplaza la barrera anterior (digifact bloqueado por completo), que impedía incluso el simulador.
--   · El bolsón admite cuentas «simuladas» (solo de digifact): una operación simulada solo puede consumir una cuenta simulada, y una real solo una real.
--   · La anulación simulada es una variante propia (no toca la de producción): solo aplica a documentos certificados EN SIMULACIÓN y no inventa el plazo normativo (V12 sigue bloqueado).
-- Cambios sobre objetos de D2 (declarados): fel_admin_bolson_cuenta_crear y fel_sys_consumo_reservar (solo las comprobaciones de ambiente); restricción de ambiente de bolson_cuentas.

-- ============================================================ proveedor
alter table public.proveedores_emision drop constraint proveedores_digifact_bloqueado_chk;
update public.proveedores_emision set ambientes = '{simulado}', habilitado = true,
       nota = 'Certificador Digifact: SOLO contra el simulador local. Pruebas (TEST) y producción siguen bloqueadas hasta contar con credenciales y documentación (D4).'
 where id = 'digifact';
alter table public.proveedores_emision add constraint proveedores_digifact_solo_simulado_chk check (id <> 'digifact' or ambientes = '{simulado}');

-- ============================================================ bolsón: cuentas simuladas
alter table public.bolson_cuentas drop constraint bolson_cuentas_ambiente_check;
alter table public.bolson_cuentas add constraint bolson_cuentas_ambiente_check check (ambiente in ('simulado','pruebas','produccion'));
alter table public.bolson_cuentas add constraint bolson_cuentas_simulado_solo_digifact_chk check (ambiente <> 'simulado' or proveedor_id = 'digifact');

create or replace function public.fel_admin_bolson_cuenta_crear(
  p_actor uuid, p_proveedor text, p_ambiente text, p_referencia text, p_unidad text default 'documento') returns public.bolson_cuentas
language plpgsql security definer set search_path = '' as $$
declare v_prov public.proveedores_emision; v_c public.bolson_cuentas;
begin
  perform public.fel__exigir_plataforma(p_actor);
  select * into v_prov from public.proveedores_emision where id = p_proveedor;
  if not found then raise exception 'FEL_REGLA: proveedor desconocido'; end if;
  if p_ambiente = 'produccion' and not (v_prov.habilitado and 'produccion' = any (v_prov.ambientes) and public.fel__emision_real_disponible()) then
    raise exception 'FEL_REGLA: no se pueden crear cuentas de producción mientras el proveedor % no esté habilitado por autorización escrita', p_proveedor;
  end if;
  if p_ambiente = 'simulado' and p_proveedor <> 'digifact' then raise exception 'FEL_REGLA: solo el simulador de Digifact tiene un bolsón simulado'; end if;
  insert into public.bolson_cuentas (proveedor_id, ambiente, referencia_externa, unidad, creada_por)
  values (p_proveedor, p_ambiente, btrim(p_referencia), coalesce(p_unidad, 'documento'), p_actor)
  on conflict (proveedor_id, ambiente, referencia_externa) do nothing
  returning * into v_c;
  if not found then   -- repetición idempotente: devuelve la existente sin tocar nada
    select * into v_c from public.bolson_cuentas where proveedor_id = p_proveedor and ambiente = p_ambiente and referencia_externa = btrim(p_referencia);
    return v_c;
  end if;
  insert into public.bolson_saldos (cuenta_id) values (v_c.id);
  perform public.fel__bolson_sembrar_reglas(p_actor, v_c.id);
  perform public.fel_auditar(null, p_actor, 'bolson.cuenta_creada', 'bolson_cuenta', v_c.id::text,
    jsonb_build_object('proveedor', p_proveedor, 'ambiente', p_ambiente, 'unidad', v_c.unidad));
  return v_c;
end $$;

create or replace function public.fel_sys_consumo_reservar(
  p_empresa uuid, p_cuenta uuid, p_evento text, p_operacion uuid, p_documento uuid, p_clave text, p_hash text) returns public.consumos
language plpgsql security definer set search_path = '' as $$
declare v_c public.consumos; v_emp public.empresas; v_cta public.bolson_cuentas; v_regla public.bolson_reglas_consumo; v_op public.operaciones_fiscales; v_sal public.bolson_saldos; v_u numeric(20,6);
begin
  if p_clave is null or length(p_clave) not between 16 and 80 then raise exception 'FEL_REGLA: clave de idempotencia inválida (16 a 80 caracteres)'; end if;
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'FEL_REGLA: el hash del contenido debe ser SHA-256 en hexadecimal'; end if;
  -- 1. repetición (camino rápido, sin bloqueo global)
  select * into v_c from public.consumos where empresa_id = p_empresa and clave_idempotencia = p_clave;
  if found then return public.fel__bolson_consumo_repetido(v_c, p_cuenta, p_evento, p_operacion, p_documento, p_hash); end if;
  -- 2. contexto
  select * into v_emp from public.empresas where id = p_empresa;
  if not found then raise exception 'FEL_NO_ENCONTRADO: empresa no encontrada'; end if;
  if v_emp.estado <> 'habilitada' then raise exception 'FEL_REGLA: la empresa no está habilitada'; end if;
  if p_evento = 'devolucion' then raise exception 'FEL_REGLA: las devoluciones no se reservan; se registran por conciliación'; end if;
  if not exists (select 1 from public.evento_tipos where codigo = p_evento) then raise exception 'FEL_REGLA: tipo de evento desconocido'; end if;
  select * into v_cta from public.bolson_cuentas where id = p_cuenta;
  if not found then raise exception 'FEL_NO_ENCONTRADO: cuenta del bolsón no encontrada'; end if;
  if v_cta.estado <> 'activa' then raise exception 'FEL_REGLA: la cuenta del bolsón no está activa (%)', v_cta.estado; end if;
  if p_evento in ('certificacion','anulacion') and p_operacion is null then raise exception 'FEL_REGLA: el consumo de % exige su operación fiscal', p_evento; end if;
  if p_documento is not null and not exists (select 1 from public.documentos where id = p_documento and empresa_id = p_empresa) then raise exception 'FEL_NO_ENCONTRADO: documento no encontrado en la empresa'; end if;
  if p_operacion is not null then
    select * into v_op from public.operaciones_fiscales where id = p_operacion and empresa_id = p_empresa;
    if not found then raise exception 'FEL_NO_ENCONTRADO: operación no encontrada en la empresa'; end if;
    if p_documento is not null and v_op.documento_id <> p_documento then raise exception 'FEL_REGLA: el documento no corresponde a la operación'; end if;
    if v_op.ambiente is null then raise exception 'FEL_REGLA: la operación no tiene ambiente'; end if;      -- simulado solo consume cuentas simuladas; real solo las reales (se exige la coincidencia)
    if v_op.ambiente <> v_cta.ambiente or v_op.proveedor is distinct from v_cta.proveedor_id then
      raise exception 'FEL_REGLA: la operación (%/%) no corresponde a la cuenta del bolsón (%/%)', v_op.proveedor, v_op.ambiente, v_cta.proveedor_id, v_cta.ambiente;
    end if;
    if p_evento in ('certificacion','anulacion') then
      if v_op.tipo <> p_evento then raise exception 'FEL_REGLA: el evento % no corresponde a una operación de %', p_evento, v_op.tipo; end if;
      if v_op.estado not in ('iniciada','desconocida') then raise exception 'FEL_REGLA: la operación ya está confirmada; no admite un consumo nuevo'; end if;
    end if;
  end if;
  -- 3. bloqueo del saldo (orden fijo) y segunda comprobación de la repetición
  select * into v_sal from public.bolson_saldos where cuenta_id = p_cuenta for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: la cuenta del bolsón no tiene saldo'; end if;
  select * into v_c from public.consumos where empresa_id = p_empresa and clave_idempotencia = p_clave;
  if found then return public.fel__bolson_consumo_repetido(v_c, p_cuenta, p_evento, p_operacion, p_documento, p_hash); end if;
  select * into v_regla from public.bolson_reglas_consumo where cuenta_id = p_cuenta and evento_tipo = p_evento and vigente_hasta is null;
  if not found then raise exception 'FEL_REGLA: la cuenta no tiene una regla de consumo vigente para %', p_evento; end if;
  v_u := case when v_regla.consume = 'no' then 0 else v_regla.unidades end;            -- «desconocido» se trata como que consume
  if v_regla.consume = 'no' and not v_regla.medible then return null; end if;          -- nada que medir
  if v_u > v_sal.comprado + v_sal.ajustado - v_sal.consumido - v_sal.reservado then
    raise exception 'FEL_BOLSON_AGOTADO: no hay unidades disponibles en el bolsón para reservar %', v_u;
  end if;
  begin
    insert into public.consumos (cuenta_id, empresa_id, evento_tipo, operacion_id, documento_id, clave_idempotencia, hash_contenido, unidades_reservadas, regla_id)
    values (p_cuenta, p_empresa, p_evento, p_operacion, p_documento, p_clave, p_hash, v_u, v_regla.id) returning * into v_c;
  exception when unique_violation then
    raise exception 'FEL_OPERACION_CON_CONSUMO: la operación ya tiene un consumo de %', p_evento;
  end;
  if v_u > 0 then
    insert into public.bolson_movimientos (cuenta_id, empresa_id, consumo_id, tipo, unidades, motivo) values (p_cuenta, p_empresa, v_c.id, 'reserva', v_u, 'reserva antes de enviar');
  end if;
  perform public.fel_auditar(p_empresa, null, 'bolson.consumo_reservado', 'consumo', v_c.id::text,
    jsonb_build_object('evento', p_evento, 'unidades', v_u, 'regla', v_regla.id, 'consume', v_regla.consume, 'operacion', p_operacion), 'sistema');
  return v_c;
end $$;

-- ============================================================ anulación SIMULADA
create or replace function public.fel_op_anulacion_simulada_iniciar(
  p_actor uuid, p_empresa uuid, p_doc uuid, p_clave text, p_hash text, p_motivo text, p_canal uuid) returns public.operaciones_fiscales
language plpgsql security definer set search_path = '' as $$
declare v public.documentos; o public.operaciones_fiscales; c public.empresa_canales; pr public.proveedores_emision;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'fiscal.anular');
  if p_motivo is null or length(btrim(p_motivo)) < 5 then raise exception 'FEL_REGLA: el motivo es obligatorio (mínimo 5 caracteres)'; end if;
  select * into c from public.empresa_canales where id = p_canal and empresa_id = p_empresa;
  if not found or not c.habilitado or c.ambiente <> 'simulado' or c.proveedor_id <> 'digifact' then raise exception 'FEL_REGLA: la anulación simulada exige un canal simulado habilitado de Digifact'; end if;
  select * into pr from public.proveedores_emision where id = c.proveedor_id;
  if not pr.habilitado then raise exception 'FEL_REGLA: el proveedor no está habilitado'; end if;
  if not exists (select 1 from public.empresas where id = p_empresa and estado = 'habilitada') then raise exception 'FEL_REGLA: la empresa no está habilitada'; end if;
  select * into v from public.documentos where id = p_doc and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: documento no encontrado'; end if;
  select * into o from public.operaciones_fiscales where documento_id = p_doc and clave_idempotencia = p_clave;
  if found then
    if o.hash_contenido <> p_hash or o.tipo <> 'anulacion' then raise exception 'FEL_CONFLICTO: la clave de idempotencia ya se usó con otro contenido'; end if;
    return o;
  end if;
  if exists (select 1 from public.operaciones_fiscales where documento_id = p_doc and estado in ('iniciada','desconocida')) then
    raise exception 'FEL_OPERACION_ABIERTA: hay una operación sin confirmar; concílala antes de reintentar';
  end if;
  if v.estado_fiscal <> 'certificado' then raise exception 'FEL_REGLA: solo se anula un DTE certificado'; end if;
  if not exists (select 1 from public.operaciones_fiscales where documento_id = p_doc and tipo = 'certificacion' and estado = 'confirmada_exitosa' and ambiente = 'simulado') then
    raise exception 'FEL_REGLA: la anulación simulada solo aplica a documentos certificados en simulación';
  end if;
  insert into public.operaciones_fiscales (empresa_id, documento_id, tipo, clave_idempotencia, hash_contenido, proveedor, canal_id, ambiente, motivo, iniciada_por)
  values (p_empresa, p_doc, 'anulacion', p_clave, p_hash, c.proveedor_id, c.id, 'simulado', btrim(p_motivo), p_actor) returning * into o;
  perform public.fel__fiscal_cambiar(p_doc, p_empresa, 'anulacion_solicitada', p_actor, o.id, btrim(p_motivo));
  perform public.fel_auditar(p_empresa, p_actor, 'fiscal.anulacion_simulada_iniciada', 'documento', p_doc::text, jsonb_build_object('operacion', o.id, 'motivo', btrim(p_motivo), 'simulada', true));
  return o;
end $$;

-- Resultado desconocido de una anulación: el documento sigue en «anulación solicitada» (no se asume éxito ni fallo) y no se reintenta.
create or replace function public.fel_sys_anulacion_desconocida(p_empresa uuid, p_op uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.operaciones_fiscales;
begin
  select * into o from public.operaciones_fiscales where id = p_op and empresa_id = p_empresa for update;
  if not found or o.tipo <> 'anulacion' then raise exception 'FEL_NO_ENCONTRADO: anulación no encontrada'; end if;
  if o.estado = 'desconocida' then return; end if;
  if o.estado <> 'iniciada' then raise exception 'FEL_REGLA: solo una anulación iniciada puede quedar desconocida'; end if;
  update public.operaciones_fiscales set estado = 'desconocida', motivo_desconocido = left(coalesce(p_motivo, ''), 80) where id = p_op;
  perform public.fel_auditar(p_empresa, null, 'fiscal.anulacion_desconocida', 'documento', o.documento_id::text, jsonb_build_object('operacion', p_op, 'motivo', left(coalesce(p_motivo, ''), 80)), 'sistema');
end $$;

-- Cierre de una anulación con la respuesta CONFIRMADA del proveedor (simulado): anulada, o rechazada (el documento vuelve a «certificado»).
create or replace function public.fel_sys_anulacion_cerrar(p_empresa uuid, p_op uuid, p_exitosa boolean, p_evidencia jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.operaciones_fiscales;
begin
  if p_evidencia is null or jsonb_typeof(p_evidencia) <> 'object' or p_evidencia = '{}'::jsonb then raise exception 'FEL_REGLA: cerrar una anulación exige la evidencia de la respuesta'; end if;
  select * into o from public.operaciones_fiscales where id = p_op and empresa_id = p_empresa for update;
  if not found or o.tipo <> 'anulacion' then raise exception 'FEL_NO_ENCONTRADO: anulación no encontrada'; end if;
  if o.estado not in ('iniciada','desconocida') then raise exception 'FEL_REGLA: la anulación ya está confirmada'; end if;
  if o.ambiente is distinct from 'simulado' then raise exception 'FEL_REGLA: este cierre solo aplica a anulaciones simuladas'; end if;
  perform 1 from public.documentos where id = o.documento_id and empresa_id = p_empresa for update;
  update public.operaciones_fiscales set estado = case when p_exitosa then 'confirmada_exitosa' else 'confirmada_fallida' end,
         resolucion = 'proveedor', evidencia = p_evidencia, resuelta_en = clock_timestamp() where id = p_op;
  perform public.fel__fiscal_cambiar(o.documento_id, p_empresa, case when p_exitosa then 'anulado' else 'certificado' end, null, p_op, case when p_exitosa then 'anulación confirmada (simulada)' else 'anulación rechazada (simulada)' end);
  perform public.fel_auditar(p_empresa, null, case when p_exitosa then 'fiscal.anulacion_simulada_confirmada' else 'fiscal.anulacion_simulada_rechazada' end, 'documento', o.documento_id::text, jsonb_build_object('operacion', p_op), 'sistema');
end $$;

-- ============================================================ privilegios
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('fel_op_anulacion_simulada_iniciar','fel_sys_anulacion_desconocida','fel_sys_anulacion_cerrar','fel_admin_bolson_cuenta_crear','fel_sys_consumo_reservar') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
