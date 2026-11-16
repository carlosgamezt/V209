# NEXA FEL · Diagnóstico de la verificación inicial de `nexa-demo` (ejecución #3)

Fuente: registro de la ejecución #3 de «solo migraciones» (acción `verificar-inicial`, rama `fel-proveedores-diseno`, commit `b2feb29`). **Solo lectura**: no se modificó nada. Los secretos aparecen como `***` en el registro.
**Etapa 1 (migraciones 1–27) sigue BLOQUEADA.**

## 1. Resultado real de `nexa-demo`
| Comprobación | Resultado | Estado |
|---|---|---|
| Sesión de solo lectura (transacción explícita `READ ONLY` + sesión forzada) | `transaction_read_only = on` | **OK** |
| Versión de PostgreSQL | 17.11 | OK |
| Tablas en `public` / historial de migraciones | 0 / no existe | OK (base vacía, sin migraciones) |
| Roles `anon`, `authenticated`, `service_role` | existen los tres | OK |
| El rol de la conexión puede crear en `public` | sí | OK |
| Supabase Auth: 9 columnas (`users`, `mfa_factors`, `sessions`) y `auth.uid()` | todas presentes | **OK** (compatibilidad de Auth) |
| **Funciones propias en `public`** | **1 (esperado 0)** | **REVISAR** (único hallazgo) |
| Esquemas | auth, extensions, graphql, graphql_public, pgbouncer, public, realtime, storage, vault | INFO |
| Disparadores de evento | 7 | INFO |
| `supabase_vault` | disponible e **instalada 0.3.2** | INFO |
| `pgsodium` | disponible 3.1.8, **no instalada** | INFO |
| USAGE sobre el esquema `vault` | anon = no · authenticated = no · **service_role = SÍ** | INFO → ver §4 |
| Privilegios por defecto de `public` | anon, authenticated, postgres, service_role | INFO |
| `service_role` omite RLS | sí (así lo documenta Supabase) | INFO |
**Tablas y migraciones existentes:** ninguna. **Auth:** compatible. **Vault:** instalada y operativa; el detalle de privilegios por objeto **NO VERIFICADO** todavía (§4).

## 2. La función propia de `public`
**Lo que se sabe con certeza:** el registro solo da el **conteo** (1); no da nombre, propietario ni definición. **No he podido leerlos todavía**: no tengo acceso directo a la base, y la única forma de consultarla es una acción de solo lectura en el flujo.
**Hipótesis fuerte (no confirmada):** es `public.rls_auto_enable()` con su disparador de evento `ensure_rls`. Indicios:
- La documentación oficial de Supabase ([Event Triggers](https://supabase.com/docs/guides/database/postgres/event-triggers.md)) publica exactamente esa función y ese disparador («auto enable Row Level Security»): al terminar un `CREATE TABLE` en `public`, ejecuta `ALTER TABLE … ENABLE ROW LEVEL SECURITY`.
- Un proyecto Supabase estándar trae 6 disparadores de evento; `nexa-demo` tiene **7**.
- Mi comprobación de «funciones propias» excluye solo las de extensiones, y una función de plataforma instalada así queda fuera de esa exclusión.
**Qué hace falta para confirmarlo:** la acción de solo lectura `diagnostico-inicial` (preparada, ver §5) lista nombre, argumentos, propietario, definición, privilegios, el disparador de evento que la usa, otros usos y los 7 disparadores de evento.

### ¿Es un conflicto real con las migraciones 1–27 (y la 28)? — Probado en local con la hipótesis
Instalé en una base local la función y el disparador **copiados de la documentación oficial** y apliqué todo:
- Las **28 migraciones se aplican sin error** y quedan las **67 tablas con RLS**.
- Pasan las **28 suites SQL**, la **concurrencia (26 escenarios)**, el procedimiento excepcional y la verificación inicial.
- Razón: nuestras migraciones ya activan RLS en cada tabla; el disparador solo repite `ENABLE ROW LEVEL SECURITY` (idempotente). No hay colisión de nombres con las funciones `fel_*`.
**Conclusión provisional:** si la función es la hipotética, **no es un conflicto**; es una salvaguarda de la plataforma, compatible y hasta útil. **No se elimina ni se toca.**
**Límite:** la prueba usa la función de la documentación, no la instalada en `nexa-demo`; hasta ver la definición real no se puede afirmar con certeza. Si fuera otra función, se evaluaría por su definición.
**Dos observaciones:** (a) nuestra comprobación «0 funciones propias» es demasiado estricta para una función de plataforma; (b) en la emulación local la función queda con EXECUTE para `anon`, `authenticated` y `service_role` por los privilegios por defecto; una función de disparador de evento no se puede invocar a mano, pero el diagnóstico verificará los privilegios reales.

## 3. Dependencias y usos de esa función
**NO VERIFICADO en `nexa-demo`.** `diagnostico-inicial` consulta: el disparador de evento que la ejecuta, disparadores de tabla que la usan, objetos que dependen de ella (`pg_depend`), otras funciones que la mencionan por nombre y las llamadas registradas. En la emulación local: solo la usa el disparador de evento `ensure_rls`, y ninguna otra función ni objeto.

## 4. Vault y privilegios de `service_role`
**Verificado en el registro:** `service_role` **tiene USAGE sobre el esquema `vault`** (`anon` y `authenticated` no). USAGE solo permite «ver» el esquema; lo decisivo son los privilegios sobre sus objetos:
- `vault.decrypted_secrets` (la vista que descifra) y `vault.secrets`: SELECT, INSERT, UPDATE, DELETE por rol.
- Las funciones de `vault` (`create_secret`, `update_secret`…): EXECUTE por rol.
- Membresías y exposición del esquema por la API de datos (PostgREST).
**NO VERIFICADO todavía**; `diagnostico-inicial` lo consulta **sin leer el contenido de ningún secreto** (solo privilegios y catálogo; una guarda estática impide leer `vault.secrets` o `vault.decrypted_secrets`).
**Por qué importa (documentación oficial de Vault):** «anyone that has access to the view has access to decrypted secrets». Y `service_role` omite RLS y es la llave que usa la API de servidor. Si `service_role` pudiera hacer SELECT sobre `vault.decrypted_secrets`, **una llave de servicio filtrada podría leer las credenciales de todas las empresas**. Si no puede, el riesgo baja a lo que exponga nuestra propia función de lectura.

## 5. ¿Pueden guardarse las credenciales Digifact de forma segura con la configuración actual?
**Respuesta honesta: todavía no se puede afirmar, y hoy no se guardan en la base** (las credenciales de TEST están como secretos del entorno de GitHub).
- **A favor (verificado):** Vault 0.3.2 instalada; cifrado autenticado con clave por proyecto fuera de la base (documentación oficial); `anon` y `authenticated` sin USAGE sobre `vault`; Auth compatible.
- **Pendiente decisivo (NO VERIFICADO):** los privilegios reales de `service_role` sobre `decrypted_secrets`, `secrets` y las funciones de `vault`, y si `vault` está expuesto por la API de datos.
- **Criterio de decisión (tras el diagnóstico):**
  1. Si `service_role` **no** puede leer `decrypted_secrets` ni ejecutar funciones que devuelvan secretos y `vault` **no** está expuesto: Vault es adecuado con el diseño ya propuesto (lectura solo por función en esquema privado, rol dedicado, auditoría).
  2. Si `service_role` **sí** puede leer: **no** se guardarán credenciales en Vault con esa configuración. Opciones para tu decisión: (a) revocar esos privilegios a `service_role` (cambio sobre un esquema gestionado por Supabase: requiere pruebas y tu aprobación; puede revertirse en una actualización de Supabase); (b) cifrado por sobre con clave fuera de la base (requiere la evaluación de alternativas que pediste); (c) mantener las credenciales fuera de la base (secretos de entorno por empresa) mientras haya una sola empresa.

## 6. Propuesta de corrección (para tu aprobación; nada se aplica sin ella)
| # | Propuesta | Efecto | Estado |
|---|---|---|---|
| P1 | **Ejecutar `diagnostico-inicial`** (solo lectura; mismas 4 capas y mismos 2 secretos que `verificar-inicial`) para identificar la función y consultar privilegios de Vault. | Cierra los puntos «NO VERIFICADO». | Preparado y probado en local; **requiere push, tu aprobación en `demo-privada` y la ejecución** |
| P2 | **Refinar `verificar-inicial`**: aceptar como `INFO` una función de plataforma **solo si** es `rls_auto_enable` con las características de la documentación (SECURITY DEFINER, `search_path=pg_catalog`, usada por un disparador de evento `ensure_rls` en `ddl_command_end`); cualquier otra función sigue siendo `REVISAR`. | Evita bloquear por una salvaguarda de la plataforma sin relajar la comprobación general. | Propuesta; se implementa tras ver la definición real |
| P3 | **No tocar la función**; añadir una pasada de pruebas locales y de CI con el disparador de evento instalado (la que hice a mano) para que ninguna migración futura choque con ella. | Protege contra regresiones. | Propuesta |
| P4 | **Vault**: decidir según §5 tras P1. No se guardan credenciales hasta entonces. | — | Pendiente de P1 |
| P5 | **Etapa 1 bloqueada** hasta: P1 ejecutada, función confirmada, P2 decidida y revisión de §5. | — | Vigente |
**No** propongo eliminar la función, cambiar privilegios ni ejecutar migraciones.
