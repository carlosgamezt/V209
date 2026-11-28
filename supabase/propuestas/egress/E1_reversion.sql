-- Reversión de E1. NO borra datos: las miniaturas siguen en pa_thumbs (y embebidas en las filas no compactadas). Si se ejecutó E2, aplicar ANTES E2_reversion.sql.
drop trigger if exists pa_docs_split_thumbs_t on public.pa_docs;
drop view if exists public.pa_docs_lite;
drop function if exists public.pa_descargas_resumen();
drop function if exists public.pa_docs_split_thumbs();
-- pa_thumbs, pa_strip_thumbs y pa_extract_thumbs se conservan a propósito (E2_reversion los necesita y no pesan en las lecturas). Para retirarlos del todo, DESPUÉS de verificar que ningún plan quedó sin su miniatura:
--   drop table public.pa_thumbs; drop function public.pa_strip_thumbs(jsonb); drop function public.pa_extract_thumbs(jsonb);
