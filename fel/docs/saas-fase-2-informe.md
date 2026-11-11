# Fase 2 — informe técnico: flujo individual de facturación en simulación

Rama `fel-proveedores-diseno`. **Todo en simulación local: sin credenciales, sin conexión a SAT ni a certificadores, sin emitir, sin Digifact, sin tocar `main` ni `fel/poc-sat/`.** Playwright sigue siendo la prioridad para la futura integración con SAT (Fase 3 en adelante; ver `saas-plan-implementacion.md`).

## 1. Qué se construyó

| Pieza | Dónde | Qué hace |
|---|---|---|
| Migración multiempresa y de flujo | `supabase/migrations/20261111000100_fel_proveedores_flujo.sql` | Establecimientos, canales (solo los simulados pueden habilitarse), eventos del proveedor (solo inserción), conciliaciones de dos personas, alertas de certificación huérfana, artefactos PDF/XML (solo inserción, hash verificado por la base), parámetros de plataforma, permisos nuevos, RLS por empresa y funciones `fel_op_*` / `fel_sys_*` |
| Orquestador sobre la base | `proveedores/src/orquestador_db.ts` | Solicitar → marcar envío → enviar una vez → registrar evento → resolver; conciliación; recuperación tras caídas; auditoría de respuestas tardías; artefactos; canal asistido |
| Puertos de base de datos | `proveedores/src/rpc.ts`, `repo_pg.ts` | Misma interfaz para PostgreSQL directo (pruebas) y, más adelante, supabase-js |
| Demostración funcional | `demo-facturacion/` | Servidor local (Deno) + interfaz web; PostgreSQL real en memoria (PGlite) con las **mismas migraciones**, el orquestador real y el proveedor simulado |
| Pruebas | `supabase/tests/15_*.sql`, `concurrencia.sh`, `proveedores/pruebas_db/`, `demo-facturacion/tests/e2e.cjs` | Ver §3 |
| CI | `.github/workflows/fel-tests.yml` | Los tres grupos de pruebas nuevos se ejecutan en los trabajos existentes; no se quitó ningún paso |

## 2. Decisiones de diseño y propiedades que se cumplen
1. **Persistir antes de enviar, marcar antes de salir.** La operación se guarda (misma transacción que el estado `pendiente_certificacion`) y el envío se marca en otra transacción antes de llamar al proveedor. Si el proceso muere sin marca, la recuperación **prueba** que nada salió; con marca, se asume que pudo salir y se concilia.
2. **Un solo envío por operación.** La marca falla la segunda vez (`FEL_YA_ENVIADA`); además una operación abierta por documento (índice único parcial + bloqueo de fila) y una clave de idempotencia por documento.
3. **Lo desconocido bloquea.** `por_verificar` impide cualquier operación nueva, con la misma clave o con otra.
4. **Marcar «fallida» no libera.** La resolución genérica rechaza toda certificación. Solo libera un **evento verificable del proveedor** o una **conciliación manual** propuesta, esperada, evidenciada y **aprobada por otra persona**, con ventana de respuestas tardías y auditoría posterior; si el proveedor certifica tarde, nace una **alerta bloqueante**.
5. **El hash lo calcula la base** sobre el contenido congelado; un hash inventado se rechaza. El contenido (incluido el establecimiento) es inmutable tras revisar.
6. **Simulación y realidad no se mezclan.** Las autorizaciones simuladas llevan el prefijo `SIM-` y las demás no pueden llevarlo; los canales no simulados no pueden habilitarse (restricción de tabla).
7. **Aislamiento por empresa** en todas las tablas nuevas (RLS), funciones con comprobación de permiso y pertenencia, sin lectura de los bytes de los archivos para los roles de la app, y sin acceso del administrador maestro a datos de negocio.

## 3. Pruebas y resultados (ejecutadas localmente)

| Batería | Resultado |
|---|---|
| Pruebas SQL (migraciones, RLS, estados, privilegios, etc.) + `15_proveedores_flujo.sql` | todas en verde (`TODO OK`) |
| Concurrencia con dos sesiones reales (incluye 5 casos nuevos: solicitudes simultáneas, un solo envío, propuesta y aprobación únicas, carrera proveedor vs conciliación manual) | verde |
| Orquestador contra PostgreSQL real (`pruebas_db/`) | **18/18**: flujo completo, rechazo, aislamiento, solicitudes simultáneas, desconocidos y reintentos, conciliación del proveedor, caídas antes de marcar / tras marcar / tras enviar / tras registrar, respuestas tardías, conciliación manual de dos personas, ventana de espera, canal asistido, respuesta sospechosa, recuperación acotada por empresa y **prueba de propiedades** (1000 acciones aleatorias, 127 caídas simuladas, proveedor sin deduplicación: nunca más de una certificación por documento) |
| Fase 1 (interfaz, mock, orquestador de referencia, propiedades) | 30/30 |
| Demostración de extremo a extremo en navegador (`e2e.cjs`) | OK: validaciones, líneas, vista previa, estados, descargas con marca de simulación, doble clic, conciliación de dos personas, alerta huérfana, caídas con recuperación, canal asistido, móvil sin desborde y consola sin errores |
| Comprobación de tipos (`deno check`) | OK |
| Mutaciones | Se rompieron a propósito 6 reglas de la base (envío repetible, sin bloqueo `por_verificar`, indeterminado que libera, misma persona aprueba, sin bloqueo por alertas, sin ventana de reintento) y **las 6 hicieron fallar las pruebas** (una sobrevivió la primera vez y se añadió la prueba que faltaba) |

### Cambios a pruebas existentes (endurecimiento intencional)
`04_estados_fiscales.sql`: las líneas que marcaban una certificación como fallida o exitosa «por palabra de usuario» ahora **deben fallar**, y el flujo se reproduce por la vía verificable. No se debilitó ninguna aserción: se sustituyeron por su versión más estricta.

### Hallazgos durante el desarrollo (todos corregidos)
- El mock lanzaba una excepción síncrona en lugar de una promesa rechazada (incumplía el contrato).
- `fel_op_documento_establecimiento` permitía tocar un documento ya revisado (aunque sin cambiar el valor); ahora solo actúa sobre borradores sin vida fiscal.
- La ventana de auditoría de respuestas tardías dependía por error de la ventana de espera de reintento; ahora tiene parámetro propio.
- Un helper de pruebas pisaba el parámetro de auditoría (la prueba de propiedades lo detectó como alerta ausente).
- En una base compartida (la de CI con restos de la prueba de concurrencia) la recuperación barría operaciones pendientes de otras empresas y las pruebas contaban resultados ajenos; ahora `recuperar`/`auditarFallidas`/`completarArtefactos` admiten un ámbito `empresaId` (un trabajo por empresa) y hay una prueba de regresión. No se debilitó ninguna aserción.
- Los tiempos de eventos y resoluciones usaban el reloj de la transacción; ahora usan reloj real para que el orden entre ellos sea verificable.

## 3b. Interfaz según las referencias (paneles)
Se aplicó la estructura de las referencias aprobadas: menú lateral, barra superior con empresa, campana y persona, **Nueva factura en 3 pasos** con resumen, **Clientes**, **Conceptos**, **Configuración FEL** con pestañas y **vista previa** con la estructura más completa (la de emisor con correo, observaciones y hora/referencia; texto corregido). Duplicado detectado: las dos «Vista previa». Cambios deliberados frente a la referencia: sin credenciales ni «Conectado a SAT» (D2), envío rotulado como simulado, selector de establecimiento obligatorio y solo base imponible (impuestos pendientes). Pendiente: importación masiva de clientes, edición de datos de la empresa y numeración configurable.

## 3c. Ajustes de interfaz posteriores
Sin tocar Nueva factura ni su vista previa, el orquestador ni las reglas anti-duplicados. Migración aditiva `20261111000200`: datos de contacto de la empresa (`fel_op_empresa_datos_guardar`, permiso `empresa.editar`, razón social/NIT/régimen intactos) y marca de cliente frecuente por empresa (`fel_op_cliente_frecuente`, no cambia la versión del cliente). Pruebas: `16_ajustes_configuracion.sql` (permisos, aislamiento entre empresas, auditoría, validaciones, canales reales bloqueados; 3 mutaciones detectadas) y la prueba de extremo a extremo ampliada (facturas, clientes, conceptos, empresa, canales y agente). Pendiente: agente local real (Fase 4), numeración configurable, importación masiva.

## 4. Seguridad de la demostración
Solo escucha en `127.0.0.1` y rechaza otros `Host` (contra DNS rebinding); las operaciones de escritura exigen una cabecera propia de la demostración; CSP restrictiva; todo texto de usuario se inserta como texto (nunca HTML); los errores internos no se muestran; los archivos descargados llevan la marca de simulación y `nosniff`. No hay autenticación real: la «persona» se elige en pantalla **solo para demostrar permisos y la regla de dos personas**.

## 5. Limitaciones y pendientes para la Fase 3
1. **No hay API de producción para este flujo.** La demostración usa un servidor propio; el flujo aún no está expuesto en la Edge Function `fel-api` (hay que añadir las acciones y su matriz de permisos, límites y pruebas de seguridad).
2. **Almacenamiento de archivos:** los bytes viven en la base (`db_simulado`); falta el almacenamiento privado por empresa con URL firmadas y retención.
3. **Credenciales y firma** (D4/D5): sin diseño de custodia implementado; el mock no las necesita.
4. **El proveedor simulado no es un proveedor real:** reproduce lo que declaramos; no descubre comportamientos reales de SAT ni de certificadores.
5. **Impuestos, total y NIT oficial** siguen pendientes de reglas verificadas; la validación es estructural.
6. **La recuperación se dispara a mano** (botón/comando); falta el trabajo programado, su monitoreo y alertas.
7. **Concurrencia con PGlite:** la demostración usa una sola conexión; la concurrencia real se prueba con PostgreSQL y dos sesiones (SQL y orquestador), no con la demostración.
8. **Windows:** la demostración está probada en Linux con Chromium; en Windows se espera que funcione (Deno y PGlite lo soportan) pero no se ha probado.
9. **Fase 3 (Playwright):** reutilizar `fel/poc-sat/` sin modificarlo como adaptador `portal_playwright` que devuelva `requiere_accion_humana` tras el llenado (decisión D3), aplicando la suite de contrato y probando contra el simulador local; sigue bloqueada la ejecución real hasta aclarar permisos y condiciones de SAT (B1, O-1/O-2/O-3).
10. **Fase 4:** agente local para Windows con inicio de sesión manual, sin contraseñas almacenadas, cola con arrendamiento y *fencing*.

## 6. Cómo reproducir
`bash fel/tools/test-local.sh` (SQL y concurrencia), `bash fel/tools/test-flujo-local.sh` (orquestador contra PostgreSQL temporal), `cd fel/demo-facturacion && deno task demo` (demostración) y `node fel/demo-facturacion/tests/e2e.cjs` (extremo a extremo). Detalle en `fel/demo-facturacion/README.md`.
