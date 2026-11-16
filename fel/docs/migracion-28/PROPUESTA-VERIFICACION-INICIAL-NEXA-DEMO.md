# NEXA FEL · Verificación inicial de `nexa-demo` en modo lectura (IMPLEMENTADA Y PROBADA EN LOCAL; NO EJECUTADA contra `nexa-demo`)

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

## Cómo se ejecuta (implementado; todavía NO se ha ejecutado contra `nexa-demo`)
Acción `verificar-inicial` de `migraciones-nube.yml` (es la acción **por defecto** del flujo) y de `tools/supabase-hospedado.sh`:
- **Secretos mínimos:** su paso recibe solo **2** (`DEMO_SUPABASE_PROYECTO_REF` y `DEMO_BD_URL`). No recibe el token de Supabase, ni la contraseña aparte, ni la confirmación; **la CLI de Supabase ni siquiera se instala** en esa ejecución.
- **Ninguna ruta hacia las migraciones:** el paso ejecuta únicamente `verificar-inicial`; el paso que sí puede aplicar migraciones (etapas) está **excluido por su condición** cuando la acción es `verificar-inicial`; el código de la acción no contiene `supabase`, `db push`, `link`, `--yes` ni lee el token o la confirmación.
- **Conexión de solo lectura, en cuatro capas independientes:**
  1. El SQL solo puede contener `SELECT` (y `\pset`): lo comprueba `tools/verificar-sql-solo-lectura.py` antes de conectar.
  2. Se ejecuta dentro de **`begin transaction read only … rollback`** (`tools/sql-solo-lectura.sh`): PostgreSQL rechaza cualquier escritura y nunca se confirma nada.
  3. La sesión se fuerza a solo lectura con `PGOPTIONS="-c default_transaction_read_only=on"` (la misma técnica que ya funcionó en los «verificar» anteriores contra el pooler).
  4. El resultado debe incluir la fila `sesión de solo lectura | on | on | OK`; si no, la acción **descarta** el resultado y falla. Cualquier fila `REVISAR` también hace fallar la acción.
- **Pruebas** (todas locales, ninguna toca la nube): `tools/test-supabase-hospedado.sh` (CLI y psql falsos; la acción corre con un PATH **sin** `supabase`), `tools/verificar-publicacion.py` (guardas estáticas, verificadas con pruebas de mutación) y `supabase/tests/verificacion_inicial_solo_lectura.sh` (**PostgreSQL real**: el envoltorio ejecuta el SQL real y rechaza CREATE, INSERT, UPDATE, DELETE, TRUNCATE, DROP, ALTER, GRANT, SELECT INTO, secuencias, COMMIT + escritura y funciones que escriben; la base queda idéntica; control negativo: sin envoltorio ni sesión de solo lectura la misma sentencia sí escribe).

## Lectura de los resultados (criterios para decidir)
- Todo `OK`: se puede pedir la aprobación de la etapa 1.
- Algún `REVISAR` en roles o columnas de Auth: **no se aplica**; se documenta qué falta y se diseña la adaptación.
- Tablas o historial ya presentes: **no se aplica**; la etapa 1 exige base vacía (si hubiera datos ajenos, se decide contigo).
- `INFO` de Vault: alimenta la decisión sobre credenciales por empresa (diseño §1).
