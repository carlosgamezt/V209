# Incidente intermitente de CI: «failed to bind host port 0.0.0.0:5432x: address already in use»

**Síntoma (visto el 25/11/2026 en 54322 y en 54324):** en los trabajos «Migraciones y RLS» e «Integración con Supabase local real», `supabase start` aplica las migraciones y falla al iniciar un contenedor (inbucket, base de datos…) porque el puerto del anfitrión ya está en uso. Ocurre antes de cualquier prueba; el mismo código pasa al relanzar.

**Alcance:** solo máquinas virtuales de GitHub Actions, desechables y propias de cada trabajo. No involucra contenedores ni recursos de otras sesiones ni del equipo del responsable.

**Causa más probable (no demostrada):** el rango de puertos efímeros de Linux (32768–60999) contiene los puertos de Supabase (54321–54327). Una conexión saliente del ejecutor (p. ej. la descarga de imágenes) puede tomar uno de ellos como puerto de origen justo antes de que el contenedor lo enlace. Es consistente con que cambie de puerto entre ejecuciones y con que el reintento funcione.

**Solución puntual aplicada** (`.github/workflows/fel-tests.yml`, ambos trabajos): (1) acotar el rango efímero a 32768–49999 con `sysctl` en esa máquina; (2) si `supabase start` falla, detener **solo este proyecto** (`supabase stop --no-backup`, que opera sobre sus propios contenedores `nexa-fel`) y reintentar una vez. No se tocan otros contenedores. Si el fallo reaparece pese a esto, la alternativa es asignar puertos propios en `fel/supabase/config.toml` (cambio mayor, no hecho).

**Cómo se sabrá si funcionó:** el mensaje «Primer intento falló; se detiene este proyecto…» aparecerá en el registro cuando el reintento actúe; si deja de aparecer el fallo en las próximas ejecuciones, la causa era el rango efímero. **No es un bloqueo permanente** (un relanzamiento lo supera); no se dedicó más tiempo.
