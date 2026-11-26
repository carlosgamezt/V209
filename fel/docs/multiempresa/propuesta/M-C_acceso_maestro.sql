-- M-C · Acceso excepcional del administrador maestro a datos de UNA empresa (PROPUESTA; NO se aplica sin autorización). Requiere M-A y M-B.
-- Con sus permisos ordinarios el maestro NO lee documentos, clientes, emisor ni credenciales (no existe política que se lo permita). Solo estas funciones, con un permiso vigente
-- (motivo, aprobado por OTRO maestro, vence en ≤ 24 h), y cada lectura queda en la auditoría de la empresa. Las credenciales nunca son alcance posible.
create table public.acceso_maestro_datos (
  id           uuid primary key default gen_random_uuid(),
  maestro_id   uuid not null references auth.users (id),
  empresa_id   uuid not null references public.empresas (id),
  alcance      text not null check (alcance in ('documentos','configuracion')),
  motivo       text not null check (length(btrim(motivo)) >= 20),
  aprobado_por uuid not null references auth.users (id) check (aprobado_por <> maestro_id),
  creada_en    timestamptz not null default now(),
  expira_en    timestamptz not null,
  revocada_en  timestamptz,
  check (expira_en > creada_en and expira_en <= creada_en + interval '24 hours')
);
alter table public.acceso_maestro_datos enable row level security;
revoke all on public.acceso_maestro_datos from public, anon, authenticated;
create trigger acceso_maestro_datos_solo_alta before delete on public.acceso_maestro_datos for each row execute function public.fel_solo_agregar();

create or replace function public.fel_admin_acceso_solicitar(p_actor uuid, p_empresa uuid, p_alcance text, p_motivo text, p_aprobador uuid, p_horas integer) returns public.acceso_maestro_datos
language plpgsql security definer set search_path = '' as $$
declare a public.acceso_maestro_datos;
begin
  if p_actor is null or not public.fel_es_plataforma(p_actor) then raise exception 'FEL_NO_AUTORIZADO: solo el administrador de la plataforma'; end if;
  if p_aprobador is null or p_aprobador = p_actor or not public.fel_es_plataforma(p_aprobador) then raise exception 'FEL_REGLA: lo aprueba OTRO administrador de la plataforma'; end if;
  if p_horas is null or p_horas not between 1 and 24 then raise exception 'FEL_REGLA: la duración es de 1 a 24 horas'; end if;
  if not exists (select 1 from public.empresas where id = p_empresa) then raise exception 'FEL_NO_ENCONTRADO: empresa no encontrada'; end if;
  insert into public.acceso_maestro_datos (maestro_id, empresa_id, alcance, motivo, aprobado_por, expira_en)
  values (p_actor, p_empresa, p_alcance, p_motivo, p_aprobador, now() + make_interval(hours => p_horas)) returning * into a;
  perform public.fel_auditar(p_empresa, p_actor, 'maestro.acceso_excepcional.concedido', 'acceso_maestro', a.id::text, jsonb_build_object('alcance', p_alcance, 'horas', p_horas, 'aprobado_por', p_aprobador, 'motivo', p_motivo));
  return a;
end $$;

create or replace function public.fel_admin_acceso_revocar(p_actor uuid, p_acceso uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.acceso_maestro_datos;
begin
  if p_actor is null or not public.fel_es_plataforma(p_actor) then raise exception 'FEL_NO_AUTORIZADO: solo el administrador de la plataforma'; end if;
  update public.acceso_maestro_datos set revocada_en = now() where id = p_acceso and revocada_en is null returning * into a;
  if not found then raise exception 'FEL_NO_ENCONTRADO: acceso no encontrado o ya revocado'; end if;
  perform public.fel_auditar(a.empresa_id, p_actor, 'maestro.acceso_excepcional.revocado', 'acceso_maestro', a.id::text, '{}'::jsonb);
end $$;

create or replace function public.fel__acceso_vigente(p_actor uuid, p_empresa uuid, p_alcance text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.acceso_maestro_datos where maestro_id = p_actor and empresa_id = p_empresa and alcance = p_alcance and revocada_en is null and expira_en > now() order by creada_en desc limit 1
$$;

create or replace function public.fel_admin_datos_excepcionales_documentos(p_actor uuid, p_empresa uuid, p_limite integer default 50)
returns table (id uuid, estado_preparacion text, estado_fiscal text, creado_en timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_acc uuid; v_n integer;
begin
  if p_actor is null or not public.fel_es_plataforma(p_actor) then raise exception 'FEL_NO_AUTORIZADO: solo el administrador de la plataforma'; end if;
  v_acc := public.fel__acceso_vigente(p_actor, p_empresa, 'documentos');
  if v_acc is null then raise exception 'FEL_NO_AUTORIZADO: no hay un acceso excepcional vigente para esta empresa y alcance'; end if;
  v_n := least(greatest(coalesce(p_limite, 50), 1), 200);
  perform public.fel_auditar(p_empresa, p_actor, 'maestro.lectura_excepcional', 'documentos', v_acc::text, jsonb_build_object('alcance', 'documentos', 'limite', v_n));
  return query select d.id, d.estado_preparacion, d.estado_fiscal, d.creado_en from public.documentos d where d.empresa_id = p_empresa order by d.creado_en desc limit v_n;
end $$;

-- Configuración (sin credenciales): emisor aprobado y estado de la conexión.
create or replace function public.fel_admin_datos_excepcionales_configuracion(p_actor uuid, p_empresa uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_acc uuid; r jsonb;
begin
  if p_actor is null or not public.fel_es_plataforma(p_actor) then raise exception 'FEL_NO_AUTORIZADO: solo el administrador de la plataforma'; end if;
  v_acc := public.fel__acceso_vigente(p_actor, p_empresa, 'configuracion');
  if v_acc is null then raise exception 'FEL_NO_AUTORIZADO: no hay un acceso excepcional vigente para esta empresa y alcance'; end if;
  perform public.fel_auditar(p_empresa, p_actor, 'maestro.lectura_excepcional', 'configuracion', v_acc::text, jsonb_build_object('alcance', 'configuracion'));
  select jsonb_build_object(
    'emisor', (select to_jsonb(e) from public.empresa_emisor_versiones e where e.empresa_id = p_empresa and e.estado = 'aprobada'),
    'digifact', (select jsonb_build_object('estado', c.estado, 'ambiente', c.ambiente, 'tiene_credencial', c.credencial_cifrada is not null, 'ultima_prueba_ok', c.ultima_prueba_ok,
                 'consulta_nit', c.consulta_nit, 'consulta_cui', c.consulta_cui, 'certificar', c.certificar, 'correo_digifact', c.correo_digifact)
                 from public.empresa_digifact_config c where c.empresa_id = p_empresa)) into r;
  return r;
end $$;

-- Resumen ordinario del maestro: SOLO cantidades y estados, nunca contenido.
create or replace function public.fel_admin_empresas_resumen(p_actor uuid)
returns table (empresa_id uuid, nombre_comercial text, estado text, usuarios_activos bigint, documentos_30d bigint, certificados_30d bigint, digifact_estado text)
language plpgsql security definer set search_path = '' as $$
begin
  if p_actor is null or not public.fel_es_plataforma(p_actor) then raise exception 'FEL_NO_AUTORIZADO: solo el administrador de la plataforma'; end if;
  return query select e.id, e.nombre_comercial, e.estado,
    (select count(*) from public.miembros m where m.empresa_id = e.id and m.activo),
    (select count(*) from public.documentos d where d.empresa_id = e.id and d.creado_en > now() - interval '30 days'),
    (select count(*) from public.documentos d where d.empresa_id = e.id and d.estado_fiscal = 'certificado' and d.creado_en > now() - interval '30 days'),
    coalesce((select c.estado from public.empresa_digifact_config c where c.empresa_id = e.id), 'sin_configurar')
  from public.empresas e order by e.nombre_comercial;
end $$;

revoke all on function public.fel_admin_acceso_solicitar(uuid, uuid, text, text, uuid, integer), public.fel_admin_acceso_revocar(uuid, uuid), public.fel__acceso_vigente(uuid, uuid, text),
  public.fel_admin_datos_excepcionales_documentos(uuid, uuid, integer), public.fel_admin_datos_excepcionales_configuracion(uuid, uuid), public.fel_admin_empresas_resumen(uuid) from public, anon, authenticated;
grant execute on function public.fel_admin_acceso_solicitar(uuid, uuid, text, text, uuid, integer), public.fel_admin_acceso_revocar(uuid, uuid), public.fel__acceso_vigente(uuid, uuid, text),
  public.fel_admin_datos_excepcionales_documentos(uuid, uuid, integer), public.fel_admin_datos_excepcionales_configuracion(uuid, uuid), public.fel_admin_empresas_resumen(uuid) to service_role;
