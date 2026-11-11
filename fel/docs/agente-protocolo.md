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

## 6. Implementación del plano de control (commit 4)
- Rutas: `POST /api/agente/v1/{vincular,latido,reclamar,progreso,resultado}` (módulo `fel/proveedores/src/plano_control_agente.ts`, montado en la demo; el lado de la persona está en `/api/agentes/{codigo,revocar,salud}` y `GET /api/agentes`).
- Orden de validación: método → tipo (JSON) → tamaño (64 KiB) → formato de cabeceras → **firma Ed25519** → agente activo (si está revocado y la firma es válida: 403 `FEL_REVOCADO`) → marca de tiempo ±60 s (`FEL_RELOJ`) y **nonce de un solo uso** (`FEL_REPETICION`) → acción (la base valida empresa, estado y token). Una petición con firma inválida **no consume** el nonce.
- Respuestas: `{ok:false, codigo, mensaje}` con mensajes genéricos y `cache-control: no-store`; agente desconocido y firma inválida reciben exactamente la misma respuesta 401; los fallos internos responden 500 `FEL_INTERNO` sin detalles.
- **Supervisor periódico** (`supervisor_ordenes.ts`): cada `FEL_AGENTE_SUPERVISOR_MS` ms (50–3 600 000; 15 000 por defecto) aplica `fel_sys_ordenes_vencer` y `cerrarOrdenes`, sin solapar ciclos; `GET /api/agentes/salud` informa ciclos, errores y atraso (tres intervalos sin ciclo); al recibir SIGINT/SIGTERM se detiene primero el supervisor (espera al ciclo en curso) y luego el servidor. En producción real la misma función se programaría con `pg_cron` o una función programada (pendiente).

## 7. Agente funcional y autorización humana (commit 6)
- Agente: `fel/agente-local/agente/` (Node.js 22 + Playwright 1.49.1, Chromium 131 exigido; perfil propio en la carpeta del agente). Solo habla con NEXA y con el simulador, **ambos en loopback**; el navegador solo abre el origen del simulador (SAT, certificadores y cualquier otro host se bloquean). Identidad Ed25519 en el almacén local (DPAPI pendiente para Windows); diario de la orden en curso para recuperarse tras una caída.
- Nueva operación firmada `POST /api/agente/v1/vista_previa` `{orden, token, resumen, hash}`: el agente informa lo que el simulador **realmente** muestra (hash calculado por el simulador). `vincular` devuelve también `empresa_id`.
- **La confirmación no la decide el agente**: ver `agente-confirmacion-humana.md` (concesión firmada por NEXA tras la autorización de una persona con `fiscal.certificar`; el simulador la exige en el servidor).
- Reglas del agente: tras presentar **nunca repite**; el resultado se resuelve **siempre con el libro del simulador** (emisión única ⇒ `emitido_simulado`; sin emisión y sesión cerrada ⇒ `descartado`; cualquier otra cosa ⇒ `error` ⇒ orden incierta ⇒ `por_verificar`); si el libro ya tiene una emisión de la orden no crea otra sesión (incierta). Revocado, token viejo o arrendamiento vencido ⇒ el agente cierra su sesión y se detiene sin cambiar nada más.
- Cierre en NEXA: reserva exclusiva por orden (migración 5); migración 6: vista previa, concesiones registradas (solo inserción) y funciones de autorización.
