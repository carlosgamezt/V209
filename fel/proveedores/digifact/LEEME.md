# Referencias oficiales de Digifact (Guatemala) — solo para pruebas

Copias **sin modificar** de la documentación pública, descargadas el 14/11/2026 desde `https://documentacion.digifact.com`:

| Archivo | Origen | SHA-256 |
|---|---|---|
| `NUCSchema.gt.json` | `/schemas/gt/NUCSchema.json` (JSON Schema draft-04, NUC V2.0.3) | `1054b9c8cb06cdc8c771a36308cf52a6f9ce91ac3be8172948b88e6a5f448067` |
| `ejemplos/NUC_1_FACT_CF.json` | `/examples/gt/json/NUC 1 - FACT CF.json` | — |
| `ejemplos/NUC_1_FACT_CUI.json` | `/examples/gt/json/NUC 1 - FACT CUI.json` | — |

Sirven para comprobar en las pruebas que lo que construye `src/nuc_gt.ts` respeta la estructura oficial. El esquema es necesario pero **no suficiente**: la API valida además reglas de negocio de la SAT.
Si Digifact publica una versión nueva (ver «Novedades»), se descargan de nuevo y se actualiza este archivo.
