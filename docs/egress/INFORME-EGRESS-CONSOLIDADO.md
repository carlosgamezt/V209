# NEXA · Optimización integral de Supabase — informe consolidado (estado al 28-nov-2026)

Rama `ccr-9b56cef8-3yibwu` (último commit de este informe: ver §10). `main` = v513 (7d87921). Nada de lo nuevo está en producción: **E0, E1a, E1, E2, E3 y v515 NO se han aplicado ni publicado.** NEXA FEL, `nexa-demo`, las RLS, los datos y la interfaz no se tocaron; sin costos.
**Origen de las cifras:** (S) simulado: banco de pruebas en navegador con Supabase simulado y tus volúmenes reales; (PG) PostgreSQL local real con las políticas RLS reales de `pa_docs`; (R) Supabase real: **todavía ninguna** (solo tus conteos de `medicion_egress.sql`).

## 1. Datos reales de producción usados (medicion_egress.sql de «pa carlos»)
146 planes (48 con fotos), 386 miniaturas en los planes (384 en el banco; la consulta de diferencia dio NULL: las 386 son campos `t` de objetos foto), 13.78 MB de planes (0.32 MB sin miniaturas; 97.7 % son miniaturas), 996 avisos (247 leídos por todos, 169 de más de 45 días), 16 versiones de arqueos, 18 descargas registradas, 477 filas de supervisión, **sin disparadores en `pa_docs`**, Realtime solo sobre `pa_docs`, 4 tareas programadas (ids 1, 2, 5, 6), 8 políticas RLS reales.

## 2. Resumen
1. **Volumen almacenado ≠ tamaño de respuesta ≠ Egress mensual.** Almacenado: 13.8 MB de planes (13.5 MB son miniaturas; E1 solo las mueve a otra tabla). Respuesta: el inicio de un administrador baja de 11.5 MB a 0.37 MB (E1) y a 13 KB con la caché. Egress: un modelo de 35 usuarios pasa de ~9–12 GB/mes (v512) a ~4.5 GB (v513, publicada) y a **0.15–0.3 GB (E1 + v515)** (S).
2. **v513 por sí sola deja el sistema al borde del plan gratuito** (≈1.6–4.5 GB/mes según los inicios de sesión por día; la cuota es 5 GB): E1 es lo que da margen.
3. **Hallazgo clave de las tareas programadas:** `recordatorios-de-nexa` lee TODOS los planes con sus miniaturas en cada una de sus **71 corridas diarias** (56 `nexa-badge` + 13 `nexa-sin-leer` + 2 diarias). Con tus datos son ~13.8 MB por corrida ≈ **1 GB/día brutos** (cota superior). La v513 desplegada ya lee por la vista ligera «si existe», pero la vista **no existe todavía**, así que ese ahorro aún no ocurre. **E1a** (solo la vista; no cambia nada para ningún cliente) lo activa de inmediato: de ~29 GB/mes brutos a ~0.8 GB (S/PG). Falta confirmar en los registros de la API si este tráfico cuenta como Egress y cuánto pesa (consulta en §9).
4. **Compatibilidad total medida:** 5 roles × todas sus vistas (PC y teléfono) muestran lo mismo que en v512 con v515 sobre la base actual y con v515 + E1 + E3 + caché (S).
5. **E1 verificada contra tus políticas RLS reales** con 12 perfiles (admin, visualizador, analista, gerencia, supervisor, comodín, supervisor entre regiones ver/editar, inventarios todo/limitado, sucursales, sin perfil): lectura y escritura idénticas antes y después, ninguna miniatura perdida, sin ampliación de permisos (PG, 15 comprobaciones). **Limitación:** las funciones auxiliares (`pa_role`, `pa_xmode`, `pa_inv_*`…) son sustitutos hasta recibir `politicas_rls.sql`; las pruebas verifican propiedades que no dependen de su código, pero esa confirmación final sigue pendiente.

## 3. Optimizaciones implementadas (todas probadas en local)
| Área | Implementación | Estado |
|---|---|---|
| P0 | Sincronización incremental, puerta entre pestañas, firmas de Arqueos/Descargas/Supervisión, Realtime con recuperación, sin consultas en segundo plano, fin de la doble descarga de cada cambio | **publicado en v513** |
| E0 | `E0_respaldo.sql` (copia exacta con huella), `E0_recuperacion.sql` (repone planes, miniaturas y descargas; plan por plan opcional), `verificacion_e1.sql` (conteo e integridad de las 386) | listo |
| E1a | Solo vista ligera (`security_invoker`) → tareas programadas | listo; **recomendado aplicar primero** |
| E1 | `pa_thumbs` + disparador que separa miniaturas sin perder ninguna + vista + RPC de descargas; carga bajo demanda por lotes con caché en memoria e IndexedDB; modo ligero de Arqueos (sin `data`) | listo |
| E2 | Compactar filas antiguas (respaldo y verificación previa) — evaluado: **no añade Egress** (la vista ya omite las miniaturas); `pa_docs` 48 MB → 184 KB en una base de prueba y lectura 93 → 37 ms; opcional | listo |
| E3 (guardado inteligente) | `pa_docs_patch`: solo los cambios puntuales, bajo las mismas políticas; dos personas editando partes distintas no se pisan (antes el último reemplazaba todo); capacidad detectada, con retroceso a fila completa | listo |
| Arqueos y descargas | listado sin cuerpo + sincronización incremental por tabla; descargas por RPC agregada | v515 |
| Caché persistente | datos ligeros por persona; invalidación por conteo y listado completo cada 24 h; borra al cerrar sesión (modo `true`) o solo al cierre voluntario (`dispositivo`) | **inactiva** hasta que decidas |
| Fotos originales (OneDrive) | descarga de planes directo desde OneDrive (antes cada foto pasaba por `super-api`, 1.33× por Supabase) con retroceso a la función | v515; falta confirmar CORS real |
| Autenticación | sin solicitudes redundantes (verificado en el código) | nada que cambiar |
| Baliza | versión en `X-Client-Info` para medir adopción | v515 |
**No implementado (con motivo medido):** eventos Realtime «ligeros» (la fila ya pesa ~1.5 KB con E1; avisar y volver a pedir transfiere más); indicadores/dashboard en PostgreSQL y paginación visible de planes (ver §6); `super-api` (sin acceso al código).

## 4. Mediciones con volúmenes reales (S; `pruebas/egress/resultados/real_*.json`)
KB por sesión, ≈35 usuarios (27 sucursales, 146 planes reales):
| | v512 | v513 (P0) | v513 + E1 | v515 completa (E1+E2+caché) |
|---|---|---|---|---|
| Inicio de sesión · administrador | 11 465 | 11 549 | 365 | **13** |
| Inicio de sesión · supervisor | 6 323 | 6 333 | 107 | 18 |
| Inicio de sesión · sucursal | 486 | 486 | 25 | 3 |
| 1 h abierta · administrador | 15 390 | **93** | 93 | 93 |
| 1 h abierta · supervisor | 1 961 | 82 | 82 | 82 |
| 1 h abierta · sucursal | 1 392 | 34 | 34 | 34 |
| Arqueos 5 min · administrador | 1 568 | 67 | 35 | 35 |
E2 tiene el mismo tráfico que E1 (la compactación es de servidor); su beneficio es de CPU y de tamaño de filas (PG). Descarga de un plan de 7 fotos de 2.5 MB: **23.3 MB de Supabase (v512/v513) → 0 (v515 con OneDrive legible)** (S). Tiempo de carga (red 4G de 10 Mbps, 80 ms por solicitud, cota superior, sin CPU local): inicio de un administrador a 250 usuarios 31 s (v512) → 1.3 s (E1) → 0.6 s (caché).

## 5. Proyección mensual de Egress (S) — supuestos explícitos
Composición: 3 administradores + 5 supervisores + resto sucursales; 70 % de los usuarios activos usan la app cada día; 26 días; 4 h abierta al día; administradores y supervisores 30 min en Arqueos. **Los inicios de sesión por persona y día son desconocidos** (la inactividad cierra la sesión a los 30 min en sucursales): se muestran 1, 2 y 3. Con 3 inicios por día v512 da 11.8 GB a 35 usuarios, **igual que tus 11.75 GB observados** (coherencia, no prueba: las tareas programadas, si cuentan, se suman).
Usuarios activos mensuales = U; diarios = 70 % de U; concurrentes ≈ 20–25 % de los diarios (≈ 5–9 a 35 usuarios; ≈ 175–250 a 1 000, que roza el límite gratuito de 200 conexiones Realtime).
```
PROYECCIÓN MENSUAL (supuestos en la cabecera del archivo; * = extrapolado de lo medido)
(inicios de sesión por persona y día: 1.0)
usuarios activos mensuales                  35               100               250               500              1000
v512 original                          8.94 GB          33.65 GB         129.18 GB        310.30 GB*        795.16 GB*
v513 (P0)                              1.61 GB           4.39 GB          16.04 GB         32.13 GB*         86.89 GB*
v513 + E1                              0.19 GB           0.71 GB           1.91 GB           4.27 GB          11.04 GB
v513 + E1 + E2                             n/d               n/d               n/d               n/d               n/d
v514 completa (+caché*)                0.15 GB           0.58 GB           1.44 GB           2.93 GB           6.61 GB
Ahorro de v514 vs v512                   98.3%             98.3%             98.9%             99.1%             99.2%
PROYECCIÓN MENSUAL (supuestos en la cabecera del archivo; * = extrapolado de lo medido)
(inicios de sesión por persona y día: 2.0)
usuarios activos mensuales                  35               100               250               500              1000
v512 original                         10.38 GB          37.42 GB         138.86 GB        328.73 GB*        831.21 GB*
v513 (P0)                              3.05 GB           8.16 GB          25.72 GB         50.52 GB*        122.81 GB*
v513 + E1                              0.23 GB           0.85 GB           2.41 GB           5.67 GB          15.62 GB
v513 + E1 + E2                             n/d               n/d               n/d               n/d               n/d
v514 completa (+caché*)                0.15 GB           0.59 GB           1.46 GB           2.99 GB           6.76 GB
Ahorro de v514 vs v512                   98.5%             98.4%             98.9%             99.1%             99.2%
PROYECCIÓN MENSUAL (supuestos en la cabecera del archivo; * = extrapolado de lo medido)
(inicios de sesión por persona y día: 3.0)
usuarios activos mensuales                  35               100               250               500              1000
v512 original                         11.82 GB          41.19 GB         148.54 GB        347.16 GB*        867.26 GB*
v513 (P0)                              4.50 GB          11.93 GB          35.40 GB         68.91 GB*        158.73 GB*
v513 + E1                              0.27 GB           1.00 GB           2.90 GB           7.07 GB          20.20 GB
v513 + E1 + E2                             n/d               n/d               n/d               n/d               n/d
v514 completa (+caché*)                0.16 GB           0.60 GB           1.49 GB           3.04 GB           6.91 GB
Ahorro de v514 vs v512                   98.7%             98.6%             99.0%             99.1%             99.2%
```
`*` = extrapolado desde lo medido (v512/v513 hasta 242 sucursales; E1/v515 hasta 992). Tareas programadas (aparte, brutos):
```
TAREAS PROGRAMADAS (71 corridas/día = badge 56 + sin-leer 13 + recordatorios 2; 30 días; bytes brutos; el volumen escala con los usuarios)
                                            35           100           250           500          1000
lectura de planes por la tabla        29.35 GB      83.86 GB     209.65 GB     419.31 GB     838.61 GB
lectura por la vista (E1a/E1)          0.79 GB       2.25 GB       5.63 GB      11.26 GB      22.52 GB
```
Otros recursos (estimación a partir de lo medido): **base de datos** 13.8 MB de planes a 35 usuarios ≈ 394 MB a 1 000 (+ copias E0 temporales); **Realtime** crece con la actividad: 1 h de un administrador = 0.09 MB a 35 usuarios y 1.7 MB a 992 sucursales; **Edge Functions**: ~2 100 invocaciones/mes de tareas programadas + las de la app (límite gratuito 500 000); **autenticación**: sin cambio.

## 6. Dashboard, indicadores y paginación (decisión técnica con datos)
El dashboard calcula decenas de indicadores y filtros sobre `db.plans`. Con la lectura ligera cada plan pesa ~2 KB (0.32 MB para 146): inicio en frío de un administrador a 992 sucursales = 13 MB (E1) y 0.23 MB con caché; a 35 usuarios, 0.37 MB. Mover cada indicador a PostgreSQL exige reescribir lógica visible y filtros históricos (el cambio funcional que pediste vigilar) y, con la caché, **no cambia de forma material el Egress mensual** (Realtime y no el listado dominan a escala). Se deja como etapa siguiente, con prioridad por escala: RPC de resumen por región/estado y paginación de la lista de planes si se superan ~2 000 planes por perfil; hasta entonces el límite real es la lista ligera + caché. Lo ya hecho: Arqueos sin cuerpo e incremental, descargas agregadas, avisos antiguos fuera del listado (sin borrarlos).

## 7. Pruebas (todas verdes en el código final v515)
| Prueba | Origen | Resultado |
|---|---|---|
| Funcional por rol (5 roles × vistas, PC y teléfono): v513, v515 base actual, v515 + E1 + E3 + caché | S | idéntico a v512 |
| Políticas RLS reales, 12 perfiles: lectura/escritura iguales antes/después de E1, E1a, E3 | PG | 15 OK |
| E0/E1/E2/reversiones/recuperación/integridad de miniaturas/sin ampliación de permisos | PG | 29 OK |
| Recuperación de Realtime (incluye borrado ajeno y segundo plano) | S | 6/6 |
| Caché (cambios y borrado ajenos, perfil, otra persona, cierre voluntario/inactividad) | S | OK |
| Arqueos incremental con y sin E1 | S | OK |
| Descarga directa con y sin CORS (sin pérdida, sin reintento) | S | OK |
| Guardado parcial (concurrencia, retroceso sin E3, permisos) | S + PG | OK |
| Mutaciones (reglas nuevas: 7 + guardado parcial 1) | S | 8/8 detectadas |
Compatibilidad: v512 sobre un servidor con E1 no pierde ni pisa evidencias (muestra miniaturas en blanco hasta actualizarse). Seguridad: sin cambios en políticas; vistas `security_invoker`; `pa_thumbs` solo legible si el plan es visible; `pa_docs_patch` e `E1` verificadas con los permisos reales. **Sin verificar:** Supabase real (políticas auxiliares, CORS de OneDrive, tráfico real).

## 8. Migraciones y orden de producción (cada paso con tu autorización)
1. **E0** respaldo (+ `pg_dump` opcional) → 2. **E1a** (tareas programadas) → medir 24 h → 3. **E1** completa → `verificacion_e1.sql` (esperado: 386 miniaturas embebidas, 0 faltantes, 0 distintas, huellas iguales al respaldo) → prueba con una cuenta de cada rol → 4. publicar **v515** (cliente) → 5. **E3** (guardado parcial) → 6. caché (si decides) → 7. **E2** opcional. Cada archivo está en `supabase/propuestas/egress/` y **no corre solo**.
**Ventana previa a E1:** E1a puede aplicarse ya (no cambia nada para ningún cliente). Para E1: ya no se exigen 7 días; basta (a) ninguna actividad de v512 durante 24 h en los registros de la API, (b) funciones `pa_*` reales revisadas, (c) E0 verificado, (d) reversión probada (hecha en PG). Detalle en `PLAN-V514-Y-VENTANA-E1.md`.
## 9. Reversión y recuperación
E1a: `E1a_reversion.sql`. E1: `E1_reversion.sql` (conserva `pa_thumbs` y los datos). E2: `E2_reversion.sql`. E3: `E3_reversion.sql`. Datos: `E0_recuperacion.sql` (repone planes, miniaturas y descargas; restaura planes concretos con `-v planes=...`). Cliente: volver a v513 (`git revert`) o `localStorage.nx_nolite='1'` por equipo. Verificación de tráfico de las tareas programadas en los registros de Supabase (ajustar si el esquema cambia):
```sql
select timestamp_trunc(timestamp, day) as dia, count(*) as solicitudes
from edge_logs cross join unnest(metadata) as m cross join unnest(m.request) as r
where r.path = '/rest/v1/pa_docs' and r.method = 'GET' and r.url like '%limit=5000%' and r.url like '%col=eq.plans%'
group by dia order by dia desc
```
## 10. Riesgos pendientes
1. Funciones `pa_*` reales (resultado de `politicas_rls.sql`) para cerrar la verificación de RLS.
2. CORS de OneDrive y código de `super-api` (si los enlaces apuntan a `*.supabase.co`, las fotos en grande también cuentan).
3. Sin disparadores en `pa_docs`: `updated_at` lo pone el cliente; los parches de E3 usan hora del servidor; cualquier corrección manual por SQL debe actualizar `updated_at` para que los clientes incrementales la vean.
4. Restricción anunciada por Supabase desde el **29-nov-2026** si la organización sigue por encima de la cuota (el aviso de «pa carlos»): revisar en Usage el egress del ciclo actual. v513 ya redujo el consumo, pero **E1a/E1** es lo que da margen real.
5. Pendientes funcionales: dashboard en PostgreSQL y paginación visible (§6).
## 11. Recomendación de plan
Con E1a + E1 + v515 el Egress modelado de 35 usuarios es 0.15–0.3 GB/mes (3–6 % de los 5 GB gratuitos); hasta ~250–500 usuarios queda en 1.5–7 GB (S). **Recomendación: no pasar a Pro solo por Egress si E1a/E1 se aplican**; mantener el plan gratuito mientras se cumplan: Egress < 5 GB/mes, base < 500 MB, conexiones Realtime < 200. **Sí conviene Pro (≈ US$ 25/mes) en cualquiera de estos casos:** (a) la restricción del 29-nov llega antes de aplicar E1a/E1 (Pro la levanta de inmediato y se puede volver al gratuito después), (b) se necesitan respaldos diarios automáticos y no pausa por inactividad (el gratuito no los incluye), (c) se superan ~500 usuarios activos. Es una decisión de negocio; no genero costos.
## 12. Commits y versiones
Estándar permanente de desarrollo: `ESTANDAR-DESARROLLO-NEXA.md`. Seguimiento para retomar: `SEGUIMIENTO.md`. Versiones: v512 (d06e3c1) → v513 (7d87921, publicada) → v515 (rama; incluye lo implementado en esta etapa).
