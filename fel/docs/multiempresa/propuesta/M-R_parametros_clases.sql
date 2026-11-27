-- M-R · Parámetros de plataforma por CLASE (PROPUESTA; fuera de supabase/migrations; NO se aplica sin autorización). Sustituye la entrega indiscriminada de `plataforma_parametros` por listas EXPLÍCITAS según contexto y permisos.
-- Clases (la base es la fuente única; un parámetro NUEVO no clasificado es «interno» y no sale de la base hasta que alguien lo clasifique aquí):
--   usuario     · lo que la interfaz de cualquier persona con sesión viva muestra o necesita (ventanas de conciliación y recuperación de la pantalla de Configuración).
--   empresa     · afecta a la administración de la empresa; solo con el permiso correspondiente (empresa.editar / agentes.administrar) en la empresa de la sesión.
--   plataforma  · operación del agente y de la plataforma; solo el administrador de la plataforma.
--   interno     · umbrales de defensa y de seguridad (límites de intentos y de peticiones, desfase de reloj, MFA): NUNCA salen de la base hacia ningún cliente, ni a la plataforma (revelan cómo se defiende el sistema).
-- ENDURECIMIENTO: `fel_es_admin_plataforma()` (migración 1000) daba por bueno `aal2` con solo mirar el TOKEN; los claims pueden estar desactualizados hasta renovar el token. Se exige además `fel__aal2()` (token Y sesión guardada en auth.sessions, M-L).
-- Es solo MÁS estricta: nunca concede algo que antes se negaba. La usan las políticas RLS de plataforma y los ayudantes de esta propuesta.
create or replace function public.fel_es_admin_plataforma() returns boolean language sql stable security definer set search_path = '' as $$
  select public.fel_usuario_activo(auth.uid())
     and exists (select 1 from public.plataforma_admins pa where pa.user_id = auth.uid())
     and coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'aal', '') = 'aal2'
     and public.fel__sesion_vigente()
     and public.fel__aal2()
$$;
create or replace function public.fel__parametro_clase(p_clave text) returns text language sql immutable set search_path = '' as $$
  select case
    when p_clave in ('espera_conciliacion_manual_min', 'ventana_tardia_min', 'umbral_recuperacion_min', 'ventana_auditoria_min') then 'usuario'
    when p_clave in ('establecimiento_por_usuario', 'agente_codigo_min', 'agente_latido_max_seg') then 'empresa'
    when p_clave in ('agente_version_minima', 'agente_version_recomendada', 'agente_sondeo_activo_ms', 'agente_sondeo_reposo_ms', 'agente_lease_seg', 'agente_actividad_reciente_seg') then 'plataforma'
    when p_clave in ('agente_reloj_max_seg', 'agente_max_peticiones_min', 'agente_vinculacion_max_origen', 'agente_vinculacion_max_global', 'mfa_operaciones_sensibles', 'plataforma_mfa_obligatoria') then 'interno'
    else null end   -- sin clasificar: se trata como interno
$$;
create or replace function public.fel__parametro_permiso(p_clave text) returns text language sql immutable set search_path = '' as $$
  select case p_clave when 'establecimiento_por_usuario' then 'empresa.editar' when 'agente_codigo_min' then 'agentes.administrar' when 'agente_latido_max_seg' then 'agentes.administrar' end
$$;
revoke all on function public.fel__parametro_clase(text), public.fel__parametro_permiso(text) from public, anon, authenticated;   -- solo las usa la función DEFINER de abajo
-- la versión sin argumentos (M-O) se sustituye por una con contexto; sin argumento = 'usuario' (lo mínimo)
drop function if exists public.fel__parametros_lista();
create or replace function public.fel__parametros_lista(p_contexto text default 'usuario') returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_admin boolean; v_emp uuid; r jsonb;
begin
  if not public.fel__sesion_viva() then return null; end if;
  v_admin := public.fel_es_admin_plataforma();
  if p_contexto = 'empresa' and not v_admin then begin v_emp := public.fel__empresa_actual(); exception when others then v_emp := null; end; end if;
  select coalesce(jsonb_agg(jsonb_build_object('clave', p.clave, 'valor', p.valor::text) order by p.clave), '[]'::jsonb) into r
    from public.plataforma_parametros p
   where case public.fel__parametro_clase(p.clave)
           when 'usuario' then true
           when 'empresa' then (p_contexto = 'plataforma' and v_admin) or (p_contexto = 'empresa' and v_emp is not null and public.fel_tiene_permiso(v_emp, public.fel__parametro_permiso(p.clave)))
           when 'plataforma' then p_contexto = 'plataforma' and v_admin
           else false end;   -- interno y sin clasificar: nunca
  return r;
end $$;
revoke all on function public.fel__parametros_lista(text) from public, anon;
grant execute on function public.fel__parametros_lista(text) to authenticated;
