/* Conexión de la app con Supabase. La clave "publishable" está pensada para ir aquí: NO es secreta
   (la seguridad la dan las reglas de la base de datos). NUNCA pegues aquí la clave "secret". */
window.PA_CONFIG = {
  url: 'https://znicbyzszdztwyecydbl.supabase.co',
  key: 'sb_publishable_dCjC4ID4-ma2fk7G5wN3YA_G7j99weg',
  /* Activación progresiva (v517), SOLO administrador. Reversión: poner odDirect:false y cache:false (y publicar). Cada equipo se autoprotege 24 h tras un fallo. */
  odDirect: 'admin',      /* descarga y subida directas de fotos con OneDrive (alternativa automática por la función) */
  cache: true,            /* copia local de planes (modo sesión: se borra al cerrar sesión) */
  cacheRoles: ['admin']   /* la copia solo para este rol */
};
