-- E2 (versión para el flujo automático; NO aplicada; requiere autorización): COMPACTAR. Quita las miniaturas embebidas de los planes existentes (ya copiadas en pa_thumbs por E1). Una transacción; se DESHACE si algo no coincide.
-- Requisitos: E0 (respaldo íntegro con las miniaturas embebidas), E1 y su matriz. No toca updated_at ni el disparador de otros datos. Garantías comprobadas dentro de la transacción:
--  (1) cada miniatura embebida está en pa_thumbs con contenido idéntico; (2) lo que ve CUALQUIER perfil real por la vista ligera es EXACTAMENTE lo mismo antes y después (huella idéntica); (3) la matriz de escritura sigue idéntica; (4) las miniaturas del respaldo siguen todas en pa_thumbs.
begin;
do $pre$ begin
  if to_regclass('public.pa_thumbs') is null or to_regclass('public.pa_docs_respaldo_e0') is null or to_regclass('public.pa_e1_matriz_ref') is null then raise exception 'E2 detenido: faltan E0/E1'; end if;
  if exists (select 1 from public.pa_docs d, lateral public.pa_extract_thumbs(d.data) x where d.col = 'plans' and not exists (select 1 from public.pa_thumbs t where t.k = x.k and t.t = x.t)) then raise exception 'E2 detenido: hay miniaturas embebidas sin copia idéntica en pa_thumbs'; end if;
end $pre$;
-- Respaldo ACTUALIZADO de los planes (con sus miniaturas embebidas y todas las modificaciones hechas después de E0), tomado dentro de esta misma transacción.
drop table if exists public.pa_docs_respaldo_e2;
create table public.pa_docs_respaldo_e2 as select * from public.pa_docs where col = 'plans';
alter table public.pa_docs_respaldo_e2 enable row level security;
revoke all on public.pa_docs_respaldo_e2 from public, anon, authenticated;
create temp table e2_pol on commit preserve rows as select md5(coalesce(string_agg(policyname || '|' || cmd || '|' || coalesce(roles::text, '') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''), E'\n' order by policyname), '')) as huella, (select relrowsecurity from pg_class where oid = 'public.pa_docs'::regclass) as rls from pg_policies where schemaname = 'public' and tablename = 'pa_docs';
create temp table e2_upd on commit preserve rows as select md5(coalesce(string_agg(id || '|' || updated_at::text, ',' order by id), '')) as huella from public.pa_docs;
create temp table e2_ref on commit preserve rows as select md5(coalesce(string_agg(l.data::text, '' order by l.col, l.id), '')) as huella_vista, (select pg_total_relation_size('public.pa_docs')) as bytes_antes, (select count(*) from public.pa_docs d, lateral public.pa_extract_thumbs(d.data) x where d.col = 'plans') as embebidas from public.pa_docs_lite l;
alter table public.pa_docs disable trigger pa_docs_split_thumbs_t;
update public.pa_docs set data = public.pa_strip_thumbs(data) where col = 'plans' and data::text like '%data:image/%';
alter table public.pa_docs enable trigger pa_docs_split_thumbs_t;
do $post$ declare h text; begin
  select md5(coalesce(string_agg(l.data::text, '' order by l.col, l.id), '')) into h from public.pa_docs_lite l;
  if h is distinct from (select huella_vista from e2_ref) then raise exception 'E2 DESHECHA: la vista ligera cambió tras compactar'; end if;
  if exists (select 1 from public.pa_docs where col = 'plans' and data::text like '%data:image/%') then raise exception 'E2 DESHECHA: quedaron imágenes embebidas'; end if;
  if exists (select 1 from public.pa_docs_respaldo_e0 r, lateral public.pa_extract_thumbs(r.data) x where r.col = 'plans' and not exists (select 1 from public.pa_thumbs t where t.k = x.k and t.t = x.t)) then raise exception 'E2 DESHECHA: una miniatura del respaldo no está en pa_thumbs'; end if;
end $post$;
-- Políticas RLS idénticas, updated_at intacto y REVERSIÓN COMPROBADA: volver a incrustar las miniaturas desde pa_thumbs reproduce exactamente el respaldo actualizado.
create function public.pa_embed_thumbs(j jsonb) returns jsonb language plpgsql stable set search_path = '' as $f$
declare r jsonb; base jsonb; tt text;
begin
  if j is null then return null; end if;
  if jsonb_typeof(j) = 'array' then select coalesce(jsonb_agg(public.pa_embed_thumbs(x.v) order by x.n), '[]'::jsonb) into r from jsonb_array_elements(j) with ordinality as x(v, n); return r;
  elsif jsonb_typeof(j) = 'object' then
    base := j;
    if base ? 'k' and jsonb_typeof(base -> 'k') = 'string' and not base ? 't' then select p.t into tt from public.pa_thumbs p where p.k = base ->> 'k'; if tt is not null then base := base || jsonb_build_object('t', tt); end if; end if;
    select coalesce(jsonb_object_agg(e.key, public.pa_embed_thumbs(e.value)), '{}'::jsonb) into r from jsonb_each(base) as e; return r;
  end if;
  return j;
end $f$;
do $rev$ declare h text; rl boolean; malos int; begin
  select md5(coalesce(string_agg(policyname || '|' || cmd || '|' || coalesce(roles::text, '') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''), E'\n' order by policyname), '')), (select relrowsecurity from pg_class where oid = 'public.pa_docs'::regclass) into h, rl from pg_policies where schemaname = 'public' and tablename = 'pa_docs';
  if h is distinct from (select huella from e2_pol) or rl is distinct from (select rls from e2_pol) then raise exception 'E2 DESHECHA: cambiaron las políticas RLS de pa_docs'; end if;
  select md5(coalesce(string_agg(id || '|' || updated_at::text, ',' order by id), '')) into h from public.pa_docs;
  if h is distinct from (select huella from e2_upd) then raise exception 'E2 DESHECHA: cambió updated_at'; end if;
  select count(*) into malos from public.pa_docs_respaldo_e2 r join public.pa_docs d on d.col = r.col and d.id = r.id where public.pa_embed_thumbs(d.data) is distinct from r.data;
  if malos <> 0 or (select count(*) from public.pa_docs_respaldo_e2) <> (select count(*) from public.pa_docs where col = 'plans') then raise exception 'E2 DESHECHA: la reversión no reproduciría el respaldo (% planes)', malos; end if;
end $rev$;
drop function public.pa_embed_thumbs(jsonb);
create temp table e2_esc (perfil uuid, plan text, filas int) on commit preserve rows;
create or replace function pg_temp.e2_intento(p_plan text) returns int language plpgsql as $f$
declare n int := 0;
begin
  begin
    update public.pa_docs set data = data, updated_at = updated_at where col = 'plans' and id = p_plan;
    get diagnostics n = row_count; raise exception using errcode = 'P0001', message = 'deshacer';
  exception when sqlstate 'P0001' then null; when others then n := -1; end;
  return n;
end $f$;
do $esc$ declare p record; pl record; esc jsonb; malos int; begin
  for p in select auth_id from public.pa_profiles where auth_id is not null loop
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', p.auth_id::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', p.auth_id, 'role', 'authenticated')::text, true);
    esc := '[]'::jsonb;
    for pl in select id from public.pa_docs where col = 'plans' loop esc := esc || jsonb_build_array(jsonb_build_array(pl.id, pg_temp.e2_intento(pl.id))); end loop;
    execute 'reset role';
    insert into e2_esc select p.auth_id, e ->> 0, (e ->> 1)::int from jsonb_array_elements(esc) e;
  end loop;
  select count(*) into malos from public.pa_e1_matriz_ref a join e2_esc b on a.perfil = b.perfil and a.plan = b.plan where a.fase = 'despues' and a.filas is distinct from b.filas;
  if malos <> 0 then raise exception 'E2 DESHECHA: cambió quién puede escribir (% casos)', malos; end if;
end $esc$;
commit;
select json_build_object(
  'paso', 'E2 compactar',
  'miniaturas_que_estaban_embebidas', (select embebidas from e2_ref),
  'planes_con_imagenes_embebidas_ahora', (select count(*) from public.pa_docs where col = 'plans' and data::text like '%data:image/%'),
  'vista_ligera_identica_antes_y_despues', true,
  'matriz_escritura_identica_casos', (select count(*) from e2_esc),
  'mb_pa_docs_antes', (select round(bytes_antes / 1048576.0, 2) from e2_ref),
  'mb_pa_docs_ahora_sin_vacuum', (select round(pg_total_relation_size('public.pa_docs') / 1048576.0, 2)),
  'miniaturas_en_pa_thumbs', (select count(*) from public.pa_thumbs),
  'respaldo_actualizado_planes', (select count(*) from public.pa_docs_respaldo_e2),
  'politicas_rls_identicas', true, 'updated_at_intacto', true, 'reversion_reproduce_el_respaldo', true
) as e2;
