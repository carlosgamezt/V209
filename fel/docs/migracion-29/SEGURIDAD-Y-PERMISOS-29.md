# Migración 29 · seguridad, permisos y aislamiento por empresa

## Qué crea (aditivo: nada de las migraciones 1–28 se modifica)
| Objeto | Para qué | Quién lo toca |
|---|---|---|
| `digifact_operaciones` | un intento de certificar un documento (referencia determinista, estado, resultado: UUID, serie, número) | solo el rol propietario |
| `digifact_artefactos` | XML y PDF reales (bytea, SHA-256 verificado por la base), solo inserción | solo el rol propietario |
| `fel_digifact_op_guarda`, `fel_digifact_art_guarda` | disparadores (invocador, `search_path` vacío): nada se borra, la identidad no cambia, solo transiciones válidas, la operación nace «preparada» | nadie los ejecuta directamente |
| `fel_sys_digifact_aplicar(empresa, operación)` | aplica la certificación al documento (SECURITY DEFINER, `search_path` vacío) | **solo el propietario** (se retiró también `service_role`) |

## Aislamiento entre empresas: DOS capas independientes
1. **Código:** toda consulta del almacén lleva `empresa_id`.
2. **Base de datos (la que no depende del código):** toda clave foránea es **compuesta con `empresa_id`** (operación→documento y artefacto→operación) y la unicidad es por empresa. Una fila no puede apuntar a datos de otra empresa **aunque el código se equivocara**. Se prueba con el disparador desactivado: la clave foránea sola lo rechaza (`supabase/tests/29_digifact_operaciones.sql`). La regla general de la 28 («toda FK entre tablas con `empresa_id` incluye `empresa_id`») sigue pasando con la 29 aplicada.

## Privilegios efectivos (verificados por catálogo y con los roles reales)
- `anon`, `authenticated`, `service_role` y `PUBLIC`: **ningún** privilegio sobre las dos tablas ni sobre las tres funciones (`has_table_privilege`, `has_function_privilege` y `aclexplode`). Con `set role` real, todo da «permission denied».
- RLS activado en las dos tablas y **sin políticas**: la API de datos (PostgREST) no las expone.
- La verificación posterior (`verificacion-posterior-29.sql`, solo lectura) lo comprueba y **detecta** nueve manipulaciones (un `grant`, RLS desactivado, un disparador desactivado, una FK borrada, un índice borrado, una política añadida, un `search_path` restablecido…).

## El rol de la conexión `DEMO_BD_URL` (hallazgo importante)
- La función hospedada de NEXA FEL **no usa la API de datos**: se conecta directamente al pooler de `nexa-demo` como `postgres.<ref>` y ejecuta SQL. Ese rol es el **propietario** de las tablas.
- **RLS no protege contra el propietario**: el dueño de una tabla se salta RLS (y en Supabase `postgres` además tiene `BYPASSRLS`; la etapa 3 lo imprime en solo lectura para confirmarlo, no se da por supuesto). Por eso la 29 **no depende de RLS** para el aislamiento: depende de las claves foráneas compuestas, de la unicidad por empresa y de los disparadores, que valen para cualquier rol, también el propietario.
- Lo que el propietario **sí** puede (por diseño del proveedor): insertar y actualizar operaciones por las transiciones válidas. Lo que **ni el propietario** puede por las reglas de la base: borrar operaciones o artefactos, cambiar la identidad de una operación, cambiar un resultado certificado, modificar un artefacto, certificar por segunda vez el mismo documento (índice único), repetir una autorización dentro de la empresa, ni cambiar los datos fiscales de un documento certificado (inmutabilidad de las migraciones 1–28). Para saltarse esto haría falta ser superusuario o desactivar disparadores.
- **Riesgo residual:** quien tenga la contraseña de la base (`DEMO_BD_URL`) puede leer los datos de todas las empresas de `nexa-demo` y escribir lo que las reglas permiten. Es la situación de toda la aplicación desde la migración 1 (una sola conexión con el rol propietario), no algo que la 29 empeore.

### CONDICIÓN BLOQUEANTE antes de habilitar clientes reales
El rol propietario con una sola conexión **está aceptado únicamente para la demostración y las pruebas con datos simulados de `nexa-demo`**. **Antes de habilitar facturación para clientes reales hay que resolverlo** (rol de aplicación de privilegios mínimos con RLS forzada por empresa, o una decisión equivalente aprobada por escrito). Mientras no se resuelva, no se habilitan clientes reales, ni la certificación de producción, ni más de una empresa de TEST real.

### Alternativa (NO implementada; requiere tu aprobación porque cambia la arquitectura)
Un rol de aplicación de **privilegios mínimos**, p. ej. `fel_servicio` (sin `LOGIN` propio al principio; la conexión haría `SET LOCAL ROLE fel_servicio` por transacción):
1. `GRANT` explícito solo de lo que el servicio usa: `SELECT/INSERT/UPDATE` en `digifact_operaciones`, `SELECT/INSERT` en `digifact_artefactos`, `EXECUTE` en `fel_sys_digifact_aplicar`, y lectura de las tablas de negocio que ya lee. Sin `DELETE`, `TRUNCATE`, `TRIGGER` ni DDL.
2. Políticas RLS con `FORCE ROW LEVEL SECURITY` y una variable de sesión (`set_config('fel.empresa_id', …, true)`) fijada por la aplicación al inicio de cada transacción: así **la base** limita cada consulta a la empresa de la sesión, sin depender de que el código escriba `where empresa_id = …`.
3. Costo y riesgo: toca toda la capa de datos de la demostración (cada consulta debe correr bajo ese rol y esa variable), exige migración propia, pruebas de todas las rutas y una verificación con el pooler. **Recomendación:** aplicar primero la 29 tal como está (las dos capas de arriba bastan para el piloto de pruebas) y decidir este rol como proyecto aparte antes de habilitar clientes reales.
