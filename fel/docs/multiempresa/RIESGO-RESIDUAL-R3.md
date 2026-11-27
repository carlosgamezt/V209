# Riesgo residual de R3 (lecturas de datos de empresa por el pooler) — registro sitio por sitio

**R3 NO está cerrado globalmente (fase 4: cerrado en local; falta la verificación hospedada, §4).** Este registro es la fuente de verdad (el inventario automático `R3-INVENTARIO-LECTURAS.md` cuenta *sitios de código SQL* y por eso incluye también las ramas del modo pooler que ya tienen su alternativa por Data API).
Compuerta de cierre: con la Data API activa, **ninguna** consulta de datos de empresa hecha en nombre de una persona llega al pooler/`nexa_app`; lo que quede debe pasar al nivel `nexa_sys`/RPC con permiso o desaparecer con la simulación.

## 1. Ya migrado (alternativa por Data API: RPC `INVOKER`+RLS o `DEFINER` con permiso explícito; sin JWT se rechaza antes de tocar la base)
`/api/clientes` (lista, página), `/api/conceptos` (lista, página), `/api/estado` (clientes, conceptos, establecimientos y parámetros de usuario, con conjunto de trabajo y totales), `/api/configuracion` (establecimientos), `/api/documentos` (lista y página), `/api/documentos/:id` (detalle), `/api/artefactos/:id` (descarga con permiso), `/api/panel`, `/api/reportes/documentos.csv`, `/api/reportes/consumos.csv`, `/api/plan`, `/api/usuarios` (invitaciones, roles, catálogo), `/api/plataforma/{resumen,planes,bolson,bolson/conciliaciones,empresas/:id/plan}` y la verificación de saldos.
Además, con la Data API activa **toda** ruta autenticada sin JWT válido se rechaza (403) antes de cualquier consulta (prueba con espía: 0 consultas).

## 2. Cerrado por desactivación con la Data API (solo existen en la simulación)
Alta de cuentas de demostración (`POST /api/usuarios`, `POST /api/plataforma/empresas`), importar extracto desde un certificador simulado, consultar al certificador simulado, conciliar anulación simulada y la sincronización con los simuladores (`sincronizar`). Con la Data API devuelven 404 «solo existe en la simulación». Se eliminan con el simulador en W6.

## 3. CERRADO EN LOCAL en la fase 4 (M-V1/M-V + servidor; falta la verificación hospedada)
| Sitio | Cómo quedó | Evidencia |
|---|---|---|
| `/api/estado` y `/api/configuracion` (permisos, empresa, canales, último borrador) | `api.empresa_contexto()` (DEFINER; empresa de la sesión; sin parámetros de identidad) | `prueba-cierre-r3.sql`, `tests/cierre_r3_test.ts` |
| Pre-lecturas de validación en los flujos de escritura de documentos/clientes/alertas/conciliación | `api.documento_ref`, `api.cliente_ref` (INVOKER + RLS), `api.referencia` (DEFINER, filtra por empresa), `api.documento_cobertura` (exige `borradores.ver` y alcance) | ídem; mutaciones: alerta sin empresa, cobertura sin permiso, operación sin empresa, contexto de otra empresa: todas detectadas |
| Digifact (`api_digifact.ts`), correo (`correo/servicio.ts`), almacén (`almacen_gt_pg.ts`), límites (`limite_pg.ts`) | cerrojo estructural `acotarBd`/`acotarFilas`: solo SQL directo sobre sus tablas de servicio; lo demás por `fel_sys_*` (siete funciones DEFINER con `p_empresa` ya verificado, `search_path=''`, solo `nexa_sys`) | `cierre_r3_test` (cerrojo en los tres servicios), `prueba-cierre-r3.sql` (solo `nexa_sys`; `authenticated` y `nexa_app` denegados) |
| PDF, `certOp`, detalle y auditoría de acceso | `empresa_contexto`, `documento_cobertura`, `soloSimulacion()` (404 con la Data API) | `cierre_r3_test` |
| Rutas que no pasan por la Data API (Digifact, PDF) | **verificación propia del JWT** (ES256/RS256 por JWKS; `sub` = persona de la sesión) y comprobación de **sesión viva** (`empresa_contexto`) | `verificador_jwt_test`; hallazgo real corregido: con firma ajena la ruta respondía 200 |
| Privilegios de `nexa_sys` | solo select/insert/update (y delete de `demo_limites`) sobre `digifact_operaciones`, `digifact_artefactos`, `envios_correo`, `demo_limites`; ninguno sobre documentos, clientes, empresas, auditoría ni sesiones | `prueba-nexa-sys.sql`, mutación «nexa_sys lee documentos» detectada |
| Reversión | `reversion-M-V.sql` (en la cadena de `test-rol-app.sh`) | suite en verde |
## 4. PENDIENTE — requiere el proyecto hospedado o el retiro de la simulación
| Tema | Por qué |
|---|---|
| Los pasos fiscales `fel_ses_sys_*` (siete envoltorios de transición) siguen identificándose por **token de sesión**; tras W6 no habrá token | hay que delegar el paso a `nexa-sys` (W5): se comprueba en `nexa-fel-test` |
| Escrituras de la demostración y simuladores (`demo_*`, `mundo_*`) | se retiran con el simulador en W6 |
| Espía extendido a todas las rutas con JWT **verificado por Supabase real** (la prueba local usa JWT firmado por el emulador) | W0/W5 |
| `nexa_app` sin `SELECT` en producción y sonda de rutas alternativas | 1E |
| Medición contra #55 | `COMPARACION-RENDIMIENTO-55.md` |
**R3 no se declara cerrado globalmente**: lo anterior es la compuerta pendiente.

## 5. Fuera de R3 por diseño (no son datos de empresa)
Catálogos globales sin datos de empresa (régimen fiscal, proveedores de emisión, permisos, eventos), sesiones y simuladores `demo_*` (se retiran en W6) y la siembra `mundo_demo`/`mundo_practico`/`demo_establecimientos` (solo demostración y pruebas).

## 6. Criterio de cierre y evidencia exigible
1. Inventario regenerado sin sitios de §3 y §4 (o cada uno justificado aquí).
2. Prueba del **espía** extendida a *todas* las rutas autenticadas: con JWT válido, 0 consultas de la aplicación al pooler salvo las explícitamente permitidas en una lista cerrada.
3. `nexa_app` sin `SELECT` sobre tablas de empresa (prueba de catálogo) y sonda de rutas alternativas sin hallazgos.
4. Medición de rendimiento (`COMPARACION-RENDIMIENTO-55.md`) sin regresión frente a #55.
