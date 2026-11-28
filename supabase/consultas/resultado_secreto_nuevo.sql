-- Lee las ultimas 7 respuestas de probar_secreto_nuevo.sql: estado, de donde leyo los planes y huella (md5) de los avisos/contadores calculados, para comparar lectura minima y vista ligera sin mostrar datos de personas.
select r.id, r.status_code, r.timed_out, left(r.error_msg, 60) as error,
  case when r.content like '{%' then r.content::jsonb -> 'lectura' end as lectura,
  case when r.content like '{%' then r.content::jsonb ->> 'total' end as total,
  case when r.content like '{%' then md5(coalesce((r.content::jsonb -> 'usuarios')::text, '') || coalesce((r.content::jsonb -> 'avisos')::text, '')) end as huella_resultado,
  case when r.content like '{%' then r.content::jsonb ->> 'error' end as mensaje
from net._http_response r order by r.id desc limit 7;
