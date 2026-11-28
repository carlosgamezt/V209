-- PRUEBA SEGURA de las tareas programadas (la ejecuta la persona en el SQL Editor; NO se envía ningún aviso): lanza UNA corrida en modo «dry» de nexa-badge (espera hasta 60 s) y, ~30 s después, muestra de dónde leyó los planes y cuántos KB.
-- Paso 1: pegar y ejecutar este bloque (no devuelve filas).
do $do$
declare c text;
begin
  select replace(command, $a$'{"mode":"badge"}'::jsonb$a$, $b$'{"mode":"badge","dry":true}'::jsonb, timeout_milliseconds := 60000$b$) into c from cron.job where jobname = 'nexa-badge';
  if c is null or c not like '%"dry":true%' then raise exception 'No se encontró el comando esperado de nexa-badge'; end if;
  execute c;
end $do$;
-- Paso 2 (esperar ~30 s), en una consulta aparte: debe decir "fuente":"vista ligera" y kb_planes ≈ 324 (antes de E1a: "tabla" y ≈ 14 000).
-- select id, status_code, timed_out, error_msg, case when content like '{%' then (content::jsonb -> 'lectura') end as lectura, created from net._http_response order by id desc limit 3;
