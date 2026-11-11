-- NEXA FEL · Fase 4 (6/9) · autorización humana de la confirmación, separada de la identidad del agente (fel/docs/agente-confirmacion-humana.md).
-- · el agente informa la VISTA PREVIA que realmente muestra el simulador (resumen + hash);
-- · una PERSONA con permiso autoriza (una autorización vigente por orden) tras contrastarla con la instantánea congelada;
-- · la concesión firmada por NEXA se emite fuera de la base (el agente nunca la ve); aquí solo queda el registro verificable.
alter table public.ordenes_emision
  add column vista_previa jsonb,
  add column vista_previa_hash text check (vista_previa_hash is null or vista_previa_hash ~ '^[0-9a-f]{64}$'),
  add constraint ordenes_vista_previa_par check ((vista_previa is null) = (vista_previa_hash is null));
-- la columna nueva también queda fuera de lo que la app puede leer directamente (la lista de columnas de la migración 3 no la incluye)

create table public.ordenes_confirmaciones (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null,
  orden_id    uuid not null references public.ordenes_emision (id),            -- una autorización VIGENTE por orden (tras caducar, la persona puede volver a autorizar)
  usuario_id  uuid not null references auth.users (id),
  resumen_hash text not null check (resumen_hash ~ '^[0-9a-f]{64}$'),
  jti         text not null unique check (length(jti) between 16 and 64),
  expira_en   timestamptz not null,
  creada_en   timestamptz not null default clock_timestamp()
);
create index ordenes_confirmaciones_orden on public.ordenes_confirmaciones (orden_id, expira_en);
create trigger ordenes_confirmaciones_solo_insertar before update or delete on public.ordenes_confirmaciones for each row execute function public.fel_solo_insertar();
alter table public.ordenes_confirmaciones enable row level security;
revoke all on public.ordenes_confirmaciones from public, anon, authenticated;
revoke delete, truncate on public.ordenes_confirmaciones from service_role;

-- El agente informa la vista previa que VE (el hash lo calculó el simulador). Solo con la orden presentada, el token vigente y el arrendamiento vigente.
create or replace function public.fel_sys_orden_vista_previa(p_agente uuid, p_orden uuid, p_token bigint, p_resumen jsonb, p_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.ordenes_emision;
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or p_resumen is null or jsonb_typeof(p_resumen) <> 'object' or length(p_resumen::text) > 20000 then
    raise exception 'FEL_DATOS_INVALIDOS: vista previa no válida';
  end if;
  r := public.fel__orden_validar(p_agente, p_orden, p_token);
  if r.estado <> 'llenada' then raise exception 'FEL_ESTADO: la vista previa solo se informa con la orden presentada'; end if;
  if r.vista_previa_hash is not null and r.vista_previa_hash <> p_hash and exists (select 1 from public.ordenes_confirmaciones where orden_id = p_orden and expira_en > clock_timestamp()) then
    raise exception 'FEL_CONFLICTO: la vista previa ya fue autorizada por una persona y no puede cambiar';
  end if;
  update public.ordenes_emision set vista_previa = p_resumen, vista_previa_hash = p_hash where id = p_orden;
  perform public.fel_auditar(r.empresa_id, null, 'orden.vista_previa', 'orden', p_orden::text, jsonb_build_object('agente', p_agente, 'hash', p_hash), 'agente');
  return jsonb_build_object('estado', 'llenada', 'hash', p_hash);
end $$;

-- Nota: revocar un agente expira de inmediato sus órdenes (presentada ⇒ incierta), por eso la comprobación de agente activo es una segunda barrera.
-- La PERSONA autoriza la confirmación. Exige permiso, orden presentada y vigente, agente activo, vista previa informada y coincidente con la instantánea.
create or replace function public.fel_op_orden_confirmacion_autorizar(p_actor uuid, p_empresa uuid, p_orden uuid, p_ttl_seg integer default 300) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.ordenes_emision; o public.operaciones_fiscales; a public.agentes_locales; v_total numeric; v_esperado numeric; v_n integer; v_jti text; v_exp timestamptz; v_dif text[] := '{}';
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'fiscal.certificar');
  if p_ttl_seg is null or p_ttl_seg < 30 or p_ttl_seg > 900 then raise exception 'FEL_DATOS_INVALIDOS: vigencia no válida'; end if;
  select * into r from public.ordenes_emision where id = p_orden and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: orden no encontrada'; end if;               -- otra empresa ⇒ como si no existiera
  if r.estado <> 'llenada' then raise exception 'FEL_ESTADO: solo una orden presentada puede autorizarse (estado: %)', r.estado; end if;
  if r.lease_hasta is null or r.lease_hasta < clock_timestamp() then raise exception 'FEL_ESTADO: la orden venció'; end if;
  select * into a from public.agentes_locales where id = r.agente_id;
  if not found or a.estado <> 'activo' then raise exception 'FEL_REVOCADO: el agente de esta orden ya no está activo'; end if;
  select * into o from public.operaciones_fiscales where id = r.operacion_id and empresa_id = p_empresa;
  if o.estado <> 'iniciada' then raise exception 'FEL_ESTADO: la operación ya no está abierta'; end if;
  if r.vista_previa_hash is null then raise exception 'FEL_ESTADO: el agente aún no informó la vista previa'; end if;
  if exists (select 1 from public.ordenes_confirmaciones where orden_id = p_orden and expira_en > clock_timestamp()) then raise exception 'FEL_CONFLICTO: esta orden ya tiene una autorización vigente'; end if;
  -- contraste con la instantánea CONGELADA de la orden (lo que NEXA pidió) frente a lo que el agente dice que muestra el portal
  v_total := nullif(r.vista_previa ->> 'total', '')::numeric; v_esperado := nullif(r.instantanea ->> 'base_imponible', '')::numeric; v_n := jsonb_array_length(coalesce(r.vista_previa -> 'lineas', '[]'::jsonb));
  if (r.vista_previa -> 'receptor' ->> 'id') is distinct from (r.instantanea -> 'cliente' ->> 'numero_identificacion') then v_dif := array_append(v_dif, 'receptor'); end if;
  if (r.vista_previa ->> 'establecimiento') is distinct from (r.instantanea -> 'establecimiento' ->> 'codigo_sat') then v_dif := array_append(v_dif, 'establecimiento'); end if;
  if v_n <> jsonb_array_length(coalesce(r.instantanea -> 'lineas', '[]'::jsonb)) then v_dif := array_append(v_dif, 'conceptos'); end if;
  if v_total is null or v_esperado is null or abs(v_total - v_esperado) > 0.01 * greatest(v_n, 1) then v_dif := array_append(v_dif, 'total'); end if;
  if array_length(v_dif, 1) is not null then raise exception 'FEL_REGLA: la vista previa no coincide con el documento (%)', array_to_string(v_dif, ', '); end if;
  v_jti := replace(gen_random_uuid()::text, '-', ''); v_exp := clock_timestamp() + make_interval(secs => p_ttl_seg);
  insert into public.ordenes_confirmaciones (empresa_id, orden_id, usuario_id, resumen_hash, jti, expira_en) values (p_empresa, p_orden, p_actor, r.vista_previa_hash, v_jti, v_exp);
  perform public.fel_auditar(p_empresa, p_actor, 'orden.confirmacion_autorizada', 'orden', p_orden::text, jsonb_build_object('hash', r.vista_previa_hash, 'agente', r.agente_id, 'expira_en', v_exp), 'persona');
  return jsonb_build_object('orden', p_orden, 'empresa', p_empresa, 'resumen_hash', r.vista_previa_hash, 'usuario', p_actor, 'jti', v_jti, 'expira_en', v_exp);
end $$;

-- Lectura para la persona: la vista previa informada y las diferencias con el documento (para mostrarla antes de autorizar)
create or replace function public.fel_op_orden_vista_previa(p_actor uuid, p_empresa uuid, p_orden uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.ordenes_emision;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'fiscal.ver');
  select * into r from public.ordenes_emision where id = p_orden and empresa_id = p_empresa;
  if not found then raise exception 'FEL_NO_ENCONTRADO: orden no encontrada'; end if;
  return jsonb_build_object('orden', r.id, 'estado', r.estado, 'vista_previa', r.vista_previa, 'hash', r.vista_previa_hash,
    'esperado', jsonb_build_object('receptor', r.instantanea -> 'cliente' ->> 'numero_identificacion', 'establecimiento', r.instantanea -> 'establecimiento' ->> 'codigo_sat', 'total', r.instantanea ->> 'base_imponible'),
    'autorizada', exists (select 1 from public.ordenes_confirmaciones where orden_id = r.id and expira_en > clock_timestamp()));
end $$;

revoke all on function public.fel_sys_orden_vista_previa(uuid, uuid, bigint, jsonb, text), public.fel_op_orden_confirmacion_autorizar(uuid, uuid, uuid, integer), public.fel_op_orden_vista_previa(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fel_sys_orden_vista_previa(uuid, uuid, bigint, jsonb, text), public.fel_op_orden_confirmacion_autorizar(uuid, uuid, uuid, integer), public.fel_op_orden_vista_previa(uuid, uuid, uuid) to service_role;
