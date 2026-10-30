-- Mueve los dos recordatorios diarios a las 8:30 a. m. y la 1:00 p. m. de Guatemala (UTC-6, sin horario de verano).
-- Solo cambia el horario: el comando y el secreto de cada tarea se quedan igual.
select cron.alter_job(1, schedule := '30 14 * * *'); -- 8:30 a. m.  (slot "am")
select cron.alter_job(2, schedule := '0 19 * * *');  -- 1:00 p. m.  (slot "pm")
-- Verificación:
select jobid, schedule from cron.job order by jobid;
