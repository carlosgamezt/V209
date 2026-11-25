# Historial de documentos: paginación real y primera medición (25/11/2026)

**Qué cambió:** `GET /api/documentos?pagina=…` ahora filtra y pagina **en el servidor** (`demo-facturacion/src/lista_documentos.ts`): 25 por página (máx. 100), conteos por categoría (Emitidos, Borradores, Anulados, Pendientes), filtros por texto (cliente, serie, número fiscal, UUID, BR-####), NIT, tipo de DTE, estado y rango de fechas. Parámetros siempre ligados (sin concatenar), acotados a la empresa de la sesión, comodines `%`/`_` tratados como texto. Sin `pagina` devuelve la lista antigua (compatibilidad). La pantalla Documentos abre en **Emitidos**; **Pendientes** (por verificar, pendientes de certificar, rechazados, anulación solicitada o con alerta) aparece como pestaña con contador cuando hay alguno. Búsqueda con espera de 300 ms y descarte de respuestas atrasadas.

**Medición** (`tests/bench_lista.ts`; servidor + PostgreSQL **en memoria** de la demostración, 12–15 repeticiones; **no incluye red, navegador ni Supabase hospedado**):

| Documentos | Consulta | p50 ms | p95 ms | KB |
|---|---|---|---|---|
| 100 | lista completa (antes) | 8 | 9 | 57.9 |
| 100 | página de 25 (después) | 8 | 9 | 15.6 |
| 1,000 | lista completa (antes) | 39 | 60 | 579.1 |
| 1,000 | página de 25 (después) | 9 | 12 | 15.6 |
| 10,000 | lista completa (antes) | 283 | 299 | 5,791 |
| 10,000 | página de 25 (después) | 71 | 77 | 15.6 |
| 10,000 | página de 25 con búsqueda | 25 | 48 | 0.1 |

Lectura honesta: el volumen transferido pasa de crecer con el historial (5.8 MB con 10,000) a ser constante (~16 KB). El tiempo del servidor con 10,000 documentos baja de ~283 ms a ~71 ms; el tiempo percibido en el teléfono dependerá además de la red, que **no se midió** aquí. Con 10,000 documentos el conteo total domina (71 ms): si en Supabase resultara lento, el siguiente paso sería un índice `(empresa_id, estado_fiscal, numero_borrador)` — sería una migración y requeriría tu autorización; no se aplicó nada.

## Navegación y carga inicial (25/11/2026, segunda medición)
Qué se hizo: caché en memoria del cliente (`web/js/api.js`) para catálogos y estado del canal, atada a la sesión; lecturas idénticas simultáneas comparten una solicitud; carga diferida de pantallas (la carga inicial ya no descarga el código de todas); el indicador de pendientes no se vuelve a pedir en cada cambio de pantalla si no hubo escrituras (15 s). **Seguridad de la caché:** solo memoria de la pestaña (nada en disco, `localStorage` ni cachés compartidas); lista blanca de 4 rutas (`/api/tipos-documento`, `/api/correo/estado`, `/api/digifact/estado`, `/api/fecha-emision`) con TTL de 5 min, 5 min, 60 s y 60 s; los documentos, el historial y cualquier dato fiscal **nunca** se cachean; se vacía al entrar, salir, vencer la sesión, cambiar de persona y tras escrituras de configuración, clientes o sesión; una respuesta que llega tras cerrar sesión no se guarda (`tests/cache_cliente_test.ts`, 6 casos).

Medición (`tests/medir_navegacion.cjs`, Chromium en teléfono 390 px contra el servidor local de la demostración; **una sola ejecución por celda en la carga inicial**, 5 repeticiones en la navegación; la red «lenta» es emulada con 1.6 Mb/s y 150 ms, no una red móvil real):

| Acción | Antes (sin limitar) | Después (sin limitar) | Antes (lenta) | Después (lenta) |
|---|---|---|---|---|
| Carga inicial con inicio de sesión | 342 ms · 39 solicitudes | 308 ms · 15 solicitudes | 3,563 ms · 39 solicitudes | 2,230 ms · 17 solicitudes |
| Documentos → Nueva factura (navegación interna) | 79 ms · 7 solicitudes | 68 ms · 1 solicitud | 587 ms · 7 solicitudes | 225 ms · 1 solicitud |

Lectura honesta: en red local las ganancias de tiempo son pequeñas (el cuello de botella allí no es la red); donde se nota es en red lenta, por la reducción de solicitudes (39 → 15–17 al abrir; 7 → 1 al navegar). La meta de carga inicial ≤ 3 s se cumple en la medición lenta emulada (2.2 s) pero falta medirla en un teléfono real contra Cloudflare/Supabase hospedados (arranque en frío de la función incluido). Navegación interna ≤ 500 ms: cumplida en la medición (225 ms con red lenta emulada).
