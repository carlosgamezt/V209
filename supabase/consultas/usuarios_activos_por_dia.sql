-- Usuarios activos por día (SOLO LECTURA; una sola sentencia) para dividir el Egress diario entre las personas que usan Nexa.
-- Usa auth.sessions: mientras la app está abierta renueva la sesión cada hora, así que refreshed_at es un buen indicador de actividad (no cuenta quién abrió y cerró en minutos).
select json_agg(x order by x.dia) as activos_por_dia from (
  select (coalesce(refreshed_at, created_at) at time zone 'America/Guatemala')::date as dia, count(distinct user_id) as usuarios_activos, count(*) as sesiones_renovadas
    from auth.sessions where coalesce(refreshed_at, created_at) > now() - interval '45 days' group by 1
) x;
