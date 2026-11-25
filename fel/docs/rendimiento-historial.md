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
