-- Verificaciones tras aplicar E1 sobre las políticas reales. Cada bloque imprime un aviso «OK …» o falla.
-- A) E1 no cambia ESCRITURA: la matriz usuario × plan (filas actualizables / rechazadas) es idéntica antes y después
do $$ declare d int; t int; begin
  select count(*) into t from public.zz_res where fase = 'pre';
  select count(*) into d from public.zz_res a join public.zz_res b on a.u = b.u and a.plan = b.plan and a.fase = 'pre' and b.fase = 'post' where a.filas is distinct from b.filas;
  assert t = 12 * 12, 'matriz incompleta: ' || t; assert d = 0, 'E1 cambió permisos de escritura en ' || d || ' casos';
  raise notice 'OK A) escritura: la matriz de 12 usuarios × 12 planes es idéntica antes y después de E1 (% casos)', t; end $$;
-- B) E1 no cambia LECTURA y la vista ligera da las MISMAS filas que la tabla para cada rol; pa_thumbs solo muestra miniaturas de planes visibles
do $$ declare u record; a text[]; b text[]; tk text[]; esp text[]; nvis int; begin
  for u in select * from public.zz_u loop
    execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub', u.uid::text, true);
    select coalesce(array_agg(col || '|' || id order by col, id), '{}') into a from public.pa_docs;
    select coalesce(array_agg(col || '|' || id order by col, id), '{}') into b from public.pa_docs_lite;
    select coalesce(array_agg(k order by k), '{}') into tk from public.pa_thumbs;
    execute 'reset role';
    -- la vista omite solo avisos de más de 45 días leídos por todos (ver E1)
    select coalesce(array_agg(x order by x), '{}') into a from unnest(a) x where x not in (select 'notifs|' || id from public.pa_docs where col = 'notifs' and updated_at < now() - interval '45 days' and (data -> 'to') <@ (data -> 'read'));
    assert a = b, u.u || ': la vista ligera difiere de la tabla (' || cardinality(a) || ' vs ' || cardinality(b) || ')';
    select coalesce(array_agg(x.k order by x.k), '{}') into esp from public.zz_orig o, lateral public.pa_extract_thumbs(o.data) x where o.col = 'plans' and ('plans|' || o.id) = any (b);
    assert tk = esp, u.u || ': pa_thumbs no coincide con las miniaturas de sus planes visibles (' || cardinality(tk) || ' vs ' || cardinality(esp) || ')';
    nvis := (select count(*) from unnest(b) x where x like 'plans|%');
    raise notice '   rol % ve % planes y % miniaturas', rpad(u.u, 9), nvis, cardinality(tk);
  end loop;
  raise notice 'OK B) lectura: la vista ligera = la tabla y pa_thumbs = miniaturas de los planes visibles, para los 12 perfiles (admin, visualizador, analista, gerencia, supervisor, comodín, supervisor entre regiones ver/editar, inventarios todo/limitado, sucursales, sin perfil)'; end $$;
-- C) escritura real de un cliente antiguo sobre planes con fotos (donde la política lo permite): no se pierde ninguna miniatura y el plan queda sin imágenes
do $$ declare r record; antes int; despues int; n int := 0; begin
  select count(*) into antes from public.pa_thumbs;
  for r in select u.u, u.uid, p.plan from public.zz_u u join public.zz_res p on p.u = u.u and p.fase = 'post' and p.filas > 0 where p.plan in ('PA-111', 'PA-221', 'PA-312') loop
    execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub', r.uid::text, true);
    update public.pa_docs set data = jsonb_set(public.pa_strip_thumbs_o(data), '{marca}', to_jsonb(r.u)), updated_at = now() where col = 'plans' and id = r.plan;
    execute 'reset role'; n := n + 1;
    assert (select data::text from public.pa_docs where col = 'plans' and id = r.plan) not like '%data:image/%', r.u || ': el plan quedó con imágenes';
    assert not exists (select 1 from public.zz_orig o, lateral public.pa_extract_thumbs(o.data) x where o.col = 'plans' and o.id = r.plan and not exists (select 1 from public.pa_thumbs t where t.k = x.k and t.t = x.t)), r.u || ': se perdió una miniatura de ' || r.plan;
  end loop;
  assert n > 0, 'no se probó ninguna escritura';
  raise notice 'OK C) % escrituras reales de clientes antiguos sobre planes con fotos (por los roles que la política permite): ninguna miniatura perdida ni alterada', n; end $$;
-- D) un cliente NUEVO (con miniatura nueva) escribe/crea: la miniatura se separa; una sucursal puede crear su plan automático con fotos aunque no tenga permiso sobre pa_thumbs
do $$ begin
  execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
  insert into public.pa_docs (col, id, data) values ('plans', 'PA-NUEVO', jsonb_build_object('id', 'PA-NUEVO', 'region', '1', 'branch', 'b11', 'type', 'Operaciones', 'auto', '1', 'acts', jsonb_build_array(jsonb_build_object('ref', jsonb_build_object('k', 'ref#nuevo', 't', 'data:image/jpeg;base64,ZZZZ')))));
  assert (select count(*) from public.pa_thumbs where k = 'ref#nuevo') = 1, 'la sucursal debe ver la miniatura de su plan nuevo';
  begin insert into public.pa_docs (col, id, data) values ('plans', 'PA-AJENO', jsonb_build_object('id', 'PA-AJENO', 'region', '2', 'branch', 'b21', 'type', 'Operaciones', 'auto', '1')); assert false, 'la sucursal no debe crear planes de otra sucursal'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  assert (select data::text from public.pa_docs where col = 'plans' and id = 'PA-NUEVO') not like '%ZZZZ%', 'el plan nuevo no debe llevar la imagen';
  raise notice 'OK D) creación por sucursal con foto: se separa la miniatura; las reglas de inserción de la política real siguen intactas'; end $$;
-- E) borrar un plan deja su miniatura guardada pero invisible (nada se elimina; las políticas siguen decidiendo)
do $$ declare antes int; begin
  select count(*) into antes from public.pa_thumbs;
  execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a5', true);
  delete from public.pa_docs where col = 'plans' and id = 'PA-122';
  assert (select count(*) from public.pa_thumbs where k like 'ref#122-%') = 0, 'una miniatura de un plan borrado sigue visible';
  execute 'reset role';
  assert (select count(*) from public.pa_thumbs) = antes, 'se eliminó alguna miniatura (no debe ocurrir)';
  raise notice 'OK E) plan borrado por un supervisor: sus miniaturas permanecen guardadas (% en total) e invisibles', antes; end $$;
-- F) integridad: las 96 miniaturas originales (menos las de planes nuevos) siguen idénticas en pa_thumbs
do $$ begin
  assert (select count(*) from public.zz_orig o, lateral public.pa_extract_thumbs(o.data) x where o.col = 'plans') = 96, 'fixture';
  assert not exists (select 1 from public.zz_orig o, lateral public.pa_extract_thumbs(o.data) x where o.col = 'plans' and not exists (select 1 from public.pa_thumbs t where t.k = x.k and t.t = x.t)), 'miniatura original ausente o alterada';
  raise notice 'OK F) las 96 miniaturas originales siguen presentes y con contenido idéntico en pa_thumbs'; end $$;

-- G) E3 guardado parcial bajo las políticas reales: SOLO quien podía actualizar la fila puede aplicar un cambio parcial (misma matriz que la actualización completa); y dos ediciones concurrentes de partes distintas se conservan ambas
create function public.zz_intentar_patch(p_plan text) returns int language plpgsql as $$
declare n int := 0; r timestamptz;
begin
  begin
    r := public.pa_docs_patch('plans', p_plan, '[{"path":["marca2"],"value":"x"}]'::jsonb);
    n := case when r is null then 0 else 1 end; raise exception using errcode = 'P0001', message = 'deshacer';
  exception when sqlstate 'P0001' then null; when others then n := -1; end;
  return n;
end $$;
do $$ declare u record; p record; n int; malos int := 0; total int := 0; begin
  for u in select * from public.zz_u loop for p in select o.id from public.zz_orig o where o.col = 'plans' and exists (select 1 from public.pa_docs d where d.col = 'plans' and d.id = o.id) order by o.id loop
    execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub', u.uid::text, true);
    n := public.zz_intentar_patch(p.id); execute 'reset role'; total := total + 1;
    if (n > 0) is distinct from ((select filas from public.zz_res where fase = 'post' and zz_res.u = u.u and plan = p.id) > 0) then malos := malos + 1; end if;
  end loop; end loop;
  assert malos = 0, 'E3 cambió quién puede escribir en ' || malos || ' casos'; raise notice 'OK G1) guardado parcial: quién puede aplicarlo coincide con quién podía actualizar la fila en los % casos usuario × plan (políticas reales)', total; end $$;
do $$ declare t1 timestamptz; antes jsonb; fin jsonb; begin
  execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a5', true);   -- supervisor región 1
  perform public.pa_docs_patch('plans', 'PA-111', '[{"path":["acts","0","text"],"value":"cambio de A"}]');
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);   -- sucursal b11 (parte distinta del mismo plan, con su copia vieja)
  perform public.pa_docs_patch('plans', 'PA-111', '[{"path":["acts","1","st"],"value":"Aprobada"},{"path":["acts","1","rv","ok"],"value":false}]');
  execute 'reset role'; select data into fin from public.pa_docs where col = 'plans' and id = 'PA-111';
  assert fin #>> '{acts,0,text}' = 'cambio de A' and fin #>> '{acts,1,st}' = 'Aprobada' and (fin #> '{acts,1,rv,ok}') = 'false'::jsonb, 'una edición concurrente se perdió';
  assert fin #>> '{acts,2,text}' = 'A3' and fin #>> '{region}' = '1', 'las partes no editadas deben quedar intactas';
  assert fin::text not like '%data:image/%', 'el plan no debe quedar con imágenes';
  assert not exists (select 1 from public.zz_orig o, lateral public.pa_extract_thumbs(o.data) x where o.col = 'plans' and o.id = 'PA-111' and not exists (select 1 from public.pa_thumbs t where t.k = x.k and t.t = x.t)), 'miniatura perdida';
  raise notice 'OK G2) dos ediciones concurrentes de partes distintas del mismo plan se conservan ambas; lo no editado y las miniaturas quedan intactos'; end $$;
