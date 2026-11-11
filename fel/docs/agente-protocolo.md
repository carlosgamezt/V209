# Protocolo NEXA ⇄ agente local (Fase 4)

Transporte: `POST` JSON sobre HTTPS **iniciado siempre por el agente** (sin puertos abiertos en el equipo). El servidor es la autoridad: **cada acción se valida en el servidor**, no en el agente.

## 1. Autenticación de cada petición (excepto `vincular`)
Cabeceras: `x-agente` (UUID), `x-ts` (ISO-8601 UTC), `x-nonce` (16–64 caracteres aleatorios, un solo uso), `x-firma` (Ed25519, base64url).
Mensaje firmado: `POST\n<ruta>\n<x-ts>\n<x-nonce>\n<sha256 hex del cuerpo>`.
El servidor: (1) lee la clave pública del agente activo, (2) **verifica la firma**, (3) llama a `fel_sys_agente_autenticar` (agente activo, marca de tiempo dentro de ±60 s, nonce no repetido) y obtiene la **empresa del agente**. Fallos: `FEL_FIRMA`, `FEL_RELOJ`, `FEL_REPETICION`, `FEL_REVOCADO`. El cuerpo **nunca** puede fijar la empresa: siempre sale del agente autenticado.

## 2. Operaciones
| Operación | Cuerpo | Respuesta |
|---|---|---|
| `vincular` (sin firma; código de un solo uso) | `{codigo, clave_publica, nombre, version}` | `{agente_id, empresa_id, empresa}` |
| `latido` | `{version, error?}` | `{estado}`; extiende arrendamientos del propio agente |
| `reclamar` | `{}` | `{orden, token, lease_hasta, hash, instantanea, clave_idempotencia, ambiente}` o vacío |
| `progreso` | `{orden, token, fase}` (`llenando`, `detenido_en_vista_previa`) | `{estado, lease_hasta}` |
| `resultado` | `{orden, token, tipo, serie?, numero?, autorizacion?, detalle?}` tipos: `emitido_simulado`, `descartado`, `error` | `{estado}` |

## 3. Validaciones del servidor por acción (condición 3)
| Acción | Identidad del agente | Empresa | Permiso | Estado de la operación/orden | Token |
|---|---|---|---|---|---|
| Crear código (UI) | usuario | del usuario | `agentes.administrar` | — | — |
| `vincular` | código de un uso, no vencido, hash, límite de fallos | la del código | — | clave pública única y válida | — |
| `latido` | firma+nonce+reloj; agente activo | del agente | — | — | — |
| `reclamar` | ídem | solo órdenes de **su** empresa | — | orden `pendiente` (o suya `reclamada` no llenada); **operación `iniciada` con esa orden**, ambiente `simulado`, canal `portal_playwright` habilitado | se **incrementa** |
| `progreso` | ídem | orden de su empresa y de su agente | — | `reclamada`/`llenada`; arrendamiento vigente | **debe coincidir** |
| `resultado` | ídem | ídem | — | orden `llenada` (o `reclamada` para `error`); operación aún `iniciada` | **debe coincidir** |
| Revocar (UI) | usuario | del usuario | `agentes.administrar` | órdenes del agente se resuelven con las reglas de vencimiento | invalida |
Errores: `FEL_NO_AUTORIZADO`, `FEL_EMPRESA`, `FEL_FENCING`, `FEL_ORDEN_DUPLICADA`, `FEL_ESTADO`, `FEL_DATOS_INVALIDOS`, `FEL_CODIGO`, `FEL_LIMITE`, `FEL_FIRMA`, `FEL_RELOJ`, `FEL_REPETICION`, `FEL_REVOCADO`.

## 4. Reglas del resultado
- `emitido_simulado`: solo desde `llenada`; **serie, número y autorización no vacíos y autorización con prefijo `SIM-`**; ambiente `simulado`.
- `descartado`: la persona descartó en el simulador (observado); cierra como rechazo confirmado.
- `error` en `reclamada` (antes de presentar) ⇒ `fallida` (se prueba que nada salió). `error` en `llenada` ⇒ **`incierta`**.
- Vencimiento del arrendamiento: `reclamada` ⇒ `pendiente` (token+1); **`llenada` ⇒ `incierta`**. Revocar el agente aplica las mismas reglas.
- Un token anterior, o un agente distinto, recibe `FEL_FENCING` y no cambia nada.

## 5. Cierre en NEXA
Una operación con orden se cierra por la ruta existente (`resolverAccionHumana`): `completada` ⇒ certificado simulado; `descartada`/`fallida` ⇒ rechazo confirmado; `incierta` ⇒ la operación pasa a **`por_verificar`** y solo se resuelve por consulta del canal o **conciliación manual de dos personas** (las reglas actuales, ahora habilitadas para órdenes `incierta`).
