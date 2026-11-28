-- V1 · VALIDACIÓN con las funciones y políticas RLS REALES y los perfiles REALES (no modifica nada: solo lecturas y pruebas de escritura que se DESHACEN).
-- Para cada perfil de pa_profiles, actuando como ese usuario (rol authenticated + su identidad): (1) compara lo que ve en pa_docs con lo que ve por la vista ligera pa_docs_lite (deben ser las mismas filas; la vista solo omite avisos antiguos ya leídos por todos);
-- (2) intenta actualizar cada plan que ve (sin cambiar nada, dentro de una subtransacción que se deshace) y registra si la política lo permite. Esa matriz sirve de referencia para comprobar que E1 NO cambia permisos de escritura.
-- Se DETIENE con error si alguna lectura difiere. El resultado final solo contiene conteos por rol (sin nombres ni datos).
begin;
create temp table v1_res (perfil uuid, rol text, filas_tabla int, filas_vista int, diferencias int, planes_visibles int, planes_actualizables int) on commit preserve rows;
create temp table v1_esc (perfil uuid, plan text, filas int) on commit preserve rows;
create or replace function pg_temp.v1_intento(p_plan text) returns int language plpgsql as $f$
declare n int := 0;
begin
  begin
    update public.pa_docs set updated_at = updated_at where col = 'plans' and id = p_plan;
    get diagnostics n = row_count; raise exception using errcode = 'P0001', message = 'deshacer';
  exception when sqlstate 'P0001' then null; when others then n := -1; end;
  return n;
end $f$;
do $$
declare p record; pl record; a int; b int; dif int; vis int; upd int; n int; esc jsonb;
begin
  if to_regclass('public.pa_docs_lite') is null then raise exception 'V1 detenido: falta la vista pa_docs_lite (aplicar E1a)'; end if;
  for p in select auth_id, coalesce(role, '(sin rol)') as rol from public.pa_profiles where auth_id is not null loop
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', p.auth_id::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', p.auth_id, 'role', 'authenticated')::text, true);
    select count(*) into a from public.pa_docs;
    select count(*) into b from public.pa_docs_lite;
    -- diferencias inesperadas: filas de la vista que no están en la tabla, o filas de la tabla ausentes en la vista que NO sean avisos antiguos leídos por todos
    select count(*) into dif from (
      (select col, id from public.pa_docs_lite except select col, id from public.pa_docs)
      union all
      (select col, id from public.pa_docs where not (col = 'notifs' and updated_at < now() - interval '45 days' and data ? 'to' and data ? 'read' and (data -> 'to') <@ (data -> 'read')) except select col, id from public.pa_docs_lite)
    ) x;
    select count(*) into vis from public.pa_docs where col = 'plans';
    upd := 0; esc := '[]'::jsonb;
    for pl in select id from public.pa_docs where col = 'plans' loop
      n := pg_temp.v1_intento(pl.id); esc := esc || jsonb_build_array(jsonb_build_array(pl.id, n)); if n > 0 then upd := upd + 1; end if;
    end loop;
    execute 'reset role';
    insert into v1_res values (p.auth_id, p.rol, a, b, dif, vis, upd);
    insert into v1_esc select p.auth_id, e ->> 0, (e ->> 1)::int from jsonb_array_elements(esc) e;
  end loop;
  if exists (select 1 from v1_res where diferencias <> 0) then raise exception 'V1 FALLÓ: la vista ligera difiere de la tabla para algún perfil real'; end if;
  if not exists (select 1 from v1_res) then raise exception 'V1 detenido: pa_profiles no tiene perfiles con auth_id'; end if;
end $$;
-- guarda la matriz de escritura de referencia (solo identificadores técnicos y conteos) para compararla después de E1
create table if not exists public.pa_e1_matriz_ref (perfil uuid, plan text, filas int, fase text, tomada_en timestamptz default now());
revoke all on public.pa_e1_matriz_ref from anon, authenticated;
alter table public.pa_e1_matriz_ref enable row level security;
delete from public.pa_e1_matriz_ref where fase = 'antes';
insert into public.pa_e1_matriz_ref (perfil, plan, filas, fase) select perfil, plan, filas, 'antes' from v1_esc;
commit;
select json_build_object(
  'paso', 'V1 validación RLS real',
  'perfiles_probados', (select count(*) from v1_res),
  'lectura_vista_igual_a_tabla_en_todos', (select bool_and(diferencias = 0) from v1_res),
  'por_rol', (select json_agg(x order by x.rol) from (select rol, count(*) as perfiles, min(filas_tabla) as min_filas, max(filas_tabla) as max_filas, min(planes_visibles) as min_planes, max(planes_visibles) as max_planes, min(planes_actualizables) as min_actualizables, max(planes_actualizables) as max_actualizables, sum(diferencias) as diferencias from v1_res group by rol) x),
  'matriz_escritura_guardada', (select count(*) from public.pa_e1_matriz_ref where fase = 'antes'),
  'intentos_rechazados_por_with_check', (select count(*) from v1_esc where filas = -1)
) as v1;
