-- NEXA FEL · Fase 4 (5/9) · el cierre de una orden en NEXA es EXCLUSIVO: varios supervisores o ejecuciones manuales a la vez no procesan la misma orden dos veces.
-- Hallazgo de las pruebas de concurrencia del commit 5: con varios cierres simultáneos el resultado ya era correcto (una sola certificación, idempotente), pero cada cierre
-- perdedor registraba además un evento duplicado del proveedor. Ahora solo UN cierre reserva la orden; el resto la salta. La reserva caduca sola (un cierre caído no la bloquea).
alter table public.ordenes_emision add column cierre_hasta timestamptz;

create or replace function public.fel_sys_orden_cierre_reservar(p_orden uuid, p_segundos integer default 60) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v integer;
begin
  if p_segundos is null or p_segundos < 5 or p_segundos > 600 then raise exception 'FEL_REGLA: duración de la reserva no válida'; end if;
  update public.ordenes_emision set cierre_hasta = clock_timestamp() + make_interval(secs => p_segundos)
   where id = p_orden and estado in ('completada','descartada','fallida') and (cierre_hasta is null or cierre_hasta < clock_timestamp());
  get diagnostics v = row_count;
  return v = 1;
end $$;

-- Si el cierre falla por un error inesperado, se libera la reserva para que el siguiente ciclo lo reintente (el cierre es idempotente).
create or replace function public.fel_sys_orden_cierre_liberar(p_orden uuid) returns void
language sql security definer set search_path = '' as $$
  update public.ordenes_emision set cierre_hasta = null where id = p_orden
$$;

revoke all on function public.fel_sys_orden_cierre_reservar(uuid, integer), public.fel_sys_orden_cierre_liberar(uuid) from public, anon, authenticated;
grant execute on function public.fel_sys_orden_cierre_reservar(uuid, integer), public.fel_sys_orden_cierre_liberar(uuid) to service_role;
