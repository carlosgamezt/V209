# R3 · Inventario de acceso a datos del servidor (generado)

> Generado por `tools/inventario-lecturas.ts`. NO editar a mano. Base: catálogo con las migraciones 1-30 y las propuestas M-D…M-L aplicadas en un PostgreSQL en memoria.

**158 consultas SQL directas** (`filas`/`ejecutar`) y **119 llamadas `rpc`** a 88 funciones.

## 1. Consultas SQL directas por clase
| Clase | Consultas |
|---|---|
| datos de empresa | 55 |
| sin tabla (funciones, catálogos, utilidades) | 51 |
| plataforma y catálogos globales | 30 |
| sesiones y simuladores de la demostración (`demo_*`) | 22 |

## 2. Por tipo
| Tipo | Consultas |
|---|---|
| select | 124 |
| insert | 19 |
| update | 7 |
| delete | 4 |
| ${sel_cuenta} | 3 |
| with | 1 |

## 3. Tablas tocadas (de mayor a menor)
| Tabla | Consultas | Tiene `empresa_id` | RLS |
|---|---|---|---|
| `documentos` | 12 | sí | sí |
| `empresas` | 11 | no | sí |
| `clientes` | 9 | sí | sí |
| `consumos` | 7 | sí | sí |
| `bolson_cuentas` | 7 | no | sí |
| `demo_sesiones` | 7 | no | sí |
| `operaciones_fiscales` | 6 | sí | sí |
| `cargos` | 6 | sí | sí |
| `demo_simulador_estado` | 5 | no | sí |
| `digifact_operaciones` | 5 | sí | sí |
| `empresa_canales` | 4 | sí | sí |
| `regimenes_fiscales` | 4 | no | sí |
| `perfiles` | 4 | no | sí |
| `conceptos` | 3 | sí | sí |
| `establecimientos` | 3 | sí | sí |
| `plan_versiones` | 3 | no | sí |
| `planes` | 3 | no | sí |
| `miembros` | 3 | sí | sí |
| `bolson_lotes` | 3 | no | sí |
| `demo_entorno` | 3 | no | sí |
| `demo_intentos` | 3 | no | sí |
| `contratos_plan` | 2 | sí | sí |
| `tarifas` | 2 | no | sí |
| `monedero_saldos` | 2 | sí | sí |
| `bolson_conciliaciones` | 2 | no | sí |
| `demo_limites` | 2 | no | sí |
| `plataforma_parametros` | 2 | no | sí |
| `demo_credenciales` | 2 | sí | sí |
| `digifact_artefactos` | 2 | sí | sí |
| `proveedores_emision` | 1 | no | sí |
| `artefactos_documento` | 1 | sí | sí |
| `cuentas_comerciales` | 1 | sí | sí |
| `pagos` | 1 | sí | sí |
| `cobros` | 1 | sí | sí |
| `invitaciones` | 1 | sí | sí |
| `rol_permisos` | 1 | no | sí |
| `permisos_catalogo` | 1 | no | sí |
| `alertas_fiscales` | 1 | sí | sí |
| `evento_tipos` | 1 | no | sí |
| `bolson_saldos` | 1 | no | sí |
| `bolson_reglas_consumo` | 1 | no | sí |
| `bolson_alertas` | 1 | sí | sí |
| `bolson_extracto_lineas` | 1 | no | sí |
| `bolson_extractos` | 1 | no | sí |
| `bolson_conciliacion_partidas` | 1 | sí | sí |
| `bolson_partida_resoluciones` | 1 | sí | sí |
| `plataforma_admins` | 1 | no | sí |

## 4. Llamadas `rpc` por tratamiento de identidad
| Tratamiento | Llamadas |
|---|---|
| sistema en petición (fel_ses_sys_*) | 38 |
| empresa (fel_ses_*) | 33 |
| plataforma (fel_pla_*) | 16 |
| sistema o protocolo del agente (nexa_sys / autenticación propia) | 11 |
| ya con identidad de sesión (fel_adm_*, fel_ses_*, fel_pla_*) | 9 |
| auditoría (fel_ses_auditar) | 5 |
| sistema en petición (fel_ses_sys_* / fel_pla_sys_*; la función de sistema usa nexa_sys) | 3 |
| directa | 3 |
| acceso acotado (fel_aud_acceso) | 1 |

### Llamadas `rpc` todavía DIRECTAS con alcance de persona o empresa (pendientes: R3/F5)
- `fel_permisos_efectivos` ×1
- `fel_op_invitacion_aceptar` ×1
- `fel_op_x` ×1

## 5. Consultas sobre datos de empresa (las que F5-3 debe llevar a RPC de lectura o a RLS con la identidad de Supabase Auth)
| Archivo:línea | Tipo | Tablas | Ruta por Data API (RPC INVOKER + RLS) |
|---|---|---|---|
| `demo-facturacion/src/api.ts:83` | select | `empresa_canales` | no |
| `demo-facturacion/src/api.ts:113` | select | `documentos` | **sí** (el SQL queda solo como camino del modo pooler) |
| `demo-facturacion/src/api.ts:115` | select | `clientes` | **sí** (el SQL queda solo como camino del modo pooler) |
| `demo-facturacion/src/api.ts:117` | select | `clientes` | **sí** (el SQL queda solo como camino del modo pooler) |
| `demo-facturacion/src/api.ts:290` | select | `documentos`, `clientes` | **sí** (el SQL queda solo como camino del modo pooler) |
| `demo-facturacion/src/api.ts:301` | select | `conceptos` | **sí** (el SQL queda solo como camino del modo pooler) |
| `demo-facturacion/src/api.ts:312` | select | `documentos`, `establecimientos` | **sí** (el SQL queda solo como camino del modo pooler) |
| `demo-facturacion/src/api.ts:314` | select | `empresa_canales` | no |
| `demo-facturacion/src/api.ts:316` | select | `documentos` | no |
| `demo-facturacion/src/api.ts:409` | select | `artefactos_documento` | no |
| `demo-facturacion/src/api_practico.ts:51` | select | `operaciones_fiscales`, `consumos` | **sí** (el SQL queda solo como camino del modo pooler) |
| `demo-facturacion/src/api_practico.ts:52` | select | `operaciones_fiscales` | no |
| `demo-facturacion/src/api_practico.ts:57` | select | `operaciones_fiscales` | no |
| `demo-facturacion/src/api_practico.ts:58` | select | `documentos` | no |
| `demo-facturacion/src/api_practico.ts:69` | select | `cuentas_comerciales` | no |
| `demo-facturacion/src/api_practico.ts:70` | select | `contratos_plan`, `plan_versiones`, `planes` | no |
| `demo-facturacion/src/api_practico.ts:74` | select | `monedero_saldos` | no |
| `demo-facturacion/src/api_practico.ts:75` | select | `pagos` | no |
| `demo-facturacion/src/api_practico.ts:76` | select | `cargos`, `consumos`, `bolson_cuentas`, `documentos` | no |
| `demo-facturacion/src/api_practico.ts:79` | select | `consumos`, `bolson_cuentas`, `cargos` | no |
| `demo-facturacion/src/api_practico.ts:83` | select | `cargos` | no |
| `demo-facturacion/src/api_practico.ts:84` | select | `cobros` | no |
| `demo-facturacion/src/api_practico.ts:85` | select | `consumos` | no |
| `demo-facturacion/src/api_practico.ts:91` | select | `empresa_canales` | **sí** (el SQL queda solo como camino del modo pooler) |
| `demo-facturacion/src/api_practico.ts:153` | select | `invitaciones` | **sí** (el SQL queda solo como camino del modo pooler) |
| `demo-facturacion/src/api_practico.ts:180` | select | `documentos` | no |
| `demo-facturacion/src/api_practico.ts:183` | select | `operaciones_fiscales` | no |
| `demo-facturacion/src/api_practico.ts:185` | select | `documentos`, `clientes` | no |
| `demo-facturacion/src/api_practico.ts:186` | select | `documentos`, `alertas_fiscales` | no |
| `demo-facturacion/src/api_practico.ts:195` | select | `documentos`, `clientes` | **sí** (el SQL queda solo como camino del modo pooler) |
| `demo-facturacion/src/api_practico.ts:200` | select | `cargos`, `consumos`, `bolson_cuentas`, `documentos` | **sí** (el SQL queda solo como camino del modo pooler) |
| `demo-facturacion/src/api_practico.ts:229` | select | `operaciones_fiscales` | no |
| `demo-facturacion/src/api_practico.ts:247` | select | `operaciones_fiscales` | no |
| `demo-facturacion/src/api_practico.ts:261` | select | `contratos_plan`, `plan_versiones`, `planes`, `monedero_saldos`, `consumos`, `cargos`, `empresas` | **sí** (el SQL queda solo como camino del modo pooler) |
| `demo-facturacion/src/api_practico.ts:323` | insert | `miembros` | no |
| `demo-facturacion/src/api_practico.ts:332` | with | `bolson_cuentas`, `bolson_lotes`, `cargos`, `empresas`, `consumos` | no |
| `demo-facturacion/src/api_practico.ts:340` | select | `bolson_alertas`, `empresas` | no |
| `demo-facturacion/src/api_practico.ts:357` | select | `bolson_conciliacion_partidas`, `empresas`, `bolson_partida_resoluciones` | no |
| `demo-facturacion/src/mundo_practico.ts:33` | insert | `miembros` | no |
| `demo-facturacion/src/demo_establecimientos.ts:16` | select | `establecimientos` | no |
| `demo-facturacion/src/mundo_demo.ts:24` | insert | `miembros` | no |
| `demo-facturacion/src/mundo_demo.ts:40` | select | `clientes` | no |
| `demo-facturacion/src/mundo_demo.ts:51` | select | `empresa_canales` | no |
| `demo-facturacion/src/mundo_demo.ts:52` | select | `establecimientos` | no |
| `demo-facturacion/src/lista_catalogos.ts:22` | select | `clientes` | no |
| `demo-facturacion/src/lista_catalogos.ts:23` | select | `clientes` | no |
| `demo-facturacion/src/lista_catalogos.ts:25` | select | `documentos`, `clientes` | no |
| `demo-facturacion/src/lista_catalogos.ts:32` | select | `conceptos` | no |
| `demo-facturacion/src/lista_catalogos.ts:34` | select | `conceptos` | no |
| `proveedores/src/almacen_gt_pg.ts:18` | insert | `digifact_operaciones` | no |
| `proveedores/src/almacen_gt_pg.ts:38` | insert | `digifact_artefactos` | no |
| `proveedores/src/almacen_gt_pg.ts:44` | select | `digifact_artefactos`, `digifact_operaciones` | no |
| `proveedores/src/almacen_gt_pg.ts:50` | select | `digifact_operaciones` | no |
| `proveedores/src/almacen_gt_pg.ts:51` | select | `digifact_operaciones` | no |
| `proveedores/src/almacen_gt_pg.ts:61` | update | `digifact_operaciones` | no |
