-- Reversión de E3: retira la función; los clientes que no la encuentren vuelven a guardar la fila completa (comportamiento anterior).
drop function if exists public.pa_docs_patch(text, text, jsonb);
