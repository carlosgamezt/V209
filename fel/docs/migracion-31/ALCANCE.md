# Migración 31 · alcance técnico (PROPUESTA, no aplicada)

Estado (25/11/2026): escrita y probada **solo** en un PostgreSQL temporal (`tools/test-migracion-31.sh`). **No está en `supabase/migrations`, no se aplicó a `nexa-demo`, no se aplicará sin tu autorización específica.** Producción deshabilitada; NEXA principal no interviene; las migraciones 29 y 30 no se tocan.

## Para qué
Hoy la base impide crear una operación de Digifact para cualquier tipo distinto de FACT (guardián de la 30). Para **probar en Digifact TEST** una nota de crédito hace falta abrir ese paso **solo para TEST y solo para NCRE**, sin habilitar nada «real».

## Qué cambia (un archivo: `20261125000100_fel_certificacion_test_tipos.sql`)
| Objeto | Cambio |
|---|---|
| `fel_tipos_dte` | Columna nueva `certificacion_test boolean not null default false`. `FACT` y `NCRE` = true; `NDEB`, `RECI` y los 13 pendientes = false. Restricción nueva: «real» implica TEST, y un tipo pendiente jamás certifica en TEST. `certificacion_habilitada` **no cambia** (solo FACT). |
| `digifact_operaciones` | El guardián `fel_digifact_tipo_guard_t` pasa a la función nueva `fel_digifact_tipo_guard()`: acepta `certificacion_habilitada OR certificacion_test`. |
| `operaciones_fiscales` | **Sin cambios** (la vía «real» sigue cerrada a todo menos FACT). |
| Funciones | `fel_digifact_tipo_guard()` (disparador, sin permisos de API) y `fel_tipos_certificacion_test()` (lectura para el servidor: solo `service_role`). |
| Tablas de datos | Ninguna: no toca `documentos`, empresas, operaciones, auditoría ni configuración por empresa. |

Tablas afectadas: **1** (`fel_tipos_dte`, catálogo de 17 filas, aditivo) + 1 disparador reemplazado en `digifact_operaciones`. Cifras de catálogo tras aplicar: +2 funciones (197), mismos disparadores (66), mismas tablas (71).

## Riesgos y mitigación
| Riesgo | Mitigación |
|---|---|
| Se abre la certificación TEST de NCRE por error en «real». | No hay camino: el cliente de Digifact solo conoce TEST, `operaciones_fiscales` conserva su guardián y `certificacion_habilitada` no cambia. Además se exige `digifact=habilitado` + empresa con credenciales TEST. |
| Una NCRE rechazada por Digifact TEST. | Sin efecto fiscal; el documento queda guardado y editable. Consume una prueba. Los requisitos (referencia al origen, motivo) se validan antes de salir. |
| Desactivar la inmutabilidad del catálogo. | Solo dentro de la transacción de la migración (rol `postgres`); se reactiva antes de terminar y la verificación comprueba que sigue activa. |
| Bloqueo/lentitud. | `ALTER TABLE ADD COLUMN` con valor por omisión constante no reescribe la tabla (PG 11+); tabla de 17 filas. |
| Aplicación parcial. | Se ejecuta en **una** transacción (`--single-transaction`): todo o nada. La reaplicación falla sin cambiar nada. |

## Compatibilidad
- Código actual (FACT): sin cambios de comportamiento. Los documentos existentes (todos FACT) no se tocan.
- `fel_tipos_empresa` y el espejo `catalogo_dte.ts` siguen válidos (`certificacion_habilitada` intacto). El servidor leerá `fel_tipos_certificacion_test()` solo si la función existe; sin la migración todo sigue como hoy (inerte).
- Compatible con las migraciones 29 y 30 (exige ambas; se rechaza si faltan).

## Recuperación
1. **Antes de aplicar**: respaldo (`respaldo-nube.yml`, como en la 29/30) y verificación de solo lectura.
2. **Si algo falla al aplicar**: no queda nada (una transacción).
3. **Si ya está aplicada y no se quiere**: `reversion-31.sql` (restaura el guardián de la 30, quita función, restricción y columna, y su versión del historial). **Se niega** si ya existe una operación de Digifact sobre un documento que no es FACT (se perdería su respaldo de integridad); en ese caso se decide caso por caso o se restaura el respaldo.
4. **Verificación posterior**: `verificacion-31.sql` (solo lectura, 12 controles, todos `ok = true`).

## Pruebas ya hechas (PostgreSQL 16 temporal, `tools/test-migracion-31.sh`)
Aplicación en una transacción · reaplicación rechazada · verificación posterior sin filas `f` · pruebas funcionales (NCRE y FACT crean operación de Digifact; NDEB y RECI **no**; NCRE sigue **bloqueada** en `operaciones_fiscales`; catálogo inmutable para la aplicación; coherencia de restricciones; permisos) · reversión limpia · estado de la 30 intacto · reaplicación posible. **Pendiente de probar**: la negativa de la reversión con una operación NCRE ya creada (se probará con la prueba de integración en PostgreSQL real).

## Decisión que necesito de ti
- **Opción A (recomendada, la propuesta tal cual)**: solo NCRE en TEST (único con ejemplo oficial leído). NDEB y RECI quedan bloqueados hasta leer «NUC 3 - NDEB» y «NUC 7 - RECI».
- **Opción B**: agregar NDEB y RECI al `update` (una línea). No lo recomiendo: RECI tiene requisitos fiscales sin confirmar.
- Sin tu autorización explícita **no se aplica**; cuando la des, se publica como migración 31 con respaldo previo y verificación.
