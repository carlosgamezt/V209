-- NEXA FEL · Fase 4 (4/9) · el plano de control verifica la FIRMA antes de revelar nada: la clave pública se entrega también para un agente REVOCADO
-- (así solo quien posee la clave privada recibe el mensaje «revocado»; un desconocido o una firma inválida reciben siempre la misma respuesta uniforme).
create or replace function public.fel_sys_agente_clave(p_agente uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('clave_publica', clave_publica, 'empresa_id', empresa_id, 'estado', estado) from public.agentes_locales where id = p_agente
$$;
revoke all on function public.fel_sys_agente_clave(uuid) from public, anon, authenticated;
grant execute on function public.fel_sys_agente_clave(uuid) to service_role;
