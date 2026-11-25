# Decisión · ¿registrar los tipos de documento como migración 30 o aplicarlos fuera del historial?

Fecha: 25/11/2026 · Decisión: **registrarlos como migración 30** (`supabase/migrations/20261115000100_fel_tipos_documento.sql`).

## Alternativas
| | A · fuera del historial (como estaba) | B · migración 30 (recomendada) |
|---|---|---|
| Dónde vive el SQL | `docs/migracion-tipos-documento/` | `supabase/migrations/` (única copia) |
| Historial de `nexa-demo` tras aplicarla | 29 versiones, pero la base ya tiene los objetos (**deriva**) | 30 versiones, igual a la realidad |
| Cómo se aplica | `psql` a mano, un script propio | La misma CLI y el mismo mecanismo que las etapas 1–3 (carpeta temporal, un `db push` que **registra la versión**) |
| La CI | Solo prueba la propuesta en un PostgreSQL con un «shim» | La aplica la **pila local real de Supabase** (Auth, PostgREST, función de la plataforma `rls_auto_enable`) y ejecuta las 30 suites SQL |
| Proyecto nuevo o recuperación desde migraciones | Hay que **acordarse** de un paso extra | `db push` aplica las 30; nada que recordar |
| Migraciones futuras (31, 32…) | Se escribirían sobre un esquema que la carpeta no describe; la CI local divergiría de `nexa-demo` | Se apilan sobre la 30 de forma natural |
| `supabase db push` / `migration list` | Ignoran los objetos (riesgo de reaplicar o de confundir) | Coherentes con la base |
| Coste de cambio ahora | Ninguno | Único: actualizar cifras (29 → 30), 3 guardianes, 6 scripts de prueba y la documentación (hecho y probado) |
| Riesgo principal | Deriva silenciosa y pruebas que no reflejan lo desplegado | Que «publicar» aplicara la 30 sin su etapa → **mitigado**: «publicar» se niega si hay historial y migraciones pendientes |

## Por qué la B es la más segura para el mantenimiento
1. **Una sola fuente de verdad**: lo que dice la carpeta es lo que tiene la base, y lo que prueba la CI es lo que se despliega.
2. **Probada en la plataforma real** antes de tocar `nexa-demo` (algo que la A no permite sin un paso manual).
3. **Atómica y registrada**: la CLI aplica y registra la versión en el mismo procedimiento que ya funcionó para las etapas 1–3.
4. **Reproducible**: un proyecto nuevo, una restauración o un entorno de desarrollo nacen con las 30 sin pasos manuales.

## Consecuencias de la B (y cómo quedaron resueltas)
- **Los contadores fijos** (29 migraciones, 69 tablas, etc.) pasaron a admitir la 30: `verificacion-posterior-29.sql` espera EXACTAMENTE +2 tablas, +2 políticas, +10 funciones y +5 disparadores solo cuando la 30 está completa; con la 30 a medias o con cualquier otra diferencia sigue fallando (probado con una función ajena).
- **Respaldos anteriores siguen valiendo**: el ensayo y la herramienta de recuperación aceptan los estados 28, 29 y 30 y rechazan la deriva entre historial y base.
- **Inmutabilidad**: la 29 y la 30 tienen su huella SHA-256 en `supabase/tests/inmutables_migraciones_29_30.sha256`, vigilada por `verificar-publicacion.py`.
- **«publicar» no aplica la 30 antes de su etapa**: sobre una base con historial y migraciones pendientes se niega y pide la etapa 4; en un proyecto nuevo (sin historial) aplica todas.
- **Reversión**: `reversion-tipos.sql` quita los objetos Y la versión del historial (solo si no hay notas, recibos ni configuración).
- **Qué NO cambia**: NEXA principal; la certificación fiscal (solo FACT certifica; NCRE, NDEB y RECI quedan bloqueados por la propia base).
