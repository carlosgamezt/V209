# NEXA FEL · Propuesta final para aplicar las migraciones con seguridad (respaldo, recuperación, consecutividad y criterios de parada)

**PROPUESTA. No se ha aplicado nada. Las migraciones 1–27 siguen sin aplicar. No existe ni se prepara ningún script destructivo para vaciar la base** (requeriría tu autorización específica).

## 1. Respaldo y recuperación verificables
**Realidad de partida:** `nexa-demo` está vacía (0 filas, 0 migraciones). No hay datos que respaldar; la fuente de verdad del esquema es el repositorio (migraciones 1–27, con SHA del commit). Plan Free: **a verificar** si existen copias automáticas (no se asume ninguna).

| Elemento | Procedimiento | Cómo se verifica |
|---|---|---|
| R-A Línea base previa | Inmediatamente antes de la etapa 1, `verificar-inicial` (solo lectura) debe dar 0 REVISAR con la huella de `rls_auto_enable` igual; su salida se conserva como evidencia del estado «vacío» | Registro de la ejecución, sin secretos |
| R-B Fuente reproducible | Se fija el commit exacto del que salen las 27; la etapa usa solo esos archivos | Verificación estática ya existente (`verificar-publicacion.py`) y SHA del commit anotado en la ejecución |
| R-C Evidencia posterior | V1 (solo lectura) deja: 27 registradas, 67 tablas/67 RLS, dependencias de Auth, 0 filas | Salida de V1 comparada con la tabla de resultados esperados (§2 de `EVALUACION-RIESGOS-Y-PLAN-ETAPA-1.md`) |
| R-D Ensayo de recuperación local | Antes de autorizar, repetir en local (base con el emulador de plataforma y la función real) el ciclo «aplicar 1–27 → V1», y comprobar que V1 local da los mismos números | Ya probado en las pruebas existentes; se re-ejecuta y se adjunta |
| R-E Recuperación (sin script destructivo) | **Preferida: crear un proyecto Supabase nuevo y descartar el anterior** (cuenta Free permite proyectos adicionales: **a verificar**); evita borrar nada en `nexa-demo`. Alternativas (corrección hacia adelante con migración nueva; limpieza manual de objetos) solo con tu autorización específica | La verificación inicial sobre el proyecto nuevo debe dar 0 REVISAR antes de reintentar |
| R-F Volcado de esquema (opcional, requiere nuevo cambio de código) | Una acción de **solo lectura** que exporte el catálogo tras V1 para comparar con el local | **No existe aún**; se prepararía solo si lo pides |

## 2. ¿Pueden ejecutarse consecutivamente las etapas 1 y 2?
**Sí, sin dejar una exposición injustificada, bajo estas condiciones:**
- **Exposición real entre etapas:** solo `service_role` conserva DELETE/TRUNCATE en 17 tablas (M1). No se cargan datos ni credenciales, todo `simulado`, `anon`/`authenticated` no ganan privilegios. El riesgo concreto es que una llave de servicio filtrada pueda vaciar tablas **vacías**: impacto nulo mientras no haya datos.
- **Forma recomendada: dos ejecuciones separadas, una tras otra** (no una combinada): etapa 1 → V1 automática → tú lees V1 → etapa 2 (precondición exacta: 27 registradas) → V2 automática. Mantiene el punto de control intermedio y las dos aprobaciones.
- **No se recomienda** una ejecución única «1+2»: exigiría cambiar código, eliminaría la verificación intermedia humana y ampliaría el radio de un fallo.
- **Regla:** entre V1 y la etapa 2 no se carga ningún dato ni se crea ninguna empresa; si V1 falla, la etapa 2 no se lanza.
- Operativa: lanzar una sola ejecución a la vez (concurrencia `publicar-nube` descarta pendientes intermedios).

## 3. Criterios para DETENER el proceso (cualquiera basta)
| Cuándo | Criterio de parada |
|---|---|
| Antes de la etapa 1 | `verificar-inicial` ≠ 0 REVISAR, o huella de `rls_auto_enable` distinta; resultado de `verificar-api-vault` = REVISAR (vault expuesto) o NO VERIFICADO sin explicación aceptada; commit de la ejecución ≠ el aprobado; ejecución no lanzada desde `fel-proveedores-diseno`; referencia de proyecto ≠ `nexa-demo`; base no vacía o con historial; CI de ese commit en rojo |
| Durante la etapa 1 | Cualquier error de `db push`; migración que no queda registrada; el trabajo supera el tiempo esperado (20 min es el máximo del flujo) o se cancela; salida que muestre una credencial (parada y rotación inmediatas) |
| En V1 | Registradas ≠ 27; tablas ≠ 67 o alguna sin RLS; dependencias de Auth con faltantes; filas en tablas de datos ≠ 0; privilegios de `anon` sobre tablas ≠ 0; funciones ejecutables por `authenticated` distintas de las 3 esperadas |
| Antes de la etapa 2 | V1 no verde; cualquier dato cargado desde V1; tu aprobación expresa ausente |
| En V2 | Catálogo de la 28 distinto del esperado (`verificacion-posterior-28.sql`); `service_role` aún con DELETE/TRUNCATE en tablas públicas; alguna tabla sin RLS |
| Siempre | Cualquier hallazgo nuevo e inexplicado: se detiene, se informa y se espera tu decisión; nunca se reintenta a ciegas ni se ajusta una huella o excepción sin tu autorización |

## 4. Secuencia propuesta (todo requiere tu autorización expresa de cada paso)
1. Resultado de `verificar-api-vault` (#8) revisado y aceptado.
2. Re-ejecución de `verificar-inicial` inmediatamente antes (0 REVISAR) y CI verde del commit.
3. Etapa 1 (`APLICAR-MIGRACIONES`, aprobación en `demo-privada`) → V1 → pausa para tu lectura.
4. Etapa 2 (nueva aprobación) → V2 → pausa.
5. Sin despliegues, sin datos, sin certificaciones Digifact, sin migración 29.

## 5. Qué NO está autorizado (sigue vigente)
Migraciones 1–28, despliegues, cambios de permisos/RLS/esquema, certificaciones Digifact, scripts destructivos, escrituras en `nexa-demo`.
