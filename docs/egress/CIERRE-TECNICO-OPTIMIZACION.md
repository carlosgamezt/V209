# Cierre técnico de la optimización de NEXA (28-nov-2026)
Objetivo: reducir al máximo el Egress de Supabase (proyecto «pa carlos», plan gratuito) sin perder información, fotos, firmas, permisos ni funcionalidad, y sin cambiar la interfaz.

## 1. Qué se hizo (todo publicado y verificado salvo lo marcado)
| Área | Cambio | Estado |
|---|---|---|
| Datos | E0 respaldo íntegro; E1a vista ligera (`pa_docs_lite`, security_invoker); E1 miniaturas aparte (`pa_thumbs`); E3 guardado parcial (`pa_docs_patch`) | Aplicado en producción, verificado con los perfiles reales |
| Cliente | v513–v517: listados incrementales, miniaturas bajo demanda, Realtime con recuperación, Arqueos ligero, guardado parcial, caché persistente y transferencia directa de OneDrive (apagadas por omisión) | v517 publicada; OneDrive directo y caché solo para administrador |
| Tareas programadas | Vista ligera → lectura mínima (295 KB → 18/1 KB por corrida); espera 60 s; secreto rotado y guardado en la base | Aplicado, verificado en corridas reales |
| `super-api` | Autorización de fotos por plan (RLS real); contadores push en SQL sin espera fija; caché de enlaces; traslado puntual; papelera con miniaturas; sin estado compartido | Desplegado; autorización en **modo registro** |
| Seguridad | Rotación del secreto de las tareas; fotos antes sin control por recurso (hallazgo alto); resolución del número real del plan para los 3 planes automáticos con espacios (en `super-api`, sin tocar el SQL) | Rotación y autorización desplegadas; la resolución de nombres está preparada y probada, pendiente de publicar; falta obligar tras revisar registros |
| Plataforma | Estándar obligatorio (§1–8), `CLAUDE.md`, plantillas, banco de pruebas y suite integral | Publicado |

## 2. Resultados — REAL (producción) vs SIMULADO (banco local)
**Real:** planes por inicio de sesión 14 114 KB → 324 KB (−97.7 %); tareas programadas 295 KB → 18 KB (badge/sin leer) y 1 KB (diario) por corrida, 0 duplicadas, sin tiempos de espera; migraciones comprobadas con 55 perfiles × 146 planes (8 030 casos); CORS de OneDrive validado desde SharePoint (descarga HTTP 200, subida HTTP 201); 386 fotos comprobadas contra la función SQL desplegada: con la lógica actual se reconocen 383 (las 3 evidencias de planes con espacios en el número no); con la resolución por número real preparada se reconocen las 386 (190 evidencias con plan único, sin ambigüedades).
**Simulado (banco con volumen real de datos):** descarga de un plan de 7 fotos 23.3 MB → 0 MB por Supabase con enlace directo; subida de 3.2 MB 4.27 → 0.001 MB; primer inicio de administrador 0.37 MB y con caché ~13 KB; consumo mensual proyectado (35 usuarios: v512 ≈ 9–12 GB → E1+v517 ≈ 0.15–0.3 GB, sin contar tareas programadas, evidencias ni funciones).
**Aún no medible:** el Egress contabilizado por Supabase: se confirma en Usage tras ≥3 días completos. El ahorro de las tareas programadas es tráfico interno PostgreSQL→función; que cuente como Egress no está confirmado.

## 3. Interruptores y reversión (independientes)
`PHOTO_AUTH` (off | registro | enforce; secreto de la función, **hoy: registro**) · `odDirect` (false | 'admin' | lista | true; hoy `'admin'`) · `cache` / `cacheRoles` (hoy `true` / `['admin']`) · pilotos por dispositivo `nx_od_pilot`, `nx_cache_pilot`. Reversiones SQL: `E1_reversion.sql`, `E3_reversion.sql`, `super_api_foto_acceso_reversion.sql`; recuperación `E0_recuperacion.sql`.

## 4. Pendiente (de otras personas o de tiempo)
Comprobaciones de Android y PC; revisar registros `photo_auth_deny` y poner `PHOTO_AUTH=enforce`; retirar la variable `CRON_SECRET`; revisar Usage a los 3 días; E2 sin aplicar hasta confirmar que no hay clientes antiguos activos (consulta de registros de la API en `ACTIVACION-Y-RETIRO.md` §5); ampliar la activación de OneDrive directo y la caché a más roles solo tras verificar el piloto.

## 5. Decidido NO hacer (sin beneficio significativo medido)
E2 (compactar miniaturas): no reduce Egress, solo tamaño/lectura en la base. Dashboard/indicadores en PostgreSQL y paginación visible: con la vista ligera y la caché no hay ahorro relevante hasta ~1 500 planes y cambiarían la interfaz. Eventos Realtime «ligeros»: sin ahorro neto. Cachear la autenticación de `super-api`: retrasaría la revocación de sesiones.

## 6. Lecciones (ya incorporadas en el estándar §8)
Autorizar por recurso y no por sesión; no confiar en nombres de archivo; auditar datos reales antes de obligar; activar por fases con interruptores; publicar por pasos con humo sin sesión; el contenido publicado debe ser idéntico al candidato probado; medir antes de optimizar.
