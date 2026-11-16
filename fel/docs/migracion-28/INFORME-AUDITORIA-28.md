# NEXA FEL · Informe de auditoría y dependencias previo a la migración 28

Alcance: compatibilidad de la migración 28 con las 27 anteriores. **Todo se hizo en local** (PostgreSQL 16 temporal con `tools/shim_supabase.sql`). No se aplicó nada a `nexa-demo`, no se tocó la nube, `main` ni NEXA principal, y no se certificó nada.
Migración propuesta: `fel/supabase/migrations/20261113000100_fel_endurecimiento_28.sql` (prefijo 20261113 a propósito: queda fuera del patrón `2026111200*` de la guarda aditiva de D2, que se mantiene intacta).

## 1. Resumen ejecutivo
- **Sin hallazgos críticos ni altos.** La base conserva sus garantías: RLS en las 67 tablas, `authenticated` solo lee, `anon` no tiene privilegios, escrituras por funciones `fel_*`, operaciones fiscales con un solo envío, idempotencia y recuperación.
- **Dos hallazgos medios y tres bajos.** La 28 cierra los dos medios que son seguros de cerrar y dos bajos; queda una decisión tuya (M2).
- La 28 **solo cierra** (no abre ningún privilegio), es **idempotente** (se aplicó tres veces seguidas) y termina con una **comprobación interna** que anula la migración entera si algo no quedó como se declara.
- Es **compatible** con las 27: se aplicó desde cero, y sobre una base ya sembrada con la demostración (los conteos de las 67 tablas quedaron idénticos antes y después).
- **Recomendación:** es seguro pedir autorización para aplicarla a `nexa-demo` siguiendo el plan de aplicación y recuperación. No es una autorización que yo tenga hoy.

## 2. Hallazgos
| ID | Gravedad | Hallazgo | Estado |
|---|---|---|---|
| M1 | Media | El rol de servicio podía **borrar y vaciar (TRUNCATE) 17 tablas**, entre ellas `empresas`, `miembros`, `clientes`, `perfiles`. Ninguna ruta de la API ni de la demostración lo usa. | **Cerrado en la 28** (revocación + disparador que impide borrar o vaciar empresas, incluso al dueño de la tabla) |
| M2 | Media | El rol de servicio conserva **INSERT/UPDATE directo en ~30 tablas**, es decir, podría saltarse las funciones `fel_*` (los disparadores de inmutabilidad sí se aplican). Solo lo ejercería quien tenga la llave de servicio. En el código, `fel-api` solo hace `select` directos; todo lo demás es por funciones. | **PENDIENTE, NO RESUELTO: migración 28b** (decisión tuya confirmada). No incluido en la 28 (ver §6) |
| B1 | Baja | `ordenes_confirmaciones` apuntaba a su orden solo por `orden_id`; que sea de la misma empresa lo garantizaba únicamente la función `fel_op_orden_confirmacion_autorizar`. | **Cerrado en la 28** (clave foránea compuesta `(orden_id, empresa_id)`) |
| B2 | Baja | Las 11 funciones de disparador eran ejecutables por el rol de servicio. No es explotable (un disparador no se invoca a mano), pero es superficie innecesaria. | **Cerrado en la 28** |
| B3 | Baja | 4 claves foráneas del bolsón global (`partidas`, `resoluciones`, `movimientos`) no incluyen `empresa_id`. Son tablas de la plataforma, solo legibles por el administrador, con `empresa_id` opcional por diseño. | **Aceptado y documentado**; la prueba 28 las lista como excepciones explícitas para que cualquier otra clave foránea nueva sin `empresa_id` rompa la prueba |
| I1 | Informativo | Tres funciones `fel_sys_*` con `p_empresa` no comparan `empresa_id` en su cuerpo. **Revisadas, sin riesgo:** `fel_sys_documento_instantanea` y `fel_sys_hash_documento` delegan en `fel__instantanea_documento`, que sí filtra por empresa; `fel_sys_evento_registrar` está protegida por la clave foránea compuesta `(operacion_id, empresa_id)`. | Sin acción |

## 3. Auditoría por área (con evidencia)
| Área | Resultado | Evidencia |
|---|---|---|
| **RLS** | Activo en las 67 tablas; 49 políticas, todas de solo lectura para `authenticated`, con condición; `true` solo en 5 catálogos públicos; las tablas con `empresa_id` filtran por empresa o por administrador de plataforma. | Prueba 28 (puntos 1, 4, 5) |
| **Permisos** | `anon` sin privilegios (tabla, columna ni secuencia); `authenticated` solo SELECT; sin vistas; todas las funciones SECURITY DEFINER con `search_path` fijo; el rol de servicio ya no borra ni vacía (M1). | Prueba 28 (2, 3, 6, 7, 12, 13) |
| **Multiempresa** | 144 claves foráneas revisadas: las hijas de tablas con `empresa_id` son compuestas, salvo B3 y B1 (corregido). Las consultas de la API filtran por la empresa de la sesión. | Prueba 28 (14, 15); suites 02, 06, 08 |
| **Referencias únicas** | Únicos por `(documento_id, clave_idempotencia)`, `(id, empresa_id)`, **una operación abierta por documento**; consumos `(empresa_id, clave_idempotencia)` y `(operacion_id, evento_tipo)`; cargos `(consumo_id, concepto)`; pagos `(empresa_id, clave_idempotencia)` y `(empresa_id, medio, referencia_pago)`; cobros `(empresa_id, periodo, tipo)`; artefactos `(operacion_id, tipo)`. | Catálogo; suites 04, 15, 19, 21, 22 |
| **Idempotencia** | Misma clave = misma operación; claves distintas = una sola operación abierta; reservas, confirmaciones y compras repetidas producen un solo consumo o lote. | 26 escenarios de concurrencia, todos OK |
| **Transacciones** | Cada función `fel_*` es una sola transacción; bloqueos `FOR UPDATE` en las rutas críticas; tormenta mezclada sin interbloqueos y con el libro exacto. | `concurrencia.sh` |
| **Estados fiscales** | El guardián de operaciones solo admite `iniciada → confirmada_exitosa/confirmada_fallida/desconocida` y `desconocida → confirmada_*`; una confirmada no se modifica; los datos de la operación son inmutables. | Suite 04; función `fel_operacion_guard` |
| **Recuperación ante fallos** | Operación marcada antes de enviar; sin respuesta = `desconocida`/`por_verificar`; consulta y conciliación (incluida la de dos personas); un resultado vencido nunca se acepta; el consumo se libera solo con prueba de que nunca se envió. | Suites 15, 22 y concurrencia; pruebas del orquestador y del supervisor |

## 4. Dependencias y orden de las migraciones
- **Orden:** las 28 se aplican de forma secuencial y sin error desde una base vacía; la 28 depende solo de tablas de las anteriores (`empresas`, `ordenes_emision`, `ordenes_confirmaciones`) y de que existan los roles de la API.
- **Esquemas y objetos externos usados por las 27:** `auth.users`, `auth.uid()`, `auth.mfa_factors`, `auth.sessions`; roles `anon`, `authenticated`, `service_role`; `gen_random_uuid()` (incluida en PostgreSQL). **Ninguna extensión, ni Vault, ni Storage, ni realtime.** La función `fel_verificar_dependencias_auth()` ya existe para comprobarlo en la base hospedada.
- **La 28 no depende de nada que no exista** y no usa Vault: no hay ninguna migración que dependa de algo sin verificar.
- **Guardas de CI existentes:** `verificar_aditiva_d2.py` sigue en verde; no se editó ninguna migración anterior.

## 5. Resultados de las pruebas locales
| Prueba | Resultado |
|---|---|
| Suite SQL completa: 28 migraciones (las 27 + la 28) y 28 suites + concurrencia (`tools/test-local.sh`) | **TODO OK** (rc=0), incluida la nueva suite `28_endurecimiento.sql` |
| Concurrencia (26 escenarios) | Todos OK |
| Control negativo: la suite 28 contra una base **sin** la migración 28 | **Falla**, como debe (M1) |
| Migración sobre base **con datos** (demostración sembrada, 32 tablas con filas) | Aplicada; **conteos idénticos** antes y después |
| Idempotencia: la 28 aplicada tres veces | Sin error (encontré y corregí un defecto en la sección 4 gracias a esta prueba) |
| Reversión (`reversion-28.sql`), aplicada dos veces, y la 28 reaplicada después | OK; la suite 28 vuelve a pasar |
| Verificación posterior de solo lectura (`verificacion-posterior-28.sql`) con `default_transaction_read_only=on` | OK con la 28; **falla** sin ella |
| Demostración contra PostgreSQL real con la 28 (Digifact, versión práctica, persistencia, publicado, sesiones) | 15 pruebas OK |
| Procedimiento excepcional de eliminación de empresas (9 comprobaciones, en `tools/test-local.sh` y en el CI) | OK |
| Operaciones administrativas legítimas sobre `empresas` con la 28 (crear, habilitar, suspender, cambiar régimen, datos de contacto; prueba 28 §16) | OK |
| Modo «solo migraciones» por etapas: `tools/test-supabase-hospedado.sh` con CLI y psql falsos (95 comprobaciones, con y sin `GITHUB_ACTIONS`) y `verificar-publicacion.py` (43 garantías, 0 fallos) | OK |
| Guarda aditiva D2 | OK |
No volví a ejecutar las pruebas de `fel-api` ni de `proveedores` porque esta fase no tocó su código (en la fase anterior: 43/43 y 127/127).
**Límites de estas pruebas:** el PostgreSQL local emula Supabase (roles y privilegios por defecto) pero no es Supabase; por eso el plan incluye una verificación de solo lectura en la base hospedada.

## 6. Qué cambia la migración 28 y qué no
**Cambia (solo cierra):** (1) empresas: no se borran ni se vacían; (2) el rol de servicio pierde DELETE y TRUNCATE en todas las tablas de `public`; (3) funciones de disparador sin EXECUTE para roles de la API; (4) clave foránea compuesta en `ordenes_confirmaciones`.
**No cambia:** ninguna función, política RLS, tabla de datos ni migración previa; ninguna ruta de la API ni de la demostración.
**No incluido y NO resuelto (M2, queda para la migración 28b):** revocar también INSERT/UPDATE directo al rol de servicio. Evidencia de compatibilidad: el código de `fel-api` solo hace `select` directos y la demostración usa el rol dueño de las tablas. **No lo probé contra las funciones desplegadas en Supabase**, por eso lo dejo como paso aparte (28b) que recomiendo hacer después de verificar en `nexa-demo`.

## 7. La protección de `empresas` y las operaciones administrativas legítimas
**Verificado:** ninguna ruta de la API, de la demostración ni de las migraciones borra empresas. Las operaciones administrativas legítimas son crear, habilitar, suspender, cambiar el régimen y editar los datos de contacto; todas son INSERT o UPDATE, así que el disparador de la 28 (que solo actúa en DELETE y TRUNCATE) **no las toca**. La prueba 28 §16 las ejecuta con las funciones reales (`fel_admin_empresa_crear`, `fel_admin_empresa_estado`, `fel_admin_empresa_regimen`, `fel_op_empresa_datos_guardar`) y pasan.
**Dato de contexto:** todas las claves foráneas hacia `empresas` son NO ACTION. Una empresa con cualquier historial (incluida la auditoría de su creación, que es solo-anexar) **nunca pudo borrarse**; la 28 solo cierra el caso de una empresa vacía y da un mensaje claro. El modo normal de «dar de baja» una empresa es **suspenderla**.
**Procedimiento controlado para situaciones excepcionales:** `docs/migracion-28/eliminar-empresa-excepcional.sql` (para una empresa **creada por error y vacía**). Una sola transacción; exige confirmación literal `ELIMINAR-EMPRESA-<uuid>`, motivo de al menos 10 caracteres, que quien autoriza sea administrador de la plataforma, que la empresa **no esté habilitada** y que **ninguna** tabla tenga filas suyas; desactiva el disparador solo dentro de la transacción, lo reactiva y **comprueba** que quedó activo; deja constancia en la auditoría. Requiere ser dueño de la tabla (rol `postgres`) y se ejecuta solo con autorización escrita. Probado (`supabase/tests/procedimiento_excepcional_empresas.sh`): se niega sin confirmación, con motivo corto, sin administrador y con historial, no borra nada en un rechazo, elimina una empresa vacía, deja el disparador activo y la auditoría registrada, y después borrar sigue prohibido. Limitación: no sirve para una empresa con historial; eso sería una decisión legal/contable aparte y no existe herramienta para ello.

## 8. Documentación oficial de Supabase Vault (leída hoy)
Fuentes: páginas oficiales de Vault, de roles de Postgres y de pgsodium en supabase.com/docs (consultadas con `curl` por el proxy de la sesión, tras permitir el host; la herramienta de lectura web no lo resolvía).
- **Cifrado:** los secretos se guardan con **cifrado autenticado con datos asociados** (basado en libsodium); copias de seguridad y réplicas conservan el cifrado.
- **Clave:** Supabase crea y gestiona una **clave raíz única por proyecto**, separada de los datos; no está en la base. Operaciones del mismo proyecto (pausa, restauración, PITR) conservan la clave; con `pg_dump`/`pg_restore` manual a otro proyecto **no se pueden descifrar** los secretos sin copiar antes la clave raíz.
- **Advertencia de privilegios (literal):** «You should ensure that you protect access to this view with the appropriate SQL privilege settings at all times, as anyone that has access to the view has access to decrypted secrets.» (`vault.decrypted_secrets`). Y: «Which roles should have access to the vault.secrets table should be carefully considered.»
- **`service_role`:** la página de Vault **no menciona** `service_role`. La página de roles dice que es el rol «for elevated access… used by the API (PostgREST) to bypass Row Level Security». **Implicación:** si `service_role` (o `authenticated`/`anon`) tuviera USAGE/SELECT sobre el esquema `vault`, una llave de servicio filtrada leería todos los secretos. Por eso el diseño exige que **ninguno de los tres** pueda usar `vault` y que los secretos solo se lean con una función propia (ver diseño §1).
- **pgsodium:** «pending deprecation»; Vault **no depende** de pgsodium (documentación actual). Las funciones de pgsodium (gestión de claves y cifrado de columnas) no se recomiendan.
- **No dice nada** sobre disponibilidad por plan, versión instalada ni privilegios por defecto del esquema `vault` en un proyecto concreto. **Siguen a verificar** en `nexa-demo`: la acción `verificar-etapa` imprime, de forma informativa y en solo lectura, si `supabase_vault` está disponible/instalada y si anon/authenticated/service_role tienen USAGE sobre `vault`.
