# Comparación de rendimiento contra #55 en infraestructura real (`nexa-fel-test`) — procedimiento y criterios

Las optimizaciones de #55 **no se tocaron** (rutas sin Data API usan el mismo lote de consultas y el mismo calentamiento; ver `docs/rendimiento-historial.md`). Las mediciones locales (`MEDICIONES-R3.md`) son de la base sin red y **no** sustituyen esta comparación. Las cifras de red no se presentan como garantía desde Guatemala.

## 1. Qué se compara (misma infraestructura, misma región, mismo día, rondas alternadas)
| Configuración | Descripción |
|---|---|
| **A · pooler + envoltorios (hoy)** | `nexa-api` con `nexa_app` por el pooler 6543, identidad por token de sesión (`fel_ses_*`), consultas en lote de #55 |
| **B · Data API** | `nexa-api` reenvía el JWT a PostgREST (`api.*`, `FEL_DATOS=dataapi`), una RPC por pantalla, RLS optimizada (M-L…M-U) |
| **C · híbrido (solo si B no cumple)** | Data API para operaciones sensibles/escrituras y lecturas masivas por `nexa_app` con R3 documentado y **sin clientes reales** |

## 2. Escenarios y herramientas existentes
| Escenario | Herramienta | Referencia #55 |
|---|---|---|
| Primera certificación tras inactividad (arranque en frío) | `demo-facturacion/nube/medir_frio.cjs` (`FEL_MEDIR_INACTIVIDAD_S=600`, 3 rondas) | `rendimiento-historial.md` |
| «Nueva factura» → «Guardar y certificar en TEST» desde la interfaz real (escritorio y teléfono +120 ms, 5/2 Mbps, CPU 4×) | `nube/medir_ui_real.cjs` | ídem |
| `GET /api/estado`, `/api/documentos?pagina=1`, detalle, `/api/panel`, `/api/plan`, `/api/clientes?pagina=1` | peticiones repetidas con `Server-Timing` de la función (ya expone consultas y tiempos) | tabla «Servidor» del historial (p. ej. estado 890 ms, lista 514 ms, guardar 1 926 ms) |
| Volúmenes 300 / 3 000 / 15 000 documentos y clientes (datos simulados, misma carga en A y B) | carga con SQL de siembra del ensayo + las peticiones anteriores | `MEDICIONES-R3.md` (referencia local) |
Documentos de PRUEBA, Digifact TEST/simulado, sin correo, sin clientes reales; no se imprimen contraseñas, tokens ni cookies.

## 3. Método
1. Calentar y fijar el estado: mismo mundo de datos y volumen en A y B; sin otras cargas.
2. **≥ 5 rondas** por celda alternando A y B (A, B, B, A…), en frío y en caliente; descartar la primera medición de cada arranque solo si se documenta.
3. Registrar por celda: p50, p95, máximo, nº de consultas/vueltas, bytes transferidos y, para B, cuánto corresponde a PostgREST y cuánto a la función.
4. Repetir un segundo día para ver la variación entre días.

## 4. Criterios de aceptación (propuestos; el titular los confirma antes de medir)
- **Sin regresión reproducible** en los flujos medidos: B ≤ A + 10 % en p50 y ≤ A + 20 % en p95 (con un mínimo de +50 ms de tolerancia por ruido), en frío y en caliente, para los 3 volúmenes.
- La **primera certificación** y «Nueva factura» no empeoran frente a la línea base de #55.
- Las pantallas con volumen alto (lista de documentos, panel, clientes) quedan por debajo de 500 ms p95 a 15 000 registros.
- Si B incumple en alguna celda: investigar (¿vuelta HTTP adicional?, ¿RLS?, ¿JWT?); si no se resuelve, aplicar C para esa operación y registrar el riesgo.

## 5. Qué se registra y dónde
Resultados en `docs/multiempresa/RESULTADOS-RENDIMIENTO-NEXA-FEL-TEST.md` (nuevo, con fecha, versión de cada componente, región, cifras brutas y conclusión), sin secretos. Si aparece una regresión, se abre un punto en el informe de riesgos antes de cualquier paso a producción.
