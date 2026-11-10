-- NEXA FEL · Fase 1.0 · corrección controlada de seguridad.
--  (1) Cuenta activa y administrador maestro activo, como funciones únicas para la API.
--  (2) Interruptor de emisión real A NIVEL DE BASE DE DATOS: ninguna acción, función ni cambio de configuración de la
--      Edge Function puede habilitarla; solo se cambia con SQL de propietario de la base (migración/consola), no con service_role.
--  (3) Limitador de peticiones atómico y persistente (ventana fija) compartido por todas las instancias de la Edge Function.

-- ---------------------------------------------------------------- (1) cuenta activa
-- Sin fila en perfiles = activa (todavía no aceptó invitaciones); con perfiles.activo = false = bloqueada.
create or replace function public.fel_usuario_activo(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user is not null and not exists (select 1 from public.perfiles pf where pf.user_id = p_user and not pf.activo)
$$;

create or replace function public.fel_es_plataforma(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.fel_usuario_activo(p_user)
     and exists (select 1 from public.plataforma_admins pa where pa.user_id = p_user)
$$;

-- ---------------------------------------------------------------- (2) interruptor de emisión real
create table public.plataforma_config (
  clave          text primary key,
  valor          boolean not null,
  actualizado_en timestamptz not null default now()
);
alter table public.plataforma_config enable row level security;
revoke all on public.plataforma_config from public, anon, authenticated, service_role;
insert into public.plataforma_config (clave, valor) values ('emision_real_disponible', false);

-- Cualquier cambio del interruptor queda en la auditoría.
create or replace function public.fel_config_auditar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'FEL_REGLA: la configuración de plataforma no se borra'; end if;
  new.actualizado_en := now();
  perform public.fel_auditar(null, null, 'plataforma.config_cambiada', 'plataforma', new.clave,
    jsonb_build_object('antes', case when tg_op = 'UPDATE' then old.valor end, 'despues', new.valor), 'sql');
  return new;
end $$;
create trigger plataforma_config_auditar before insert or update or delete on public.plataforma_config
  for each row execute function public.fel_config_auditar();

create or replace function public.fel__emision_real_disponible() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select valor from public.plataforma_config where clave = 'emision_real_disponible'), false)
$$;

-- Empresa: se agrega el interruptor global a la regla existente (empresa habilitada + régimen verificado + autorización).
create or replace function public.fel_empresa_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.actualizado_en := now();
  if new.estado = 'habilitada' and new.regimen_id is null then
    raise exception 'FEL_REGLA: una empresa habilitada necesita un régimen asignado';
  end if;
  if tg_op = 'UPDATE' and old.emision_real_habilitada and new.regimen_id is distinct from old.regimen_id then
    raise exception 'FEL_REGLA: no se puede cambiar el régimen con la emisión real habilitada; deshabilítala primero';
  end if;
  if new.emision_real_habilitada then
    if tg_op = 'INSERT' or not old.emision_real_habilitada then
      if not public.fel__emision_real_disponible() then
        raise exception 'FEL_EMISION_BLOQUEADA: la emisión real no está disponible en esta plataforma';
      end if;
    end if;
    if new.estado <> 'habilitada' then
      raise exception 'FEL_REGLA: la emisión real exige una empresa habilitada';
    end if;
    if not exists (select 1 from public.regimenes_fiscales r where r.id = new.regimen_id and r.estado = 'verificado') then
      raise exception 'FEL_REGLA: el régimen de la empresa no está verificado';
    end if;
    if new.emision_autorizada_por is null or new.emision_autorizada_en is null then
      raise exception 'FEL_REGLA: falta la autorización específica de la emisión real';
    end if;
  end if;
  return new;
end $$;

-- Las operaciones fiscales (certificar/anular) también exigen el interruptor global en CADA llamada.
create or replace function public.fel__emision_real_activa(p_empresa uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.fel__emision_real_disponible()
     or not exists (select 1 from public.empresas e join public.regimenes_fiscales r on r.id = e.regimen_id
                     where e.id = p_empresa and e.estado = 'habilitada' and e.emision_real_habilitada and r.estado = 'verificado') then
    raise exception 'FEL_EMISION_BLOQUEADA: la emisión real no está habilitada para esta empresa';
  end if;
end $$;

-- ---------------------------------------------------------------- (3) limitador de peticiones
-- Ventana fija por clave. El UPSERT condicionado es atómico: la fila queda bloqueada durante el conflicto, así que
-- N sesiones simultáneas nunca superan el máximo. Las peticiones rechazadas no incrementan el contador.
create table public.limites_peticiones (
  clave         text not null check (length(clave) between 1 and 200),
  ventana_inicio timestamptz not null,
  contador      integer not null check (contador >= 0),
  primary key (clave, ventana_inicio)
);
create index limites_peticiones_ventana_idx on public.limites_peticiones (ventana_inicio);
alter table public.limites_peticiones enable row level security;
revoke all on public.limites_peticiones from public, anon, authenticated, service_role;

create or replace function public.fel_limite_consumir(p_clave text, p_ventana_seg integer, p_max integer)
returns table (permitido boolean, reintentar_en integer)
language plpgsql security definer set search_path = '' as $$
declare v_ini timestamptz; v_fin timestamptz; v_c integer;
begin
  if p_clave is null or length(p_clave) not between 1 and 200 or p_ventana_seg is null or p_ventana_seg not between 1 and 86400
     or p_max is null or p_max not between 1 and 1000000 then
    raise exception 'FEL_REGLA: parámetros de límite no válidos';
  end if;
  v_ini := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_ventana_seg) * p_ventana_seg);
  v_fin := v_ini + make_interval(secs => p_ventana_seg);
  insert into public.limites_peticiones as l (clave, ventana_inicio, contador) values (p_clave, v_ini, 1)
  on conflict (clave, ventana_inicio) do update set contador = l.contador + 1 where l.contador < p_max
  returning l.contador into v_c;
  -- Expiración: las ventanas viejas ya no cuentan (la clave incluye la ventana); además se purgan de forma oportunista.
  if random() < 0.02 then
    delete from public.limites_peticiones where ventana_inicio < clock_timestamp() - interval '2 days';
  end if;
  permitido := v_c is not null;
  reintentar_en := greatest(1, ceil(extract(epoch from (v_fin - clock_timestamp())))::integer);
  return next;
end $$;

-- ---------------------------------------------------------------- permisos de ejecución: solo service_role
revoke all on function public.fel_usuario_activo(uuid), public.fel_es_plataforma(uuid), public.fel__emision_real_disponible(),
  public.fel_limite_consumir(text, integer, integer), public.fel_config_auditar() from public, anon, authenticated;
grant execute on function public.fel_usuario_activo(uuid), public.fel_es_plataforma(uuid), public.fel__emision_real_disponible(),
  public.fel_limite_consumir(text, integer, integer) to service_role;
