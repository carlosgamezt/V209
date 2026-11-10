// Configuración de la interfaz FEL. Por defecto: modo DEMOSTRACIÓN (datos de ejemplo en memoria, sin red ni credenciales).
// Para el modo real (cuando exista el proyecto Supabase de FEL): { modo: "remoto", supabaseUrl: "https://xxxx.supabase.co", anonKey: "<clave anon>" }
// La clave "anon" es pública por diseño; NUNCA pongas aquí la clave service_role.
window.FEL_CONFIG = { modo: "demo" };
