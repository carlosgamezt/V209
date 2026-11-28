-- Prueba de humo de super-api tras publicarla (sin sesion de nadie): 3 peticiones. Deben responder 401 «Inicia sesion para continuar» (sin sesion), 403 «Clave de configuracion incorrecta» (accion setup sin clave) y 401 (token falso).
-- Si la puerta exigiera JWT (verify_jwt = true) las respuestas serian distintas; asi se confirma que quedo apagada igual que antes.
select
  net.http_post(url := 'https://znicbyzszdztwyecydbl.supabase.co/functions/v1/super-api', headers := '{"Content-Type":"application/json"}'::jsonb, body := '{"action":"status"}'::jsonb, timeout_milliseconds := 30000) as sin_sesion,
  net.http_post(url := 'https://znicbyzszdztwyecydbl.supabase.co/functions/v1/super-api', headers := '{"Content-Type":"application/json"}'::jsonb, body := '{"action":"setup","setupKey":"x"}'::jsonb, timeout_milliseconds := 30000) as setup_sin_clave,
  net.http_post(url := 'https://znicbyzszdztwyecydbl.supabase.co/functions/v1/super-api', headers := '{"Content-Type":"application/json","Authorization":"Bearer token-falso"}'::jsonb, body := '{"action":"get","name":"abc.jpg"}'::jsonb, timeout_milliseconds := 30000) as token_falso;
