-- Rotación del secreto, FASE 2: las cuatro tareas de recordatorios-de-nexa pasan a leer el secreto nuevo de la base en cada ejecución (ya no viaja escrito en el comando)
-- y esperan hasta 60 s la respuesta (antes 5 s por defecto). Conserva el horario, la URL y el cuerpo de cada tarea. Si no hay exactamente 4 tareas o el formato es otro, se DESHACE todo.
do $do$
declare j record; u text; b text; n int := 0; nuevo text;
begin
  if to_regclass('public.nexa_cron_secret') is null or not exists (select 1 from public.nexa_cron_secret where id = 1) then
    raise exception 'fase 2 detenida: falta el secreto nuevo (fase 1)';
  end if;
  for j in select jobid, command from cron.job where command like '%functions/v1/recordatorios-de-nexa%' order by jobid loop
    u := substring(j.command from $r$url\s*:=\s*'([^']+)'$r$);
    b := substring(j.command from $r$body\s*:=\s*'(\{[^']*\})'\s*::jsonb$r$);
    if u is null or b is null then raise exception 'fase 2 detenida: formato inesperado en la tarea %', j.jobid; end if;
    nuevo := format($f$select net.http_post(url := %L, headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select valor from public.nexa_cron_secret where id = 1)), body := %L::jsonb, timeout_milliseconds := 60000);$f$, u, b);
    perform cron.alter_job(j.jobid, command := nuevo);
    n := n + 1;
  end loop;
  if n <> 4 then raise exception 'fase 2 DESHECHA: se esperaban 4 tareas y hay %', n; end if;
end $do$;
select json_build_object(
  'paso', 'cron_secret fase 2',
  'tareas', (select json_agg(json_build_object('jobid', jobid, 'nombre', jobname, 'horario', schedule, 'activa', active,
      'secreto_escrito_en_el_comando', command ~ 'x-cron-secret"\s*:\s*"',
      'lee_secreto_de_la_base', command like '%nexa_cron_secret%', 'espera_60s', command like '%timeout_milliseconds := 60000%', 'cuerpo', substring(command from $r$body := '(\{[^']*\})'$r$)) order by jobid)
    from cron.job where command like '%functions/v1/recordatorios-de-nexa%')
) as cron_secret_fase2;
