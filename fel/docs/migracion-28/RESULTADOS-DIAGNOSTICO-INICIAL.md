# NEXA FEL · Resultados del diagnóstico de solo lectura de `nexa-demo` (ejecución #5)

Ejecución #5 de «solo migraciones», acción `diagnostico-inicial`, rama `fel-proveedores-diseno`, commit `c61f774`. **Solo lectura** (transacción `READ ONLY` confirmada con `transaction_read_only = on`); de los pasos del flujo solo corrió el del diagnóstico (CLI, verificación inicial y etapas: omitidos). No se leyó ningún valor de secreto y el registro no contiene credenciales. **Nada se modificó. Etapa 1 sigue sin ejecutarse.**

## Actualización: estado de las correcciones aprobadas
| # | Corrección | Estado |
|---|---|---|
| C1 | `verificar-inicial` reconoce `public.rls_auto_enable()` **solo** si coincide: propietario `postgres`/`supabase_admin`, `SECURITY DEFINER`, plpgsql, volátil, devuelve `event_trigger`, configuración exactamente `search_path=pg_catalog`, **huella SHA-256 del cuerpo = `325ae266d9b166715ef5230ceaf7ff9d523e483cf5610dfb9779ab3f183f4af9`** (de la definición verificada, guardada en `supabase/tests/plataforma/rls_auto_enable_real.sql`; una guarda estática comprueba que la huella del SQL coincide con ese archivo) y el disparador `ensure_rls` activo en `ddl_command_end` con exactamente las tres etiquetas. Cualquier otra función, o esa misma modificada, es `REVISAR` y se imprime la huella real. | **Implementada y probada** (12 escenarios) |
| C2 | Pruebas locales y de CI con la definición real: `tools/test-plataforma-ensure-rls.sh` (reconocimiento + 28 migraciones, 67 tablas con RLS y las 28 suites con la función instalada; el CI usa un PostgreSQL de superusuario). | **Implementada** |
| C3 | Etiqueta del diagnóstico: «ACL por defecto de PostgreSQL: EXECUTE para PUBLIC y para el propietario». | **Corregida** |
| C4 | Acción de solo lectura `verificar-api-vault`: un GET a la raíz de la API con la clave **pública** del proyecto (secreto `DEMO_SUPABASE_ANON_KEY`, **que debes crear**; nunca una clave de servicio) para saber si `vault` está expuesto. | **Preparada y probada; no ejecutada** |
| C5 | Decisión de arquitectura y diseño del cifrado por sobre: `DECISION-CREDENCIALES-DIGIFACT.md`. | **Documentada; sin implementar** |

## 1. La función de `public`
| Dato | Valor |
|---|---|
| Identidad | `public.rls_auto_enable()` (devuelve `event_trigger`, plpgsql) |
| Propietario / seguridad | `postgres` / `SECURITY DEFINER` con `search_path = pg_catalog` |
| Qué hace | Tras un `CREATE TABLE` (o `CREATE TABLE AS` / `SELECT INTO`) en `public`, ejecuta `ALTER TABLE … ENABLE ROW LEVEL SECURITY` sobre esa tabla con `%I.%I` (identificadores escapados). Si falla, registra el error y **continúa** (no aborta el `CREATE TABLE`) |
| Quién la usa | Solo el disparador de evento `ensure_rls` (`ddl_command_end`, etiquetas `CREATE TABLE`, `CREATE TABLE AS`, `SELECT INTO`, activo). Sin disparadores de tabla, sin objetos que dependan de ella, ninguna otra función la menciona |
| Los 7 disparadores de evento | 6 de la plataforma (`issue_graphql_placeholder`, `issue_pg_cron_access`, `issue_pg_graphql_access`, `issue_pg_net_access`, `pgrst_ddl_watch`, `pgrst_drop_watch`; propietario `supabase_admin`) + `ensure_rls` (propietario `postgres`) |
| EXECUTE efectivo | `anon`, `authenticated` y `service_role` = sí (la ACL es la de por defecto, que da EXECUTE a PUBLIC). **No es explotable**: invocarla directamente falla con «trigger functions can only be called as triggers» (probado en PostgreSQL local) |
**La hipótesis se confirma**: es la salvaguarda «activar RLS automáticamente» de Supabase, instalada en el proyecto con una definición ligeramente más tolerante que el ejemplo de la documentación (no vuelve a lanzar el error).

### ¿Es compatible con nuestras migraciones? **SÍ** (probado con la definición real)
Con la función real y su disparador instalados en una base local: las **28 migraciones se aplican sin error**, quedan las **67 tablas con RLS**, y pasan las **28 suites SQL**, la **concurrencia**, el procedimiento excepcional y la verificación inicial. Razón: nuestras migraciones ya activan RLS en cada tabla; el disparador solo lo repite, y no hay colisión de nombres con las funciones `fel_*`. **No se toca ni se elimina.**
**Qué falta:** una guarda nuestra la cuenta como «función propia» y marca `REVISAR`. Es un problema de la regla, no de la base (ver §4, C1).

## 2. Vault y privilegios de `service_role` (valores reales)
| Objeto | Resultado |
|---|---|
| Extensión | `supabase_vault` 0.3.2 instalada; `pgsodium` no instalada |
| Esquema `vault` | propietario `supabase_admin`; USAGE: `postgres` (con grant option) y `service_role`; `anon`, `authenticated` y `authenticator`: no |
| `vault.decrypted_secrets` (vista que descifra) | `service_role`: **SELECT = sí**, DELETE = sí (incluida la columna `decrypted_secret`) · `anon` y `authenticated`: no |
| `vault.secrets` | `service_role`: **SELECT = sí**, DELETE = sí · `anon` y `authenticated`: no |
| `vault.create_secret`, `vault.update_secret` | `SECURITY DEFINER`, propietario `supabase_admin`; EXECUTE: **solo `service_role`** |
| `service_role` | no es miembro de ningún rol, omite RLS (`rolbypassrls`), no es superusuario |
| Exposición por la API de datos | **NO VERIFICADO**: el rol `authenticator` no trae `pgrst.db_schemas`; la lista de esquemas expuestos se configura en los ajustes de la API del proyecto |
**Lectura:** con la configuración actual, **`service_role` puede leer TODOS los secretos descifrados** de Vault, borrarlos, crearlos y actualizarlos. `anon` y `authenticated` no pueden. Es justo el riesgo que advierte la documentación oficial («anyone that has access to the view has access to decrypted secrets»).

## 3. ¿Pueden guardarse las credenciales Digifact de forma segura con la configuración actual? **NO en Vault tal como está**
- La llave `service_role` es la que usa nuestro servidor y vive en secretos de entorno y del CI. Si se filtrara, hoy ya expondría los datos de FEL; con credenciales Digifact en Vault, **además permitiría emitir documentos fiscales a nombre de las empresas** directamente ante Digifact.
- **Corregirlo revocando privilegios a `service_role` es dudoso (no verificado):** esos privilegios los otorgó `supabase_admin`; el rol `postgres` solo puede revocar los que él mismo otorgó, el esquema está gestionado por Supabase y una actualización podría restaurarlos. No se intenta.
- **Hoy no hay credenciales en la base:** las de TEST están como secretos del entorno de GitHub. **Nada que migrar ni borrar.**

### Evaluación de alternativas (actualizada con el hallazgo)
| Opción | Aísla frente a una llave `service_role` filtrada | Escala a varias empresas | Observaciones |
|---|---|---|---|
| A. Vault tal como está | **No** | Sí | Descartada con la configuración actual |
| B. Revocar privilegios de `service_role` en `vault` | Sí, si se pudiera | Sí | Probablemente inviable (otorgante `supabase_admin`) y frágil ante actualizaciones; no verificado |
| C. Secretos por empresa fuera de la base (entorno de la plataforma) | Sí | **No** (manual por empresa) | Válida mientras haya **una** empresa en TEST: es lo que existe hoy |
| D. Cifrado por sobre con clave maestra **fuera de la base** (la base solo guarda texto cifrado; la clave solo la tiene el componente que llama a Digifact) | Sí (la llave de servicio solo lee texto cifrado) | Sí | Hay que diseñar y probar custodia, rotación y auditoría; es la «evaluación antes de cifrar» que pediste |
| E. Gestor de secretos externo | Sí | Sí | Nueva dependencia, cuenta y costo |
**Recomendación:** **C ahora** (sin cambios), y para varias empresas **elegir entre D y E** con una evaluación detallada **antes de implementar nada**. **No usar Vault tal como está.** (Vault puede seguir sirviendo a futuro para valores de menor riesgo.)

## 4. Correcciones necesarias (para tu aprobación; nada se aplica sin ella)
| # | Corrección | Tipo | Efecto |
|---|---|---|---|
| C1 | Refinar `verificar-inicial`: reconocer `public.rls_auto_enable()` como función de plataforma (`INFO`) **solo si** coincide la huella `md5(prosrc)` fijada (valor calculado a partir de la definición del registro: `c44fb229ea8a6b0afd04a0a33261c16c`; si no coincide, la fila `REVISAR` imprime la huella real para ajustar), es `SECURITY DEFINER` con `search_path = pg_catalog` y la usa un disparador de evento `ensure_rls` en `ddl_command_end`. Cualquier otra función sigue siendo `REVISAR`. | Código de verificación (solo lectura) | Quita el falso bloqueo sin relajar la regla general; falla cerrado si Supabase cambia la función |
| C2 | Añadir una pasada de pruebas locales y de CI con la **definición real** de la función y su disparador instalados. | Pruebas | Garantiza que ninguna migración futura choque con ella |
| C3 | Corregir una etiqueta del diagnóstico: «ACL por defecto: solo el propietario» debe decir «por defecto (PUBLIC puede ejecutar)». | Texto | Evita una lectura equivocada |
| C4 | **Verificar la exposición de `vault` por la API de datos**: lo más rápido es que revises en los ajustes de la API del proyecto la lista de «esquemas expuestos» (no debe incluir `vault`). Puedo añadir una comprobación automática de solo lectura si lo prefieres. | Verificación | Cierra el único «NO VERIFICADO» |
| C5 | Decidir la ruta de credenciales (§3): C ahora y D/E después, con evaluación previa. **No se guarda nada en Vault.** | Decisión | — |

## 5. ¿Podemos avanzar a la etapa 1 de migraciones (1–27)?
- **Técnicamente no hay bloqueo:** la base está vacía y sin historial, Auth es compatible, los roles existen, la función es compatible (probado con su definición real) y **ninguna migración 1–27 usa Vault**; el hallazgo de Vault afecta a una fase posterior (credenciales), no a la etapa 1.
- **Pero hoy `verificar-inicial` marca `REVISAR` por la función**, y la etapa 1 solo debe empezar con la verificación limpia.
- **Para avanzar hacen falta, en este orden:** (1) tu aprobación de **C1** (o tu aceptación escrita de la función como excepción); (2) implementarla, probarla y publicarla; (3) volver a ejecutar `verificar-inicial` (solo lectura, con tu aprobación en `demo-privada`) y obtener **0 `REVISAR`**; (4) **tu autorización expresa** para ejecutar `migraciones-etapa 1`.
**Etapa 1 sigue BLOQUEADA hasta entonces.**
