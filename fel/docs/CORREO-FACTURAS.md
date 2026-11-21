# Envío de facturas por correo (NEXA FEL)

Estado: **construido y probado en TEST con proveedor simulado. No hay envíos reales habilitados.** Digifact queda **solo como certificador**.

## Por qué un servicio propio
Respuesta escrita del técnico de Digifact (consulta del 19/11/2026): el correo de Digifact **solo sale al certificar** y únicamente si el XML lleva el correo en el nodo del receptor; **no se puede reenviar** por la API; **no se puede cambiar el asunto ni el remitente**; el HTML se basa en su PDF y la plantilla se elige en el portal. Para reenviar y para tener identidad NEXA hace falta enviar nosotros.
Para **no duplicar** correos, el NUC que arma NEXA **no envía** el correo del comprador a Digifact (`Buyer.Contact`); una prueba lo protege.

## Piezas
| Pieza | Archivo |
|---|---|
| Proveedor de correo (interfaz) + Resend por API + doble simulado | `demo-facturacion/src/correo/proveedor.ts` |
| Plantilla HTML (tablas, estilos en línea, 600 px fluido, sin imágenes externas) | `src/correo/plantilla.ts` |
| Servicio de envío (reglas de seguridad) | `src/correo/servicio.ts` |
| Configuración desde el entorno del servidor (falla cerrado) | `src/correo/entorno.ts` |
| Rutas | `src/api_correo.ts` (`GET /api/correo/estado`, `GET /api/documentos/:id/correos`, `POST /api/documentos/:id/correo`) |
| Historial (PROPUESTA de migración, **fuera** de `supabase/migrations`) | `docs/migracion-correo/20261121000100_fel_correo_envios.sql` |
| Pantalla (detalle de la factura) | `web/js/correo.js` |
| Pruebas | `tests/correo_test.ts`, `tests/e2e_correo.cjs` |

Cambiar de proveedor = otra clase con la interfaz `ProveedorCorreo`; el servicio no cambia.

## Reglas (todas en el servidor)
- Solo se envía una factura **certificada** con XML y PDF **íntegros** (se comprueba el hash). Nunca borrador, pendiente, por verificar, rechazada, anulada ni con anulación solicitada.
- La factura se busca por `(id, empresa de la sesión)`: otra empresa recibe «no encontrado».
- Permisos nuevos: `correos.ver`, `correos.enviar`, `correos.reenviar` (propietario y administrador: todos; emisor: ver y enviar; lector: ver).
- **Reenvío**: permiso + escribir `REENVIAR` + un envío previo aceptado + tope de 5 por factura cada 24 h.
- **Duplicados**: la misma solicitud (misma clave) no envía dos veces —ni aquí ni en Resend, que recibe la clave como `Idempotency-Key`—; un segundo envío al mismo destinatario exige el reenvío (índice único en la base); un envío **fallido** se retoma con su propia clave aunque la pantalla genere otra.
- **Límites**: 30 envíos/minuto por empresa y 10/minuto por persona.
- **TEST**: solo a destinatarios de una **lista cerrada** (`FEL_CORREO_DESTINATARIOS`); sin lista no sale nada.
- Los adjuntos se leen de `artefactos_documento` al enviar y **no se copian**; la auditoría lleva el correo enmascarado, nunca el contenido ni claves; los errores del proveedor no se reenvían tal cual.
- Rótulo **DOCUMENTO DE PRUEBA — SIN VALIDEZ FISCAL** en el mensaje (el PDF/XML adjuntos no se tocan).

## Estados que muestra la pantalla (solo lo que realmente se sabe)
`solicitado` · `aceptado por el proveedor` (**no prueba la entrega**) · `rechazado` · `fallido` (resultado incierto). `entregado` existe en la base pero **no se usa**: requeriría un *webhook* de Resend (no implementado).

## Configuración (variables del SERVIDOR; nunca del navegador)
| Variable | Uso |
|---|---|
| `FEL_CORREO` | `habilitado` (Resend real) o `simulado` (no sale nada). Ausente = sin correo. |
| `FEL_CORREO_REMITENTE` | `NEXA FEL <facturas@dominio-verificado>` |
| `RESEND_API_KEY` | **secreto**; solo con `habilitado` |
| `FEL_CORREO_DESTINATARIOS` | lista cerrada de prueba: direcciones y/o `@dominio` |
| `FEL_CORREO_AUTOMATICO` | `habilitado` activa la casilla «enviar al certificar». **Apagado por defecto.** |

El envío automático actúa solo si el servidor lo habilita **y** la persona marca la casilla al certificar; un fallo del correo nunca afecta a la certificación. Hoy cubre la certificación simulada; la certificación real de Digifact TEST sigue su propio flujo manual.

## Pendiente de configuración externa (no hecho)
1. Cuenta de Resend y **dominio remitente verificado** (SPF, DKIM y, recomendado, DMARC en el DNS).
2. `RESEND_API_KEY` como secreto del servidor (en el flujo de publicación, con autorización).
3. Lista de destinatarios de prueba autorizados y remitente definitivo.
4. Aplicar la migración del historial en la base real: **requiere autorización expresa** (hoy solo corre en las bases temporales de las pruebas; `verificar-publicacion.py` vigila que siga fuera de `supabase/migrations`).
5. Prueba de recepción real en los correos autorizados (Gmail y Outlook) cuando 1–3 estén listos.

## No incluido todavía
- Campo de correo y casilla en la pantalla de **Nueva factura** (`factura.js`): depende de la etapa 3 del rediseño. Hoy el correo se toma del receptor guardado o se escribe en el detalle.
- Estado «entregado» (webhook), reintentos automáticos en segundo plano, correo en producción fiscal.
