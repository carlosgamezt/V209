# R3 · Inventario de acceso a datos del servidor (generado)

> Generado por `tools/inventario-lecturas.ts`. NO editar a mano. Base: catálogo con las migraciones 1-30 y las propuestas M-D…M-L aplicadas en un PostgreSQL en memoria.

**170 consultas SQL directas** (`filas`/`ejecutar`) y **112 llamadas `rpc`** a 81 funciones.

## 1. Consultas SQL directas por clase
| Clase | Consultas |
|---|---|
| datos de empresa | 66 |
| sin tabla (funciones, catálogos, utilidades) | 51 |
| plataforma y catálogos globales | 31 |
| sesiones y simuladores de la demostración (`demo_*`) | 22 |

## 2. Por tipo
| Tipo | Consultas |
|---|---|
| select | 136 |
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
| `plataforma_parametros` | 3 | no | sí |
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
| Archivo:línea | Tipo | Tablas |
|---|---|---|
| `demo-facturacion/src/api_digifact.ts:32` | select | `documentos`, `clientes`, `establecimientos` |
| `demo-facturacion/src/api_digifact.ts:35` | select | `documento_lineas`, `conceptos` |
| `demo-facturacion/src/api_digifact.ts:96` | select | `auditoria` |
| `demo-facturacion/src/api_digifact.ts:103` | select | `documentos`, `clientes` |
| `demo-facturacion/src/api.ts:76` | select | `empresa_canales` |
| `demo-facturacion/src/api.ts:138` | select | `documentos` |
| `demo-facturacion/src/api.ts:161` | select | `documentos` |
| `demo-facturacion/src/api.ts:174` | select | `documentos` |
| `demo-facturacion/src/api.ts:192` | select | `clientes` |
| `demo-facturacion/src/api.ts:200` | select | `clientes` |
| `demo-facturacion/src/api.ts:211` | select | `documentos` |
| `demo-facturacion/src/api.ts:229` | select | `documentos` |
| `demo-facturacion/src/api.ts:259` | select | `documentos`, `clientes` |
| `demo-facturacion/src/api.ts:270` | select | `conceptos` |
| `demo-facturacion/src/api.ts:280` | select | `documentos`, `establecimientos` |
| `demo-facturacion/src/api.ts:282` | select | `empresa_canales` |
| `demo-facturacion/src/api.ts:284` | select | `documentos` |
| `demo-facturacion/src/api.ts:368` | select | `artefactos_documento` |
| `demo-facturacion/src/api.ts:391` | select | `operaciones_fiscales` |
| `demo-facturacion/src/api.ts:420` | select | `conciliaciones` |
| `demo-facturacion/src/api.ts:425` | select | `alertas_fiscales` |
| `demo-facturacion/src/api.ts:465` | select | `documentos` |
| `demo-facturacion/src/api_practico.ts:48` | select | `operaciones_fiscales`, `consumos` |
| `demo-facturacion/src/api_practico.ts:49` | select | `operaciones_fiscales` |
| `demo-facturacion/src/api_practico.ts:53` | select | `operaciones_fiscales` |
| `demo-facturacion/src/api_practico.ts:54` | select | `documentos` |
| `demo-facturacion/src/api_practico.ts:60` | select | `cuentas_comerciales` |
| `demo-facturacion/src/api_practico.ts:61` | select | `contratos_plan`, `plan_versiones`, `planes` |
| `demo-facturacion/src/api_practico.ts:65` | select | `monedero_saldos` |
| `demo-facturacion/src/api_practico.ts:66` | select | `pagos` |
| `demo-facturacion/src/api_practico.ts:67` | select | `cargos`, `consumos`, `bolson_cuentas`, `documentos` |
| `demo-facturacion/src/api_practico.ts:70` | select | `consumos`, `bolson_cuentas`, `cargos` |
| `demo-facturacion/src/api_practico.ts:74` | select | `cargos` |
| `demo-facturacion/src/api_practico.ts:75` | select | `cobros` |
| `demo-facturacion/src/api_practico.ts:76` | select | `consumos` |
| `demo-facturacion/src/api_practico.ts:82` | select | `empresa_canales` |
| `demo-facturacion/src/api_practico.ts:141` | select | `invitaciones` |
| `demo-facturacion/src/api_practico.ts:166` | select | `documentos` |
| `demo-facturacion/src/api_practico.ts:169` | select | `operaciones_fiscales` |
| `demo-facturacion/src/api_practico.ts:171` | select | `documentos`, `clientes` |
| `demo-facturacion/src/api_practico.ts:172` | select | `documentos`, `alertas_fiscales` |
| `demo-facturacion/src/api_practico.ts:181` | select | `documentos`, `clientes` |
| `demo-facturacion/src/api_practico.ts:186` | select | `cargos`, `consumos`, `bolson_cuentas`, `documentos` |
| `demo-facturacion/src/api_practico.ts:215` | select | `operaciones_fiscales` |
| `demo-facturacion/src/api_practico.ts:233` | select | `operaciones_fiscales` |
| `demo-facturacion/src/api_practico.ts:247` | select | `contratos_plan`, `plan_versiones`, `planes`, `monedero_saldos`, `consumos`, `cargos`, `empresas` |
| `demo-facturacion/src/api_practico.ts:308` | insert | `miembros` |
| `demo-facturacion/src/api_practico.ts:316` | with | `bolson_cuentas`, `bolson_lotes`, `cargos`, `empresas`, `consumos` |
| `demo-facturacion/src/api_practico.ts:324` | select | `bolson_alertas`, `empresas` |
| `demo-facturacion/src/api_practico.ts:339` | select | `bolson_conciliacion_partidas`, `empresas`, `bolson_partida_resoluciones` |
| `demo-facturacion/src/mundo_practico.ts:33` | insert | `miembros` |
| `demo-facturacion/src/demo_establecimientos.ts:16` | select | `establecimientos` |
| `demo-facturacion/src/mundo_demo.ts:24` | insert | `miembros` |
| `demo-facturacion/src/mundo_demo.ts:40` | select | `clientes` |
| `demo-facturacion/src/mundo_demo.ts:51` | select | `empresa_canales` |
| `demo-facturacion/src/mundo_demo.ts:52` | select | `establecimientos` |
| `demo-facturacion/src/correo/servicio.ts:97` | select | `documentos`, `empresas`, `clientes` |
| `demo-facturacion/src/correo/servicio.ts:102` | select | `operaciones_fiscales` |
| `demo-facturacion/src/correo/servicio.ts:105` | select | `auditoria` |
| `demo-facturacion/src/correo/servicio.ts:126` | select | `artefactos_documento` |
| `proveedores/src/almacen_gt_pg.ts:16` | insert | `digifact_operaciones` |
| `proveedores/src/almacen_gt_pg.ts:36` | insert | `digifact_artefactos` |
| `proveedores/src/almacen_gt_pg.ts:42` | select | `digifact_artefactos`, `digifact_operaciones` |
| `proveedores/src/almacen_gt_pg.ts:48` | select | `digifact_operaciones` |
| `proveedores/src/almacen_gt_pg.ts:49` | select | `digifact_operaciones` |
| `proveedores/src/almacen_gt_pg.ts:59` | update | `digifact_operaciones` |
