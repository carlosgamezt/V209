# NEXA FEL · Plan de aplicación y recuperación ante fallos (PROPUESTA: nada se ejecuta sin autorización expresa)

Destino único: proyecto Supabase **nexa-demo** (vacío, plan Free, simulado). Hoy tiene **0 migraciones aplicadas y 28 pendientes** (las 27 + la 28 una vez confirmada).

## 0. Qué falta antes de poder aplicar (y necesita tu autorización)
1. **Un modo «solo migraciones» en el flujo de publicación.** El modo `publicar` actual encadena migraciones → base → función → Cloudflare Pages → prueba de humo; tú no autorizas desplegar servicios. La acción `migraciones` del script (`supabase db push`) ya existe y es independiente, pero hoy solo se llega a ella dentro de `publicar`. Propongo un modo nuevo `migraciones` (confirmación literal `APLICAR-MIGRACIONES`, mismo entorno protegido `demo-privada`, misma rama restringida, secretos solo en el paso que los usa) y una prueba estática que garantice que ese modo **no** ejecuta función ni Pages. Es un cambio de flujo de CI: no lo hago sin tu autorización.
2. Autorizar el **push** de la rama con la migración 28, su prueba y estos documentos (hoy solo están en un commit local).
3. Decidir **M2** (revocar INSERT/UPDATE directo al rol de servicio): recomiendo dejarlo para una 28b posterior.

## 1. Precondiciones de cada ejecución
- Rama `fel-proveedores-diseno`, commit exacto identificado y verificado en GitHub.
- «verificar» (solo lectura) en verde: conexión a PostgreSQL, base vacía, migraciones pendientes = las esperadas.
- Aprobación humana en el entorno `demo-privada` y confirmación literal escrita.
- Ningún otro flujo ejecutándose (los grupos de concurrencia de los flujos ya serializan; se lanza **uno a la vez**).

## 2. Aplicación en dos etapas, con parada entre ambas
**Etapa 1: las 27 migraciones** (todavía sin la 28)
1. Aplicar con el modo «solo migraciones».
2. Verificación de solo lectura: `estado` (tablas = 67, con RLS = 67, migraciones registradas = 27, pendientes = 0) y `select public.fel_verificar_dependencias_auth()` (comprueba lo que la base de Supabase debe ofrecer: `auth.users`, `auth.uid()`, `auth.mfa_factors`, `auth.sessions`).
3. Parar y mostrarte el resultado.

**Etapa 2: la migración 28**
1. Aplicar la 28 con el mismo modo.
2. Verificación posterior de solo lectura: `docs/migracion-28/verificacion-posterior-28.sql` con `default_transaction_read_only=on` (catálogo: RLS, privilegios, políticas, cascadas, funciones, disparadores, clave foránea compuesta).
3. Parar y mostrarte el resultado.
No se despliega función ni sitio, no se siembran datos, no se certifica nada y no se activa ninguna emisión (sigue todo en `simulado`).

## 3. Si algo falla
| Situación | Qué pasa y qué se hace |
|---|---|
| Falla la conexión o la verificación previa | No se aplica nada. Se corrige y se repite «verificar». |
| Falla una migración **durante** `db push` | Se detiene en el primer fallo. La 28 es **idempotente** y termina con una comprobación interna que la anula si algo no quedó como se declara. **A verificar:** si el CLI envuelve cada archivo en una transacción (no lo he comprobado); por eso la 28 está escrita para poder repetirse sin efecto lateral. No se reintenta a ciegas: primero se lee el estado con `estado`. |
| La 28 aplicada causa un problema operativo comprobado | `docs/migracion-28/reversion-28.sql` (probado localmente, dos veces seguidas y con reaplicación posterior de la 28). Deja la base como estaba tras las 27. No toca datos. Se ejecuta solo con tu autorización. |
| La verificación posterior falla tras aplicar | Se informa el punto exacto (cada comprobación tiene un mensaje propio); no se sigue; se decide entre corrección hacia adelante (nueva migración) o reversión. |
| Se aplicó algo que no debía | La base `nexa-demo` está vacía y es exclusiva de la demostración: si hiciera falta, se recrea desde cero con las migraciones (sin datos que perder). **A verificar:** si el plan Free ofrece copias de seguridad; no hay datos reales que proteger hoy. |
| Se pierde el historial de migraciones | `supabase_migrations.schema_migrations` registra cada versión; la lectura de «estado» muestra pendientes y aplicadas; no se reaplica lo ya aplicado. |

## 4. Después de aplicar
- Mantener `main` y NEXA principal intactos.
- Siguientes etapas, cada una con su autorización: credenciales por empresa (tras verificar Vault), persistencia de operaciones reales en TEST (migración 29), almacenamiento privado y política de 10 años, reglas fiscales verificadas, plantillas.
- La certificación real en TEST sigue bloqueada hasta que existan la persistencia y las reglas fiscales verificadas.
