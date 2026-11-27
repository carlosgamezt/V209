# Verificación previa al cierre de R1/R2/R3: delegación de pasos del sistema a `nexa-sys` y riesgos residuales del agente

Candidato aprobado: `53857a9`. Alcance congelado: este documento es **procedimiento de verificación**, no desarrollo. Se ejecuta en `nexa-fel-test` dentro de W5/W6/1E. Sin certificación real, sin Resend, sin correos, sin tocar `nexa-demo`.

## 1. Precisión sobre qué se delega
| Grupo | Cantidad | Origen | Hoy (local, transición) | Destino tras W5/W6 |
|---|---|---|---|---|
| Envoltorios `fel_ses_sys_*` de la **máquina fiscal** (reservar/confirmar/liberar cobertura, cerrar anulación, guardar artefacto, credencial, emisor…) | 32 (lista `SYS_CON_SESION`) + `bolson_cuenta_simulada` | M-K | `nexa_app` + token de sesión | `nexa-sys` ejecuta `fel_sys_*(p_empresa, …)` con la empresa **ya verificada** por JWT + `api.empresa_contexto()` |
| Envoltorios de **lectura** `fel_ses_sys_*` (doc_fel, doc_cliente, doc_correo, op_certificada, auditoria_ultima/contar, artefactos_op) | **7** | M-V | ídem | ídem (`fel_sys_*` ya sin token, ya probadas solo para `nexa_sys`) |
Los «siete» de M-V son los de lectura; los pasos **fiscales** son los 32 de M-K. La verificación cubre **ambos grupos (40)**; con los 7 solos no se puede cerrar R1.

## 2. Verificación de la delegación (criterios de aprobación)
1. **Inventario:** en `nexa-fel-test`, listar `fel_ses_sys_*` y `fel_sys_*` ejecutables por `nexa_app` y por `nexa_sys` (como `ensayo-1e.sh`, 8a/8h). Esperado antes de M-P: ambos grupos; tras M-P: `nexa_app` sin `fel_sys_*`.
2. **Delegación:** `nexa-api` (sin credencial de base) ejecuta un recorrido simulado completo (borrador → revisar → certificar simulado → PDF → correo **desactivado/simulado**) y cada paso del sistema llega a la base **solo** por `nexa-sys` con `p_empresa` verificada. Registrar, por paso, quién lo ejecutó (rol de base y función).
3. **Negativos obligatorios:** (a) `nexa-sys` rechaza la llamada si el JWT es de otra persona/empresa o la sesión está revocada (403); (b) con `nexa_app` ya cortado (M-P) el recorrido sigue funcionando; (c) un `p_empresa` distinto al del contexto verificado se rechaza antes de la base; (d) `authenticated`/`anon` no ejecutan ningún `fel_sys_*`.
4. **Retiro:** tras W6 ningún flujo usa `fel_ses_sys_*`; se pueden retirar y `nexa_app` queda sin privilegios sobre sesiones (R1).
5. **Regresión:** reejecutar pruebas locales sobre el esquema del proyecto (`prueba-cierre-r3.sql`, `prueba-nexa-sys.sql`, `prueba-agente-protocolo.sql`) y la sonda R1/R2 (`esperado=cerrado`).
Si el paso 2 exige código nuevo (la delegación hoy está documentada pero **no implementada en la aplicación**: `nexa-api` aún llama `fel_ses_sys_*` vía `nexa_app`), es un **hallazgo hospedado** que justifica una corrección acotada; se registra y se pide aprobación antes de implementar.

## 3. Riesgos residuales del agente (revisión)
| Riesgo | Estado | Mitigación existente | Verificación hospedada |
|---|---|---|---|
| Clave Ed25519 de un agente comprometida | aceptado, acotado | alcance de empresa, fencing, revocación inmediata, 120 pet./min, resultados solo `SIM-` | revocar y comprobar rechazo inmediato; límite desde dos orígenes |
| `nexa-sys` comprometido = todos los agentes | **frontera residual aceptada** | credencial solo `fel_sys_*` + 4 tablas de servicio; interfaz limitada a `/tick` y protocolo firmado | revisar que sus secretos estén solo en esa función |
| La base no verifica la firma del agente | por diseño | `nexa-sys` verifica Ed25519 antes de invocar `fel_sys_agente_*` | prueba de que una petición sin firma válida no llega a la base |
| Origen de vinculación suplantable por cabecera falsa | pendiente de plataforma | límite por origen + freno global de 1 000 | W0: qué cabecera garantiza la plataforma (`cf-connecting-ip`/último `x-forwarded-for`) |
| Ruta de función distinta a la anclada | pendiente de plataforma | ruteo anclado | W0: ruta real que ve la función |
| Sin rotación automática de claves de agente | decisión | revocar y vincular de nuevo (`ROTACION-DE-CREDENCIALES.md`) | ensayar revocación/vinculación |
| Firma de respuestas al agente | opcional | — | decidir en W5 |
| Agentes con resultados reales | **fuera de alcance**: solo `SIM-` | la base rechaza resultados no simulados | confirmar que sigue rechazando |

## 4. Compuertas (no se declaran cerrados antes)
- **R1:** sonda «rechazada» + `demo_sesiones`/`demo_credenciales` retirados + paso 4 de §2.
- **R2:** sonda con `esperado=cerrado` tras W6.
- **R3:** pasos 2–3 de §2 + espía extendido con JWT real + `nexa_app` sin `SELECT` + comparación #55.
Cada resultado se asienta en un informe del ensayo con evidencia (sin secretos).

## 5. Procedimiento de configuración del entorno de pruebas (disponible)
`SECUENCIA-Y-LISTAS-NEXA-FEL-TEST.md` (A: prerrequisitos del titular; B: secuencia; C–F: W0, W5, W6, 1E), `ENSAYO-1E-CONFIGURACION.md`, `PLAN-1E-ACTIVACION.md`, `tools/ensayo-1e.sh` y `.github/workflows/ensayo-1e.yml` (entorno protegido `ensayo-1e`, ejecución manual).
**Bloqueante para iniciar:** el titular debe crear `nexa-fel-test` (Free, sin Resend/integraciones) y los secretos del entorno `ensayo-1e` (§A). Sin eso no se ejecuta nada hospedado.
