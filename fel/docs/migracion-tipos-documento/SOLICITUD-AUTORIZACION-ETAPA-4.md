# Procedimiento definitivo · etapa 4 (migración 30, tipos de documento) y publicación de la demostración

Estado (25/11/2026): **PREPARADO Y PROBADO; NO EJECUTADO.** Nada de esto se lanza sin la autorización expresa del propietario y su aprobación en el entorno protegido `demo-privada`. Decisión técnica: `DECISION-MIGRACION-30.md`.

## 1. Qué hace la etapa 4
Aplica a `nexa-demo` la migración 30 `20261115000100_fel_tipos_documento.sql` con el **mismo mecanismo de las etapas 1–3** (carpeta temporal con las 30 migraciones y un único `supabase db push` por el Session Pooler; la CLI aplica solo la pendiente y **registra su versión**).
- **Aditiva:** 2 tablas (`fel_tipos_dte`, `empresa_tipos_documento`), 5 columnas en `documentos` (`tipo_dte`, `documento_origen_id`, `referencia_origen`, `motivo_ajuste`, `tipo_recibo`), 10 funciones, 5 disparadores y 2 políticas.
- **Cifras medidas:** 69 → 71 tablas · 49 → 51 políticas · 185 → 195 funciones · 61 → 66 disparadores (todas las tablas con RLS).
- **No modifica** ninguna función, política ni dato de las migraciones 1 a 29; las filas existentes de `documentos` quedan como `FACT`.
- **No habilita certificar tipos nuevos:** solo `FACT` certifica; NCRE, NDEB y RECI se pueden elegir (borrador, revisión, vista previa) pero la base IMPIDE crear una operación fiscal para ellos.
- No toca NEXA principal, no despliega función, no publica la página y no carga secretos.

## 2. Garantías (probadas en local y en CI)
- **Precondiciones de solo lectura ANTES de tocar nada:** exactamente las 29 anteriores registradas, la 30 ausente (ni a medias), dependencias de la 29 presentes y **catálogo de la 29 sano**. Si algo no cuadra, se niega sin cambiar nada.
- **Confirmación literal** `APLICAR-MIGRACIONES` + aprobación en `demo-privada`.
- **Verificación posterior de solo lectura:** 30 versiones registradas · RLS en todas las tablas · `verificacion-tipos.sql` (todas las filas `ok = true`) · `verificacion-posterior-29.sql` con las cifras de la 30 · dependencias de Auth.
- **Probada en la plataforma real:** la CI aplica las 30 migraciones en la pila local de Supabase (con la función `rls_auto_enable` de la plataforma), corre las 30 suites SQL y las verificaciones anteriores.
- **«publicar» no puede aplicarla por la puerta de atrás:** se niega ante una base con historial y migraciones pendientes.

## 3. Respaldo previo (inmediatamente antes)
- Respaldo vigente: `nexa-demo/20261124-120509-b0bd6343` (instantánea del 24/11/2026 06:04:45 hora de Guatemala; 29 migraciones), **recuperado con éxito** en el equipo del propietario (`docs/migracion-29/RECUPERACION-VERIFICADA-20261124.md`).
- **Recomendación firme:** generar uno nuevo justo antes de aplicar, porque `nexa-demo` pudo recibir cambios desde las 06:04 del 24/11. Con la herramienta ya probada para los estados 28, 29 y 30.

## 4. Reversión
- `reversion-tipos.sql` (editor SQL de Supabase, a mano y solo con autorización) quita **solo** los objetos de la 30 **y** su versión del historial, en una sola sentencia, y **se niega sin borrar nada** si ya hay notas, recibos o configuración por empresa. Con la base recién migrada es segura.
- Si hubiera datos de los tipos nuevos o un daño mayor: restauración desde respaldo (`PROCEDIMIENTO-RECUPERACION-DESDE-R2.md`), con sus límites (roles, extensiones, `auth`/`storage`/`vault`, restauración real en Supabase sin probar).
- Tras cualquier restauración no se reactiva la certificación: se concilia con Digifact (`RECUPERACION-Y-CONCILIACION.md`).

## 5. Pasos exactos (GitHub → Actions, rama `fel-proveedores-diseno`; cada ejecución la apruebas en `demo-privada`)
**A. Respaldo nuevo**
1. «NEXA FEL · respaldo de nexa-demo» → `accion = respaldo-persistente`. Resultado esperado: «ENSAYO DE RESPALDO Y RESTAURACIÓN: OK» y «RESPALDO PERSISTENTE: CONSERVADO EN R2». Anota el nombre `nexa-demo/AAAAMMDD-HHMMSS-xxxxxxxx` y el SHA-256.
2. *(Opcional, 5 minutos, certeza total)* en tu Windows: `powershell -ExecutionPolicy Bypass -File .\tools\recuperar-respaldo.ps1 -Base nexa-demo/AAAAMMDD-HHMMSS-xxxxxxxx -ShaEsperado <sha del paso 1>` → «RECUPERACIÓN VERIFICADA: OK» (29 migraciones, 69 tablas).

**B. Etapa 4**
3. «NEXA FEL · solo migraciones» → `accion = migraciones-etapa`, `etapa = 4`, `confirmar = APLICAR-MIGRACIONES`.
4. Resultado esperado: «precondiciones de la etapa 4 … OK» · inventario previo `69 | 49 | 185 | 61 | …` · «Migraciones aplicadas» · «historial: 30 migraciones registradas» · «tipos de documento (verificacion-tipos.sql …)» OK · «catálogo de la migración 29 con la 30 aplicada» OK · «VERIFICACIÓN DE LA ETAPA 4: OK. SE DETIENE AQUÍ.»
5. *(Recomendado)* repetir el paso 1 para tener un respaldo **posterior** a la 30 (debe decir «30 migraciones … la 30 presente»).

**C. Publicar la demostración** (otra autorización; no hace falta antes de la etapa 4 para que la demostración siga funcionando como antes)
6. «NEXA FEL · publicación privada (manual)» → `modo = verificar` (no toca nada; muestra el plan y comprueba secretos y conectividad).
7. `modo = publicar`, `confirmar = PUBLICAR`, **`digifact = apagado`** y los `digifact_nit/cui/correo` apagados. Hace, en este orden: comprobaciones previas → Cloudflare Pages (crear o reutilizar el proyecto) → migraciones (guardia del historial: 30 registradas y 0 pendientes; el `db push` no aplica nada) → aprovisionamiento idempotente de la base y las cuentas de demostración → construcción → despliegue de la función → secretos y página → prueba de humo contra https://nexa-fel-demo.pages.dev. **Escribe datos de prueba en `nexa-demo`** (la prueba de humo crea una factura simulada).
8. Resultado esperado: «LISTO: https://nexa-fel-demo.pages.dev».

**D. Pruebas funcionales desde la web y el móvil** (checklist en `docs/tipos-documento.md`)
- FACT: crear, revisar, vista previa, PDF y certificación **simulada**.
- NCRE y NDEB: exigen una FACT certificada de la misma empresa y receptor como origen; borrador, revisión y vista previa; **la certificación está bloqueada**.
- RECI: habilitarlo por empresa en Configuración; borrador, revisión y vista previa; **certificación bloqueada**.
- El resto de tipos aparece como «pendiente» y no se puede elegir.

## 6. Riesgos pendientes
| Riesgo | Mitigación |
|---|---|
| Fallo durante `db push` | La CLI aplica la migración en una transacción; si falla no queda nada a medias. Las precondiciones se comprueban antes. |
| `nexa-demo` cambió desde el respaldo del 24/11 | Respaldo nuevo antes de aplicar (paso 1) |
| Restauración real en Supabase sin probar; roles, extensiones, `auth`/`storage`/`vault` no están en el respaldo | Límite declarado; la reversión SQL cubre el caso normal |
| Token de R2 con lectura y escritura; falta bloqueo de retención | Pendiente del propietario (token de solo lectura para recuperar; retención del bucket) |
| La publicación escribe datos de prueba en `nexa-demo` | Es la demostración simulada; Digifact y correo quedan apagados |

## 7. Lo que NO incluye
Habilitar la certificación de NCRE/NDEB/RECI, emitir documentos reales, enviar correos, ni aplicar el rol restringido `nexa_fel_app`.

## 8. Decisión que se pide
Autorizo (☐ el respaldo nuevo y la etapa 4) · (☐ después, la publicación de la demostración con Digifact y correo apagados).
