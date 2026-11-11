-- NEXA FEL · Fase 2 (ajustes de interfaz) · datos de contacto de la empresa y clientes frecuentes.
-- Cambios ADITIVOS: no toca el orquestador, las operaciones fiscales ni las reglas anti-duplicados; no habilita ningún canal.
-- Los datos fiscales críticos (razón social, NIT, régimen, estado, emisión real) NO se editan desde aquí.

-- ---------------------------------------------------------------- datos de contacto por empresa
alter table public.empresas add column direccion_fiscal text check (direccion_fiscal is null or length(direccion_fiscal) <= 300);
alter table public.empresas add column telefono text check (telefono is null or length(telefono) <= 40);
alter table public.empresas add column correo_facturacion text check (correo_facturacion is null or (length(correo_facturacion) <= 200 and correo_facturacion ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'));

insert into public.permisos_catalogo (codigo, descripcion) values
  ('empresa.editar', 'Editar nombre comercial, dirección, teléfono y correo de la empresa (no los datos fiscales críticos)');
insert into public.rol_permisos (rol, permiso) values ('propietario', 'empresa.editar'), ('administrador', 'empresa.editar');

create or replace function public.fel_op_empresa_datos_guardar(
  p_actor uuid, p_empresa uuid, p_nombre_comercial text, p_direccion text, p_telefono text, p_correo text) returns public.empresas
language plpgsql security definer set search_path = '' as $$
declare v_old public.empresas; v_new public.empresas;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'empresa.editar');
  if p_nombre_comercial is null or length(btrim(p_nombre_comercial)) not between 1 and 120 then raise exception 'FEL_REGLA: el nombre comercial es obligatorio (máximo 120 caracteres)'; end if;
  select * into v_old from public.empresas where id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: empresa no encontrada'; end if;
  begin
    update public.empresas
       set nombre_comercial = btrim(p_nombre_comercial), direccion_fiscal = nullif(btrim(p_direccion), ''),
           telefono = nullif(btrim(p_telefono), ''), correo_facturacion = nullif(btrim(p_correo), '')
     where id = p_empresa returning * into v_new;
  exception when check_violation then
    raise exception 'FEL_REGLA: dirección, teléfono o correo no válidos';
  end;
  perform public.fel_auditar(p_empresa, p_actor, 'empresa.datos_editar', 'empresa', p_empresa::text,
    jsonb_build_object('antes', jsonb_build_object('nombre_comercial', v_old.nombre_comercial, 'direccion_fiscal', v_old.direccion_fiscal, 'telefono', v_old.telefono, 'correo_facturacion', v_old.correo_facturacion),
                       'despues', jsonb_build_object('nombre_comercial', v_new.nombre_comercial, 'direccion_fiscal', v_new.direccion_fiscal, 'telefono', v_new.telefono, 'correo_facturacion', v_new.correo_facturacion)));
  return v_new;
end $$;

-- ---------------------------------------------------------------- clientes frecuentes (marca por empresa; no cambia la versión del cliente)
alter table public.clientes add column frecuente boolean not null default false;

create or replace function public.fel_op_cliente_frecuente(p_actor uuid, p_empresa uuid, p_id uuid, p_frecuente boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old public.clientes;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'clientes.escribir');
  select * into v_old from public.clientes where id = p_id and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: cliente no encontrado'; end if;
  if v_old.tipo_identificacion = 'CF' then raise exception 'FEL_REGLA: el consumidor final no se marca como frecuente'; end if;
  if v_old.frecuente is distinct from p_frecuente then
    update public.clientes set frecuente = p_frecuente, actualizado_por = p_actor where id = p_id and empresa_id = p_empresa;
    perform public.fel_auditar(p_empresa, p_actor, case when p_frecuente then 'cliente.frecuente' else 'cliente.no_frecuente' end, 'cliente', p_id::text,
      jsonb_build_object('numero_identificacion', v_old.numero_identificacion, 'nombre', v_old.nombre));
  end if;
end $$;

-- ---------------------------------------------------------------- privilegios: solo service_role
revoke all on function public.fel_op_empresa_datos_guardar(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.fel_op_cliente_frecuente(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.fel_op_empresa_datos_guardar(uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.fel_op_cliente_frecuente(uuid, uuid, uuid, boolean) to service_role;
