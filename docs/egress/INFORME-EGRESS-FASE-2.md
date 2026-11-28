# Reducción de Egress de NEXA — informe de implementación local (listo para revisión)

Rama `ccr-9b56cef8-3yibwu` (independiente de `main`; los flujos de publicación solo se disparan con `main` o a mano). Referencia estable: etiqueta `nexa-v512-referencia-egress` (= v512, commit d06e3c1). **Nada se ha desplegado, no se tocó ningún proyecto de Supabase, no se ejecutó ninguna migración, no se eliminó ningún dato.** El candidato estable de NEXA FEL no se modificó.

## 1. Resumen ejecutivo
- **Qué pasaba (confirmado con medición local):** cada pestaña de la app bajaba cada 20 s la lista completa de documentos, cada inicio de sesión descargaba todos los planes con sus miniaturas en Base64, y cada cambio de un plan se transmitía completo (con miniaturas) a todos los conectados.
- **Qué se hizo:** (P0) el cliente ya no consulta cuando Realtime funciona, pide solo lo modificado, se detiene en segundo plano, evita consultas duplicadas entre pestañas y se recupera solo si Realtime se cae; (P1) propuesta de base de datos que separa las miniaturas del plan (sin borrar nada), lectura ligera, descargas agregadas en PostgreSQL y listado de arqueos sin su cuerpo.
- **Resultado medido (mismos datos y escenarios, Supabase simulado, ver §3):** el consumo del administrador baja de **~143 MB por día de uso** a ~23 MB solo con P0 (−84 %) y a **~0.5 MB** con P0+P1 (−99.6 %); el de una sucursal de ~8.7 MB a 1.9 MB (P0) y 0.1 MB (P0+P1). Dos pestañas abiertas 30 min: de 842 solicitudes / 57 MB a 80 / 0.9 MB (P0).
- **Funcionalidad:** con los mismos datos, los 5 roles probados (administrador, supervisor, sucursal, inventarios, visualizador) ven lo mismo en las 3–11 vistas de cada rol, en computadora y en teléfono (misma lista de planes, estados, avances, contadores, dashboard, evidencias, arqueos, historial). Única diferencia por diseño: la lectura ligera omite avisos de más de 45 días ya leídos por todos (no se borran; el contador de no leídos no cambia).
- **Sin pérdida de datos ni de seguridad:** las reglas de acceso las siguen decidiendo las políticas de la base (la vista usa `security_invoker`; las miniaturas solo se leen si el plan es visible); probado en PostgreSQL real (§4).
- **Importante:** estos cambios reducen el consumo FUTURO. La restricción del ciclo actual (402) solo se levanta al iniciar el siguiente ciclo o al pasar a Pro (documentación oficial de Supabase).
- **Lo que necesito de ti** (§7): autorizar el orden de despliegue, y entregarme el resultado de `supabase/consultas/medicion_egress.sql` (incluye las políticas reales de `pa_docs`, que no están en el repositorio) antes de aplicar la parte de base de datos.

## 2. Cambios (todos reversibles)
### 2.1 Cliente `nexa/index.html` (v513; sin cambios visuales)
| Cambio | Dónde | Efecto |
|---|---|---|
| Sincronización **incremental** (`refresh`): solo filas con `updated_at` posterior a la última (holgura de 5 min); listado completo solo al recuperar Realtime o cada 30 min (único modo de detectar borrados) | `Supa.refresh`, `bump` | quita el listado completo cada 20 s |
| El sondeo de respaldo solo corre si Realtime **no** está conectado (cada 60 s); con Realtime activo, cada 5 min | temporizador final de `refresh` | −80 % a −92 % de solicitudes con la app abierta |
| **Recuperación de Realtime**: estado del canal; si se cae sube el respaldo, si no vuelve en 45 s se recrea el canal (reintentos con espera creciente) y al volver hace UNA sincronización completa | `Supa.listen`, `rtStatus` | fallo hallado y corregido durante las pruebas (la recreación omitía la resincronización) |
| `onChange` registra `updated_at` del evento: antes cada cambio recibido por Realtime se **descargaba otra vez** en el siguiente sondeo | `Supa.onChange` | elimina la doble descarga |
| **Puerta entre pestañas** (`Poll.gate`, localStorage) y aviso por `BroadcastChannel` solo si hubo cambios reales | `Poll` | una sola pestaña consulta |
| **Arqueos, descargas, supervisión**: ya no se baja la lista cada 60 s; se pregunta con una *firma barata* (conteo + última modificación, sin filas) y se recarga solo si cambió | `arqSig/arqProbe`, `dlsSig/dlsProbe`, `supSig/supProbe` | −94 % en Arqueos |
| Segundo plano: ninguna consulta (verificado: 0 solicitudes en 10 min con la pestaña oculta) | todos los temporizadores | — |
| **P1 (se activa solo si existe la migración E1; si no, funciona como antes):** lectura por `pa_docs_lite`; miniaturas bajo demanda (`TH`: por lotes, solo cuando la imagen está cerca de la pantalla, con caché en memoria y en el equipo); descargas por RPC agregada; listado de arqueos sin `data` (el cuerpo se pide al abrir el arqueo) | `Supa.probeLite`, `TH`, `arqLoad`, `arqOpen`, `loadDls` | −98 % al iniciar sesión |
| Interruptor de emergencia por equipo: `localStorage.nx_nolite = '1'` vuelve al modo anterior | `probeLite` | reversión inmediata sin desplegar |
### 2.2 Base de datos (`supabase/propuestas/egress/`, NO está en `supabase/auto`: no corre sola)
`E1_miniaturas_y_listados.sql` (tabla `pa_thumbs`, disparador que separa miniaturas sin perder ninguna, vista `pa_docs_lite` con `security_invoker`, `pa_descargas_resumen()`), `E1_reversion.sql`, `E2_compactar_miniaturas.sql` (con respaldo y verificación previa; requiere autorización aparte), `E2_reversion.sql`. Consulta de medición de solo lectura: `supabase/consultas/medicion_egress.sql`.
### 2.3 Función `recordatorios-de-nexa`
Lee los planes por `pa_docs_lite` y, si la vista no existe, por la tabla de siempre (verificado con `deno check`). **No cambia ninguna frecuencia** (ver `REVISION-PROCESOS-PROGRAMADOS.md`).

## 3. Mediciones comparativas (`pruebas/egress/resultados/`, `python3 comparar_mediciones.py`)
Banco de pruebas: Supabase simulado en el navegador (Chromium) con los datos idénticos en las tres corridas: 120 planes × 4 actividades con 8 miniaturas reales (JPEG 480 px, ~30 KB), 1 200 avisos, 300 arqueos (40 facturas c/u), 1 500 descargas, 600 filas de supervisión; reloj simulado; actividad de otras personas = 12 cambios de plan y 6 avisos por hora. Mide cuerpos de respuesta REST/RPC y eventos Realtime (+600 B de cabeceras por solicitud). `MB` = bruto; con compresión (gzip) los valores son menores (en las tablas de los JSON, columna `gz`; las miniaturas JPEG en Base64 comprimen poco en la práctica, por lo que el bruto es la cota conservadora).
| Escenario | Antes (solic. / MB) | P0 | P0+P1 | Ahorro P0 | Ahorro P0+P1 |
|---|---|---|---|---|---|
| Inicio de sesión, administrador | 7 / 11.55 | 9 / 11.64 | 8 / 0.19 | −1 % | **98 %** |
| Inicio de sesión, sucursal | 2 / 0.22 | 2 / 0.22 | 4 / 0.02 | 0 % | 92 % |
| 1 h con la app abierta, administrador | 450 / 32.88 | 92 / 2.88 | 92 / 0.09 | 91 % | **100 %** |
| 1 h con la app abierta, sucursal | 184 / 2.12 | 14 / 0.41 | 14 / 0.01 | 80 % | 99 % |
| 1 h en segundo plano, administrador | 16 / 2.44 | 16 / 2.44 | 16 / 0.03 | 0 % (solo Realtime) | 99 % |
| Arqueos abierto 10 min, administrador | 118 / 14.45 | 61 / 0.89 | 60 / 0.22 | 94 % | 98 % |
| Historial 10 min, administrador | 70 / 4.74 | 12 / 0.01 | 12 / 0.01 | 100 % | 100 % |
| Realtime caído 10 min + recuperación | 86 / 6.12 | 18 / 0.54 | 17 / 0.05 | 91 % | 99 % |
| Dos pestañas, 30 min | 842 / 56.86 | 80 / 0.91 | 80 / 0.15 | 98 % | 100 % |
Por usuario-día (1 inicio + 4 h abierta): administrador 143 MB → 23 MB → 0.5 MB; sucursal 8.7 MB → 1.9 MB → 0.1 MB. Con 3 usuarios «administrador» y el resto sucursales, el modelo ANTES da del orden de 10 GB/mes, coherente con los 11.75 GB observados, pero **no lo demuestra**: el volumen real de `pa_docs` se confirma con `medicion_egress.sql`, tras lo cual se repiten las corridas con `--data` calibrado.
**Qué falta para respaldar las proyecciones de escala con mediciones:** las cifras de 100 a 1 000 usuarios del informe de diagnóstico eran estimaciones matemáticas; con este banco se pueden medir (`escenarios.cjs --data` con más sucursales/planes) cuando se tengan los volúmenes reales. Lo medido sí demuestra que el costo por usuario deja de depender del tamaño total de los datos (inicio de sesión y reposo pasan de ~MB a ~KB).

## 4. Pruebas
| Prueba | Resultado |
|---|---|
| Funcional comparativa (`funcional.cjs`, 5 roles × todas sus vistas, PC y teléfono 390 px): planes visibles, estados, avances, contadores, textos de cada vista, detalle del plan, miniaturas tras recorrer la pantalla | idéntico, salvo avisos antiguos por diseño y estados «Cargando…/Comprobando…» de llamadas a funciones (sincronización de OneDrive/Sheets) que dependen del momento de la captura |
| Escritura: la sucursal sube una foto de evidencia; el servidor guarda el plan sin imágenes, la miniatura queda en `pa_thumbs`; sin caché local (otro equipo) las 8 miniaturas se vuelven a mostrar | OK (antes: imagen embebida en el plan) |
| Recuperación de Realtime (`recuperacion.cjs`): con Realtime activo no hay consultas; caído, el sondeo de respaldo trae lo nuevo ≤ 60 s; el borrado ajeno se detecta al recuperar; recrea el canal a los 45 s; en segundo plano 0 consultas | 6/6 OK (halló y corrigió un fallo real) |
| PostgreSQL real, 18 comprobaciones (`test_sql.sh`): E1 idempotente y sin cambiar `pa_docs`; vista ligera conserva `t` numéricos (revisión, cronología); ida y vuelta sin pérdida (quitar + incrustar = original byte a byte en las 40 filas); app «ligera» sobre un plan heredado no pierde fotos; foto nueva se separa; acceso (admin / sucursal / otra persona / anon); `pa_descargas_resumen` = lógica anterior; E2 con respaldo y verificación; E2_reversion y E1_reversion | todas OK |
| Mutaciones (5): sin resincronizar al recuperar; incremental ciego; miniaturas sin hidratar (las 3 las detectan las pruebas funcionales/de recuperación); sondeo siempre activo y puerta entre pestañas siempre abierta (las detecta la medición: 96→264 solicitudes; 15→30 en dos pestañas) | 5/5 detectadas |
| Sintaxis de los 6 scripts de la app; `deno check` de la función | OK |
No hay pruebas automáticas previas del cliente (`nexa/` es un solo archivo); estas pruebas quedan en `pruebas/egress/` (no se publican: el despliegue solo sube `nexa/`).

## 5. Riesgos pendientes
1. **Políticas reales de `pa_docs` no están en el repositorio.** La prueba SQL usa una réplica. La vista usa `security_invoker`, así que hereda las reales, pero hay que verificarlo con la salida de `medicion_egress.sql` (sección `pa_docs_politicas`/`pa_docs_disparadores`) y probar con una cuenta de cada rol tras aplicar E1.
2. **Disparadores existentes sobre `pa_docs`** (p. ej. de `updated_at`) pueden interactuar con `pa_docs_split_thumbs_t`; la consulta los lista.
3. El incremental depende de que `updated_at` avance en cada escritura (la app lo envía; la función de recordatorios inserta con el valor por defecto). Salvaguardas: holgura de 5 min y listado completo cada 30 min / al recuperar.
4. Los relojes muy desfasados (>5 min) entre equipos podrían retrasar un cambio hasta el listado completo (≤ 30 min), nunca perderlo.
5. Tras aplicar E1 y **antes** de que todos tengan v513, una versión antigua seguirá funcionando (el disparador conserva sus fotos) pero no ahorra.
6. Si se revierte E1 con equipos conectados en modo ligero, esos equipos mostrarán datos viejos hasta recargar (documentado en el procedimiento).
7. **No medido:** el tráfico real de Realtime y la compresión real de Supabase; el consumo de la función `super-api` (su código no está en el repositorio ni tengo acceso: no se pudo revisar); si el tráfico función→base cuenta como Egress; si «pa carlos» y «nexa-demo» comparten organización (no verificable desde el código: ver Organización → Configuración en cada proyecto).
8. **No implementado (P2/P1 por riesgo o por requerir cambios visibles, esperan tu autorización):** guardado parcial del plan (hoy se reescribe el `data` completo; sin miniaturas pesa mucho menos); paginación visible de arqueos/descargas con «cargar más» (cambia la interfaz); indicadores del dashboard calculados en PostgreSQL (hoy se calculan en el navegador con los planes ya ligeros); paginación de notificaciones en pantalla (el panel ya muestra 30).

## 6. Procedimiento de despliegue y reversión
Ver `PROCEDIMIENTO-DESPLIEGUE-Y-REVERSION.md`.

## 7. Decisiones que necesito de ti
1. ¿Autorizas desplegar solo el cliente v513 + función (P0 + P1 inactivo) mezclando la rama a `main`? (No requiere cambios en la base.)
2. ¿Autorizas, después, aplicar E1 en Supabase (idempotente, sin cambiar datos) en un horario de poco uso? Antes: ejecutar `medicion_egress.sql` y revisar con la salida las políticas.
3. E2 (compactar): propongo esperar una semana de operación estable con E1.
4. Ciclo actual: si NEXA no puede quedar restringida hasta el cambio de ciclo, la única salida inmediata es Pro (el código nuevo no cambia eso).
5. ¿Compartes el código de `super-api` (Supabase → Edge Functions → super-api → Code) y la salida de `medicion_egress.sql`?
