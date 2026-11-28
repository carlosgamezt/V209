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
12. **Tareas programadas y funciones**: leer vistas ligeras con columnas mínimas, medir y registrar lo que leen cada corrida y no regresar en silencio a la consulta pesada.
13. **Independencia entre módulos y arquitectura multiempresa**: cada módulo con sus esquemas, permisos y contrato de API propios; `empresa_id` y membresías desde el inicio; sin tablas compartidas entre módulos; el núcleo común (identidad, empresas, planes) se consulta por API estable.
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

## 5. Despliegue seguro de migraciones (aprendido en esta intervención)
Respaldo exacto con huella → vista/migración aditiva en una transacción con **comprobaciones con los perfiles y funciones RLS reales** (lectura, escritura, miniaturas visibles) que la deshacen por completo si algo difiere → resultado (conteos y huellas) en el registro → reversión independiente → higiene del archivo aplicado. Nada se aplica sin respaldo ni validación con los perfiles reales.
## 6. Caché persistente en equipos compartidos
Apagada por omisión. Modo `true` (recomendado en equipos compartidos): se borra al cerrar sesión por cualquier motivo (voluntario, inactividad o vencimiento); modo `dispositivo`: solo al cierre voluntario. En ambos: una entrada por persona, se anula al cambiar de perfil, rol, región o sucursal (incluye pérdida de permisos) y se eliminan las copias de otras personas al entrar una nueva.

## 7. Principio de transferencia directa de archivos (obligatorio para NEXA, FEL, Hotel, POS, Colegios y módulos futuros)
1. **El backend autoriza; el almacenamiento transfiere.** Supabase (o la función de servidor) decide *quién* puede leer/escribir *qué ruta* y entrega una credencial **temporal y acotada a esa ruta** (enlace de descarga ~1 h; sesión de carga de OneDrive). Los bytes del archivo viajan entre el dispositivo y OneDrive, nunca por Supabase, siempre que sea técnicamente viable.
2. **Nunca** enlaces públicos permanentes, tokens/credenciales de OneDrive en el cliente ni enlaces guardados en BD/almacenamiento local: solo en memoria, con vencimiento. Peticiones directas sin cookies, sin `Authorization` y sin referente.
3. **Alternativa segura obligatoria:** si el almacenamiento no responde con CORS, el enlace vence, hay corte de red o el dispositivo no lo soporta, se usa el camino por función exactamente como antes (sin pérdida de calidad, formato ni permisos), y el fallo se recuerda 24 h para no reintentar en cada archivo. Interruptor de apagado por configuración (`PA_CFG.odDirect`).
4. **Generación local:** ZIP y PDF se arman en el dispositivo (ZIP con los bytes ya descargados; PDF con impresión del navegador) cuando es eficiente y compatible con móvil; no se crean en servidor salvo que el dispositivo no pueda.
5. **Medir de verdad:** cada optimización se prueba contando los bytes que realmente atraviesan Supabase (función y REST) frente a los que van al almacenamiento (`descarga_test.cjs`, `subida_test.cjs`); no basta con que cambie el mecanismo. Meta: 0 MB de archivos por Supabase con almacenamiento compatible.
6. **Antes de activar en producción:** validar CORS real del almacenamiento (fragmento de `PLAN-V514-Y-VENTANA-E1.md` §1.1), que la función solo emita enlaces tras comprobar sesión/permiso, y revisar la CSP (`connect-src`) si pasa de «solo informe» a obligatoria.
