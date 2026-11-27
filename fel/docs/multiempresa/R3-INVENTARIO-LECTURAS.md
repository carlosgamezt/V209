# R3 · Inventario de acceso a datos del servidor (generado)

> Generado por `tools/inventario-lecturas.ts`. NO editar a mano. Base: catálogo con las migraciones 1-30 y las propuestas M-D…M-L aplicadas en un PostgreSQL en memoria.

**169 consultas SQL directas** (`filas`/`ejecutar`) y **112 llamadas `rpc`** a 81 funciones.

## 1. Consultas SQL directas por clase
| Clase | Consultas |
|---|---|
| datos de empresa | 66 |
| sin tabla (funciones, catálogos, utilidades) | 51 |
| plataforma y catálogos globales | 30 |
| sesiones y simuladores de la demostración (`demo_*`) | 22 |

## 2. Por tipo
| Tipo | Consultas |
|---|---|
| select | 135 |
| insert | 19 |
| update | 7 |
| delete | 4 |
| ${sel_cuenta} | 3 |
| with | 1 |

## 3. Tablas tocadas (de mayor a menor)
| Tabla | Consultas | Tiene `empresa_id` | RLS |
|---|---|---|---|
| `documentos` | 19 | sí | sí |
| `empresas` | 12 | no | sí |
| `clientes` | 9 | sí | sí |
| `operaciones_fiscales` | 8 | sí | sí |
| `consumos` | 7 | sí | sí |
| `bolson_cuentas` | 7 | no | sí |
| `demo_sesiones` | 7 | no | sí |
| `cargos` | 6 | sí | sí |
| `demo_simulador_estado` | 5 | no | sí |
| `digifact_operaciones` | 5 | sí | sí |
| `establecimientos` | 4 | sí | sí |
| `empresa_canales` | 4 | sí | sí |
| `regimenes_fiscales` | 4 | no | sí |
| `perfiles` | 4 | no | sí |
| `plan_versiones` | 3 | no | sí |
| `planes` | 3 | no | sí |
| `miembros` | 3 | sí | sí |
| `bolson_lotes` | 3 | no | sí |
| `demo_entorno` | 3 | no | sí |
| `demo_intentos` | 3 | no | sí |
| `conceptos` | 2 | sí | sí |
| `auditoria` | 2 | sí | sí |
| `artefactos_documento` | 2 | sí | sí |
| `alertas_fiscales` | 2 | sí | sí |
| `contratos_plan` | 2 | sí | sí |
| `tarifas` | 2 | no | sí |
| `monedero_saldos` | 2 | sí | sí |
| `bolson_conciliaciones` | 2 | no | sí |
| `demo_limites` | 2 | no | sí |
| `plataforma_parametros` | 2 | no | sí |
| `demo_credenciales` | 2 | sí | sí |
| `digifact_artefactos` | 2 | sí | sí |
| `documento_lineas` | 1 | sí | sí |
| `proveedores_emision` | 1 | no | sí |
| `conciliaciones` | 1 | sí | sí |
| `cuentas_comerciales` | 1 | sí | sí |
| `pagos` | 1 | sí | sí |
| `cobros` | 1 | sí | sí |
| `invitaciones` | 1 | sí | sí |
| `rol_permisos` | 1 | no | sí |
| `permisos_catalogo` | 1 | no | sí |
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
| empresa (fel_ses_*) | 33 |
| sistema en petición (fel_ses_sys_*) | 31 |
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
| `demo-facturacion/src/api_digifact.ts:32` | select | `documentos`, `clientes`, `establecimientos` | no |
| `demo-facturacion/src/api_digifact.ts:35` | select | `documento_lineas`, `conceptos` | no |
| `demo-facturacion/src/api_digifact.ts:96` | select | `auditoria` | no |
| `demo-facturacion/src/api_digifact.ts:103` | select | `documentos`, `clientes` | no |
| `demo-facturacion/src/api.ts:77` | select | `empresa_canales` | no |
| `demo-facturacion/src/api.ts:140` | select | `documentos` | no |
| `demo-facturacion/src/api.ts:163` | select | `documentos` | no |
| `demo-facturacion/src/api.ts:176` | select | `documentos` | no |
| `demo-facturacion/src/api.ts:194` | select | `clientes` | no |
| `demo-facturacion/src/api.ts:202` | select | `clientes` | no |
| `demo-facturacion/src/api.ts:213` | select | `documentos` | no |
| `demo-facturacion/src/api.ts:231` | select | `documentos` | no |
| `demo-facturacion/src/api.ts:261` | select | `documentos`, `clientes` | **sí** (el SQL queda solo como camino del modo pooler) |
| `demo-facturacion/src/api.ts:272` | select | `conceptos` | **sí** (el SQL queda solo como camino del modo pooler) |
| `demo-facturacion/src/api.ts:282` | select | `documentos`, `establecimientos` | **sí** (el SQL queda solo como camino del modo pooler) |
| `demo-facturacion/src/api.ts:284` | select | `empresa_canales` | no |
| `demo-facturacion/src/api.ts:286` | select | `documentos` | no |
| `demo-facturacion/src/api.ts:379` | select | `artefactos_documento` | no |
| `demo-facturacion/src/api.ts:402` | select | `operaciones_fiscales` | no |
| `demo-facturacion/src/api.ts:431` | select | `conciliaciones` | no |
| `demo-facturacion/src/api.ts:436` | select | `alertas_fiscales` | no |
| `demo-facturacion/src/api.ts:477` | select | `documentos` | no |
| `demo-facturacion/src/api_practico.ts:48` | select | `operaciones_fiscales`, `consumos` | no |
| `demo-facturacion/src/api_practico.ts:49` | select | `operaciones_fiscales` | no |
| `demo-facturacion/src/api_practico.ts:53` | select | `operaciones_fiscales` | no |
| `demo-facturacion/src/api_practico.ts:54` | select | `documentos` | no |
| `demo-facturacion/src/api_practico.ts:60` | select | `cuentas_comerciales` | no |
| `demo-facturacion/src/api_practico.ts:61` | select | `contratos_plan`, `plan_versiones`, `planes` | no |
| `demo-facturacion/src/api_practico.ts:65` | select | `monedero_saldos` | no |
| `demo-facturacion/src/api_practico.ts:66` | select | `pagos` | no |
| `demo-facturacion/src/api_practico.ts:67` | select | `cargos`, `consumos`, `bolson_cuentas`, `documentos` | no |
| `demo-facturacion/src/api_practico.ts:70` | select | `consumos`, `bolson_cuentas`, `cargos` | no |
| `demo-facturacion/src/api_practico.ts:74` | select | `cargos` | no |
| `demo-facturacion/src/api_practico.ts:75` | select | `cobros` | no |
| `demo-facturacion/src/api_practico.ts:76` | select | `consumos` | no |
| `demo-facturacion/src/api_practico.ts:82` | select | `empresa_canales` | no |
| `demo-facturacion/src/api_practico.ts:141` | select | `invitaciones` | no |
| `demo-facturacion/src/api_practico.ts:168` | select | `documentos` | no |
| `demo-facturacion/src/api_practico.ts:171` | select | `operaciones_fiscales` | no |
| `demo-facturacion/src/api_practico.ts:173` | select | `documentos`, `clientes` | no |
| `demo-facturacion/src/api_practico.ts:174` | select | `documentos`, `alertas_fiscales` | no |
| `demo-facturacion/src/api_practico.ts:183` | select | `documentos`, `clientes` | **sí** (el SQL queda solo como camino del modo pooler) |
| `demo-facturacion/src/api_practico.ts:188` | select | `cargos`, `consumos`, `bolson_cuentas`, `documentos` | no |
| `demo-facturacion/src/api_practico.ts:217` | select | `operaciones_fiscales` | no |
| `demo-facturacion/src/api_practico.ts:235` | select | `operaciones_fiscales` | no |
| `demo-facturacion/src/api_practico.ts:249` | select | `contratos_plan`, `plan_versiones`, `planes`, `monedero_saldos`, `consumos`, `cargos`, `empresas` | no |
| `demo-facturacion/src/api_practico.ts:310` | insert | `miembros` | no |
| `demo-facturacion/src/api_practico.ts:318` | with | `bolson_cuentas`, `bolson_lotes`, `cargos`, `empresas`, `consumos` | no |
| `demo-facturacion/src/api_practico.ts:326` | select | `bolson_alertas`, `empresas` | no |
| `demo-facturacion/src/api_practico.ts:341` | select | `bolson_conciliacion_partidas`, `empresas`, `bolson_partida_resoluciones` | no |
| `demo-facturacion/src/mundo_practico.ts:33` | insert | `miembros` | no |
| `demo-facturacion/src/demo_establecimientos.ts:16` | select | `establecimientos` | no |
| `demo-facturacion/src/mundo_demo.ts:24` | insert | `miembros` | no |
| `demo-facturacion/src/mundo_demo.ts:40` | select | `clientes` | no |
| `demo-facturacion/src/mundo_demo.ts:51` | select | `empresa_canales` | no |
| `demo-facturacion/src/mundo_demo.ts:52` | select | `establecimientos` | no |
| `demo-facturacion/src/correo/servicio.ts:97` | select | `documentos`, `empresas`, `clientes` | no |
| `demo-facturacion/src/correo/servicio.ts:102` | select | `operaciones_fiscales` | no |
| `demo-facturacion/src/correo/servicio.ts:105` | select | `auditoria` | no |
| `demo-facturacion/src/correo/servicio.ts:126` | select | `artefactos_documento` | no |
| `proveedores/src/almacen_gt_pg.ts:16` | insert | `digifact_operaciones` | no |
| `proveedores/src/almacen_gt_pg.ts:36` | insert | `digifact_artefactos` | no |
| `proveedores/src/almacen_gt_pg.ts:42` | select | `digifact_artefactos`, `digifact_operaciones` | no |
| `proveedores/src/almacen_gt_pg.ts:48` | select | `digifact_operaciones` | no |
| `proveedores/src/almacen_gt_pg.ts:49` | select | `digifact_operaciones` | no |
| `proveedores/src/almacen_gt_pg.ts:59` | update | `digifact_operaciones` | no |
