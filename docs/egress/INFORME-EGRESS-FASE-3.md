# Reducción máxima de Egress de NEXA — informe de fase 3 (optimización integral, local; sin cambios en producción)

Rama `ccr-9b56cef8-3yibwu` (commit posterior a a925b1a). `main` sigue en 7d87921 (v513). **No se aplicó E0, E1 ni E2; no se desplegó v514; no se eliminó ningún dato, foto, firma ni notificación; NEXA FEL y `nexa-demo` intactos; sin costos; la interfaz visual no cambió.**
Todos los números de este informe son de un **banco de pruebas local** (Supabase simulado, datos y escenarios idénticos para cada versión). **Nada está medido todavía en Supabase real**; las cifras reales las dará `PROCEDIMIENTO-MEDICION-REAL.md`.

## 1. Resumen
| | |
|---|---|
| **Hallazgo nuevo de mayor impacto probable** | Al **descargar un plan** (informe + fotos originales) cada foto original pasaba en base64 por la función `super-api`, es decir, por Supabase. Medido: **23.3 MB de Egress de Supabase por un plan de 7 fotos de 2.5 MB** (1.33× el tamaño de las fotos). v514 las baja directo de OneDrive con su enlace temporal (0 MB de Supabase) y, si el navegador no puede leerlas (CORS), retrocede a la función sin perder nada. Con 100 descargas al mes de planes así serían ~2.3 GB; con 500, ~11.7 GB — del orden del exceso observado. **El número real de descargas lo da `medicion_egress.sql` (`descargas`); es la primera hipótesis a confirmar.** |
| Estimación del modelo local por sesión (35 usuarios) | administrador: inicio 4.2 MB → 0.09 MB (E1) → 0.01 MB (caché); 1 h abierta 11.3 MB → 2.1 MB (v513) → 0.1 MB (E1). Sucursal: 1 h abierta 2.6 MB → 0.9 MB → 0.02 MB |
| Modelo mensual (supuestos en §4) | 35 usuarios: 11.8 GB (v512) → 3.7 GB (v513) → **0.18 GB (v513+E1)** → 0.17 GB (v514 con caché). A 1 000 usuarios: 785 GB → 132 GB → **5.3 GB** → 2.2 GB |
| Qué aporta cada capa | v513/P0 (publicada): −68 %. **E1 es la palanca decisiva para escalar** (−98 %): quita las miniaturas del plan. La caché y Arqueos incremental son marginales a 35 usuarios y relevantes a 250+ |
| Compatibilidad | 3 modos (v513 sobre la base actual, v514 con E1, v514 con E1 + caché) muestran lo mismo que v512 en todas las vistas de 5 roles |
## 2. Hallazgos y qué se hizo con cada oportunidad
| Oportunidad | Resultado |
|---|---|
| Descarga de planes por `super-api` | **Corregida en v514** (descarga directa + retroceso + memoria de 24 h). Pruebas con OneDrive con y sin CORS: el ZIP sale idéntico (7 fotos, 17.5 MB); con CORS 0 MB de Supabase; sin CORS igual que antes y sin reintentos. **Falta confirmar CORS real** (`PLAN-V514-Y-VENTANA-E1.md` §1.1) |
| Arqueos y descargas: paginación | Arqueos: listado **sin su cuerpo** (E1) + **sincronización incremental por tabla** (v514): sin cambios solo viajan firmas (< 12 KB en 3 min), 3 arqueos nuevos = 5–10 KB en lugar de la lista completa. Descargas: **RPC agregada** (E1, la última descarga relevante por plan). Límite que ya existía y se conserva: la lista muestra las 600 versiones más recientes; una paginación visible «ver más antiguos» **cambia la interfaz y espera tu autorización** |
| Caché con invalidación segura | **Implementada, INACTIVA** (`PA_CONFIG.cache`): inicio con solo lo modificado (admin 86 KB → 14 KB a 26 sucursales; 2.2 MB → 0.2 MB a 750). Detecta borrados y planes que dejaron de ser visibles con un conteo sin cuerpo y un listado completo cada 24 h; se anula al cambiar de perfil/rol/región/sucursal y cuando entra otra persona; borra al cerrar sesión (modo `true`) o solo al cerrar voluntariamente (modo `dispositivo`). **Decisión tuya**: deja datos de planes en el equipo (como ya ocurre con las fotos) |
| Eventos Realtime ligeros | **No aporta ahorro neto**: cada persona autorizada necesita la fila para actualizarse; avisar «cambió X» y luego pedirla transfiere lo mismo o más. Con E1 la fila ya pesa ~1.5 KB (sin miniaturas). Medido: 1 h de administrador a 750 sucursales = 1.4 MB, casi todo Realtime (crece con la actividad, no con las miniaturas). Evitado además: la doble descarga de cada cambio (v513) |
| Guardado parcial de planes | **No se implementa**: lo que se envía al guardar es entrada (no cuenta como Egress); el broadcast posterior a los demás lleva la fila completa de todos modos (~1.5 KB con E1). Un parche por campo añadiría riesgo de pisar cambios concurrentes sin ahorro medible |
| Indicadores y reportes en PostgreSQL | **No se implementó**: el dashboard calcula sobre `db.plans` con decenas de indicadores y filtros; moverlos exige reescribir la lógica visible y es el cambio funcional importante que pediste vigilar. Con E1 los planes cargados pesan ~1.5 KB cada uno (ver §4) y la caché evita repetir la carga; **riesgo declarado**: a muchos miles de planes el primer inicio del administrador (2.2 MB a 750 sucursales) sigue creciendo linealmente. Siguiente etapa recomendada, con autorización: RPC de resumen por región/estado |
| Notificaciones | La vista omite avisos de más de 45 días ya leídos por todos (no se borran). Las marcas de lectura y los contadores no cambian (probado). Un tope por persona exigiría decidir qué historial puede ocultarse |
| Autenticación | Sin solicitudes redundantes: `getSession` es local, `refreshSession` solo ante un 401, la renovación del token es de supabase-js (~1 vez por hora y pestaña). Nada que reducir |
| Carga de módulos bajo demanda | Arqueos, Supervisión y Descargas ya solo consultan con su pantalla activa y la pestaña visible; `loadProfiles` (11 KB por inicio de administrador) se deja por no ser rentable. La aplicación es un archivo único servido por Cloudflare (no cuenta como Egress de Supabase) |
| Procesos programados / Edge Functions | `recordatorios-de-nexa`: ya lee por la vista ligera (v513). Frecuencias sin cambio (`REVISION-PROCESOS-PROGRAMADOS.md`). `super-api`: **su código no está en el repositorio**; ver §6 |
| E2 | Evaluado en PostgreSQL real (200 planes × 8 miniaturas de 30 KB): `pa_docs` 48 MB → 184 KB (las miniaturas pasan a `pa_thumbs`, 51 MB: **el total de la base no baja**); lectura de la vista ligera 93 ms → 37 ms y de la tabla 107 ms → 7 ms. **No añade Egress respecto a E1** (la vista ya omite las miniaturas); aporta CPU/escrituras y filas pequeñas. Recomendación: opcional y posterior; mantener el respaldo |
## 3. Mediciones locales (misma semilla y escenarios; `pruebas/egress/resultados/`)
Escenario por sesión: inicio de sesión en frío y con copia local; 10 min con la app abierta y actividad ajena proporcional (0.5 cambios de plan y 0.25 avisos por sucursal y hora) ×6; Arqueos abierto 5 min. Versiones: v512 original, v513 (P0, publicada), v513 + E1, v513 + E1 + E2 (mismo tráfico que E1: la compactación es de servidor), v514 completa (E1 + E2 + caché `dispositivo` + Arqueos incremental). Las versiones sin lectura ligera solo se pueden medir hasta 190 sucursales (con más datos el navegador no carga el volumen).
```
POR SESIÓN (medido; bytes brutos, sin comprimir)
versión                       B   inicio admin  inicio suc.  hora abierta admin  hora abierta suc.
v512 original                26        4,219KB        157KB            11,296KB            2,621KB
v512 original                75       11,978KB        167KB            34,405KB            3,291KB
v512 original               190       29,990KB        218KB            87,613KB            5,087KB
v513 (P0)                    26        4,219KB        157KB             2,084KB              874KB
v513 (P0)                    75       12,096KB        167KB             5,951KB              880KB
v513 (P0)                   190       29,990KB        218KB            14,651KB            1,057KB
v513 + E1                    26           86KB         12KB               100KB               17KB
v513 + E1                    75          231KB         22KB               192KB               18KB
v513 + E1                   190          564KB         43KB               398KB               19KB
v513 + E1                   375        1,102KB         78KB               751KB               18KB
v513 + E1                   750        2,198KB        148KB             1,447KB               18KB
v513 + E1 + E2               26           86KB         12KB               100KB               17KB
v513 + E1 + E2               75          231KB         22KB               192KB               18KB
v513 + E1 + E2              190          564KB         43KB               398KB               19KB
v513 + E1 + E2              375        1,102KB         78KB               751KB               18KB
v513 + E1 + E2              750        2,198KB        148KB             1,447KB               18KB
v514 completa (+caché*)      26           14KB          3KB               100KB               17KB
v514 completa (+caché*)      75           27KB          3KB               192KB               18KB
v514 completa (+caché*)     190           57KB          3KB               398KB               19KB
v514 completa (+caché*)     375          105KB          3KB               751KB               18KB
v514 completa (+caché*)     750          203KB          3KB             1,447KB               18KB

PROYECCIÓN MENSUAL (supuestos en la cabecera del archivo; * = extrapolado de lo medido)
usuarios activos mensuales                  35               100               250               500              1000
v512 original                        11.77 GB*         45.32 GB*        140.26 GB*        330.44 GB*        784.98 GB*
v513 (P0)                             3.74 GB*         12.06 GB*         31.39 GB*         64.27 GB*        131.77 GB*
v513 + E1                             0.18 GB*          0.41 GB*          0.98 GB*          2.14 GB*          5.26 GB*
v513 + E1 + E2                        0.18 GB*          0.41 GB*          0.98 GB*          2.14 GB*          5.26 GB*
v514 completa (+caché*)               0.17 GB*          0.35 GB*          0.70 GB*          1.22 GB*          2.18 GB*
Ahorro de v514 vs v512                   98.6%             99.2%             99.5%             99.6%             99.7%

Definición de usuarios: activos mensuales = U; activos diarios = 70 % de U; concurrentes ≈ 20–25 % de los diarios (no cambian la cantidad total de datos, sí el pico de conexiones Realtime: límite gratuito 200).

INICIO DE SESIÓN: tiempo de red estimado en 4G (10 Mbps, 80 ms/solicitud, cota superior; el procesamiento local no está incluido)
versión                    usuarios       admin    sucursal
v512 original                    35       4.0 s       0.3 s
v512 original                   250      31.2 s       0.3 s
v512 original                  1000     123.2 s       0.4 s
v513 + E1                        35       0.7 s       0.3 s
v513 + E1                       250       1.3 s       0.4 s
v513 + E1                      1000       3.4 s       0.5 s
v514 completa (+caché*)          35       0.6 s       0.4 s
v514 completa (+caché*)         250       0.6 s       0.4 s
v514 completa (+caché*)        1000       0.7 s       0.4 s

DESCARGA DE PLANES (aparte de la matriz): con las fotos originales, v512–v513 mueven 1.33 MB de Supabase por cada MB de foto original descargada (base64) → 23.3 MB por un plan de 7 fotos de 2.5 MB (medido); v514 con OneDrive legible: ~0.
```
Lectura: `*` = interpolado/extrapolado con un ajuste potencial a los puntos medidos (26, 75, 190, 375 y 750 sucursales ≈ 34, 83, 198, 383 y 758 usuarios; los 1 000 usuarios extrapolan ~30 % por encima del máximo medido; v512 y v513 extrapolan desde 190). El modelo omite la descarga de planes (arriba): sumar ~1.33 MB por cada MB de foto original descargada en v512–v513.
**Limitaciones declaradas:** (1) volumen y mezcla de usuarios supuestos, no los reales (se recalibra con `medicion_egress.sql` y `escala.cjs --data`); (2) bytes brutos sin comprimir (cota superior; con compresión de red menos); (3) sin latencia de red real ni tiempos de CPU del navegador; (4) el simulador no replica el Realtime real de Supabase ni su facturación; (5) el 11.8 GB del modelo v512 a 35 usuarios coincide en orden de magnitud con los 11.75 GB observados, pero **no es una confirmación**.
**Definición de usuarios:** registrados ≥ activos mensuales (U) ≥ activos diarios (70 % de U) ≥ concurrentes (≈ 20–25 % de los diarios, que fijan el pico de conexiones Realtime; el plan gratuito permite 200).
## 4. Pruebas (todas en `pruebas/egress/`)
| Prueba | Resultado |
|---|---|
| Funcional comparativa, 5 roles × todas sus vistas (planes visibles, estados/avances, contadores, textos, fotos, detalle, escritura de evidencias; PC y teléfono) | idéntico a v512 en: v513 publicada, v514 sobre la base actual, v514 con E1, v514 con E1 + caché |
| Recuperación de Realtime | 6/6 |
| Caché (`cache_test.cjs`): segundo inicio < 20 % del frío; cambios y un borrado ajenos → copia idéntica al servidor; cambio de perfil, otra persona y cierre voluntario borran | 10/10 (modo `dispositivo`) y modo sesión |
| Arqueos (`arqueos_test.cjs`) con y sin E1 | 6/6 |
| Descarga (`descarga_test.cjs`): con CORS 0 MB de Supabase; sin CORS retroceso sin pérdida y sin reintento | 4/4 (v514); v513 reproduce los 23.3 MB |
| PostgreSQL real (`test_sql.sh`): E0 respaldo, E1, E2, reversiones, acceso, sin ampliación de permisos, descargas = lógica anterior | 22 OK |
| Mutaciones (nuevas): caché sin conteo; no borra al salir; no purga a otros; Arqueos sin sincronizar arqueos; abre arqueo sin cuerpo; descarga sin directo; descarga sin memoria | **7/7 detectadas** |
## 5. Seguridad, RLS, concurrencia y compatibilidad
- Las reglas de acceso las siguen decidiendo las políticas de la base; nada se filtra en el navegador. `pa_docs_lite` es `security_invoker`; `pa_thumbs` exige que el plan sea visible; sin permisos nuevos (probado, incluyendo reutilizar la llave de una miniatura ajena).
- **RLS reales: NO verificadas** (no están en el repositorio). Bloquea E1 hasta tener la salida de `medicion_egress.sql`.
- Compatibilidad hacia atrás medida: v512 sobre E1 no pierde ni pisa evidencias; muestra las miniaturas en blanco hasta actualizarse. v514 sobre la base actual = v513.
- Dos pestañas: una sola consulta periódica y aviso por `BroadcastChannel`; con caché, ambas escriben la misma copia local y convergen por Realtime.
- Recuperación de conexión: respaldo incremental, recreación del canal a los 45 s y sincronización completa al volver.
- Respaldos/reversión: E0 (respaldo), `E1_reversion.sql`, `E2_reversion.sql` (re-incrusta desde `pa_thumbs`), v514 → v513 = `git revert` del commit de v514, interruptor `localStorage.nx_nolite`, caché apagable quitando la bandera.
## 6. Pendientes que requieren tu decisión o tu información
1. **Comprobación de OneDrive (1 minuto)** — `PLAN-V514-Y-VENTANA-E1.md` §1.1: dice si la descarga directa funciona y a qué dominio apuntan los enlaces. Sin ella el ahorro de descargas es una hipótesis.
2. **Código de `super-api`** (Supabase → Edge Functions → super-api → Code): para revisar qué entrega la acción `get`, la acción `photo_data`, la política CORS y, si hace falta, entregar los originales con CORS.
3. **Salida de `medicion_egress.sql`** (incluye `descargas`, políticas y disparadores).
4. **Caché persistente**: ¿se activa, y en qué modo (`true` o `dispositivo`)?
5. **Autorización para publicar v514** (descarga directa + Arqueos incremental + baliza; caché inactiva) y, después, para E0/E1 cuando se cumplan las 6 verificaciones de `PLAN-V514-Y-VENTANA-E1.md`.
6. Cambios visibles que esperan autorización: «ver más antiguos» en Arqueos; indicadores calculados en PostgreSQL.
## 7. FEL
El fallo de CI se diagnosticó sin tocar el candidato: `docs/fel-ci/DIAGNOSTICO-PAGINACION-CI.md` (la prueba usa `page.waitForFunction`, que la política CSP `script-src 'self'` bloquea con Chromium 131 del CI; defecto de la prueba, no de la aplicación).
