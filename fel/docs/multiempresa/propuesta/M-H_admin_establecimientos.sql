-- M-H · Administración de establecimientos y de su asignación a usuarios, con IDENTIDAD DERIVADA DE LA SESIÓN VALIDADA (PROPUESTA; fuera de supabase/migrations; NO se aplica sin autorización). Requiere M-F y M-G.
-- Igual que M-G: el rol de la aplicación ejecuta SOLO estas funciones `fel_adm_*` (reciben el token de la sesión, no personas ni empresas); la persona y la empresa salen de la sesión validada en la base.
-- · fel_adm_asignaciones_listar : establecimientos, personas con su(s) establecimiento(s), permiso de supervisión e historial de cambios (auditoría de la empresa). Exige «establecimientos.asignar».
-- · fel_adm_establecimiento_nombre : cambia SOLO el nombre interno (el código SAT/Digifact, la dirección y el estado no se tocan). Exige «establecimientos.gestionar».
-- · fel_adm_supervisor : concede o retira el permiso EXTRA «establecimientos.multiples» (nunca automático; no a un lector; no a uno mismo). Exige «usuarios.gestionar». Al retirarlo, la persona queda con UN solo establecimiento (el predeterminado).
create or replace function public.fel_adm_asignaciones_listar(p_sesion text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid; e uuid; v_est jsonb; v_mie jsonb; v_his jsonb;
begin
  select o_user, o_empresa into u, e from public.fel__sesion_empresa(p_sesion);
  perform public.fel__exigir_permiso(u, e, 'establecimientos.asignar');
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'codigo_sat', x.codigo_sat, 'nombre', x.nombre, 'direccion', x.direccion, 'estado', x.estado,
           'personas', (select count(*) from public.usuario_establecimientos a where a.establecimiento_id = x.id and a.empresa_id = e and a.revocado_en is null)) order by x.codigo_sat), '[]'::jsonb)
    into v_est from public.establecimientos x where x.empresa_id = e;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'nombre', pf.nombre, 'usuario', dc.usuario, 'email', au.email, 'rol', m.rol, 'activo', m.activo,
           'supervisor', 'establecimientos.multiples' = any (m.permisos_extra),
           'revocadas', (select count(*) from public.usuario_establecimientos a where a.user_id = m.user_id and a.empresa_id = e and a.revocado_en is not null),
           'asignaciones', coalesce((select jsonb_agg(jsonb_build_object('establecimiento_id', a.establecimiento_id, 'predeterminado', a.predeterminado) order by a.predeterminado desc, a.creado_en)
                                      from public.usuario_establecimientos a where a.user_id = m.user_id and a.empresa_id = e and a.revocado_en is null), '[]'::jsonb)) order by pf.nombre), '[]'::jsonb)
    into v_mie from public.miembros m join public.perfiles pf on pf.user_id = m.user_id join auth.users au on au.id = m.user_id left join public.demo_credenciales dc on dc.user_id = m.user_id where m.empresa_id = e;
  select coalesce(jsonb_agg(h order by h.ocurrido_en desc), '[]'::jsonb) into v_his from (
    select a.ocurrido_en, a.accion, a.actor_user_id as actor, a.entidad_id as persona, a.datos from public.auditoria a
     where a.empresa_id = e and a.accion in ('usuario.establecimiento', 'usuario.establecimiento.revocar', 'establecimiento.nombre', 'usuario.supervisor', 'documento.borrador_trasladado') order by a.id desc limit 30) h;
  return jsonb_build_object('establecimientos', v_est, 'personas', v_mie, 'historial', v_his, 'yo', u, 'activo_por_usuario', public.fel__establecimiento_por_usuario());
end $$;

create or replace function public.fel_adm_establecimiento_nombre(p_sesion text, p_establecimiento uuid, p_nombre text) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid; e uuid; x public.establecimientos; v_ant text;
begin
  select o_user, o_empresa into u, e from public.fel__sesion_empresa(p_sesion);
  select * into x from public.establecimientos where id = p_establecimiento and empresa_id = e;
  if not found then raise exception 'FEL_NO_ENCONTRADO: establecimiento no encontrado'; end if;
  if length(btrim(coalesce(p_nombre, ''))) not between 1 and 120 then raise exception 'FEL_REGLA: el nombre debe tener entre 1 y 120 caracteres'; end if;
  v_ant := x.nombre;
  perform public.fel_op_establecimiento_guardar(u, e, x.id, x.codigo_sat, btrim(p_nombre), x.direccion, x.estado);   -- código, dirección y estado: los que ya tiene
  perform public.fel_auditar(e, u, 'establecimiento.nombre', 'establecimiento', x.id::text, jsonb_build_object('de', v_ant, 'a', btrim(p_nombre)));
end $$;

create or replace function public.fel_adm_supervisor(p_sesion text, p_usuario uuid, p_valor boolean, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid; e uuid; m public.miembros; v_pred uuid;
begin
  select o_user, o_empresa into u, e from public.fel__sesion_empresa(p_sesion);
  perform public.fel__exigir_permiso(u, e, 'usuarios.gestionar');
  if p_usuario = u then raise exception 'FEL_REGLA: nadie cambia su propio permiso de supervisión'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'FEL_REGLA: indica el motivo (mínimo 5 caracteres)'; end if;
  select * into m from public.miembros where empresa_id = e and user_id = p_usuario and activo for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: la persona no es miembro activo de esta empresa'; end if;
  if m.rol = 'propietario' then raise exception 'FEL_REGLA: el propietario ya tiene todos los establecimientos'; end if;
  if p_valor then
    update public.miembros set permisos_extra = (select array(select distinct unnest(permisos_extra || array['establecimientos.multiples']))) where empresa_id = e and user_id = p_usuario;   -- el disparador rechaza a un lector
  else
    update public.miembros set permisos_extra = array_remove(permisos_extra, 'establecimientos.multiples') where empresa_id = e and user_id = p_usuario;
    select establecimiento_id into v_pred from public.usuario_establecimientos where empresa_id = e and user_id = p_usuario and revocado_en is null order by predeterminado desc, creado_en limit 1;
    update public.usuario_establecimientos set predeterminado = (establecimiento_id = v_pred) where empresa_id = e and user_id = p_usuario and revocado_en is null;
    update public.usuario_establecimientos set revocado_por = u, revocado_en = now(), motivo = left('supervisión retirada: ' || p_motivo, 300), predeterminado = false
     where empresa_id = e and user_id = p_usuario and revocado_en is null and establecimiento_id <> v_pred;   -- vuelve a UN solo establecimiento; nada se borra
  end if;
  perform public.fel_auditar(e, u, 'usuario.supervisor', 'usuario', p_usuario::text, jsonb_build_object('valor', p_valor, 'motivo', left(p_motivo, 300)));
end $$;
revoke all on function public.fel_adm_asignaciones_listar(text), public.fel_adm_establecimiento_nombre(text, uuid, text), public.fel_adm_supervisor(text, uuid, boolean, text) from public, anon, authenticated;
