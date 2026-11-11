# NEXA FEL · Matriz de estados (versión 2 · dos ejes)

> Estado: **propuesta para revisión**. Implementada y probada en la rama de desarrollo; nada publicado ni migrado a producción.

## Principio
Un documento tiene **dos estados independientes**, para no confundir lo que NEXA hace internamente con lo que es oficial ante SAT:

| Eje | Columna | Valores | Quién lo cambia |
|---|---|---|---|
| Preparación (interno) | `estado_preparacion` | `borrador`, `revisado`, `archivado` | Usuarios con permiso (`borradores.*`) |
| Fiscal (oficial) | `estado_fiscal` | `ninguno`, `pendiente_certificacion`, `por_verificar`, `certificado`, `rechazado`, `anulacion_solicitada`, `anulado` | **Solo** las funciones fiscales, a partir del resultado de una operación fiscal |

**Archivado ≠ anulado.** *Archivado* es una decisión interna y solo existe si el documento nunca tuvo vida fiscal (`estado_fiscal = ninguno`). *Anulado* es un hecho fiscal posterior a una certificación. Son columnas distintas y la base impide mezclarlas.

## Eje de preparación
| De → A | Permiso | Condiciones |
|---|---|---|
| borrador → revisado | `borradores.revisar` | Tiene cliente y ≥ 1 línea |
| revisado → borrador | `borradores.editar` | Solo si `estado_fiscal = ninguno` |
| borrador / revisado → archivado | `borradores.archivar` | Motivo obligatorio; solo si `estado_fiscal = ninguno` |
| archivado → borrador | `borradores.editar` | Solo si `estado_fiscal = ninguno` |
| rechazado (fiscal) → borrador | — | Únicamente cuando la operación se confirmó como fallida (se resetea el eje fiscal a `ninguno`) |

Con cualquier estado fiscal distinto de `ninguno`, el estado de preparación **no cambia**.

## Eje fiscal
| De → A | Disparador |
|---|---|
| ninguno → pendiente_certificacion | Se inicia una operación de certificación (requiere emisión real habilitada) |
| pendiente_certificacion → certificado | Confirmación verificable del proveedor/SAT con serie, número y autorización |
| pendiente_certificacion → rechazado | Fallo **confirmado** |
| pendiente_certificacion → por_verificar | Resultado **desconocido** (tiempo agotado, corte, respuesta ilegible) |
| por_verificar → certificado / rechazado | Solo por conciliación (proveedor o manual con evidencia) |
| rechazado → pendiente_certificacion | Nuevo intento con **otra** clave de idempotencia, ya confirmado que el anterior no generó DTE |
| rechazado → ninguno | Corrección del documento (vuelve a borrador) |
| certificado → anulacion_solicitada | Se inicia una operación de anulación (requiere reglas de anulación verificadas y vigentes) |
| anulacion_solicitada → anulado | Anulación confirmada |
| anulacion_solicitada → certificado | Solicitud rechazada/fallida confirmada |

Todo lo demás está prohibido por un trigger de la base (no solo por la API). `anulado` es definitivo.

## Un DTE certificado
- No vuelve a borrador, no se archiva y **no se modifica**: contenido, líneas, serie, número y autorización son inmutables (triggers + restricciones).
- Serie, número, autorización y fecha de verificación están **vacíos** salvo `certificado`, `anulacion_solicitada` y `anulado`, y entonces son obligatorios (restricción `documentos_datos_fiscales_chk`).
- Los documentos no se borran.

## Idempotencia y conciliación (tabla `operaciones_fiscales`)
- Cada intento de certificar/anular es una fila con **clave de idempotencia** y **hash SHA-256** del contenido enviado. Misma clave + mismo hash → devuelve la misma operación (no duplica). Misma clave + otro contenido → conflicto.
- **Una sola operación abierta por documento** (`iniciada` o `desconocida`), garantizado por índice único parcial y por bloqueo de la fila del documento: no hay intentos simultáneos.
- **Sin reintentos automáticos.** Si el resultado es desconocido, el documento queda `por_verificar` y la operación `desconocida`; no se permite ninguna operación nueva hasta resolverla. Resolver exige: confirmación del proveedor, o **conciliación manual** con evidencia, permiso aparte (`fiscal.conciliar`) y registro de quién y cuándo.
- Una operación confirmada no se reabre ni se modifica; no se borra.
- Una anulación de resultado desconocido deja el documento en `anulacion_solicitada` (no se asume éxito ni fallo).

## Anulación y reglas versionadas (`reglas_normativas`)
- Las reglas (código `anulacion_dte`) son versionadas e inmutables una vez verificadas. Se siembra la versión 1 **vacía y sin verificar**: mientras no haya una regla verificada y vigente, **no se puede anular nada**.
- Estructura soportada hoy: `plazo_tipo` = `sin_plazo` | `dias_calendario` (+ `dias`) y `requiere_confirmacion_receptor` (booleano). Cualquier otro tipo de plazo se rechaza al verificar: requiere validación y desarrollo manual.
- Hallazgos de la investigación (**NO verificados para 2026; no están implementados como reglas**): según fuentes secundarias (Deloitte Tax Alert 23-14; columna de Prensa Libre), desde 2023-09-01 el plazo de anulación se vincula a la fecha de vencimiento de la declaración mensual del IVA y existiría una confirmación del receptor (~72 h). Debe validarlo tu contador contra la normativa vigente de SAT antes de crear la regla verificada.

## Qué sigue bloqueado
Certificar, anular y conciliar **no están expuestos por la API**. Las funciones SQL existen y están probadas, pero exigen además `emision_real_habilitada` (que a su vez exige empresa habilitada, régimen verificado y autorización específica del administrador maestro), y la Edge Function mantiene bloqueada esa habilitación. No hay automatización del portal SAT ni credenciales SAT.


---

# Versión 3 · Fase 2: operaciones, eventos y conciliación (flujo SIMULADO)

> Estado: implementada y probada en la rama `fel-proveedores-diseno` con el proveedor **simulado**. Nada de esto emite, certifica ni se conecta a SAT. Canales de pruebas y de producción **no pueden habilitarse** (restricción de la tabla `empresa_canales`).

## Los tres niveles de estado
| Nivel | Valores | Quién lo cambia |
|---|---|---|
| Preparación (`documentos.estado_preparacion`) | `borrador`, `revisado`, `archivado` | Personas con permiso (sin cambios respecto a la versión 2) |
| Fiscal (`documentos.estado_fiscal`) | `ninguno`, `pendiente_certificacion`, `por_verificar`, `certificado`, `rechazado`, `anulacion_solicitada`, `anulado` | **Solo** las funciones fiscales |
| Operación (`operaciones_fiscales.estado`) | `iniciada`, `desconocida`, `confirmada_exitosa`, `confirmada_fallida` | Solo las funciones fiscales y del sistema |

## Ciclo de una certificación simulada
| Paso | Quién / función | Efecto en la base | Si el proceso muere aquí |
|---|---|---|---|
| 1. Solicitar | persona con `fiscal.certificar` · `fel_op_certificacion_solicitar` | Operación `iniciada` + documento `pendiente_certificacion` (misma transacción). Exige canal habilitado, establecimiento, hash verificado por la base y ninguna operación abierta, alerta ni `por_verificar` | Queda `iniciada` **sin** marca de envío |
| 2. Marcar envío | sistema · `fel_sys_operacion_marcar_envio` | `enviada_en` (una sola vez: un segundo intento falla con `FEL_YA_ENVIADA`) | Queda `iniciada` **con** marca: se asume que pudo salir |
| 3. Enviar | adaptador del proveedor (sin acceso a la base) | — | Idem |
| 4. Registrar | sistema · `fel_sys_evento_registrar` | Evento verificable (solo inserción) | El proveedor pudo certificar sin que lo sepamos |
| 5. Resolver | sistema · `fel_sys_operacion_resolver_evento` | `certificado` → `confirmada_exitosa`; `rechazado_confirmado` o `no_existe_confirmado` → `confirmada_fallida`; cualquier otro → **no cambia nada** | — |
| 6. Artefactos | sistema · `fel_sys_artefacto_guardar` | PDF y XML (solo inserción, hash verificado) | La recuperación los completa |

## Resultado desconocido (`por_verificar`) y cómo se libera
- `desconocida` ⇒ documento `por_verificar`. **Bloquea** cualquier operación nueva (misma clave o distinta) y ninguna se reenvía automáticamente.
- Se libera **solo** por:
  1. un **evento verificable del proveedor** (conciliación `certificado` o `no_existe_confirmado`), o
  2. una **conciliación manual** que exige: el proveedor ya respondió «indeterminado»; pasó la espera mínima desde el envío; evidencia estructurada (fuente, referencia, fecha posterior al envío, conclusión coherente); la **aprueba otra persona** con `conciliacion.aprobar`.
- Marcar «fallida» (con o sin evidencia) **no libera nada**: `fel_op_operacion_resolver` rechaza cualquier certificación.
- Una conciliación manual «fallida» deja una **ventana de respuestas tardías** y exige una **comprobación posterior del proveedor** antes de cualquier reintento. Si el proveedor certifica después, nace una **alerta de certificación huérfana** que bloquea todo hasta que una persona la resuelva con una nota.
- `rechazado → pendiente_certificacion` con otra clave solo tras la liberación; `rechazado → ninguno` (volver a borrador) con `fel_op_documento_reabrir`.

## Recuperación (sin reenviar nunca)
| Situación al reiniciar | Qué se prueba | Resultado |
|---|---|---|
| `iniciada`, sin marca de envío | Nada salió (la marca precede al envío) | `fel_sys_operacion_no_enviada`: `confirmada_fallida` (resolución `sistema_no_enviada`) |
| `iniciada`, con marca de envío | No se sabe | `desconocida` (`proceso_caido`) → se concilia con el proveedor |
| `desconocida` | Se consulta (solo lectura) | Evento de conciliación → regla anterior |
| `iniciada` con orden asistida | Espera a una persona | No se toca |
| `confirmada_exitosa` sin PDF/XML | Faltan archivos | Se vuelven a pedir (solo lectura) |
| `confirmada_fallida` manual reciente | Respuestas tardías | Auditoría: «certificado» ⇒ alerta |

Parámetros de plataforma (`plataforma_parametros`; la demostración los pone en 0): espera de conciliación manual 120 min, ventana tardía 1440 min, umbral de recuperación 10 min, ventana de auditoría 10080 min.
