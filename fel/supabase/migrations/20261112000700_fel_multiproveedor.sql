-- D3-3 · Arquitectura multiproveedor: un segundo certificador SIMULADO («certificador_b») demuestra que se incorporan certificadores sin tocar el orquestador ni las pantallas.
-- Solo ampliaciones deliberadas (declaradas): el catálogo de proveedores admite el id nuevo (siempre solo «simulado»), el bolsón simulado y la anulación simulada
-- valen para los certificadores simulados. Pruebas y producción siguen cerradas para todos; un certificador real nuevo exigirá su propia migración y autorización.

alter table public.proveedores_emision drop constraint proveedores_emision_id_check;
alter table public.proveedores_emision add constraint proveedores_emision_id_check check (id in ('mock','portal_playwright','digifact','certificador_b'));
insert into public.proveedores_emision (id, nombre, ambientes, habilitado, nota) values
  ('certificador_b', 'Certificador B (simulado)', '{simulado}', true, 'Segundo certificador SIMULADO para demostrar la arquitectura multiproveedor. No es un certificador autorizado y no existe integración real.');
alter table public.proveedores_emision add constraint proveedores_certificador_b_solo_simulado_chk check (id <> 'certificador_b' or ambientes = '{simulado}');

alter table public.bolson_cuentas drop constraint bolson_cuentas_simulado_solo_digifact_chk;
alter table public.bolson_cuentas add constraint bolson_cuentas_simulado_solo_simuladores_chk check (ambiente <> 'simulado' or proveedor_id in ('digifact','certificador_b'));

create or replace function public.fel_admin_bolson_cuenta_crear(
  p_actor uuid, p_proveedor text, p_ambiente text, p_referencia text, p_unidad text default 'documento') returns public.bolson_cuentas
language plpgsql security definer set search_path = '' as $$
declare v_prov public.proveedores_emision; v_c public.bolson_cuentas;
begin
  perform public.fel__exigir_plataforma(p_actor);
  select * into v_prov from public.proveedores_emision where id = p_proveedor;
  if not found then raise exception 'FEL_REGLA: proveedor desconocido'; end if;
  if p_ambiente = 'produccion' and not (v_prov.habilitado and 'produccion' = any (v_prov.ambientes) and public.fel__emision_real_disponible()) then
    raise exception 'FEL_REGLA: no se pueden crear cuentas de producción mientras el proveedor % no esté habilitado por autorización escrita', p_proveedor;
  end if;
  if p_ambiente = 'simulado' and p_proveedor not in ('digifact','certificador_b') then raise exception 'FEL_REGLA: solo los certificadores simulados tienen un bolsón simulado'; end if;
  insert into public.bolson_cuentas (proveedor_id, ambiente, referencia_externa, unidad, creada_por)
  values (p_proveedor, p_ambiente, btrim(p_referencia), coalesce(p_unidad, 'documento'), p_actor)
  on conflict (proveedor_id, ambiente, referencia_externa) do nothing
  returning * into v_c;
  if not found then   -- repetición idempotente: devuelve la existente sin tocar nada
    select * into v_c from public.bolson_cuentas where proveedor_id = p_proveedor and ambiente = p_ambiente and referencia_externa = btrim(p_referencia);
    return v_c;
  end if;
  insert into public.bolson_saldos (cuenta_id) values (v_c.id);
  perform public.fel__bolson_sembrar_reglas(p_actor, v_c.id);
  perform public.fel_auditar(null, p_actor, 'bolson.cuenta_creada', 'bolson_cuenta', v_c.id::text,
    jsonb_build_object('proveedor', p_proveedor, 'ambiente', p_ambiente, 'unidad', v_c.unidad));
  return v_c;
end $$;

create or replace function public.fel_op_anulacion_simulada_iniciar(
  p_actor uuid, p_empresa uuid, p_doc uuid, p_clave text, p_hash text, p_motivo text, p_canal uuid) returns public.operaciones_fiscales
language plpgsql security definer set search_path = '' as $$
declare v public.documentos; o public.operaciones_fiscales; c public.empresa_canales; pr public.proveedores_emision;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'fiscal.anular');
  if p_motivo is null or length(btrim(p_motivo)) < 5 then raise exception 'FEL_REGLA: el motivo es obligatorio (mínimo 5 caracteres)'; end if;
  select * into c from public.empresa_canales where id = p_canal and empresa_id = p_empresa;
  if not found or not c.habilitado or c.ambiente <> 'simulado' or c.proveedor_id not in ('digifact','certificador_b') then raise exception 'FEL_REGLA: la anulación simulada exige un canal simulado habilitado de un certificador'; end if;
  select * into pr from public.proveedores_emision where id = c.proveedor_id;
  if not pr.habilitado then raise exception 'FEL_REGLA: el proveedor no está habilitado'; end if;
  if not exists (select 1 from public.empresas where id = p_empresa and estado = 'habilitada') then raise exception 'FEL_REGLA: la empresa no está habilitada'; end if;
  select * into v from public.documentos where id = p_doc and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: documento no encontrado'; end if;
  select * into o from public.operaciones_fiscales where documento_id = p_doc and clave_idempotencia = p_clave;
  if found then
    if o.hash_contenido <> p_hash or o.tipo <> 'anulacion' then raise exception 'FEL_CONFLICTO: la clave de idempotencia ya se usó con otro contenido'; end if;
    return o;
  end if;
  if exists (select 1 from public.operaciones_fiscales where documento_id = p_doc and estado in ('iniciada','desconocida')) then
    raise exception 'FEL_OPERACION_ABIERTA: hay una operación sin confirmar; concílala antes de reintentar';
  end if;
  if v.estado_fiscal <> 'certificado' then raise exception 'FEL_REGLA: solo se anula un DTE certificado'; end if;
  if not exists (select 1 from public.operaciones_fiscales where documento_id = p_doc and tipo = 'certificacion' and estado = 'confirmada_exitosa' and ambiente = 'simulado') then
    raise exception 'FEL_REGLA: la anulación simulada solo aplica a documentos certificados en simulación';
  end if;
  insert into public.operaciones_fiscales (empresa_id, documento_id, tipo, clave_idempotencia, hash_contenido, proveedor, canal_id, ambiente, motivo, iniciada_por)
  values (p_empresa, p_doc, 'anulacion', p_clave, p_hash, c.proveedor_id, c.id, 'simulado', btrim(p_motivo), p_actor) returning * into o;
  perform public.fel__fiscal_cambiar(p_doc, p_empresa, 'anulacion_solicitada', p_actor, o.id, btrim(p_motivo));
  perform public.fel_auditar(p_empresa, p_actor, 'fiscal.anulacion_simulada_iniciada', 'documento', p_doc::text, jsonb_build_object('operacion', o.id, 'motivo', btrim(p_motivo), 'simulada', true));
  return o;
end $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('fel_admin_bolson_cuenta_crear','fel_op_anulacion_simulada_iniciar') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
