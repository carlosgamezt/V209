-- E3 (versión para el flujo automático): guardado parcial. Una transacción; se DESHACE por completo si alguna comprobación con los perfiles REALES falla.
-- Requisitos: E1 aplicada (matriz de escritura «despues» de E1). Comprobaciones: (1) quién puede aplicar un parche = quién podía actualizar la fila (matriz de E1) para cada perfil real y cada plan visible;
-- (2) dos parches concurrentes sobre partes distintas de un plan real se conservan ambos y no se pierde ninguna miniatura (todo se deshace en una subtransacción).
begin;
do $pre$ begin
  if to_regclass('public.pa_thumbs') is null then raise exception 'E3 detenido: falta E1'; end if;
  if not exists (select 1 from public.pa_e1_matriz_ref where fase = 'despues') then raise exception 'E3 detenido: falta la matriz de escritura posterior a E1'; end if;
end $pre$;
-- E3 · GUARDADO PARCIAL de planes (aditivo; no toca datos ni políticas). Idempotente. Reversible con E3_reversion.sql.
-- pa_docs_patch aplica una lista de cambios puntuales (poner un valor en una ruta o quitar una ruta) sobre el JSON de UNA fila, en el servidor y bajo las MISMAS políticas de pa_docs (SECURITY INVOKER:
-- si la persona no puede actualizar esa fila, no pasa nada). Dos personas que editan partes distintas del mismo plan ya no se pisan (antes, el último en guardar reemplazaba el plan completo).
-- Las miniaturas nuevas que lleguen en un cambio las separa el disparador de E1 como siempre. Devuelve la hora del servidor del cambio o NULL si no había fila actualizable.
create or replace function public.pa_docs_patch(p_col text, p_id text, p_ops jsonb) returns timestamptz
language plpgsql security invoker set search_path = '' as $$
declare op jsonb; d jsonb; r timestamptz; ruta text[];
begin
  select data into d from public.pa_docs where col = p_col and id = p_id for update;
  if not found then return null; end if;
  for op in select * from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
    select coalesce(array_agg(x), '{}') into ruta from jsonb_array_elements_text(op -> 'path') x;
    if cardinality(ruta) = 0 then continue; end if;
    if op ? 'del' then d := d #- ruta; elsif op ? 'value' then d := jsonb_set(d, ruta, op -> 'value', true); end if;   -- una operación sin 'value' ni 'del' se ignora
  end loop;
  update public.pa_docs set data = d, updated_at = clock_timestamp() where col = p_col and id = p_id returning updated_at into r;
  return r;
end $$;
revoke all on function public.pa_docs_patch(text, text, jsonb) from public, anon;
grant execute on function public.pa_docs_patch(text, text, jsonb) to authenticated;

create temp table e3_esc (perfil uuid, plan text, filas int) on commit preserve rows;
create or replace function pg_temp.e3_intento(p_plan text) returns int language plpgsql as $f$
declare n int := 0; r timestamptz;
begin
  begin
    r := public.pa_docs_patch('plans', p_plan, '[]'::jsonb);
    n := case when r is null then 0 else 1 end; raise exception using errcode = 'P0001', message = 'deshacer';
  exception when sqlstate 'P0001' then null; when others then n := -1; end;
  return n;
end $f$;
do $post$
declare p record; pl record; esc jsonb; malos int; plan text; admin uuid; antes int; despues int; fin jsonb;
begin
  for p in select auth_id from public.pa_profiles where auth_id is not null loop
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', p.auth_id::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', p.auth_id, 'role', 'authenticated')::text, true);
    esc := '[]'::jsonb;
    for pl in select id from public.pa_docs where col = 'plans' loop esc := esc || jsonb_build_array(jsonb_build_array(pl.id, pg_temp.e3_intento(pl.id))); end loop;
    execute 'reset role';
    insert into e3_esc select p.auth_id, e ->> 0, (e ->> 1)::int from jsonb_array_elements(esc) e;
  end loop;
  select count(*) into malos from public.pa_e1_matriz_ref a join e3_esc b on a.perfil = b.perfil and a.plan = b.plan where a.fase = 'despues' and ((a.filas > 0) is distinct from (b.filas > 0));
  if malos <> 0 then raise exception 'E3 DESHECHA: el guardado parcial cambia quién puede escribir (% casos)', malos; end if;
  if (select count(*) from e3_esc) <> (select count(*) from public.pa_e1_matriz_ref where fase = 'despues') then raise exception 'E3 DESHECHA: la matriz no coincide en tamaño'; end if;
  -- (2) edición concurrente sobre un plan real con fotos, como administrador; todo se deshace
  select a.perfil, a.plan into admin, plan from public.pa_e1_matriz_ref a join public.pa_profiles pr on pr.auth_id = a.perfil where a.fase = 'despues' and a.filas > 0 and pr.role = 'admin'
     and exists (select 1 from public.pa_docs d where d.col = 'plans' and d.id = a.plan and jsonb_array_length(d.data -> 'acts') >= 2) order by a.plan limit 1;
  if plan is null then raise exception 'E3 detenido: no hay un plan editable por el administrador para la prueba'; end if;
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', admin::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
    select count(*) into antes from public.pa_thumbs;
    perform public.pa_docs_patch('plans', plan, '[{"path":["acts","0","text"],"value":"E3 prueba A"}]'::jsonb);
    perform public.pa_docs_patch('plans', plan, '[{"path":["acts","1","text"],"value":"E3 prueba B"}]'::jsonb);
    select data into fin from public.pa_docs where col = 'plans' and id = plan;
    select count(*) into despues from public.pa_thumbs;
    if fin #>> '{acts,0,text}' <> 'E3 prueba A' or fin #>> '{acts,1,text}' <> 'E3 prueba B' then raise exception using errcode = 'P0002', message = 'una edición concurrente se perdió'; end if;
    if antes <> despues or fin::text like '%data:image/%' then raise exception using errcode = 'P0002', message = 'miniaturas alteradas o plan con imágenes'; end if;
    raise exception using errcode = 'P0001', message = 'deshacer';
  exception when sqlstate 'P0001' then null; end;
  execute 'reset role';
end $post$;
commit;
select json_build_object(
  'paso', 'E3 guardado parcial',
  'funcion_existe', (select count(*) = 1 from pg_proc where proname = 'pa_docs_patch' and pronamespace = 'public'::regnamespace),
  'security_invoker', (select not prosecdef from pg_proc where proname = 'pa_docs_patch' and pronamespace = 'public'::regnamespace),
  'ejecutable_por_anon', (select has_function_privilege('anon', 'public.pa_docs_patch(text,text,jsonb)', 'execute')),
  'ejecutable_por_authenticated', (select has_function_privilege('authenticated', 'public.pa_docs_patch(text,text,jsonb)', 'execute')),
  'casos_perfil_x_plan_con_mismo_permiso_que_E1', (select count(*) from e3_esc),
  'edicion_concurrente_en_plan_real', 'ok (deshecha)',
  'pa_docs_intacto_vs_respaldo', (select md5(coalesce(string_agg(d.data::text, '' order by d.col, d.id), '')) = (select md5(coalesce(string_agg(r.data::text, '' order by r.col, r.id), '')) from public.pa_docs_respaldo_e0 r) from public.pa_docs d)
) as e3;
