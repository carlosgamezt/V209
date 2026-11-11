# Autorización humana de la confirmación — separación técnica (Fase 4, commit 6)

Estado: **diseño documentado antes de implementar** (requisito del commit 6). Todo es simulado: sin SAT, sin certificadores, sin credenciales.

## 1. Problema
El agente controla Chromium con Playwright. Un clic generado por Playwright es indistinguible de uno humano para la página, así que **«el agente tiene prohibido pulsar Confirmar» no es una garantía técnica**: si el servidor aceptara el clic, un agente defectuoso o comprometido podría emitir sin que nadie lo haya aprobado. La regla de conducta del agente se mantiene (defensa en profundidad), pero la garantía debe estar en otro sitio.

## 2. Principio
**Autorizar ≠ ejecutar.** La *autorización* es un acto de una persona, con su propia identidad, ante NEXA. El *clic* en el simulador solo ejecuta lo que esa persona ya autorizó, y el simulador (que hace de portal) lo comprueba **en el servidor**, no en el navegador ni en el agente.

Tres identidades independientes y sin credenciales compartidas:

| Identidad | Cómo se autentica | Qué puede hacer | Qué NO puede hacer |
|---|---|---|---|
| **Persona** (usuario de la empresa con `fiscal.certificar`) | sesión de NEXA (en la demo: cabeceras `x-demo`) | autorizar la confirmación de **una** orden presentada | – |
| **Agente** | Ed25519 por equipo, peticiones firmadas | reclamar, informar progreso y vista previa, consultar el simulador, informar el resultado | autorizar, firmar autorizaciones, confirmar |
| **Navegador / simulador** | solo escucha en 127.0.0.1; token de control local para crear sesiones y consultar | mostrar el formulario y registrar la emisión simulada **si** hay autorización válida | emitir sin autorización de NEXA |

## 3. Mecanismo
1. **El agente presenta**: llena el formulario, genera la vista previa y la lee del simulador (`resumen` + `resumen_hash` = SHA-256 que calcula el propio simulador sobre lo que realmente está en pantalla). Lo informa a NEXA firmado (`vista_previa`) y se detiene.
2. **NEXA contrasta** lo informado con la instantánea congelada de la orden (receptor, establecimiento, número de conceptos, total). Si no coincide, **no se puede autorizar** (se muestra a la persona qué difiere).
3. **La persona autoriza** en NEXA (endpoint de persona, no del agente): `fel_op_orden_confirmacion_autorizar(actor, empresa, orden)` exige permiso `fiscal.certificar`, orden `llenada` con arrendamiento vigente, vista previa informada y coincidente; registra **una** autorización vigente por orden (tabla de solo inserción) y audita (`orden.confirmacion_autorizada`, con la persona).
4. **NEXA firma la concesión** con su clave Ed25519 propia (distinta de cualquier clave de agente; el agente nunca la ve): `{v, empresa, orden, resumen_hash, usuario, emitida, expira, jti}`. Caduca en 5 minutos. La entrega es **de servidor a servidor** por loopback (`POST /nexa/autorizaciones` del simulador), no pasa por el agente ni por la respuesta a la persona.
5. **El simulador comprueba al confirmar** (en el servidor): firma de NEXA válida, no caducada, `empresa` = empresa de la sesión, `orden` = referencia de la sesión, `resumen_hash` = hash **actual** de la vista previa (si el formulario cambió, no sirve), `jti` no usado (un solo uso). Sin concesión válida: `403 SIN_AUTORIZACION_HUMANA`, la sesión no cambia y queda registrado.
6. **El agente espera** (renovando su arrendamiento) y **consulta el libro del simulador** hasta ver la emisión o el fin de la sesión; informa el resultado con los datos **del libro**, no de la pantalla.

## 4. Qué garantiza cada capa
- **Agente comprometido o con errores**: no puede emitir. Para hacerlo necesitaría una concesión firmada por NEXA para ese hash exacto; no tiene la clave, no puede pedirla (sus rutas no incluyen «autorizar») y no se la entrega nadie.
- **Reutilización**: la concesión es de un solo uso, de una orden, de un hash de vista previa y caduca.
- **Cambio de contenido tras la aprobación**: el hash deja de coincidir ⇒ rechazo.
- **Otra empresa**: la concesión lleva la empresa; el simulador la compara con la de la sesión; la función de NEXA exige permiso en la empresa de la orden.
- **Persona sin permiso**, orden no presentada, orden vencida o revocación del agente: no se concede.

## 5. Límites reconocidos (se declaran, no se ocultan)
- El portal real de SAT **no** verificará concesiones de NEXA. Con él, el equivalente será una **entrega física**: Chromium se abre como proceso independiente del agente y, al llegar a la vista previa, el agente suelta el control; la persona pulsa Confirmar en esa ventana y el agente solo observa el resultado. Eso se diseñará y autorizará en la fase del instalador de Windows; **aquí solo se demuestra en el simulador**.
- Un agente comprometido en el mismo equipo ve el token de control local del simulador (crea sesiones y consulta), pero con él no puede confirmar (ruta inexistente) ni forjar concesiones.
- Si la persona autoriza y el agente se cae antes de informar, el resultado queda **incierto**: no se repite nada; el libro del simulador y la conciliación manual de dos personas lo resuelven.
- La clave de firma de NEXA vive en la demo en memoria del servidor; en producción irá en un almacén de secretos (pendiente).

## 6. Pruebas obligatorias de este mecanismo
Confirmación sin concesión rechazada; concesión de otra orden/otro hash/otra empresa/caducada/repetida rechazada; concesión forjada (firma ajena) rechazada; persona sin permiso o orden no presentada ⇒ NEXA no concede; el agente no tiene ruta para autorizar; flujo completo con persona; agente revocado tras presentar; desconexiones antes y después de presentar; operación duplicada; concurrencia y fencing; recuperación de resultado incierto con el libro.
