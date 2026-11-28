# Preparación de E1 (NO se aplica hasta tu autorización)

## 1. Medición previa — `supabase/consultas/medicion_egress.sql` (solo lectura)
Una sola sentencia `SELECT`; no modifica nada. Está en el repositorio y su contenido completo se entregó en el chat. **Cómo ejecutarla:**
1. Entra a supabase.com → organización de «pa carlos» → proyecto **pa carlos** (no `nexa-demo`).
2. Menú izquierdo → **SQL Editor** → **New query**.
3. Pega TODO el contenido de `medicion_egress.sql` → **Run** (Ctrl/Cmd + Enter).
4. Aparece una sola fila con la columna `medicion`. Haz clic en la celda → **Copy** (o **Export → Copy as JSON**) y pega el resultado en el chat. No contiene contraseñas ni datos de personas (solo conteos, tamaños, nombres de políticas y horarios).
5. Si da error `schema "cron" does not exist` (pg_cron no habilitado), borra la línea que empieza con `'cron'` y vuelve a ejecutar.
6. Opcional, mismo procedimiento: `supabase/consultas/usuarios_activos_por_dia.sql` (usuarios activos por día; sirve para medir el ahorro por persona).
**Qué reviso con el resultado antes de pedirte autorización:** tamaño total y por tipo de `pa_docs`; cuántas miniaturas hay y cuánto pesan; las **políticas reales** de `pa_docs` (que la vista las herede sin ampliar nada); los **disparadores** existentes (que no choquen con el nuevo); la publicación de Realtime; el espacio libre para el respaldo; los horarios del cron.

## 2. Respaldo (antes de E1)
- **Base de datos:** `E0_respaldo.sql` (SQL Editor) crea `pa_docs_respaldo_e0` y `pa_descargas_respaldo_e0` con copia exacta (planes con sus miniaturas, usuarios, avisos, configuración, descargas), verifica filas y huella, no sobrescribe un respaldo anterior y deja las copias ilegibles para la app. Probado en PostgreSQL real (`pruebas/egress/test_sql.sh`).
- **Copia fuera de Supabase (recomendada):** desde tu computadora, con la cadena de conexión de Supabase → Connect (no la compartas): `pg_dump "<CADENA>" -t public.pa_docs -t public.pa_descargas -Fc -f respaldo_pa_docs_AAAAMMDD.dump` y `sha256sum respaldo_pa_docs_*.dump` (guarda el archivo y la huella). El plan gratuito no incluye respaldos automáticos descargables; confírmalo en Database → Backups.
- **Fotografías y evidencias:** las miniaturas están en `pa_docs` (cubiertas por E0). Las fotos en alta resolución viven en **OneDrive** (carpeta PlanesAccion/evidencias, por la función `super-api`); E1/E2 no las leen ni las modifican. Confirma que esa carpeta tenga su propia retención/copia; si quieres, se puede hacer una copia de la carpeta antes de E1.
- El respaldo `*_respaldo_e0` se conserva mientras no autorices borrarlo.

## 3. Comprobaciones de seguridad (resultado)
**E1 no amplía permisos** (probado con 22 comprobaciones en PostgreSQL real, `test_sql.sh`):
- `pa_docs_lite` es `security_invoker`: cada persona ve exactamente las mismas filas que ya veía en `pa_docs` (probado: administrador / sucursal / otra persona / anónimo).
- `pa_thumbs`: solo `SELECT` para `authenticated`, con una política que exige que el plan sea visible para quien pregunta; sin `INSERT/UPDATE/DELETE` para nadie de la app (solo escribe el disparador). `anon` sin acceso.
- Quien edita SU plan no puede sobrescribir ni leer la miniatura de otro plan reutilizando su llave (probado: `on conflict do nothing` + política).
- Las funciones auxiliares no son ejecutables por `anon`/público (solo `pa_strip_thumbs`, pura, por `authenticated`).
- **A confirmar con el resultado de `medicion_egress.sql`:** que las políticas reales de `pa_docs` sean las que se supone (no se pueden ver desde el repositorio).
**Clientes con versión anterior (v512) tras E1 — comportamiento medido:**
- *No pierden ni sobrescriben evidencias:* el disparador copia a `pa_thumbs` las miniaturas que traía la fila ANTES de quitarlas, así que una escritura de una versión antigua nunca borra una foto (probado: ida y vuelta byte a byte).
- *Sí mostrarían las miniaturas en blanco* en los planes ya separados (los escritos después de E1, o todos si se aplica E2) hasta que se actualicen; los datos, estados y avances se ven igual (probado). Mitigación: la app compara su versión cada pocos segundos y se actualiza sola al quedar inactiva (≤ 1–2 min).
- **Condición para aplicar E1:** ya no se fija un plazo de 7 días; se sustituye por verificaciones objetivas (ninguna actividad de v512 durante 24 h en los registros de la API, RLS reales revisadas, respaldo E0 verificado, reversión probada). Ver `PLAN-V514-Y-VENTANA-E1.md` §3. Plazo mínimo razonable: 2 días hábiles completos tras publicar y la verificación 1 cumplida 24 h.

## 4. Lista de verificación antes de pedir la autorización de E1
- [ ] Las 6 verificaciones de `PLAN-V514-Y-VENTANA-E1.md` §3 cumplidas y consumo de P0 medido (ver `PROCEDIMIENTO-MEDICION-REAL.md`).
- [ ] Resultado de `medicion_egress.sql` revisado (políticas, disparadores, espacio).
- [ ] E0 ejecutado y verificado (`E0 OK`, huella anotada) + copia `pg_dump` guardada (opcional recomendada).
- [ ] Horario de poco uso acordado; reversión (`E1_reversion.sql`) a la mano.
- [ ] Una cuenta de prueba de cada rol (administrador, supervisor, sucursal) para verificar justo después.
