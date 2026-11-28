-- PRUEBA SEGURA de las tareas programadas (la ejecuta la persona en el SQL Editor; NO se envía ningún aviso): lanza UNA corrida en modo «dry» de nexa-badge y, 10 segundos después, muestra de dónde leyó los planes y cuántos KB.
-- Paso 1: pegar y ejecutar este bloque (no devuelve filas).
do $$
declare c text;
begin
  select replace(command, '{"mode":"badge"}', '{"mode":"badge","dry":true}') into c from cron.job where jobname = 'nexa-badge';
  if c is null or c not like '%"dry":true%' then raise exception 'No se encontró el comando esperado de nexa-badge'; end if;
  execute 'select 1 from (' || c || ') t';
end $$;
-- Paso 2 (10 segundos después), en una consulta aparte: debe decir "fuente":"vista ligera" y kb_planes ≈ 324 (antes de E1a: "tabla" y ≈ 14 000).
-- select id, status_code, (content::jsonb -> 'lectura') as lectura, created from net._http_response order by id desc limit 3;
