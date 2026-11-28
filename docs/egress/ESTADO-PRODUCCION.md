# Estado en producción (proyecto «pa carlos») — 28-nov-2026
Aplicado mediante el flujo «Publicar Supabase (SQL y funciones)» (archivos de `supabase/auto/` en `main`), con comprobaciones que detienen o deshacen el paso si algo falla. Los resultados salen del registro público del flujo (solo conteos y huellas).
| Paso | Commit en `main` | Resultado verificado |
|---|---|---|
| **E0** respaldo (`e0_respaldo_pa_docs.sql`) + función `recordatorios-de-nexa` con medición de lectura | a761861 | PostgreSQL 17.11; 1 228 filas de `pa_docs` = 1 228 en el respaldo; **huella idéntica** (`09815505…`); **146 planes y 386 miniaturas en el respaldo** (confirma el conteo real); 14.66 MB; 18 descargas; RLS activa en el respaldo y **0 privilegios** para anon/authenticated; base de 48.9 MB |
| **E1a** vista ligera (`e1a_vista_ligera.sql`) | 4933ad7 | vista con `security_invoker=true`; 1 059 filas en la vista de 1 228 (169 avisos antiguos y leídos omitidos, como midió el usuario); 146 planes sin imágenes; planes **14 114 KB → 324 KB (−97.7 %)**; datos idénticos al respaldo; **0 filas visibles sin sesión** (no elude RLS); 0 disparadores en `pa_docs` |
| **V1** validación con funciones/políticas reales (`v1_validacion_roles.sql`) | 1a73c69 | **55 perfiles reales** (admin, analista, gerencia, comodín ×2, inventarios ×2, rol personalizado, 42 sucursales, 5 supervisores): la vista ligera da **las mismas filas que la tabla en los 55**; se guardó la matriz de escritura de referencia (932 casos perfil × plan); 0 rechazos por WITH CHECK |
| **E1** miniaturas aparte (`e1_miniaturas.sql`) | 9960049 | 386 miniaturas embebidas = 386 llaves distintas = **386 en `pa_thumbs`**; 0 faltantes, 0 distintas; las 386 del respaldo presentes con contenido idéntico; `pa_docs` intacto vs respaldo; **matriz de escritura idéntica a V1 (932 casos, 55 perfiles reales)**; lectura idéntica y sin miniaturas de planes no visibles; 1 disparador; `pa_thumbs` 14.34 MB; base 64.2 MB |
| **E3** guardado parcial (`e3_guardado_parcial.sql`) | ebfc374 | `pa_docs_patch` SECURITY INVOKER, no ejecutable por anon; permisos idénticos a E1 en los 932 casos; edición concurrente sobre un plan real conservada y deshecha; `pa_docs` intacto |
| Archivos `v1_*` y `e1_*` inertes | d16a7bb | el SQL original está en `supabase/propuestas/egress/` y en git; sin efecto en instalaciones nuevas (el repo no contiene el DDL de `pa_docs`, así que no existe instalación desde cero con estos archivos), en recuperación (`E0_recuperacion.sql`) ni en historial (no hay tabla de migraciones) |
| **v515** cliente publicado | 3be8cf2 (merge) | «Publicar Nexa» en verde; `nexa/` idéntico al probado; caché persistente apagada; descarga directa de OneDrive apagada (`PA_CONFIG.odDirect`); guardado parcial activo porque E3 existe; modo ligero activo porque E1 existe |
## Pruebas finales previas a v515 (locales, sobre el código publicado)
Funcional 5 roles × vistas (PC y teléfono) idéntico a v512 con base actual y con E1+E3; recuperación de Realtime 6/6; caché, Arqueos (con/sin E1 y con alias JSON rechazado), descarga (OneDrive apagado por omisión = 23.3 MB como v513; encendido = 0), guardado parcial con/sin E3; SQL 29, RLS reales 15, SQL automáticos 16 — todo verde.
## Pendiente (requiere tu intervención o tiempo)
- **Comprobar ahora en la app (1 min):** con una cuenta de administrador abrir Evidencias: las miniaturas deben verse (E1 ya está activa para v513+). Si no se ven: aplicar `E1_reversion.sql` (los datos siguen embebidos; no se pierde nada).
- **Tareas programadas:** ejecutar `supabase/consultas/probar_tareas_programadas.sql` (sin avisos) o esperar la corrida de las 12:00 UTC; debe indicar `"fuente":"vista ligera"` y ~324 KB.
- **OneDrive:** validar CORS y permisos (consola, `PLAN-V514-Y-VENTANA-E1.md` §1.1) antes de activar `odDirect`.
- **Medición real** en Usage tras 3 días completos (`PROCEDIMIENTO-MEDICION-REAL.md`).
- E2 (opcional) y caché persistente: sin aplicar.

## Preparado y probado en local (NO publicado; pendiente de tu autorización)
- **Recuperación desde E0 que preserva lo legítimo posterior** (`E0_recuperacion.sql`): fusiona los planes indicados (conserva lo actual y agrega solo las claves que faltan), no reinserta filas eliminadas a propósito salvo que se indiquen, no pisa avisos leídos ni planes nuevos. Probado con edición, plan nuevo, plan eliminado, aviso leído, plan vacío y plan con clave borrada.
- **E2** (`auto_e2_compactar.sql`): una transacción que se deshace si la vista ligera cambia (huella idéntica antes/después), si falta una miniatura o si cambia quién puede escribir. Ahorro medido (PG, 200 planes × 8 miniaturas): `pa_docs` 48 MB → 184 KB, lectura de la vista 93 → 37 ms; **Egress adicional: 0** para clientes v513+ (la vista ya omite las miniaturas). En producción `pa_docs` bajaría de 19.3 MB a unos 5 MB. Se aplicaría solo con tu autorización.
- **Caché persistente** (apagada): validada además con permisos revocados (el plan que deja de ser visible desaparece de la pantalla y de la copia local) y con cambio de rol (copia rehecha).
- **Descarga directa de OneDrive:** ver `ONEDRIVE-DESCARGA-DIRECTA.md` (enlace vencido probado).
- **Auditoría de Edge Functions:** `arqueos` y `supervision-sucursal` leen filas puntuales o tablas pequeñas (sin hallazgos); `recordatorios-de-nexa` ya lee la vista ligera; `super-api` sin acceso.

## Actualización 28-nov-2026 (tareas programadas y seguridad) — REAL en producción
| Paso | Commit | Resultado verificado |
|---|---|---|
| Rotación del `x-cron-secret`, fase 1 (`cron_secret_fase1.sql`) | 6951ba6 | secreto de 64 caracteres generado por PostgreSQL en `nexa_cron_secret` (RLS activa, sin acceso para anon/authenticated); `nexa_cron_check` solo ejecutable por `service_role`; el valor nunca se escribió en repositorio, conversación ni registros |
| Lectura mínima (`recordatorios_lectura_minima.sql`) + función con doble verificación | 6951ba6 | `nexa_recordatorios_planes(modo)` solo ejecutable por `service_role`; misma huella de avisos/contadores que la vista ligera en los 3 modos |
| Fase 2 (`cron_secret_fase2.sql`) + función final | c357038 | 4 tareas (ids 1, 2, 5, 6) con el **mismo horario y cuerpo**, secreto ya no escrito en el comando (lo lee de la base en cada corrida) y `timeout_milliseconds := 60000`; la función ya no acepta el `CRON_SECRET` anterior; secreto falso → 401; 0 ejecuciones duplicadas en 24 h |
**Lectura por corrida (medida en producción, modo seco):** badge y «sin leer» 295 KB → **18 KB** (27 planes en vez de 146); recordatorio diario 295 KB → **1 KB** (3 planes). Al día (56 badge + 13 «sin leer» + 2 diarios) ≈ 21 MB → ≈ 1.2 MB entre PostgreSQL y la función. Además los usuarios ya no se descargan completos (solo rol, región, sucursal y asignaciones) y el recordatorio diario ya no lee configuración ni descargas.
**Qué cuenta como qué:** ese ahorro es tráfico INTERNO PostgreSQL → Edge Function (no es el Egress contabilizado de Supabase, que mide lo que sale hacia internet; que el interno cuente es un dato no confirmado). Las respuestas de la función a `pg_net` son de pocos bytes. El Egress contabilizado depende de los clientes (v513+/v515) y de las descargas de evidencias.
**Pendiente del usuario:** quitar la variable `CRON_SECRET` de los secretos de la función (ya no se usa) y no reutilizar el valor expuesto.
**E2 NO aplicada (condiciones no verificables):** no hay forma de comprobar desde la base qué versiones de la app siguen activas (E2 dejaría sin miniaturas a un cliente v512 que lea la tabla) ni el código de `super-api` (si lee `pa_docs` con miniaturas); además no reduce el Egress. `auto_e2_compactar.sql` quedó reforzada (respaldo actualizado `pa_docs_respaldo_e2`, políticas RLS y `updated_at` idénticos, reversión comprobada dentro de la transacción) y probada localmente: se aplica en cuanto se confirme 24 h sin v512 (consulta de registros de la API del procedimiento) y se revise `super-api`.

## Auditoría final (28-nov) — qué queda y por qué
| Área | Conclusión (con datos) |
|---|---|
| Tareas programadas / Edge Functions | Hecho y verificado en producción (lectura mínima 295 → 18/1 KB; secreto en la base; 60 s). `arqueos` y `supervision-sucursal`: sin lecturas pesadas pendientes. `super-api`: su código no está en ningún repositorio autorizado (instrucciones en `ACTIVACION-Y-RETIRO.md` §1) |
| Dashboard e indicadores | Se calculan en el equipo con los planes ya cargados (0 consultas extra). Pasarlos a PostgreSQL solo ahorra bytes cuando los planes superen ~1 500 (≈ 3 MB por inicio de administrador); con la caché persistente activada el inicio baja a ~13 KB, que resuelve lo mismo sin rediseño visible → **no se justifica ahora** |
| Paginación | Cambiaría la interfaz; con la vista ligera (≈ 2.2 KB por plan) y la caché el costo es incremental. Se reevalúa si la medición real de Usage lo pide |
| Arqueos / Supervisión mensual | Listado incremental con firmas (Arqueos) y sondeo cada 60 s solo con la pantalla abierta, con puerta entre pestañas (Supervisión); sin trabajo pendiente |
| Notificaciones / Realtime | La vista omite avisos antiguos leídos; Realtime sin cambios de payload (eventos «ligeros» no ahorran: cada cliente debe volver a leer la fila) y con recuperación automática probada |
| Autenticación | Una renovación de token por hora y por sesión; `Supa.session()` es local; sin consultas repetidas |
| Service Worker | Solo archivos propios (la app, librería, íconos); no intercepta datos ni fotos; no afecta al Egress de Supabase |
| Consultas y guardado | Listados incrementales por `updated_at`; guardado parcial con E3 (probado concurrencia); miniaturas bajo demanda |
**Conclusión:** no queda ninguna optimización de Egress técnicamente justificada sin implementar; lo que falta es **activar** (caché persistente, descarga/subida directa de OneDrive) y **medir** en Usage. E2 reduce tamaño de base, no Egress.

## 28-nov (tarde): v517, autorización de fotos y fotos de planes con espacios
| Paso | Resultado |
|---|---|
| v517 publicada (`e5a9736`): OneDrive directo y caché solo administrador | Flujo en verde; `nexa/` idéntico al candidato 96f5c8c (24 de 24 pruebas); CORS real validado por el usuario (descarga 200, subida 201) |
| Auditoría de nombres de foto en producción | 386 claves: 190 evidencias + 196 referencias, todas con clase; 3 evidencias de planes automáticos con espacios en el número no se reconocerían al obligar la autorización con la lógica actual |
| Intento de publicar la corrección SQL `abb824e` (`9c3e8cb`) | **Falló por tiempo (statement timeout) y se deshizo sola: producción sin cambios.** Causa: búsqueda por número saneado con barrido y RLS por fila repetida miles de veces |
| Solución elegida | `super-api` resuelve el número REAL del plan (consulta del servidor, solo ids) y la función SQL ya desplegada recibe número y clave exactos. Verificado en producción con la función desplegada: **386/386 fotos reconocidas, 190 evidencias con plan único, 0 ambiguas** (`verificar_fotos_funcion.sql`). Permisos sin ampliar: el SQL de permisos no cambia |
| Pendiente de autorización | Publicar: restaurar `supabase/auto/super_api_funciones.sql` a su versión probada (en `main` quedó la versión pesada del intento, inerte salvo que se vuelva a ejecutar) y desplegar `super-api` con la resolución. `PHOTO_AUTH` sigue en modo registro |
