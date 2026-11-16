# NEXA FEL · Propuesta: verificación inicial de `nexa-demo` en modo lectura (SOLO PROPUESTA: nada se ha implementado ni ejecutado)

## Objetivo
Antes de aplicar la etapa 1 (migraciones 1–27), comprobar sin modificar nada que `nexa-demo` está **vacío**, que ofrece lo que las migraciones **necesitan** (roles, Supabase Auth) y averiguar los datos que hoy están «a verificar» (Vault, privilegios por defecto, extensiones).

## Qué se comprobaría (SQL ya redactado y probado en local: `verificacion-inicial-nexa-demo.sql`)
Solo `SELECT` sobre el catálogo del sistema; no lee datos de negocio, correos ni contraseñas. Cada fila indica comprobación, resultado, esperado y estado `OK` / `REVISAR` / `INFO` (`INFO` nunca bloquea).
| Grupo | Comprobaciones |
|---|---|
| Sesión | La sesión está en **solo lectura** (`transaction_read_only = on`); versión de PostgreSQL (≥ 15); el rol de la conexión puede crear en `public`. |
| Roles | Existen `anon`, `authenticated` y `service_role`; `service_role` omite RLS (informativo). |
| Dependencias de Auth | Existen las 9 columnas de `auth.users`, `auth.mfa_factors` y `auth.sessions` que usan las 27 migraciones y la función `auth.uid()` (las mismas que revisa `fel_verificar_dependencias_auth()`, pero **antes** de tener migraciones, que es cuando importa). |
| Base vacía | 0 tablas y 0 funciones propias en `public`; no existe el historial de migraciones. |
| Vault (informativo) | Disponibilidad e instalación de `supabase_vault`, `pgsodium` y `pgcrypto`; USAGE de `anon`/`authenticated`/`service_role` sobre el esquema `vault` (esperado: ninguno). |
| Contexto (informativo) | Esquemas no del sistema, privilegios por defecto de `public`, publicaciones, disparadores de evento. |

## Validación local realizada
- Contra una base solo con el emulador de Supabase (equivalente a «vacía»): todas las comprobaciones `OK`, ninguna `REVISAR`; corre bajo `default_transaction_read_only=on`.
- Control negativo: con una tabla en `public`, «tablas en public» pasa a `REVISAR`.
- El archivo no contiene ninguna sentencia de escritura, y un `CREATE TABLE` bajo la misma sesión es rechazado por PostgreSQL.
**Límite:** el emulador no es Supabase; los resultados reales (Vault, privilegios por defecto, columnas de Auth del proyecto) solo se conocen ejecutándolo en `nexa-demo`.

## Cómo se ejecutaría (todavía NO implementado, requiere tu autorización)
Opción recomendada: una acción nueva `verificar-inicial` en `tools/supabase-hospedado.sh`, y una opción más en la lista `accion` de `migraciones-nube.yml`:
- Misma barrera que `verificar-etapa`: entorno `demo-privada` con aprobación, rama fija, **solo los 4 secretos de base de datos**, `psql` con la sesión forzada a solo lectura y salida sin valores sensibles; el archivo SQL se ejecuta con `-f`.
- No pide `APLICAR-MIGRACIONES` ni llama a la CLI de Supabase.
- Pruebas: psql falso en `test-supabase-hospedado.sh` (solo lectura, sin CLI, sin contraseña en la salida, falla si hay un `REVISAR`) y una guardia en `verificar-publicacion.py` (la acción no menciona `db push`, `link`, función ni Cloudflare).
Alternativa sin código nuevo: el modo `verificar` ya existente de `publicar-nube.yml` hace una verificación de solo lectura (conexión y estado), pero recibe **12** secretos y no comprueba Auth, Vault ni los privilegios; por eso no lo recomiendo como verificación inicial.

## Lectura de los resultados (criterios para decidir)
- Todo `OK`: se puede pedir la aprobación de la etapa 1.
- Algún `REVISAR` en roles o columnas de Auth: **no se aplica**; se documenta qué falta y se diseña la adaptación.
- Tablas o historial ya presentes: **no se aplica**; la etapa 1 exige base vacía (si hubiera datos ajenos, se decide contigo).
- `INFO` de Vault: alimenta la decisión sobre credenciales por empresa (diseño §1).
