-- NEXA FEL · Fase 1.0 · documentos (borradores), operaciones fiscales con idempotencia y conciliación, anulación con reglas versionadas.
-- Las funciones fiscales (certificación/anulación) existen y están probadas, pero la Edge Function NO las expone en Fase 1:
-- además exigen empresa con emisión real habilitada (que a su vez exige régimen verificado y autorización específica).

-- ---------------------------------------------------------------- borradores
create or replace function public.fel__documento_lineas(p_doc uuid, p_empresa uuid, p_lineas jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if jsonb_typeof(p_lineas) is distinct from 'array' then raise exception 'FEL_REGLA: las líneas deben ser una lista'; end if;
  delete from public.documento_lineas where documento_id = p_doc and empresa_id = p_empresa;
  insert into public.documento_lineas (documento_id, empresa_id, orden, concepto_id, descripcion, cantidad, precio_unitario,
                                       descuento_tipo, descuento_valor, importes)
  select p_doc, p_empresa, x.orden, x.concepto_id, x.descripcion, x.cantidad, x.precio_unitario,
         coalesce(x.descuento_tipo, 'ninguno'), coalesce(x.descuento_valor, 0), coalesce(x.importes, '{}'::jsonb)
    from jsonb_to_recordset(p_lineas) as x(orden integer, concepto_id uuid, descripcion text, cantidad numeric,
         precio_unitario numeric, descuento_tipo text, descuento_valor numeric, importes jsonb);
end $$;

create or replace function public.fel__documento_datos(p_empresa uuid, p_cliente uuid, out v_snap jsonb, out v_reg uuid, out v_regsnap jsonb)
language plpgsql security definer set search_path = '' as $$
declare c public.clientes; r public.regimenes_fiscales;
begin
  if p_cliente is not null then
    select * into c from public.clientes where id = p_cliente and empresa_id = p_empresa and activo;
    if not found then raise exception 'FEL_NO_ENCONTRADO: cliente no encontrado o inactivo'; end if;
    v_snap := jsonb_build_object('id', c.id, 'tipo_identificacion', c.tipo_identificacion, 'numero_identificacion', c.numero_identificacion,
                                 'nombre', c.nombre, 'direccion', c.direccion, 'email', c.email);
  end if;
  select r2.* into r from public.empresas e join public.regimenes_fiscales r2 on r2.id = e.regimen_id where e.id = p_empresa;
  if found then
    v_reg := r.id;
    v_regsnap := jsonb_build_object('codigo', r.codigo, 'version', r.version, 'estado', r.estado, 'reglas', r.reglas);
  end if;
end $$;

create or replace function public.fel_op_documento_guardar(
  p_actor uuid, p_empresa uuid, p_id uuid, p_cliente uuid, p_fecha date, p_observaciones text, p_lineas jsonb,
  p_subtotal numeric, p_descuento_total numeric, p_base numeric, p_calculo jsonb, p_version integer) returns public.documentos
language plpgsql security definer set search_path = '' as $$
declare v_old public.documentos; v_new public.documentos; d record;
begin
  if p_id is null then
    perform public.fel__exigir_permiso(p_actor, p_empresa, 'borradores.crear');
    select * into d from public.fel__documento_datos(p_empresa, p_cliente);
    insert into public.documentos (empresa_id, numero_borrador, cliente_id, cliente_snapshot, regimen_id, regimen_snapshot,
                                   fecha_emision_prevista, observaciones, subtotal, descuento_total, base_imponible, calculo,
                                   creado_por, actualizado_por)
    values (p_empresa, public.fel_siguiente_borrador(p_empresa), p_cliente, d.v_snap, d.v_reg, d.v_regsnap,
            p_fecha, nullif(btrim(p_observaciones), ''), p_subtotal, p_descuento_total, p_base, p_calculo, p_actor, p_actor)
    returning * into v_new;
    perform public.fel__documento_lineas(v_new.id, p_empresa, p_lineas);
    perform public.fel_auditar(p_empresa, p_actor, 'documento.crear_borrador', 'documento', v_new.id::text,
      jsonb_build_object('numero_borrador', v_new.numero_borrador));
  else
    perform public.fel__exigir_permiso(p_actor, p_empresa, 'borradores.editar');
    select * into v_old from public.documentos where id = p_id and empresa_id = p_empresa for update;
    if not found then raise exception 'FEL_NO_ENCONTRADO: documento no encontrado'; end if;
    if p_version is null or p_version <> v_old.version then
      raise exception 'FEL_CONFLICTO: el documento cambió mientras lo editabas; recarga e intenta de nuevo';
    end if;
    if v_old.estado_preparacion <> 'borrador' or v_old.estado_fiscal <> 'ninguno' then
      raise exception 'FEL_REGLA: solo se edita un borrador sin estado fiscal';
    end if;
    select * into d from public.fel__documento_datos(p_empresa, p_cliente);
    update public.documentos
       set cliente_id = p_cliente, cliente_snapshot = d.v_snap, regimen_id = d.v_reg, regimen_snapshot = d.v_regsnap,
           fecha_emision_prevista = p_fecha, observaciones = nullif(btrim(p_observaciones), ''),
           subtotal = p_subtotal, descuento_total = p_descuento_total, base_imponible = p_base, calculo = p_calculo,
           version = version + 1, actualizado_por = p_actor
     where id = p_id and empresa_id = p_empresa returning * into v_new;
    perform public.fel__documento_lineas(p_id, p_empresa, p_lineas);
    perform public.fel_auditar(p_empresa, p_actor, 'documento.editar_borrador', 'documento', p_id::text,
      jsonb_build_object('numero_borrador', v_new.numero_borrador, 'version', v_new.version));
  end if;
  return v_new;
end $$;

-- Cambios del eje de PREPARACIÓN (interno). Nunca toca el eje fiscal.
create or replace function public.fel_op_documento_preparacion(
  p_actor uuid, p_empresa uuid, p_id uuid, p_nuevo text, p_motivo text, p_version integer) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.documentos;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa,
    case p_nuevo when 'revisado' then 'borradores.revisar' when 'archivado' then 'borradores.archivar' else 'borradores.editar' end);
  select * into v from public.documentos where id = p_id and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: documento no encontrado'; end if;
  if p_version is null or p_version <> v.version then raise exception 'FEL_CONFLICTO: el documento cambió; recarga e intenta de nuevo'; end if;
  if v.estado_fiscal <> 'ninguno' then raise exception 'FEL_REGLA: un documento con vida fiscal no cambia su estado de preparación'; end if;
  if p_nuevo = 'revisado' and (v.cliente_id is null or not exists (select 1 from public.documento_lineas where documento_id = p_id)) then
    raise exception 'FEL_REGLA: para revisar hace falta cliente y al menos una línea';
  end if;
  if p_nuevo = 'archivado' and (p_motivo is null or length(btrim(p_motivo)) < 5) then
    raise exception 'FEL_REGLA: el motivo es obligatorio (mínimo 5 caracteres)';
  end if;
  update public.documentos set estado_preparacion = p_nuevo, version = version + 1, actualizado_por = p_actor where id = p_id;
  insert into public.documento_estados (documento_id, empresa_id, eje, anterior, nuevo, motivo, user_id)
  values (p_id, p_empresa, 'preparacion', v.estado_preparacion, p_nuevo, nullif(btrim(p_motivo), ''), p_actor);
  perform public.fel_auditar(p_empresa, p_actor, 'documento.preparacion', 'documento', p_id::text,
    jsonb_build_object('antes', v.estado_preparacion, 'despues', p_nuevo, 'motivo', p_motivo));
end $$;

-- ---------------------------------------------------------------- operaciones fiscales (NO expuestas por la API en Fase 1)
create or replace function public.fel__fiscal_cambiar(
  p_doc uuid, p_empresa uuid, p_estado text, p_actor uuid, p_op uuid, p_motivo text,
  p_serie text default null, p_numero text default null, p_autorizacion text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ant text;
begin
  select estado_fiscal into v_ant from public.documentos where id = p_doc and empresa_id = p_empresa;
  -- una sola sentencia: estado y datos fiscales cambian juntos (las restricciones de la tabla lo exigen)
  perform set_config('fel.op_fiscal', 'on', true);
  update public.documentos
     set estado_fiscal = p_estado, actualizado_por = p_actor, version = version + 1,
         serie = coalesce(p_serie, serie), numero_fiscal = coalesce(p_numero, numero_fiscal),
         autorizacion_sat = coalesce(p_autorizacion, autorizacion_sat),
         certificacion_verificada_en = case when p_estado = 'certificado' and v_ant <> 'anulacion_solicitada' then now() else certificacion_verificada_en end,
         anulacion_solicitada_en = case p_estado when 'anulacion_solicitada' then now() when 'certificado' then null else anulacion_solicitada_en end,
         anulacion_motivo = case p_estado when 'anulacion_solicitada' then p_motivo when 'certificado' then null else anulacion_motivo end,
         anulado_en = case p_estado when 'anulado' then now() else anulado_en end
   where id = p_doc and empresa_id = p_empresa;
  perform set_config('fel.op_fiscal', 'off', true);
  insert into public.documento_estados (documento_id, empresa_id, eje, anterior, nuevo, motivo, user_id, operacion_id)
  values (p_doc, p_empresa, 'fiscal', v_ant, p_estado, p_motivo, p_actor, p_op);
end $$;

create or replace function public.fel__emision_real_activa(p_empresa uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.empresas e join public.regimenes_fiscales r on r.id = e.regimen_id
                  where e.id = p_empresa and e.estado = 'habilitada' and e.emision_real_habilitada and r.estado = 'verificado') then
    raise exception 'FEL_EMISION_BLOQUEADA: la emisión real no está habilitada para esta empresa';
  end if;
end $$;

-- Inicia una certificación. Idempotente por (documento, clave): repetir la misma clave devuelve la misma operación.
-- Si hay una operación abierta (iniciada o desconocida) NO se permite otra: primero hay que conciliar.
create or replace function public.fel_op_certificacion_iniciar(
  p_actor uuid, p_empresa uuid, p_doc uuid, p_clave text, p_hash text, p_proveedor text) returns public.operaciones_fiscales
language plpgsql security definer set search_path = '' as $$
declare v public.documentos; o public.operaciones_fiscales;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'fiscal.certificar');
  perform public.fel__emision_real_activa(p_empresa);
  select * into v from public.documentos where id = p_doc and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: documento no encontrado'; end if;
  select * into o from public.operaciones_fiscales where documento_id = p_doc and clave_idempotencia = p_clave;
  if found then
    if o.hash_contenido <> p_hash or o.tipo <> 'certificacion' then
      raise exception 'FEL_CONFLICTO: la clave de idempotencia ya se usó con otro contenido';
    end if;
    return o;
  end if;
  if exists (select 1 from public.operaciones_fiscales where documento_id = p_doc and estado in ('iniciada','desconocida')) then
    raise exception 'FEL_OPERACION_ABIERTA: hay una operación sin confirmar; concílala antes de reintentar';
  end if;
  if v.estado_preparacion <> 'revisado' or v.estado_fiscal not in ('ninguno','rechazado') then
    raise exception 'FEL_REGLA: el documento no está en condiciones de certificarse';
  end if;
  insert into public.operaciones_fiscales (empresa_id, documento_id, tipo, clave_idempotencia, hash_contenido, proveedor, iniciada_por)
  values (p_empresa, p_doc, 'certificacion', p_clave, p_hash, p_proveedor, p_actor) returning * into o;
  perform public.fel__fiscal_cambiar(p_doc, p_empresa, 'pendiente_certificacion', p_actor, o.id, 'certificación iniciada');
  perform public.fel_auditar(p_empresa, p_actor, 'fiscal.certificacion_iniciada', 'documento', p_doc::text, jsonb_build_object('operacion', o.id));
  return o;
end $$;

-- Anulación: exige regla verificada y vigente; el plazo se aplica solo si la regla es de tipo soportado.
create or replace function public.fel_op_anulacion_iniciar(
  p_actor uuid, p_empresa uuid, p_doc uuid, p_clave text, p_hash text, p_motivo text, p_proveedor text) returns public.operaciones_fiscales
language plpgsql security definer set search_path = '' as $$
declare v public.documentos; o public.operaciones_fiscales; g public.reglas_normativas;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'fiscal.anular');
  perform public.fel__emision_real_activa(p_empresa);
  if p_motivo is null or length(btrim(p_motivo)) < 5 then raise exception 'FEL_REGLA: el motivo es obligatorio (mínimo 5 caracteres)'; end if;
  select * into v from public.documentos where id = p_doc and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: documento no encontrado'; end if;
  select * into o from public.operaciones_fiscales where documento_id = p_doc and clave_idempotencia = p_clave;
  if found then
    if o.hash_contenido <> p_hash or o.tipo <> 'anulacion' then
      raise exception 'FEL_CONFLICTO: la clave de idempotencia ya se usó con otro contenido';
    end if;
    return o;
  end if;
  if exists (select 1 from public.operaciones_fiscales where documento_id = p_doc and estado in ('iniciada','desconocida')) then
    raise exception 'FEL_OPERACION_ABIERTA: hay una operación sin confirmar; concílala antes de reintentar';
  end if;
  if v.estado_fiscal <> 'certificado' then raise exception 'FEL_REGLA: solo se anula un DTE certificado'; end if;
  select * into g from public.reglas_normativas
   where codigo = 'anulacion_dte' and estado = 'verificado'
     and (vigente_desde is null or vigente_desde <= current_date) and (vigente_hasta is null or vigente_hasta >= current_date)
   order by version desc limit 1;
  if not found then raise exception 'FEL_REGLA: no hay reglas de anulación verificadas y vigentes'; end if;
  if g.reglas ->> 'plazo_tipo' = 'dias_calendario'
     and current_date - v.certificacion_verificada_en::date > (g.reglas ->> 'dias')::integer then
    raise exception 'FEL_REGLA: fuera del plazo de anulación';
  end if;
  insert into public.operaciones_fiscales (empresa_id, documento_id, tipo, clave_idempotencia, hash_contenido, proveedor, regla_id, motivo, iniciada_por)
  values (p_empresa, p_doc, 'anulacion', p_clave, p_hash, p_proveedor, g.id, btrim(p_motivo), p_actor) returning * into o;
  perform public.fel__fiscal_cambiar(p_doc, p_empresa, 'anulacion_solicitada', p_actor, o.id, btrim(p_motivo));
  perform public.fel_auditar(p_empresa, p_actor, 'fiscal.anulacion_iniciada', 'documento', p_doc::text,
    jsonb_build_object('operacion', o.id, 'regla', g.id, 'motivo', btrim(p_motivo)));
  return o;
end $$;

-- Resultado desconocido (tiempo agotado, corte, respuesta ilegible): el documento queda por verificar y NO se reintenta.
create or replace function public.fel_op_operacion_desconocida(p_actor uuid, p_empresa uuid, p_op uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.operaciones_fiscales;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'fiscal.certificar');
  select * into o from public.operaciones_fiscales where id = p_op and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: operación no encontrada'; end if;
  if o.estado <> 'iniciada' then raise exception 'FEL_REGLA: solo una operación iniciada puede quedar con resultado desconocido'; end if;
  update public.operaciones_fiscales set estado = 'desconocida' where id = p_op;
  if o.tipo = 'certificacion' then
    perform public.fel__fiscal_cambiar(o.documento_id, p_empresa, 'por_verificar', p_actor, p_op, 'resultado desconocido');
  end if;  -- una anulación desconocida deja el documento en anulacion_solicitada (no se asume ni éxito ni fallo)
  perform public.fel_auditar(p_empresa, p_actor, 'fiscal.operacion_desconocida', 'documento', o.documento_id::text, jsonb_build_object('operacion', p_op));
end $$;

-- Resolución de una operación: por respuesta del proveedor o por conciliación manual (con evidencia y permiso aparte).
create or replace function public.fel_op_operacion_resolver(
  p_actor uuid, p_empresa uuid, p_op uuid, p_exitosa boolean, p_resolucion text, p_evidencia jsonb,
  p_serie text, p_numero text, p_autorizacion text) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.operaciones_fiscales; v public.documentos;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, case when p_resolucion = 'conciliacion_manual' then 'fiscal.conciliar' else 'fiscal.certificar' end);
  if p_resolucion not in ('proveedor','conciliacion_manual') then raise exception 'FEL_REGLA: resolución no válida'; end if;
  if p_resolucion = 'conciliacion_manual' and (p_evidencia is null or p_evidencia = '{}'::jsonb) then
    raise exception 'FEL_REGLA: la conciliación manual exige evidencia';
  end if;
  select * into o from public.operaciones_fiscales where id = p_op and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: operación no encontrada'; end if;
  if o.estado not in ('iniciada','desconocida') then raise exception 'FEL_REGLA: la operación ya está confirmada'; end if;
  select * into v from public.documentos where id = o.documento_id and empresa_id = p_empresa for update;
  update public.operaciones_fiscales
     set estado = case when p_exitosa then 'confirmada_exitosa' else 'confirmada_fallida' end,
         resolucion = p_resolucion, evidencia = p_evidencia, resuelta_por = p_actor, resuelta_en = now()
   where id = p_op;
  if o.tipo = 'certificacion' then
    if p_exitosa then
      if coalesce(btrim(p_serie), '') = '' or coalesce(btrim(p_numero), '') = '' or coalesce(btrim(p_autorizacion), '') = '' then
        raise exception 'FEL_REGLA: serie, número y autorización son obligatorios para confirmar una certificación';
      end if;
      perform public.fel__fiscal_cambiar(o.documento_id, p_empresa, 'certificado', p_actor, p_op, p_resolucion,
                                         btrim(p_serie), btrim(p_numero), btrim(p_autorizacion));
    else
      perform public.fel__fiscal_cambiar(o.documento_id, p_empresa, 'rechazado', p_actor, p_op, p_resolucion);
    end if;
  else
    perform public.fel__fiscal_cambiar(o.documento_id, p_empresa, case when p_exitosa then 'anulado' else 'certificado' end,
                                       p_actor, p_op, p_resolucion);
  end if;
  perform public.fel_auditar(p_empresa, p_actor, 'fiscal.operacion_resuelta', 'documento', o.documento_id::text,
    jsonb_build_object('operacion', p_op, 'exitosa', p_exitosa, 'resolucion', p_resolucion));
end $$;

-- ---------------------------------------------------------------- administración de reglas e identificaciones (administrador maestro)
create or replace function public.fel_admin_regla_crear_version(
  p_actor uuid, p_codigo text, p_nombre text, p_reglas jsonb, p_fuente text, p_vigente_desde date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_ver integer;
begin
  perform public.fel__exigir_plataforma(p_actor);
  select coalesce(max(version), 0) + 1 into v_ver from public.reglas_normativas where codigo = p_codigo;
  insert into public.reglas_normativas (codigo, version, nombre, reglas, fuente, vigente_desde, creado_por)
  values (p_codigo, v_ver, btrim(p_nombre), coalesce(p_reglas, '{}'::jsonb), p_fuente, p_vigente_desde, p_actor) returning id into v_id;
  perform public.fel_auditar(null, p_actor, 'regla.crear_version', 'regimen', v_id::text,
    jsonb_build_object('codigo', p_codigo, 'version', v_ver, 'reglas', coalesce(p_reglas, '{}'::jsonb), 'fuente', p_fuente));
  return v_id;
end $$;

create or replace function public.fel_admin_regla_verificar(p_actor uuid, p_regla uuid, p_referencia text, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.reglas_normativas;
begin
  perform public.fel__exigir_plataforma(p_actor);
  if p_motivo is null or length(btrim(p_motivo)) < 5 then raise exception 'FEL_REGLA: el motivo es obligatorio (mínimo 5 caracteres)'; end if;
  select * into v from public.reglas_normativas where id = p_regla for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: regla no encontrada'; end if;
  if v.estado <> 'sin_verificar' then raise exception 'FEL_REGLA: solo se verifica una regla sin verificar'; end if;
  update public.reglas_normativas set estado = 'verificado', verificado_por = p_actor, verificado_en = now(),
         fuente = coalesce(nullif(btrim(p_referencia), ''), fuente) where id = p_regla;
  perform public.fel_auditar(null, p_actor, 'regla.verificar', 'regimen', p_regla::text,
    jsonb_build_object('codigo', v.codigo, 'version', v.version, 'reglas', v.reglas, 'referencia', p_referencia, 'motivo', p_motivo));
end $$;

create or replace function public.fel_admin_identificacion_verificar(
  p_actor uuid, p_codigo text, p_patron text, p_fuente text, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.identificaciones_tipos;
begin
  perform public.fel__exigir_plataforma(p_actor);
  if p_motivo is null or length(btrim(p_motivo)) < 5 or p_fuente is null or length(btrim(p_fuente)) < 5 then
    raise exception 'FEL_REGLA: motivo y fuente normativa son obligatorios';
  end if;
  select * into v from public.identificaciones_tipos where codigo = p_codigo for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: tipo de identificación no encontrado'; end if;
  if v.verificado then raise exception 'FEL_REGLA: el tipo ya está verificado'; end if;
  update public.identificaciones_tipos set patron = nullif(btrim(p_patron), ''), fuente = btrim(p_fuente), verificado = true,
         verificado_por = p_actor, verificado_en = now() where codigo = p_codigo;
  perform public.fel_auditar(null, p_actor, 'identificacion.verificar', 'regimen', p_codigo,
    jsonb_build_object('patron', p_patron, 'fuente', p_fuente, 'motivo', p_motivo));
end $$;

-- ---------------------------------------------------------------- permisos de ejecución: solo service_role
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like 'fel\_op\_documento%' or p.proname like 'fel\_op\_certificacion%'
               or p.proname like 'fel\_op\_anulacion%' or p.proname like 'fel\_op\_operacion%' or p.proname like 'fel\_admin\_regla%'
               or p.proname like 'fel\_admin\_identificacion%' or p.proname like 'fel\_\_documento%' or p.proname like 'fel\_\_fiscal%'
               or p.proname like 'fel\_\_emision%' or p.proname like 'fel\_identificacion\_validar')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
