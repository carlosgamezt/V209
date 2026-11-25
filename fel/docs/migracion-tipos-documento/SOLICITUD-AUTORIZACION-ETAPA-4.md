# Solicitud de autorización · Etapa 4 (tipos de documento) en `nexa-demo`

Estado (25/11/2026): **PREPARADA, NO EJECUTADA.** Este documento es lo que el propietario revisa para decidir. La etapa 4 solo se lanza con su autorización expresa y su aprobación en el entorno protegido `demo-privada`.

## 1. Qué hace la etapa 4
Aplica a `nexa-demo` la propuesta `20261115000100_fel_tipos_documento.sql` (vive fuera de `supabase/migrations`; las 29 migraciones aprobadas no cambian):
- **Aditiva:** crea 2 tablas (`fel_tipos_dte`, `empresa_tipos_documento`), 5 columnas nuevas en `documentos` (`tipo_dte`, `documento_origen_id`, `referencia_origen`, `motivo_ajuste`, `tipo_recibo`), 9 funciones y 3 disparadores.
- **No modifica** ninguna función, política ni dato de las migraciones 1 a 29, ni la propia 29. Las filas existentes de `documentos` quedan como `FACT`.
- **No habilita certificación de tipos nuevos:** solo `FACT` certifica. NCRE, NDEB y RECI se pueden elegir (borrador, revisión, vista previa) pero la base IMPIDE crear una operación fiscal para ellos.
- RLS activa en las 2 tablas nuevas; `anon` sin acceso; `authenticated` sin escritura directa; funciones nuevas sin ejecución para `anon`/`authenticated`.
- El historial de migraciones **no cambia** (queda en 29 versiones): la propuesta no se registra como migración 30. Es una decisión de diseño; si prefieres registrarla como migración 30, es un cambio aparte y previo.

## 2. Garantías del procedimiento (ya probadas en local y en CI)
- **Precondiciones de solo lectura** antes de tocar nada: exactamente las 29 migraciones registradas (la 29 ya aplicada), la propuesta ausente y sus dependencias presentes. Si algo no cuadra, se detiene sin cambiar nada.
- **Una sola transacción** (`psql --single-transaction`): si cualquier sentencia falla, no queda nada a medias.
- **Verificación posterior automática** con `verificacion-tipos.sql` (solo lectura, todas las filas deben dar `ok = true`): catálogo de 17 tipos, solo FACT certifica, RLS, privilegios, disparadores, documentos existentes como FACT y ninguna operación fiscal sobre un tipo que no certifica.
- Pruebas: `fel/tools/test-tipos-documento.sh` (prueba SQL, precondiciones, verificación, reversión y reaplicación en un PostgreSQL temporal) y la demostración con los tipos, en verde en el CI.
- Exige escribir `APLICAR-MIGRACIONES` y la aprobación en `demo-privada`. Usa los secretos de las etapas anteriores; no despliega, no publica y no toca Cloudflare.

## 3. Respaldo de referencia
- Objeto: `nexa-demo/20261124-120509-b0bd6343` en el bucket privado `nexa-fel-backups` (instantánea del 24/11/2026 06:04:45, hora de Guatemala; 70 tablas, 565 filas, 29 migraciones). SHA-256 del volcado `b0bd634320e97dc9cb4ddcaef17c3e2d2c50a01c24e44faa425bcbf892eec7c8`.
- **Recuperación verificada** en el equipo del propietario el 24/11/2026: descarga, descifrado, SHA-256, `pg_restore --list` y restauración en PostgreSQL 17 aislado, con 70 tablas, 565 filas, 29 migraciones, 69 tablas con RLS y 49 políticas (`docs/migracion-29/RECUPERACION-VERIFICADA-20261124.md`).
- **Antigüedad:** es una fotografía de las 06:04:45 del 24/11. Si `nexa-demo` recibió cambios después, no están en ella. **Recomendación:** generar uno nuevo inmediatamente antes de aplicar (acción `respaldo-persistente`, unos 80 segundos, con tu aprobación en `demo-privada`). El flujo es el mismo ya probado; si quieres certeza total, repites la recuperación en tu equipo con el nuevo nombre (5 minutos). Es decisión tuya si el respaldo del 24/11 basta.
- **Límites del respaldo:** no reproduce roles y membresías, extensiones, disparadores de evento de la plataforma ni `auth`/`storage`/`vault`; no se probó una restauración en un proyecto Supabase real.

## 4. Reversión
- `reversion-tipos.sql` quita **solo** los objetos de la propuesta, en una sola sentencia, y **se niega sin borrar nada** si ya hay notas, recibos o configuración por empresa (esos datos se perderían). Si los hay, la salida es la restauración desde respaldo, con sus límites del punto anterior.
- La reversión no la ejecuta ningún flujo automático: se hace a mano en el editor SQL de Supabase y solo con tu autorización. Con la base recién migrada y sin uso de los tipos nuevos, es segura.

## 5. Riesgos
| Riesgo | Mitigación |
|---|---|
| Un fallo a mitad de la aplicación | Transacción única: no queda nada a medias |
| La base cambió desde el respaldo del 24/11 | Respaldo nuevo antes de aplicar (recomendado) |
| La aplicación rompe algo existente | Es aditiva; verificación posterior; pruebas locales y CI; reversión segura mientras no haya datos nuevos |
| Los tipos nuevos se usan antes de tiempo | NCRE/NDEB/RECI no certifican: la base lo impide |
| La demostración publicada no conoce la base nueva | La demostración degrada a solo Factura si la base no la tiene; **publicar el código es otro paso con su propia autorización** |

## 6. Pasos exactos si autorizas (todos en GitHub → Actions, rama `fel-proveedores-diseno`)
1. *(Recomendado)* Lanzar **«NEXA FEL · respaldo de nexa-demo»** con `accion = respaldo-persistente`, aprobarlo en `demo-privada` y confirmar «RESPALDO PERSISTENTE: CONSERVADO EN R2». Anotar el nuevo nombre del objeto.
2. Lanzar **«NEXA FEL · solo migraciones»** con `accion = migraciones-etapa`, `etapa = 4`, `confirmar = APLICAR-MIGRACIONES`, y aprobarlo en `demo-privada`.
3. Resultado esperado: «precondiciones de la etapa 4 … OK» y «VERIFICACIÓN DE LA ETAPA 4: OK. SE DETIENE AQUÍ.»
4. Después, y solo con autorización aparte: publicar el código de la demostración y comprobar los tipos en https://nexa-fel-demo.pages.dev.

## 7. Lo que NO incluye esta solicitud
Publicar la aplicación, habilitar la certificación de NCRE/NDEB/RECI, emitir documentos reales, enviar correos, ni aplicar el rol restringido `nexa_fel_app`.

## 8. Decisión que se pide
Autorizo la etapa 4 sobre `nexa-demo` (☐ con respaldo nuevo previo · ☐ con el respaldo del 24/11/2026).
