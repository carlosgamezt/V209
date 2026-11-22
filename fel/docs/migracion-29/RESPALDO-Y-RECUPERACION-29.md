# Respaldo y recuperación antes de aplicar la migración 29 (nexa-demo)

Estado: **preparación**. Nada de esto se ha ejecutado contra `nexa-demo` salvo la verificación de solo lectura de la etapa 2 (corrida 18 del 21/11/2026, 18:02 hora de Guatemala).
Regla de todo el documento: **no se supone que exista un respaldo por el hecho de que Supabase tenga esa función.** Un respaldo cuenta solo si se confirmó con evidencia y se probó que se puede restaurar.

## 1. Respaldo: qué existe, qué sabemos y cómo confirmarlo

| Opción | Qué es | Plan | Estado en `nexa-demo` |
|---|---|---|---|
| Copias diarias (físicas) | Supabase hace una copia por día; **Pro: 7 días**, Team: 14, Enterprise: hasta 30 | Solo planes de pago | **SIN VERIFICAR** |
| PITR (punto en el tiempo) | WAL continuo sobre una copia física; recuperación a un instante (RPO de ~2 min). Es un **complemento de pago**; con PITR activo ya no se toman las copias diarias | Planes de pago + complemento | **SIN VERIFICAR** |
| «Restore to a new project» | Clona una copia física en un proyecto nuevo (no sobrescribe el actual) | Exige copias físicas (plan de pago) | **SIN VERIFICAR** |
| Plan **Free** | **No hay copias automáticas** ni descarga de copias; Supabase recomienda exportar con la CLI (`db dump`) y guardar copias fuera de Supabase | Free | La documentación interna dice que `nexa-demo` es **Free**: **no confirmado** |
| **Respaldo lógico propio** (`pg_dump`) | Archivo `.dump` de `public` y `supabase_migrations` hecho por nosotros; **funciona en cualquier plan** | Todos | **No existe todavía.** Es la opción que SÍ podemos garantizar |

Lo que **no** cubre ningún respaldo de base: archivos de Storage, funciones Edge, ajustes de Auth, claves y variables de entorno (se recrean por separado; esta demostración no depende de Storage).

**Cómo confirmar lo que existe (solo lectura; no lo puedo hacer yo desde esta sesión, que no tiene acceso al panel ni a la API de Supabase):**
1. Panel de Supabase → `nexa-demo` → **Database → Backups**. Anota: pestañas disponibles (Scheduled backups / Point in time), **fecha y hora (Guatemala) de la última copia** y si el botón de restaurar está activo. Un plan Free no muestra copias.
2. Alternativa verificable: `GET https://api.supabase.com/v1/projects/<ref>/database/backups` con tu token personal (permiso de lectura de respaldos). La respuesta trae `pitr_enabled`, la lista `backups` y `physical_backup_data` (copia más antigua y más reciente). `supabase backups list` hace lo mismo. **No pegues el token en ningún chat.**
3. Si hay copias: la **más reciente debe ser posterior a cualquier dato que no se pueda recrear**. En `nexa-demo` solo hay datos simulados y usuarios que `aprovisionar` recrea, pero igual se registra la hora.

Una acción de GitHub de solo lectura que consulte ese endpoint (`verificar-respaldo`) es posible, pero **no existe** y exigiría un commit; queda como propuesta.

## 2. Respaldo lógico antes de la 29 (obligatorio aunque haya copias de Supabase)
Lo haces tú, desde tu computadora, con `pg_dump` 15 o superior y la contraseña de la base en la variable `PGPASSWORD` (no en la línea de comandos ni en un chat):

```
pg_dump "host=<host-del-session-pooler> port=5432 dbname=postgres user=postgres.<ref> sslmode=require" \
  -Fc --schema=public --schema=supabase_migrations -f nexa-demo-antes-29-AAAAMMDD-HHMM.dump
sha256sum nexa-demo-antes-29-AAAAMMDD-HHMM.dump          # anota el SHA-256 y la hora de Guatemala
```
Guarda el archivo **cifrado y fuera de GitHub y de Supabase** (contiene datos de todas las empresas de `nexa-demo`). Los usuarios de Auth no entran en este archivo: `aprovisionar` los recrea.

**Cómo comprobar que el respaldo es válido (no basta con que el archivo exista):**
1. `pg_restore --list <archivo>` lee el archivo y muestra `TABLE DATA public empresas` y `TABLE DATA supabase_migrations schema_migrations`.
2. El SHA-256 no cambia entre el respaldo y la restauración.
3. **Restaurarlo de verdad en una base aparte** (un proyecto Supabase desechable o un PostgreSQL local; **nunca sobre `nexa-demo`**) y comprobar: mismos conteos, historial de 28 migraciones, la 29 ausente y el catálogo de la 28 en solo lectura.

**Ensayo ya hecho en local** (`supabase/tests/respaldo_restauracion_29.sh`, parte de `tools/test-local.sh`; PostgreSQL de prueba, no Supabase): respaldo → `--list` → SHA-256 → restauración en una base aparte → mismos datos → catálogo de la 28 sano → 29 ausente. El ensayo reveló **dos requisitos reales del procedimiento** que ahora forman parte de él:
- **El destino ya tiene el esquema `public`**: se restaura su contenido, no se vuelve a crear el esquema (`pg_restore -L` sin la entrada `SCHEMA - public`); si no, falla con «schema "public" already exists».
- **Privilegios por defecto del destino**: las tablas restauradas heredan los permisos por defecto del destino. Antes de restaurar hay que retirar los de `anon`, `authenticated` y `service_role` (`alter default privileges in schema public revoke all on tables/sequences from …`, `revoke execute on functions from …`); si no, la restauración deja `anon` con 469 privilegios que el original no tenía y el catálogo de la 28 lo detecta. (Supabase lo documenta igual para restauraciones a un proyecto nuevo.)
**Lo que NO está probado:** una restauración sobre Supabase hospedado real (otro proyecto). Sigue **pendiente de probar** y solo se hace con tu autorización, en un proyecto desechable.

## 3. Plan de recuperación si la 29 presenta un problema
Primero **detener**: dejar `FEL_DIGIFACT_TEST` apagado y no autorizar ninguna referencia (`FEL_DIGIFACT_AUTORIZA_REFERENCIA` vacío) mientras se decide. Después, según el caso:

| Situación | Qué hacer | Se pierde algo | Riesgo con Digifact |
|---|---|---|---|
| **A. La 29 falló al aplicarse** (error en la etapa 3) | La migración corre en una transacción: si falla no queda nada a medias. Verificar con `verificar-etapa 2` (la 29 sigue ausente) y corregir hacia adelante | Nada | Ninguno |
| **B. La 29 se aplicó y sus tablas están VACÍAS** (nunca se certificó) | **Reversión**: `docs/migracion-29/reversion-29.sql` (propietario, con tu autorización) + `supabase migration repair --status reverted 20261114000100`; luego `verificar-etapa 2`. Probado en local (idempotente y reaplicable) | Nada | Ninguno: no hubo operaciones |
| **C. Ya existen operaciones o artefactos** | La reversión **se rechaza** (por diseño, no borra rastro fiscal). Camino: **corregir hacia adelante**. Restaurar el respaldo es el último recurso y obliga a conciliar (caso D) | Con restauración, todo lo posterior al respaldo | Alto si se restaura: ver D |
| **D. Restaurar un respaldo ANTERIOR a una certificación** | Restaurar en un proyecto aparte primero; **no** reactivar la certificación; **conciliar con Digifact** antes de cualquier envío (`RECUPERACION-Y-CONCILIACION.md`). El ensayo local confirma el estado: la operación certificada desaparece de la base restaurada, pero Digifact **sí la conserva** | Las operaciones, XML/PDF y el estado fiscal posteriores al respaldo | **Inconsistencia real**: la base no recuerda lo certificado |
| **E. Respaldo más antiguo que 7 días** | El chequeo previo solo ve **7 días** hacia atrás: no detectaría una certificación anterior. **Prohibido** habilitar la certificación hasta conciliar a mano con el reporte de Digifact o ampliar `prevueloDias` | Igual que D | **Una restauración más vieja que la ventana puede permitir una segunda certificación**: está bloqueada por procedimiento, no por código |

**Garantía obligatoria: una restauración nunca recertifica una factura ya emitida.** Lo que la sostiene (cada capa probada en local):
1. **Certificación apagada por defecto** y autorización de **una sola referencia por vez** (variable de entorno de la función: tras restaurar queda apagada hasta que tú la fijes).
2. **Referencia determinista** (empresa, documento, huella del contenido, intento): el mismo documento produce la misma referencia.
3. **Chequeo previo de solo lectura** contra Digifact antes de enviar: si la referencia ya existe, **no se envía** y la operación queda «desconocida» para conciliar; si no se puede verificar, **falla cerrado**. Cubre 7 días.
4. Un resultado incierto **nunca se reenvía solo**; se concilia por la referencia.
5. La conciliación adopta el UUID, serie y número de Digifact y recupera XML y PDF (no certifica nada nuevo).
**Procedimiento tras cualquier restauración:** (1) restaurar sin reactivar nada; (2) `verificar-etapa` (28 o 29 según el caso); (3) listar en Digifact lo certificado después de la fecha del respaldo; (4) por cada documento afectado, **conciliar**, nunca recertificar; (5) solo entonces volver a habilitar y autorizar una referencia a la vez.

## 4. Seguridad: lo que sigue vigente
- **La conexión usa `postgres` con `BYPASSRLS`, y esa arquitectura NO está aprobada para clientes reales ni para operación multiempresa.** Confirmado en `nexa-demo` por la verificación de solo lectura: `usuario=postgres · superusuario=false · omite RLS=true · crea roles=true · propietario de public.documentos=true`. El aislamiento entre empresas depende de las claves foráneas compuestas, los únicos y los disparadores, no de RLS. Aceptable **solo** para la demostración con datos simulados. Antes de clientes reales: rol restringido con RLS forzada (`SEGURIDAD-Y-PERMISOS-29.md`).
- **La comprobación de solo lectura mostró «transacción de solo lectura=off»** (corrida 18). Causa: el Session Pooler de Supabase **no aplicó** `PGOPTIONS="-c default_transaction_read_only=on"`, así que la protección de sesión que el script declaraba **no existía** en `verificar-etapa`; las consultas fueron `SELECT` y el catálogo solo asserts, pero la garantía no era demostrable. **Corregido en local (sin commit):**
  - Cada consulta y cada archivo de catálogo corre dentro de `begin transaction read only … rollback`, que PostgreSQL hace cumplir aunque el pooler ignore `PGOPTIONS`.
  - **Antes de verificar nada**, `verificar-etapa` intenta una **escritura de prueba** (`create temp table`) y exige que PostgreSQL la **rechace** (`cannot execute CREATE TABLE in a read-only transaction`) con `transaction_read_only=on`; si no la rechaza, **falla y no verifica nada más**. La evidencia es el rechazo del servidor, no una declaración del script.
  - Imprime el valor real de `default_transaction_read_only` de la sesión y aclara que no se confía en él.
  - Los SQL de catálogo pasan una revisión estática (`verificar-sql-solo-lectura.py --catalogo`): sin `INSERT/UPDATE/DELETE/CREATE/ALTER/DROP/GRANT…`.
  - Probado con PostgreSQL real: dentro de la transacción la sesión con `default off` no puede escribir; sin ella **sí** podía (por eso se corrigió).
  Esta corrección **todavía no corrió contra `nexa-demo`** (requiere commit y una ejecución autorizada).

## 5. Riesgos que permanecen
1. **No hay respaldo confirmado**: hoy solo hay un indicio (plan Free). Sin respaldo lógico propio, un problema grave obligaría a recrear `nexa-demo` desde las migraciones (aceptable en una demo con datos simulados).
2. **Restauración sobre Supabase hospedado real: sin probar.**
3. **Ventana de 7 días del chequeo previo** frente a restauraciones antiguas (caso E).
4. **Rol `postgres`/`BYPASSRLS`** (sección 4).
5. **La verificación de solo lectura corregida aún no se ejecutó en `nexa-demo`**; la de la corrida 18 no demostraba la solo lectura de sesión.

## 6. Condiciones exactas para autorizar la etapa 3
1. Commit autorizado de las correcciones de solo lectura y del ensayo de respaldo, **CI verde** (pruebas, paquete, navegadores).
2. Una **nueva** corrida de `verificar-etapa` etapa 2 con ese código: debe imprimir **«OK prueba de solo lectura … RECHAZÓ una escritura de prueba»**, 28 registradas, requisitos de la 29 cumplidos y «VERIFICACIÓN DE LA ETAPA 2: OK».
3. **Respaldo confirmado**: o evidencia del panel/API (fecha y hora de la copia, y plan que la incluye), o el respaldo lógico propio hecho, con su SHA-256 anotado y **restaurado y comprobado en una base aparte**.
4. Tokens vigentes en el momento (`DEMO_SUPABASE_ACCESS_TOKEN`, contraseña de la base).
5. Aceptación escrita de que el rol propietario/`BYPASSRLS` es válido **solo para TEST** y de que no se habilitan clientes reales.
6. Autorización independiente para `migraciones-etapa` etapa 3 (escribir `APLICAR-MIGRACIONES`) y aprobación del entorno `demo-privada`.
