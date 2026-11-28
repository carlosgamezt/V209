-- E0 (versión para el flujo automático): RESPALDO exacto de pa_docs y pa_descargas dentro de la misma base. IDEMPOTENTE: si el respaldo ya existe NO lo toca ni lo sobrescribe.
-- No modifica ninguna tabla existente. Las copias no son legibles por la app (RLS sin políticas; sin privilegios para anon/authenticated). El resultado final (solo conteos y huellas) queda en el registro del flujo.
do $$
begin
  if to_regclass('public.pa_docs') is null then raise exception 'E0 detenido: no existe public.pa_docs'; end if;
  if pg_database_size(current_database()) > 350 * 1024 * 1024 then raise exception 'E0 detenido: la base supera 350 MB y la copia podría agotar el espacio'; end if;
  if to_regclass('public.pa_docs_respaldo_e0') is null then
    execute 'create table public.pa_docs_respaldo_e0 as select now() as respaldado_en, d.* from public.pa_docs d';
    execute 'alter table public.pa_docs_respaldo_e0 enable row level security';
    execute 'revoke all on public.pa_docs_respaldo_e0 from anon, authenticated';
  end if;
  if to_regclass('public.pa_descargas') is not null and to_regclass('public.pa_descargas_respaldo_e0') is null then
    execute 'create table public.pa_descargas_respaldo_e0 as select now() as respaldado_en, d.* from public.pa_descargas d';
    execute 'alter table public.pa_descargas_respaldo_e0 enable row level security';
    execute 'revoke all on public.pa_descargas_respaldo_e0 from anon, authenticated';
  end if;
end $$;
select json_build_object(
  'paso', 'E0 respaldo',
  'servidor', (select current_setting('server_version')),
  'respaldado_en', (select max(respaldado_en) from public.pa_docs_respaldo_e0),
  'filas_pa_docs', (select count(*) from public.pa_docs),
  'filas_respaldo', (select count(*) from public.pa_docs_respaldo_e0),
  'huella_pa_docs_ahora', (select md5(coalesce(string_agg(d.data::text, '' order by d.col, d.id), '')) from public.pa_docs d),
  'huella_respaldo', (select md5(coalesce(string_agg(r.data::text, '' order by r.col, r.id), '')) from public.pa_docs_respaldo_e0 r),
  'planes_respaldo', (select count(*) from public.pa_docs_respaldo_e0 where col = 'plans'),
  'miniaturas_en_respaldo', (select coalesce(sum((length(r.data::text) - length(replace(r.data::text, '"t": "data:image/', ''))) / 17), 0) from public.pa_docs_respaldo_e0 r where r.col = 'plans'),
  'mb_respaldo', (select round(pg_total_relation_size('public.pa_docs_respaldo_e0') / 1048576.0, 2)),
  'descargas_respaldo', (select count(*) from public.pa_descargas_respaldo_e0),
  'rls_activa_en_respaldo', (select relrowsecurity from pg_class where oid = 'public.pa_docs_respaldo_e0'::regclass),
  'privilegios_app_sobre_respaldo', (select count(*) from information_schema.role_table_grants where table_name = 'pa_docs_respaldo_e0' and grantee in ('anon', 'authenticated')),
  'base_mb', (select round(pg_database_size(current_database()) / 1048576.0, 1))
) as e0;
