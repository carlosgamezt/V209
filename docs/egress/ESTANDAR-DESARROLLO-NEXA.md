# Estándar obligatorio de desarrollo de NEXA (derivado de la optimización de Egress)
Aplica a NEXA principal y, sin modificarlos ahora, a NEXA FEL, POS, Hotel, inventarios y cualquier módulo nuevo.
## 1. Principios
1. **Pedir solo lo necesario, cuando se necesita.** Ninguna pantalla descarga datos que no muestra; ningún módulo inactivo consulta.
2. **Lo que no cambió no se vuelve a descargar.** Sincronización incremental (`updated_at > último`), firmas de cambio baratas (conteo + última modificación) y caché con invalidación.
3. **Un contador no es una lista.** Contadores e indicadores se calculan en PostgreSQL (RPC/vista agregada), nunca descargando registros para contarlos.
4. **Las imágenes y documentos no viajan dentro de registros.** Nunca Base64 en JSON de tablas que se listan; miniaturas aparte y bajo demanda; originales directo del almacenamiento (sin pasar por funciones de Supabase).
5. **Sin `select *` en código de producción.** Columnas explícitas; el cuerpo pesado (`data`) se pide al abrir el detalle.
6. **Sin sondeo si hay Realtime.** El respaldo por sondeo solo cuando Realtime está caído, siempre incremental, y nunca en segundo plano.
7. **Las funciones programadas leen vistas ligeras**, no tablas con cuerpos pesados; su frecuencia es un compromiso de negocio y no se cambia sin análisis funcional.
8. **Seguridad en el servidor.** Las políticas RLS deciden todo; las vistas son `security_invoker`; nada se filtra en el navegador; ninguna optimización amplía permisos.
9. **Compatibilidad hacia atrás.** Toda migración se aplica con clientes antiguos activos: no pierde datos, no pisa evidencias y se prueba con el cliente anterior.
10. **Toda migración es aditiva, idempotente, con respaldo previo y reversión independiente** (y se prueba la recuperación, no solo el respaldo).
11. **Todo ahorro se mide** (banco de pruebas con datos equivalentes) y se confirma en Supabase real antes de declararlo.
## 2. Reglas de implementación
- Diseño de datos: separar metadatos livianos de cuerpos pesados; claves estables (`k`) para recursos externos; ninguna columna JSON con binarios.
- Consultas: paginación o conjunto de trabajo con totales; filtros en la base; índices revisados con `EXPLAIN` para los filtros usados; límites explícitos.
- Escrituras: cambios puntuales (RPC de parche) en lugar de reemplazar el registro completo cuando varias personas editan; hora del servidor para el control de cambios.
- Realtime: una suscripción por tabla y sesión; recuperación ante caída (estado del canal, resincronización completa al volver); eventos con la fila ya ligera.
- Caché: por persona y perfil; se anula al cambiar de perfil o persona; se borra al cerrar sesión (la retención tras inactividad es una decisión explícita de seguridad); detección de borrados y de cambios de visibilidad (conteo + listado completo periódico).
- Varias pestañas: una sola consulta periódica (puerta compartida) y aviso entre pestañas solo cuando hubo cambios.
- Archivos: descarga directa del almacenamiento con retroceso a la función; no reintentar tras fallo (memoria).
- Autenticación: sin llamadas redundantes; las sesiones y la renovación las gestiona el cliente oficial.
- Observabilidad: baliza de versión en `X-Client-Info`; consulta mensual de Usage por servicio; alertas de crecimiento.
## 3. Lista de verificación antes de publicar un cambio
- [ ] ¿Qué solicitudes hace cada pantalla y cuántos bytes? (banco de pruebas, antes y después)
- [ ] ¿Algún `select *`, Base64 en tabla, sondeo fijo o función programada que lea cuerpos pesados?
- [ ] ¿Funciona igual para todos los roles reales (prueba con las políticas RLS reales)?
- [ ] ¿Funciona con el cliente anterior y con la migración aplicada y sin aplicar?
- [ ] ¿Respaldo verificado, reversión probada y recuperación probada?
- [ ] ¿Pruebas de recuperación de conexión, concurrencia y dos pestañas?
- [ ] ¿Qué se mide en Supabase real después y qué cifra se espera?
## 4. Pruebas obligatorias (plantillas en `pruebas/egress/`)
Funcional comparativa por rol (`funcional.cjs`), recuperación de Realtime (`recuperacion.cjs`), caché (`cache_test.cjs`), listados incrementales (`arqueos_test.cjs`), descargas (`descarga_test.cjs`), guardado parcial (`parcial_test.cjs`), matriz de consumo (`escala.cjs`), SQL real con RLS reales (`test_rls_real.sh`, `test_sql.sh`) y mutaciones sobre cada regla nueva.
