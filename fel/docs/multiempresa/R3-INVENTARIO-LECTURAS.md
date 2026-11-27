# R3 · Inventario de acceso a datos del servidor (generado)

> Generado por `tools/inventario-lecturas.ts`. NO editar a mano. Base: catálogo con las migraciones 1-30 y las propuestas M-D…M-L aplicadas en un PostgreSQL en memoria.

**174 consultas SQL directas** (`filas`/`ejecutar`) y **112 llamadas `rpc`** a 81 funciones.

## 1. Consultas SQL directas por clase
| Clase | Consultas |
|---|---|
| datos de empresa | 71 |
| sin tabla (funciones, catálogos, utilidades) | 51 |
| plataforma y catálogos globales | 30 |
| sesiones y simuladores de la demostración (`demo_*`) | 22 |

## 2. Por tipo
| Tipo | Consultas |
|---|---|
| select | 140 |
| insert | 19 |
| update | 7 |
| delete | 4 |
| ${sel_cuenta} | 3 |
| with | 1 |

## 3. Tablas tocadas (de mayor a menor)
| Tabla | Consultas | Tiene `empresa_id` | RLS |
|---|---|---|---|
| `documentos` | 20 | sí | sí |
| `clientes` | 12 | sí | sí |
| `empresas` | 12 | no | sí |
| `operaciones_fiscales` | 8 | sí | sí |
| `consumos` | 7 | sí | sí |
| `bolson_cuentas` | 7 | no | sí |
| `demo_sesiones` | 7 | no | sí |
| `cargos` | 6 | sí | sí |
| `demo_simulador_estado` | 5 | no | sí |
| `digifact_operaciones` | 5 | sí | sí |
| `establecimientos` | 4 | sí | sí |
| `conceptos` | 4 | sí | sí |
| `empresa_canales` | 4 | sí | sí |
| `regimenes_fiscales` | 4 | no | sí |
| `perfiles` | 4 | no | sí |
| `plan_versiones` | 3 | no | sí |
| `planes` | 3 | no | sí |
| `miembros` | 3 | sí | sí |
| `bolson_lotes` | 3 | no | sí |
| `demo_entorno` | 3 | no | sí |
| `demo_intentos` | 3 | no | sí |
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
| `demo-facturacion/src/api.ts:78` | select | `empresa_canales` | no |
| `demo-facturacion/src/api.ts:141` | select | `documentos` | no |
| `demo-facturacion/src/api.ts:164` | select | `documentos` | no |
| `demo-facturacion/src/api.ts:177` | select | `documentos` | no |
| `demo-facturacion/src/api.ts:195` | select | `clientes` | no |
| `demo-facturacion/src/api.ts:203` | select | `clientes` | no |
| `demo-facturacion/src/api.ts:214` | select | `documentos` | no |
| `demo-facturacion/src/api.ts:232` | select | `documentos` | no |
| `demo-facturacion/src/api.ts:269` | select | `documentos`, `clientes` | **sí** (el SQL queda solo como camino del modo pooler) |
| `demo-facturacion/src/api.ts:280` | select | `conceptos` | **sí** (el SQL queda solo como camino del modo pooler) |
| `demo-facturacion/src/api.ts:290` | select | `documentos`, `establecimientos` | **sí** (el SQL queda solo como camino del modo pooler) |
| `demo-facturacion/src/api.ts:292` | select | `empresa_canales` | no |
| `demo-facturacion/src/api.ts:294` | select | `documentos` | no |
| `demo-facturacion/src/api.ts:387` | select | `artefactos_documento` | no |
| `demo-facturacion/src/api.ts:410` | select | `operaciones_fiscales` | no |
| `demo-facturacion/src/api.ts:439` | select | `conciliaciones` | no |
| `demo-facturacion/src/api.ts:444` | select | `alertas_fiscales` | no |
| `demo-facturacion/src/api.ts:485` | select | `documentos` | no |
| `demo-facturacion/src/api_practico.ts:51` | select | `operaciones_fiscales`, `consumos` | **sí** (el SQL queda solo como camino del modo pooler) |
| `demo-facturacion/src/api_practico.ts:52` | select | `operaciones_fiscales` | no |
| `demo-facturacion/src/api_practico.ts:56` | select | `operaciones_fiscales` | no |
| `demo-facturacion/src/api_practico.ts:57` | select | `documentos` | no |
| `demo-facturacion/src/api_practico.ts:68` | select | `cuentas_comerciales` | no |
| `demo-facturacion/src/api_practico.ts:69` | select | `contratos_plan`, `plan_versiones`, `planes` | no |
| `demo-facturacion/src/api_practico.ts:73` | select | `monedero_saldos` | no |
| `demo-facturacion/src/api_practico.ts:74` | select | `pagos` | no |
| `demo-facturacion/src/api_practico.ts:75` | select | `cargos`, `consumos`, `bolson_cuentas`, `documentos` | no |
| `demo-facturacion/src/api_practico.ts:78` | select | `consumos`, `bolson_cuentas`, `cargos` | no |
| `demo-facturacion/src/api_practico.ts:82` | select | `cargos` | no |
| `demo-facturacion/src/api_practico.ts:83` | select | `cobros` | no |
| `demo-facturacion/src/api_practico.ts:84` | select | `consumos` | no |
| `demo-facturacion/src/api_practico.ts:90` | select | `empresa_canales` | no |
| `demo-facturacion/src/api_practico.ts:150` | select | `invitaciones` | **sí** (el SQL queda solo como camino del modo pooler) |
| `demo-facturacion/src/api_practico.ts:177` | select | `documentos` | no |
| `demo-facturacion/src/api_practico.ts:180` | select | `operaciones_fiscales` | no |
| `demo-facturacion/src/api_practico.ts:182` | select | `documentos`, `clientes` | no |
| `demo-facturacion/src/api_practico.ts:183` | select | `documentos`, `alertas_fiscales` | no |
| `demo-facturacion/src/api_practico.ts:192` | select | `documentos`, `clientes` | **sí** (el SQL queda solo como camino del modo pooler) |
| `demo-facturacion/src/api_practico.ts:197` | select | `cargos`, `consumos`, `bolson_cuentas`, `documentos` | **sí** (el SQL queda solo como camino del modo pooler) |
| `demo-facturacion/src/api_practico.ts:226` | select | `operaciones_fiscales` | no |
| `demo-facturacion/src/api_practico.ts:244` | select | `operaciones_fiscales` | no |
| `demo-facturacion/src/api_practico.ts:258` | select | `contratos_plan`, `plan_versiones`, `planes`, `monedero_saldos`, `consumos`, `cargos`, `empresas` | **sí** (el SQL queda solo como camino del modo pooler) |
| `demo-facturacion/src/api_practico.ts:320` | insert | `miembros` | no |
| `demo-facturacion/src/api_practico.ts:329` | with | `bolson_cuentas`, `bolson_lotes`, `cargos`, `empresas`, `consumos` | no |
| `demo-facturacion/src/api_practico.ts:337` | select | `bolson_alertas`, `empresas` | no |
| `demo-facturacion/src/api_practico.ts:354` | select | `bolson_conciliacion_partidas`, `empresas`, `bolson_partida_resoluciones` | no |
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
| `demo-facturacion/src/lista_catalogos.ts:22` | select | `clientes` | no |
| `demo-facturacion/src/lista_catalogos.ts:23` | select | `clientes` | no |
| `demo-facturacion/src/lista_catalogos.ts:25` | select | `documentos`, `clientes` | no |
| `demo-facturacion/src/lista_catalogos.ts:32` | select | `conceptos` | no |
| `demo-facturacion/src/lista_catalogos.ts:34` | select | `conceptos` | no |
| `proveedores/src/almacen_gt_pg.ts:16` | insert | `digifact_operaciones` | no |
| `proveedores/src/almacen_gt_pg.ts:36` | insert | `digifact_artefactos` | no |
| `proveedores/src/almacen_gt_pg.ts:42` | select | `digifact_artefactos`, `digifact_operaciones` | no |
| `proveedores/src/almacen_gt_pg.ts:48` | select | `digifact_operaciones` | no |
| `proveedores/src/almacen_gt_pg.ts:49` | select | `digifact_operaciones` | no |
| `proveedores/src/almacen_gt_pg.ts:59` | update | `digifact_operaciones` | no |
