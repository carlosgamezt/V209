# Correo de la factura enviado por Digifact (decisión vigente)

**Decisión:** Digifact es el certificador **y** el responsable de enviar el correo de la factura, con **su plantilla** (configurada en su portal). NEXA solo indica el destinatario al certificar. El módulo de correo propio (Resend, [`CORREO-FACTURAS.md`](CORREO-FACTURAS.md)) se **conserva, apagado y sin uso**.

## Qué dijo Digifact (confirmado por escrito)
El correo sale **solo al certificar**, si el XML trae el correo en el nodo del receptor; **no se puede reenviar** por API; **no se cambian asunto ni remitente**; el HTML se basa en su PDF; adjuntan PDF y XML automáticamente; la plantilla se elige en el portal; personalizar más implica desarrollo suyo.

## Cómo funciona en NEXA
1. En el detalle del documento, panel **Digifact TEST**, casilla **«Enviar factura por correo»** (apagada por defecto) y el correo del destinatario (viene del cliente y se puede editar). Solo aparece si el servidor lo habilita y la persona puede certificar.
2. El correo viaja en `Buyer.Contact.EmailList.Email` del NUC (cumple el esquema oficial; hasta 50 caracteres, regla estricta). Sin la casilla, el NUC es **idéntico** al de siempre.
3. El correo **no entra en la huella ni en la referencia**: no cambia la operación preparada ni la lógica de certificación. Se pasa en validar, preparar (eco enmascarado) y certificar.
4. NEXA registra **«envío solicitado a Digifact»** (auditoría `digifact_test.correo_solicitado`, correo enmascarado) y lo muestra con la hora de Guatemala. **Nunca** «entregado»: Digifact no da confirmación.
5. Si el documento se rechaza o el resultado es incierto, la pantalla lo dice («no se envió» / «resultado incierto»).

## Interruptores (todos independientes; apagados por defecto)
| Variable | Qué habilita |
|---|---|
| `FEL_DIGIFACT_TEST` | certificación real de pruebas |
| `FEL_DIGIFACT_NIT` / `_CUI` | consultas de NIT / CUI |
| **`FEL_DIGIFACT_CORREO`** + `FEL_DIGIFACT_CORREO_EMPRESA` + `FEL_DIGIFACT_CORREO_DESTINATARIOS` | pedir a Digifact el envío del correo (una sola empresa; **lista cerrada** de destinatarios de prueba; falla cerrado) |
| `FEL_CORREO` (+ `RESEND_API_KEY`…) | módulo propio con Resend: **apagado** |

## Antiduplicados
- Un solo NUC por referencia: repetir la certificación no vuelve a enviar nada (ni correo) y la conciliación no reconstruye el NUC.
- El módulo propio rechaza enviar (`lo_envia_digifact`) cualquier documento para el que ya se pidió el correo a Digifact.
- En TEST solo salen correos a buzones de la lista autorizada (no sabemos si Digifact entrega los de TEST a la dirección real).

## Pendiente (consulta a Digifact, borrador sin enviar)
[`digifact/borrador-consulta-plantilla-correo.md`](digifact/borrador-consulta-plantilla-correo.md): logotipo y colores, alcance por NIT/integrador/global (multiempresa), datos del XML visibles, `AdditionalDocumentInfo.DocTemplate`, costo, comportamiento en TEST y efecto de `Seller.Contact.EmailList`. Diseño de referencia: [`digifact/plantilla-correo-propuesta.html`](digifact/plantilla-correo-propuesta.html) (el nombre comercial del correo es el del XML; **no se alteran datos fiscales por decoración**).

## No incluido
Casilla en *Nueva factura* (etapa 3 del rediseño), reenvío (no existe por esta vía), estado de entrega, producción.
