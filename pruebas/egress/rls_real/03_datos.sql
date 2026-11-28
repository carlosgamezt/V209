-- Datos de prueba (ficticios): 3 regiones × 2 sucursales × 2 tipos de plan = 12 planes con 8 miniaturas embebidas cada uno (96 en total), avisos y un usuario de cada rol.
create table public.zz_u (u text primary key, uid uuid not null);
insert into public.zz_u (u, uid) values ('admin','00000000-0000-0000-0000-0000000000a1'),('vis','00000000-0000-0000-0000-0000000000a2'),('analista','00000000-0000-0000-0000-0000000000a3'),('gerencia','00000000-0000-0000-0000-0000000000a4'),
 ('sup1','00000000-0000-0000-0000-0000000000a5'),('com1','00000000-0000-0000-0000-0000000000a6'),('supx','00000000-0000-0000-0000-0000000000a7'),('inv_todo','00000000-0000-0000-0000-0000000000a8'),('inv_lim','00000000-0000-0000-0000-0000000000a9'),
 ('suc11','00000000-0000-0000-0000-0000000000b1'),('suc21','00000000-0000-0000-0000-0000000000b2'),('sinperfil','00000000-0000-0000-0000-0000000000b9');
insert into public.pa_profiles (auth_id, user_id, role, region, branch, assigned) select uid, u, r, rg, br, asg from public.zz_u join (values
 ('admin','admin',null,null,null::jsonb),('vis','visualizador',null,null,null),('analista','analista',null,null,null),('gerencia','gerencia',null,null,null),('sup1','supervisor','1',null,null),('com1','comodin','1',null,null),
 ('supx','supervisor','2',null,null),('inv_todo','inventarios',null,null,null),('inv_lim','inventarios',null,null,'["2|b21"]'::jsonb),('suc11','sucursal','1','b11',null),('suc21','sucursal','2','b21',null)) v(uu, r, rg, br, asg) on uu = u;
insert into public.pa_docs (col, id, data) values ('meta','cfg','{"access":{"supx":{"reg":{"1":"ver","3":"editar"}}},"invReview":true,"invRegs":{"inv_lim":["3"]}}'),('users','admin','{"role":"admin"}');
create function pg_temp.foto(n text) returns jsonb language sql as $$ select jsonb_build_object('k', n, 't', 'data:image/jpeg;base64,' || repeat(md5(n), 300), 'o', 1, 'x', 'jpg') $$;
insert into public.pa_docs (col, id, data) select 'plans', 'PA-' || r || b || t, jsonb_build_object('id', 'PA-' || r || b || t, 'region', r::text, 'branch', 'b' || r || b, 'type', case t when 1 then 'Operaciones' else 'Inventarios' end, 'status', 'En proceso',
   'acts', (select jsonb_agg(jsonb_build_object('text', 'A' || a, 'st', 'Enviada', 'ref', pg_temp.foto('ref#' || r || b || t || '-' || a), 'ev', pg_temp.foto('ev#' || r || b || t || '-' || a), 'rv', jsonb_build_object('n', 'x', 't', 1700000000123, 'ok', true))) from generate_series(1, 4) a))
  from generate_series(1, 3) r, generate_series(1, 2) b, generate_series(1, 2) t;
insert into public.pa_docs (col, id, data, updated_at) select 'notifs', 'n' || g, jsonb_build_object('id', 'n' || g, 'to', jsonb_build_array(case g % 3 when 0 then 'suc11' when 1 then 'sup1' else 'admin' end), 'read', case when g % 2 = 0 then jsonb_build_array(case g % 3 when 0 then 'suc11' when 1 then 'sup1' else 'admin' end) else '[]'::jsonb end), now() - (g * 3 || ' days')::interval from generate_series(1, 40) g;
create table public.zz_orig as select col, id, data from public.pa_docs;
create table public.zz_res (fase text, u text, plan text, filas int, primary key (fase, u, plan));
-- intento de actualización con el payload de un cliente «ligero/antiguo» (sin miniaturas); se DESHACE; devuelve filas afectadas (-1 = política lo rechazó)
create function public.zz_intentar(p_plan text) returns int language plpgsql as $$
declare n int := 0;
begin
  begin
    update public.pa_docs set data = jsonb_set(public.pa_strip_thumbs_o(data), '{marca}', '"x"'), updated_at = now() where col = 'plans' and id = p_plan;
    get diagnostics n = row_count; raise exception using errcode = 'P0001', message = 'deshacer';
  exception when sqlstate 'P0001' then null; when others then n := -1; end;
  return n;
end $$;
-- quita t de las fotos SIN depender de E1 (para poder correr la matriz antes de aplicarla)
create function public.pa_strip_thumbs_o(j jsonb) returns jsonb language plpgsql immutable as $$
declare r jsonb; base jsonb;
begin
  if j is null then return null; end if;
  if jsonb_typeof(j) = 'array' then select coalesce(jsonb_agg(public.pa_strip_thumbs_o(x.v) order by x.n), '[]') into r from jsonb_array_elements(j) with ordinality as x(v, n); return r;
  elsif jsonb_typeof(j) = 'object' then base := j; if base ? 'k' and jsonb_typeof(base -> 't') = 'string' and (base ->> 't') like 'data:image/%' then base := base - 't'; end if; select coalesce(jsonb_object_agg(e.key, public.pa_strip_thumbs_o(e.value)), '{}') into r from jsonb_each(base) e; return r; end if;
  return j;
end $$;
-- ejecuta la matriz usuario × plan para una fase (pre/post E1)
create function public.zz_matriz(p_fase text) returns void language plpgsql as $$
declare u record; p record; n int;
begin
  for u in select * from public.zz_u loop
    for p in select id from public.zz_orig where col = 'plans' order by id loop
      execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub', u.uid::text, true);
      n := public.zz_intentar(p.id);
      execute 'reset role';
      insert into public.zz_res values (p_fase, u.u, p.id, n);
    end loop;
  end loop;
end $$;
