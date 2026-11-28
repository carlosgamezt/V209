-- Funciones de apoyo para super-api (aditivo, idempotente; no cambia datos ni políticas; las dos son SECURITY INVOKER).
-- 1) nexa_foto_acceso: decide si QUIEN LLAMA (con su propia sesión, bajo las MISMAS políticas RLS de pa_docs) puede leer o escribir la foto de un plan. Lectura = algún plan visible para esa persona referencia la foto (o el plan de su nombre es visible).
--    Escritura de evidencia = puede ACTUALIZAR ese plan (se comprueba con un bloqueo de fila FOR SHARE, que aplica las políticas de actualización sin escribir nada). Escritura de foto de referencia = rol con vista «Nuevo» (de fábrica o configurado).
-- 2) nexa_push_pendientes: contadores del aviso fijo (los mismos criterios que super-api calculaba bajando todos los planes) calculados en PostgreSQL; devuelve solo {usuario: número}.
-- Ambas se comprueban aquí mismo con los perfiles REALES: si una comprobación falla, todo se deshace.
begin;
create or replace function public.nexa_foto_acceso(p_tipo text, p_planid text, p_k text, p_escritura boolean default false) returns boolean
language plpgsql volatile security invoker set search_path = '' as $f$
declare rol text; cfg jsonb; refd boolean := false;
begin
  if p_k is not null and not p_escritura then
    select exists (select 1 from public.pa_docs d where d.col = 'plans' and (
        d.data @> jsonb_build_object('acts', jsonb_build_array(jsonb_build_object('ev', jsonb_build_object('k', p_k))))
     or d.data @> jsonb_build_object('acts', jsonb_build_array(jsonb_build_object('ref', jsonb_build_object('k', p_k)))))) into refd;
    if refd then return true; end if;
  end if;
  if p_tipo = 'ev' then
    if p_planid is null then return false; end if;
    if p_escritura then
      perform 1 from public.pa_docs where col = 'plans' and id = p_planid for share;
      return found;
    end if;
    return exists (select 1 from public.pa_docs where col = 'plans' and id = p_planid);
  elsif p_tipo = 'ref' then
    if not p_escritura then return false; end if;
    select p.role into rol from public.pa_profiles p where p.auth_id = auth.uid();
    if rol is null then return false; end if;
    if rol in ('admin', 'supervisor', 'comodin', 'inventarios') then return true; end if;
    select d.data into cfg from public.pa_docs d where d.col = 'meta' and d.id = 'cfg';
    return coalesce(cfg #> array['roles', rol, 'perm', 'views'], '[]'::jsonb) ? 'nuevo';
  end if;
  return false;
end $f$;
revoke all on function public.nexa_foto_acceso(text, text, text, boolean) from public, anon;
grant execute on function public.nexa_foto_acceso(text, text, text, boolean) to authenticated;

create or replace function public.nexa_push_pendientes(p_ids text[]) returns jsonb
language sql stable security invoker set search_path = '' as $f$
  with cfg as (select coalesce((select d.data from public.pa_docs d where d.col = 'meta' and d.id = 'cfg'), '{}'::jsonb) as c),
  pl as (
    select d.data ->> 'status' as st, d.data ->> 'region' as reg, d.data -> 'branch' as br, d.data ->> 'type' as tp,
      (select count(*) from jsonb_array_elements(case when jsonb_typeof(d.data -> 'acts') = 'array' then d.data -> 'acts' else '[]'::jsonb end) a where jsonb_typeof(a) = 'object' and a ->> 'st' = 'Enviada')::int as env,
      exists (select 1 from jsonb_array_elements(case when jsonb_typeof(d.data -> 'acts') = 'array' then d.data -> 'acts' else '[]'::jsonb end) a where jsonb_typeof(a) = 'object' and a ->> 'st' in ('Pendiente', 'Rechazada')) as pen
    from public.pa_docs d where d.col = 'plans' and jsonb_typeof(d.data) = 'object'
  ),
  us as (select u.id, u.data as d, u.data ->> 'role' as r, coalesce((select c from cfg) -> 'watch' -> u.id, '{}'::jsonb) as w from public.pa_docs u where u.col = 'users' and u.id = any (p_ids)),
  cal as (
    select us.id, us.r,
      case us.r
        when 'sucursal' then (select count(*) from pl where pl.st = 'En proceso' and pl.reg is not distinct from us.d ->> 'region' and pl.br is not distinct from us.d -> 'branch' and pl.pen)
        when 'supervisor' then (select coalesce(sum(env), 0) from pl where pl.reg is not distinct from us.d ->> 'region')
        when 'admin' then (select coalesce(sum(env), 0) from pl where pl.reg = '2')
        when 'inventarios' then case when coalesce((select c ->> 'invReview' from cfg), 'false') not in ('false', 'null', '0', '')
            then (select coalesce(sum(env), 0) from pl where pl.tp = 'Inventarios')
            else (select count(*) from pl where pl.tp = 'Inventarios' and pl.st is distinct from 'Completado') end
        when 'analista' then (select coalesce(sum(env), 0) from pl where coalesce(us.w -> 'all', 'false'::jsonb) not in ('false'::jsonb, 'null'::jsonb, '0'::jsonb, '""'::jsonb)
            or exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(us.w -> 'regs') = 'array' then us.w -> 'regs' else '[]'::jsonb end) e where e = pl.reg))
        when 'gerencia' then (select coalesce(sum(env), 0) from pl where coalesce(us.w -> 'all', 'false'::jsonb) not in ('false'::jsonb, 'null'::jsonb, '0'::jsonb, '""'::jsonb)
            or exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(us.w -> 'regs') = 'array' then us.w -> 'regs' else '[]'::jsonb end) e where e = pl.reg))
      end as n
    from us
  )
  select coalesce(jsonb_object_agg(cal.id, cal.n::int) filter (where cal.n is not null), '{}'::jsonb) from cal
$f$;
revoke all on function public.nexa_push_pendientes(text[]) from public, anon, authenticated;
grant execute on function public.nexa_push_pendientes(text[]) to service_role;
-- Comprobación con los perfiles REALES: para cada perfil con sesión y cada plan, la función debe coincidir con lo que la persona realmente puede leer y actualizar (se deshace todo si algo difiere).
create temp table sa_res (perfil uuid, plan text, lee_directo boolean, lee_fn boolean, escribe_directo boolean, escribe_fn boolean) on commit preserve rows;
create or replace function pg_temp.sa_intento(p_plan text) returns int language plpgsql as $g$
declare n int := 0;
begin
  begin
    update public.pa_docs set updated_at = updated_at where col = 'plans' and id = p_plan;
    get diagnostics n = row_count; raise exception using errcode = 'P0001', message = 'deshacer';
  exception when sqlstate 'P0001' then null; when others then n := -1; end;
  return n;
end $g$;
do $v$ declare p record; pl record; acc jsonb; malos int; ids text[]; begin
  select array_agg(id order by id) into ids from public.pa_docs where col = 'plans';
  for p in select auth_id from public.pa_profiles where auth_id is not null loop
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', p.auth_id::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', p.auth_id, 'role', 'authenticated')::text, true);
    acc := '[]'::jsonb;
    for pl in select x as id from unnest(ids) x loop
      acc := acc || jsonb_build_array(jsonb_build_array(pl.id, exists (select 1 from public.pa_docs d where d.col = 'plans' and d.id = pl.id), public.nexa_foto_acceso('ev', pl.id, null, false), pg_temp.sa_intento(pl.id) > 0, public.nexa_foto_acceso('ev', pl.id, null, true)));
    end loop;
    execute 'reset role';
    insert into sa_res select p.auth_id, e ->> 0, (e ->> 1)::boolean, (e ->> 2)::boolean, (e ->> 3)::boolean, (e ->> 4)::boolean from jsonb_array_elements(acc) e;
  end loop;
  select count(*) into malos from sa_res where lee_directo is distinct from lee_fn or escribe_directo is distinct from escribe_fn;
  if malos <> 0 then raise exception 'super_api_funciones DESHECHO: la función difiere de los permisos reales en % casos', malos; end if;
end $v$;
commit;
select json_build_object('paso', 'super_api_funciones',
  'casos_perfil_x_plan_comprobados', (select count(*) from sa_res),
  'casos_donde_alguien_puede_escribir', (select count(*) from sa_res where escribe_fn),
  'casos_donde_alguien_puede_leer', (select count(*) from sa_res where lee_fn),
  'foto_acceso_ejecutable_por_anon', has_function_privilege('anon', 'public.nexa_foto_acceso(text,text,text,boolean)', 'execute'),
  'push_pendientes_ejecutable_por_authenticated', has_function_privilege('authenticated', 'public.nexa_push_pendientes(text[])', 'execute'),
  'push_pendientes_ejecutable_por_service_role', has_function_privilege('service_role', 'public.nexa_push_pendientes(text[])', 'execute')) as super_api_funciones;
