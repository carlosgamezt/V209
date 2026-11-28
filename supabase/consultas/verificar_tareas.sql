-- Verificación de solo lectura de las tareas programadas: estado de los comandos (sin mostrar secretos), últimas respuestas, ejecuciones duplicadas y resumen de 24 h.
select json_build_object(
  'ahora_utc', now(),
  'secreto_fase1', json_build_object('guardado', exists (select 1 from public.nexa_cron_secret where id = 1), 'longitud', (select length(valor) from public.nexa_cron_secret where id = 1)),
  'tareas', (select json_agg(json_build_object('jobid', jobid, 'nombre', jobname, 'horario', schedule, 'activa', active,
      'secreto_escrito', command ~ 'x-cron-secret"\s*:\s*"', 'lee_base', command like '%nexa_cron_secret%', 'espera_60s', command like '%timeout_milliseconds := 60000%') order by jobid)
    from cron.job where command like '%recordatorios-de-nexa%'),
  'respuestas', (select json_agg(r) from (select id, status_code, timed_out, left(error_msg, 60) as error, created,
      case when content like '{%' then content::jsonb -> 'lectura' end as lectura,
      case when content like '{%' then md5((content::jsonb -> 'usuarios')::text) end as huella_usuarios,
      case when content like '{%' then content::jsonb ->> 'total' end as total
    from net._http_response order by id desc limit 8) r),
  'resumen_24h', (select json_agg(t) from (select status_code, timed_out, count(*) as n from net._http_response where created > now() - interval '24 hours' group by 1, 2 order by 3 desc) t),
  'resumen_1h', (select json_agg(t) from (select status_code, timed_out, count(*) as n from net._http_response where created > now() - interval '1 hour' group by 1, 2 order by 3 desc) t),
  'ejecuciones_duplicadas_24h', (select count(*) from (select jobid, date_trunc('minute', start_time) as m from cron.job_run_details where start_time > now() - interval '24 hours' group by 1, 2 having count(*) > 1) d),
  'ultimas_ejecuciones', (select json_agg(x) from (select jobid, status, left(return_message, 60) as mensaje, start_time from cron.job_run_details order by runid desc limit 6) x)
) as verificacion;
