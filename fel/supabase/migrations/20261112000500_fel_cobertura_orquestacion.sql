-- D3-2 · Funciones de apoyo para orquestar la cobertura (bolsón + monedero) alrededor de una operación fiscal.
-- Solo funciones nuevas (service_role). No cambia tablas ni funciones existentes.

-- Cuenta del bolsón SIMULADA activa de un proveedor (única por proveedor y ambiente simulado en esta versión).
create or replace function public.fel_sys_bolson_cuenta_simulada(p_proveedor text default 'digifact') returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.bolson_cuentas where proveedor_id = p_proveedor and ambiente = 'simulado' and estado = 'activa' order by creada_en limit 1
$$;

-- Cierra la cobertura de UNA operación fiscal según su resultado confirmado. Idempotente.
--   · confirmada_exitosa / confirmada_fallida → se confirma el consumo (por prudencia, el proveedor pudo consumir al rechazar);
--     el cargo al cliente lo decide fel_sys_cobertura_confirmar (un rechazo confirmado NO se cobra).
--   · iniciada / desconocida → no se toca nada: la reserva sigue retenida hasta conocer el resultado (nunca se libera por tiempo).
create or replace function public.fel_sys_cobertura_cerrar(p_empresa uuid, p_op uuid) returns public.consumos
language plpgsql security definer set search_path = '' as $$
declare v_op public.operaciones_fiscales; v_c public.consumos;
begin
  select * into v_op from public.operaciones_fiscales where id = p_op and empresa_id = p_empresa;
  if not found then raise exception 'FEL_NO_ENCONTRADO: operación no encontrada en la empresa'; end if;
  select * into v_c from public.consumos where empresa_id = p_empresa and operacion_id = p_op and evento_tipo in ('certificacion','anulacion') order by reservado_en desc limit 1;
  if not found then return null; end if;
  if v_c.estado = 'reservado' and v_op.estado in ('confirmada_exitosa','confirmada_fallida') then
    return public.fel_sys_cobertura_confirmar(p_empresa, v_c.id, null, 'op-' || p_op::text, jsonb_build_object('origen', 'orquestacion', 'operacion_estado', v_op.estado));
  end if;
  return v_c;
end $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('fel_sys_bolson_cuenta_simulada','fel_sys_cobertura_cerrar') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
