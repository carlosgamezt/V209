-- NEXA FEL · Fase 1.0 · funciones, protecciones y operaciones administrativas atómicas.
-- Todas las funciones usan search_path vacío y nombres calificados. Las que escriben solo las puede ejecutar service_role
-- (la Edge Function "fel-api"), y aun así validan al actor por su cuenta (defensa en profundidad).

-- ============================================================ utilidades
create or replace function public.fel__rango(p_rol text) returns integer
language sql immutable set search_path = '' as $$
  select case p_rol when 'propietario' then 4 when 'administrador' then 3 when 'emisor' then 2 when 'lector' then 1 else 0 end
$$;

create or replace function public.fel_es_admin_plataforma() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.plataforma_admins pa where pa.user_id = auth.uid())
     and not exists (select 1 from public.perfiles pf where pf.user_id = auth.uid() and not pf.activo)
$$;

-- Permisos efectivos = permisos del rol + extras - revocados. Solo si la membresía y la empresa están activas/habilitadas.
create or replace function public.fel_permisos_efectivos(p_empresa uuid, p_user uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select array(
      select distinct x.p from (
        select rp.permiso as p from public.rol_permisos rp where rp.rol = m.rol
        union
        select unnest(m.permisos_extra)
      ) x
      where x.p <> all (m.permisos_revocados)
      order by 1)
    from public.miembros m
    join public.empresas e on e.id = m.empresa_id and e.estado = 'habilitada'
    where m.empresa_id = p_empresa and m.user_id = p_user and m.activo
      and not exists (select 1 from public.perfiles pf where pf.user_id = m.user_id and not pf.activo)
  ), '{}'::text[])
$$;

create or replace function public.fel_tiene_permiso(p_empresa uuid, p_permiso text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_permiso = any (public.fel_permisos_efectivos(p_empresa, auth.uid()))
$$;

create or replace function public.fel_es_miembro(p_empresa uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.miembros m
    join public.empresas e on e.id = m.empresa_id and e.estado = 'habilitada'
    where m.empresa_id = p_empresa and m.user_id = auth.uid() and m.activo
      and not exists (select 1 from public.perfiles pf where pf.user_id = m.user_id and not pf.activo))
$$;

-- Auditoría: única vía de escritura. Registra usuario, empresa, acción, fecha y hora (servidor) y datos relevantes.
create or replace function public.fel_auditar(
  p_empresa uuid, p_actor uuid, p_accion text, p_entidad text, p_entidad_id text,
  p_datos jsonb default '{}'::jsonb, p_origen text default 'fel-api') returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_email text;
begin
  select email into v_email from auth.users where id = p_actor;
  insert into public.auditoria (empresa_id, actor_user_id, actor_email, accion, entidad, entidad_id, datos, origen)
  values (p_empresa, p_actor, v_email, p_accion, p_entidad, p_entidad_id, coalesce(p_datos, '{}'::jsonb), p_origen)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.fel_siguiente_borrador(p_empresa uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare v integer;
begin
  insert into public.contadores_borrador (empresa_id, ultimo) values (p_empresa, 1)
  on conflict (empresa_id) do update set ultimo = public.contadores_borrador.ultimo + 1
  returning ultimo into v;
  return v;
end $$;

create or replace function public.fel__exigir_plataforma(p_actor uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_actor is null or not exists (select 1 from public.plataforma_admins where user_id = p_actor)
     or exists (select 1 from public.perfiles where user_id = p_actor and not activo) then
    raise exception 'FEL_NO_AUTORIZADO: solo el administrador maestro puede hacer esto';
  end if;
end $$;

-- ============================================================ protecciones (triggers)
create or replace function public.fel_bloquear_modificacion() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'FEL_APPEND_ONLY: la tabla % solo permite agregar registros', tg_table_name;
end $$;

create trigger auditoria_solo_agregar before update or delete on public.auditoria
  for each row execute function public.fel_bloquear_modificacion();
create trigger auditoria_sin_truncate before truncate on public.auditoria
  for each statement execute function public.fel_bloquear_modificacion();
create trigger doc_estados_solo_agregar before update or delete on public.documento_estados
  for each row execute function public.fel_bloquear_modificacion();
create trigger doc_estados_sin_truncate before truncate on public.documento_estados
  for each statement execute function public.fel_bloquear_modificacion();

-- Tablas con historia fiscal: nunca se vacían (ni con la clave de servicio).
create trigger documentos_sin_truncate before truncate on public.documentos
  for each statement execute function public.fel_bloquear_modificacion();
create trigger doc_lineas_sin_truncate before truncate on public.documento_lineas
  for each statement execute function public.fel_bloquear_modificacion();
create trigger operaciones_sin_truncate before truncate on public.operaciones_fiscales
  for each statement execute function public.fel_bloquear_modificacion();
create trigger operaciones_sin_borrar before delete on public.operaciones_fiscales
  for each row execute function public.fel_bloquear_modificacion();

-- Régimen fiscal: una versión verificada no se puede cambiar; para verificar hay que tener las reglas completas.
create or replace function public.fel_regimen_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.estado <> 'sin_verificar' then
      raise exception 'FEL_REGLA: un régimen verificado u obsoleto no se puede borrar';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if old.estado = 'obsoleto' then
      raise exception 'FEL_REGLA: un régimen obsoleto no se puede modificar';
    end if;
    if old.estado = 'verificado' then
      if new.estado not in ('verificado', 'obsoleto')
         or new.codigo <> old.codigo or new.version <> old.version or new.nombre <> old.nombre
         or new.reglas is distinct from old.reglas or new.fuente is distinct from old.fuente
         or new.vigente_desde is distinct from old.vigente_desde
         or new.verificado_por is distinct from old.verificado_por
         or new.verificado_en is distinct from old.verificado_en then
        raise exception 'FEL_REGLA: un régimen verificado es inmutable; crea una versión nueva';
      end if;
      if new.estado = 'obsoleto' and exists (
           select 1 from public.empresas e where e.regimen_id = old.id and e.emision_real_habilitada) then
        raise exception 'FEL_REGLA: hay empresas con emisión real que usan este régimen';
      end if;
    end if;
  end if;
  if new.estado = 'verificado' and (tg_op = 'INSERT' or old.estado <> 'verificado') then
    if new.verificado_por is null or new.verificado_en is null then
      raise exception 'FEL_REGLA: falta quién y cuándo verificó el régimen';
    end if;
    if new.fuente is null or length(btrim(new.fuente)) < 5 then
      raise exception 'FEL_REGLA: falta la referencia normativa del régimen';
    end if;
    if new.vigente_desde is null then
      raise exception 'FEL_REGLA: falta la fecha de inicio de vigencia';
    end if;
    if coalesce(new.reglas ->> 'esquema', '') <> '1'
       or jsonb_typeof(new.reglas -> 'impuestos') is distinct from 'array'
       or jsonb_typeof(new.reglas -> 'precios_incluyen_impuesto') is distinct from 'boolean'
       or jsonb_typeof(new.reglas -> 'redondeo') is distinct from 'object' then
      raise exception 'FEL_REGLA: las reglas del régimen están incompletas; no se puede verificar';
    end if;
  end if;
  return new;
end $$;

create trigger regimenes_guard before insert or update or delete on public.regimenes_fiscales
  for each row execute function public.fel_regimen_guard();

-- Empresa: la emisión real exige empresa habilitada, régimen verificado y autorización específica.
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

create trigger empresas_guard before insert or update on public.empresas
  for each row execute function public.fel_empresa_guard();

-- Miembros: siempre debe quedar al menos un propietario activo.
create or replace function public.fel_miembro_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then new.actualizado_en := now(); end if;
  if old.rol = 'propietario' and old.activo
     and (tg_op = 'DELETE' or new.rol <> 'propietario' or not new.activo) then
    if not exists (select 1 from public.miembros m
                   where m.empresa_id = old.empresa_id and m.user_id <> old.user_id and m.rol = 'propietario' and m.activo) then
      raise exception 'FEL_REGLA: la empresa debe conservar al menos un propietario activo';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger miembros_guard before update or delete on public.miembros
  for each row execute function public.fel_miembro_guard();

create or replace function public.fel_tocar_actualizado() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.actualizado_en := now();
  return new;
end $$;

-- ============================================================ documentos: matriz de estados y contenido inmutable
-- Ejes: estado_preparacion (borrador|revisado|archivado) y estado_fiscal (ninguno|pendiente_certificacion|por_verificar|
-- certificado|rechazado|anulacion_solicitada|anulado). Los cambios del eje fiscal solo los hacen las funciones fiscales
-- (marcan la sesión con fel.op_fiscal); un UPDATE directo, aunque sea con service_role, es rechazado.
create or replace function public.fel__transicion_fiscal_valida(p_de text, p_a text) returns boolean
language sql immutable set search_path = '' as $$
  select (p_de, p_a) in (
    ('ninguno','pendiente_certificacion'),
    ('pendiente_certificacion','certificado'), ('pendiente_certificacion','rechazado'), ('pendiente_certificacion','por_verificar'),
    ('por_verificar','certificado'), ('por_verificar','rechazado'),
    ('rechazado','pendiente_certificacion'), ('rechazado','ninguno'),
    ('certificado','anulacion_solicitada'),
    ('anulacion_solicitada','anulado'), ('anulacion_solicitada','certificado'))
$$;

create or replace function public.fel_documento_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_fiscal_cambia boolean; v_prep_cambia boolean; v_contenido_cambia boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'FEL_REGLA: los documentos no se borran; un borrador se archiva';
  end if;
  if tg_op = 'INSERT' then
    if new.estado_preparacion <> 'borrador' or new.estado_fiscal <> 'ninguno' then
      raise exception 'FEL_REGLA: un documento nuevo nace como borrador sin estado fiscal';
    end if;
    return new;
  end if;
  -- identidad inmutable
  if new.id <> old.id or new.empresa_id <> old.empresa_id or new.numero_borrador <> old.numero_borrador
     or new.tipo_documento <> old.tipo_documento or new.creado_en <> old.creado_en then
    raise exception 'FEL_REGLA: la identidad del documento no se puede modificar';
  end if;
  v_fiscal_cambia := new.estado_fiscal <> old.estado_fiscal;
  v_prep_cambia   := new.estado_preparacion <> old.estado_preparacion;
  v_contenido_cambia :=
       new.cliente_id is distinct from old.cliente_id or new.cliente_snapshot is distinct from old.cliente_snapshot
    or new.regimen_id is distinct from old.regimen_id or new.regimen_snapshot is distinct from old.regimen_snapshot
    or new.moneda <> old.moneda or new.fecha_emision_prevista is distinct from old.fecha_emision_prevista
    or new.subtotal is distinct from old.subtotal or new.descuento_total is distinct from old.descuento_total
    or new.base_imponible is distinct from old.base_imponible or new.impuestos is distinct from old.impuestos
    or new.total is distinct from old.total or new.calculo is distinct from old.calculo
    or new.observaciones is distinct from old.observaciones;
  -- contenido: solo editable como borrador sin vida fiscal. Un DTE certificado jamás se modifica.
  if v_contenido_cambia and not (old.estado_preparacion = 'borrador' and old.estado_fiscal = 'ninguno') then
    raise exception 'FEL_REGLA: el contenido solo se edita en un borrador sin estado fiscal; un documento certificado es inmutable';
  end if;
  -- preparación
  if v_prep_cambia then
    if old.estado_fiscal <> 'ninguno' and not (old.estado_fiscal = 'rechazado' and new.estado_fiscal = 'ninguno') then
      raise exception 'FEL_REGLA: un documento con vida fiscal no cambia su estado de preparación';
    end if;
    if (old.estado_preparacion, new.estado_preparacion) not in
       (('borrador','revisado'), ('revisado','borrador'), ('borrador','archivado'), ('revisado','archivado'), ('archivado','borrador')) then
      raise exception 'FEL_REGLA: transición de preparación no permitida (% → %)', old.estado_preparacion, new.estado_preparacion;
    end if;
  end if;
  -- fiscal
  if v_fiscal_cambia then
    if coalesce(current_setting('fel.op_fiscal', true), '') <> 'on' then
      raise exception 'FEL_REGLA: el estado fiscal solo cambia mediante las operaciones fiscales';
    end if;
    if not public.fel__transicion_fiscal_valida(old.estado_fiscal, new.estado_fiscal) then
      raise exception 'FEL_REGLA: transición fiscal no permitida (% → %)', old.estado_fiscal, new.estado_fiscal;
    end if;
  end if;
  -- datos fiscales: se fijan solo al certificar y luego no cambian jamás
  if old.estado_fiscal in ('certificado','anulacion_solicitada','anulado') and
     (new.serie is distinct from old.serie or new.numero_fiscal is distinct from old.numero_fiscal
      or new.autorizacion_sat is distinct from old.autorizacion_sat
      or new.certificacion_verificada_en is distinct from old.certificacion_verificada_en) then
    raise exception 'FEL_REGLA: serie, número y autorización de un DTE certificado son inmutables';
  end if;
  if old.estado_fiscal in ('anulado') then
    raise exception 'FEL_REGLA: un documento anulado es definitivo';
  end if;
  return new;
end $$;

create trigger documentos_guard before insert or update or delete on public.documentos
  for each row execute function public.fel_documento_guard();

-- Líneas: solo se tocan mientras el documento es un borrador sin estado fiscal.
create or replace function public.fel_documento_linea_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_doc uuid := case when tg_op = 'DELETE' then old.documento_id else new.documento_id end;
        v_prep text; v_fiscal text;
begin
  select estado_preparacion, estado_fiscal into v_prep, v_fiscal from public.documentos where id = v_doc;
  if v_prep is distinct from 'borrador' or v_fiscal is distinct from 'ninguno' then
    raise exception 'FEL_REGLA: las líneas solo se modifican en un borrador sin estado fiscal';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger doc_lineas_guard before insert or update or delete on public.documento_lineas
  for each row execute function public.fel_documento_linea_guard();

-- Operaciones fiscales: inmutables salvo su resolución; una operación confirmada no se reabre.
create or replace function public.fel_operacion_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.estado <> 'iniciada' then raise exception 'FEL_REGLA: una operación nace en estado iniciada'; end if;
    return new;
  end if;
  if new.id <> old.id or new.empresa_id <> old.empresa_id or new.documento_id <> old.documento_id or new.tipo <> old.tipo
     or new.clave_idempotencia <> old.clave_idempotencia or new.hash_contenido <> old.hash_contenido
     or new.iniciada_en <> old.iniciada_en or new.iniciada_por is distinct from old.iniciada_por then
    raise exception 'FEL_REGLA: los datos de la operación fiscal son inmutables';
  end if;
  if new.estado <> old.estado and (old.estado, new.estado) not in
     (('iniciada','confirmada_exitosa'), ('iniciada','confirmada_fallida'), ('iniciada','desconocida'),
      ('desconocida','confirmada_exitosa'), ('desconocida','confirmada_fallida')) then
    raise exception 'FEL_REGLA: transición de operación no permitida (% → %)', old.estado, new.estado;
  end if;
  if old.estado in ('confirmada_exitosa','confirmada_fallida') and new is distinct from old then
    raise exception 'FEL_REGLA: una operación confirmada no se modifica';
  end if;
  if new.resolucion = 'conciliacion_manual' and (new.evidencia is null or new.resuelta_por is null) then
    raise exception 'FEL_REGLA: la conciliación manual exige evidencia y responsable';
  end if;
  return new;
end $$;

create trigger operaciones_guard before insert or update on public.operaciones_fiscales
  for each row execute function public.fel_operacion_guard();

-- Reglas normativas versionadas (anulación, etc.): verificada = inmutable. Solo se verifica con estructura completa y plazo soportado.
create or replace function public.fel_regla_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.estado <> 'sin_verificar' then raise exception 'FEL_REGLA: una regla verificada u obsoleta no se borra'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if old.estado = 'obsoleto' then raise exception 'FEL_REGLA: una regla obsoleta no se modifica'; end if;
    if old.estado = 'verificado' and (new.estado not in ('verificado','obsoleto') or new.codigo <> old.codigo
       or new.version <> old.version or new.reglas is distinct from old.reglas or new.fuente is distinct from old.fuente
       or new.vigente_desde is distinct from old.vigente_desde or new.verificado_por is distinct from old.verificado_por
       or new.verificado_en is distinct from old.verificado_en) then
      raise exception 'FEL_REGLA: una regla verificada es inmutable; crea una versión nueva';
    end if;
  end if;
  if new.estado = 'verificado' and (tg_op = 'INSERT' or old.estado <> 'verificado') then
    if new.verificado_por is null or new.verificado_en is null or new.vigente_desde is null
       or new.fuente is null or length(btrim(new.fuente)) < 5 then
      raise exception 'FEL_REGLA: falta responsable, fecha, vigencia o referencia normativa de la regla';
    end if;
    if new.codigo = 'anulacion_dte' then
      if coalesce(new.reglas ->> 'esquema', '') <> '1'
         or jsonb_typeof(new.reglas -> 'requiere_confirmacion_receptor') is distinct from 'boolean'
         or coalesce(new.reglas ->> 'plazo_tipo', '') not in ('sin_plazo', 'dias_calendario')
         or (new.reglas ->> 'plazo_tipo' = 'dias_calendario'
             and (jsonb_typeof(new.reglas -> 'dias') is distinct from 'number' or (new.reglas ->> 'dias')::numeric < 0)) then
        raise exception 'FEL_REGLA: reglas de anulación incompletas o con un plazo aún no soportado (requiere validación manual)';
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger reglas_normativas_guard before insert or update or delete on public.reglas_normativas
  for each row execute function public.fel_regla_guard();

-- Tipos de identificación: un tipo verificado no cambia su patrón ni su código.
create or replace function public.fel_identificacion_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'FEL_REGLA: los tipos de identificación no se borran; se desactivan'; end if;
  if tg_op = 'UPDATE' and old.verificado and
     (new.patron is distinct from old.patron or new.codigo <> old.codigo or not new.verificado
      or new.fuente is distinct from old.fuente) then
    raise exception 'FEL_REGLA: un tipo de identificación verificado es inmutable';
  end if;
  if new.patron is not null then
    begin
      perform '' ~ new.patron;
    exception when others then
      raise exception 'FEL_REGLA: el patrón de identificación no es una expresión regular válida';
    end;
  end if;
  return new;
end $$;

create trigger identificaciones_guard before insert or update or delete on public.identificaciones_tipos
  for each row execute function public.fel_identificacion_guard();

-- Valida tipo y número de identificación. El patrón SOLO se aplica si el tipo fue verificado contra normativa vigente.
create or replace function public.fel_identificacion_validar(p_tipo text, p_numero text) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v public.identificaciones_tipos;
begin
  select * into v from public.identificaciones_tipos where codigo = p_tipo and activo;
  if not found then raise exception 'FEL_REGLA: tipo de identificación no permitido'; end if;
  if p_tipo = 'CF' and p_numero <> 'CF' then raise exception 'FEL_REGLA: el consumidor final se registra como CF'; end if;
  if v.verificado and v.patron is not null and p_numero !~ v.patron then
    raise exception 'FEL_REGLA: el número no cumple el formato del tipo de identificación %', p_tipo;
  end if;
end $$;

create trigger clientes_tocar before update on public.clientes for each row execute function public.fel_tocar_actualizado();
create trigger conceptos_tocar before update on public.conceptos for each row execute function public.fel_tocar_actualizado();
create trigger documentos_tocar before update on public.documentos for each row execute function public.fel_tocar_actualizado();

-- ============================================================ operaciones del administrador maestro (atómicas: dato + auditoría)
create or replace function public.fel_admin_empresa_crear(
  p_actor uuid, p_nombre_comercial text, p_razon_social text, p_nit text, p_regimen_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform public.fel__exigir_plataforma(p_actor);
  if not exists (select 1 from public.regimenes_fiscales where id = p_regimen_id and estado <> 'obsoleto') then
    raise exception 'FEL_NO_ENCONTRADO: el régimen indicado no existe o está obsoleto';
  end if;
  insert into public.empresas (nombre_comercial, razon_social, nit, regimen_id, creado_por)
  values (btrim(p_nombre_comercial), btrim(p_razon_social), upper(btrim(p_nit)), p_regimen_id, p_actor)
  returning id into v_id;
  perform public.fel_auditar(v_id, p_actor, 'empresa.crear', 'empresa', v_id::text,
    jsonb_build_object('nombre_comercial', p_nombre_comercial, 'razon_social', p_razon_social, 'nit', upper(btrim(p_nit)), 'regimen_id', p_regimen_id));
  return v_id;
end $$;

create or replace function public.fel_admin_empresa_estado(
  p_actor uuid, p_empresa uuid, p_estado text, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old public.empresas;
begin
  perform public.fel__exigir_plataforma(p_actor);
  if p_estado not in ('habilitada', 'suspendida') then raise exception 'FEL_REGLA: estado no válido'; end if;
  if p_motivo is null or length(btrim(p_motivo)) < 5 then raise exception 'FEL_REGLA: el motivo es obligatorio (mínimo 5 caracteres)'; end if;
  select * into v_old from public.empresas where id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: empresa no encontrada'; end if;
  if p_estado = 'suspendida' and v_old.emision_real_habilitada then
    update public.empresas set emision_real_habilitada = false, emision_autorizada_por = null, emision_autorizada_en = null where id = p_empresa;
    perform public.fel_auditar(p_empresa, p_actor, 'empresa.emision_deshabilitada', 'empresa', p_empresa::text,
      jsonb_build_object('motivo', 'suspensión de la empresa'));
  end if;
  update public.empresas
     set estado = p_estado,
         habilitada_por = case when p_estado = 'habilitada' then p_actor else habilitada_por end,
         habilitada_en  = case when p_estado = 'habilitada' then now() else habilitada_en end
   where id = p_empresa;
  perform public.fel_auditar(p_empresa, p_actor, 'empresa.' || p_estado, 'empresa', p_empresa::text,
    jsonb_build_object('antes', v_old.estado, 'despues', p_estado, 'motivo', p_motivo));
end $$;

-- Cambio fiscal crítico: régimen de la empresa.
create or replace function public.fel_admin_empresa_regimen(
  p_actor uuid, p_empresa uuid, p_regimen uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old uuid;
begin
  perform public.fel__exigir_plataforma(p_actor);
  if p_motivo is null or length(btrim(p_motivo)) < 5 then raise exception 'FEL_REGLA: el motivo es obligatorio (mínimo 5 caracteres)'; end if;
  if not exists (select 1 from public.regimenes_fiscales where id = p_regimen and estado <> 'obsoleto') then
    raise exception 'FEL_NO_ENCONTRADO: el régimen indicado no existe o está obsoleto';
  end if;
  select regimen_id into v_old from public.empresas where id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: empresa no encontrada'; end if;
  update public.empresas set regimen_id = p_regimen where id = p_empresa;
  perform public.fel_auditar(p_empresa, p_actor, 'empresa.regimen_asignar', 'empresa', p_empresa::text,
    jsonb_build_object('antes', v_old, 'despues', p_regimen, 'motivo', p_motivo));
end $$;

create or replace function public.fel_admin_regimen_crear_version(
  p_actor uuid, p_codigo text, p_nombre text, p_reglas jsonb, p_fuente text, p_vigente_desde date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_ver integer;
begin
  perform public.fel__exigir_plataforma(p_actor);
  select coalesce(max(version), 0) + 1 into v_ver from public.regimenes_fiscales where codigo = p_codigo;
  insert into public.regimenes_fiscales (codigo, version, nombre, reglas, fuente, vigente_desde, creado_por)
  values (p_codigo, v_ver, btrim(p_nombre), coalesce(p_reglas, '{}'::jsonb), p_fuente, p_vigente_desde, p_actor)
  returning id into v_id;
  perform public.fel_auditar(null, p_actor, 'regimen.crear_version', 'regimen', v_id::text,
    jsonb_build_object('codigo', p_codigo, 'version', v_ver, 'reglas', coalesce(p_reglas, '{}'::jsonb), 'fuente', p_fuente));
  return v_id;
end $$;

-- Cambio fiscal crítico: verificar un régimen (el trigger exige reglas completas).
create or replace function public.fel_admin_regimen_verificar(
  p_actor uuid, p_regimen uuid, p_referencia text, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old public.regimenes_fiscales;
begin
  perform public.fel__exigir_plataforma(p_actor);
  if p_motivo is null or length(btrim(p_motivo)) < 5 then raise exception 'FEL_REGLA: el motivo es obligatorio (mínimo 5 caracteres)'; end if;
  select * into v_old from public.regimenes_fiscales where id = p_regimen for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: régimen no encontrado'; end if;
  if v_old.estado <> 'sin_verificar' then raise exception 'FEL_REGLA: solo se verifica un régimen sin verificar'; end if;
  update public.regimenes_fiscales
     set estado = 'verificado', verificado_por = p_actor, verificado_en = now(), fuente = coalesce(nullif(btrim(p_referencia), ''), fuente)
   where id = p_regimen;
  perform public.fel_auditar(null, p_actor, 'regimen.verificar', 'regimen', p_regimen::text,
    jsonb_build_object('codigo', v_old.codigo, 'version', v_old.version, 'reglas', v_old.reglas, 'referencia', p_referencia, 'motivo', p_motivo));
end $$;

-- Cambio fiscal crítico: habilitar/deshabilitar emisión real (en Fase 1 la Edge Function la mantiene bloqueada).
create or replace function public.fel_admin_emision(
  p_actor uuid, p_empresa uuid, p_habilitar boolean, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old boolean;
begin
  perform public.fel__exigir_plataforma(p_actor);
  if p_motivo is null or length(btrim(p_motivo)) < 5 then raise exception 'FEL_REGLA: el motivo es obligatorio (mínimo 5 caracteres)'; end if;
  select emision_real_habilitada into v_old from public.empresas where id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: empresa no encontrada'; end if;
  update public.empresas
     set emision_real_habilitada = p_habilitar,
         emision_autorizada_por = case when p_habilitar then p_actor else null end,
         emision_autorizada_en  = case when p_habilitar then now() else null end
   where id = p_empresa;
  perform public.fel_auditar(p_empresa, p_actor, case when p_habilitar then 'empresa.emision_habilitada' else 'empresa.emision_deshabilitada' end,
    'empresa', p_empresa::text, jsonb_build_object('antes', v_old, 'despues', p_habilitar, 'motivo', p_motivo));
end $$;

create or replace function public.fel_admin_invitar_propietario(p_actor uuid, p_empresa uuid, p_email text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform public.fel__exigir_plataforma(p_actor);
  if not exists (select 1 from public.empresas where id = p_empresa) then raise exception 'FEL_NO_ENCONTRADO: empresa no encontrada'; end if;
  insert into public.invitaciones (empresa_id, email, rol, invitado_por)
  values (p_empresa, lower(btrim(p_email)), 'propietario', p_actor) returning id into v_id;
  perform public.fel_auditar(p_empresa, p_actor, 'invitacion.crear', 'invitacion', v_id::text,
    jsonb_build_object('email', lower(btrim(p_email)), 'rol', 'propietario'));
  return v_id;
end $$;

-- ============================================================ gestión de usuarios de una empresa (jerarquía validada en la base)
create or replace function public.fel__chequear_gestion(
  p_actor uuid, p_empresa uuid, p_rol_objetivo text, p_permisos text[]) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_rol text; v_perm text[];
begin
  select m.rol into v_rol from public.miembros m
    join public.empresas e on e.id = m.empresa_id and e.estado = 'habilitada'
   where m.empresa_id = p_empresa and m.user_id = p_actor and m.activo;
  v_perm := public.fel_permisos_efectivos(p_empresa, p_actor);
  if v_rol is null or not ('usuarios.gestionar' = any (v_perm)) then
    raise exception 'FEL_NO_AUTORIZADO: no puedes gestionar usuarios de esta empresa';
  end if;
  if p_rol_objetivo is not null and v_rol <> 'propietario'
     and public.fel__rango(p_rol_objetivo) >= public.fel__rango(v_rol) then
    raise exception 'FEL_NO_AUTORIZADO: no puedes asignar ese rol';
  end if;
  if p_permisos is not null then
    if exists (select 1 from unnest(p_permisos) x where not exists (select 1 from public.permisos_catalogo c where c.codigo = x)) then
      raise exception 'FEL_REGLA: hay permisos que no existen';
    end if;
    if exists (select 1 from unnest(p_permisos) x where x <> all (v_perm)) then
      raise exception 'FEL_NO_AUTORIZADO: no puedes conceder permisos que tú no tienes';
    end if;
  end if;
  return v_rol;
end $$;

create or replace function public.fel_op_invitacion_registrar(
  p_actor uuid, p_empresa uuid, p_email text, p_rol text, p_permisos_extra text[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_email text := lower(btrim(p_email));
begin
  perform public.fel__chequear_gestion(p_actor, p_empresa, p_rol, p_permisos_extra);
  insert into public.invitaciones (empresa_id, email, rol, permisos_extra, invitado_por)
  values (p_empresa, v_email, p_rol, coalesce(p_permisos_extra, '{}'), p_actor) returning id into v_id;
  perform public.fel_auditar(p_empresa, p_actor, 'invitacion.crear', 'invitacion', v_id::text,
    jsonb_build_object('email', v_email, 'rol', p_rol, 'permisos_extra', coalesce(p_permisos_extra, '{}')));
  return v_id;
end $$;

create or replace function public.fel_op_invitacion_revocar(p_actor uuid, p_empresa uuid, p_invitacion uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.invitaciones;
begin
  perform public.fel__chequear_gestion(p_actor, p_empresa, null, null);
  select * into v from public.invitaciones where id = p_invitacion and empresa_id = p_empresa and estado = 'pendiente' for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: invitación pendiente no encontrada'; end if;
  update public.invitaciones set estado = 'revocada' where id = p_invitacion;
  perform public.fel_auditar(p_empresa, p_actor, 'invitacion.revocar', 'invitacion', p_invitacion::text, jsonb_build_object('email', v.email));
end $$;

-- La persona ya inició sesión (invitación nativa de Supabase Auth): se convierten sus invitaciones vigentes en membresías.
create or replace function public.fel_op_invitacion_aceptar(p_user uuid, p_email text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v public.invitaciones; n integer := 0; v_email text := lower(btrim(p_email));
begin
  update public.invitaciones set estado = 'vencida' where email = v_email and estado = 'pendiente' and expira_en <= now();
  insert into public.perfiles (user_id) values (p_user) on conflict (user_id) do nothing;
  for v in select * from public.invitaciones where email = v_email and estado = 'pendiente' and expira_en > now() for update loop
    insert into public.miembros (empresa_id, user_id, rol, permisos_extra, invitado_por)
    values (v.empresa_id, p_user, v.rol, v.permisos_extra, v.invitado_por)
    on conflict (empresa_id, user_id) do update
      set rol = excluded.rol, permisos_extra = excluded.permisos_extra, permisos_revocados = '{}', activo = true;
    update public.invitaciones set estado = 'aceptada', aceptada_en = now(), user_id = p_user where id = v.id;
    perform public.fel_auditar(v.empresa_id, p_user, 'invitacion.aceptar', 'invitacion', v.id::text,
      jsonb_build_object('rol', v.rol, 'email', v_email));
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.fel_op_miembro_actualizar(
  p_actor uuid, p_empresa uuid, p_user uuid,
  p_rol text default null, p_permisos_extra text[] default null,
  p_permisos_revocados text[] default null, p_activo boolean default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_obj public.miembros; v_actor_rol text;
begin
  if p_user = p_actor then raise exception 'FEL_NO_AUTORIZADO: no puedes modificar tu propia membresía'; end if;
  select * into v_obj from public.miembros where empresa_id = p_empresa and user_id = p_user for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: miembro no encontrado'; end if;
  v_actor_rol := public.fel__chequear_gestion(p_actor, p_empresa, coalesce(p_rol, v_obj.rol), p_permisos_extra);
  if v_actor_rol <> 'propietario' and public.fel__rango(v_obj.rol) >= public.fel__rango(v_actor_rol) then
    raise exception 'FEL_NO_AUTORIZADO: no puedes modificar a un usuario de rol igual o superior';
  end if;
  if p_permisos_revocados is not null and exists (
       select 1 from unnest(p_permisos_revocados) x where not exists (select 1 from public.permisos_catalogo c where c.codigo = x)) then
    raise exception 'FEL_REGLA: hay permisos que no existen';
  end if;
  update public.miembros
     set rol = coalesce(p_rol, rol),
         permisos_extra = coalesce(p_permisos_extra, permisos_extra),
         permisos_revocados = coalesce(p_permisos_revocados, permisos_revocados),
         activo = coalesce(p_activo, activo)
   where empresa_id = p_empresa and user_id = p_user;
  perform public.fel_auditar(p_empresa, p_actor, 'miembro.actualizar', 'miembro', p_user::text,
    jsonb_build_object(
      'antes', jsonb_build_object('rol', v_obj.rol, 'permisos_extra', v_obj.permisos_extra, 'permisos_revocados', v_obj.permisos_revocados, 'activo', v_obj.activo),
      'despues', jsonb_build_object('rol', coalesce(p_rol, v_obj.rol), 'permisos_extra', coalesce(p_permisos_extra, v_obj.permisos_extra),
                                    'permisos_revocados', coalesce(p_permisos_revocados, v_obj.permisos_revocados), 'activo', coalesce(p_activo, v_obj.activo))));
end $$;
