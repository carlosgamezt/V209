# NEXA FEL · Matriz de estados de documentos (PROPUESTA — pendiente de aprobación)

Estados: `borrador`, `revisado`, `pendiente_certificacion`, `por_verificar`, `certificada`, `rechazada`, `archivada`.

**Reglas generales**
- Solo se edita un documento en `borrador`. Para cambiar un `revisado` hay que reabrirlo a `borrador` (con motivo).
- Toda transición se hace en una función de base de datos que, en la misma transacción: valida el permiso, verifica la versión
  (edición concurrente), cambia el estado, escribe `documento_estados` y `auditoria`.
- `serie`, `numero_fiscal` y `autorizacion_sat` solo pueden tener valor en `certificada` y con `certificacion_verificada_en`
  (restricción de la base de datos). Ninguna acción de la Fase 1 los escribe.
- Las transiciones marcadas **Reservada** existen en la tabla de reglas pero están **deshabilitadas** hasta que haya un
  certificador autorizado y la empresa tenga `emision_real_habilitada` con régimen verificado.

## Transiciones permitidas

| De | A | Permiso | Motivo | Estado de la regla | Condiciones |
|---|---|---|---|---|---|
| borrador | revisado | `borradores.revisar` | no | **Fase 1** | Cliente asignado, al menos 1 línea, totales calculados, régimen asignado |
| revisado | borrador | `borradores.editar` | **sí** | **Fase 1** | Reabrir para corregir |
| borrador | archivada | `borradores.archivar` | **sí** | **Fase 1** | |
| revisado | archivada | `borradores.archivar` | **sí** | **Fase 1** | |
| archivada | borrador | `borradores.archivar` | **sí** | **Fase 1** | Restaurar |
| revisado | pendiente_certificacion | `borradores.revisar` | no | Reservada | Empresa con emisión real habilitada y régimen verificado |
| pendiente_certificacion | certificada | solo el sistema | no | Reservada | **Solo** con confirmación verificable del certificador (serie, número y autorización) |
| pendiente_certificacion | rechazada | solo el sistema | **sí** | Reservada | Respuesta del certificador |
| pendiente_certificacion | por_verificar | solo el sistema | **sí** | Reservada | Respuesta ambigua, caída o tiempo agotado |
| por_verificar | certificada | solo el sistema | no | Reservada | Tras consulta que confirme verificablemente |
| por_verificar | rechazada | solo el sistema | **sí** | Reservada | Tras consulta que confirme el rechazo |
| por_verificar | pendiente_certificacion | `borradores.revisar` | **sí** | Reservada | Reintento autorizado |
| rechazada | borrador | `borradores.editar` | **sí** | Reservada | Corregir y volver a empezar |
| rechazada | archivada | `borradores.archivar` | **sí** | Reservada | |

## Transiciones prohibidas (la función las rechaza siempre)

- `borrador` → `pendiente_certificacion`, `por_verificar`, `certificada`, `rechazada` (debe pasar por `revisado`).
- `revisado` → `certificada`, `rechazada`, `por_verificar` (debe pasar por `pendiente_certificacion`).
- Cualquier estado → `certificada` salvo desde `pendiente_certificacion` o `por_verificar` con confirmación verificable.
- `certificada` → cualquier otro estado (es final; anulaciones o notas de crédito serán documentos nuevos en otra fase).
- `pendiente_certificacion` → `borrador`, `revisado`, `archivada` (hay una gestión en curso).
- `por_verificar` → `borrador`, `revisado`, `archivada` (no se puede perder el rastro de un documento que pudo certificarse).
- `archivada` → `revisado` o cualquier estado distinto de `borrador`.
- Transiciones al mismo estado.

## Quién puede hacer qué (roles por defecto)

| Acción | propietario | administrador | emisor | lector |
|---|---|---|---|---|
| Crear y editar borradores | sí | sí | sí | no |
| Marcar como revisado (`borradores.revisar`) | sí | sí | no (se puede conceder como permiso extra) | no |
| Archivar / restaurar (`borradores.archivar`) | sí | sí | no | no |
| Ver documentos e historial | sí | sí | sí | sí |

Separación de funciones: quien crea el borrador no necesita poder revisarlo; el permiso extra permite flexibilizarlo por usuario.
