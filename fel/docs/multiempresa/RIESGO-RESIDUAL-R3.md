# Riesgo residual de R3 (lecturas de datos de empresa por el pooler) — registro sitio por sitio

**R3 NO está cerrado.** Este registro es la fuente de verdad (el inventario automático `R3-INVENTARIO-LECTURAS.md` cuenta *sitios de código SQL* y por eso incluye también las ramas del modo pooler que ya tienen su alternativa por Data API).
Compuerta de cierre: con la Data API activa, **ninguna** consulta de datos de empresa hecha en nombre de una persona llega al pooler/`nexa_app`; lo que quede debe pasar al nivel `nexa_sys`/RPC con permiso o desaparecer con la simulación.

## 1. Ya migrado (alternativa por Data API: RPC `INVOKER`+RLS o `DEFINER` con permiso explícito; sin JWT se rechaza antes de tocar la base)
`/api/clientes` (lista, página), `/api/conceptos` (lista, página), `/api/estado` (clientes, conceptos, establecimientos y parámetros de usuario, con conjunto de trabajo y totales), `/api/configuracion` (establecimientos), `/api/documentos` (lista y página), `/api/documentos/:id` (detalle), `/api/artefactos/:id` (descarga con permiso), `/api/panel`, `/api/reportes/documentos.csv`, `/api/reportes/consumos.csv`, `/api/plan`, `/api/usuarios` (invitaciones, roles, catálogo), `/api/plataforma/{resumen,planes,bolson,bolson/conciliaciones,empresas/:id/plan}` y la verificación de saldos.
Además, con la Data API activa **toda** ruta autenticada sin JWT válido se rechaza (403) antes de cualquier consulta (prueba con espía: 0 consultas).

## 2. Cerrado por desactivación con la Data API (solo existen en la simulación)
Alta de cuentas de demostración (`POST /api/usuarios`, `POST /api/plataforma/empresas`), importar extracto desde un certificador simulado, consultar al certificador simulado, conciliar anulación simulada y la sincronización con los simuladores (`sincronizar`). Con la Data API devuelven 404 «solo existe en la simulación». Se eliminan con el simulador en W6.

## 3. PENDIENTE — lecturas pequeñas en pantallas calientes (siguen por el pooler **con JWT presente**)
| Sitio | Qué lee | Destino previsto |
|---|---|---|
| `api.ts` `/api/estado`: permisos efectivos, alcance, `empresaDatos()`, `canalBase()`; `api_practico.estadoExtra` (canales simulados) | datos de la persona y de la empresa | una RPC `api.contexto_pantalla()` (INVOKER + RLS) o los claims verificados; sin tablas nuevas |
| `api.ts` `/api/configuracion`: empresa+régimen, canales, `ultimo_borrador` | datos de la empresa | `api.configuracion_resumen()` |
| `api_practico.ts` `empresa_canales` (canal por proveedor) y lectura de `miembros` en alta de empresa (demo) | canales | misma RPC; la alta de demo ya está cerrada |
## 4. PENDIENTE — lecturas dentro de flujos de escritura (validan datos justo antes de llamar a la RPC de escritura)
| Sitio | Flujo | Destino previsto |
|---|---|---|
| `api.ts` guardar documento (clientes/documentos), cambios de estado, preparación, certificar, anular, conciliar, alertas (≈14 sitios: líneas 141–232, 410, 439, 444, 485) | pre-lecturas de validación | moverlas **dentro** de las funciones `fel_op_*` (ya validan en la base) o a `api.documento_contexto(p_id)` |
| `api_digifact.ts` (4) y `correo/servicio.ts` (4) | datos del documento/receptor/artefacto para Digifact y correo | RPC de contexto con permiso + pasos del sistema en `nexa-sys` (`fel_ses_sys_*` ya existen para varios) |
| `proveedores/src/almacen_gt_pg.ts` (6: `digifact_operaciones`, `digifact_artefactos`) | almacén de resultados de Digifact | funciones `fel_sys_*` (nivel sistema), no SQL directo |
| `api_practico.ts` `certOp`, PDF de demostración, auditoría de acceso | consultas puntuales de la simulación y del PDF | PDF: `api.documento_detalle` + datos de empresa de la RPC de configuración; el resto desaparece con el simulador |

## 5. Fuera de R3 por diseño (no son datos de empresa)
Catálogos globales sin datos de empresa (régimen fiscal, proveedores de emisión, permisos, eventos), sesiones y simuladores `demo_*` (se retiran en W6) y la siembra `mundo_demo`/`mundo_practico`/`demo_establecimientos` (solo demostración y pruebas).

## 6. Criterio de cierre y evidencia exigible
1. Inventario regenerado sin sitios de §3 y §4 (o cada uno justificado aquí).
2. Prueba del **espía** extendida a *todas* las rutas autenticadas: con JWT válido, 0 consultas de la aplicación al pooler salvo las explícitamente permitidas en una lista cerrada.
3. `nexa_app` sin `SELECT` sobre tablas de empresa (prueba de catálogo) y sonda de rutas alternativas sin hallazgos.
4. Medición de rendimiento (`COMPARACION-RENDIMIENTO-55.md`) sin regresión frente a #55.
