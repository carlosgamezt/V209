-- M-B · Conexión con Digifact por empresa (PROPUESTA; NO se aplica sin autorización). Requiere M-A y M-D.
-- La credencial (usuario y contraseña) se guarda SOLO cifrada con AES-256-GCM por la función de servidor (ver credenciales_empresa.ts); la base nunca ve el texto claro.
-- Ningún usuario ni el maestro puede leer `credencial_cifrada`: no hay política, privilegio ni vista que la devuelva; solo la función de servicio `fel_sys_digifact_credencial` (service_role).
create table public.empresa_digifact_config (
  empresa_id         uuid primary key references public.empresas (id),
  ambiente           text not null default 'pruebas' check (ambiente = 'pruebas'),   -- cerrojo: producción se abre en una migración futura, con autorización expresa
  estado             text not null default 'sin_configurar' check (estado in ('sin_configurar','pendiente_prueba','activo','suspendido')),
  digifact_nit       text check (digifact_nit is null or digifact_nit ~ '^[0-9]{1,12}$'),
  credencial_cifrada bytea check (credencial_cifrada is null or length(credencial_cifrada) between 30 and 2048),
  llave_version      smallint check (llave_version is null or llave_version between 1 and 99),
  consulta_nit       boolean not null default false,
  consulta_cui       boolean not null default false,
  certificar         boolean not null default false,
  correo_digifact    boolean not null default false,
  ultima_prueba_en   timestamptz,
  ultima_prueba_ok   boolean,
  version            integer not null default 1,
  creado_por         uuid references auth.users (id),
  creado_en          timestamptz not null default now(),
  actualizado_por    uuid references auth.users (id),
  actualizado_en     timestamptz not null default now(),
  check ((credencial_cifrada is null) = (llave_version is null)),
  check (estado = 'sin_configurar' or (credencial_cifrada is not null and digifact_nit is not null)),
  check (estado = 'activo' or not (consulta_nit or consulta_cui or certificar or correo_digifact))   -- los interruptores solo con la conexión activa
);
-- Cada cuenta de Digifact (NIT) pertenece a UNA sola empresa: nunca se comparten credenciales ni tokens.
create unique index empresa_digifact_nit_uq on public.empresa_digifact_config (digifact_nit) where digifact_nit is not null;
alter table public.empresa_digifact_config enable row level security;
revoke all on public.empresa_digifact_config from public, anon, authenticated;

create table public.empresa_digifact_eventos (
  id         bigint generated always as identity primary key,
  empresa_id uuid not null references public.empresas (id),
  tipo       text not null check (tipo in ('conectar','probar','interruptores','suspender','uso_credencial','rotar_llave')),
  actor      uuid references auth.users (id),
  detalle    jsonb not null default '{}' check (jsonb_typeof(detalle) = 'object' and length(detalle::text) <= 2000
             and not (detalle ?| array['password','contrasena','clave','token','credencial','secret','secreto','usuario'])),
  creado_en  timestamptz not null default now()
);
create index empresa_digifact_eventos_idx on public.empresa_digifact_eventos (empresa_id, creado_en desc);
alter table public.empresa_digifact_eventos enable row level security;
revoke all on public.empresa_digifact_eventos from public, anon, authenticated;
grant select on public.empresa_digifact_eventos to authenticated;
create policy digifact_eventos_leer on public.empresa_digifact_eventos for select to authenticated using (public.fel_tiene_permiso(empresa_id, 'auditoria.ver'));

create or replace function public.fel_solo_agregar() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'FEL_REGLA: este registro solo admite altas'; end $$;
create trigger empresa_digifact_eventos_solo_alta before update or delete on public.empresa_digifact_eventos for each row execute function public.fel_solo_agregar();

-- Reglas de la configuración: el NIT no cambia tras la primera operación; certificar exige emisor aprobado y prueba correcta; versión que avanza.
create or replace function public.fel_digifact_config_reglas() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if old.digifact_nit is not null and new.digifact_nit is distinct from old.digifact_nit
       and exists (select 1 from public.digifact_operaciones o where o.empresa_id = old.empresa_id) then
      raise exception 'FEL_REGLA: el NIT de Digifact no puede cambiar una vez existen operaciones de la empresa';
    end if;
    new.version := old.version + 1; new.actualizado_en := now();
  end if;
  if new.certificar then
    if not exists (select 1 from public.empresa_emisor_versiones e where e.empresa_id = new.empresa_id and e.estado = 'aprobada') then
      raise exception 'FEL_REGLA: certificar exige datos del emisor aprobados';
    end if;
    if new.ultima_prueba_ok is distinct from true then raise exception 'FEL_REGLA: certificar exige una prueba de conexión correcta'; end if;
  end if;
  return new;
end $$;
create trigger empresa_digifact_config_reglas before insert or update on public.empresa_digifact_config for each row execute function public.fel_digifact_config_reglas();

create or replace function public.fel__digifact_evento(p_empresa uuid, p_tipo text, p_actor uuid, p_detalle jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.empresa_digifact_eventos (empresa_id, tipo, actor, detalle) values (p_empresa, p_tipo, p_actor, coalesce(p_detalle, '{}'::jsonb))
$$;

-- Guardar o reemplazar la credencial: SIEMPRE devuelve la conexión a «pendiente_prueba» y apaga todos los interruptores. No se registra ni audita ningún valor secreto (solo la versión de llave y los 4 últimos dígitos del NIT).
create or replace function public.fel_op_digifact_conectar(p_actor uuid, p_empresa uuid, p_nit text, p_credencial bytea, p_llave_version smallint, p_version integer) returns public.empresa_digifact_config
language plpgsql security definer set search_path = '' as $$
declare c public.empresa_digifact_config;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'digifact.conectar');
  select * into c from public.empresa_digifact_config where empresa_id = p_empresa for update;
  if not found then
    if p_version is not null and p_version <> 0 then raise exception 'FEL_CONFLICTO: la configuración cambió; recarga'; end if;
    insert into public.empresa_digifact_config (empresa_id, estado, digifact_nit, credencial_cifrada, llave_version, creado_por, actualizado_por)
    values (p_empresa, 'pendiente_prueba', p_nit, p_credencial, p_llave_version, p_actor, p_actor) returning * into c;
  else
    if p_version is distinct from c.version then raise exception 'FEL_CONFLICTO: la configuración cambió; recarga'; end if;
    update public.empresa_digifact_config set estado = 'pendiente_prueba', digifact_nit = p_nit, credencial_cifrada = p_credencial, llave_version = p_llave_version,
      consulta_nit = false, consulta_cui = false, certificar = false, correo_digifact = false, ultima_prueba_en = null, ultima_prueba_ok = null, actualizado_por = p_actor
    where empresa_id = p_empresa returning * into c;
  end if;
  perform public.fel__digifact_evento(p_empresa, 'conectar', p_actor, jsonb_build_object('llave_version', p_llave_version, 'nit_ultimos4', right(p_nit, 4)));
  perform public.fel_auditar(p_empresa, p_actor, 'digifact.conectar', 'digifact', p_empresa::text, jsonb_build_object('llave_version', p_llave_version));
  return c;
end $$;

create or replace function public.fel_op_digifact_registrar_prueba(p_actor uuid, p_empresa uuid, p_ok boolean) returns public.empresa_digifact_config
language plpgsql security definer set search_path = '' as $$
declare c public.empresa_digifact_config;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'digifact.probar');
  select * into c from public.empresa_digifact_config where empresa_id = p_empresa for update;
  if not found or c.estado = 'sin_configurar' then raise exception 'FEL_REGLA: la empresa no tiene credenciales de Digifact'; end if;
  update public.empresa_digifact_config set ultima_prueba_en = now(), ultima_prueba_ok = p_ok, actualizado_por = p_actor,
    estado = case when c.estado in ('pendiente_prueba','suspendido') and p_ok then 'activo' when not p_ok then 'pendiente_prueba' else c.estado end,
    consulta_nit = case when p_ok then c.consulta_nit else false end, consulta_cui = case when p_ok then c.consulta_cui else false end,
    certificar = case when p_ok then c.certificar else false end, correo_digifact = case when p_ok then c.correo_digifact else false end
  where empresa_id = p_empresa returning * into c;
  perform public.fel__digifact_evento(p_empresa, 'probar', p_actor, jsonb_build_object('ok', p_ok));
  return c;
end $$;

create or replace function public.fel_op_digifact_interruptores(p_actor uuid, p_empresa uuid, p_nit boolean, p_cui boolean, p_certificar boolean, p_correo boolean, p_version integer) returns public.empresa_digifact_config
language plpgsql security definer set search_path = '' as $$
declare c public.empresa_digifact_config;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'digifact.conectar');
  select * into c from public.empresa_digifact_config where empresa_id = p_empresa for update;
  if not found or c.estado <> 'activo' then raise exception 'FEL_REGLA: los interruptores exigen la conexión activa (credenciales guardadas y probadas)'; end if;
  if p_version is distinct from c.version then raise exception 'FEL_CONFLICTO: la configuración cambió; recarga'; end if;
  update public.empresa_digifact_config set consulta_nit = p_nit, consulta_cui = p_cui, certificar = p_certificar, correo_digifact = p_correo, actualizado_por = p_actor
  where empresa_id = p_empresa returning * into c;
  perform public.fel__digifact_evento(p_empresa, 'interruptores', p_actor, jsonb_build_object('nit', p_nit, 'cui', p_cui, 'certificar', p_certificar, 'correo', p_correo));
  return c;
end $$;

create or replace function public.fel_op_digifact_suspender(p_actor uuid, p_empresa uuid) returns public.empresa_digifact_config
language plpgsql security definer set search_path = '' as $$
declare c public.empresa_digifact_config;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'digifact.conectar');
  update public.empresa_digifact_config set estado = 'suspendido', consulta_nit = false, consulta_cui = false, certificar = false, correo_digifact = false, actualizado_por = p_actor
  where empresa_id = p_empresa and estado <> 'sin_configurar' returning * into c;
  if not found then raise exception 'FEL_NO_ENCONTRADO: la empresa no tiene conexión con Digifact'; end if;
  perform public.fel__digifact_evento(p_empresa, 'suspender', p_actor, '{}'::jsonb);
  return c;
end $$;

-- Lectura de la credencial SOLO para el resolvedor del servidor (service_role). Registra el uso a lo sumo una vez cada 10 minutos por empresa (la caché del resolvedor ya limita las lecturas).
create or replace function public.fel_sys_digifact_credencial(p_empresa uuid)
returns table (digifact_nit text, credencial_cifrada bytea, llave_version smallint, consulta_nit boolean, consulta_cui boolean, certificar boolean, correo_digifact boolean, version integer)
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.empresa_digifact_config c where c.empresa_id = p_empresa and c.estado = 'activo') then return; end if;
  if not exists (select 1 from public.empresa_digifact_eventos e where e.empresa_id = p_empresa and e.tipo = 'uso_credencial' and e.creado_en > now() - interval '10 minutes') then
    perform public.fel__digifact_evento(p_empresa, 'uso_credencial', null, '{}'::jsonb);
  end if;
  return query select c.digifact_nit, c.credencial_cifrada, c.llave_version, c.consulta_nit, c.consulta_cui, c.certificar, c.correo_digifact, c.version
    from public.empresa_digifact_config c where c.empresa_id = p_empresa and c.estado = 'activo';
end $$;

-- Lo que ve el usuario con permiso `fiscal.ver`: estado e interruptores, NUNCA la credencial ni la versión de llave (vista con el privilegio del dueño y filtro por permiso).
create view public.v_empresa_digifact_estado with (security_barrier = true) as
  select c.empresa_id, c.ambiente, c.estado, (c.credencial_cifrada is not null) as tiene_credencial, ('...' || right(c.digifact_nit, 4)) as nit_parcial,
         c.consulta_nit, c.consulta_cui, c.certificar, c.correo_digifact, c.ultima_prueba_en, c.ultima_prueba_ok, c.version, c.actualizado_en
    from public.empresa_digifact_config c where public.fel_tiene_permiso(c.empresa_id, 'fiscal.ver');
revoke all on public.v_empresa_digifact_estado from public, anon, authenticated;
grant select on public.v_empresa_digifact_estado to authenticated;

revoke all on function public.fel_emisor_inmutable(), public.fel_solo_agregar(), public.fel_digifact_config_reglas(), public.fel__digifact_evento(uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fel_op_digifact_conectar(uuid, uuid, text, bytea, smallint, integer), public.fel_op_digifact_registrar_prueba(uuid, uuid, boolean),
  public.fel_op_digifact_interruptores(uuid, uuid, boolean, boolean, boolean, boolean, integer), public.fel_op_digifact_suspender(uuid, uuid), public.fel_sys_digifact_credencial(uuid) from public, anon, authenticated;
grant execute on function public.fel_op_digifact_conectar(uuid, uuid, text, bytea, smallint, integer), public.fel_op_digifact_registrar_prueba(uuid, uuid, boolean),
  public.fel_op_digifact_interruptores(uuid, uuid, boolean, boolean, boolean, boolean, integer), public.fel_op_digifact_suspender(uuid, uuid), public.fel_sys_digifact_credencial(uuid) to service_role;
