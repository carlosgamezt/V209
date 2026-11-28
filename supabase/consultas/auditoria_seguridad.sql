-- Auditoria de solo lectura SIN mostrar valores: (1) que tareas programadas existen y si alguna conserva una cabecera de secreto escrita; (2) si algun registro de usuarios o de configuracion guarda claves con nombre de credencial (solo conteos y nombres de campo).
select json_build_object(
  'tareas_programadas', (select json_agg(json_build_object('jobid', jobid, 'nombre', jobname, 'horario', schedule, 'activa', active,
      'funcion', substring(command from 'functions/v1/([a-zA-Z0-9_-]+)'), 'usa_cabecera_secreto', command ~* 'x-cron-secret', 'secreto_escrito', command ~ 'x-cron-secret"\s*:\s*"') order by jobid) from cron.job),
  'usuarios', (select json_build_object('total', count(*), 'con_campos_de_credencial', count(*) filter (where data ?| array['pw', 'pass', 'password', 'token', 'secret', 'clave'])) from public.pa_docs where col = 'users'),
  'configuracion_con_nombres_sospechosos', (select json_agg(json_build_object('id', id, 'campos', (select json_agg(k) from jsonb_object_keys(data) k where k ~* '(secret|token|key|pass|pw|pwd|smtp|clave|cred)')))
    from public.pa_docs where col = 'meta' and jsonb_typeof(data) = 'object' and exists (select 1 from jsonb_object_keys(data) k where k ~* '(secret|token|key|pass|pw|pwd|smtp|clave|cred)')),
  'ids_de_configuracion', (select json_agg(id order by id) from public.pa_docs where col = 'meta')
) as auditoria;
