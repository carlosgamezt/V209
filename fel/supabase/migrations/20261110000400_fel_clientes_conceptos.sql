-- NEXA FEL · Fase 1.0 · escritura atómica de clientes y conceptos (dato + auditoría en una sola transacción).
-- Cada función valida el permiso del actor por su cuenta, aunque la llame la Edge Function con service_role.

create or replace function public.fel__exigir_permiso(p_actor uuid, p_empresa uuid, p_permiso text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_actor is null or not (p_permiso = any (public.fel_permisos_efectivos(p_empresa, p_actor))) then
    raise exception 'FEL_NO_AUTORIZADO: no tienes permiso para esta operación';
  end if;
end $$;

-- ---------------------------------------------------------------- clientes
create or replace function public.fel_op_cliente_guardar(
  p_actor uuid, p_empresa uuid, p_id uuid, p_nit text, p_nombre text,
  p_direccion text, p_email text, p_telefono text, p_version integer) returns public.clientes
language plpgsql security definer set search_path = '' as $$
declare v_old public.clientes; v_new public.clientes;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'clientes.escribir');
  if p_id is null then
    insert into public.clientes (empresa_id, nit, nombre, direccion, email, telefono, creado_por, actualizado_por)
    values (p_empresa, upper(btrim(p_nit)), btrim(p_nombre), nullif(btrim(p_direccion), ''), nullif(btrim(p_email), ''), nullif(btrim(p_telefono), ''), p_actor, p_actor)
    returning * into v_new;
    perform public.fel_auditar(p_empresa, p_actor, 'cliente.crear', 'cliente', v_new.id::text,
      jsonb_build_object('nit', v_new.nit, 'nombre', v_new.nombre));
  else
    select * into v_old from public.clientes where id = p_id and empresa_id = p_empresa for update;
    if not found then raise exception 'FEL_NO_ENCONTRADO: cliente no encontrado'; end if;
    if p_version is null or p_version <> v_old.version then
      raise exception 'FEL_CONFLICTO: el cliente cambió mientras lo editabas; recarga e intenta de nuevo';
    end if;
    update public.clientes
       set nit = upper(btrim(p_nit)), nombre = btrim(p_nombre), direccion = nullif(btrim(p_direccion), ''),
           email = nullif(btrim(p_email), ''), telefono = nullif(btrim(p_telefono), ''),
           version = version + 1, actualizado_por = p_actor
     where id = p_id and empresa_id = p_empresa returning * into v_new;
    perform public.fel_auditar(p_empresa, p_actor, 'cliente.editar', 'cliente', p_id::text,
      jsonb_build_object('antes', jsonb_build_object('nit', v_old.nit, 'nombre', v_old.nombre, 'direccion', v_old.direccion, 'email', v_old.email, 'telefono', v_old.telefono),
                         'despues', jsonb_build_object('nit', v_new.nit, 'nombre', v_new.nombre, 'direccion', v_new.direccion, 'email', v_new.email, 'telefono', v_new.telefono)));
  end if;
  return v_new;
end $$;

create or replace function public.fel_op_cliente_estado(p_actor uuid, p_empresa uuid, p_id uuid, p_activo boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old public.clientes;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'clientes.escribir');
  select * into v_old from public.clientes where id = p_id and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: cliente no encontrado'; end if;
  update public.clientes set activo = p_activo, version = version + 1, actualizado_por = p_actor where id = p_id and empresa_id = p_empresa;
  perform public.fel_auditar(p_empresa, p_actor, case when p_activo then 'cliente.reactivar' else 'cliente.baja' end, 'cliente', p_id::text,
    jsonb_build_object('nit', v_old.nit, 'nombre', v_old.nombre));
end $$;

-- ---------------------------------------------------------------- conceptos
create or replace function public.fel_op_concepto_guardar(
  p_actor uuid, p_empresa uuid, p_id uuid, p_codigo text, p_descripcion text, p_tipo text,
  p_unidad_medida text, p_precio_unitario numeric, p_categoria_fiscal text, p_version integer) returns public.conceptos
language plpgsql security definer set search_path = '' as $$
declare v_old public.conceptos; v_new public.conceptos;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'conceptos.escribir');
  if p_id is null then
    insert into public.conceptos (empresa_id, codigo, descripcion, tipo, unidad_medida, precio_unitario, categoria_fiscal, creado_por, actualizado_por)
    values (p_empresa, btrim(p_codigo), btrim(p_descripcion), p_tipo, coalesce(nullif(btrim(p_unidad_medida), ''), 'UND'),
            p_precio_unitario, nullif(btrim(p_categoria_fiscal), ''), p_actor, p_actor)
    returning * into v_new;
    perform public.fel_auditar(p_empresa, p_actor, 'concepto.crear', 'concepto', v_new.id::text,
      jsonb_build_object('codigo', v_new.codigo, 'descripcion', v_new.descripcion, 'precio_unitario', v_new.precio_unitario));
  else
    select * into v_old from public.conceptos where id = p_id and empresa_id = p_empresa for update;
    if not found then raise exception 'FEL_NO_ENCONTRADO: concepto no encontrado'; end if;
    if p_version is null or p_version <> v_old.version then
      raise exception 'FEL_CONFLICTO: el concepto cambió mientras lo editabas; recarga e intenta de nuevo';
    end if;
    update public.conceptos
       set codigo = btrim(p_codigo), descripcion = btrim(p_descripcion), tipo = p_tipo,
           unidad_medida = coalesce(nullif(btrim(p_unidad_medida), ''), 'UND'), precio_unitario = p_precio_unitario,
           categoria_fiscal = nullif(btrim(p_categoria_fiscal), ''), version = version + 1, actualizado_por = p_actor
     where id = p_id and empresa_id = p_empresa returning * into v_new;
    perform public.fel_auditar(p_empresa, p_actor, 'concepto.editar', 'concepto', p_id::text,
      jsonb_build_object('antes', jsonb_build_object('codigo', v_old.codigo, 'descripcion', v_old.descripcion, 'tipo', v_old.tipo, 'precio_unitario', v_old.precio_unitario, 'categoria_fiscal', v_old.categoria_fiscal),
                         'despues', jsonb_build_object('codigo', v_new.codigo, 'descripcion', v_new.descripcion, 'tipo', v_new.tipo, 'precio_unitario', v_new.precio_unitario, 'categoria_fiscal', v_new.categoria_fiscal)));
  end if;
  return v_new;
end $$;

create or replace function public.fel_op_concepto_estado(p_actor uuid, p_empresa uuid, p_id uuid, p_activo boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old public.conceptos;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'conceptos.escribir');
  select * into v_old from public.conceptos where id = p_id and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: concepto no encontrado'; end if;
  update public.conceptos set activo = p_activo, version = version + 1, actualizado_por = p_actor where id = p_id and empresa_id = p_empresa;
  perform public.fel_auditar(p_empresa, p_actor, case when p_activo then 'concepto.reactivar' else 'concepto.baja' end, 'concepto', p_id::text,
    jsonb_build_object('codigo', v_old.codigo, 'descripcion', v_old.descripcion));
end $$;

-- Estas funciones nuevas heredan el cierre por defecto (solo service_role las ejecuta).
revoke all on function public.fel__exigir_permiso(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.fel_op_cliente_guardar(uuid, uuid, uuid, text, text, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.fel_op_cliente_estado(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.fel_op_concepto_guardar(uuid, uuid, uuid, text, text, text, text, numeric, text, integer) from public, anon, authenticated;
revoke all on function public.fel_op_concepto_estado(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.fel__exigir_permiso(uuid, uuid, text) to service_role;
grant execute on function public.fel_op_cliente_guardar(uuid, uuid, uuid, text, text, text, text, text, integer) to service_role;
grant execute on function public.fel_op_cliente_estado(uuid, uuid, uuid, boolean) to service_role;
grant execute on function public.fel_op_concepto_guardar(uuid, uuid, uuid, text, text, text, text, numeric, text, integer) to service_role;
grant execute on function public.fel_op_concepto_estado(uuid, uuid, uuid, boolean) to service_role;
