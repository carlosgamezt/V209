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

## Etapa 1 · el correo del receptor sale del cliente (implementada localmente; sin commit ni despliegue)
- **De dónde sale:** al abrir el panel, el **servidor** entrega el correo registrado del cliente del documento (`GET /api/documentos/:id/digifact/destinatario`, busca el cliente con la empresa del documento y de la sesión; solo para quien puede certificar y solo con `FEL_DIGIFACT_CORREO` habilitado para esa empresa). Sin correo, o con uno que el NUC no aceptaría, el campo queda **vacío** y se explica. Con Consumidor Final el correo es **opcional**.
- **Se puede editar.** La casilla sigue **apagada por defecto**; si se marca, hace falta un correo válido (la misma regla del NUC, hasta 50 caracteres). Sin marcarla, el NUC no lleva `Buyer.Contact` aunque el cliente tenga correo.
- **Cambio de cliente:** si el cliente del documento cambia, se descarta el correo anterior (prellenado o escrito), se apaga la casilla, se descarta la preparación y se avisa. Nunca se arrastra el correo de otro cliente.
- **El destinatario queda atado a la preparación:** `preparar` devuelve `correoRef`, una huella de (empresa, documento, operación, correo); `certificar` la exige y la compara. Cambiar el correo del cliente, escribir otro o alterar la huella no cambia a quién se envía (409 `correo_distinto` / 400 `correo_sin_preparacion`). La pantalla pide «Actualizar la preparación con este correo» si se marca o cambia el correo después de preparar.
- **Sin datos de más:** la auditoría guarda solo el correo enmascarado; ninguna respuesta de preparar/certificar trae el correo completo.
- **No cambia** la lógica fiscal, la huella ni la referencia, las consultas de NIT y CUI, ni el módulo propio (Resend, apagado).

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

## Primera prueba real
**HECHA 21/11/2026: exitosa.** Digifact certificó en TEST y envió el correo con PDF y XML (confirmado en el buzón autorizado). Resultado y datos: [`digifact/RESULTADO-PRUEBA-CORREO-DIGIFACT-TEST.md`](digifact/RESULTADO-PRUEBA-CORREO-DIGIFACT-TEST.md). Plan y controles: [`digifact/PRUEBA-CORREO-DIGIFACT-TEST.md`](digifact/PRUEBA-CORREO-DIGIFACT-TEST.md).

## Pendiente (consulta a Digifact, ya enviada por el responsable; sin respuesta registrada). El correo recibido (remitente `eface@digifact.com.gt`, emisor TEST GENS) muestra el logotipo de AGRIPACK: investigar cómo se asigna la plantilla y su funcionamiento multiempresa; no suponer que se cambie por el NUC
[`digifact/borrador-consulta-plantilla-correo.md`](digifact/borrador-consulta-plantilla-correo.md): logotipo y colores, alcance por NIT/integrador/global (multiempresa), datos del XML visibles, `AdditionalDocumentInfo.DocTemplate`, costo, comportamiento en TEST y efecto de `Seller.Contact.EmailList`. Diseño de referencia: [`digifact/plantilla-correo-propuesta.html`](digifact/plantilla-correo-propuesta.html) (el nombre comercial del correo es el del XML; **no se alteran datos fiscales por decoración**).

## No incluido
Casilla en *Nueva factura* (etapa 3 del rediseño), reenvío (no existe por esta vía), estado de entrega, producción.
