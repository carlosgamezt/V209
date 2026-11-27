// Parámetros de plataforma que el SERVIDOR puede entregar a una persona con sesión (clase «usuario» de M-R). Lista EXPLÍCITA: un parámetro nuevo NO sale al cliente hasta que se añada aquí y en `fel__parametro_clase`
// (una prueba exige que ambas listas coincidan). Las clases «empresa» (con permiso), «plataforma» (administrador) e «interno» (umbrales de defensa) no tienen ruta en el servidor de personas.
export const PARAMETROS_USUARIO: readonly string[] = ["espera_conciliacion_manual_min", "ventana_auditoria_min", "ventana_tardia_min", "umbral_recuperacion_min"];
/** Consulta del camino por el pooler; el camino por la Data API aplica la misma lista dentro de la base (`fel__parametros_lista`). */
export const SQL_PARAMETROS_USUARIO = "select clave, valor::text as valor from public.plataforma_parametros where clave = any($1::text[]) order by clave";
