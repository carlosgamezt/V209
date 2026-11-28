-- Reversión de E1a: retira la vista (la función programada vuelve a leer la tabla; no se pierde nada). No toques pa_strip_thumbs si ya aplicaste E1 completa.
drop view if exists public.pa_docs_lite;
drop function if exists public.pa_strip_thumbs(jsonb);
