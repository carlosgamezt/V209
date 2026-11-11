# Agente local de NEXA FEL — arquitectura (Fase 4)

Rama `fel-proveedores-diseno`, base validada `8bea2fa`. **Todo contra un simulador local: sin SAT, sin certificadores, sin contraseñas, sin emisión real.** Plan aprobado: decisiones D-F1…D-F7 y las cuatro condiciones de la autorización de la Fase 4 (ver §8).

## 1. Qué es y qué no es
Un programa que corre en el equipo de la empresa (Windows), recibe de NEXA **órdenes de llenado asistido**, abre un navegador controlado con Playwright (Chromium 131, perfil propio), **llena y valida** un formulario, **se detiene en la vista previa** y deja que **una persona confirme**; después **observa** el resultado y lo informa a NEXA. No es un proveedor: NEXA lo usa a través del adaptador `portal_playwright` (contrato `EmissionProvider`, canal asistido). El agente **no conoce** al proveedor fiscal: solo órdenes y resultados.

No es: un emisor automático, un guardián de credenciales ni un cliente del SAT. **Nunca pulsa «Confirmar»**.

## 2. Componentes
```
NEXA FEL (plataforma)
  Orquestador (sin cambios) ──► adaptador portal_playwright ──► ordenes_emision (cola)
  BD: agentes_locales · codigos_vinculacion · agente_nonces · ordenes_emision
  Plano de control HTTP /api/agente/*  (verifica firma + SQL valida identidad, empresa, permisos, estado y token)
        ▲  HTTPS saliente, peticiones firmadas Ed25519
Agente local (Windows, Node 22)
  núcleo: cola · latido · libro local anti-duplicados · registro sin valores sensibles · claves (DPAPI)
  conductor `simulador_fel` (Playwright 1.49.1 + Chromium 131)
        ▼
Simulador local FEL (127.0.0.1): formulario · validación · VISTA PREVIA · «Confirmar» solo humano · NO deduplica
```
Reutilizado sin modificar: `fel/proveedores` (contrato, orquestador, `resolverAccionHumana`), la migración de la Fase 2 (operaciones, canales, instantánea con hash de la base) y la lógica pura de `fel/poc-sat` (guardia, registro, libro).

## 3. Flujo individual
1. Documento revisado → «Enviar» por el canal asistido → el orquestador crea la operación, marca el envío y llama al adaptador → **se crea una orden** (`ordenes_emision`, una por operación) con la instantánea congelada y su hash; la operación queda abierta con `orden_externa`.
2. El agente **reclama** la orden (arrendamiento + token de *fencing*), verifica el hash, escribe en su libro `llenado_solicitado` y llena el formulario del simulador.
3. El agente informa `detenido_en_vista_previa`; la orden pasa a **`llenada`** (a partir de aquí la factura ya fue presentada a una persona).
4. La **persona confirma dentro del simulador**. El agente observa serie/número/autorización `SIM-…` y envía `emitido_simulado` con su token.
5. NEXA cierra la operación por la ruta existente (`resolverAccionHumana`) → «certificado (simulado)». Trazabilidad: registro del agente + eventos y auditoría de NEXA.

## 4. Estados de la orden y reglas (condición 1: lo incierto bloquea)
| Estado | Significado | Siguiente |
|---|---|---|
| `pendiente` | Esperando agente | `reclamada` |
| `reclamada` | Un agente la tiene (token vigente); **nada se ha presentado a la persona** | `llenada`, `fallida`, `pendiente` (vence) |
| `llenada` | **Vista previa presentada**: la persona puede estar confirmando | `completada`, `descartada`, `incierta` |
| `completada` | Emitido en el simulador (con `SIM-`) | cierra la operación como certificada |
| `descartada` | La persona descartó en el simulador (el agente lo observó) | cierra como rechazo confirmado |
| `fallida` | Error **antes** de presentar (datos inválidos, formulario no disponible): se prueba que nada salió | cierra como rechazo confirmado |
| `incierta` | Tras presentar: arrendamiento vencido, error, agente revocado o caído | **`por_verificar`**; sin reintento automático; consulta al simulador o conciliación manual de dos personas |
| `cancelada` | La operación dejó de ser válida | — |

Regla: **después de presentar la vista previa, cualquier resultado que no sea una observación clara (`emitido_simulado` o `descartada`) es `incierta`**. Nunca se reasigna una orden `llenada` ni se crea otra para la misma operación.

## 5. Prevención de duplicados (capas)
1. Orquestador/BD (operación abierta única, clave de idempotencia, `por_verificar`). 2. `unique(operacion_id)` en órdenes. 3. Token de *fencing* en cada acción del agente. 4. Libro local del agente (escritura previa; no vuelve a llenar). 5. Hash del contenido calculado por la base, verificado por el agente. 6. El simulador **no deduplica** a propósito.

## 6. Instalación y uso sin conocimientos técnicos (condición 2)
La CLI (`vincular | iniciar | estado | desvincular | doctor`) es **solo herramienta de desarrollo**. El diseño del agente exige desde ahora:
- núcleo como **biblioteca** sin dependencia de la consola, con una capa de presentación intercambiable (CLI hoy; **ventana/bandeja de Windows** después);
- **vinculación guiada** con un código de un solo uso (sin editar archivos ni variables de entorno);
- configuración y claves en `%LOCALAPPDATA%\NEXA-FEL-Agente` (claves con DPAPI), **sin rutas ni parámetros manuales**;
- **mensajes en español** con acciones sugeridas; estado visible (conectado/desconectado/error) y comprobación automática de requisitos;
- **instalador** de un clic (futuro: MSI/EXE firmado con Node y Chromium incluidos, inicio con Windows, actualización); en esta fase: paquete ZIP + guía y script de arranque.

## 7. Estructura de archivos
```
fel/agente-local/{src/{nucleo,seguridad,nexa,drivers,cli.mjs}, simulador/, pruebas/, windows/}
fel/proveedores/src/portal_playwright.ts (+ cierre de órdenes)
fel/supabase/migrations/20261111000300_fel_agente_local.sql · tests/17_agente_local.sql
fel/docs/agente-{arquitectura,protocolo,seguridad}.md
```

## 8. Condiciones de la autorización y dónde se cumplen
| Condición | Cumplimiento |
|---|---|
| 1. Resultado incierto tras presentar ⇒ sin reintento automático; verificación/conciliación | §4 (`incierta` ⇒ `por_verificar`); la conciliación manual de dos personas se habilita **solo** para órdenes `incierta` |
| 2. Instalable sin conocimientos técnicos | §6 |
| 3. Servidor valida identidad, empresa, permisos, estado y token en cada acción | `agente-protocolo.md` §3 (tabla de validaciones por acción) |
| 4. Separación estricta simulador / integración real; SAT y Digifact bloqueados con pruebas | `agente-seguridad.md` §2 |
