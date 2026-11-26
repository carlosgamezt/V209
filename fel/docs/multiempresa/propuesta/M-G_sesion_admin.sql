-- M-G · Funciones de administración con IDENTIDAD DERIVADA DE UNA SESIÓN VALIDADA (PROPUESTA; fuera de supabase/migrations; NO se aplica sin autorización). Requiere M-D, M-A, M-B, M-C y M-F.
-- Problema que resuelve: las funciones `fel_op_*` reciben `p_actor` y `p_empresa` como PARÁMETROS; quien pudiera ejecutar SQL con el rol de la aplicación podría suplantar a cualquier persona o empresa.
-- Aquí el rol de la aplicación (nexa_app) NO ejecuta las funciones internas: solo estas funciones `fel_adm_*`, que reciben el token de la sesión (el mismo valor secreto de la cookie), lo validan en la base (hash SHA-256 en
-- demo_sesiones, vigencia, cuenta activa) y de ahí sacan la persona y la empresa. Sin un token válido no hay identidad; con uno válido no se puede actuar sobre otra empresa (la empresa sale de la sesión, no de un parámetro).
create table public.sesion_establecimiento_activo (
  token_hash         text primary key references public.demo_sesiones (token_hash) on delete cascade,
  establecimiento_id uuid not null references public.establecimientos (id),
  cambiado_en        timestamptz not null default now()
);
alter table public.sesion_establecimiento_activo enable row level security;
revoke all on public.sesion_establecimiento_activo from public, anon, authenticated;

create or replace function public.fel__sesion(p_token text) returns table (user_id uuid, empresa_id uuid, usuario text, mfa boolean, token_hash text)
language plpgsql stable security definer set search_path = '' as $$
declare v_hash text;
begin
  if p_token is null or length(p_token) < 16 or length(p_token) > 256 then return; end if;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  return query select c.user_id, c.empresa_id, c.usuario, (c.mfa_semilla_cifrada is not null), s.token_hash
    from public.demo_sesiones s join public.demo_credenciales c on c.usuario = s.usuario
   where s.token_hash = v_hash and s.ultima_en > now() - interval '12 hours' and s.creada_en > now() - interval '30 days'
     and exists (select 1 from public.perfiles pf where pf.user_id = c.user_id and pf.activo);
end $$;

create or replace function public.fel__sesion_empresa(p_token text, out o_user uuid, out o_empresa uuid, out o_mfa boolean, out o_hash text) language plpgsql stable security definer set search_path = '' as $$
begin
  select s.user_id, s.empresa_id, s.mfa, s.token_hash into o_user, o_empresa, o_mfa, o_hash from public.fel__sesion(p_token) s;
  if o_user is null then raise exception 'FEL_NO_AUTORIZADO: sesión no válida'; end if;
  if o_empresa is null then raise exception 'FEL_NO_AUTORIZADO: esta operación es de una empresa; la sesión es de la plataforma'; end if;
end $$;
create or replace function public.fel__sesion_maestro(p_token text, out o_user uuid) language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid;
begin
  select s.user_id, s.empresa_id into o_user, v_emp from public.fel__sesion(p_token) s;
  if o_user is null then raise exception 'FEL_NO_AUTORIZADO: sesión no válida'; end if;
  if v_emp is not null or not public.fel_es_plataforma(o_user) then raise exception 'FEL_NO_AUTORIZADO: solo el administrador de la plataforma'; end if;
end $$;

-- Contexto validado: persona, empresa, permisos, alcance y establecimiento ACTIVO (el único para un facturador; el elegido explícitamente por un supervisor, o su predeterminado).
create or replace function public.fel_adm_contexto(p_sesion text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid; e uuid; h text; al jsonb; v_act uuid;
begin
  select o_user, o_empresa, o_hash into u, e, h from public.fel__sesion_empresa(p_sesion);
  al := public.fel_alcance(e, u);
  select establecimiento_id into v_act from public.sesion_establecimiento_activo where token_hash = h;
  if v_act is null or not (public.fel_en_alcance(e, u, v_act)) then v_act := nullif(al -> 'ids' ->> 0, '')::uuid; end if;
  return jsonb_build_object('user_id', u, 'empresa_id', e, 'permisos', to_jsonb(public.fel_permisos_efectivos(e, u)), 'alcance', al, 'establecimiento_activo', v_act, 'por_usuario', public.fel__establecimiento_por_usuario());
end $$;

-- Cambio EXPLÍCITO de establecimiento: solo con el permiso de supervisión y dentro de lo asignado; queda auditado. Un facturador común recibe un rechazo.
create or replace function public.fel_adm_establecimiento_activo(p_sesion text, p_establecimiento uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid; e uuid; h text; al jsonb;
begin
  select o_user, o_empresa, o_hash into u, e, h from public.fel__sesion_empresa(p_sesion);
  al := public.fel_alcance(e, u);
  if not ((al ->> 'multiples')::boolean or (al ->> 'todos')::boolean) then raise exception 'FEL_NO_AUTORIZADO: tu usuario no puede cambiar de establecimiento'; end if;
  if not public.fel_en_alcance(e, u, p_establecimiento) or not exists (select 1 from public.establecimientos where id = p_establecimiento and empresa_id = e and estado = 'activo') then raise exception 'FEL_REGLA: establecimiento fuera de tu alcance'; end if;
  insert into public.sesion_establecimiento_activo (token_hash, establecimiento_id) values (h, p_establecimiento) on conflict (token_hash) do update set establecimiento_id = excluded.establecimiento_id, cambiado_en = now();
  perform public.fel_auditar(e, u, 'sesion.establecimiento_activo', 'establecimiento', p_establecimiento::text, '{}'::jsonb);
end $$;

create or replace function public.fel_adm_asignar(p_sesion text, p_usuario uuid, p_establecimiento uuid, p_predeterminado boolean, p_motivo text) returns public.usuario_establecimientos
language plpgsql security definer set search_path = '' as $$
declare u uuid; e uuid;
begin select o_user, o_empresa into u, e from public.fel__sesion_empresa(p_sesion); return public.fel_op_asignacion_guardar(u, e, p_usuario, p_establecimiento, p_predeterminado, p_motivo); end $$;
create or replace function public.fel_adm_asignacion_revocar(p_sesion text, p_usuario uuid, p_establecimiento uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid; e uuid;
begin select o_user, o_empresa into u, e from public.fel__sesion_empresa(p_sesion); perform public.fel_op_asignacion_revocar(u, e, p_usuario, p_establecimiento, p_motivo); end $$;
create or replace function public.fel_adm_borrador_trasladar(p_sesion text, p_doc uuid, p_destino uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid; e uuid;
begin select o_user, o_empresa into u, e from public.fel__sesion_empresa(p_sesion); perform public.fel_op_borrador_trasladar(u, e, p_doc, p_destino, p_motivo); end $$;

create or replace function public.fel_adm_emisor_guardar(p_sesion text, p_establecimiento uuid, p_nit text, p_nombre_fiscal text, p_nombre_comercial text, p_afiliacion_iva text, p_frases jsonb, p_correo text,
  p_direccion text, p_codigo_postal text, p_municipio text, p_departamento text, p_huella text) returns public.empresa_emisor_versiones
language plpgsql security definer set search_path = '' as $$
declare u uuid; e uuid;
begin select o_user, o_empresa into u, e from public.fel__sesion_empresa(p_sesion);
  return public.fel_op_emisor_guardar(u, e, p_establecimiento, p_nit, p_nombre_fiscal, p_nombre_comercial, p_afiliacion_iva, p_frases, p_correo, p_direccion, p_codigo_postal, p_municipio, p_departamento, p_huella); end $$;
create or replace function public.fel_adm_emisor_aprobar(p_sesion text, p_establecimiento uuid, p_version integer, p_huella text) returns public.empresa_emisor_versiones
language plpgsql security definer set search_path = '' as $$
declare u uuid; e uuid;
begin select o_user, o_empresa into u, e from public.fel__sesion_empresa(p_sesion); return public.fel_op_emisor_aprobar(u, e, p_establecimiento, p_version, p_huella); end $$;

-- Credenciales: exigen una cuenta con MFA configurado (la sesión de una cuenta con MFA solo existe tras verificar el código).
create or replace function public.fel_adm_digifact_conectar(p_sesion text, p_nit text, p_credencial bytea, p_llave_version smallint, p_version integer) returns public.empresa_digifact_config
language plpgsql security definer set search_path = '' as $$
declare u uuid; e uuid; m boolean;
begin select o_user, o_empresa, o_mfa into u, e, m from public.fel__sesion_empresa(p_sesion);
  if not m then raise exception 'FEL_NO_AUTORIZADO: guardar credenciales de Digifact exige una cuenta con MFA'; end if;
  return public.fel_op_digifact_conectar(u, e, p_nit, p_credencial, p_llave_version, p_version); end $$;
create or replace function public.fel_adm_digifact_registrar_prueba(p_sesion text, p_ok boolean) returns public.empresa_digifact_config
language plpgsql security definer set search_path = '' as $$
declare u uuid; e uuid;
begin select o_user, o_empresa into u, e from public.fel__sesion_empresa(p_sesion); return public.fel_op_digifact_registrar_prueba(u, e, p_ok); end $$;
create or replace function public.fel_adm_digifact_interruptores(p_sesion text, p_nit boolean, p_cui boolean, p_certificar boolean, p_correo boolean, p_version integer) returns public.empresa_digifact_config
language plpgsql security definer set search_path = '' as $$
declare u uuid; e uuid; m boolean;
begin select o_user, o_empresa, o_mfa into u, e, m from public.fel__sesion_empresa(p_sesion);
  if not m then raise exception 'FEL_NO_AUTORIZADO: activar servicios de Digifact exige una cuenta con MFA'; end if;
  return public.fel_op_digifact_interruptores(u, e, p_nit, p_cui, p_certificar, p_correo, p_version); end $$;
create or replace function public.fel_adm_digifact_suspender(p_sesion text) returns public.empresa_digifact_config
language plpgsql security definer set search_path = '' as $$
declare u uuid; e uuid;
begin select o_user, o_empresa into u, e from public.fel__sesion_empresa(p_sesion); return public.fel_op_digifact_suspender(u, e); end $$;

-- Estado SIN secretos: conexión, interruptores, emisores por establecimiento y (con permiso) asignaciones.
create or replace function public.fel_adm_estado(p_sesion text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid; e uuid; perms text[];
begin
  select o_user, o_empresa into u, e from public.fel__sesion_empresa(p_sesion); perms := public.fel_permisos_efectivos(e, u);
  if not ('fiscal.ver' = any (perms)) then raise exception 'FEL_NO_AUTORIZADO: no tienes permiso para ver la configuración fiscal'; end if;
  return jsonb_build_object(
    'digifact', (select jsonb_build_object('estado', c.estado, 'ambiente', c.ambiente, 'tiene_credencial', c.credencial_cifrada is not null, 'nit_parcial', '...' || right(c.digifact_nit, 4), 'consulta_nit', c.consulta_nit, 'consulta_cui', c.consulta_cui,
                 'certificar', c.certificar, 'correo_digifact', c.correo_digifact, 'ultima_prueba_en', c.ultima_prueba_en, 'ultima_prueba_ok', c.ultima_prueba_ok, 'version', c.version) from public.empresa_digifact_config c where c.empresa_id = e),
    'emisores', coalesce((select jsonb_agg(jsonb_build_object('establecimiento_id', v.establecimiento_id, 'codigo', v.codigo_establecimiento, 'version', v.version, 'estado', v.estado, 'huella', v.huella) order by v.codigo_establecimiento, v.version)
                from public.empresa_emisor_versiones v where v.empresa_id = e and v.estado in ('borrador', 'aprobada')), '[]'::jsonb),
    'asignaciones', case when 'establecimientos.asignar' = any (perms) then coalesce((select jsonb_agg(jsonb_build_object('user_id', ue.user_id, 'establecimiento_id', ue.establecimiento_id, 'predeterminado', ue.predeterminado)) from public.usuario_establecimientos ue where ue.empresa_id = e and ue.revocado_en is null), '[]'::jsonb) else null end);
end $$;

-- Maestro: mismas funciones de la plataforma con la identidad de SU sesión (nunca un parámetro).
create or replace function public.fel_adm_empresas_resumen(p_sesion text)
returns table (empresa_id uuid, nombre_comercial text, estado text, usuarios_activos bigint, documentos_30d bigint, certificados_30d bigint, digifact_estado text)
language plpgsql security definer set search_path = '' as $$
declare m uuid;
begin m := (select o_user from public.fel__sesion_maestro(p_sesion)); return query select * from public.fel_admin_empresas_resumen(m); end $$;
create or replace function public.fel_adm_acceso_solicitar(p_sesion text, p_empresa uuid, p_alcance text, p_motivo text, p_aprobador uuid, p_horas integer) returns public.acceso_maestro_datos
language plpgsql security definer set search_path = '' as $$
declare m uuid;
begin m := (select o_user from public.fel__sesion_maestro(p_sesion)); return public.fel_admin_acceso_solicitar(m, p_empresa, p_alcance, p_motivo, p_aprobador, p_horas); end $$;
create or replace function public.fel_adm_acceso_revocar(p_sesion text, p_acceso uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare m uuid;
begin m := (select o_user from public.fel__sesion_maestro(p_sesion)); perform public.fel_admin_acceso_revocar(m, p_acceso); end $$;
create or replace function public.fel_adm_datos_excepcionales_documentos(p_sesion text, p_empresa uuid, p_limite integer default 50)
returns table (id uuid, estado_preparacion text, estado_fiscal text, creado_en timestamptz)
language plpgsql security definer set search_path = '' as $$
declare m uuid;
begin m := (select o_user from public.fel__sesion_maestro(p_sesion)); return query select * from public.fel_admin_datos_excepcionales_documentos(m, p_empresa, p_limite); end $$;
create or replace function public.fel_adm_datos_excepcionales_configuracion(p_sesion text, p_empresa uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m uuid;
begin m := (select o_user from public.fel__sesion_maestro(p_sesion)); return public.fel_admin_datos_excepcionales_configuracion(m, p_empresa); end $$;

revoke all on function public.fel__sesion(text), public.fel__sesion_empresa(text), public.fel__sesion_maestro(text), public.fel_adm_contexto(text), public.fel_adm_establecimiento_activo(text, uuid),
  public.fel_adm_asignar(text, uuid, uuid, boolean, text), public.fel_adm_asignacion_revocar(text, uuid, uuid, text), public.fel_adm_borrador_trasladar(text, uuid, uuid, text),
  public.fel_adm_emisor_guardar(text, uuid, text, text, text, text, jsonb, text, text, text, text, text, text), public.fel_adm_emisor_aprobar(text, uuid, integer, text),
  public.fel_adm_digifact_conectar(text, text, bytea, smallint, integer), public.fel_adm_digifact_registrar_prueba(text, boolean), public.fel_adm_digifact_interruptores(text, boolean, boolean, boolean, boolean, integer),
  public.fel_adm_digifact_suspender(text), public.fel_adm_estado(text), public.fel_adm_empresas_resumen(text), public.fel_adm_acceso_solicitar(text, uuid, text, text, uuid, integer),
  public.fel_adm_acceso_revocar(text, uuid), public.fel_adm_datos_excepcionales_documentos(text, uuid, integer), public.fel_adm_datos_excepcionales_configuracion(text, uuid) from public, anon, authenticated;
-- las tres primeras son internas (solo las llaman las demás): ni siquiera nexa_app las ejecuta
grant execute on function public.fel_adm_contexto(text), public.fel_adm_establecimiento_activo(text, uuid),
  public.fel_adm_asignar(text, uuid, uuid, boolean, text), public.fel_adm_asignacion_revocar(text, uuid, uuid, text), public.fel_adm_borrador_trasladar(text, uuid, uuid, text),
  public.fel_adm_emisor_guardar(text, uuid, text, text, text, text, jsonb, text, text, text, text, text, text), public.fel_adm_emisor_aprobar(text, uuid, integer, text),
  public.fel_adm_digifact_conectar(text, text, bytea, smallint, integer), public.fel_adm_digifact_registrar_prueba(text, boolean), public.fel_adm_digifact_interruptores(text, boolean, boolean, boolean, boolean, integer),
  public.fel_adm_digifact_suspender(text), public.fel_adm_estado(text), public.fel_adm_empresas_resumen(text), public.fel_adm_acceso_solicitar(text, uuid, text, text, uuid, integer),
  public.fel_adm_acceso_revocar(text, uuid), public.fel_adm_datos_excepcionales_documentos(text, uuid, integer), public.fel_adm_datos_excepcionales_configuracion(text, uuid) to service_role;
