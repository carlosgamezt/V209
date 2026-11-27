<!-- Generado por tools/medir-lecturas-rls.sh y completado a mano con el análisis. No es una medición contra #55 ni de la red de Supabase. -->
# Mediciones de lecturas por la Data API (RLS) · 2026-11-27

Base local PostgreSQL, 1 conexión, **sin red**, 2 s por caso, mismas sentencias que PostgREST (claims + `SET LOCAL ROLE authenticated` + RPC). Latencia media en **ms** (menos es mejor). **No** es una medición contra #55 ni de la red de Supabase.
N = clientes = documentos (y líneas) de una empresa; la tercera parte de los documentos está certificada. Variantes: **V0** políticas originales · **V1** + «sesión viva» una vez por consulta · **V2** + permisos por conjunto de empresas · **V3** + alcance por establecimiento por conjunto (estado propuesto). «directo» = SQL de superusuario sin RLS (referencia).

## N = 300

| caso | directo (sin RLS) | V0 original | V1 | V2 | V3 propuesto | V0 → V3 |
|---|---|---|---|---|---|---|
| clientes_listar (N filas) | 1.19 (consulta actual del servidor) | 298.93 | 315.22 | 138.64 | 5.76 | ×51.9 |
| estado_catalogos | — | 77.79 | 77.55 | 5.19 | 4.62 | ×16.8 |
| documentos_listar p.1 (25) | 3.80 | 575.55 | 303.77 | 175.81 | 7.51 | ×76.6 |
| documentos_listar filtrada p.2 | — | 448.47 | 451.44 | 195.51 | 7.56 | ×59.3 |
| documento_detalle | — | 5.82 | 5.96 | 6.52 | 6.36 | ×0.9 |
| panel_resumen | — | 592.41 | 614.46 | 342.62 | 8.12 | ×73.0 |

## N = 3000

| caso | directo (sin RLS) | V0 original | V1 | V2 | V3 propuesto | V0 → V3 |
|---|---|---|---|---|---|---|
| clientes_listar (N filas) | 2.13 (consulta actual del servidor) | 3160.59 | 3161.77 | 1619.61 | 29.32 | ×107.8 |
| estado_catalogos | — | 787.18 | 788.75 | 19.20 | 17.86 | ×44.1 |
| documentos_listar p.1 (25) | 4.58 | 2453.84 | 2242.30 | 1446.42 | 10.12 | ×242.5 |
| documentos_listar filtrada p.2 | — | 4170.79 | 3941.03 | 1918.42 | 13.27 | ×314.3 |
| documento_detalle | — | 5.69 | 6.43 | 6.39 | 6.27 | ×0.9 |
| panel_resumen | — | 5830.80 | 5860.23 | 3368.11 | 12.41 | ×469.8 |

## N = 15000

| caso | directo (sin RLS) | V0 original | V1 | V2 | V3 propuesto | V0 → V3 |
|---|---|---|---|---|---|---|
| clientes_listar (N filas) | 6.41 (consulta actual del servidor) | 17842.19 | 17031.56 | 8290.47 | 146.10 | ×122.1 |
| estado_catalogos | — | 4376.20 | 3834.77 | 120.16 | 115.77 | ×37.8 |
| documentos_listar p.1 (25) | 7.96 | 11600.83 | 11469.92 | 7445.64 | 26.73 | ×434.0 |
| documentos_listar filtrada p.2 | — | 21032.68 | 20624.49 | 9172.76 | 45.49 | ×462.4 |
| documento_detalle | — | 5.72 | 5.68 | 6.34 | 6.17 | ×0.9 |
| panel_resumen | — | 29153.71 | 29346.69 | 18616.19 | 161.60 | ×180.4 |


## Lectura de los resultados
- **Qué se midió:** latencia en la base (PostgreSQL local, 1 conexión, sin red) de las RPC de lectura exactamente como las ejecuta PostgREST (claims + `SET LOCAL ROLE authenticated`). Los **mismos datos** se usan para las cuatro variantes de cada volumen; solo cambian las políticas RLS.
- **V0 (políticas originales de las migraciones) no es viable por la Data API:** `fel_tiene_permiso(...)` y `fel_en_alcance(...)` se evalúan **por fila** y cada una consulta varias tablas. Con 300 documentos ya cuesta 575 ms por página; con 15 000, 11.6 s.
- **V1** («sesión viva» evaluada una vez por consulta) casi no cambia la medida: la función es barata; se conserva porque no cuesta nada.
- **V2** (permisos por conjunto de empresas, calculado una vez) elimina el costo por fila de los permisos; `estado_catalogos` (solo clientes, conceptos y establecimientos) pasa de 787 ms a 19 ms con N = 3 000.
- **V3** (alcance por establecimiento también por conjunto) es el que hace viable la lectura de documentos: `documentos_listar` de 7.4 s a 27 ms con N = 15 000; `panel_resumen` de 18.6 s a 162 ms.
- **Costo residual:** `documento_detalle` ≈ 6 ms (constante): son unas diez políticas (una por tabla consultada) con su conjunto de permisos. `clientes_listar` y `estado_catalogos` crecen con N porque devuelven **todas** las filas serializadas en JSON (146 ms y 116 ms con 15 000 clientes); la consulta actual del servidor también devuelve todas (6.4 ms sin serializar). Es un tema de diseño de pantalla (paginar la lista de clientes), no de RLS.
- **Optimización adicional (conteo de facturas por cliente):** la primera corrida, antes de reescribir el conteo como una agregación única, daba para `clientes_listar` con la política propuesta: **22 ms (N=300), 1 182 ms (N=3 000) y 16 877 ms (N=15 000)**; tras reescribirlo: **5.8, 29.3 y 146 ms**. Esa primera corrida (V0 → V3 de `clientes_listar`: 360 → 22, 4 214 → 1 182, 36 165 → 16 877 ms) queda como evidencia «antes» de esa optimización.
- **Limitaciones:** una conexión; latencias de una base local; el pooler de Supabase y la red añaden tiempo fijo por viaje (≈140 ms medidos en la nube con el pooler). La comparación contra #55 y el efecto de la Data API real se miden en `nexa-fel-test`.
