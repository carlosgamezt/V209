-- E0 · RESPALDO previo a E1 (se ejecuta UNA vez, antes de E1; no modifica ninguna tabla existente). Copia exacta de pa_docs (planes con sus miniaturas embebidas, usuarios, avisos, configuración) y de pa_descargas.
-- Falla si ya existe un respaldo (no lo sobrescribe). Quedan sin acceso para la app (RLS sin políticas; solo el editor SQL / rol de servicio las ve). Las fotos en alta resolución están en OneDrive y no las toca ninguna de estas propuestas.
-- Requiere espacio: ver «mb_total» de medicion_egress.sql (la copia ocupa lo mismo que pa_docs; el plan gratuito tiene 500 MB de base).
begin;
create table public.pa_docs_respaldo_e0 as select now() as respaldado_en, d.* from public.pa_docs d;
create table public.pa_descargas_respaldo_e0 as select now() as respaldado_en, d.* from public.pa_descargas d;
alter table public.pa_docs_respaldo_e0 enable row level security;
alter table public.pa_descargas_respaldo_e0 enable row level security;
revoke all on public.pa_docs_respaldo_e0, public.pa_descargas_respaldo_e0 from anon, authenticated;
do $$ declare a int; b int; ha text; hb text; begin
  select count(*), md5(string_agg(d.data::text, '' order by d.col, d.id)) into a, ha from public.pa_docs d;
  select count(*), md5(string_agg(r.data::text, '' order by r.col, r.id)) into b, hb from public.pa_docs_respaldo_e0 r;
  if a <> b or ha is distinct from hb then raise exception 'E0 detenido: el respaldo no coincide (% vs % filas)', a, b; end if;
  raise notice 'E0 OK: % filas de pa_docs respaldadas; huella %', a, ha;
end $$;
commit;
