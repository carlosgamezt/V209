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

## 2026-11-25 · Medición en la nube (publicaciones #42 → #44) y causas reales de la lentitud

Medido contra la infraestructura publicada (Cloudflare → Supabase Edge Function → PostgreSQL → Digifact TEST) con `nube/medir_rendimiento.ts` (3 ciclos guardar → revisar → preparar → certificar; la cabecera `Server-Timing` de la función da consultas y tiempo de base por petición).

| Llamada | #42 (antes) | #44 | Notas |
|---|---|---|---|
| Archivos estáticos (Cloudflare) | 22–35 ms | 35–47 ms | no son el problema |
| `GET /api/fecha-emision` | 972 ms | 174 ms | 7 → 1 consulta |
| `GET /api/estado` | 2254 ms | 890 ms | 16 → 6 consultas |
| `GET /api/documentos` (lista) | 1379 ms | 514 ms | |
| Guardar | 3878 ms | 1926 ms | |
| Revisar | 3270 ms | 1593 ms | |
| Preparar | 2615 ms | 844 ms | |
| Certificar | 7808 ms | 5844 ms | falta el chequeo previo (ver abajo) |
| **Ciclo completo** | **17 571 ms** | **10 207 ms** | |

Causas: (1) cada consulta remota cuesta 108–250 ms y cada petición hacía decenas, una tras otra (7 solo para identificar a la persona, 2 veces la sesión y 4 el usuario); (2) toda escritura entraba en la sección crítica de los simuladores (≈10 viajes) aunque no usara simuladores; (3) el detalle del documento hacía 11 lecturas seguidas; (4) la función corre en us-east-2 y la base en us-west-2 (`select 1` = 54 ms); (5) el chequeo previo de Digifact (`#prevuelo`) hacía hasta 8 consultas de solo lectura una tras otra (≈3 s) y no se contaba como tiempo de Digifact.

Correcciones: sesión+persona en una consulta y una vez por petición; sin sección crítica en escrituras de negocio; `BdDemo.lote` (lecturas independientes en un solo viaje, verificado con 140 ms simulados: 8 consultas 1158 → 217 ms); permisos 5 s, tipos de prueba 60 s, nombres de personas 30 s; chequeo previo en paralelo (sigue sin enviar si cualquiera de los 8 días lo encuentra o no se puede comprobar); `x-region` hacia la región de la base.

### Resultado de la publicación #45 (commit 1c9660a): función en la región de la base + chequeo previo en paralelo

`select 1` dentro de la función: 54 ms → 4 ms (función y base en us-west-2). Mediana de 3 ciclos medidos desde el ejecutor de CI contra la nube:

| Llamada | #42 | #44 | #45 |
|---|---|---|---|
| `GET /api/fecha-emision` | 972 ms | 174 ms | 88 ms |
| `GET /api/estado` | 2254 ms | 890 ms | 218 ms |
| `GET /api/documentos` | 1379 ms | 514 ms | 144 ms |
| Guardar | 3878 ms | 1926 ms | 224–450 ms |
| Revisar | 3270 ms | 1593 ms | 188–261 ms |
| Preparar | 2615 ms | 844 ms | 122–167 ms |
| Ciclo completo (guardar+revisar+preparar+certificar) | 17 571 ms | 10 207 ms | 2 567 ms (primer ciclo en frío 6 072 ms) |
| Tiempo atribuible a NEXA + red | ≈17 000 ms | ≈9 700 ms | ≈940 ms |

El resto del ciclo es Digifact TEST (chequeo previo ≈1,1–1,3 s con las 8 consultas a la vez, envío ≈0,35 s; en frío el chequeo tardó 4,9 s). En la prueba de certificación completa (con descarga de XML/PDF) Digifact respondió entre 2,6 s y 13,5 s según el documento: esa variación es de Digifact, no de NEXA.
