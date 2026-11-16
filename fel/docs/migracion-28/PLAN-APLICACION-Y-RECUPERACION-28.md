# NEXA FEL · Plan de aplicación (migraciones 1–27 y luego la 28) y recuperación ante fallos

**PROPUESTA: nada de esto se ha ejecutado ni se ejecuta sin autorización expresa de cada etapa.** Destino único: proyecto Supabase **nexa-demo** (vacío, plan Free, simulado). Hoy: 0 migraciones aplicadas.

## 0. Lo que ya está preparado (solo en el repositorio, sin ejecutar en la nube)
- **Flujo nuevo `.github/workflows/migraciones-nube.yml`, «solo migraciones»**: manual, entorno protegido `demo-privada` (aprobación obligatoria), rama fija, **solo 4 secretos de base de datos** (referencia del proyecto, token de Supabase, contraseña de la base y cadena de conexión). **No** recibe ni usa secretos de la función, de Cloudflare ni de la demostración; no instala Deno ni Node; no despliega función ni frontend. Está separado del flujo `publicar-nube.yml` (que sigue igual) para no relajar su garantía de «un único trabajo».
- **Acciones nuevas en `tools/supabase-hospedado.sh`**: `migraciones-etapa 1|2` y `verificar-etapa 1|2`.
  - Etapa 1 = migraciones 1–27; etapa 2 = migración 28. Cada etapa es una ejecución distinta con su propia aprobación.
  - Aplicar exige la **confirmación literal** `APLICAR-MIGRACIONES` (también dentro del script, no solo en el flujo) y **precondiciones exactas**: etapa 1 solo con base **vacía y sin historial**; etapa 2 solo si están registradas **exactamente las 27**. Si no, se niega sin llamar a la CLI.
  - La CLI trabaja sobre una **carpeta temporal con solo las migraciones de la etapa**: nunca ve ni aplica las posteriores (sin `--include-all`).
  - Al terminar corre la **verificación de solo lectura** de esa etapa y **se detiene**.
- **Pruebas (todas locales, con CLI y psql falsos):** `tools/test-supabase-hospedado.sh` (23 comprobaciones nuevas) y `tools/verificar-publicacion.py` (garantías estáticas: el flujo no menciona función, Cloudflare, Wrangler, service_role; solo 4 secretos; solo las dos acciones por etapas; un único `db push` acotado a la carpeta de la etapa; todas las consultas en solo lectura; nada imprime la contraseña).

## 1. Qué falta antes de aplicar (requiere tu autorización)
1. **Push** del commit con estos cambios. **Al subir el flujo nuevo, GitHub crea una ejecución de registro** (como ya ocurre con `digifact-test.yml`): el trabajo se **omite** porque el evento no es manual; no pide aprobación, no recibe secretos y no ejecuta ninguna migración. Es la única forma de poder lanzarlo después por API. Si prefieres evitarla, se puede omitir el disparador de registro y lanzarlo solo desde la interfaz de GitHub, sabiendo que un flujo que no está en la rama principal no aparece allí.
2. Que apruebes cada etapa en `demo-privada` y escribas `APLICAR-MIGRACIONES` en la ejecución.

## 2. Secuencia propuesta, con puntos de aprobación separados
| Paso | Ejecución | Qué comprueba o hace | Aprobación |
|---|---|---|---|
| A | `migraciones-nube` · **`verificar-inicial`** (reconoce la función de plataforma `rls_auto_enable` solo con su huella verificada; ya diagnosticada) y, aparte, **`verificar-api-vault`** (¿expone la API el esquema vault?; requiere el secreto público `DEMO_SUPABASE_ANON_KEY`) (acción por defecto; antes de aplicar) | **Solo lectura estricta** (transacción de solo lectura + sesión forzada; solo 2 secretos; sin CLI; sin ruta hacia migraciones): base vacía, roles, dependencias de Auth, **Vault** y privilegios. Falla si algo está para REVISAR. | Tu aprobación en `demo-privada` (**todavía no ejecutada**) |
| **B1** | **`migraciones-etapa` · etapa 1** (`APLICAR-MIGRACIONES`) | Aplica las **27** a una base vacía. | **Aprobación 1** (apply) |
| V1 | (automática al final de B1) | 27 registradas; 67 tablas **todas con RLS**; `fel_verificar_dependencias_auth()` sin faltantes. **Se detiene.** | Me entregas/leo el resultado; tú decides seguir |
| **B2** | **`migraciones-etapa` · etapa 2** (`APLICAR-MIGRACIONES`) | Aplica la **28**; solo se ejecuta si están **exactamente** las 27. | **Aprobación 2** (apply) |
| V2 | (automática al final de B2) | 28 registradas, RLS en todas, dependencias de Auth y el **catálogo de la 28** (`verificacion-posterior-28.sql`, solo lectura). **Se detiene.** | Tú decides lo siguiente |
Ninguna de estas etapas despliega función, sitio, ni siembra datos, ni certifica, ni activa emisión: todo sigue `simulado`.

## 3. Si algo falla
| Situación | Qué pasa y qué se hace |
|---|---|
| Precondición no cumplida (base no vacía, historial distinto, confirmación faltante, otra referencia) | La etapa se **niega sin llamar a la CLI**. Se corrige y se repite. |
| Falla la conexión | No se aplica nada; el flujo existente `verificar` (diagnóstico de contraseña) sigue disponible. |
| Falla una migración durante `db push` | La CLI se detiene en el primer fallo. **A verificar:** si envuelve cada archivo en una transacción (no lo he comprobado). La 28 está escrita para repetirse sin efecto lateral y termina con una comprobación interna que la anula si algo no queda como se declara. No se reintenta a ciegas: primero `verificar-etapa` y lectura del estado. |
| Falla la verificación posterior | El flujo termina en **rojo** y se detiene. Decidimos: corrección hacia adelante (nueva migración) o reversión. |
| La 28 causa un problema operativo comprobado | `reversion-28.sql` (probado en local; no toca datos), solo con tu autorización. |
| Se aplicó algo que no debía | `nexa-demo` está vacía y es exclusiva de la demostración: se puede recrear con las migraciones sin datos que perder. **A verificar:** copias de seguridad del plan Free. |
| Se necesita borrar una empresa creada por error | Lo normal es **suspenderla**. Solo si está **vacía** existe el procedimiento controlado `eliminar-empresa-excepcional.sql` (ver informe §7). |

## 4. Después de aplicar
Mantener `main` y NEXA principal intactos. Las etapas siguientes (credenciales por empresa tras verificar Vault, persistencia real en TEST, almacenamiento privado, reglas fiscales verificadas, plantillas, 28b) requieren cada una su autorización. La certificación real en TEST sigue bloqueada.
