# Configuración del ensayo 1E en `nexa-fel-test` (GitHub Actions)

**Regla de oro: ninguna credencial se escribe en archivos, commits, registros ni en el chat.** Los valores solo se cargan como *secretos del entorno* de GitHub. Este ensayo **no toca `nexa-demo`**, no usa Resend, no envía correos y no certifica nada.

## 1. Antes de crear el proyecto (verificación de costos)
Organización de Supabase con plan Free y cupo para un proyecto activo más (confirmado por consulta: costo adicional USD 0.00). Si al crearlo Supabase ofrece un plan de pago o muestra un cargo, **detente y avisa**.

## 2. Lo que debe tener `nexa-fel-test` (aislado y sin comunicación externa)
- Proyecto **vacío**, con un nombre distinto de `nexa-demo` y contraseña de base **nueva** (no reutilizar ninguna).
- Sin *Database Webhooks*, sin funciones Edge, sin `pg_cron`/tareas programadas, sin proveedores de correo ni SMTP, sin Storage con datos, sin integraciones de terceros.
- Solo datos **simulados**: dos empresas, establecimientos 2 y 67 (los crea el propio ensayo desde `fixture-sesion.sql`). No se copia nada de `nexa-demo`: ni clientes, ni credenciales fiscales, ni sesiones.

## 3. Entorno protegido en GitHub (una sola vez, lo haces tú)
1. Repositorio → *Settings → Environments → New environment* → nombre exacto **`ensayo-1e`**.
2. *Required reviewers*: tu usuario. *Deployment branches*: solo `fel-proveedores-diseno`.
3. *Environment secrets* (nombres exactos; **no** reutilices los `DEMO_`):

| Secreto | Qué es | Dónde se obtiene |
|---|---|---|
| `ENSAYO_REF` | referencia del proyecto `nexa-fel-test` | Supabase → Project Settings → General → *Reference ID* |
| `ENSAYO_URL_ADMIN` | `postgres://postgres.<ref>:<clave>@<host-del-pooler>:5432/postgres` (session pooler) | Supabase → *Connect* → *Session pooler* (sustituye la contraseña) |
| `ENSAYO_URL_APP` | `postgres://nexa_app.<ref>:<clave-nexa-app>@<host-del-pooler>:6543/postgres` (transaction pooler) | mismo host, puerto 6543, usuario `nexa_app.<ref>` |
| `ENSAYO_CLAVE_NEXA_APP` | contraseña nueva que se asignará al rol `nexa_app` solo en este proyecto | la generas tú (≥ 32 caracteres aleatorios) |

## 4. Verificaciones previas a cualquier ejecución (automáticas)
- `tools/verificar-publicacion.py` (CI): el flujo es solo manual, usa **su** entorno, solo secretos `ENSAYO_*`, ningún secreto `DEMO_`, ningún nombre de la demostración en el código, secretos solo en un paso, sin artefactos ni eco de secretos.
- `ensayo-1e.sh validar` (modo por defecto, no toca la base): exige `ENSAYO_CONFIRMO=nexa-fel-test`, que el usuario de cada cadena termine en `.<ENSAYO_REF>` y que `nexa_app` sea `nexa_app.<ref>`, y se **niega** si `ENSAYO_REF` coincide con `FEL_DEMO_PROYECTO_REF`.
- Aprobación manual del entorno `ensayo-1e` en cada ejecución.

## 5. Cómo ejecutarlo
*Actions → «NEXA FEL · Ensayo 1E (nexa-fel-test)» → Run workflow* (rama `fel-proveedores-diseno`):
1. `paso = validar` (sin base) → comprueba la forma de los secretos.
2. `paso = todo`, `confirmar = ENSAYAR-EN-NEXA-FEL-TEST`, `r2_esperado = abierto` (hoy) → aprobar el entorno. Aplica migraciones y propuestas, crea datos simulados y corre las pruebas como `nexa_app` por el pooler.
3. Cuando se completen las fases de corrección de R2: repetir con `r2_esperado = cerrado`.

## 6. Qué entrega
Por etapa: identidad del administrador del ensayo, migraciones aplicadas, comprobaciones de solo lectura (`ok=t/f`), conexión de `nexa_app` por el pooler (sin super ni BYPASSRLS, funciones ejecutables), pruebas de seguridad (SQL como `nexa_app`, sesiones, administración, envoltorios), sonda R2 por clases y RLS sin política. **Los registros no contienen cadenas de conexión ni contraseñas.**
Limpieza: al terminar, el proyecto puede pausarse o eliminarse desde el panel de Supabase; no hay datos reales.
