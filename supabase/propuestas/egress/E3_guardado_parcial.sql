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
