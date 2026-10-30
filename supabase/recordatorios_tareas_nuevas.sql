-- Dos tareas nuevas para la función recordatorios-de-nexa. Copian el comando de la tarea 1 (con su secreto), así NO hay que escribir ningún secreto.
-- 1) Planes que la sucursal no ha abierto (4, 8 y 12 horas después): cada hora de 7 a. m. a 7 p. m. hora de Guatemala.
select cron.schedule('nexa-sin-leer', '0 13-23,0,1 * * *',
  replace((select command from cron.job where jobid = 1), '{"slot":"am"}', '{"mode":"unread"}'));
-- 2) Reponer el aviso fijo y el numerito del ícono si se borró: cada 15 minutos de 6 a. m. a 8 p. m. hora de Guatemala.
select cron.schedule('nexa-badge', '*/15 12-23,0-1 * * *',
  replace((select command from cron.job where jobid = 1), '{"slot":"am"}', '{"mode":"badge"}'));
-- Verificación:
select jobid, jobname, schedule from cron.job order by jobid;
